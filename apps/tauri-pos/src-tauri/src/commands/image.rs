//! Mandate 1 — Image compression.
//!
//! React owns the interactive crop (Canvas API + `react-easy-crop`). Once the
//! operator commits the crop, the raw RGBA pixels cross into Rust here for
//! WebP encoding. We keep retrying with lower quality until the encoded
//! payload is ≤ `max_kb` — the storefront / eBay layer hates >300 KB photos
//! and the operator should never have to think about file size.
//!
//! The whole pipeline runs on a `spawn_blocking` pool so the Tauri event
//! loop never stalls — image encoding is CPU-bound, not I/O-bound.

use serde::{Deserialize, Serialize};
use tauri::async_runtime::spawn_blocking;

use crate::error::{HardwareError, HwResult};

/// Operator-facing knob for the compression pass.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressOptions {
    /// Initial WebP quality 0..=100. We start here and step down on overshoot.
    pub quality: u8,
    /// Hard cap on the encoded payload size, in kibibytes. Reasonable: 300.
    pub max_kb: u32,
    /// Floor on quality — we never drop below this even if size still misses.
    /// Default 60 (slightly lossy but still publishable).
    pub min_quality: u8,
}

impl Default for CompressOptions {
    fn default() -> Self {
        Self {
            quality: 80,
            max_kb: 300,
            min_quality: 60,
        }
    }
}

/// Result returned to React — the raw WebP bytes plus the metadata the
/// upload pipeline needs (final size, achieved quality).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressResult {
    /// WebP-encoded bytes ready to hand to `uploadBlobToR2`.
    pub bytes: Vec<u8>,
    /// Final size of `bytes`, in bytes (not KiB — easier in JS).
    pub size_bytes: u32,
    /// Quality the final pass used (might be < requested if we had to retry).
    pub achieved_quality: u8,
    /// Width of the encoded image — pass-through for the photos table.
    pub width: u32,
    /// Height of the encoded image — pass-through for the photos table.
    pub height: u32,
}

/// Encode raw RGBA bytes (4 bytes per pixel, sRGB) into WebP and shrink the
/// quality until the result fits under `options.max_kb`.
///
/// React side: hand us `canvas.getContext('2d').getImageData(0,0,w,h).data`
/// converted to a `Uint8Array`. The Tauri serializer transports `Vec<u8>` as
/// an array of bytes (fine for our typical 1080×1080 crops — ~4 MB raw).
#[tauri::command]
pub async fn compress_to_webp(
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    options: Option<CompressOptions>,
) -> HwResult<CompressResult> {
    let opts = options.unwrap_or_default();

    if opts.quality < 1 || opts.quality > 100 {
        return Err(HardwareError::InvalidArgument(format!(
            "quality must be 1..=100, got {}",
            opts.quality
        )));
    }
    let expected_len = (width as usize) * (height as usize) * 4;
    if rgba.len() != expected_len {
        return Err(HardwareError::InvalidArgument(format!(
            "rgba length {} does not match {}x{} (expected {expected_len})",
            rgba.len(),
            width,
            height
        )));
    }

    // CPU-bound work; never block the main runtime.
    spawn_blocking(move || encode_with_retry(&rgba, width, height, opts))
        .await
        .map_err(|e| HardwareError::Internal(format!("join: {e}")))?
}

fn encode_with_retry(
    rgba: &[u8],
    width: u32,
    height: u32,
    opts: CompressOptions,
) -> HwResult<CompressResult> {
    let max_bytes = (opts.max_kb as usize) * 1024;
    let mut quality = opts.quality;

    loop {
        // The `webp` crate wants RGBA8 row-major, which is exactly what
        // Canvas gives us. Quality is f32 0..=100.
        let encoder = webp::Encoder::from_rgba(rgba, width, height);
        let encoded = encoder.encode(quality as f32);
        let bytes: Vec<u8> = encoded.to_vec();

        let size = bytes.len();
        if size <= max_bytes || quality <= opts.min_quality {
            return Ok(CompressResult {
                bytes,
                size_bytes: size as u32,
                achieved_quality: quality,
                width,
                height,
            });
        }
        // Step down 10 points at a time — fewer retries than 1-by-1, still
        // fine-grained enough for the typical 300 KB target.
        quality = quality.saturating_sub(10).max(opts.min_quality);
    }
}

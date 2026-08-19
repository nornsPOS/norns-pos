//! Unified hardware error type for every Tauri command.
//!
//! Every command in `commands/*` returns `Result<T, HardwareError>` so the
//! React layer can pattern-match on a single, well-known shape via the
//! `hardware-client.ts` discriminated union.
//!
//! Variants intentionally stay coarse — the goal is "what kind of failure
//! is this, and what should the operator see?" not "give me the kernel
//! errno". Each variant carries a free-form `details` string for the audit
//! log; the operator-facing toast text is composed in TypeScript.
//!
//! **Never `panic!()` inside a command.** Every fallible operation maps
//! into one of these variants — the POS must never crash the webview.

use serde::Serialize;
use thiserror::Error;

/// Discriminated error union shared with the React layer over IPC.
///
/// Serializes to `{ "kind": "<variant>", "details": "<string>" }` — Tauri
/// auto-flattens via `serde(tag = "kind", content = "details")`.
#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "details", rename_all = "snake_case")]
pub enum HardwareError {
    /// TCP socket / DNS / TLS / HTTP-status failure. Anything network-shaped.
    #[error("network error: {0}")]
    Network(String),

    /// Operation exceeded its timeout budget (default 5 s for all TCP I/O).
    #[error("operation timed out: {0}")]
    Timeout(String),

    /// The device responded but the response was malformed / out-of-protocol.
    #[error("device protocol error: {0}")]
    Device(String),

    /// Wrong/missing config — e.g. Fiskaly API key absent, printer IP unset.
    #[error("hardware not configured: {0}")]
    NotConfigured(String),

    /// Image/PDF/encoder produced something we cannot use.
    #[error("encoding error: {0}")]
    Encoding(String),

    /// I/O against the local filesystem (PDF temp save, store cache).
    #[error("local IO error: {0}")]
    LocalIo(String),

    /// The caller passed an invalid argument (e.g. negative amount).
    #[error("invalid argument: {0}")]
    InvalidArgument(String),

    /// Catch-all for anything else — kept as a separate variant so we never
    /// hide unexpected failures behind a "known" variant.
    #[error("internal error: {0}")]
    Internal(String),
}

// ────────────────────────────────────────────────────────────────────────
// Conversions from common error types — keeps the call sites tidy.
// ────────────────────────────────────────────────────────────────────────

impl From<std::io::Error> for HardwareError {
    fn from(err: std::io::Error) -> Self {
        match err.kind() {
            std::io::ErrorKind::TimedOut => HardwareError::Timeout(err.to_string()),
            std::io::ErrorKind::ConnectionRefused
            | std::io::ErrorKind::ConnectionAborted
            | std::io::ErrorKind::ConnectionReset
            | std::io::ErrorKind::NotConnected => HardwareError::Network(err.to_string()),
            _ => HardwareError::LocalIo(err.to_string()),
        }
    }
}

impl From<reqwest::Error> for HardwareError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            HardwareError::Timeout(err.to_string())
        } else if err.is_connect() || err.is_request() {
            HardwareError::Network(err.to_string())
        } else {
            HardwareError::Internal(err.to_string())
        }
    }
}

impl From<tokio::time::error::Elapsed> for HardwareError {
    fn from(err: tokio::time::error::Elapsed) -> Self {
        HardwareError::Timeout(err.to_string())
    }
}

impl From<serde_json::Error> for HardwareError {
    fn from(err: serde_json::Error) -> Self {
        HardwareError::Encoding(format!("json: {err}"))
    }
}

/// Convenience alias used throughout the command modules.
pub type HwResult<T> = std::result::Result<T, HardwareError>;

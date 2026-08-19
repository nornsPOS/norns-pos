//! USB digital scale over serial (Mettler-Toledo MT-SICS protocol).
//!
//! `read_scale_weight` opens the serial port, sends the `S` stable-weight
//! request, reads the ASCII reply, and parses the grams value. `list_scale_ports`
//! enumerates the available serial ports for the Gerätemanager dropdown.
//!
//! MT-SICS stable-weight reply shape (response to the `S` command):
//!   `S S      14.50 g`   → status1=S, status2=S (Stable), value, unit
//!   `S D      14.50 g`   → D = Dynamic (not yet settled)
//!   `S I` / `S +` / `S -`→ command not executable / over- / under-load
//!
//! The serial I/O runs on a blocking thread (`spawn_blocking`) so it never
//! stalls the async runtime. Parsing is split into a pure `parse_mt_sics`
//! function so it is unit-testable without hardware.

use std::io::{BufRead, BufReader, Write};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::error::{HardwareError, HwResult};

/// Default baud rate for MT-SICS scales.
const DEFAULT_BAUD: u32 = 9600;
/// How long to wait for the scale to answer before giving up on a single read.
const READ_TIMEOUT: Duration = Duration::from_millis(2000);
/// Overall budget to obtain a STABLE reading: we re-poll while the scale keeps
/// answering Dynamic (`S D`), but never longer than this. On expiry we surface a
/// Timeout — never a fabricated or unsettled weight (payout accuracy is sacred).
const STABLE_DEADLINE: Duration = Duration::from_millis(4000);
/// Hard cap on re-poll iterations so a chatty port cannot spin forever.
const STABLE_MAX_ATTEMPTS: u32 = 24;
/// Pause between re-polls while waiting for the weight to settle.
const STABLE_POLL_PAUSE: Duration = Duration::from_millis(150);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeightReading {
    /// Weight in grams, as the scale reported it (string preserves trailing zeros).
    pub grams: String,
}

/// Parse a single MT-SICS `S` reply line into a [`WeightReading`].
///
/// Pure + total — never panics. Only a STABLE (`S S`) reply yields a weight; a
/// Dynamic (`S D`) reply is REJECTED, not accepted, because an unsettled weight
/// would mis-price an Ankauf payout by grams. The transport layer re-polls on a
/// Dynamic reply (see [`is_dynamic_reply`]); over/underload and garbage are hard
/// errors that must not be retried.
pub fn parse_mt_sics(raw: &str) -> HwResult<WeightReading> {
    let line = raw.trim();
    let mut tokens = line.split_whitespace();

    // Token 0 must be the `S` response identifier.
    if tokens.next() != Some("S") {
        return Err(HardwareError::Device(format!(
            "unexpected MT-SICS response (no 'S' identifier): {line:?}"
        )));
    }

    // Token 1 is the weight status: only S (stable) is a usable reading.
    match tokens.next() {
        Some("S") => {}
        Some("D") => {
            return Err(HardwareError::Device(
                "scale: dynamic (unsettled) weight rejected (S D)".to_string(),
            ));
        }
        Some("I") => {
            return Err(HardwareError::Device(
                "scale: command not executable (S I)".to_string(),
            ));
        }
        Some("+") => return Err(HardwareError::Device("scale: overload (S +)".to_string())),
        Some("-") => return Err(HardwareError::Device("scale: underload (S -)".to_string())),
        other => {
            return Err(HardwareError::Device(format!(
                "scale: unexpected status token {other:?} in {line:?}"
            )));
        }
    }

    // Token 2 is the numeric weight; validate it parses, but return the original
    // string so we keep the scale's exact precision (e.g. "14.50", not "14.5").
    let value = tokens
        .next()
        .ok_or_else(|| HardwareError::Device(format!("scale: no weight value in {line:?}")))?;
    if value.parse::<f64>().is_err() {
        return Err(HardwareError::Device(format!(
            "scale: non-numeric weight {value:?} in {line:?}"
        )));
    }

    Ok(WeightReading {
        grams: value.to_string(),
    })
}

/// True iff `raw` is a well-formed Dynamic (`S D …`) reply. The transport loop
/// uses this to decide "re-poll and wait for it to settle" versus "this is a
/// hard error, give up" — an overload or garbage line is NOT dynamic and must
/// not be retried.
pub fn is_dynamic_reply(raw: &str) -> bool {
    let mut tokens = raw.trim().split_whitespace();
    tokens.next() == Some("S") && tokens.next() == Some("D")
}

/// Parse an MT-SICS tare (`T`) reply. A successful tare answers `T S …`;
/// `T I` (not executable) / `T +` / `T -` (over/underload) are errors.
///
/// Pure + total — never panics.
pub fn parse_mt_sics_tare(raw: &str) -> HwResult<()> {
    let line = raw.trim();
    let mut tokens = line.split_whitespace();

    if tokens.next() != Some("T") {
        return Err(HardwareError::Device(format!(
            "unexpected MT-SICS tare response (no 'T' identifier): {line:?}"
        )));
    }

    match tokens.next() {
        Some("S") => Ok(()),
        Some("I") => Err(HardwareError::Device(
            "scale: tare not executable (T I)".to_string(),
        )),
        Some("+") => Err(HardwareError::Device(
            "scale: tare overload (T +)".to_string(),
        )),
        Some("-") => Err(HardwareError::Device(
            "scale: tare underload (T -)".to_string(),
        )),
        other => Err(HardwareError::Device(format!(
            "scale: unexpected tare status token {other:?} in {line:?}"
        ))),
    }
}

/// Blocking serial round-trip for a STABLE weight: open the port, then re-poll
/// `S` while the scale answers Dynamic (`S D`) until it settles — bounded by both
/// an attempt cap and a wall-clock deadline. On expiry we return a Timeout rather
/// than a stale or unsettled weight; over/underload and garbage propagate their
/// hard `Device` error immediately (no retry).
fn read_scale_blocking(port_path: &str, baud: u32) -> HwResult<WeightReading> {
    let port = serialport::new(port_path, baud)
        .timeout(READ_TIMEOUT)
        .open()
        .map_err(|e| HardwareError::Device(format!("open serial port {port_path:?}: {e}")))?;

    // Clone a writer handle, then wrap the port in a buffered reader for the line.
    let mut writer = port
        .try_clone()
        .map_err(|e| HardwareError::Device(format!("clone serial handle: {e}")))?;
    let mut reader = BufReader::new(port);

    let deadline = Instant::now() + STABLE_DEADLINE;
    for _ in 0..STABLE_MAX_ATTEMPTS {
        writer
            .write_all(b"S\r\n")
            .map_err(|e| HardwareError::Device(format!("write MT-SICS request: {e}")))?;
        writer
            .flush()
            .map_err(|e| HardwareError::Device(format!("flush serial port: {e}")))?;

        let mut line = String::new();
        reader
            .read_line(&mut line)
            .map_err(|e| HardwareError::Timeout(format!("read scale reply: {e}")))?;

        // Empty line or an unsettled reading → wait and re-poll, unless the
        // stability budget is spent.
        if line.trim().is_empty() || is_dynamic_reply(&line) {
            if Instant::now() >= deadline {
                return Err(HardwareError::Timeout(
                    "scale: weight did not settle within timeout".to_string(),
                ));
            }
            std::thread::sleep(STABLE_POLL_PAUSE);
            continue;
        }

        // Stable reading or a hard error (overload / garbage) — both are final.
        return parse_mt_sics(&line);
    }

    Err(HardwareError::Timeout(
        "scale: weight did not settle within the attempt budget".to_string(),
    ))
}

/// Blocking serial round-trip to tare (zero) the scale: open, send `T`, read the
/// acknowledgement, parse. A tare that the scale cannot execute surfaces as an
/// error rather than silently leaving a non-zero offset.
fn tare_scale_blocking(port_path: &str, baud: u32) -> HwResult<()> {
    let port = serialport::new(port_path, baud)
        .timeout(READ_TIMEOUT)
        .open()
        .map_err(|e| HardwareError::Device(format!("open serial port {port_path:?}: {e}")))?;

    let mut writer = port
        .try_clone()
        .map_err(|e| HardwareError::Device(format!("clone serial handle: {e}")))?;
    writer
        .write_all(b"T\r\n")
        .map_err(|e| HardwareError::Device(format!("write MT-SICS tare request: {e}")))?;
    writer
        .flush()
        .map_err(|e| HardwareError::Device(format!("flush serial port: {e}")))?;

    let mut reader = BufReader::new(port);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|e| HardwareError::Timeout(format!("read scale tare reply: {e}")))?;
    if line.trim().is_empty() {
        return Err(HardwareError::Timeout(
            "scale: no tare reply within timeout".to_string(),
        ));
    }
    parse_mt_sics_tare(&line)
}

/// Read a stable weight from the scale at `port_path` (baud configurable).
#[tauri::command]
pub async fn read_scale_weight(
    port_path: String,
    baud_rate: Option<u32>,
) -> HwResult<WeightReading> {
    if crate::config::is_mock_mode() {
        return Ok(WeightReading {
            grams: "14.50".to_string(),
        });
    }
    let baud = baud_rate.unwrap_or(DEFAULT_BAUD);
    tokio::task::spawn_blocking(move || read_scale_blocking(&port_path, baud))
        .await
        .map_err(|e| HardwareError::Internal(format!("scale task join: {e}")))?
}

/// Tare (zero) the scale at `port_path`. In mock mode this is a no-op success.
#[tauri::command]
pub async fn tare_scale(port_path: String, baud_rate: Option<u32>) -> HwResult<()> {
    if crate::config::is_mock_mode() {
        return Ok(());
    }
    let baud = baud_rate.unwrap_or(DEFAULT_BAUD);
    tokio::task::spawn_blocking(move || tare_scale_blocking(&port_path, baud))
        .await
        .map_err(|e| HardwareError::Internal(format!("scale tare task join: {e}")))?
}

/// Enumerate available serial ports (paths) for the operator to choose from.
#[tauri::command]
pub async fn list_scale_ports() -> HwResult<Vec<String>> {
    if crate::config::is_mock_mode() {
        return Ok(vec!["/dev/tty.mock-scale".to_string()]);
    }
    let ports = serialport::available_ports()
        .map_err(|e| HardwareError::Device(format!("enumerate serial ports: {e}")))?;
    Ok(ports.into_iter().map(|p| p.port_name).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_stable_mt_sics_reply() {
        let reading = parse_mt_sics("S S      14.50 g\r\n").expect("should parse");
        assert_eq!(reading.grams, "14.50");
    }

    #[test]
    fn rejects_dynamic_reply() {
        // A Dynamic (unsettled) reading must NOT yield a weight — using it would
        // mis-price an Ankauf payout. The transport layer re-polls instead.
        assert!(parse_mt_sics("S D      3.20 g").is_err());
    }

    #[test]
    fn is_dynamic_reply_only_matches_s_d() {
        assert!(is_dynamic_reply("S D      3.20 g"));
        assert!(is_dynamic_reply("  S D 0.00 g\r\n"));
        assert!(!is_dynamic_reply("S S      14.50 g"));
        assert!(!is_dynamic_reply("S +"));
        assert!(!is_dynamic_reply("S I"));
        assert!(!is_dynamic_reply("garbage line"));
        assert!(!is_dynamic_reply(""));
    }

    #[test]
    fn rejects_overload_and_garbage() {
        assert!(parse_mt_sics("S +").is_err());
        assert!(parse_mt_sics("S I").is_err());
        assert!(parse_mt_sics("garbage line").is_err());
        assert!(parse_mt_sics("S S not_a_number g").is_err());
    }

    #[test]
    fn parses_successful_tare() {
        assert!(parse_mt_sics_tare("T S       0.00 g").is_ok());
        assert!(parse_mt_sics_tare("T S\r\n").is_ok());
    }

    #[test]
    fn rejects_failed_or_malformed_tare() {
        assert!(parse_mt_sics_tare("T I").is_err()); // not executable
        assert!(parse_mt_sics_tare("T +").is_err()); // overload
        assert!(parse_mt_sics_tare("T -").is_err()); // underload
        assert!(parse_mt_sics_tare("S S 1.00 g").is_err()); // wrong identifier
        assert!(parse_mt_sics_tare("garbage").is_err());
    }
}

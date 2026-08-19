//! Mandate 2-B — ZVT card terminal over TCP.
//!
//! ZVT 1.10 is the German Kreditwirtschaft protocol every Ingenico /
//! Verifone / VeriFone / VR-Pay terminal speaks. We use the network
//! transport (port 20007 by convention) because all recent terminals
//! ship with Ethernet — USB-serial belongs in Phase 1.5.
//!
//! The protocol is a CCITT-style framing:
//!   - APDU = [CLASS, INS, LENGTH, ...payload..., CRC-CCITT(low), CRC-CCITT(high)]
//!   - Status codes mirror ISO 8583 — `0x00 0x00` = OK, anything else = decline.
//!
//! V1 implements two operations: Authorisation (06 01) and Reversal (06 30).
//! The mock returns plausible auth codes after a 2-3 s delay so the UI flow
//! is exercised without a terminal.

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};

use crate::config::{self, DEFAULT_TCP_TIMEOUT_MS};
use crate::error::{HardwareError, HwResult};
use crate::mock::zvt_mock;

/// IP + port pulled from the Hardware tab; never trusted from React.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZvtEndpoint {
    pub ip: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZvtResult {
    pub success: bool,
    pub authorization_code: Option<String>,
    /// Masked PAN, e.g. `****1234`. Never the full PAN.
    pub card_pan_masked: Option<String>,
    pub card_brand: Option<String>,
    /// Free-form receipt text the terminal prints — we surface it on the
    /// thermal receipt too.
    pub receipt_text: Option<String>,
    pub error_message: Option<String>,
}

/// Quick TCP probe — open a connection, close it. Drives the green/red badge
/// and the app-start auto-connect sweep. Shares the canonical `probe_tcp`
/// helper with the receipt + label printers so every device uses one timeout
/// budget and one reachability semantic.
#[tauri::command]
pub async fn zvt_check_connection(endpoint: ZvtEndpoint) -> HwResult<bool> {
    if config::is_mock_mode() {
        return zvt_mock::check_connection(endpoint).await;
    }
    Ok(crate::commands::thermal::probe_tcp(&endpoint.ip, endpoint.port).await)
}

/// Authorize a card payment for `amount_cents`. Blocks the terminal until
/// the cardholder confirms — the React layer must open a ZvtSpinner modal.
#[tauri::command]
pub async fn zvt_authorize_payment(
    endpoint: ZvtEndpoint,
    amount_cents: u64,
) -> HwResult<ZvtResult> {
    if config::is_mock_mode() {
        return zvt_mock::authorize_payment(endpoint, amount_cents).await;
    }

    // Reject a zero / over-BCD amount BEFORE framing (and before touching the
    // socket), so a bad amount fails cleanly instead of building a malformed
    // on-wire frame. Same guard the mock enforces.
    check_amount(amount_cents)?;

    let addr = format!("{}:{}", endpoint.ip, endpoint.port);
    let mut stream = timeout(
        Duration::from_millis(DEFAULT_TCP_TIMEOUT_MS),
        TcpStream::connect(&addr),
    )
    .await
    .map_err(HardwareError::from)??;

    let frame = build_authorisation_frame(amount_cents);
    stream.write_all(&frame).await?;
    stream.flush().await?;

    run_zvt_conversation(&mut stream).await
}

/// Drive the ECR side of the ZVT authorisation conversation after `06 01` was
/// sent. Grounded in ZVT 13.13 via ecrterm (`transmission/zvt.py` +
/// `packets/base_packets.py::Packet.handle_response`): the terminal first ACKs
/// the command with `80 00`, then streams zero-or-more `04 FF` intermediate-
/// status messages, the `04 0F` Status-Information (the result), and finally a
/// `06 0F` Completion (or a `06 1E` Abort). The ECR sends an `80 00` ACK after
/// every terminal message EXCEPT the terminal's own `80 00`. The result is
/// captured from the `04 0F`; the conversation ends on Completion / Abort / NAK.
/// Each message gets the full (cardholder) read window, so an intermediate
/// "insert card / enter PIN" wait cannot trip a premature timeout.
/// Drive the ZVT ECR conversation to a result. Shared by authorization (06 01)
/// AND reversal (06 30) — both elicit the same message sequence (ACK →
/// intermediate status → 04 0F Status-Information → 06 0F Completion, or a
/// 06 1E Abort), read with proper APDU length-framing across multiple reads.
async fn run_zvt_conversation(stream: &mut TcpStream) -> HwResult<ZvtResult> {
    const ECR_ACK: [u8; 3] = [0x80, 0x00, 0x00];
    const MAX_MESSAGES: usize = 64; // guard against an endless intermediate-status stream

    let timeout_ms = config::zvt_read_timeout_ms();
    let mut result: Option<ZvtResult> = None;

    for _ in 0..MAX_MESSAGES {
        let apdu = read_apdu(stream, timeout_ms).await?;
        match (apdu[0], apdu[1]) {
            // Terminal ACK of our 06 01 — the ECR does NOT ACK an ACK.
            (0x80, 0x00) => {}
            // Negative ACK / NAK ends the conversation with an error.
            (0x84, n) => {
                return Err(HardwareError::Device(format!(
                    "ZVT: Terminal-NAK (84 {n:02X})"
                )))
            }
            // Intermediate status ("Bitte Karte", "PIN" …): ACK and keep waiting.
            (0x04, 0xFF) => send_ack(stream, &ECR_ACK).await?,
            // Status-Information: the result. Capture it, ACK, keep reading for Completion.
            (0x04, 0x0F) => {
                result = Some(parse_authorisation_response(&apdu)?);
                send_ack(stream, &ECR_ACK).await?;
            }
            // Completion: ACK and finish — return the captured Status result.
            (0x06, 0x0F) => {
                send_ack(stream, &ECR_ACK).await?;
                return result.ok_or_else(|| {
                    HardwareError::Device(
                        "ZVT: Completion ohne vorherige Status-Information".into(),
                    )
                });
            }
            // Abort: ACK and finish with an unsuccessful result.
            (0x06, 0x1E) => {
                send_ack(stream, &ECR_ACK).await?;
                return parse_authorisation_response(&apdu);
            }
            (c, i) => {
                return Err(HardwareError::Device(format!(
                    "ZVT: unerwartete APDU {c:02X} {i:02X} im Autorisierungs-Dialog"
                )))
            }
        }
    }
    Err(HardwareError::Device(
        "ZVT: zu viele Zwischenmeldungen ohne Abschluss".into(),
    ))
}

async fn send_ack(stream: &mut TcpStream, payload: &[u8]) -> HwResult<()> {
    stream.write_all(payload).await?;
    stream.flush().await?;
    Ok(())
}

/// Read exactly one ZVT APDU `[CLASS, INS, LEN, …data…]` (LEN is 1 byte, or
/// `0xFF` + 2-byte little-endian extended length) within the per-message
/// timeout window. Returns a clean `Timeout` on a silent terminal.
async fn read_apdu(stream: &mut TcpStream, timeout_ms: u64) -> HwResult<Vec<u8>> {
    let read = async {
        let mut head = [0u8; 3];
        stream.read_exact(&mut head).await?;
        let mut apdu = Vec::with_capacity(3 + head[2] as usize);
        apdu.extend_from_slice(&head);
        let data_len = if head[2] == 0xFF {
            let mut ext = [0u8; 2];
            stream.read_exact(&mut ext).await?;
            apdu.extend_from_slice(&ext);
            u16::from_le_bytes(ext) as usize
        } else {
            head[2] as usize
        };
        if data_len > 0 {
            let mut data = vec![0u8; data_len];
            stream.read_exact(&mut data).await?;
            apdu.extend_from_slice(&data);
        }
        Ok::<Vec<u8>, HardwareError>(apdu)
    };
    timeout(Duration::from_millis(timeout_ms), read)
        .await
        .map_err(HardwareError::from)?
}

/// Reverse a previously-authorized payment (e.g. operator pressed "Storno"
/// before the receipt printed). The terminal voids the auth.
#[tauri::command]
pub async fn zvt_reverse_payment(
    endpoint: ZvtEndpoint,
    authorization_code: String,
) -> HwResult<bool> {
    if config::is_mock_mode() {
        return zvt_mock::reverse_payment(endpoint, authorization_code).await;
    }

    let addr = format!("{}:{}", endpoint.ip, endpoint.port);
    let mut stream = timeout(
        Duration::from_millis(DEFAULT_TCP_TIMEOUT_MS),
        TcpStream::connect(&addr),
    )
    .await
    .map_err(HardwareError::from)??;

    let frame = build_reversal_frame(&authorization_code);
    stream.write_all(&frame).await?;
    stream.flush().await?;

    // A reversal (06 30) elicits the SAME ECR conversation as an authorization
    // (ACK → intermediate status → 04 0F Status-Information → 06 0F Completion,
    // or 06 1E Abort). Run the full length-framed loop instead of a single naive
    // `read` into a fixed buffer + a raw `buf[6]/buf[7]` check — a Storno
    // confirmation that arrives across multiple reads (or after an intermediate
    // status) is no longer misread as failure. `success` reflects the signed
    // BMP 0x27 result-code.
    let result = run_zvt_conversation(&mut stream).await?;
    Ok(result.success)
}

// ────────────────────────────────────────────────────────────────────────
// ZVT framing — kept deliberately small. V1 supports cents up to 8 digits.
// ────────────────────────────────────────────────────────────────────────

/// Largest amount representable in the 6-byte (12-nibble) BCD amount field.
pub const MAX_BCD_CENTS: u64 = 999_999_999_999;

/// Guard a ZVT amount BEFORE it is BCD-framed. A real terminal rejects a zero
/// amount, and the 6-byte BCD amount field cannot hold more than
/// `MAX_BCD_CENTS`. Shared by the real authorize path AND the mock so they
/// reject identically — this guard used to live ONLY in the mock, so the real
/// `zvt_authorize_payment` would build an over-large/zero frame that was green
/// in the mock but malformed on the wire.
pub fn check_amount(amount_cents: u64) -> HwResult<()> {
    if amount_cents == 0 {
        return Err(HardwareError::InvalidArgument(
            "ZVT: Betrag 0 ist ungültig".into(),
        ));
    }
    if amount_cents > MAX_BCD_CENTS {
        return Err(HardwareError::InvalidArgument(format!(
            "ZVT: Betrag {amount_cents} überschreitet das 6-Byte-BCD-Limit"
        )));
    }
    Ok(())
}

/// Build a `06 01` Authorisation APDU. Amount is BCD-encoded, 6 bytes
/// (cents), big-endian per ZVT 1.10 §8.
///
/// `pub` so the HIL test server + the hardened mock validate against the SAME
/// canonical frame (no mock-vs-real divergence).
pub fn build_authorisation_frame(amount_cents: u64) -> Vec<u8> {
    let bcd = bcd_amount(amount_cents);
    let mut payload = Vec::with_capacity(16);
    payload.extend_from_slice(&[0x04, 0x06]); // TLV: amount tag
    payload.extend_from_slice(&bcd); // 6 bytes BCD
    payload.extend_from_slice(&[0x49, 0x09, 0x78]); // currency = EUR (978) BCD

    // APDU prefix: CLASS 06, INS 01, LENGTH, ...
    let mut frame = Vec::with_capacity(payload.len() + 5);
    frame.push(0x06);
    frame.push(0x01);
    frame.push(payload.len() as u8);
    frame.extend_from_slice(&payload);
    let crc = crc_ccitt(&frame);
    frame.push((crc & 0xFF) as u8);
    frame.push(((crc >> 8) & 0xFF) as u8);
    frame
}

/// Build a `06 30` Reversal APDU referencing `authorization_code` (4-byte
/// BCD per ZVT). V1 ignores partial-reversal amounts (always full void).
fn build_reversal_frame(authorization_code: &str) -> Vec<u8> {
    let mut payload = Vec::with_capacity(8);
    payload.extend_from_slice(&[0x87, 0x04]); // TLV: receipt-no tag
                                              // Pack the 4-digit auth code as BCD; pad short codes with leading zeros.
    let padded: String = if authorization_code.len() >= 4 {
        authorization_code[authorization_code.len() - 4..].to_string()
    } else {
        format!("{:04}", authorization_code.parse::<u32>().unwrap_or(0))
    };
    payload.extend_from_slice(&bcd_from_str(&padded));

    let mut frame = Vec::with_capacity(payload.len() + 5);
    frame.push(0x06);
    frame.push(0x30);
    frame.push(payload.len() as u8);
    frame.extend_from_slice(&payload);
    let crc = crc_ccitt(&frame);
    frame.push((crc & 0xFF) as u8);
    frame.push(((crc >> 8) & 0xFF) as u8);
    frame
}

/// Parse the terminal's response APDU — spec-accurate to ZVT 13.13.
///
/// The authorisation result does NOT come back as a clean `[tag][len][val]`
/// stream from a fixed offset. It arrives in a `04 0F` Status-Information (or
/// `06 0F` Completion) whose data block is a **BMP stream** — each field is its
/// 1-byte BMP id followed by a value encoded per the ZVT bitmap table:
///   • result-code = BMP `0x27` (1 binary byte; `0x00` = approved)
///   • masked PAN  = BMP `0x22` (LLVAR; packed BCD, nibble `0xE` = masked digit)
///   • card-name / brand = BMP `0x8B` (LLVAR ASCII)
///   • receipt-no  = BMP `0x87` (2-byte BCD) — the reversal reference
///   • additional-text = BMP `0x3C` (LLLVAR)
/// `06 1E` is an Abort (1-byte result-code); `80 00` is a bare positive ACK.
/// Field formats/lengths transcribed from the ZVT bitmap table (ecrterm /
/// ZVT 13.13) — see tests for the golden fixtures.
pub fn parse_authorisation_response(buf: &[u8]) -> HwResult<ZvtResult> {
    if buf.len() < 2 {
        return Err(HardwareError::Device(format!(
            "ZVT response too short: {}b",
            buf.len()
        )));
    }
    match (buf[0], buf[1]) {
        // Bare positive ACK. The Status-Information arrives in a SEPARATE
        // message, so a single read that saw only the ACK has no result yet.
        // (The full flow is ACK → 04 0F → 06 0F across reads — see the runbook
        // Layer-2 note; the single-read command model is a real-hardware gap.)
        (0x80, 0x00) => Err(HardwareError::Device(
            "ZVT: nur positiver ACK (80 00) empfangen, noch keine Status-Information".into(),
        )),
        (0x84, n) => Err(HardwareError::Device(format!(
            "ZVT: Terminal-NAK (84 {n:02X})"
        ))),
        // Abort APDU: [06 1E LEN result-code …].
        (0x06, 0x1E) => Ok(decline_result(buf.get(3).copied().unwrap_or(0xFF))),
        // Status-Information / Completion → walk the BMP block.
        (0x04, 0x0F) | (0x06, 0x0F) => {
            let data = bmp_block_after_length(buf)?;
            let b = parse_bmp_block(data);
            let code = b.result_code.ok_or_else(|| {
                HardwareError::Device("ZVT 04 0F ohne Ergebnis-Code (BMP 0x27)".into())
            })?;
            if code != 0x00 {
                let mut r = decline_result(code);
                r.card_pan_masked = b.pan_masked.map(mask_to_last_four);
                r.card_brand = b.brand;
                return Ok(r);
            }
            Ok(ZvtResult {
                success: true,
                // Receipt-number is the value a reversal (06 30, BMP 0x87)
                // references; fall back to the trace-number if absent.
                authorization_code: b.receipt_no.or(b.trace_no),
                card_pan_masked: b.pan_masked.map(mask_to_last_four),
                card_brand: b.brand,
                receipt_text: b.additional_text,
                error_message: None,
            })
        }
        (c, i) => Err(HardwareError::Device(format!(
            "ZVT: unerwartete Antwort-APDU {c:02X} {i:02X}"
        ))),
    }
}

fn decline_result(code: u8) -> ZvtResult {
    ZvtResult {
        success: false,
        authorization_code: None,
        card_pan_masked: None,
        card_brand: None,
        receipt_text: None,
        error_message: Some(format!(
            "Terminal lehnte ab: {} (Code {code:#04X})",
            zvt_result_message(code)
        )),
    }
}

/// Subset of the ZVT result-code table (BMP 0x27 / Abort result byte).
fn zvt_result_message(code: u8) -> &'static str {
    match code {
        0x00 => "genehmigt",
        0x05 => "Zahlung nicht möglich",
        0x6C => "Abbruch",
        0x6F => "Karte ungültig",
        0x9C => "bitte Karte erneut vorlegen",
        0xA0 => "Empfangsfehler",
        _ => "Terminal-Fehler",
    }
}

/// The BMP data block = the bytes after the APDU length field (1 byte, or `0xFF`
/// followed by a 2-byte little-endian length, per ZVT).
fn bmp_block_after_length(buf: &[u8]) -> HwResult<&[u8]> {
    if buf.len() < 3 {
        return Err(HardwareError::Device("ZVT APDU ohne Längenfeld".into()));
    }
    let start = if buf[2] == 0xFF {
        if buf.len() < 5 {
            return Err(HardwareError::Device(
                "ZVT APDU: defektes 3-Byte-Längenfeld".into(),
            ));
        }
        5
    } else {
        3
    };
    Ok(&buf[start..])
}

#[derive(Default)]
struct ZvtBmps {
    result_code: Option<u8>,
    pan_masked: Option<String>,
    brand: Option<String>,
    receipt_no: Option<String>,
    trace_no: Option<String>,
    additional_text: Option<String>,
}

/// Walk a ZVT BMP data block, collecting the fields the POS needs. Stops at the
/// first BMP id whose length it cannot determine (returns what it gathered).
fn parse_bmp_block(mut data: &[u8]) -> ZvtBmps {
    let mut out = ZvtBmps::default();
    while let Some((id, val, consumed)) = next_bmp(data) {
        match id {
            0x27 => out.result_code = val.first().copied(),
            0x22 => out.pan_masked = Some(decode_masked_pan(val)),
            0x8B => out.brand = String::from_utf8(val.to_vec()).ok(),
            0x87 => out.receipt_no = Some(bcd_digits(val)),
            0x0B => out.trace_no = Some(bcd_digits(val)),
            0x3C => out.additional_text = String::from_utf8(val.to_vec()).ok(),
            _ => {}
        }
        data = &data[consumed..];
    }
    out
}

/// Per-BMP wire format from the ZVT bitmap table (fixed length in bytes, the
/// `Fx Fy`-prefixed LLVAR/LLLVAR, or the `0x06` TLV container).
enum BmpFmt {
    Fixed(usize),
    Llvar,
    Lllvar,
    Tlv,
}

fn bmp_format(id: u8) -> Option<BmpFmt> {
    Some(match id {
        0x01 | 0x02 | 0x03 | 0x05 | 0x19 | 0x27 | 0x8A | 0x8C | 0xA0 | 0xD0 | 0xD2 | 0xD3 => {
            BmpFmt::Fixed(1)
        }
        0x0D | 0x0E | 0x17 | 0x3A | 0x49 | 0x87 => BmpFmt::Fixed(2),
        0x0B | 0x0C | 0x37 | 0x88 | 0x3D | 0xAA => BmpFmt::Fixed(3),
        0x29 => BmpFmt::Fixed(4),
        0xBA => BmpFmt::Fixed(5),
        0x3B | 0xEB => BmpFmt::Fixed(8),
        0x2A => BmpFmt::Fixed(15),
        0x04 => BmpFmt::Fixed(6),
        0x22 | 0x23 | 0x2D | 0x8B | 0xA7 | 0xD1 | 0xE1..=0xE8 | 0xF1..=0xF9 => BmpFmt::Llvar,
        0x24 | 0x2E | 0x3C | 0x60 | 0x92 | 0x9A | 0xAF => BmpFmt::Lllvar,
        0x06 => BmpFmt::Tlv,
        _ => return None,
    })
}

/// Read one BMP: `(id, value_bytes, total_bytes_consumed)`, or `None` if the id
/// is unknown (length undeterminable) or the field is truncated.
fn next_bmp(data: &[u8]) -> Option<(u8, &[u8], usize)> {
    let id = *data.first()?;
    let rest = &data[1..];
    match bmp_format(id)? {
        BmpFmt::Fixed(n) => (rest.len() >= n).then(|| (id, &rest[..n], 1 + n)),
        BmpFmt::Llvar => read_lvar(id, rest, 2),
        BmpFmt::Lllvar => read_lvar(id, rest, 3),
        BmpFmt::Tlv => {
            // ZVT length: 1 byte, or 0xFF + 2-byte little-endian.
            let (vstart, vlen) = match *rest.first()? {
                0xFF => (
                    3usize,
                    u16::from_le_bytes([*rest.get(1)?, *rest.get(2)?]) as usize,
                ),
                n => (1usize, n as usize),
            };
            (rest.len() >= vstart + vlen)
                .then(|| (id, &rest[vstart..vstart + vlen], 1 + vstart + vlen))
        }
    }
}

/// Read an LLVAR (`ll=2`) / LLLVAR (`ll=3`): `ll` length bytes each encoded
/// `0xF0 | digit` (ZVT "Fx Fy"), then that many VALUE bytes.
fn read_lvar(id: u8, rest: &[u8], ll: usize) -> Option<(u8, &[u8], usize)> {
    if rest.len() < ll {
        return None;
    }
    let mut len = 0usize;
    for &b in &rest[..ll] {
        if !(0xF0..=0xF9).contains(&b) {
            return None;
        }
        len = len * 10 + (b & 0x0F) as usize;
    }
    (rest.len() >= ll + len).then(|| (id, &rest[ll..ll + len], 1 + ll + len))
}

/// Decode a packed-BCD card number where nibble `0xE` marks a masked digit and
/// `0xF` is odd-length padding — e.g. → "457302******1234".
fn decode_masked_pan(val: &[u8]) -> String {
    let mut s = String::with_capacity(val.len() * 2);
    for &b in val {
        for nib in [b >> 4, b & 0x0F] {
            match nib {
                0x0..=0x9 => s.push((b'0' + nib) as char),
                0xE => s.push('*'),
                0xF => {} // padding
                _ => s.push('?'),
            }
        }
    }
    s
}

/// Decode packed BCD into its digit string (`0xF` padding skipped).
fn bcd_digits(val: &[u8]) -> String {
    let mut s = String::with_capacity(val.len() * 2);
    for &b in val {
        for nib in [b >> 4, b & 0x0F] {
            if nib <= 9 {
                s.push((b'0' + nib) as char);
            }
        }
    }
    s
}

fn bcd_amount(cents: u64) -> Vec<u8> {
    let s = format!("{:012}", cents); // 12 nibbles → 6 bytes
    bcd_from_str(&s)
}

fn bcd_from_str(s: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        let hi = bytes[i].saturating_sub(b'0');
        let lo = bytes[i + 1].saturating_sub(b'0');
        out.push((hi << 4) | (lo & 0x0F));
        i += 2;
    }
    out
}

/// CRC-CCITT-16 (XModem polynomial 0x1021), seed 0x0000. `pub` for HIL tests.
pub fn crc_ccitt(data: &[u8]) -> u16 {
    let mut crc: u16 = 0x0000;
    for &b in data {
        crc ^= (b as u16) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 {
                (crc << 1) ^ 0x1021
            } else {
                crc << 1
            };
        }
    }
    crc
}

/// Reduce `1234********5678` → `****5678`. PCI: the full PAN must never
/// reach React; we keep only the last 4 digits.
fn mask_to_last_four(pan: String) -> String {
    let digits: String = pan.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() < 4 {
        "****".into()
    } else {
        format!("****{}", &digits[digits.len() - 4..])
    }
}

/// Independently validate + decode the amount from a `06 01` authorisation
/// frame produced by [`build_authorisation_frame`]. Used by the HIL test server
/// and the mock self-check — it re-derives everything (header, the 0x04 6-byte
/// BCD amount TLV, and the trailing CRC-CCITT) so it catches a builder
/// regression instead of rubber-stamping it. Returns the decoded cents, or a
/// human-readable description of the first protocol violation.
pub fn parse_auth_frame_amount(frame: &[u8]) -> Result<u64, String> {
    if frame.len() < 5 {
        return Err(format!("frame too short: {}b", frame.len()));
    }
    if frame[0] != 0x06 {
        return Err(format!("bad CLASS {:#04x} (want 0x06)", frame[0]));
    }
    if frame[1] != 0x01 {
        return Err(format!("bad INS {:#04x} (want 0x01)", frame[1]));
    }
    let declared = frame[2] as usize;
    // Layout: [06][01][LEN][..payload(LEN)..][crc_lo][crc_hi]
    if frame.len() != 3 + declared + 2 {
        return Err(format!(
            "length mismatch: header declares {declared}b payload, frame carries {}b",
            frame.len().saturating_sub(5)
        ));
    }
    let body = &frame[..frame.len() - 2];
    let got_crc = u16::from(frame[frame.len() - 2]) | (u16::from(frame[frame.len() - 1]) << 8);
    let want_crc = crc_ccitt(body);
    if got_crc != want_crc {
        return Err(format!(
            "CRC mismatch: got {got_crc:#06x}, want {want_crc:#06x}"
        ));
    }
    // Scan the payload TLVs (after the 3-byte header) for the amount tag 0x04.
    let payload = &frame[3..3 + declared];
    let mut i = 0;
    while i + 2 <= payload.len() {
        let tag = payload[i];
        let len = payload[i + 1] as usize;
        if i + 2 + len > payload.len() {
            return Err("truncated TLV in payload".into());
        }
        if tag == 0x04 {
            let val = &payload[i + 2..i + 2 + len];
            if val.len() != 6 {
                return Err(format!("amount TLV is {}b BCD (want 6)", val.len()));
            }
            return Ok(bcd_to_u64(val));
        }
        i += 2 + len;
    }
    Err("amount TLV (tag 0x04) not found".into())
}

/// Decode big-endian packed BCD into an integer (inverse of `bcd_amount`).
fn bcd_to_u64(bcd: &[u8]) -> u64 {
    let mut n = 0u64;
    for &b in bcd {
        n = n * 100 + u64::from((b >> 4) * 10 + (b & 0x0F));
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Published CRC-CCITT/XMODEM check value for "123456789" is 0x31C3.
    /// Pins our `crc_ccitt` against an INDEPENDENT reference vector (not the
    /// builder), so a CRC regression can't hide.
    #[test]
    fn crc_ccitt_matches_xmodem_reference_vector() {
        assert_eq!(crc_ccitt(b"123456789"), 0x31C3);
    }

    #[test]
    fn auth_frame_has_correct_header_and_bcd_amount() {
        let frame = build_authorisation_frame(12_345);
        // [CLASS 06][INS 01][LEN 0x0B][04 06 <000000012345 BCD>][cur 49 09 78][crc lo hi]
        assert_eq!(
            &frame[..14],
            &[0x06, 0x01, 0x0B, 0x04, 0x06, 0x00, 0x00, 0x00, 0x01, 0x23, 0x45, 0x49, 0x09, 0x78]
        );
        let crc = crc_ccitt(&frame[..14]);
        assert_eq!(frame[14], (crc & 0xFF) as u8);
        assert_eq!(frame[15], ((crc >> 8) & 0xFF) as u8);
    }

    #[test]
    fn independent_decoder_roundtrips_amounts() {
        for cents in [1u64, 99, 100, 12_345, 999_999_999_999] {
            let frame = build_authorisation_frame(cents);
            assert_eq!(parse_auth_frame_amount(&frame), Ok(cents), "cents={cents}");
        }
    }

    #[test]
    fn decoder_rejects_corrupted_crc() {
        let mut frame = build_authorisation_frame(5_000);
        let last = frame.len() - 1;
        frame[last] ^= 0xFF; // corrupt the CRC high byte
        assert!(parse_auth_frame_amount(&frame).unwrap_err().contains("CRC"));
    }

    /// mock-vs-real PARITY: the hardened mock builds its on-wire frame via the
    /// SAME canonical builder, so the two cannot drift apart.
    #[test]
    fn mock_and_real_agree_on_the_frame() {
        for cents in [1u64, 4_200, 12_345] {
            assert_eq!(
                crate::mock::zvt_mock::authorisation_frame_for_test(cents),
                build_authorisation_frame(cents),
                "cents={cents}"
            );
        }
    }

    // ── Response-parser golden fixtures ─────────────────────────────────────
    // Spec-accurate ZVT 04 0F / 06 1E / 80 00 APDUs hand-transcribed from the
    // ZVT 13.13 bitmap table (cross-checked against the ecrterm reference impl:
    // result-code BMP 0x27 = 1 byte; amount 0x04 = 6 BCD; currency 0x49 = 2 BCD;
    // trace 0x0B = 3 BCD; receipt-no 0x87 = 2 BCD; card-type 0x8A = 1 byte;
    // card-name 0x8B = LLVAR; PAN 0x22 = LLVAR packed-BCD with 0xE = masked;
    // additional-text 0x3C = LLLVAR). These are NOT shaped to the parser — they
    // are the bytes a spec-conformant terminal emits.

    /// Approved authorisation with masked PAN + brand + receipt text.
    const APPROVED_0F: &[u8] = &[
        0x04, 0x0F, 0x35, // Status-Information APDU; 53-byte BMP block
        0x27, 0x00, // BMP 27 result-code = 00 (approved)
        0x04, 0x00, 0x00, 0x00, 0x01, 0x23, 0x45, // BMP 04 amount 123.45 (6 BCD)
        0x49, 0x09, 0x78, // BMP 49 currency EUR 978 (2 BCD)
        0x0B, 0x00, 0x12, 0x34, // BMP 0B trace-number (3 BCD)
        0x87, 0x00, 0x42, // BMP 87 receipt-number 0042 (2 BCD) — reversal ref
        0x8A, 0x05, // BMP 8A card-type id
        0x8B, 0xF0, 0xF4, 0x56, 0x49, 0x53, 0x41, // BMP 8B card-name "VISA" (LLVAR, len 4)
        0x22, 0xF0, 0xF8, 0x45, 0x73, 0x02, 0xEE, 0xEE, 0xEE, 0x12,
        0x34, // BMP 22 PAN 457302******1234 (LLVAR, len 8; 0xE=masked)
        0x3C, 0xF0, 0xF1, 0xF0, 0x5A, 0x61, 0x68, 0x6C, 0x75, 0x6E, 0x67, 0x20, 0x4F,
        0x4B, // BMP 3C additional-text "Zahlung OK" (LLLVAR, len 10)
    ];

    /// Declined authorisation: result-code 0x6C (Abbruch) + amount.
    const DECLINED_0F: &[u8] = &[
        0x04, 0x0F, 0x09, // 9-byte BMP block
        0x27, 0x6C, // BMP 27 result-code = 6C (declined)
        0x04, 0x00, 0x00, 0x00, 0x00, 0x12, 0x34, // BMP 04 amount (6 BCD)
    ];

    /// Abort APDU 06 1E with result-code 0x6F (Karte ungültig).
    const ABORT_1E: &[u8] = &[0x06, 0x1E, 0x01, 0x6F];

    #[test]
    fn parses_approved_status_information() {
        let r = parse_authorisation_response(APPROVED_0F).expect("approved parses");
        assert!(r.success);
        assert_eq!(r.authorization_code.as_deref(), Some("0042")); // receipt-no
        assert_eq!(r.card_pan_masked.as_deref(), Some("****1234")); // last 4 only
        assert_eq!(r.card_brand.as_deref(), Some("VISA"));
        assert_eq!(r.receipt_text.as_deref(), Some("Zahlung OK"));
    }

    #[test]
    fn check_amount_rejects_zero_and_over_bcd() {
        assert!(check_amount(0).is_err(), "zero amount rejected");
        assert!(
            check_amount(MAX_BCD_CENTS + 1).is_err(),
            "over-BCD amount rejected"
        );
        // The boundary and any normal amount frame cleanly.
        assert!(check_amount(MAX_BCD_CENTS).is_ok());
        assert!(check_amount(1).is_ok());
        assert!(check_amount(12_345).is_ok());
    }

    #[test]
    fn reversal_reads_success_and_abort_via_the_shared_parser() {
        // A reversal (06 30) is interpreted by the SAME parser the authorize loop
        // uses (run_zvt_conversation): an approved Status-Information means the
        // Storno confirmed…
        assert!(parse_authorisation_response(APPROVED_0F).unwrap().success);
        // …and an Abort (06 1E) means it did NOT — no more raw buf[6]/buf[7].
        assert!(!parse_authorisation_response(ABORT_1E).unwrap().success);
    }

    #[test]
    fn parses_declined_status_information() {
        let r = parse_authorisation_response(DECLINED_0F).expect("decline is Ok(success=false)");
        assert!(!r.success);
        let msg = r.error_message.unwrap();
        assert!(msg.contains("0x6C"), "{msg}");
    }

    #[test]
    fn parses_abort_apdu() {
        let r = parse_authorisation_response(ABORT_1E).expect("abort is Ok(success=false)");
        assert!(!r.success);
        assert!(r.error_message.unwrap().contains("ungültig"));
    }

    #[test]
    fn bare_ack_is_not_a_result() {
        // 80 00 = positive ACK only; the Status-Information comes separately.
        let err = parse_authorisation_response(&[0x80, 0x00]).unwrap_err();
        assert!(matches!(err, HardwareError::Device(_)));
    }

    #[test]
    fn llvar_length_uses_value_bytes_not_digits() {
        // BMP 0x8B "MAESTRO" (7 chars) → length F0 F7, then 7 ASCII bytes.
        let frame = [
            0x04, 0x0F, 0x0C, 0x27, 0x00, 0x8B, 0xF0, 0xF7, b'M', b'A', b'E', b'S', b'T', b'R',
            b'O',
        ];
        let r = parse_authorisation_response(&frame).unwrap();
        assert_eq!(r.card_brand.as_deref(), Some("MAESTRO"));
    }

    #[test]
    fn masked_pan_skips_f_padding_for_odd_digit_counts() {
        // 5 digits "12345" packed-BCD with trailing 0xF padding → nibbles
        // 1 2 3 4 5 F → "12345"; last-four masking keeps the real digits.
        assert_eq!(decode_masked_pan(&[0x12, 0x34, 0x5F]), "12345");
    }
}

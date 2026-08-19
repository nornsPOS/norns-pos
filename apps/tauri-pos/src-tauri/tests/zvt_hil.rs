//! Hardware-in-the-loop: ZVT card-terminal authorisation over a REAL TCP socket.
//!
//! NO FACADE. These tests drive the production command `zvt_authorize_payment`
//! (mock mode OFF) against an in-repo TCP server that VALIDATES the on-wire
//! bytes against the ZVT spec before answering:
//!   - byte0 == 0x06 (CLASS), byte1 == 0x01 (INS, Authorisation)
//!   - the 0x04 amount TLV is a 6-byte BCD == the cents we asked to charge
//!   - the trailing CRC-CCITT is valid over the frame body
//!
//! and then conducts the FULL ZVT authorisation conversation (grounded in
//! ecrterm / ZVT 13.13): `80 00` command-ACK → `04 FF` intermediate-status →
//! `04 0F` Status-Information → `06 0F` Completion (or `06 1E` Abort), reading
//! the ECR's `80 00` ACK after each terminal message. Error paths: a peer that
//! drops after the ACK, and a terminal that goes silent mid-flow (→ timeout).
//!
//! Env (`NORNS_MOCK_HARDWARE`, `NORNS_ZVT_READ_TIMEOUT_MS`) is
//! process-global, so every test holds `SERIAL` for its whole body.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex as AsyncMutex;

use norns_pos_lib::commands::zvt::{parse_auth_frame_amount, zvt_authorize_payment, ZvtEndpoint};
use norns_pos_lib::error::HardwareError;

static SERIAL: AsyncMutex<()> = AsyncMutex::const_new(());

#[derive(Clone, Copy)]
enum Mode {
    Approved,
    Declined,
    Abort,
    /// Drop the connection right after ACKing the command.
    EofAfterAck,
    /// ACK + one intermediate status, then go silent (→ ECR read timeout).
    TimeoutMidFlow,
}

/// What the server actually received off the wire, for ground-truth assertions.
struct Captured {
    frame: Vec<u8>,
    decoded: Result<u64, String>,
}

// ── Spec-accurate ZVT response builders (ZVT 13.13 bitmap table) ────────────
// These emit what a real terminal sends — NOT bytes shaped to the parser.
// LLVAR/LLLVAR length is the `Fx Fy` (digit-per-byte) prefix; value length is
// in BYTES. BMP ids per the bitmap table: 27 result, 87 receipt-no, 8B
// card-name, 22 PAN (packed BCD, 0xE = masked), 3C additional-text.

fn llvar(tag: u8, val: &[u8]) -> Vec<u8> {
    let l = val.len();
    let mut v = vec![tag, 0xF0 | (l / 10) as u8, 0xF0 | (l % 10) as u8];
    v.extend_from_slice(val);
    v
}

fn lllvar(tag: u8, val: &[u8]) -> Vec<u8> {
    let l = val.len();
    let mut v = vec![
        tag,
        0xF0 | (l / 100) as u8,
        0xF0 | (l / 10 % 10) as u8,
        0xF0 | (l % 10) as u8,
    ];
    v.extend_from_slice(val);
    v
}

/// Wrap BMP fields in a `04 0F` Status-Information APDU with the real length byte.
fn status_info(bmps: &[Vec<u8>]) -> Vec<u8> {
    let block: Vec<u8> = bmps.iter().flatten().copied().collect();
    let mut frame = vec![0x04, 0x0F, block.len() as u8];
    frame.extend(block);
    frame
}

/// Approved auth with masked PAN (last 4 = 5678), brand VISA, receipt-no 0042,
/// and a receipt-text line — each in its real BMP.
fn approved_response() -> Vec<u8> {
    status_info(&[
        vec![0x27, 0x00],       // result-code = approved
        vec![0x87, 0x00, 0x42], // receipt-number 0042 (BCD)
        llvar(0x8B, b"VISA"),   // card-name / brand
        // PAN as packed BCD, 0xE nibbles = masked → 457302******5678
        llvar(0x22, &[0x45, 0x73, 0x02, 0xEE, 0xEE, 0xEE, 0x56, 0x78]),
        lllvar(0x3C, b"Zahlung genehmigt"), // additional-text
    ])
}

/// Declined: result-code BMP 0x27 = 0x6C (Abbruch).
fn declined_response() -> Vec<u8> {
    status_info(&[
        vec![0x27, 0x6C],
        vec![0x04, 0x00, 0x00, 0x00, 0x00, 0x12, 0x34],
    ])
}

/// Abort APDU 06 1E with result-code 0x6F (Karte ungültig).
fn abort_response() -> Vec<u8> {
    vec![0x06, 0x1E, 0x01, 0x6F]
}

/// Read the ECR's `06 01` request frame: header [06 01 LEN] + LEN payload bytes
/// + 2 CRC bytes.
async fn read_request(sock: &mut tokio::net::TcpStream) -> Vec<u8> {
    let mut head = [0u8; 3];
    if sock.read_exact(&mut head).await.is_err() {
        return Vec::new();
    }
    let mut rest = vec![0u8; head[2] as usize + 2]; // payload + CRC
    let _ = sock.read_exact(&mut rest).await;
    let mut frame = head.to_vec();
    frame.extend_from_slice(&rest);
    frame
}

/// Consume one ECR `80 00 00` ACK (best-effort — the final one may race teardown).
async fn read_ecr_ack(sock: &mut tokio::net::TcpStream) {
    let mut ack = [0u8; 3];
    let _ = sock.read_exact(&mut ack).await;
}

async fn send(sock: &mut tokio::net::TcpStream, bytes: &[u8]) {
    let _ = sock.write_all(bytes).await;
    let _ = sock.flush().await;
}

// Minimal terminal APDUs: 04 FF intermediate-status (len 0) and 06 0F Completion.
const INTERMEDIATE_STATUS: &[u8] = &[0x04, 0xFF, 0x00];
const COMPLETION: &[u8] = &[0x06, 0x0F, 0x00];
const COMMAND_ACK: &[u8] = &[0x80, 0x00, 0x00];

async fn spawn_server(mode: Mode) -> (SocketAddr, Arc<Mutex<Option<Captured>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let captured: Arc<Mutex<Option<Captured>>> = Arc::new(Mutex::new(None));
    let cap = captured.clone();
    tokio::spawn(async move {
        if let Ok((mut sock, _)) = listener.accept().await {
            // 1. Receive + validate the 06 01 authorisation request.
            let frame = read_request(&mut sock).await;
            let decoded = parse_auth_frame_amount(&frame);
            *cap.lock().unwrap() = Some(Captured { frame, decoded });

            // 2. ACK the command (terminal → ECR; the ECR does NOT ACK this).
            send(&mut sock, COMMAND_ACK).await;

            // 3. Conduct the rest of the conversation; read the ECR ACK that
            //    follows each terminal message.
            match mode {
                Mode::Approved => {
                    send(&mut sock, INTERMEDIATE_STATUS).await;
                    read_ecr_ack(&mut sock).await;
                    send(&mut sock, &approved_response()).await; // 04 0F status
                    read_ecr_ack(&mut sock).await;
                    send(&mut sock, COMPLETION).await; // 06 0F
                    read_ecr_ack(&mut sock).await;
                }
                Mode::Declined => {
                    send(&mut sock, &declined_response()).await; // 04 0F status (6C)
                    read_ecr_ack(&mut sock).await;
                    send(&mut sock, COMPLETION).await;
                    read_ecr_ack(&mut sock).await;
                }
                Mode::Abort => {
                    send(&mut sock, INTERMEDIATE_STATUS).await;
                    read_ecr_ack(&mut sock).await;
                    send(&mut sock, &abort_response()).await; // 06 1E
                    read_ecr_ack(&mut sock).await;
                }
                Mode::TimeoutMidFlow => {
                    send(&mut sock, INTERMEDIATE_STATUS).await;
                    read_ecr_ack(&mut sock).await;
                    tokio::time::sleep(Duration::from_secs(30)).await; // never send the status
                }
                Mode::EofAfterAck => {
                    drop(sock); // close right after the command-ACK
                }
            }
        }
    });
    (addr, captured)
}

fn endpoint(addr: SocketAddr) -> ZvtEndpoint {
    ZvtEndpoint {
        ip: addr.ip().to_string(),
        port: addr.port(),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn approval_sends_spec_correct_frame_and_parses_completion() {
    let _g = SERIAL.lock().await;
    std::env::set_var("NORNS_MOCK_HARDWARE", "0");
    std::env::set_var("NORNS_ZVT_READ_TIMEOUT_MS", "5000");

    let (addr, captured) = spawn_server(Mode::Approved).await;
    let res = zvt_authorize_payment(endpoint(addr), 12_345)
        .await
        .expect("authorisation should resolve Ok");

    // Parsed completion carries the terminal's data, decoded from real BMPs.
    assert!(res.success, "expected approval, got {res:?}");
    assert_eq!(res.authorization_code.as_deref(), Some("0042")); // BMP 0x87 receipt-no
    assert_eq!(res.card_pan_masked.as_deref(), Some("****5678")); // BMP 0x22, last 4 only
    assert_eq!(res.card_brand.as_deref(), Some("VISA")); // BMP 0x8B
    assert_eq!(res.receipt_text.as_deref(), Some("Zahlung genehmigt")); // BMP 0x3C

    // GROUND TRUTH: the server validated a spec-correct frame carrying 12345.
    let cap = captured
        .lock()
        .unwrap()
        .take()
        .expect("server captured a frame");
    assert_eq!(
        cap.decoded,
        Ok(12_345),
        "server rejected the frame: {:02X?}",
        cap.frame
    );
    assert_eq!(cap.frame[0], 0x06, "CLASS");
    assert_eq!(cap.frame[1], 0x01, "INS auth");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn decline_surfaces_a_clean_unsuccessful_result() {
    let _g = SERIAL.lock().await;
    std::env::set_var("NORNS_MOCK_HARDWARE", "0");
    std::env::set_var("NORNS_ZVT_READ_TIMEOUT_MS", "5000");

    let (addr, captured) = spawn_server(Mode::Declined).await;
    let res = zvt_authorize_payment(endpoint(addr), 4_200)
        .await
        .expect("a decline is still a resolved command, not an Err");

    assert!(!res.success);
    assert!(res.error_message.is_some(), "decline must carry a message");
    assert!(res.authorization_code.is_none());
    // The frame the terminal saw was still spec-correct.
    let cap = captured.lock().unwrap().take().expect("captured");
    assert_eq!(cap.decoded, Ok(4_200));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn abort_apdu_surfaces_a_clean_unsuccessful_result() {
    let _g = SERIAL.lock().await;
    std::env::set_var("NORNS_MOCK_HARDWARE", "0");
    std::env::set_var("NORNS_ZVT_READ_TIMEOUT_MS", "5000");

    let (addr, _cap) = spawn_server(Mode::Abort).await;
    let res = zvt_authorize_payment(endpoint(addr), 700)
        .await
        .expect("an abort (06 1E) resolves to success=false, not Err");
    assert!(!res.success);
    assert!(res.error_message.unwrap().contains("ungültig"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_drop_after_ack_surfaces_a_clean_error_without_panic() {
    let _g = SERIAL.lock().await;
    std::env::set_var("NORNS_MOCK_HARDWARE", "0");
    std::env::set_var("NORNS_ZVT_READ_TIMEOUT_MS", "5000");

    // Terminal ACKs the command then drops → the next APDU read hits EOF.
    let (addr, _cap) = spawn_server(Mode::EofAfterAck).await;
    let err = zvt_authorize_payment(endpoint(addr), 100)
        .await
        .expect_err("a peer that closes mid-conversation must surface an error, not Ok");
    // A clean surfaced error (EOF → LocalIo/Network), never Timeout, never panic.
    assert!(
        matches!(
            err,
            HardwareError::LocalIo(_) | HardwareError::Network(_) | HardwareError::Device(_)
        ),
        "expected a clean connection error, got {err:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn silent_terminal_times_out_cleanly() {
    let _g = SERIAL.lock().await;
    std::env::set_var("NORNS_MOCK_HARDWARE", "0");
    // Shrink the 75 s cardholder read-timeout so the hang path is provable fast.
    std::env::set_var("NORNS_ZVT_READ_TIMEOUT_MS", "700");

    let (addr, _cap) = spawn_server(Mode::TimeoutMidFlow).await;
    let start = Instant::now();
    let err = zvt_authorize_payment(endpoint(addr), 100)
        .await
        .expect_err("a terminal that goes silent mid-flow must time out, not hang forever");
    let elapsed = start.elapsed();

    assert!(
        matches!(err, HardwareError::Timeout(_)),
        "expected Timeout, got {err:?}"
    );
    assert!(
        elapsed < Duration::from_secs(5),
        "timeout hook did not apply (took {elapsed:?})"
    );
}

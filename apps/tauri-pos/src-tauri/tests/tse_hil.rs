//! Hardware-in-the-loop: TSE fiscal signing via the Fiskaly Cloud HTTP API.
//!
//! NO FACADE. These tests drive the production commands `tse_start_transaction`
//! / `tse_finish_transaction` (mock mode OFF) against an in-repo HTTP server
//! that VALIDATES the actual request before answering:
//!   - non-empty `Authorization: Bearer …` and a non-empty TSS-ID in the path
//!   - PUT carries `state: ACTIVE`
//!   - PUT carries `state: FINISHED`, an `amount > 0`, and a
//!     `payment_type ∈ {CASH, NON_CASH}` (am 08.08.2026 gegen /_spec.json)
//!
//! and returns a signature block with a MONOTONIC counter. The empty-config
//! path is asserted against the REAL `validate_config` (NotConfigured).
//!
//! ── ⚠️ DER BEFUND VOM 09.08.2026: DIESE BÜHNE LOG ────────────────────────
//!
//! Bis heute hat sie `PATCH` angenommen und mit einem ERFUNDENEN Signaturblock
//! geantwortet: Zähler als Zahl, Zeiten als RFC-3339-Text, kein öffentlicher
//! Schlüssel, keine Seriennummer, kein `log`. Genau die Form, die der fehler-
//! hafte Aufrufer erwartete. Beide waren miteinander grün, und die ECHTE
//! Schnittstelle wies jeden Beleg ab.
//!
//! Das ist die Hausklasse „Prüfstand macht denselben Fehler": ein falscher
//! Nachbau meldet den Defekt jeden Tag als behoben.
//!
//! Gemessen an `https://kassensichv.fiskaly.com/api/v2/_spec.json`, abgerufen
//! am 09.08.2026:
//!
//!   Pfad `/api/v2/tss/{tss_id}/tx/{tx_id_or_number}`   Verben: GET, PUT
//!                                                      PATCH gibt es NICHT
//!   `signature.counter`   → `BigintCounter`  type=string, format=bigint
//!   `signature.public_key`→ `TssPublicKey`   type=string     PFLICHT
//!   `time_start`/`time_end` → `Timestamp`    type=integer, Unix-Sekunden
//!   `log.timestamp`         → `Timestamp`    type=integer    PFLICHT
//!   `log.timestamp_format`  → string                         PFLICHT
//!   `tss_serial_number`     → string                         PFLICHT
//!
//! Diese Bühne spricht ab jetzt GENAU das. Wer den Aufrufer zurückdreht,
//! bekommt einen roten Lauf statt eines grünen.
//!
//! `NORNS_FISKALY_BASE_URL` + `NORNS_MOCK_HARDWARE` are global, so
//! every test holds `SERIAL` for its whole body. The TseConfig always carries a
//! non-empty api_key + api_secret so the real keychain is never touched.

use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex as AsyncMutex;

use norns_pos_lib::commands::tse::{
    tse_finish_transaction, tse_start_transaction, TseConfig, TseFinishParams, TseStartParams,
};
use norns_pos_lib::error::HardwareError;

static SERIAL: AsyncMutex<()> = AsyncMutex::const_new(());

#[derive(Default)]
struct State {
    sig_counter: AtomicU64,
    tx_number: AtomicU64,
    /// Last finish's (amount, payment_type) — ground truth for assertions.
    last_finish: Mutex<Option<(String, String)>>,
    /// Wenn gesetzt, antwortet die Bühne mit 200, lässt aber
    /// `signature.counter` weg. Damit lässt sich messen, dass die Kasse in
    /// diesem Fall NICHTS erfindet.
    zaehler_weglassen: std::sync::atomic::AtomicBool,
}

fn header_value<'a>(headers: &'a str, name: &str) -> Option<&'a str> {
    headers.lines().find_map(|l| {
        let (k, v) = l.split_once(':')?;
        if k.trim().eq_ignore_ascii_case(name) {
            Some(v.trim())
        } else {
            None
        }
    })
}

fn find_subslice(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

/// Validate one request and produce `(status_line, json_body)`.
/// Das einzige Token, das dieser Server akzeptiert. Es sieht bewusst wie
/// ein JWT aus, damit ein Vertauschen mit dem Schluessel sofort auffaellt.
const TESTTOKEN: &str = "eyJhbGciOiJSUzI1NiJ9.testtoken.signatur";

fn route(headers: &str, body: &[u8], state: &State) -> (&'static str, String) {
    let mut lines = headers.lines();
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("");

    // ── Die Anmeldung, so streng wie das echte fiskaly ────────────────────
    //
    // Frueher akzeptierte dieser Server JEDEN nicht leeren Bearer. Damit war
    // der Test blind fuer genau den Fehler, der monatelang in der Produktion
    // stand: die Kasse schickte den API-SCHLUESSEL statt eines Tokens, und
    // das echte fiskaly antwortete darauf mit 401 "could not parse jwt".
    // Ein gruener Test bei kaputter Anmeldung ist schlimmer als kein Test.
    //
    // Darum bedient dieser Server jetzt /auth und verlangt danach GENAU das
    // Token, das er selbst ausgegeben hat.
    if path.ends_with("/auth") && method == "POST" {
        let json: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
        let key = json.get("api_key").and_then(Value::as_str).unwrap_or("");
        let secret = json.get("api_secret").and_then(Value::as_str).unwrap_or("");
        if key.is_empty() || secret.is_empty() {
            return (
                "401 Unauthorized",
                r#"{"error":"key or secret missing"}"#.into(),
            );
        }
        // Ablauf weit in der Zukunft, damit der Zwischenspeicher greift.
        let expires_at = chrono::Utc::now().timestamp() + 86_400;
        return (
            "200 OK",
            format!(
                r#"{{"access_token":"{TESTTOKEN}","access_token_expires_at":{expires_at},"access_token_expires_in":86400}}"#
            ),
        );
    }

    // Ab hier: NUR das ausgegebene Token wird akzeptiert. Der rohe Schluessel
    // wird ausdruecklich abgelehnt, genau wie beim echten Anbieter.
    let bearer = header_value(headers, "authorization")
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|t| t.trim().to_string())
        .unwrap_or_default();
    if bearer != TESTTOKEN {
        return (
            "401 Unauthorized",
            format!(r#"{{"error":"could not parse jwt: '{bearer}'"}}"#),
        );
    }

    // Path: /tss/{tss}/tx/{tx} with a non-empty tss.
    let segs: Vec<&str> = path.split('/').collect();
    let tss = segs.get(2).copied().unwrap_or("");
    let tx = segs.get(4).copied().unwrap_or("");
    if tss.is_empty() {
        return ("400 Bad Request", r#"{"error":"empty tss id"}"#.into());
    }

    let json: Value = serde_json::from_slice(body).unwrap_or(Value::Null);

    match method {
        // ⚠️ EIN Verb für beide Zustände. Die echte Schnittstelle kennt an
        // diesem Pfad nur GET und PUT; der Zustand steht im Rumpf.
        "PUT" if json.get("state").and_then(Value::as_str) == Some("ACTIVE") => {
            ("200 OK", format!(r#"{{"_id":"fiskaly-tx-{tx}"}}"#))
        }
        "PUT" => {
            if json.get("state").and_then(Value::as_str) != Some("FINISHED") {
                return (
                    "400 Bad Request",
                    r#"{"error":"state must be ACTIVE or FINISHED"}"#.into(),
                );
            }
            let leg = json
                .pointer("/schema/standard_v1/receipt/amounts_per_payment_type/0")
                .cloned()
                .unwrap_or(Value::Null);
            let payment_type = leg
                .get("payment_type")
                .and_then(Value::as_str)
                .unwrap_or("");
            let amount = leg.get("amount").and_then(Value::as_str).unwrap_or("");
            // ⚠️ Stand hier bis zum 08.08.2026 als Bar/Unbar. Dieser Nachbau
            // hat damit dasselbe falsche Vokabular verlangt wie der Aufrufer,
            // und beide waren miteinander gruen, waehrend die echte
            // Schnittstelle jeden Beleg abwies.
            if payment_type != "CASH" && payment_type != "NON_CASH" {
                return (
                    "400 Bad Request",
                    format!(r#"{{"error":"bad payment_type {payment_type}"}}"#),
                );
            }
            if amount.parse::<f64>().map(|a| a > 0.0) != Ok(true) {
                return (
                    "400 Bad Request",
                    format!(r#"{{"error":"amount not > 0: {amount}"}}"#),
                );
            }
            *state.last_finish.lock().unwrap() =
                Some((amount.to_string(), payment_type.to_string()));
            let counter = state.sig_counter.fetch_add(1, Ordering::SeqCst) + 1;
            let number = state.tx_number.fetch_add(1, Ordering::SeqCst) + 1;
            if state.zaehler_weglassen.load(Ordering::SeqCst) {
                // 200, aber ohne `signature.counter`. Der Aufrufer darf daraus
                // KEINE Signatur machen.
                return (
                    "200 OK",
                    format!(
                        r#"{{"number":{number},"time_start":1780488000,"time_end":1780488002,"tss_serial_number":"TSS-SERIAL-PRUEFSTAND","qr_code_data":"DE-TSE-QR","signature":{{"value":"c2lnLXt9","algorithm":"ecdsa-plain-SHA256","public_key":"BFAKEPUBKEYc3RhbmRhcmQ="}}}}"#
                    ),
                );
            }
            /*
             * ⚠️ GENAU die Form der Norm, nicht die bequeme.
             *
             *   counter          NUMMER IN ANFÜHRUNGSZEICHEN  (BigintCounter)
             *   time_start/_end  GANZZAHLEN, Unix-Sekunden    (Timestamp)
             *   public_key       Pflicht, sonst kann der Prüfer nichts nachrechnen
             *   log.timestamp    die Protokollzeit DER TSE, nicht die des Rechners
             *   tss_serial_number Pflicht, wandert nach `tse.csv`
             *
             * Die Sekundenwerte gehören zum 05.06.2026, 12:00:00 und 12:00:02
             * Weltzeit — dieselben Augenblicke wie zuvor, nur ehrlich getippt.
             */
            (
                "200 OK",
                format!(
                    r#"{{"number":{number},"time_start":1780488000,"time_end":1780488002,"tss_serial_number":"TSS-SERIAL-PRUEFSTAND","qr_code_data":"DE-TSE-QR;c={counter}","log":{{"operation":"FinishTransaction","timestamp":1780488002,"timestamp_format":"unixTime"}},"signature":{{"value":"c2lnLXt9","counter":"{counter}","algorithm":"ecdsa-plain-SHA256","public_key":"BFAKEPUBKEYc3RhbmRhcmQ="}}}}"#
                ),
            )
        }
        // ⚠️ PATCH gibt es an diesem Pfad NICHT. Wer es wieder sendet, bekommt
        // dieselbe Antwort wie von fiskaly: abgewiesen.
        _ => ("405 Method Not Allowed", r#"{"error":"method"}"#.into()),
    }
}

async fn spawn_fiskaly(state: Arc<State>) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let (mut sock, _) = match listener.accept().await {
                Ok(c) => c,
                Err(_) => break,
            };
            let st = state.clone();
            tokio::spawn(async move {
                let mut buf = Vec::new();
                let mut tmp = [0u8; 2048];
                // Read headers, then the Content-Length body.
                loop {
                    let n = sock.read(&mut tmp).await.unwrap_or(0);
                    if n == 0 {
                        return;
                    }
                    buf.extend_from_slice(&tmp[..n]);
                    if let Some(pos) = find_subslice(&buf, b"\r\n\r\n") {
                        let head_end = pos + 4;
                        let headers = String::from_utf8_lossy(&buf[..pos]).to_string();
                        let clen = header_value(&headers, "content-length")
                            .and_then(|v| v.parse::<usize>().ok())
                            .unwrap_or(0);
                        while buf.len() < head_end + clen {
                            let n = sock.read(&mut tmp).await.unwrap_or(0);
                            if n == 0 {
                                break;
                            }
                            buf.extend_from_slice(&tmp[..n]);
                        }
                        let body = &buf[head_end..(head_end + clen).min(buf.len())];
                        let (status, json) = route(&headers, body, &st);
                        let resp = format!(
                            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{json}",
                            json.len()
                        );
                        let _ = sock.write_all(resp.as_bytes()).await;
                        let _ = sock.flush().await;
                        return;
                    }
                }
            });
        }
    });
    addr
}

fn cfg(tss_id: &str) -> TseConfig {
    TseConfig {
        tss_id: tss_id.to_string(),
        client_id: "client-1".into(),
        // Non-empty so hydrate_secrets_from_keyring never reads the OS keychain.
        api_key: "test-bearer-key".into(),
        api_secret: "test-secret".into(),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn start_then_finish_carries_correct_amount_and_payment_type() {
    let _g = SERIAL.lock().await;
    let state = Arc::new(State::default());
    let addr = spawn_fiskaly(state.clone()).await;
    std::env::set_var("NORNS_MOCK_HARDWARE", "0");
    std::env::set_var("NORNS_FISKALY_BASE_URL", format!("http://{addr}"));

    let intention = tse_start_transaction(TseStartParams {
        config: cfg("tss-1"),
        intention_id: "intent-1".into(),
        process_type: "Kassenbeleg-V1".into(),
    })
    .await
    .expect("start should open an intention");
    assert_eq!(intention.fiskaly_transaction_id, "fiskaly-tx-intent-1");

    let sig = tse_finish_transaction(TseFinishParams {
        config: cfg("tss-1"),
        intention_id: "intent-1".into(),
        fiskaly_transaction_id: intention.fiskaly_transaction_id.clone(),
        amount_cents: 12_345,
        payment_kind: "CASH".into(),
        process_data_base64: String::new(),
        process_type: "Kassenbeleg-V1".into(),
        receipt_type: "RECEIPT".into(),
        amounts_per_vat_rate: Vec::new(),
    })
    .await
    .expect("finish should sign");

    assert_eq!(sig.signature_algorithm, "ecdsa-plain-SHA256");
    assert!(sig.signature_counter >= 1);
    assert!(sig.transaction_number >= 1);
    assert!(sig.qr_code_payload.contains("DE-TSE-QR"));

    // GROUND TRUTH: the request actually carried 123.45 / CASH.
    let (amount, payment_type) = state.last_finish.lock().unwrap().clone().expect("a finish");
    assert_eq!(amount, "123.45", "format_cents(12345) must be 123.45");
    assert_eq!(payment_type, "CASH");

    /*
     * ════════════════════════════════════════════════════════════════════
     *  ⛔ DIE DREI SÄTZE, DIE DEN BEFUND VOM 09.08.2026 GEFANGEN HÄTTEN
     * ════════════════════════════════════════════════════════════════════
     *
     * Die Prüfungen darüber messen nur „grösser als null" und „wächst".
     * Genau damit blieb der Lauf grün, während der Zähler 0 gewesen wäre
     * und die Protokollzeit von der Uhr des Kassenrechners kam.
     *
     * Hier steht der EXAKTE Wert, den die Bühne gesendet hat. Ein Ersatz-
     * wert kann diese Sätze nicht bestehen.
     */

    // 1. ZÄHLER: kam als Zeichenkette `"1"`. `as_u64()` gäbe hier 0.
    assert_eq!(
        sig.signature_counter, 1,
        "der Zaehler kommt als ZEICHENKETTE; wird er als Zahl gelesen, steht hier 0"
    );

    // 2. ZEIT: 1780488000/2 sind die Sekunden der TSE, NICHT die Uhr dieses
    //    Rechners. Ein `unwrap_or_else(Utc::now)` fiele hier sofort auf.
    assert_eq!(
        sig.started_at.timestamp(),
        1_780_488_000,
        "TSE_TA_START stammt nicht aus der Antwort, sondern von der eigenen Uhr"
    );
    assert_eq!(
        sig.finished_at.timestamp(),
        1_780_488_002,
        "TSE_TA_ENDE stammt nicht aus der Antwort, sondern von der eigenen Uhr"
    );

    // 3. NACHRECHENBARKEIT: ohne diese beiden kann ein Prüfer die Signatur
    //    nicht nachrechnen, und `tse.csv` bliebe leer.
    assert_eq!(sig.signature_public_key, "BFAKEPUBKEYc3RhbmRhcmQ=");
    assert_eq!(sig.tss_serial_number, "TSS-SERIAL-PRUEFSTAND");
}

/// ⛔ Fehlt ein Pflichtfeld, wird NICHTS erfunden.
///
/// Der gefährlichste Weg wäre: die Antwort kommt an, ein Feld fehlt, und die
/// Kasse setzt einen Ersatzwert ein. Dann trüge ein Beleg eine Signaturangabe,
/// die es nie gab. Hier wird gemessen, dass stattdessen ein Gerätefehler
/// entsteht — den behandelt der Aufrufer als TSE-Ausfall und vermerkt ihn.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn missing_mandatory_field_becomes_an_error_not_an_invented_value() {
    let _g = SERIAL.lock().await;
    let state = Arc::new(State::default());
    // Diese Bühne antwortet mit 200, lässt aber `signature.counter` weg.
    state.zaehler_weglassen.store(true, Ordering::SeqCst);
    let addr = spawn_fiskaly(state.clone()).await;
    std::env::set_var("NORNS_MOCK_HARDWARE", "0");
    std::env::set_var("NORNS_FISKALY_BASE_URL", format!("http://{addr}"));

    let intention = tse_start_transaction(TseStartParams {
        config: cfg("tss-1"),
        intention_id: "intent-ohne-zaehler".into(),
        process_type: "Kassenbeleg-V1".into(),
    })
    .await
    .expect("start should work");

    let ergebnis = tse_finish_transaction(TseFinishParams {
        config: cfg("tss-1"),
        intention_id: "intent-ohne-zaehler".into(),
        fiskaly_transaction_id: intention.fiskaly_transaction_id.clone(),
        amount_cents: 12_345,
        payment_kind: "CASH".into(),
        process_data_base64: String::new(),
        process_type: "Kassenbeleg-V1".into(),
        receipt_type: "RECEIPT".into(),
        amounts_per_vat_rate: Vec::new(),
    })
    .await;

    let fehler = ergebnis.expect_err("eine Antwort ohne Zaehler darf NICHT als Signatur gelten");
    let text = format!("{fehler:?}");
    assert!(
        text.contains("signature.counter"),
        "die Meldung nennt die Stelle nicht: {text}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn signature_counter_is_monotonic_across_two_sales() {
    let _g = SERIAL.lock().await;
    let state = Arc::new(State::default());
    let addr = spawn_fiskaly(state.clone()).await;
    std::env::set_var("NORNS_MOCK_HARDWARE", "0");
    std::env::set_var("NORNS_FISKALY_BASE_URL", format!("http://{addr}"));

    let mk = |id: &str| TseFinishParams {
        config: cfg("tss-1"),
        intention_id: id.into(),
        fiskaly_transaction_id: format!("fiskaly-tx-{id}"),
        amount_cents: 5_000,
        payment_kind: "NON_CASH".into(),
        process_data_base64: String::new(),
        process_type: "Kassenbeleg-V1".into(),
        receipt_type: "RECEIPT".into(),
        amounts_per_vat_rate: Vec::new(),
    };

    let first = tse_finish_transaction(mk("a")).await.expect("sign a");
    let second = tse_finish_transaction(mk("b")).await.expect("sign b");
    assert!(
        second.signature_counter > first.signature_counter,
        "counter must advance: {} !> {}",
        second.signature_counter,
        first.signature_counter
    );
    assert!(second.transaction_number > first.transaction_number);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn empty_tss_id_is_rejected_as_not_configured() {
    let _g = SERIAL.lock().await;
    std::env::set_var("NORNS_MOCK_HARDWARE", "0");
    std::env::set_var("NORNS_FISKALY_BASE_URL", "http://127.0.0.1:1"); // never reached

    let err = tse_start_transaction(TseStartParams {
        config: cfg(""), // empty TSS-ID
        intention_id: "intent-x".into(),
        process_type: "Kassenbeleg-V1".into(),
    })
    .await
    .expect_err("empty config must NOT silently sign");
    assert!(
        matches!(err, HardwareError::NotConfigured(_)),
        "expected NotConfigured, got {err:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn server_rejected_request_surfaces_as_device_error() {
    let _g = SERIAL.lock().await;
    let state = Arc::new(State::default());
    let addr = spawn_fiskaly(state.clone()).await;
    std::env::set_var("NORNS_MOCK_HARDWARE", "0");
    std::env::set_var("NORNS_FISKALY_BASE_URL", format!("http://{addr}"));

    // payment_kind the TSE doesn't recognise → server 400 → command Device error.
    let err = tse_finish_transaction(TseFinishParams {
        config: cfg("tss-1"),
        intention_id: "intent-1".into(),
        fiskaly_transaction_id: "fiskaly-tx-intent-1".into(),
        amount_cents: 100,
        payment_kind: "Krypto".into(),
        process_data_base64: String::new(),
        process_type: "Kassenbeleg-V1".into(),
        receipt_type: "RECEIPT".into(),
        amounts_per_vat_rate: Vec::new(),
    })
    .await
    .expect_err("an out-of-spec payment_type must surface an error");
    assert!(
        matches!(err, HardwareError::Device(_)),
        "expected Device(4xx), got {err:?}"
    );
}

//! ZVT mock — 2-3 s delay, then a plausible auth code + masked PAN. The
//! fail-rate knob (`NORNS_MOCK_FAIL_RATE`) lets us exercise the
//! Bezahlen "Nochmal versuchen" / "Bar zahlen" recovery paths.

use crate::commands::zvt::{
    build_authorisation_frame, check_amount, parse_auth_frame_amount, ZvtEndpoint, ZvtResult,
};
use crate::error::{HardwareError, HwResult};
use crate::mock;

/// Expose the exact frame the mock would put on the wire, for the mock-vs-real
/// parity unit test. It is — by construction — the canonical builder's output.
pub fn authorisation_frame_for_test(amount_cents: u64) -> Vec<u8> {
    build_authorisation_frame(amount_cents)
}

pub async fn check_connection(_endpoint: ZvtEndpoint) -> HwResult<bool> {
    mock::mock_delay(120).await;
    Ok(true)
}

pub async fn authorize_payment(_endpoint: ZvtEndpoint, amount_cents: u64) -> HwResult<ZvtResult> {
    // NO FACADE: catch the SAME input errors a real terminal would BEFORE
    // pretending to authorise, via the SAME shared guard the real authorize path
    // now uses (a 0 amount and an over-6-byte-BCD amount are both rejected).
    check_amount(amount_cents)?;

    // Actually BUILD the on-wire frame the real path would send, and validate
    // it round-trips to this amount — so the mock exercises (and would surface
    // a regression in) the real framing logic instead of blindly returning Ok.
    let frame = build_authorisation_frame(amount_cents);
    match parse_auth_frame_amount(&frame) {
        Ok(decoded) if decoded == amount_cents => {}
        Ok(decoded) => {
            return Err(HardwareError::Device(format!(
                "ZVT mock self-check: frame encodes {decoded}, expected {amount_cents}"
            )));
        }
        Err(e) => {
            return Err(HardwareError::Device(format!(
                "ZVT mock self-check: built frame is not spec-valid: {e}"
            )));
        }
    }

    // Realistic cardholder PIN-entry latency.
    mock::mock_delay(2_400).await;

    // Inject occasional decline so the UI's retry path is exercised.
    if let Err(_e) = mock::maybe_inject_failure("ZVT authorize (mock decline)") {
        return Ok(ZvtResult {
            success: false,
            authorization_code: None,
            card_pan_masked: None,
            card_brand: None,
            receipt_text: None,
            error_message: Some("Karte abgelehnt (Mock)".into()),
        });
    }

    let suffix = fastrand::u32(1000..10_000);
    let auth_hex: String = (0..6)
        .map(|_| format!("{:X}", fastrand::u8(0..16)))
        .collect();

    Ok(ZvtResult {
        success: true,
        authorization_code: Some(format!("MOCK-{auth_hex}")),
        card_pan_masked: Some(format!("****{suffix}")),
        card_brand: Some(["VISA", "MASTERCARD", "GIROCARD"][fastrand::usize(0..3)].to_string()),
        receipt_text: Some(format!(
            "MOCK-TERMINAL\nBetrag: {:.2} EUR\nAUTHORISATION: {auth_hex}",
            amount_cents as f64 / 100.0,
        )),
        error_message: None,
    })
}

pub async fn reverse_payment(_endpoint: ZvtEndpoint, _auth: String) -> HwResult<bool> {
    mock::mock_delay(900).await;
    Ok(true)
}

//! TSE mock — deterministic fake signatures so the UI can flow without
//! a real Fiskaly key. Each call increments a process-local counter so
//! repeated mock sales produce a believable sequence.

use std::sync::atomic::{AtomicU64, Ordering};

use chrono::Utc;

use crate::commands::tse::{
    TseConfig, TseFinishParams, TseIntention, TseSignature, TseStartParams, TseStatus,
};
use crate::error::{HardwareError, HwResult};
use crate::mock;

static MOCK_COUNTER: AtomicU64 = AtomicU64::new(1);
static MOCK_TX_NUMBER: AtomicU64 = AtomicU64::new(1);

/// NO FACADE: the mock must reject the SAME misconfiguration the real Fiskaly
/// path rejects in `commands::tse::validate_config`. Otherwise a no-credentials
/// operator gets a fabricated signature in dev/mock and only discovers the gap
/// on the first REAL sale at go-live. Mirrors the real check exactly.
fn validate_mock_config(cfg: &TseConfig) -> HwResult<()> {
    if cfg.tss_id.is_empty() || cfg.api_key.is_empty() {
        return Err(HardwareError::NotConfigured(
            "TSE: TSS-ID oder API-Key fehlt".into(),
        ));
    }
    Ok(())
}

pub async fn start_transaction(params: TseStartParams) -> HwResult<TseIntention> {
    validate_mock_config(&params.config)?;
    mock::mock_delay(450).await;
    mock::maybe_inject_failure("TSE start_transaction (mock)")?;

    Ok(TseIntention {
        intention_id: params.intention_id.clone(),
        fiskaly_transaction_id: format!("MOCK-TX-{}", params.intention_id),
        started_at: Utc::now(),
    })
}

pub async fn finish_transaction(params: TseFinishParams) -> HwResult<TseSignature> {
    validate_mock_config(&params.config)?;
    // ⚠️ DIE ATTRAPPE WAR MILDER ALS DAS ORIGINAL, UND DAS WAR DER SCHADEN.
    //
    // Sie prüfte nur den Betrag und liess das Vokabular „Bar" / „Unbar" durch,
    // das die echte Schnittstelle nicht kennt. Auf jeder Entwicklermaschine
    // war der Weg damit grün, während er in der Wirklichkeit jeden Beleg
    // verlor. Eine Attrappe, die weniger verlangt als das Original, ist
    // schlimmer als gar keine.
    //
    // Sie prüft jetzt jeden Wert gegen die enums der Spezifikation, am
    // 08.08.2026 aus `/_spec.json` gelesen.
    if params.amount_cents == 0 {
        return Err(HardwareError::InvalidArgument(
            "TSE: Betrag 0 kann nicht signiert werden".into(),
        ));
    }
    if params.payment_kind != "CASH" && params.payment_kind != "NON_CASH" {
        return Err(HardwareError::InvalidArgument(format!(
            "TSE: payment_type '{}' ungültig (erwartet CASH|NON_CASH)",
            params.payment_kind
        )));
    }
    const BON_TYPEN: [&str; 10] = [
        "RECEIPT",
        "TRAINING",
        "TRANSFER",
        "ORDER",
        "CANCELLATION",
        "ABORT",
        "BENEFIT_IN_KIND",
        "INVOICE",
        "OTHER",
        "ANNULATION",
    ];
    if !BON_TYPEN.contains(&params.receipt_type.as_str()) {
        return Err(HardwareError::InvalidArgument(format!(
            "TSE: receipt_type '{}' ungültig (erwartet {})",
            params.receipt_type,
            BON_TYPEN.join("|")
        )));
    }
    const SAETZE: [&str; 5] = [
        "NORMAL",
        "REDUCED_1",
        "SPECIAL_RATE_1",
        "SPECIAL_RATE_2",
        "NULL",
    ];
    for eimer in &params.amounts_per_vat_rate {
        if !SAETZE.contains(&eimer.vat_rate.as_str()) {
            return Err(HardwareError::InvalidArgument(format!(
                "TSE: vat_rate '{}' ungültig (erwartet {})",
                eimer.vat_rate,
                SAETZE.join("|")
            )));
        }
    }
    mock::mock_delay(950).await;
    mock::maybe_inject_failure("TSE finish_transaction (mock)")?;

    let counter = MOCK_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tx_number = MOCK_TX_NUMBER.fetch_add(1, Ordering::Relaxed);
    let now = Utc::now();
    let qr_payload = format!(
        "MOCK-QR;tx={};amount={};counter={};kind={}",
        params.fiskaly_transaction_id, params.amount_cents, counter, params.payment_kind
    );

    Ok(TseSignature {
        signature_value: format!("MOCK-SIG-{counter:08x}"),
        signature_counter: counter,
        signature_algorithm: "ecdsa-plain-SHA256".into(),
        /*
         * ⚠️ Auch die Attrappe muss als Attrappe LESBAR sein. Diese beiden
         * Felder wandern in `tse.csv` des Prüfpakets; stünde dort etwas, das
         * wie ein echter Schlüssel und eine echte Seriennummer aussieht, wäre
         * der Auszug im Ernstfall nicht mehr als Muster zu erkennen.
         */
        signature_public_key: "MOCK-PUBLIC-KEY-KEINE-ECHTE-TSE".into(),
        tss_serial_number: "MOCK-TSE-KEINE-ECHTE-SERIENNUMMER".into(),
        transaction_number: tx_number,
        started_at: now - chrono::Duration::seconds(2),
        finished_at: now,
        qr_code_payload: qr_payload,
    })
}

pub async fn status(_config: TseConfig) -> HwResult<TseStatus> {
    mock::mock_delay(180).await;
    Ok(TseStatus {
        rechtsgueltig: false,
        umgebung_adresse: "Attrappe (kein echter Anbieter)".to_string(),
        reachable: true,
        tss_state: Some("INITIALIZED".into()),
        last_checked_at: Utc::now(),
        message: "Mock-TSE aktiv (NORNS_MOCK_HARDWARE=1)".into(),
    })
}

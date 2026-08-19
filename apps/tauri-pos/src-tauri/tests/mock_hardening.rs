//! Proves the MOCK paths (`NORNS_MOCK_HARDWARE=1`) now catch the SAME
//! input/config errors a real device would — so a green mock run no longer
//! hides a misconfiguration that would only blow up on the first real sale.
//! Before this hardening these all returned a fabricated `Ok(...)`.

use norns_pos_lib::commands::tse::{TseConfig, TseFinishParams, TseStartParams};
use norns_pos_lib::commands::zvt::ZvtEndpoint;
use norns_pos_lib::error::HardwareError;
use norns_pos_lib::mock::{tse_mock, zvt_mock};

fn endpoint() -> ZvtEndpoint {
    ZvtEndpoint {
        ip: "127.0.0.1".into(),
        port: 20007,
    }
}

fn full_cfg(tss: &str) -> TseConfig {
    TseConfig {
        tss_id: tss.into(),
        client_id: "c".into(),
        api_key: "k".into(),
        api_secret: "s".into(),
    }
}

fn finish(cfg: TseConfig, amount_cents: i64, payment_kind: &str) -> TseFinishParams {
    TseFinishParams {
        config: cfg,
        intention_id: "i".into(),
        fiskaly_transaction_id: "tx".into(),
        amount_cents,
        payment_kind: payment_kind.into(),
        process_data_base64: String::new(),
        process_type: "Kassenbeleg-V1".into(),
        receipt_type: "RECEIPT".into(),
        amounts_per_vat_rate: Vec::new(),
    }
}

#[tokio::test]
async fn zvt_mock_rejects_zero_amount() {
    let err = zvt_mock::authorize_payment(endpoint(), 0)
        .await
        .expect_err("mock must reject a 0 amount like a real terminal");
    assert!(matches!(err, HardwareError::InvalidArgument(_)), "{err:?}");
}

#[tokio::test]
async fn zvt_mock_rejects_amount_over_bcd_limit() {
    let err = zvt_mock::authorize_payment(endpoint(), 1_000_000_000_000)
        .await
        .expect_err("mock must reject an amount that overflows 6-byte BCD");
    assert!(matches!(err, HardwareError::InvalidArgument(_)), "{err:?}");
}

#[tokio::test]
async fn zvt_mock_valid_amount_reflects_the_real_sum() {
    std::env::set_var("NORNS_MOCK_FAIL_RATE", "0");
    let res = zvt_mock::authorize_payment(endpoint(), 12_345)
        .await
        .expect("a valid amount authorises");
    assert!(res.success);
    // The mock reflects the ACTUAL amount, not a hardcoded value.
    assert!(
        res.receipt_text.as_deref().unwrap_or("").contains("123.45"),
        "receipt must show 123.45, got {:?}",
        res.receipt_text
    );
}

#[tokio::test]
async fn tse_mock_start_rejects_empty_config() {
    let err = tse_mock::start_transaction(TseStartParams {
        config: full_cfg(""), // empty TSS-ID
        intention_id: "i".into(),
        process_type: "Kassenbeleg-V1".into(),
    })
    .await
    .expect_err("no-creds operator must NOT get a fake intention");
    assert!(matches!(err, HardwareError::NotConfigured(_)), "{err:?}");
}

#[tokio::test]
async fn tse_mock_finish_rejects_empty_config() {
    let err = tse_mock::finish_transaction(finish(full_cfg(""), 100, "CASH"))
        .await
        .expect_err("no-creds operator must NOT get a fake signature");
    assert!(matches!(err, HardwareError::NotConfigured(_)), "{err:?}");
}

#[tokio::test]
async fn tse_mock_finish_rejects_zero_amount() {
    let err = tse_mock::finish_transaction(finish(full_cfg("tss-1"), 0, "CASH"))
        .await
        .expect_err("a 0-amount fiscal record must not be signed");
    assert!(matches!(err, HardwareError::InvalidArgument(_)), "{err:?}");
}

#[tokio::test]
async fn tse_mock_finish_rejects_unknown_payment_kind() {
    // ⚠️ "Bar" stand hier bis zum 08.08.2026 als GUELTIG. Am selben Tag gegen
    // die Live-Spezifikation gemessen: "Bar" und "Unbar" kommen darin null Mal
    // vor, das enum lautet CASH / NON_CASH. Die Attrappe liess das alte
    // Vokabular durch und war damit milder als das Original.
    for falsch in ["Karte", "Bar", "Unbar", "cash", ""] {
        let err = tse_mock::finish_transaction(finish(full_cfg("tss-1"), 100, falsch))
            .await
            .unwrap_err();
        assert!(
            matches!(err, HardwareError::InvalidArgument(_)),
            "{falsch}: {err:?}"
        );
    }
}

#[tokio::test]
async fn tse_mock_finish_rejects_unknown_receipt_type() {
    // Der Vorgangstyp gehoert nicht in BON_TYP. Genau dieser Wert stand dort.
    std::env::set_var("NORNS_MOCK_FAIL_RATE", "0");
    let mut p = finish(full_cfg("tss-1"), 100, "CASH");
    p.receipt_type = "Kassenbeleg-V1".into();
    let err = tse_mock::finish_transaction(p).await.unwrap_err();
    assert!(matches!(err, HardwareError::InvalidArgument(_)), "{err:?}");
}

#[tokio::test]
async fn tse_mock_finish_rejects_unknown_vat_rate() {
    std::env::set_var("NORNS_MOCK_FAIL_RATE", "0");
    let mut p = finish(full_cfg("tss-1"), 100, "CASH");
    p.amounts_per_vat_rate = vec![norns_pos_lib::commands::tse::VatAmount {
        vat_rate: "7".into(), // der veraltete Zahlenwert
        amount_cents: 100,
    }];
    let err = tse_mock::finish_transaction(p).await.unwrap_err();
    assert!(matches!(err, HardwareError::InvalidArgument(_)), "{err:?}");
}

#[tokio::test]
async fn tse_mock_finish_signiert_einen_negativen_storno() {
    // Der Storno ist negativ. Als u64 war er nicht darstellbar.
    std::env::set_var("NORNS_MOCK_FAIL_RATE", "0");
    let mut p = finish(full_cfg("tss-1"), -11_900, "CASH");
    p.receipt_type = "ANNULATION".into();
    let sig = tse_mock::finish_transaction(p)
        .await
        .expect("ein Storno muss signieren");
    assert!(sig.signature_counter >= 1);
}

#[tokio::test]
async fn tse_mock_finish_accepts_valid_input() {
    std::env::set_var("NORNS_MOCK_FAIL_RATE", "0");
    let sig = tse_mock::finish_transaction(finish(full_cfg("tss-1"), 9_900, "NON_CASH"))
        .await
        .expect("a fully-configured NON_CASH sale signs");
    assert!(sig.signature_counter >= 1);
    assert!(sig.qr_code_payload.contains("amount=9900"));
}

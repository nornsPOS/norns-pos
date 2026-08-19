//! Printer mocks — both ESC/POS and lpr A4. Just log + sleep; CI will
//! `cat` the bytes if it ever needs to assert on them.

use crate::commands::label::LabelConfig;
use crate::commands::pdf::PrintA4Params;
use crate::commands::thermal::{ThermalEndpoint, ThermalReceiptData};
use crate::error::HwResult;
use crate::mock;

/// Mock reachability probe for the receipt printer — a short delay then
/// "reachable", honouring the fail-rate knob so the auto-connect "nicht
/// erreichbar" path can be exercised in dev.
pub async fn check_connection(ip: &str, port: u16) -> HwResult<bool> {
    mock::mock_delay(120).await;
    if mock::maybe_inject_failure("thermal connection probe (mock)").is_err() {
        return Ok(false);
    }
    eprintln!("norns-pos[mock]: thermal probe → {ip}:{port} reachable");
    Ok(true)
}

/// Mock reachability probe for the label printer (tcp or system mode).
pub async fn check_label(config: &LabelConfig) -> HwResult<bool> {
    mock::mock_delay(120).await;
    if mock::maybe_inject_failure("label connection probe (mock)").is_err() {
        return Ok(false);
    }
    eprintln!(
        "norns-pos[mock]: label probe → {:?}/{} reachable",
        config.printer_type, config.mode,
    );
    Ok(true)
}

pub async fn print_thermal(_endpoint: ThermalEndpoint, data: ThermalReceiptData) -> HwResult<()> {
    mock::mock_delay(650).await;
    mock::maybe_inject_failure("ESC/POS thermal print (mock)")?;
    eprintln!(
        "norns-pos[mock]: thermal print → receipt {} ({} items, total {} EUR)",
        data.receipt_locator,
        data.items.len(),
        data.total_eur,
    );
    Ok(())
}

pub async fn print_a4(params: PrintA4Params) -> HwResult<()> {
    mock::mock_delay(800).await;
    mock::maybe_inject_failure("A4 print (mock)")?;
    eprintln!(
        "norns-pos[mock]: A4 print → {} ({} bytes)",
        params.printer_name,
        params.pdf_bytes.len(),
    );
    Ok(())
}

pub async fn print_label(config: &LabelConfig, count: usize, bytes: &[u8]) -> HwResult<()> {
    mock::mock_delay(400).await;
    mock::maybe_inject_failure("label print (mock)")?;
    eprintln!(
        "norns-pos[mock]: label print → {:?}/{} via {} ({} labels, {} bytes)",
        config.printer_type,
        config.mode,
        config.printer_name.as_deref().unwrap_or("tcp"),
        count,
        bytes.len(),
    );
    Ok(())
}

//! Mock implementations for every hardware command.
//!
//! Selected by `config::is_mock_mode()`. The goal is fidelity, not just
//! "returns Ok(())":
//!
//! - Realistic delays (so the UI shows spinner states)
//! - Random fail injection driven by `NORNS_MOCK_FAIL_RATE`
//! - Deterministic-looking fake data (`MOCK-{counter}`) so an operator
//!   can recognize a mock receipt at a glance
//!
//! Each module mirrors one in `commands/`.

pub mod printer_mock;
pub mod tse_mock;
pub mod zvt_mock;

use crate::config;
use crate::error::HardwareError;

/// Sleeps for `ms` milliseconds — used by every mock to fake hardware
/// latency. Single helper so we can tune all delays in one place.
pub async fn mock_delay(ms: u64) {
    tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
}

/// Returns `Err(HardwareError::Device(reason))` with probability
/// `config::mock_fail_rate()`. Lets us exercise the React error paths.
pub fn maybe_inject_failure(reason: &str) -> Result<(), HardwareError> {
    let rate = config::mock_fail_rate();
    if rate > 0.0 && fastrand::f64() < rate {
        return Err(HardwareError::Device(format!("[mock] {reason}")));
    }
    Ok(())
}

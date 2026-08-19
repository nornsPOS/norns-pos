//! Tauri command barrel.
//!
//! Every submodule owns one slice of native I/O. The naming mirrors the
//! Mandate split from memory.md §18:
//!
//! - `image`   — Mandate 1, WebP compression
//! - `tse`     — Mandate 2-A, Fiskaly Cloud signatures
//! - `zvt`     — Mandate 2-B, card-terminal TCP protocol
//! - `thermal` — Mandate 3-A, ESC/POS receipt printer
//! - `pdf`     — Mandate 3-B, A4 invoice PDF + system-printer dispatch
//! - `system`  — Mandate 4, list OS print queues for the Gerätemanager
//!
//! Each command is `async`, returns `Result<T, HardwareError>`, and starts
//! with an `if config::is_mock_mode()` short-circuit so the dev/CI build
//! never touches real hardware.

pub mod drucker_erkennung;
pub mod druckweg;
pub mod image;
pub mod kyc;
pub mod label;
pub mod pdf;
pub mod scale;
pub mod steuerberater_fragen_pdf;
pub mod system;
pub mod thermal;
pub mod tse;
pub mod usb_geraete;
pub mod verfahrensdoku_pdf;
pub mod warteschlangenlage;
#[cfg(target_os = "windows")]
pub mod win_print;
pub mod zvt;

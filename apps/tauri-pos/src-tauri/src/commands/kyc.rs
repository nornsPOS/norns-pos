//! Epic C — encrypted local KYC vault (GwG / GDPR).
//!
//! Identity documents (Personalausweis / passport scans) for Ankauf are
//! legally required (ADR-0007: Ankauf always records ID) but are also the most
//! privacy-sensitive bytes the shop holds. Uploading them to a public cloud is
//! a liability, so they live encrypted on the till instead:
//!
//!   • AES-256-GCM (authenticated) encryption, fresh random 96-bit nonce/file.
//!   • The 32-byte master key lives ONLY in the OS keyring (macOS Keychain /
//!     Windows Credential Manager / Secret Service) — never on disk, never in
//!     localStorage, never in a settings file.
//!   • Ciphertext files are written under `$APP_DATA/kyc_vault/<uuid>.enc` as
//!     `nonce(12) || ciphertext(+16-byte GCM tag)`.
//!   • Key material is `zeroize`d from our buffers immediately after use.
//!
//! The pure crypto (`encrypt_payload` / `decrypt_payload`) is decoupled from
//! the keyring + filesystem so it is unit-testable without any OS secrets.

use std::path::PathBuf;

use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::Manager;
use zeroize::Zeroize;

use crate::error::{HardwareError, HwResult};

const KEYRING_SERVICE: &str = "warehouse14";
const KEYRING_USER: &str = "master-key";
const NONCE_LEN: usize = 12; // AES-GCM 96-bit nonce
const KEY_LEN: usize = 32; // AES-256

/// Returned to React after a successful encrypt-and-save.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptResult {
    /// Absolute path to the encrypted `.enc` file — store this on the record.
    pub path: String,
    /// Hex SHA-256 of the ORIGINAL (plaintext) bytes — integrity anchor.
    pub sha256: String,
}

// ════════════════════════════════════════════════════════════════════════
// Pure crypto — no keyring, no filesystem (unit-testable)
// ════════════════════════════════════════════════════════════════════════

/// Encrypt `plaintext` under `key` → `nonce(12) || ciphertext+tag`.
fn encrypt_payload(key: &[u8; KEY_LEN], plaintext: &[u8]) -> HwResult<Vec<u8>> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|e| HardwareError::Encoding(format!("aes-gcm encrypt: {e}")))?;
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(nonce.as_slice());
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Inverse of [`encrypt_payload`]. Authentication failure (wrong key / tamper)
/// returns an error rather than garbage — GCM verifies the tag.
fn decrypt_payload(key: &[u8; KEY_LEN], payload: &[u8]) -> HwResult<Vec<u8>> {
    if payload.len() < NONCE_LEN {
        return Err(HardwareError::Encoding(
            "ciphertext shorter than nonce".into(),
        ));
    }
    let (nonce_bytes, ciphertext) = payload.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
        .map_err(|e| HardwareError::Encoding(format!("aes-gcm decrypt (auth failed?): {e}")))
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

// ════════════════════════════════════════════════════════════════════════
// Keyring-backed master key
// ════════════════════════════════════════════════════════════════════════

/// Fetch the master key from the OS keyring, generating + persisting a fresh
/// CSPRNG key on first use. The returned key MUST be `zeroize`d by the caller.
fn load_or_create_master_key() -> HwResult<[u8; KEY_LEN]> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| HardwareError::Internal(format!("keyring entry: {e}")))?;

    match entry.get_password() {
        Ok(b64) => {
            let raw = B64
                .decode(b64.trim())
                .map_err(|e| HardwareError::Internal(format!("keyring key decode: {e}")))?;
            if raw.len() != KEY_LEN {
                return Err(HardwareError::Internal(
                    "master key has wrong length".into(),
                ));
            }
            let mut key = [0u8; KEY_LEN];
            key.copy_from_slice(&raw);
            Ok(key)
        }
        Err(keyring::Error::NoEntry) => {
            let mut key = [0u8; KEY_LEN];
            OsRng.fill_bytes(&mut key);
            let encoded = B64.encode(key);
            entry
                .set_password(&encoded)
                .map_err(|e| HardwareError::Internal(format!("keyring key store: {e}")))?;
            Ok(key)
        }
        Err(e) => Err(HardwareError::Internal(format!("keyring get: {e}"))),
    }
}

/// `$APP_DATA/kyc_vault/`, created if missing.
fn vault_dir(app: &tauri::AppHandle) -> HwResult<PathBuf> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| HardwareError::LocalIo(format!("app_data_dir: {e}")))?;
    let dir = base.join("kyc_vault");
    std::fs::create_dir_all(&dir).map_err(HardwareError::from)?;
    Ok(dir)
}

// ════════════════════════════════════════════════════════════════════════
// Tauri commands
// ════════════════════════════════════════════════════════════════════════

/// Encrypt `file_bytes` and persist them to the local KYC vault.
///
/// `customer_id` / `doc_type` are accepted for audit correlation and future
/// metadata sidecars; the ciphertext filename itself is an opaque UUID so the
/// vault directory leaks no PII even if its listing is observed.
#[tauri::command]
pub async fn encrypt_and_save_kyc_document(
    file_bytes: Vec<u8>,
    customer_id: String,
    doc_type: String,
    app_handle: tauri::AppHandle,
) -> HwResult<EncryptResult> {
    let _ = (&customer_id, &doc_type); // reserved for the audit sidecar (Phase C.2)
    if file_bytes.is_empty() {
        return Err(HardwareError::InvalidArgument("empty document".into()));
    }

    let dir = vault_dir(&app_handle)?;
    let sha256 = sha256_hex(&file_bytes);

    let mut key = load_or_create_master_key()?;
    let payload = encrypt_payload(&key, &file_bytes);
    key.zeroize();
    let payload = payload?;

    let path = dir.join(format!("{}.enc", uuid::Uuid::new_v4()));
    std::fs::write(&path, &payload).map_err(HardwareError::from)?;

    Ok(EncryptResult {
        path: path.to_string_lossy().into_owned(),
        sha256,
    })
}

/// Decrypt a vault file back to plaintext bytes for the React layer.
///
/// Reads are confined to the vault directory (canonicalized prefix check) so a
/// crafted `file_path` cannot exfiltrate arbitrary files via path traversal.
#[tauri::command]
pub async fn decrypt_and_load_kyc_document(
    file_path: String,
    app_handle: tauri::AppHandle,
) -> HwResult<Vec<u8>> {
    let dir = vault_dir(&app_handle)?;
    let canonical =
        std::fs::canonicalize(PathBuf::from(&file_path)).map_err(HardwareError::from)?;
    let canonical_dir = std::fs::canonicalize(&dir).map_err(HardwareError::from)?;
    if !canonical.starts_with(&canonical_dir) {
        return Err(HardwareError::InvalidArgument(
            "path is outside the KYC vault".into(),
        ));
    }

    let payload = std::fs::read(&canonical).map_err(HardwareError::from)?;
    let mut key = load_or_create_master_key()?;
    let plaintext = decrypt_payload(&key, &payload);
    key.zeroize();
    plaintext
}

/// Delete a vault ciphertext file (Phase 3.2 — operator removal / Art.17 erasure).
/// The path is confined to the vault directory (same canonicalized prefix check
/// as the read path) so a crafted `file_path` cannot delete an arbitrary file.
/// A file that is already gone is treated as success — the erasure goal is met,
/// so a repeat delete is idempotent rather than an error.
#[tauri::command]
pub async fn delete_kyc_document(file_path: String, app_handle: tauri::AppHandle) -> HwResult<()> {
    let dir = vault_dir(&app_handle)?;
    let canonical_dir = std::fs::canonicalize(&dir).map_err(HardwareError::from)?;
    // canonicalize fails on a nonexistent path — the file is already gone, which
    // satisfies the erasure intent, so return Ok rather than surfacing an error.
    let Ok(canonical) = std::fs::canonicalize(PathBuf::from(&file_path)) else {
        return Ok(());
    };
    if !canonical.starts_with(&canonical_dir) {
        return Err(HardwareError::InvalidArgument(
            "path is outside the KYC vault".into(),
        ));
    }
    std::fs::remove_file(&canonical).map_err(HardwareError::from)?;
    Ok(())
}

// ════════════════════════════════════════════════════════════════════════
// Tests — pure crypto only (no keyring / no Tauri runtime)
// ════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_recovers_plaintext() {
        let key = [7u8; KEY_LEN];
        let plaintext = b"Personalausweis: Mustermann, Max - scan bytes \x00\x01\x02";
        let payload = encrypt_payload(&key, plaintext).unwrap();
        let recovered = decrypt_payload(&key, &payload).unwrap();
        assert_eq!(recovered.as_slice(), plaintext.as_slice());
    }

    #[test]
    fn payload_does_not_contain_plaintext_on_disk() {
        // A raw read of the encrypted file must not reveal the document bytes.
        let key = [9u8; KEY_LEN];
        let plaintext = b"SECRET-ID-NUMBER-1234567890";
        let payload = encrypt_payload(&key, plaintext).unwrap();
        assert!(payload.len() > NONCE_LEN);
        assert!(
            !payload
                .windows(plaintext.len())
                .any(|w| w == plaintext.as_slice()),
            "plaintext leaked into ciphertext payload"
        );
    }

    #[test]
    fn wrong_key_fails_to_decrypt() {
        let payload = encrypt_payload(&[1u8; KEY_LEN], b"hello").unwrap();
        assert!(decrypt_payload(&[2u8; KEY_LEN], &payload).is_err());
    }

    #[test]
    fn tampered_ciphertext_fails_auth() {
        let key = [3u8; KEY_LEN];
        let mut payload = encrypt_payload(&key, b"hello world").unwrap();
        let last = payload.len() - 1;
        payload[last] ^= 0xff; // flip a tag/ciphertext bit
        assert!(decrypt_payload(&key, &payload).is_err());
    }

    #[test]
    fn nonce_is_unique_per_encryption() {
        let key = [5u8; KEY_LEN];
        let a = encrypt_payload(&key, b"x").unwrap();
        let b = encrypt_payload(&key, b"x").unwrap();
        assert_ne!(a[..NONCE_LEN], b[..NONCE_LEN], "nonce reuse detected");
        assert_ne!(a, b);
    }

    #[test]
    fn sha256_hex_matches_known_vector() {
        // SHA-256 of the empty string.
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }
}

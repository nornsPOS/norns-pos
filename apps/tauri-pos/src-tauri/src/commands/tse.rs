//! Mandate 2-A — TSE (Technische Sicherheitseinrichtung) via Fiskaly Cloud.
//!
//! KassenSichV requires every fiscal record in a German POS to be signed by
//! a certified TSE. We use Fiskaly's cloud TSS — pure HTTPS, no USB stick.
//! See memory.md §18.4 for the state machine; this module owns the
//! INTENTION → TRANSACTION → FINISH transitions.
//!
//! Both commands respect mock mode — without a Fiskaly key, the dev build
//! returns fabricated-but-deterministic signatures so the UI can flow.
//!
//! ── Die Anmeldung, und warum sie hier steht ────────────────────────────
//!
//! Bis zum 26.07.2026 schickte dieses Modul den fiskaly-API-SCHLÜSSEL direkt
//! als Bearer-Token. Ein Kommentar an der Stelle sagte, der richtige Weg über
//! `/auth` komme in V1.1. Gemessen gegen die echte Schnittstelle:
//!
//! ```text
//! GET /api/v2/tss   mit   Authorization: Bearer <api_key>
//! → 401  "could not parse jwt: 'test_d2dpr…'"
//! ```
//!
//! Der Schlüssel ist kein Token, er ist der halbe Ausweis. fiskaly verlangt
//! den Tausch von (Schlüssel, Geheimnis) gegen ein kurzlebiges JWT:
//!
//! ```text
//! POST /api/v2/auth  {api_key, api_secret}
//! → access_token (24 h), refresh_token (48 h)
//! ```
//!
//! Das heisst: der TSE-Pfad dieser Kasse konnte NIE eine Signatur erzeugen,
//! egal wie richtig alles danach war. In der Produktion passte das zum Befund
//! 64 Belege, 0 Signaturen.
//!
//! `access_token` unten hält das Token im Speicher und tauscht erst neu, wenn
//! es abläuft. Ein Tausch je Beleg wäre eine unnötige Netzrunde vor dem Kunden.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

use crate::config::{self, FISKALY_HTTP_TIMEOUT_MS};
use crate::error::{HardwareError, HwResult};
use crate::mock::{self, tse_mock};

// ────────────────────────────────────────────────────────────────────────
// Public IPC types — mirrored 1:1 in `hardware-client.ts`.
// ────────────────────────────────────────────────────────────────────────

/// Caller-supplied config — pulled from the Hardware tab in Einstellungen.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
// `api_secret` is part of the wire contract — the React side sends both
// halves of the Fiskaly credential pair even though V1 only uses the
// long-lived bearer key. V1.1 will exchange (key, secret) for a short-lived
// access token via /api/v2/auth, at which point `api_secret` lights up.
#[allow(dead_code)]
pub struct TseConfig {
    /// Fiskaly TSS UUID. Empty / missing = "not configured" → mock or error.
    pub tss_id: String,
    /// Fiskaly Client UUID (one per terminal).
    pub client_id: String,
    /// Long-lived API key. The React layer no longer holds this — it lives in
    /// the OS keychain and is hydrated into this struct INSIDE Rust right
    /// before each Fiskaly call (`hydrate_secrets_from_keyring`). `#[serde(default)]`
    /// lets the frontend send an empty/absent value.
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub api_secret: String,
}

/// Process type per Fiskaly spec. V1 only emits `Kassenbeleg-V1` (cash sale).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TseStartParams {
    pub config: TseConfig,
    /// Per-transaction nonce — the React layer generates it (uuidv4)
    /// so retries are idempotent.
    pub intention_id: String,
    /// `Kassenbeleg-V1` for a sale, `Bestellung-V1` for an Ankauf, etc.
    /// V1 ships `Kassenbeleg-V1` only.
    pub process_type: String,
}

/// Returned to React when INTENTION is opened. `intentionId` is the same
/// nonce the caller supplied — echoed so the React layer doesn't have to
/// keep a separate map.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TseIntention {
    pub intention_id: String,
    pub fiskaly_transaction_id: String,
    pub started_at: DateTime<Utc>,
}

/// Ein Steuersatz-Eimer für das signierte `amounts_per_vat_rate`.
///
/// ⚠️ HIESS BIS ZUM 08.08.2026 `vat_id` MIT EINER ZAHL. Am selben Tag gegen die
/// LIVE-Spezifikation gemessen (`GET https://kassensichv.fiskaly.com/api/v2/_spec.json`,
/// HTTP 200, 251 KB): die Zeichenkette `vat_id` kommt darin **null Mal** vor.
/// Das Feld heisst `amounts_per_vat_rate`, trägt `vat_rate` als NAMEN, und es
/// ist ein PFLICHTFELD. Der alte Rumpf wurde also abgewiesen, und zwar für
/// JEDEN Beleg, nicht nur für den Storno.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VatAmount {
    /// fiskaly `vat_rate`, das laut Spezifikation dem DSFinV-K-Feld `UST_SATZ`
    /// entspricht: NORMAL (19), REDUCED_1 (7), SPECIAL_RATE_1 (10,7),
    /// SPECIAL_RATE_2 (5,5), NULL (0). Der Name wird auf der JS-Seite
    /// entschieden, siehe `tse-vat.ts`.
    pub vat_rate: String,
    /// Bruttobetrag (mit Steuer) für diesen Satz, in ganzen Cent.
    ///
    /// ⚠️ VORZEICHENBEHAFTET. Die Spezifikation erlaubt den negativen Betrag
    /// ausdrücklich (`pattern: ^-?\d+(\.\d{2,5})$`), und ein Storno IST negativ.
    /// Als `u64` konnte er nie abgebildet werden.
    pub amount_cents: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
// `intention_id` + `process_data_base64` are part of the documented wire
// contract — React always sends them so the queue/audit can correlate
// even though the current Fiskaly v2 call doesn't echo them back.
#[allow(dead_code)]
pub struct TseFinishParams {
    pub config: TseConfig,
    pub intention_id: String,
    pub fiskaly_transaction_id: String,
    /// Der Betrag in ganzen Cent, der signiert wird. Vorzeichenbehaftet: ein
    /// Storno ist negativ, und die Spezifikation erlaubt das ausdrücklich.
    pub amount_cents: i64,
    /// fiskaly `payment_type`.
    ///
    /// ⚠️ HIESS BIS ZUM 08.08.2026 "Bar" / "Unbar". Beide kommen in der
    /// Live-Spezifikation **null Mal** vor; das enum lautet `CASH` / `NON_CASH`.
    pub payment_kind: String,
    /// Free-form process_data — Fiskaly accepts a 64 KiB blob; we pack
    /// the line-items + receipt locator in there.
    pub process_data_base64: String,
    /// Der TR-03151-Vorgangstyp, etwa `Kassenbeleg-V1`. Er gehört NICHT in
    /// `receipt_type` — bis zum 08.08.2026 stand er genau dort.
    pub process_type: String,
    /// fiskaly `receipt_type`, das dem DSFinV-K-Feld `BON_TYP` entspricht.
    ///
    /// Erlaubt sind ausschliesslich: RECEIPT (Beleg), TRAINING, TRANSFER,
    /// ORDER, CANCELLATION, ABORT, BENEFIT_IN_KIND, INVOICE, OTHER und
    /// ANNULATION (AVBelegstorno). Ein Verkauf ist RECEIPT, ein Storno
    /// ANNULATION.
    ///
    /// `#[serde(default = ...)]` hält eine alte Zeile aus der dauerhaften
    /// Warteschlange signierbar: sie trug das Feld noch nicht, und ein
    /// nachgereichter Verkaufsbeleg ist ein RECEIPT.
    #[serde(default = "beleg_vorgabe")]
    pub receipt_type: String,
    /// Bruttoaufteilung je Steuersatz für das signierte `amounts_per_vat_rate`.
    #[serde(default)]
    pub amounts_per_vat_rate: Vec<VatAmount>,
}

fn beleg_vorgabe() -> String {
    "RECEIPT".to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TseSignature {
    /// Base64-encoded ECDSA signature blob.
    pub signature_value: String,
    /// Monotonic per-TSS counter — required on the receipt.
    ///
    /// ⚠️ Kommt am Draht als ZEICHENKETTE (`BigintCounter`). Hier steht die
    /// gelesene Zahl; siehe `pflicht_zaehler`.
    pub signature_counter: u64,
    pub signature_algorithm: String,
    /// Öffentlicher Schlüssel der Sicherungseinrichtung, wie ihn fiskaly zu
    /// JEDER Signatur mitliefert. Ohne ihn kann ein Prüfer die Signatur nicht
    /// nachrechnen; DSFinV-K führt ihn als `TSE_PUBLIC_KEY`.
    pub signature_public_key: String,
    /// Seriennummer der Sicherungseinrichtung, DSFinV-K `TSE_SERIAL`.
    pub tss_serial_number: String,
    /// Fiskaly's transaction number (monotonic per-TSS, separate from `signature_counter`).
    pub transaction_number: u64,
    pub started_at: DateTime<Utc>,
    pub finished_at: DateTime<Utc>,
    /// The QR-payload string we render on the receipt (Fiskaly TSE QR spec).
    pub qr_code_payload: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TseStatus {
    pub reachable: bool,
    pub tss_state: Option<String>,
    pub last_checked_at: DateTime<Utc>,
    pub message: String,
    /// ⚠️ 15.08.2026, Basels Anweisung: die Erprobungsumgebung muss in der
    /// Flaeche UNUEBERSEHBAR sein.
    ///
    /// Der Befund davor: `config::FiskalUmgebung::ist_rechtsgueltig` existierte,
    /// hatte einen eigenen Waechter — und KEINEN Aufrufer im Produktivcode. Die
    /// ganze Oberflaeche kannte die Woerter „Erprobung" und „Testumgebung"
    /// nicht ein einziges Mal. Eine Kasse, die mit EINER Umgebungsvariablen
    /// gegen die Erprobung signierte, sah vollkommen echt aus: gruene Ampel,
    /// signierte Belege, QR-Codes, DSFinV-K-Ausfuhr. Wertlos waere jede
    /// Signatur erst am Tag der Kassennachschau aufgefallen.
    ///
    /// Die Ampel ist der richtige Traeger: die Flaeche liest sie ohnehin.
    pub rechtsgueltig: bool,
    /// Die Adresse, gegen die wirklich signiert wird. Fuer den Fall, dass
    /// jemand wissen will, WELCHE Erprobung.
    pub umgebung_adresse: String,
}

// ────────────────────────────────────────────────────────────────────────
// Commands
// ────────────────────────────────────────────────────────────────────────

/// Open a TSE intention — Fiskaly `PUT /tss/{tssId}/tx/{txId}` with the
/// state machine in `Active` state. The terminal must call `tse_finish_transaction`
/// before the transaction expires (Fiskaly default ≈ 24 h).
#[tauri::command]
pub async fn tse_start_transaction(mut params: TseStartParams) -> HwResult<TseIntention> {
    if config::is_mock_mode() {
        return tse_mock::start_transaction(params).await;
    }

    hydrate_secrets_from_keyring(&mut params.config)?;
    validate_config(&params.config)?;

    let url = format!(
        "{base}/tss/{tss}/tx/{tx}",
        base = config::fiskaly_base_url(),
        tss = params.config.tss_id,
        tx = params.intention_id,
    );

    let client = http_client()?;
    let body = serde_json::json!({
        "state": "ACTIVE",
        "client_id": params.config.client_id,
        "type": params.process_type,
    });

    let res = client
        .put(&url)
        // Das Token, NICHT der Schlüssel. Mit dem Schlüssel antwortet fiskaly 401.
        .bearer_auth(access_token(&params.config).await?)
        .json(&body)
        .send()
        .await?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(HardwareError::Device(format!(
            "Fiskaly PUT /tx returned {status}: {text}"
        )));
    }

    let parsed: serde_json::Value = res.json().await?;
    let fiskaly_tx_id = parsed
        .get("_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| HardwareError::Device("Fiskaly response missing _id".into()))?
        .to_string();

    Ok(TseIntention {
        intention_id: params.intention_id,
        fiskaly_transaction_id: fiskaly_tx_id,
        started_at: Utc::now(),
    })
}

/// Finish a TSE transaction — Fiskaly `PUT /tss/{tssId}/tx/{txId}` with
/// `state=FINISHED`. The response carries the signature counter + value
/// that must land on the printed receipt.
///
/// ── ⚠️ DER BEFUND VOM 09.08.2026: KEIN BELEG WURDE SIGNIERT ──────────────
///
/// Diese Stelle sprach an DREI Punkten ein anderes Vokabular als die
/// Schnittstelle. Gemessen an `https://kassensichv.fiskaly.com/api/v2/_spec.json`,
/// abgerufen am 09.08.2026:
///
///   1. VERB. `/api/v2/tss/{tss_id}/tx/{tx_id_or_number}` kennt GET und PUT.
///      Hier stand `.patch(&url)`. PATCH gibt es nur auf `/metadata`. Jede
///      Antwort war 405, also trug JEDER Beleg den Ausfallvermerk.
///
///   2. ZÄHLER. `signature.counter` ist `BigintCounter`, `type: string`.
///      Hier stand `as_u64()`, das auf einer JSON-Zeichenkette `None` gibt,
///      und danach `unwrap_or(0)`. Wer nur das Verb getauscht hätte, bekäme
///      den Zähler 0, die Datenbankregel wiese die Zeile ab, und es sähe aus
///      wie ein neuer, unerklärlicher Fehler.
///
///   3. ZEIT. `time_start`/`time_end` sind `Timestamp`, `type: integer`, in
///      Unix-Sekunden. Hier stand `parse_from_rfc3339`, danach
///      `unwrap_or_else(Utc::now)`. Die Kasse hätte also STILL ihre eigene
///      Uhr als Protokollzeit der Sicherungseinrichtung eingesetzt — an
///      genau der Stelle, über die signiert wird.
///
/// ── UND DESHALB WIRFT ES JETZT, STATT ZU ERFINDEN ────────────────────────
///
/// Jedes `unwrap_or` hier war ein erfundener Wert in einer Aufzeichnung nach
/// § 146a AO. Fehlt ein Pflichtfeld, ist das ein TSE-Ausfall und gehört als
/// solcher vermerkt; der Weg dafür steht und trägt den Beleg unsigniert mit
/// Ausfallgrund. Ein erfundener Zähler wäre dagegen eine unrichtige Angabe.
#[tauri::command]
pub async fn tse_finish_transaction(mut params: TseFinishParams) -> HwResult<TseSignature> {
    if config::is_mock_mode() {
        return tse_mock::finish_transaction(params).await;
    }

    hydrate_secrets_from_keyring(&mut params.config)?;
    validate_config(&params.config)?;

    let url = format!(
        "{base}/tss/{tss}/tx/{tx}",
        base = config::fiskaly_base_url(),
        tss = params.config.tss_id,
        tx = params.fiskaly_transaction_id,
    );

    let body = build_finish_body(&params);

    let res = http_client()?
        .put(&url)
        .bearer_auth(access_token(&params.config).await?)
        .json(&body)
        .send()
        .await?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(HardwareError::Device(format!(
            "Fiskaly PUT /tx (FINISHED) returned {status}: {text}"
        )));
    }

    let parsed: serde_json::Value = res.json().await?;
    let sig = parsed
        .get("signature")
        .ok_or_else(|| HardwareError::Device("Fiskaly response missing signature".into()))?;

    Ok(TseSignature {
        signature_value: pflicht_text(sig, "value", "signature.value")?,
        signature_counter: pflicht_zaehler(sig)?,
        signature_algorithm: pflicht_text(sig, "algorithm", "signature.algorithm")?,
        /*
         * ⚠️ Der öffentliche Schlüssel ist in der Norm PFLICHT und ist das
         * Stück, mit dem ein Prüfer die Signatur überhaupt nachrechnen kann.
         * Ohne ihn ist die Signatur für ihn eine Zeichenkette ohne Beweiswert.
         */
        signature_public_key: pflicht_text(sig, "public_key", "signature.public_key")?,
        tss_serial_number: pflicht_text(&parsed, "tss_serial_number", "tss_serial_number")?,
        transaction_number: parsed
            .get("number")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| fehlt("number"))?,
        started_at: unix_sekunden(&parsed, "time_start")?,
        finished_at: unix_sekunden(&parsed, "time_end")?,
        qr_code_payload: pflicht_text(&parsed, "qr_code_data", "qr_code_data")?,
    })
}

/// Ein Pflichtfeld fehlt. Eine Meldung, die die STELLE nennt statt „Fehler".
fn fehlt(feld: &str) -> HardwareError {
    HardwareError::Device(format!(
        "Fiskaly-Antwort ohne Pflichtfeld `{feld}` — der Beleg bleibt unsigniert \
         und wird als TSE-Ausfall vermerkt"
    ))
}

/// Eine Pflicht-Zeichenkette lesen. Leer zählt als fehlend: ein leerer
/// Signaturwert im Prüfpaket wäre schlimmer als ein ehrlicher Ausfall.
fn pflicht_text(wert: &serde_json::Value, schluessel: &str, stelle: &str) -> HwResult<String> {
    match wert.get(schluessel).and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => Ok(s.to_string()),
        _ => Err(fehlt(stelle)),
    }
}

/// Den Signaturzähler lesen.
///
/// ⚠️ Er kommt als ZEICHENKETTE (`BigintCounter`, `format: bigint`). Eine
/// Zahl wird trotzdem angenommen, falls fiskaly das Feld je lockert — aber
/// niemals ein Ersatzwert, denn der Zähler ist der Beweis der Lückenlosigkeit.
fn pflicht_zaehler(sig: &serde_json::Value) -> HwResult<u64> {
    let roh = sig
        .get("counter")
        .ok_or_else(|| fehlt("signature.counter"))?;
    if let Some(n) = roh.as_u64() {
        return Ok(n);
    }
    roh.as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .and_then(|s| s.parse::<u64>().ok())
        .ok_or_else(|| {
            HardwareError::Device(format!(
                "Fiskaly-Antwort: `signature.counter` ist keine lesbare Zahl ({roh}) — \
                 der Beleg bleibt unsigniert und wird als TSE-Ausfall vermerkt"
            ))
        })
}

/// Einen Zeitpunkt der SICHERUNGSEINRICHTUNG lesen: ganze Unix-Sekunden.
///
/// ⚠️ NIE `Utc::now()` als Ersatz. Diese Zeit ist Teil dessen, worüber
/// signiert wurde; die Uhr des Kassenrechners an ihre Stelle zu setzen wäre
/// eine erfundene Angabe in einer amtlichen Aufzeichnung.
fn unix_sekunden(wert: &serde_json::Value, schluessel: &str) -> HwResult<DateTime<Utc>> {
    let sek = wert
        .get(schluessel)
        .and_then(|v| v.as_i64())
        .ok_or_else(|| fehlt(schluessel))?;
    DateTime::from_timestamp(sek, 0).ok_or_else(|| {
        HardwareError::Device(format!(
            "Fiskaly-Antwort: `{schluessel}` liegt ausserhalb des Kalenders ({sek})"
        ))
    })
}

/// Cheap health-probe — does the Fiskaly endpoint answer + is the TSS in
/// state `INITIALIZED`? Drives the green/red TSE badge in the Gerätemanager.
#[tauri::command]
pub async fn tse_status(mut config: TseConfig) -> HwResult<TseStatus> {
    if crate::config::is_mock_mode() {
        return tse_mock::status(config).await;
    }

    hydrate_secrets_from_keyring(&mut config)?;

    if config.tss_id.is_empty() {
        return Ok(TseStatus {
            rechtsgueltig: crate::config::fiskal_umgebung().ist_rechtsgueltig(),
            umgebung_adresse: crate::config::fiskal_umgebung().adresse().to_string(),
            reachable: false,
            tss_state: None,
            last_checked_at: Utc::now(),
            message: "TSS-ID nicht konfiguriert".into(),
        });
    }

    let url = format!(
        "{base}/tss/{tss}",
        base = crate::config::fiskaly_base_url(),
        tss = config.tss_id,
    );
    let client = http_client()?;
    // Eine gescheiterte Anmeldung ist ein ehrliches "nicht bereit". Sie darf die
    // Ampel im Gerätemanager NICHT gruen lassen und auch nicht abstuerzen.
    let token = match access_token(&config).await {
        Ok(t) => t,
        Err(e) => {
            return Ok(TseStatus {
                rechtsgueltig: crate::config::fiskal_umgebung().ist_rechtsgueltig(),
                umgebung_adresse: crate::config::fiskal_umgebung().adresse().to_string(),
                reachable: false,
                tss_state: None,
                last_checked_at: Utc::now(),
                message: format!("Anmeldung bei der TSE fehlgeschlagen: {e}"),
            })
        }
    };
    match client.get(&url).bearer_auth(token).send().await {
        Ok(res) if res.status().is_success() => {
            let v: serde_json::Value = res.json().await.unwrap_or_default();
            Ok(TseStatus {
                rechtsgueltig: crate::config::fiskal_umgebung().ist_rechtsgueltig(),
                umgebung_adresse: crate::config::fiskal_umgebung().adresse().to_string(),
                reachable: true,
                tss_state: v.get("state").and_then(|v| v.as_str()).map(str::to_string),
                last_checked_at: Utc::now(),
                message: "TSE erreichbar".into(),
            })
        }
        Ok(res) => Ok(TseStatus {
            rechtsgueltig: crate::config::fiskal_umgebung().ist_rechtsgueltig(),
            umgebung_adresse: crate::config::fiskal_umgebung().adresse().to_string(),
            reachable: false,
            tss_state: None,
            last_checked_at: Utc::now(),
            message: format!("Fiskaly antwortet {}", res.status()),
        }),
        Err(e) => Ok(TseStatus {
            rechtsgueltig: crate::config::fiskal_umgebung().ist_rechtsgueltig(),
            umgebung_adresse: crate::config::fiskal_umgebung().adresse().to_string(),
            reachable: false,
            tss_state: None,
            last_checked_at: Utc::now(),
            message: format!("Verbindung fehlgeschlagen: {e}"),
        }),
    }
}

// ────────────────────────────────────────────────────────────────────────
// Private helpers
// ────────────────────────────────────────────────────────────────────────

fn validate_config(cfg: &TseConfig) -> HwResult<()> {
    if cfg.tss_id.is_empty() || cfg.api_key.is_empty() {
        return Err(HardwareError::NotConfigured(
            "TSE: TSS-ID oder API-Key fehlt".into(),
        ));
    }
    Ok(())
}

/// Ein zwischengespeichertes Zugriffstoken samt Ablauf.
#[derive(Clone)]
struct CachedToken {
    /// Für welchen Schlüssel es gilt. Wechselt der Zugang, ist das Token wertlos.
    api_key: String,
    token: String,
    /// Unix-Sekunden. Wir erneuern schon VOR diesem Punkt, siehe SICHERHEITSPUFFER.
    expires_at: i64,
}

/// Wie lange vor dem echten Ablauf neu getauscht wird. Ein Beleg, der genau in
/// der Ablaufsekunde signiert wird, dürfte sonst vor dem Kunden scheitern.
const TOKEN_SICHERHEITSPUFFER_S: i64 = 120;

static TOKEN_CACHE: std::sync::OnceLock<tokio::sync::Mutex<Option<CachedToken>>> =
    std::sync::OnceLock::new();

#[derive(Deserialize)]
struct AuthResponse {
    access_token: String,
    access_token_expires_at: i64,
}

/// Tauscht (Schlüssel, Geheimnis) gegen ein kurzlebiges Zugriffstoken, oder
/// liefert das noch gültige aus dem Zwischenspeicher.
///
/// Die Sperre umfasst bewusst den ganzen Vorgang: zwei Kassenvorgänge, die
/// gleichzeitig ein abgelaufenes Token bemerken, sollen EINEN Tausch auslösen
/// und nicht zwei. fiskaly zählt Anmeldungen.
async fn access_token(cfg: &TseConfig) -> HwResult<String> {
    if cfg.api_key.is_empty() || cfg.api_secret.is_empty() {
        return Err(HardwareError::Device(
            "Für die TSE fehlen Schlüssel oder Geheimnis. Es wurde nichts signiert.".into(),
        ));
    }
    let cache = TOKEN_CACHE.get_or_init(|| tokio::sync::Mutex::new(None));
    let mut guard = cache.lock().await;

    let jetzt = Utc::now().timestamp();
    if let Some(c) = guard.as_ref() {
        if c.api_key == cfg.api_key && c.expires_at - TOKEN_SICHERHEITSPUFFER_S > jetzt {
            return Ok(c.token.clone());
        }
    }

    let url = format!("{base}/auth", base = config::fiskaly_base_url());
    let res = http_client()?
        .post(&url)
        .json(&serde_json::json!({
            "api_key": cfg.api_key,
            "api_secret": cfg.api_secret,
        }))
        .send()
        .await?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        // Der Text von fiskaly wird durchgereicht: er nennt den Grund, und der
        // Bediener soll "Zugang abgelehnt" lesen, nicht "irgendwas ging schief".
        return Err(HardwareError::Device(format!(
            "Fiskaly-Anmeldung abgelehnt ({status}): {text}"
        )));
    }

    let auth: AuthResponse = res
        .json()
        .await
        .map_err(|e| HardwareError::Device(format!("Fiskaly-Anmeldung: unlesbare Antwort: {e}")))?;

    *guard = Some(CachedToken {
        api_key: cfg.api_key.clone(),
        token: auth.access_token.clone(),
        expires_at: auth.access_token_expires_at,
    });
    Ok(auth.access_token)
}

fn http_client() -> HwResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(FISKALY_HTTP_TIMEOUT_MS))
        .build()
        .map_err(HardwareError::from)
}

/// Ganze Cent als Geldbetrag, MIT Vorzeichen.
///
/// ⚠️ Die naive Fassung war `cents / 100` und `cents % 100`. In Rust ergibt
/// `-119 / 100` genau `-1` und `-119 % 100` genau `-19`, also hätte sie
/// `"-1.-19"` geschrieben. Deshalb Vorzeichen abtrennen, Betrag positiv
/// rechnen, Vorzeichen voranstellen. Die Spezifikation verlangt
/// `^-?\d+(\.\d{2,5})$`, und ein Storno ist negativ.
fn format_cents(cents: i64) -> String {
    let negativ = cents < 0;
    let betrag = cents.unsigned_abs();
    let euros = betrag / 100;
    let rest = betrag % 100;
    format!("{}{euros}.{rest:02}", if negativ { "-" } else { "" })
}

/// Build the fiskaly `PATCH /tx` FINISH body — the KassenSichV standard_v1
/// receipt that gets SIGNED. Extracted from `tse_finish_transaction` so the
/// signed VAT decomposition can be asserted without an HTTP round-trip.
fn build_finish_body(params: &TseFinishParams) -> serde_json::Value {
    let amounts_per_vat_rate: Vec<serde_json::Value> = params
        .amounts_per_vat_rate
        .iter()
        .map(
            |v| serde_json::json!({ "vat_rate": v.vat_rate, "amount": format_cents(v.amount_cents) }),
        )
        .collect();
    serde_json::json!({
        "state": "FINISHED",
        "client_id": params.config.client_id,
        "schema": {
            "standard_v1": {
                "receipt": {
                    // BON_TYP: RECEIPT beim Verkauf, ANNULATION beim Storno.
                    // Hier stand bis zum 08.08.2026 der Vorgangstyp
                    // „Kassenbeleg-V1", der in diesem enum nicht vorkommt.
                    "receipt_type": params.receipt_type,
                    // Pflichtfeld. Hiess bis zum 08.08.2026 `amounts_per_vat_id`,
                    // ein Name, den die Schnittstelle nicht kennt — das Pflichtfeld
                    // fehlte damit vollständig.
                    "amounts_per_vat_rate": amounts_per_vat_rate,
                    "amounts_per_payment_type": [
                        {
                            "payment_type": params.payment_kind,
                            "amount": format_cents(params.amount_cents),
                            "currency_code": "EUR"
                        }
                    ]
                }
            }
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> TseConfig {
        TseConfig {
            tss_id: "tss".into(),
            client_id: "client".into(),
            api_key: String::new(),
            api_secret: String::new(),
        }
    }

    fn beispiel(betrag: i64, art: &str, typ: &str, saetze: Vec<VatAmount>) -> TseFinishParams {
        TseFinishParams {
            config: test_config(),
            intention_id: "i".into(),
            fiskaly_transaction_id: "tx".into(),
            amount_cents: betrag,
            payment_kind: art.into(),
            process_data_base64: String::new(),
            process_type: "Kassenbeleg-V1".into(),
            receipt_type: typ.into(),
            amounts_per_vat_rate: saetze,
        }
    }

    /// ⚠️ DIESER TEST HAT BIS ZUM 08.08.2026 DEN FEHLER FESTGEPINNT.
    ///
    /// Er prüfte `receipt["amounts_per_vat_id"]` und war grün, während die
    /// Schnittstelle jeden so gebauten Rumpf abwies. Genau die Klasse
    /// „Prüfstand macht denselben Fehler": ein Nachbau, der das Protokoll
    /// falsch nachbildet, meldet den Fehler täglich als behoben.
    ///
    /// Jetzt misst er gegen die LIVE-Spezifikation
    /// (`GET https://kassensichv.fiskaly.com/api/v2/_spec.json`, am 08.08.2026
    /// gelesen): Feldname, enum-Werte und Vorzeichen.
    #[test]
    fn der_signierte_rumpf_spricht_das_vokabular_der_spezifikation() {
        // Gemischter Beleg 19 % / 7 % / 0 %: 119,00 + 107,00 + 1,00 = 227,00.
        let params = beispiel(
            22700,
            "CASH",
            "RECEIPT",
            vec![
                VatAmount {
                    vat_rate: "NORMAL".into(),
                    amount_cents: 11900,
                },
                VatAmount {
                    vat_rate: "REDUCED_1".into(),
                    amount_cents: 10700,
                },
                VatAmount {
                    vat_rate: "NULL".into(),
                    amount_cents: 100,
                },
            ],
        );
        let body = build_finish_body(&params);
        let receipt = &body["schema"]["standard_v1"]["receipt"];

        // Das Pflichtfeld heisst `amounts_per_vat_rate`. Der alte Name kommt in
        // der Spezifikation null Mal vor und darf hier nie wieder auftauchen.
        assert!(
            receipt.get("amounts_per_vat_id").is_none(),
            "der alte V1-Feldname darf nicht mehr gesendet werden"
        );
        let vat = receipt["amounts_per_vat_rate"].as_array().unwrap();
        assert_eq!(vat.len(), 3);
        assert_eq!(vat[0]["vat_rate"], "NORMAL");
        assert_eq!(vat[0]["amount"], "119.00");
        assert_eq!(vat[1]["vat_rate"], "REDUCED_1");
        assert_eq!(vat[1]["amount"], "107.00");
        assert_eq!(vat[2]["vat_rate"], "NULL");
        assert_eq!(vat[2]["amount"], "1.00");

        // BON_TYP, nicht der Vorgangstyp.
        assert_eq!(receipt["receipt_type"], "RECEIPT");

        // Zahlart aus dem enum der Spezifikation, plus Währung.
        let zahlung = &receipt["amounts_per_payment_type"][0];
        assert_eq!(zahlung["payment_type"], "CASH");
        assert_eq!(zahlung["amount"], "227.00");
        assert_eq!(zahlung["currency_code"], "EUR");
    }

    /// Jeder gesendete Wert muss im enum der Spezifikation stehen. Ohne diesen
    /// Satz wäre „Bar" wieder nur ein Tippfehler entfernt.
    #[test]
    fn nur_werte_aus_den_enums_der_spezifikation() {
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
        const SAETZE: [&str; 5] = [
            "NORMAL",
            "REDUCED_1",
            "SPECIAL_RATE_1",
            "SPECIAL_RATE_2",
            "NULL",
        ];
        const ZAHLARTEN: [&str; 2] = ["CASH", "NON_CASH"];

        for typ in BON_TYPEN {
            for art in ZAHLARTEN {
                for satz in SAETZE {
                    let p = beispiel(
                        100,
                        art,
                        typ,
                        vec![VatAmount {
                            vat_rate: satz.into(),
                            amount_cents: 100,
                        }],
                    );
                    let b = build_finish_body(&p);
                    let r = &b["schema"]["standard_v1"]["receipt"];
                    assert!(BON_TYPEN.contains(&r["receipt_type"].as_str().unwrap()));
                    assert!(ZAHLARTEN.contains(
                        &r["amounts_per_payment_type"][0]["payment_type"]
                            .as_str()
                            .unwrap()
                    ));
                    assert!(SAETZE
                        .contains(&r["amounts_per_vat_rate"][0]["vat_rate"].as_str().unwrap()));
                }
            }
        }
    }

    /// ⚠️ DER STORNO. Er ist negativ, und bis zum 08.08.2026 konnte der Typ
    /// `u64` das gar nicht ausdrücken; der Aufrufer schickte deshalb 0.
    #[test]
    fn ein_storno_traegt_seinen_echten_negativen_betrag() {
        let params = beispiel(
            -11900,
            "CASH",
            "ANNULATION",
            vec![VatAmount {
                vat_rate: "NORMAL".into(),
                amount_cents: -11900,
            }],
        );
        let body = build_finish_body(&params);
        let receipt = &body["schema"]["standard_v1"]["receipt"];
        assert_eq!(receipt["receipt_type"], "ANNULATION");
        assert_eq!(receipt["amounts_per_vat_rate"][0]["amount"], "-119.00");
        assert_eq!(receipt["amounts_per_payment_type"][0]["amount"], "-119.00");
    }

    /// Das Muster der Spezifikation lautet `^-?\d+(\.\d{2,5})$`. Die naive
    /// Rechnung hätte `-1.-19` erzeugt, weil Rust `-119 % 100` zu `-19` macht.
    #[test]
    fn cent_werden_mit_vorzeichen_zu_euro() {
        let muster = regex_lite_ok;
        for (cent, erwartet) in [
            (0_i64, "0.00"),
            (1, "0.01"),
            (99, "0.99"),
            (100, "1.00"),
            (-1, "-0.01"),
            (-19, "-0.19"),
            (-119, "-1.19"),
            (-100, "-1.00"),
            (123456789, "1234567.89"),
            (-123456789, "-1234567.89"),
        ] {
            let s = format_cents(cent);
            assert_eq!(s, erwartet, "{cent} Cent");
            assert!(muster(&s), "{s} passt nicht auf ^-?\\d+\\.\\d{{2}}$");
        }
    }

    /// Winziger Musterprüfer, damit der Test ohne neue Abhängigkeit auskommt.
    fn regex_lite_ok(s: &str) -> bool {
        let rest = s.strip_prefix('-').unwrap_or(s);
        let Some((ganz, dezimal)) = rest.split_once('.') else {
            return false;
        };
        !ganz.is_empty()
            && ganz.bytes().all(|b| b.is_ascii_digit())
            && dezimal.len() == 2
            && dezimal.bytes().all(|b| b.is_ascii_digit())
    }

    /// Eine alte Zeile aus der dauerhaften Warteschlange trug `receipt_type`
    /// noch nicht. Sie muss signierbar bleiben, und ein nachgereichter
    /// Verkaufsbeleg ist ein RECEIPT.
    #[test]
    fn eine_alte_warteschlangenzeile_bleibt_signierbar() {
        let roh = serde_json::json!({
            "config": { "tssId": "tss", "clientId": "client", "apiKey": "", "apiSecret": "" },
            "intentionId": "i",
            "fiskalyTransactionId": "tx",
            "amountCents": 5000,
            "paymentKind": "NON_CASH",
            "processDataBase64": "",
            "processType": "Kassenbeleg-V1"
        });
        let params: TseFinishParams = serde_json::from_value(roh).unwrap();
        assert_eq!(params.receipt_type, "RECEIPT");
        let body = build_finish_body(&params);
        assert_eq!(
            body["schema"]["standard_v1"]["receipt"]["amounts_per_vat_rate"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
    }
}

// Suppress "unused" warnings on the `mock` import when building without
// any mock paths active — defensive; the import IS used via tse_mock::*.
#[allow(dead_code)]
fn _link_mock() {
    let _ = mock::mock_delay(0);
}

// ════════════════════════════════════════════════════════════════════════
// OS-keychain–backed Fiskaly credentials (KassenSichV hardening)
//
// The TSE API key + secret are fiscal-grade secrets. They MUST NOT sit in
// the webview's localStorage (plaintext on disk, readable by any JS). They
// live ONLY in the OS keychain (macOS Keychain / Windows Credential Manager /
// libsecret), mirroring the KYC master-key pattern in `kyc.rs`. The React
// layer writes them once via `tse_store_credentials` and never reads them
// back; every live Fiskaly call hydrates them inside Rust.
// ════════════════════════════════════════════════════════════════════════

const TSE_KEYRING_SERVICE: &str = "warehouse14-tse";
const TSE_KEY_USER: &str = "fiskaly_api_key";
const TSE_SECRET_USER: &str = "fiskaly_api_secret";

fn keyring_entry(user: &str) -> HwResult<keyring::Entry> {
    keyring::Entry::new(TSE_KEYRING_SERVICE, user)
        .map_err(|e| HardwareError::Internal(format!("keyring entry: {e}")))
}

fn read_keyring(user: &str) -> HwResult<Option<String>> {
    match keyring_entry(user)?.get_password() {
        Ok(v) if !v.is_empty() => Ok(Some(v)),
        Ok(_) => Ok(None),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(HardwareError::Internal(format!("keyring read: {e}"))),
    }
}

/// Fill empty credential fields from the keychain. Called by every live
/// Fiskaly command so the React layer never has to hold the secrets.
/// Die einmal gelesenen Zugangsdaten, für die Dauer des Programmlaufs.
///
/// ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
///
/// `hydrate_secrets_from_keyring` las bei JEDEM Aufruf zwei Schlüsselbund-
/// fächer, und drei Wege rufen es (Zeile 203, 259, 332). Bei einer
/// eingerichteten TSE sind das ZWEI Tresorgriffe je Beleg.
///
/// Solange die Kasse ad hoc unterschrieben ist, ist jeder Griff auf ein Fach,
/// dessen Zugriffsliste nicht mehr passt, eine Passwortfrage. Zwei Fragen je
/// Verkauf am Tresen wären unbenutzbar.
///
/// Heute fällt es nicht auf, weil beide Fächer auf diesem Mac gemessen leer
/// sind. Es gehört behoben, BEVOR die erste TSE eingerichtet wird.
///
/// ⚠️ Der Zwischenspeicher wird beim Schreiben UND beim Löschen der
/// Zugangsdaten verworfen. Ohne das behielte die Kasse einen widerrufenen
/// Schlüssel bis zum Neustart im Speicher.
static ZUGANG_GEMERKT: std::sync::Mutex<Option<(String, String)>> = std::sync::Mutex::new(None);

/// Den Zwischenspeicher verwerfen. Nach jedem Schreiben und jedem Löschen.
fn zugang_vergessen() {
    if let Ok(mut z) = ZUGANG_GEMERKT.lock() {
        *z = None;
    }
}

fn hydrate_secrets_from_keyring(cfg: &mut TseConfig) -> HwResult<()> {
    if !cfg.api_key.is_empty() && !cfg.api_secret.is_empty() {
        return Ok(());
    }

    // Schon gelesen? Dann kein zweiter Griff in den Tresor.
    if let Ok(gemerkt) = ZUGANG_GEMERKT.lock() {
        if let Some((k, s)) = gemerkt.as_ref() {
            if cfg.api_key.is_empty() {
                cfg.api_key = k.clone();
            }
            if cfg.api_secret.is_empty() {
                cfg.api_secret = s.clone();
            }
            return Ok(());
        }
    }

    let schluessel = read_keyring(TSE_KEY_USER)?;
    let geheimnis = read_keyring(TSE_SECRET_USER)?;

    // ⚠️ Nur ein VOLLSTÄNDIGES Paar wird gemerkt. Eine halbe Erinnerung
    // liesse den nächsten Aufruf glauben, es sei nichts mehr nachzulesen.
    if let (Some(k), Some(g)) = (schluessel.as_ref(), geheimnis.as_ref()) {
        if let Ok(mut z) = ZUGANG_GEMERKT.lock() {
            *z = Some((k.clone(), g.clone()));
        }
    }

    if cfg.api_key.is_empty() {
        if let Some(k) = schluessel {
            cfg.api_key = k;
        }
    }
    if cfg.api_secret.is_empty() {
        if let Some(s) = geheimnis {
            cfg.api_secret = s;
        }
    }
    Ok(())
}

/// Persist the Fiskaly credential pair into the OS keychain. The plaintext
/// halves are `zeroize`d from our buffers immediately after the store.
/// Mock mode is a no-op success so local testing never touches the keychain.
#[tauri::command]
pub async fn tse_store_credentials(mut api_key: String, mut api_secret: String) -> HwResult<()> {
    if config::is_mock_mode() {
        zugang_vergessen();
        api_key.zeroize();
        api_secret.zeroize();
        return Ok(());
    }
    keyring_entry(TSE_KEY_USER)?
        .set_password(&api_key)
        .map_err(|e| HardwareError::Internal(format!("keyring store key: {e}")))?;
    keyring_entry(TSE_SECRET_USER)?
        .set_password(&api_secret)
        .map_err(|e| HardwareError::Internal(format!("keyring store secret: {e}")))?;
    api_key.zeroize();
    api_secret.zeroize();
    Ok(())
}

/// True when BOTH halves of the credential pair are present in the keychain.
#[tauri::command]
pub async fn tse_credentials_present() -> HwResult<bool> {
    if config::is_mock_mode() {
        return Ok(true);
    }
    Ok(read_keyring(TSE_KEY_USER)?.is_some() && read_keyring(TSE_SECRET_USER)?.is_some())
}

/// Remove the credential pair from the keychain (operator "löschen").
#[tauri::command]
pub async fn tse_clear_credentials() -> HwResult<()> {
    zugang_vergessen();
    if config::is_mock_mode() {
        return Ok(());
    }
    for user in [TSE_KEY_USER, TSE_SECRET_USER] {
        match keyring_entry(user)?.delete_credential() {
            Ok(()) => {}
            Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(HardwareError::Internal(format!("keyring clear: {e}"))),
        }
    }
    Ok(())
}

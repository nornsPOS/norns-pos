//! Runtime configuration helpers — small, side-effect-free.
//!
//! Two switches drive the hardware layer:
//!
//!   1. `NORNS_MOCK_HARDWARE=1` flips every command into a fake
//!      implementation. Used by `pnpm dev:tauri`, CI, and the demo build.
//!
//!   2. `NORNS_MOCK_FAIL_RATE=0.25` makes the mocks fail 25 % of the
//!      time. Useful when exercising the UI's error-handling paths.
//!
//! Both are read *every* call (not cached) so a developer can toggle them
//! without restarting the app. Reading an env var is cheap.

/// BEFUND 14 (Attrappe im Freigabebau) — die reine Entscheidung, herausgeloest.
///
/// WAS war der Befund: `NORNS_MOCK_HARDWARE=1` schlug das Bauprofil, auch
/// im Freigabebau. Eine gesetzte Umgebung genuegte, und `tse_finish_transaction`
/// lieferte eine erfundene Signatur `MOCK-SIG-...` statt einer echten.
///
/// WARUM ist der naheliegende Weg falsch: den Riegel direkt in `is_mock_mode`
/// zu schreiben laesst sich NICHT im Entwicklungsbau messen. Der Laeufer faehrt
/// `cargo test` ohne `--release` (.github/workflows/ci.yml), ein Satz hinter
/// `#[cfg(not(debug_assertions))]` wuerde dort nie uebersetzt und damit nie rot.
/// Deshalb traegt diese reine Funktion das Bauprofil als ARGUMENT: sie ist in
/// jedem Profil pruefbar, und `is_mock_mode` ist nur noch ihr Aufrufer.
///
/// WAS misst der Waechter: `tests/attrappe-im-freigabebau.rs` ruft genau diese
/// Funktion mit `freigabebau = true` und gesetztem Schalter auf und verlangt
/// `false`.
pub fn attrappe_entscheiden(freigabebau: bool, schalter: Option<&str>) -> bool {
    // Im Freigabebau gibt es keinen Weg zur Attrappe. Die Umgebung darf das
    // Bauprofil NICHT schlagen: ein Haendler an der echten Kasse wuerde sonst
    // Belege mit erfundenen Signaturen drucken.
    if freigabebau {
        return false;
    }
    match schalter {
        Some(v) => v == "1" || v.eq_ignore_ascii_case("true"),
        // Nicht gesetzt → das Bauprofil entscheidet.
        None => !freigabebau,
    }
}

/// `true`, wenn jeder Befehl auf seine Attrappe kurzschliessen soll.
///
/// Vorgabe: `true` im Entwicklungsbau, `false` im Freigabebau. Eine Kasse im
/// Laden darf NIE still auf Attrappen laufen.
///
/// ⚠️ Im Freigabebau ist der Umgebungsschalter wirkungslos; die Entscheidung
/// trifft `attrappe_entscheiden`, und `tests/attrappe-im-freigabebau.rs` misst
/// sie.
pub fn is_mock_mode() -> bool {
    let schalter = std::env::var("NORNS_MOCK_HARDWARE").ok();
    attrappe_entscheiden(!cfg!(debug_assertions), schalter.as_deref())
}

/// Mock failure injection rate, 0.0 ..= 1.0. Anything outside that range
/// is clamped. Use this from the React side (`hardware-client.ts`) to
/// exercise the error UI paths.
pub fn mock_fail_rate() -> f64 {
    std::env::var("NORNS_MOCK_FAIL_RATE")
        .ok()
        .and_then(|v| v.parse::<f64>().ok())
        .map(|v| v.clamp(0.0, 1.0))
        .unwrap_or(0.0)
}

/// Die AMTLICHE Adresse. Nur was hierher zeigt, erzeugt rechtsgültige
/// Signaturen nach § 146a AO.
pub const FISKALY_PRODUKTIV: &str = "https://kassensichv.fiskaly.com/api/v2";

/// Gegen WELCHE Sicherungseinrichtung diese Kasse wirklich signiert.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FiskalUmgebung {
    /// Die amtliche Umgebung. Signaturen sind rechtsgültig.
    Produktiv,
    /// Eine Erprobungsumgebung. ⚠️ Die Signaturen sind WERTLOS.
    Erprobung { adresse: String },
}

impl FiskalUmgebung {
    /// Sind die Signaturen dieser Umgebung vor dem Finanzamt etwas wert?
    pub fn ist_rechtsgueltig(&self) -> bool {
        matches!(self, FiskalUmgebung::Produktiv)
    }

    pub fn adresse(&self) -> &str {
        match self {
            FiskalUmgebung::Produktiv => FISKALY_PRODUKTIV,
            FiskalUmgebung::Erprobung { adresse } => adresse,
        }
    }
}

/// ⚠️ BEFUND vom 13.08.2026: derselbe halbe Fix an derselben Ampel.
///
/// Die Attrappe bekam 2026 einen Riegel für den Freigabebau (siehe
/// `attrappe_entscheiden` oben). Der Schalter für die fiskaly-ADRESSE bekam
/// keinen. Gemessen: ausserhalb dieser Datei wird
/// `NORNS_FISKALY_BASE_URL` nur in `tests/tse_hil.rs` gesetzt, und in
/// der ganzen Fläche gibt es NULL Treffer für „Testumgebung" oder
/// „Produktivumgebung".
///
/// Damit konnte eine ausgelieferte Kasse mit EINER Umgebungsvariablen gegen
/// die Erprobungsumgebung signieren, und alles sah grün aus: grüne Ampel,
/// signierte Belege, QR-Codes, DSFinV-K-Ausfuhr. Nur wäre jede einzelne
/// Signatur vor dem Finanzamt wertlos gewesen, und der Händler hätte es am
/// Tag der Prüfung erfahren, mit Jahren ungültiger Aufzeichnungen.
///
/// ── WARUM HIER NICHT GESPERRT, SONDERN GEMELDET WIRD ──────────────────
///
/// Bei der Attrappe ist Sperren richtig: eine erfundene Signatur hat NIE
/// einen Zweck im Laden. Eine Erprobungsumgebung hat sehr wohl einen: ohne
/// sie lässt sich der fiskalische Weg nie üben, und genau daran hängt dieses
/// Haus gerade fest. Ein Riegel würde die Erprobung unmöglich machen und
/// damit die Qualität senken, nicht heben.
///
/// Die Gefahr ist nicht die Erprobung. Die Gefahr ist die VERWECHSLUNG.
/// Deshalb wird die Umgebung nie verschwiegen: sie ist ein eigener Zustand,
/// den die Fläche und der BELEG zeigen müssen. Ein Erprobungsbeleg, der
/// aussieht wie ein echter, ist der eigentliche Defekt.
///
/// Rein und mit dem Bauprofil als ARGUMENT, damit der Wächter sie in JEDEM
/// Profil messen kann — dieselbe Begründung wie bei `attrappe_entscheiden`.
pub fn fiskal_umgebung_entscheiden(schalter: Option<&str>) -> FiskalUmgebung {
    match schalter.map(str::trim).filter(|s| !s.is_empty()) {
        None => FiskalUmgebung::Produktiv,
        Some(a) if a.trim_end_matches('/') == FISKALY_PRODUKTIV.trim_end_matches('/') => {
            FiskalUmgebung::Produktiv
        }
        Some(a) => FiskalUmgebung::Erprobung {
            adresse: a.to_string(),
        },
    }
}

/// Die Umgebung dieser Kasse, ehrlich.
pub fn fiskal_umgebung() -> FiskalUmgebung {
    let schalter = std::env::var("NORNS_FISKALY_BASE_URL").ok();
    fiskal_umgebung_entscheiden(schalter.as_deref())
}

/// Fiskaly base URL — overridable for the test sandbox vs. production.
/// Defaults to the EU production endpoint.
pub fn fiskaly_base_url() -> String {
    fiskal_umgebung().adresse().to_string()
}

/// Five-second timeout for every TCP hardware call. A hung printer or
/// terminal must never freeze the POS — the operator's next action is
/// always to retry or skip.
pub const DEFAULT_TCP_TIMEOUT_MS: u64 = 5_000;

/// Read-timeout (ms) for the ZVT cardholder-interaction phase. Defaults to
/// 75 s — a cardholder can take that long to enter a PIN. Overridable via
/// `NORNS_ZVT_READ_TIMEOUT_MS` (same env-config style as the mock/base-URL
/// switches) so the HIL integration tests can exercise the timeout path against
/// a deliberately-silent terminal without a 75 s wait. Production never sets it.
pub fn zvt_read_timeout_ms() -> u64 {
    std::env::var("NORNS_ZVT_READ_TIMEOUT_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|&v| v > 0)
        .unwrap_or(75_000)
}

/// Fiskaly HTTPS calls get a longer budget — the EU endpoint can take 4 s
/// to issue a signature under load. 10 s leaves headroom without making
/// the operator feel the wait beyond the spinner.
pub const FISKALY_HTTP_TIMEOUT_MS: u64 = 10_000;

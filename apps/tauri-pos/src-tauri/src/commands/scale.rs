//! USB digital scale over serial (Mettler-Toledo MT-SICS protocol).
//!
//! `read_scale_weight` opens the serial port, sends the `S` stable-weight
//! request, reads the ASCII reply, and parses the grams value. `list_scale_ports`
//! enumerates the available serial ports for the Gerätemanager dropdown.
//!
//! MT-SICS stable-weight reply shape (response to the `S` command):
//!   `S S      14.50 g`   → status1=S, status2=S (Stable), value, unit
//!   `S D      14.50 g`   → D = Dynamic (not yet settled)
//!   `S I` / `S +` / `S -`→ command not executable / over- / under-load
//!
//! The serial I/O runs on a blocking thread (`spawn_blocking`) so it never
//! stalls the async runtime. Parsing is split into a pure `parse_mt_sics`
//! function so it is unit-testable without hardware.

use std::io::{BufRead, BufReader, Write};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::error::{HardwareError, HwResult};

/// Default baud rate for MT-SICS scales.
const DEFAULT_BAUD: u32 = 9600;
/// How long to wait for the scale to answer before giving up on a single read.
const READ_TIMEOUT: Duration = Duration::from_millis(2000);
/// Overall budget to obtain a STABLE reading: we re-poll while the scale keeps
/// answering Dynamic (`S D`), but never longer than this. On expiry we surface a
/// Timeout — never a fabricated or unsettled weight (payout accuracy is sacred).
const STABLE_DEADLINE: Duration = Duration::from_millis(4000);
/// Hard cap on re-poll iterations so a chatty port cannot spin forever.
const STABLE_MAX_ATTEMPTS: u32 = 24;
/// Pause between re-polls while waiting for the weight to settle.
const STABLE_POLL_PAUSE: Duration = Duration::from_millis(150);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeightReading {
    /// Weight in grams, as the scale reported it (string preserves trailing zeros).
    pub grams: String,
}

/// Parse a single MT-SICS `S` reply line into a [`WeightReading`].
///
/// Pure + total — never panics. Only a STABLE (`S S`) reply yields a weight; a
/// Dynamic (`S D`) reply is REJECTED, not accepted, because an unsettled weight
/// would mis-price an Ankauf payout by grams. The transport layer re-polls on a
/// Dynamic reply (see [`is_dynamic_reply`]); over/underload and garbage are hard
/// errors that must not be retried.
pub fn parse_mt_sics(raw: &str) -> HwResult<WeightReading> {
    let line = raw.trim();
    let mut tokens = line.split_whitespace();

    // Token 0 must be the `S` response identifier.
    if tokens.next() != Some("S") {
        return Err(HardwareError::Device(format!(
            "unexpected MT-SICS response (no 'S' identifier): {line:?}"
        )));
    }

    // Token 1 is the weight status: only S (stable) is a usable reading.
    match tokens.next() {
        Some("S") => {}
        Some("D") => {
            return Err(HardwareError::Device(
                "scale: dynamic (unsettled) weight rejected (S D)".to_string(),
            ));
        }
        Some("I") => {
            return Err(HardwareError::Device(
                "scale: command not executable (S I)".to_string(),
            ));
        }
        Some("+") => return Err(HardwareError::Device("scale: overload (S +)".to_string())),
        Some("-") => return Err(HardwareError::Device("scale: underload (S -)".to_string())),
        other => {
            return Err(HardwareError::Device(format!(
                "scale: unexpected status token {other:?} in {line:?}"
            )));
        }
    }

    // Token 2 is the numeric weight; validate it parses, but return the original
    // string so we keep the scale's exact precision (e.g. "14.50", not "14.5").
    let value = tokens
        .next()
        .ok_or_else(|| HardwareError::Device(format!("scale: no weight value in {line:?}")))?;
    if value.parse::<f64>().is_err() {
        return Err(HardwareError::Device(format!(
            "scale: non-numeric weight {value:?} in {line:?}"
        )));
    }

    // Token 3 ist die EINHEIT, und bis zum 22.08.2026 hat sie niemand gelesen.
    pruefe_einheit(tokens.next(), line)?;

    Ok(WeightReading {
        grams: value.to_string(),
    })
}

/// ═══════════════════════════════════════════════════════════════════════════
///  ⛔ DIE EINHEIT WAR DAS UNGELESENE VIERTE WORT
/// ═══════════════════════════════════════════════════════════════════════════
///
/// ── DER BEFUND VOM 22.08.2026 ──────────────────────────────────────────────
///
/// Eine MT-SICS-Antwort lautet `S S      14.50 g` — Kennung, Zustand, Wert,
/// EINHEIT. Der Leser prüfte Kennung und Zustand peinlich genau (`D`, `I`,
/// `+`, `-` haben je einen eigenen Fehler) und bewahrte sogar die
/// Nachkommastellen als Zeichenkette. Das vierte Wort las er nie. Das Feld
/// heisst `grams`, und das ganze Haus rechnet damit in Gramm.
///
/// ⚠️ EINE JUWELIERWAAGE IST GENAU DIE WAAGE, DIE UMGESTELLT WIRD. Waagen
/// dieser Bauart können nach Karat (ct), Feinunze (ozt), Pennyweight (dwt),
/// Unze (oz) oder Kilogramm wiegen, und bei Edelmetall und Steinen ist das
/// der übliche Gebrauch, nicht die Ausnahme.
///
/// Was das am Ankaufstisch heisst, wenn niemand die Einheit liest:
///
/// ```text
/// Karat (1 ct = 0,2 g)      „14,50" sind 2,9 g, gebucht als 14,50 g
///                           → Basel zahlt das FÜNFFACHE.
/// Feinunze (1 ozt ≈ 31,1 g) „1,00" sind 31,1 g, gebucht als 1 g
///                           → der Verkäufer bekommt ein Dreissigstel.
/// ```
///
/// ⚠️ Der Block trägt `text`: ohne ihn hält Rust eine eingerückte Zeile in
/// einem `///`-Kommentar für RUST und übersetzt sie als Doku-Probe. Genau
/// daran ist der volle Lauf zuerst gescheitert.
///
/// Und keine Zahl sieht dabei falsch aus. Das ist die gefährlichste Form:
/// nicht falsch, sondern STILL.
///
/// ── ⚠️ WARUM HIER NICHT UMGERECHNET WIRD ───────────────────────────────────
///
/// Der naheliegende Weg wäre eine Umrechnungstabelle. Er wird bewusst NICHT
/// gegangen: dann hinge der Ankaufpreis an Faktoren, die hier niemand gegen
/// ein echtes Gerät messen kann, und ein falscher Faktor wäre wieder ein
/// stiller Geldfehler. Ein klarer Halt mit dem Namen der gemeldeten Einheit
/// kann nicht still danebenliegen, und die Waage auf Gramm zu stellen ist
/// eine einmalige Handgriff am Gerät.
///
/// Wer später eine Tabelle nachrüsten will, hat mit dieser Funktion genau
/// EINE Stelle dafür — und sollte sie gegen ein echtes Gerät messen.
///
/// ── UND WARUM EINE FEHLENDE EINHEIT DURCHGEHT ──────────────────────────────
///
/// Der Norm nach steht die Einheit immer da. Fehlt sie trotzdem, ist damit
/// NICHT bewiesen, dass die Waage falsch steht — nur, dass sie schweigt. Eine
/// Waage abzulehnen, die heute richtig arbeitet, wäre ein erfundener Fehler.
/// Abgelehnt wird, was NACHWEISLICH nicht Gramm ist.
fn pruefe_einheit(einheit: Option<&str>, line: &str) -> HwResult<()> {
    let Some(roh) = einheit else { return Ok(()) };
    let e = roh.trim().to_ascii_lowercase();
    // ⚠️ `gr` steht bewusst mit drin. MT-SICS schreibt `g`, aber Geraete am
    // Markt melden auch `gr`, und das meint zweifelsfrei Gramm (Gran hiesse
    // `GN`). Zu streng zu sein hiesse hier: Basels Ankauf steht still, mit
    // einer Meldung ueber eine Einheit, die in Wahrheit die richtige ist.
    // Ein Fehlalarm an dieser Stelle kostet den Verkaufstag.
    if e == "g" || e == "gr" || e == "gram" || e == "grams" || e == "gramm" {
        return Ok(());
    }
    Err(HardwareError::Device(format!(
        "Die Waage wiegt in {roh:?}, nicht in Gramm ({line:?}). Der Ankaufpreis          wird je Gramm gerechnet; eine andere Einheit als Gramm zu buchen waere          ein stiller Geldfehler. Bitte die Waage auf Gramm umstellen."
    )))
}

/// True iff `raw` is a well-formed Dynamic (`S D …`) reply. The transport loop
/// uses this to decide "re-poll and wait for it to settle" versus "this is a
/// hard error, give up" — an overload or garbage line is NOT dynamic and must
/// not be retried.
pub fn is_dynamic_reply(raw: &str) -> bool {
    let mut tokens = raw.trim().split_whitespace();
    tokens.next() == Some("S") && tokens.next() == Some("D")
}

/// Parse an MT-SICS tare (`T`) reply. A successful tare answers `T S …`;
/// `T I` (not executable) / `T +` / `T -` (over/underload) are errors.
///
/// Pure + total — never panics.
pub fn parse_mt_sics_tare(raw: &str) -> HwResult<()> {
    let line = raw.trim();
    let mut tokens = line.split_whitespace();

    if tokens.next() != Some("T") {
        return Err(HardwareError::Device(format!(
            "unexpected MT-SICS tare response (no 'T' identifier): {line:?}"
        )));
    }

    match tokens.next() {
        Some("S") => Ok(()),
        Some("I") => Err(HardwareError::Device(
            "scale: tare not executable (T I)".to_string(),
        )),
        Some("+") => Err(HardwareError::Device(
            "scale: tare overload (T +)".to_string(),
        )),
        Some("-") => Err(HardwareError::Device(
            "scale: tare underload (T -)".to_string(),
        )),
        other => Err(HardwareError::Device(format!(
            "scale: unexpected tare status token {other:?} in {line:?}"
        ))),
    }
}

/// Blocking serial round-trip for a STABLE weight: open the port, then re-poll
/// `S` while the scale answers Dynamic (`S D`) until it settles — bounded by both
/// an attempt cap and a wall-clock deadline. On expiry we return a Timeout rather
/// than a stale or unsettled weight; over/underload and garbage propagate their
/// hard `Device` error immediately (no retry).
fn read_scale_blocking(port_path: &str, baud: u32) -> HwResult<WeightReading> {
    let port = serialport::new(port_path, baud)
        .timeout(READ_TIMEOUT)
        .open()
        .map_err(|e| HardwareError::Device(format!("open serial port {port_path:?}: {e}")))?;

    // Clone a writer handle, then wrap the port in a buffered reader for the line.
    let mut writer = port
        .try_clone()
        .map_err(|e| HardwareError::Device(format!("clone serial handle: {e}")))?;
    let mut reader = BufReader::new(port);

    let deadline = Instant::now() + STABLE_DEADLINE;
    for _ in 0..STABLE_MAX_ATTEMPTS {
        writer
            .write_all(b"S\r\n")
            .map_err(|e| HardwareError::Device(format!("write MT-SICS request: {e}")))?;
        writer
            .flush()
            .map_err(|e| HardwareError::Device(format!("flush serial port: {e}")))?;

        let mut line = String::new();
        reader
            .read_line(&mut line)
            .map_err(|e| HardwareError::Timeout(format!("read scale reply: {e}")))?;

        // Empty line or an unsettled reading → wait and re-poll, unless the
        // stability budget is spent.
        if line.trim().is_empty() || is_dynamic_reply(&line) {
            if Instant::now() >= deadline {
                return Err(HardwareError::Timeout(
                    "scale: weight did not settle within timeout".to_string(),
                ));
            }
            std::thread::sleep(STABLE_POLL_PAUSE);
            continue;
        }

        // Stable reading or a hard error (overload / garbage) — both are final.
        return parse_mt_sics(&line);
    }

    Err(HardwareError::Timeout(
        "scale: weight did not settle within the attempt budget".to_string(),
    ))
}

/// Blocking serial round-trip to tare (zero) the scale: open, send `T`, read the
/// acknowledgement, parse. A tare that the scale cannot execute surfaces as an
/// error rather than silently leaving a non-zero offset.
fn tare_scale_blocking(port_path: &str, baud: u32) -> HwResult<()> {
    let port = serialport::new(port_path, baud)
        .timeout(READ_TIMEOUT)
        .open()
        .map_err(|e| HardwareError::Device(format!("open serial port {port_path:?}: {e}")))?;

    let mut writer = port
        .try_clone()
        .map_err(|e| HardwareError::Device(format!("clone serial handle: {e}")))?;
    writer
        .write_all(b"T\r\n")
        .map_err(|e| HardwareError::Device(format!("write MT-SICS tare request: {e}")))?;
    writer
        .flush()
        .map_err(|e| HardwareError::Device(format!("flush serial port: {e}")))?;

    let mut reader = BufReader::new(port);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|e| HardwareError::Timeout(format!("read scale tare reply: {e}")))?;
    if line.trim().is_empty() {
        return Err(HardwareError::Timeout(
            "scale: no tare reply within timeout".to_string(),
        ));
    }
    parse_mt_sics_tare(&line)
}

/// Read a stable weight from the scale at `port_path` (baud configurable).
#[tauri::command]
pub async fn read_scale_weight(
    port_path: String,
    baud_rate: Option<u32>,
) -> HwResult<WeightReading> {
    if crate::config::is_mock_mode() {
        return Ok(WeightReading {
            grams: "14.50".to_string(),
        });
    }
    let baud = baud_rate.unwrap_or(DEFAULT_BAUD);
    tokio::task::spawn_blocking(move || read_scale_blocking(&port_path, baud))
        .await
        .map_err(|e| HardwareError::Internal(format!("scale task join: {e}")))?
}

/// Tare (zero) the scale at `port_path`. In mock mode this is a no-op success.
#[tauri::command]
pub async fn tare_scale(port_path: String, baud_rate: Option<u32>) -> HwResult<()> {
    if crate::config::is_mock_mode() {
        return Ok(());
    }
    let baud = baud_rate.unwrap_or(DEFAULT_BAUD);
    tokio::task::spawn_blocking(move || tare_scale_blocking(&port_path, baud))
        .await
        .map_err(|e| HardwareError::Internal(format!("scale tare task join: {e}")))?
}

/// Enumerate available serial ports (paths) for the operator to choose from.
#[tauri::command]
pub async fn list_scale_ports() -> HwResult<Vec<String>> {
    if crate::config::is_mock_mode() {
        return Ok(vec!["/dev/tty.mock-scale".to_string()]);
    }
    let ports = serialport::available_ports()
        .map_err(|e| HardwareError::Device(format!("enumerate serial ports: {e}")))?;
    Ok(ports.into_iter().map(|p| p.port_name).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_stable_mt_sics_reply() {
        let reading = parse_mt_sics("S S      14.50 g\r\n").expect("should parse");
        assert_eq!(reading.grams, "14.50");
    }

    #[test]
    fn rejects_dynamic_reply() {
        // A Dynamic (unsettled) reading must NOT yield a weight — using it would
        // mis-price an Ankauf payout. The transport layer re-polls instead.
        assert!(parse_mt_sics("S D      3.20 g").is_err());
    }

    #[test]
    fn is_dynamic_reply_only_matches_s_d() {
        assert!(is_dynamic_reply("S D      3.20 g"));
        assert!(is_dynamic_reply("  S D 0.00 g\r\n"));
        assert!(!is_dynamic_reply("S S      14.50 g"));
        assert!(!is_dynamic_reply("S +"));
        assert!(!is_dynamic_reply("S I"));
        assert!(!is_dynamic_reply("garbage line"));
        assert!(!is_dynamic_reply(""));
    }

    #[test]
    fn lehnt_karat_und_feinunze_ab() {
        // ⛔ 22.08.2026: bis heute gingen beide durch und wurden als GRAMM
        // gebucht. Karat waere das Fuenffache, Feinunze ein Dreissigstel.
        let karat = parse_mt_sics("S S      14.50 ct").expect_err("ct must not pass");
        assert!(format!("{karat:?}").contains("Gramm"), "{karat:?}");
        assert!(parse_mt_sics("S S       1.00 ozt").is_err());
        assert!(parse_mt_sics("S S       1.00 oz").is_err());
        assert!(parse_mt_sics("S S       0.50 kg").is_err());
        assert!(parse_mt_sics("S S      10.00 dwt").is_err());
    }

    #[test]
    fn nimmt_gramm_in_jeder_schreibweise() {
        assert_eq!(parse_mt_sics("S S 14.50 g").expect("g").grams, "14.50");
        assert_eq!(parse_mt_sics("S S 14.50 G").expect("G").grams, "14.50");
        assert_eq!(parse_mt_sics("S S 14.50 gram").expect("gram").grams, "14.50");
        assert_eq!(parse_mt_sics("S S 14.50 gr").expect("gr").grams, "14.50");
        // Fehlt die Einheit ganz, ist NICHT bewiesen, dass die Waage falsch
        // steht. Eine heute richtig arbeitende Waage abzulehnen waere ein
        // erfundener Fehler.
        assert_eq!(parse_mt_sics("S S 14.50").expect("ohne Einheit").grams, "14.50");
    }

    #[test]
    fn rejects_overload_and_garbage() {
        assert!(parse_mt_sics("S +").is_err());
        assert!(parse_mt_sics("S I").is_err());
        assert!(parse_mt_sics("garbage line").is_err());
        assert!(parse_mt_sics("S S not_a_number g").is_err());
    }

    #[test]
    fn parses_successful_tare() {
        assert!(parse_mt_sics_tare("T S       0.00 g").is_ok());
        assert!(parse_mt_sics_tare("T S\r\n").is_ok());
    }

    #[test]
    fn rejects_failed_or_malformed_tare() {
        assert!(parse_mt_sics_tare("T I").is_err()); // not executable
        assert!(parse_mt_sics_tare("T +").is_err()); // overload
        assert!(parse_mt_sics_tare("T -").is_err()); // underload
        assert!(parse_mt_sics_tare("S S 1.00 g").is_err()); // wrong identifier
        assert!(parse_mt_sics_tare("garbage").is_err());
    }
}

// ════════════════════════════════════════════════════════════════════════
//  Die Waage FINDEN — Basels Auftrag vom 21.08.2026
// ════════════════════════════════════════════════════════════════════════
//
// „المفروض الجهاز يكتشف ويعرض الاجهزة المتصلة" — das Gerät soll erkannt
// werden, nicht in einem Klappmenü gesucht. Ein Anschlussname wie
// `/dev/tty.usbserial-1420` sagt einem Händler NICHTS.
//
// ── WIE GESUCHT WIRD, UND WARUM GENAU SO ───────────────────────────────────
//
// Jeder serielle Anschluss bekommt bei den zwei üblichen Geschwindigkeiten
// (9600, 19200) EINMAL `SI\r\n` gesendet — die SICS-Sofortabfrage, die auch
// eine unruhige Waage sofort beantwortet („S D …"). Antwortet etwas in
// SICS-Form, ist es eine Waage der MT-SICS-Familie: Mettler-Toledo selbst,
// und dazu die vielen, die das Protokoll nachsprechen (A&D im MT-Format,
// etliche OEM-Ladenwaagen). Kern spricht ein eigenes Protokoll und wird hier
// EHRLICH nicht gefunden — der Weg über das Klappmenü bleibt ja stehen.
//
// ⚠️ ZWEI BYTES AN FREMDE GERÄTE. Die Suche schreibt `SI` auch an Anschlüsse,
// hinter denen keine Waage steckt. Das ist Stand der Technik jeder
// Waagensuche und hier vertretbar: die Kasse spricht seriell NUR mit der
// Waage (Kartenterminal läuft über TCP, die TSE über die Wolke), und `SI`
// ist als reine Abfrage gewählt — kein Tarieren, kein Nullstellen, nichts,
// was an einem falschen Gerät einen Zustand ändert.
//
// ⚠️ KURZE FRIST (400 ms je Versuch): die Suche läuft beim Öffnen der
// Geräteseite; acht tote Anschlüsse dürfen keine acht Sekunden kosten.

/// Wonach die Suche fragt: die SICS-Sofortabfrage.
const SUCHE_BEFEHL: &[u8] = b"SI\r\n";
/// Je Anschluss und Geschwindigkeit EIN kurzer Versuch.
const SUCHE_TIMEOUT: Duration = Duration::from_millis(400);
/// Die zwei Geschwindigkeiten, die praktisch vorkommen.
const SUCHE_BAUDS: [u32; 2] = [9600, 19_200];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GefundeneWaage {
    pub port: String,
    pub baud: u32,
    /// Die rohe Antwortzeile — der Beweis, nicht eine Behauptung.
    pub antwort: String,
}

/// Sieht diese Zeile nach einer SICS-Waage aus?
///
/// Rein und total, damit die Probe sie ohne Draht messen kann. Absichtlich
/// WEITER als `parse_mt_sics`: auch `S D` (unruhig), `S +`/`S -` (Über-,
/// Unterlast) und `S I` beweisen, dass DORT eine Waage antwortet — nur ein
/// verwertbares GEWICHT sind sie nicht.
pub fn sieht_nach_sics_aus(zeile: &str) -> bool {
    let mut teile = zeile.trim().split_whitespace();
    if teile.next() != Some("S") {
        return false;
    }
    matches!(teile.next(), Some("S" | "D" | "I" | "+" | "-"))
}

/// Einen Anschluss bei EINER Geschwindigkeit anfragen.
fn frage_anschluss(port_path: &str, baud: u32) -> Option<String> {
    let port = serialport::new(port_path, baud)
        .timeout(SUCHE_TIMEOUT)
        .open()
        .ok()?;
    let mut writer = port.try_clone().ok()?;
    let mut reader = BufReader::new(port);
    writer.write_all(SUCHE_BEFEHL).ok()?;
    writer.flush().ok()?;
    let mut zeile = String::new();
    reader.read_line(&mut zeile).ok()?;
    let zeile = zeile.trim().to_string();
    if sieht_nach_sics_aus(&zeile) {
        Some(zeile)
    } else {
        None
    }
}

/// Alle Anschlüsse absuchen. Blockierend — der Rufer hebt es in
/// `spawn_blocking`.
fn suche_blocking() -> Vec<GefundeneWaage> {
    let ports = serialport::available_ports()
        .map(|p| p.into_iter().map(|i| i.port_name).collect::<Vec<_>>())
        .unwrap_or_default();
    let mut raus = Vec::new();
    for port in ports {
        // Bluetooth-Modemanschlüsse des Systems blockieren beim Öffnen gern
        // sekundenlang — und eine Waage hängt nie daran.
        if port.contains("Bluetooth") || port.contains("debug-console") {
            continue;
        }
        for baud in SUCHE_BAUDS {
            if let Some(antwort) = frage_anschluss(&port, baud) {
                raus.push(GefundeneWaage {
                    port: port.clone(),
                    baud,
                    antwort,
                });
                break; // die erste antwortende Geschwindigkeit genügt
            }
        }
    }
    raus
}

#[tauri::command]
pub async fn scale_suchen() -> HwResult<Vec<GefundeneWaage>> {
    tokio::task::spawn_blocking(suche_blocking)
        .await
        .map_err(|e| HardwareError::Device(format!("Die Waagensuche brach ab: {e}")))
}

#[cfg(test)]
mod suche_tests {
    use super::*;

    #[test]
    fn erkennt_die_sics_familie_auch_unruhig() {
        assert!(sieht_nach_sics_aus("S S      14.50 g"));
        assert!(sieht_nach_sics_aus("S D       3.2 g"), "unruhig ist trotzdem eine Waage");
        assert!(sieht_nach_sics_aus("S +"), "Ueberlast ist trotzdem eine Waage");
        assert!(sieht_nach_sics_aus("S I"));
    }

    #[test]
    fn erkennt_fremdes_geraet_nicht_als_waage() {
        assert!(!sieht_nach_sics_aus(""));
        assert!(!sieht_nach_sics_aus("AT+OK"), "ein Modem");
        assert!(!sieht_nach_sics_aus("ES"), "SICS-Fehlerzeile ohne S-Kopf");
        assert!(!sieht_nach_sics_aus("Sonstiges Rauschen"));
    }
}

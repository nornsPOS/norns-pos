//! sicherung — die Bücher des Händlers auf einen zweiten Datenträger.
//!
//! ── WARUM DAS KEINE KÜR IST ─────────────────────────────────────────────────
//!
//! Ein Händler mit einer Kasse ohne Sicherung hat nach dem ersten Plattenfehler
//! keine Bücher mehr. Nach § 147 AO muss er zehn Jahre lang vorlegen können,
//! was in dieser Datenbank steht. Das ist kein Ärgernis, sondern eine
//! Pflichtverletzung, und sie fällt IHM zur Last, nicht der Platte.
//!
//! In Warehouse14 sichert der Server auf der Serverseite. Norns POS hat keine
//! Serverseite: die Datenbank liegt im Gerät, und wenn das Gerät stirbt, stirbt
//! alles mit. Deshalb gehört die Sicherung hier in die Kasse selbst.
//!
//! ── WER WAS TUT ─────────────────────────────────────────────────────────────
//!
//! Sitzung A hat den schweren Teil gebaut, und zwar im selben `start.mjs`:
//! ein zweiter Aufrufmodus `--sicherung <zielordner>`. Er braucht nur
//! `NORNS_DATENORT` und `NORNS_DB_PASSWORT` — die übrigen Geheimnisse gehen
//! ihn nichts an, und was er nicht braucht, bekommt er auch nicht.
//!
//! Läuft die Kasse gerade, benutzt er ihre Instanz; steht sie, startet er
//! Postgres kurz selbst. Beides ist seine Sache, nicht unsere.
//!
//! Der Rumpf tut hier nur zweierlei: den Modus starten und die Fertigmeldung
//! lesen. Es ist DIESELBE Leseform wie beim Motor (siehe `motor.rs`), und das
//! ist Absicht: eine Zeile mit einer Marke am Anfang, alles davor ist
//! Geplauder, und der Abbruchgrund steht auf der Fehlerausgabe.
//!
//! ── WAS DIESE DATEI NICHT TUT ───────────────────────────────────────────────
//!
//! Sie behauptet keinen Erfolg, den sie nicht gelesen hat. Kommt die
//! Fertigmeldung nicht, gilt die Sicherung als NICHT gemacht — auch wenn im
//! Zielordner schon etwas liegt. Eine halb geschriebene Datei, die als
//! „fertig" gemeldet wird, ist schlimmer als gar keine: der Händler verlässt
//! sich darauf.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Die Zeile, an der der Rumpf erkennt, dass die Sicherung steht.
const FERTIG: &str = "NORNS_SICHERUNG_FERTIG";

/// Was am Ende herauskam, in Zahlen, die der Händler sehen darf.
///
/// Die Zahlen sind wichtiger als das Wort „fertig": eine Sicherung mit null
/// Zeilen ist ein grüner Haken über einem leeren Ordner, und genau so eine
/// hat in diesem Haus schon einmal wie Erfolg ausgesehen.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Sicherungsbericht {
    pub datei: String,
    pub tabellen: u64,
    pub zeilen: u64,
    pub sequenzen: u64,
}

/// Ein Feld aus der Fertigmeldung ziehen.
///
/// Bewusst ohne JSON-Bibliothek, aus demselben Grund wie in `motor.rs`: die
/// Zeile ist ein Vertrag zwischen zwei Dateien, die wir beide besitzen.
fn zahl_aus(zeile: &str, feld: &str) -> Option<u64> {
    let marke = format!("\"{feld}\"");
    let i = zeile.find(&marke)?;
    zeile[i + marke.len()..]
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse()
        .ok()
}

fn text_aus(zeile: &str, feld: &str) -> Option<String> {
    let marke = format!("\"{feld}\"");
    let i = zeile.find(&marke)? + marke.len();
    let rest = &zeile[i..];
    let auf = rest.find('"')? + 1;
    let zu = rest[auf..].find('"')? + auf;
    Some(rest[auf..zu].to_string())
}

/// Die Fertigmeldung lesen. `None`, wenn es keine ist.
pub fn bericht_aus_zeile(zeile: &str) -> Option<Sicherungsbericht> {
    let rest = zeile.trim().strip_prefix(FERTIG)?;
    Some(Sicherungsbericht {
        // Ohne Dateinamen ist die Meldung wertlos: der Händler soll die Datei
        // finden können, nicht nur wissen, dass es sie gibt.
        datei: text_aus(rest, "datei")?,
        tabellen: zahl_aus(rest, "tabellen").unwrap_or(0),
        zeilen: zahl_aus(rest, "zeilen").unwrap_or(0),
        sequenzen: zahl_aus(rest, "sequenzen").unwrap_or(0),
    })
}

/// Die Sicherung fahren und auf ihre Fertigmeldung warten.
pub fn sichern(
    laeufer: &Path,
    skript: &Path,
    datenort: &Path,
    ziel: &Path,
    db_passwort: &str,
) -> Result<Sicherungsbericht, String> {
    if !laeufer.exists() || !skript.exists() {
        return Err("Die Kasse ist unvollständig installiert.".into());
    }
    std::fs::create_dir_all(ziel)
        .map_err(|e| format!("Der Zielordner lässt sich nicht anlegen: {e}"))?;

    let mut befehl = std::process::Command::new(laeufer);
    befehl
        .arg(skript)
        .arg("--sicherung")
        .arg(ziel)
        // NUR die zwei, die dieser Modus braucht. Was er nicht braucht,
        // bekommt er nicht: ein Sicherungslauf hat mit dem Sitzungsschlüssel
        // der Kasse nichts zu tun.
        .env("NORNS_DATENORT", datenort)
        .env("NORNS_DB_PASSWORT", db_passwort)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        befehl.creation_flags(CREATE_NO_WINDOW);
    }

    let mut kind = befehl
        .spawn()
        .map_err(|e| format!("Die Sicherung startete nicht: {e}"))?;

    // ── Auch die Sicherung gehört in den Verbund ────────────────────────────
    //
    // Auf Bitte von Sitzung A, und ihre Begründung ist die richtige: steht die
    // Kasse gerade, startet der Sicherungsmodus Postgres SELBST. Stirbt dieser
    // Lauf dann hart, bleibt seine eigene Waise liegen und hält das
    // Datenverzeichnis — bis zum nächsten Start, der sie erlöst.
    //
    // Genau diese Lücke ZWISCHEN Tod und nächstem Start kann ihr Ordnungsweg
    // nicht schliessen, meiner schon: Windows beendet den Verbund in dem
    // Moment, in dem die Kasse endet, nicht erst beim nächsten Mal.
    //
    // Dieselbe Bauform wie beim Motor (`motor.rs`), absichtlich. Zwei Wände an
    // zwei Prozessen; keine ersetzt die andere.
    let _ = crate::verbund::an_die_kasse_binden(kind.id());

    let letzte_worte: std::sync::Arc<Mutex<Vec<String>>> =
        std::sync::Arc::new(Mutex::new(Vec::new()));
    if let Some(fehlerstrom) = kind.stderr.take() {
        let fach = std::sync::Arc::clone(&letzte_worte);
        std::thread::spawn(move || {
            for zeile in BufReader::new(fehlerstrom).lines().map_while(Result::ok) {
                if let Ok(mut f) = fach.lock() {
                    if f.len() >= 12 {
                        f.remove(0);
                    }
                    f.push(zeile);
                }
            }
        });
    }

    let mut bericht = None;
    if let Some(ausgabe) = kind.stdout.take() {
        for zeile in BufReader::new(ausgabe).lines().map_while(Result::ok) {
            if let Some(b) = bericht_aus_zeile(&zeile) {
                bericht = Some(b);
            }
        }
    }
    let _ = kind.wait();

    // Erst die Meldung, dann der Erfolg. Liegt schon etwas im Zielordner, aber
    // die Meldung fehlt, ist die Sicherung NICHT gemacht.
    match bericht {
        Some(b) => Ok(b),
        None => {
            let zeilen = letzte_worte.lock().map(|z| z.clone()).unwrap_or_default();
            let grund = zeilen
                .iter()
                .rev()
                .find(|z| z.contains("ABBRUCH"))
                .or_else(|| zeilen.iter().rev().find(|z| !z.trim().is_empty()))
                .map(|z| {
                    z.trim()
                        .strip_prefix("[norns-sidecar]")
                        .unwrap_or(z.trim())
                        .trim()
                        .to_string()
                });
            Err(grund.unwrap_or_else(|| {
                "Die Sicherung meldete sich nicht. Sie gilt als NICHT gemacht.".into()
            }))
        }
    }
}

/// ⛔ LÄUFT GERADE EINE SICHERUNG?
///
/// ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
///
/// `sicherung_jetzt` hatte KEINEN Riegel gegen einen zweiten Lauf. Zwei
/// gleichzeitige Sicherungen schrieben wegen des Minutenstempels in DIESELBE
/// Datei; der zweite kürzte sie mit `writeFileSync`, und beide meldeten am
/// Ende `NORNS_SICHERUNG_FERTIG` mit Zahlen. Der Händler sah zwei gelungene
/// Sicherungen und hatte eine halbe Datei.
///
/// ⚠️ Das `laeuft` in der Oberfläche ist KEIN Riegel: es stirbt beim
/// Aushängen der Sektion (`Einstellungen.tsx` hängt sie aus, sobald der
/// Mensch den Reiter wechselt). Der Riegel gehört in den Rumpf, wo er den
/// Prozess überlebt.
///
/// Ein Erfolgsbericht mit Zahlen über einer zerschossenen Pflichtaufzeichnung
/// wäre schlimmer als gar keine Sicherung: er beendet die Suche.
static LAEUFT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Nimmt den Riegel und gibt ihn beim Verlassen des Bereichs zurück — auch
/// bei einem frühen `?`, und genau deshalb ein eigener Typ statt zweier
/// Aufrufe, von denen der zweite vergessen werden kann.
struct Einmalriegel;

impl Einmalriegel {
    fn nehmen() -> Option<Self> {
        use std::sync::atomic::Ordering;
        LAEUFT
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| Einmalriegel)
    }
}

impl Drop for Einmalriegel {
    fn drop(&mut self) {
        LAEUFT.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

/// Der Knopf „Sicherung jetzt" aus den Einstellungen.
#[tauri::command]
pub fn sicherung_jetzt(
    app: tauri::AppHandle,
    zielordner: String,
) -> Result<Sicherungsbericht, String> {
    use tauri::Manager;

    // ⛔ Erst der Riegel, dann alles andere. Siehe `LAEUFT` darüber.
    let _riegel = Einmalriegel::nehmen().ok_or_else(|| {
        "Es läuft bereits eine Sicherung. Bitte warten, bis sie fertig ist, \
         und danach erneut sichern."
            .to_string()
    })?;
    let datenort = app
        .path()
        .app_local_data_dir()
        .map(|p| p.join("daten"))
        .map_err(|e| format!("Der Datenort ist nicht bestimmbar: {e}"))?;
    let laeufer = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_default()
        .join(if cfg!(windows) {
            "norns-sidecar.exe"
        } else {
            "norns-sidecar"
        });
    let skript = app
        .path()
        .resolve(
            "resources/sidecar/start.mjs",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| format!("Die Kasse ist unvollständig installiert: {e}"))?;

    // Das Passwort kommt aus dem Tresor, nie aus der Oberfläche: ein Knopf,
    // der ein Datenbankpasswort durch die Weboberfläche reicht, hat es damit
    // aus dem Tresor herausgelassen.
    let passwort = db_passwort_holen()?;

    sichern(
        &laeufer,
        &skript,
        &datenort,
        &ziel_aufloesen(&zielordner, heimat()),
        &passwort,
    )
}

/// ═══════════════════════════════════════════════════════════════════════
///  EIN RELATIVER PFAD GEHÖRT DEM MENSCHEN, NICHT DEM ARBEITSVERZEICHNIS
/// ═══════════════════════════════════════════════════════════════════════
///
/// ── DER BEFUND VOM 08.08.2026 ─────────────────────────────────────────
///
/// Die Fläche gibt als Vorgabe `Dokumente/Norns Sicherungen` — einen
/// RELATIVEN Pfad. Er landete unverändert in `PathBuf::from` und
/// `create_dir_all`.
///
/// Eine über den Finder gestartete Anwendung hat als Arbeitsverzeichnis die
/// Wurzel. Der Versuch ging also auf `/Dokumente/Norns Sicherungen`, und
/// dort darf niemand schreiben. Die Sicherung scheiterte mit einer Meldung
/// über Rechte, obwohl es an Rechten gar nicht lag.
///
/// Rein, damit die Entscheidung ohne Dateisystem prüfbar ist.
fn ziel_aufloesen(eingabe: &str, heim: Option<PathBuf>) -> PathBuf {
    let roh = eingabe.trim();
    let pfad = PathBuf::from(roh);
    if pfad.is_absolute() {
        return pfad;
    }
    // Die Tilde ist im Finder üblich und im Rumpf bedeutungslos.
    let ohne_tilde = roh.strip_prefix("~/").unwrap_or(roh);
    match heim {
        Some(h) => h.join(ohne_tilde),
        // Kein Heimatordner: dann bleibt es beim alten Verhalten, statt
        // still an einen anderen Ort zu schreiben, als der Mensch tippte.
        None => pfad,
    }
}

/// Der Heimatordner des angemeldeten Menschen.
fn heimat() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Das Datenbankpasswort, einmal je Programmlauf.
///
/// ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
///
/// Jede Sicherung griff erneut in den Systemtresor. Solange die Kasse ad hoc
/// unterschrieben ist, ist jeder Griff auf ein Fach, dessen Zugriffsliste
/// nicht mehr passt, eine Passwortfrage — also eine Frage je Sicherung.
///
/// Der Wert liegt beim Start ohnehin schon im Speicher: `tresor::bereitstellen`
/// hat ihn gelesen und dem Motor als Umgebung übergeben. Ihn ein zweites Mal
/// zu holen war reine Reibung.
static DB_PASSWORT: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// Beim Start hinterlegen, aus dem, was der Tresor ohnehin geliefert hat.
pub fn db_passwort_merken(wert: &str) {
    if let Ok(mut m) = DB_PASSWORT.lock() {
        *m = Some(wert.to_string());
    }
}

/// Den gemerkten Wert holen, sonst doch den Tresor fragen.
///
/// ⚠️ Der Rückfall bleibt: liefe die Sicherung je in einem Lauf, in dem der
/// Start das Merken übersprungen hat, wäre ein Absturz schlimmer als eine
/// zusätzliche Frage.
fn db_passwort_holen() -> Result<String, String> {
    if let Ok(m) = DB_PASSWORT.lock() {
        if let Some(w) = m.as_ref() {
            return Ok(w.clone());
        }
    }
    keyring::Entry::new("norns-pos", "NORNS_DB_PASSWORT")
        .and_then(|e| e.get_password())
        .map_err(|_| {
            "Der Schlüssel der Datenbank ist im Systemtresor nicht auffindbar. \
             Die Sicherung kann nicht laufen."
                .to_string()
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ein_relativer_pfad_landet_im_heimatordner() {
        // Der Befund: ohne diese Auflösung ging es auf `/Dokumente/...`.
        let ziel = ziel_aufloesen(
            "Dokumente/Norns Sicherungen",
            Some(PathBuf::from("/Users/muster")),
        );
        assert_eq!(
            ziel,
            PathBuf::from("/Users/muster/Dokumente/Norns Sicherungen")
        );
    }

    #[test]
    fn ein_absoluter_pfad_bleibt_wie_er_ist() {
        let ziel = ziel_aufloesen("/Volumes/Stick/Norns", Some(PathBuf::from("/Users/muster")));
        assert_eq!(ziel, PathBuf::from("/Volumes/Stick/Norns"));
    }

    #[test]
    fn die_tilde_wird_verstanden() {
        let ziel = ziel_aufloesen("~/Sicherungen", Some(PathBuf::from("/Users/muster")));
        assert_eq!(ziel, PathBuf::from("/Users/muster/Sicherungen"));
    }

    #[test]
    fn ohne_heimatordner_bleibt_es_beim_alten() {
        // Lieber der alte Weg als still an einen anderen Ort schreiben.
        assert_eq!(
            ziel_aufloesen("Dokumente/X", None),
            PathBuf::from("Dokumente/X")
        );
    }

    #[test]
    fn leerraum_um_den_pfad_stoert_nicht() {
        let ziel = ziel_aufloesen("  Dokumente/X  ", Some(PathBuf::from("/Users/muster")));
        assert_eq!(ziel, PathBuf::from("/Users/muster/Dokumente/X"));
    }

    /// Die Meldung in der Form, die Sitzung A zugesagt hat.
    const ECHT: &str = r#"NORNS_SICHERUNG_FERTIG {"datei":"norns-sicherung-2026-07-30T19-40.sql","tabellen":87,"zeilen":1243,"sequenzen":12}"#;

    #[test]
    fn liest_die_fertigmeldung() {
        let b = bericht_aus_zeile(ECHT).expect("muss lesbar sein");
        assert_eq!(b.datei, "norns-sicherung-2026-07-30T19-40.sql");
        assert_eq!(b.tabellen, 87);
        assert_eq!(b.zeilen, 1243);
        assert_eq!(b.sequenzen, 12);
    }

    #[test]
    fn eine_fremde_zeile_gilt_nicht_als_sicherung() {
        // Der wichtigste Test: was hier durchrutscht, meldet dem Händler einen
        // grünen Haken über einem Ordner, in dem nichts Brauchbares liegt.
        assert!(bericht_aus_zeile("Sicherung läuft …").is_none());
        assert!(bericht_aus_zeile("creating subdirectories ... ok").is_none());
        // Ohne Dateinamen ist die Meldung wertlos und gilt nicht.
        assert!(bericht_aus_zeile("NORNS_SICHERUNG_FERTIG {\"tabellen\":87}").is_none());
    }

    #[test]
    fn fehlende_zahlen_werden_null_und_nicht_geraten() {
        let b = bericht_aus_zeile("NORNS_SICHERUNG_FERTIG {\"datei\":\"a.sql\"}")
            .expect("der Dateiname genügt");
        assert_eq!((b.tabellen, b.zeilen, b.sequenzen), (0, 0, 0));
    }
}

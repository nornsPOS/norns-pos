//! motor, der Server, der im Gerät wohnt.
//!
//! ── WARUM ES DIESE DATEI GIBT (30.07.2026, Basels Ordnung) ──────────────────
//!
//! Warehouse14 fragt eine ferne Schnittstelle. Norns POS arbeitet offline, und
//! Basels Weg dorthin war der kürzeste und zugleich der ehrlichste: **nicht den
//! Server nachbauen, sondern ihn mitnehmen.** Derselbe `apps/api-cloud`,
//! dieselbe Datenbank, dieselben 89 Tabellen, 75 Auslöser, 284 CHECK-
//! Bedingungen und 321 Funktionen. Kein Nachbau heisst: kein nachgebauter
//! Wächter, den niemand geprüft hat.
//!
//! Sitzung A hat den Weg gefahren, nicht geschätzt: der unveränderte Server
//! bootet gegen ein eingebettetes Postgres 17.10 und antwortet auf `/health`
//! mit 200. Start 0,02 s, vom Nichts bis fertig 0,9 s, unter 200 MB.
//!
//! ── DER VERTRAG ZWISCHEN RUMPF UND MOTOR ────────────────────────────────────
//!
//! 1. Der Rumpf startet den Motor als Kindprozess und beendet ihn beim
//!    Schliessen. Ein verwaister Server, der nach dem Schliessen weiterläuft
//!    und die Datenbank hält, ist die schlimmste Bauform: die nächste Kasse
//!    findet die Datei belegt und niemand sieht warum.
//! 2. Der Motor meldet seine Bereitschaft auf stdout mit GENAU einer Zeile:
//!        NORNS_BEREIT {"port":3111}
//!    Kein fester Port im Rumpf. Zwei Kassen auf einem Rechner, ein belegter
//!    Port, und ein fester Wert steht.
//! 3. Der Rumpf reicht den Port der Oberfläche als `window.__NORNS_API__`
//!    herein, BEVOR sie startet (siehe `main.tsx`).
//! 4. Die Geheimnisse erzeugt der RUMPF beim ersten Start und legt sie in den
//!    Systemtresor. Der Händler tippt nichts, und nichts steht im Klartext.
//!
//! ── WAS HIER BEWUSST NICHT PASSIERT ─────────────────────────────────────────
//!
//! Kein Rückfall ins Internet. Bleibt der Motor stumm, sagt die Kasse das und
//! verkauft NICHT. Eine Kasse, die bei stummem Motor heimlich eine fremde
//! Wolke fragt, ist nicht die Kasse, die verkauft wurde.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::async_runtime;

/// Wie lange der Rumpf auf die Bereitschaftszeile wartet, wenn die Datenbank
/// SCHON STEHT. Ein warmer Start ist kurz; wird es hier lang, stimmt etwas
/// nicht, und dann soll der Händler das erfahren statt ewig zu warten.
const WARTEZEIT_WARM: Duration = Duration::from_secs(120);

/// Wie lange beim ALLERERSTEN Start gewartet wird, wenn Postgres sein
/// Datenverzeichnis erst anlegt, das Schema einspielt und die Saat schreibt.
///
/// ⚠️ 31.07.2026, AN BASELS GERÄT GEMESSEN. Hier stand EINE Frist von 30
/// Sekunden, mit dem Kommentar, das decke eine Ersteinrichtung „mit weitem
/// Abstand". Gemessen wurde: 22 Sekunden auf einem ruhigen Mac, bei bereits
/// bestehender Datenbank. Der Abstand war also nicht weit, er war acht
/// Sekunden, und beim ERSTEN Start, wenn 87 Tabellen und sechs Rollen
/// entstehen, ist er weg.
///
/// Die Folge sah Basel mehrfach: „Keine Verbindung zum Server", während der
/// Motor Sekunden später sauber hochkam und auf /health mit {"ok":true}
/// antwortete. Die Kasse hat funktioniert und über sich selbst gelogen.
///
/// Zehn Minuten sind hier nicht grosszügig, sondern ehrlich: eine
/// Ladenmaschine mit Virenwächter auf einer langsamen Platte braucht sie
/// vielleicht wirklich, und ein Händler, der beim ersten Einrichten zwei
/// Minuten wartet, ist besser bedient als einer, dem nach dreissig Sekunden
/// gesagt wird, seine Kasse sei kaputt.
const WARTEZEIT_ERSTSTART: Duration = Duration::from_secs(600);

/// Die Zeile, an der der Rumpf erkennt, dass der Motor steht.
const BEREIT: &str = "NORNS_BEREIT";

/// Wie viele Zeilen der Fehlerausgabe aufgehoben werden. Der Abbruchgrund steht
/// immer am Ende; alles davor ist das Geplauder von Postgres beim Hochfahren.
const LETZTE_ZEILEN: usize = 12;

/// Die Herkunft des Kassenfensters, wie Tauri sie bildet.
///
/// Abgeschrieben aus `tauri 2.11.2`, `manager/mod.rs::tauri_protocol_url`:
/// Windows und Android bekommen `http(s)://tauri.localhost`, alles andere
/// `tauri://localhost`. Der Motor braucht sie, sonst weist er das eigene
/// Fenster ab; siehe die lange Begründung an der Stelle, die sie setzt.
///
/// Steht als eigene Größe da, damit der Wächter unten sie prüfen kann, ohne den
/// Motor zu starten.
const FENSTER_URSPRUENGE: [&str; 3] = [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
];

/// Der laufende Motor. `None`, solange er nicht steht.
pub struct Motor {
    pub adresse: String,
    kind: Mutex<Option<std::process::Child>>,
}

impl Motor {
    /// Führt das Betriebssystem diesen Prozess noch?
    ///
    /// ⚠️ `try_wait` und NICHT eine Anfrage übers Netz. Der Unterschied ist
    /// der ganze Punkt: `try_wait` ist eine TATSACHE des Betriebssystems
    /// (der Prozess ist beendet, hier ist sein Beendigungsstand), während
    /// eine unbeantwortete Netzanfrage auch nur „gerade beschäftigt" heissen
    /// kann. Die Aufsicht startet ausschliesslich auf diese Tatsache hin neu.
    /// Einen lebenden Motor mitten im Verkauf abzuschiessen wäre teurer
    /// als gar keine Aufsicht.
    ///
    /// Antwortet `true`, wenn der Prozess läuft ODER wenn wir es nicht sagen
    /// können (verklemmtes Schloss, Fehler beim Nachsehen). Im Zweifel wird
    /// nichts angefasst.
    pub fn lebt(&self) -> bool {
        match self.kind.lock() {
            Ok(mut fach) => match fach.as_mut() {
                Some(kind) => matches!(kind.try_wait(), Ok(None) | Err(_)),
                // Kein Kind mehr im Fach: `anhalten()` war hier. Das ist ein
                // gewollter Halt, kein Absturz.
                None => true,
            },
            Err(_) => true,
        }
    }

    /// Beendet den Motor. Wird beim Schliessen des Fensters gerufen; ein
    /// verwaister Server hielte sonst die Datenbank.
    pub fn anhalten(&self) {
        if let Ok(mut fach) = self.kind.lock() {
            if let Some(mut kind) = fach.take() {
                let _ = kind.kill();
                let _ = kind.wait();
            }
        }
    }
}

/// Was beim Starten schiefgehen kann, in Klartext für die Oberfläche.
#[derive(Debug)]
pub enum MotorFehler {
    NichtGefunden(String),
    NichtGestartet(String),
    KeineBereitschaft,
    /// Der Motor hat selbst gesagt, warum er nicht kann. Sein Satz, nicht unserer.
    Abgebrochen(String),
    UnlesbareMeldung(String),
}

impl std::fmt::Display for MotorFehler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NichtGefunden(p) => write!(
                f,
                "Der Motor der Kasse wurde nicht gefunden ({p}). Die Anwendung ist unvollständig installiert."
            ),
            Self::NichtGestartet(e) => write!(f, "Der Motor der Kasse startete nicht: {e}"),
            // ⚠️ Hier stand eine feste Sekundenzahl aus einer Konstanten. Sie
            // war zweimal falsch: die Frist haengt jetzt davon ab, ob es der
            // erste Start ist, und der Motor starb oft nach Sekunden, nicht
            // nach der vollen Frist. Der Satz nennt deshalb KEINE Zahl mehr,
            // die er nicht kennt.
            Self::KeineBereitschaft => write!(
                f,
                "Der Motor der Kasse hat sich nicht gemeldet und auch keinen Grund genannt."
            ),
            Self::Abgebrochen(satz) => write!(f, "{satz}"),
            Self::UnlesbareMeldung(z) => {
                write!(f, "Der Motor meldete etwas Unerwartetes: {z}")
            }
        }
    }
}

/// Den Port aus der Bereitschaftszeile lesen.
///
/// Bewusst ohne JSON-Bibliothek: die Zeile ist ein Vertrag zwischen zwei
/// Dateien, die wir beide besitzen, und eine Zahl aus ihr zu holen braucht
/// keinen Übersetzer. Eine fremde Zeile ergibt `None`, nie eine geratene Zahl.
fn port_aus_zeile(zeile: &str) -> Option<u16> {
    let rest = zeile.strip_prefix(BEREIT)?;
    let i = rest.find("\"port\"")?;
    let nach = &rest[i + 6..];
    let ziffern: String = nach
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    ziffern.parse().ok()
}

/// Aus den letzten Zeilen der Fehlerausgabe einen Grund machen.
///
/// Der Motor sagt seinen Abbruchgrund mit dem Wort ABBRUCH an. Steht der da,
/// ist er die ganze Wahrheit und wird wörtlich weitergereicht. Steht nichts
/// Brauchbares da, bleibt es beim ehrlichen „er hat sich nicht gemeldet".
fn abbruchgrund(letzte_worte: &Mutex<Vec<String>>) -> MotorFehler {
    let Ok(zeilen) = letzte_worte.lock() else {
        return MotorFehler::KeineBereitschaft;
    };
    // Von hinten suchen: der Grund steht am Ende, nicht am Anfang.
    if let Some(satz) = zeilen.iter().rev().find(|z| z.contains("ABBRUCH")) {
        return MotorFehler::Abgebrochen(saeubern(satz));
    }
    // Kein ABBRUCH, aber irgendetwas Letztes: besser als gar nichts, denn ein
    // stiller Absturz mit einer Meldung ist immer noch eine Meldung.
    match zeilen.iter().rev().find(|z| !z.trim().is_empty()) {
        Some(letzte) => MotorFehler::Abgebrochen(saeubern(letzte)),
        None => MotorFehler::KeineBereitschaft,
    }
}

/// Die Marke des Absenders vorne abschneiden. Sie hilft uns beim Suchen und
/// sagt dem Händler nichts.
fn saeubern(zeile: &str) -> String {
    zeile
        .trim()
        .strip_prefix("[norns-sidecar]")
        .unwrap_or(zeile.trim())
        .trim()
        .to_string()
}

/// Den Motor starten und auf seine Bereitschaft warten.
///
/// `motor_pfad` ist das mitgelieferte Erzeugnis, `datenort` der Ordner, in dem
/// Datenbank und Fotos liegen (unter Windows `%LOCALAPPDATA%\NornsPOS`, nie im
/// Programmverzeichnis: dorthin zu schreiben verbietet das Betriebssystem).
pub fn starten(
    motor_pfad: PathBuf,
    skript: PathBuf,
    datenort: PathBuf,
    geheimnisse: Vec<(String, String)>,
) -> Result<Motor, MotorFehler> {
    if !motor_pfad.exists() {
        return Err(MotorFehler::NichtGefunden(
            motor_pfad.to_string_lossy().into_owned(),
        ));
    }
    // Der Läufer ist eine umbenannte node.exe und tut ohne Skript gar nichts.
    // Fehlt es, ist das Paket unvollständig, und das gehört genauso gesagt wie
    // ein fehlender Läufer, nicht als „meldete sich nicht".
    if !skript.exists() {
        return Err(MotorFehler::NichtGefunden(
            skript.to_string_lossy().into_owned(),
        ));
    }
    let _ = std::fs::create_dir_all(&datenort);

    let mut befehl = std::process::Command::new(&motor_pfad);
    befehl
        // Der Läufer ist node, das Skript sein einziges Argument. Sitzung A
        // liefert es als ESM (`start.mjs`) und NICHT als cjs: der Dienst
        // rechnet seine Pfade aus `import.meta.url`, und esbuild verstümmelt
        // das beim Umschreiben nach cjs.
        .arg(&skript)
        .env("NORNS_DATENORT", &datenort)
        // ── Der Motor muss sein eigenes Fenster kennen ───────────────────────
        //
        // Ohne diese Zeile stand die Kasse tot vor dem eigenen Motor. Gemessen
        // am laufenden Programm: das Fenster war auf 127.0.0.1 VERBUNDEN, der
        // Motor antwortete, und die Oberfläche meldete trotzdem „keine
        // Verbindung". Grund: der Server liest `TRUSTED_ORIGINS`, der Standard
        // ist leer, und leer heißt bei ihm `origin: false`, jede Anfrage von
        // außerhalb seiner selbst wird abgewiesen. Der Vorflug (`OPTIONS`) kam
        // mit 404 zurück, die Antwort auf `GET /api/auth/session` ganz ohne
        // `Access-Control-Allow-Origin`. Damit verwirft WebKit die Antwort,
        // `fetch` scheitert, und der Klient meldet völlig korrekt einen
        // Netzfehler. Das Fenster war vom eigenen Motor ausgesperrt.
        //
        // Die drei Namen sind nicht geraten, sie stehen in `tauri 2.11.2`
        // selbst (`manager/mod.rs`, `tauri_protocol_url`): macOS und Linux
        // bekommen `tauri://localhost`, Windows und Android die Umgehung
        // `http(s)://tauri.localhost`. Alle drei stehen hier, damit derselbe
        // Rumpf auf jedem System läuft; welcher davon greift, entscheidet das
        // Fenster, nicht diese Zeile.
        //
        // Weiter geht die Liste bewusst nicht. Der Motor horcht ohnehin nur auf
        // 127.0.0.1, aber eine Wand, die alles durchlässt, ist keine Wand.
        .env("TRUSTED_ORIGINS", FENSTER_URSPRUENGE.join(","))
        // ── KEIN `PORT` von hier ────────────────────────────────────────────
        //
        // Hier stand `PORT=0` in der Annahme, das Betriebssystem suche dann
        // einen freien. Sitzung A hat nachgesehen: das Schema des Servers
        // verlangt `minimum: 1`, eine Null wird beim Start ABGEWIESEN. Der
        // Motor sucht sich den freien Port deshalb selbst und meldet ihn in
        // der Bereitschaftszeile.
        //
        // Die Zeile ist ersatzlos weg statt auf einen Wert geändert: eine Zahl
        // von hier würde die Suche des Motors überstimmen, und dann stünden
        // zwei Kassen auf einem Rechner wieder einander im Weg, genau der
        // Fall, für den das hier einmal gedacht war.
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    for (k, v) in geheimnisse {
        befehl.env(k, v);
    }

    // Unter Windows sonst ein schwarzes Konsolenfenster neben der Kasse.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        befehl.creation_flags(CREATE_NO_WINDOW);
    }

    let mut kind = befehl
        .spawn()
        .map_err(|e| MotorFehler::NichtGestartet(e.to_string()))?;

    // ── Der Motor wird an das Leben dieser Kasse geknüpft ───────────────────
    //
    // SOFORT nach dem Start, vor allem anderen: je später das geschieht, desto
    // länger ist das Fenster, in dem ein Absturz des Rumpfes eine Waise zurück-
    // lässt.
    //
    // Warum das nötig ist: `anhalten()` ruft `Child::kill()`, und das ist auf
    // Windows `TerminateProcess` auf GENAU diesen einen Prozess. Postgres ist
    // sein Kind und überlebt, mit gesperrtem Datenverzeichnis. Der Verbund
    // fasst Läufer und alle Nachkommen zusammen und lässt Windows selbst
    // aufräumen, auch dann, wenn von unserem Programm nichts mehr läuft.
    //
    // Siehe `verbund.rs`. Zusammen mit `waisenErloesen()` im Dienst (Sitzung A)
    // sind das zwei voneinander unabhängige Wände.
    let lage = crate::verbund::an_die_kasse_binden(kind.id());
    if lage == crate::verbund::Verbundlage::Gescheitert {
        // Kein Abbruch: die Kasse läuft auch ohne, nur ohne diese Wand. Aber
        // es steht im Protokoll, statt still zu bleiben.
        eprintln!(
            "[norns] Der Motor liess sich nicht an die Kasse binden. \
             Stirbt die Kasse hart, kann Postgres als Waise zurückbleiben; \
             der nächste Start räumt ihn dann auf."
        );
    }

    let ausgabe = kind
        .stdout
        .take()
        .ok_or_else(|| MotorFehler::NichtGestartet("keine Ausgabe".into()))?;

    // ── Die Fehlerausgabe wird AUFGEHOBEN, nicht verworfen ──────────────────
    //
    // Hier stand vorher „mitlesen und wegwerfen", nur damit die Röhre nicht
    // volläuft. Das war ein Fehler, und Sitzung A hat ihn sichtbar gemacht:
    // der Motor bricht bei einem fehlenden Geheimnis SOFORT ab und schreibt
    // seinen Grund auf genau diesen Kanal, in einem ganzen deutschen Satz:
    //
    //     [norns-sidecar] ABBRUCH: NORNS_PII_KEY fehlt oder ist zu kurz.
    //
    // Danach schliesst sich stdout, der Leser unten bekommt `Ok(0)` und hätte
    // gemeldet „meldete sich nicht innerhalb von 30 Sekunden". Das wäre gleich
    // doppelt gelogen: es waren keine 30 Sekunden, und der Motor hat sehr wohl
    // etwas gesagt, wir haben es nur weggeworfen.
    //
    // Also: die letzten Zeilen bleiben liegen, und wenn keine Bereitschaft
    // kommt, sind SIE die Antwort an den Händler.
    let letzte_worte: std::sync::Arc<Mutex<Vec<String>>> =
        std::sync::Arc::new(Mutex::new(Vec::new()));
    if let Some(fehlerstrom) = kind.stderr.take() {
        let fach = std::sync::Arc::clone(&letzte_worte);
        async_runtime::spawn_blocking(move || {
            for zeile in BufReader::new(fehlerstrom).lines().map_while(Result::ok) {
                if let Ok(mut f) = fach.lock() {
                    // Nur die letzten paar behalten: Postgres ist gesprächig
                    // (Sitzung A: vierzig Zeilen „creating subdirectories"),
                    // und der Abbruchgrund steht immer am Ende.
                    if f.len() >= LETZTE_ZEILEN {
                        f.remove(0);
                    }
                    f.push(zeile);
                }
            }
        });
    }

    // ── DIE FRIST MUSS AUCH GREIFEN, WENN DER MOTOR SCHWEIGT ────────────────
    //
    // ⚠️ 31.07.2026: hier stand die Fristprüfung am ANFANG der Schleife, und
    // direkt darunter ein blockierendes `read_line`. Schweigt der Motor, kehrt
    // `read_line` nicht zurück, also wurde die Prüfung NIE erreicht. Die Frist
    // stand im Code und galt in Wahrheit nicht.
    //
    // Jetzt liest ein eigener Faden und schiebt jede Zeile durch einen Kanal;
    // der Hauptfaden wartet mit `recv_timeout`. Damit gilt die Frist auch
    // gegen einen Motor, der gar nichts sagt.
    let erststart = !datenort.join("pg").exists();
    let frist = if erststart {
        WARTEZEIT_ERSTSTART
    } else {
        WARTEZEIT_WARM
    };

    let (sender, empfaenger) = std::sync::mpsc::channel::<String>();
    async_runtime::spawn_blocking(move || {
        for zeile in BufReader::new(ausgabe).lines().map_while(Result::ok) {
            // Bricht der Empfänger weg, ist der Rumpf weiter, dann hilft
            // Weiterlesen niemandem mehr.
            if sender.send(zeile).is_err() {
                return;
            }
        }
    });

    let beginn = Instant::now();
    loop {
        let rest = frist.saturating_sub(beginn.elapsed());
        if rest.is_zero() {
            let _ = kind.kill();
            return Err(abbruchgrund(&letzte_worte));
        }
        let zeile = match empfaenger.recv_timeout(rest) {
            Ok(z) => z,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                let _ = kind.kill();
                return Err(abbruchgrund(&letzte_worte));
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => String::new(),
        };
        // Eine leere Zeile heisst hier: der Kanal ist zu, der Motor hat
        // aufgelegt. Alles andere ist eine echte Zeile.
        match zeile.len() {
            0 => {
                // Der Motor hat aufgelegt. Wenn er dabei etwas gesagt hat, ist
                // DAS die Antwort, nicht unser Standardsatz über Wartezeit.
                let _ = kind.wait();
                return Err(abbruchgrund(&letzte_worte));
            }
            _ => {
                let gestutzt = zeile.trim();
                if gestutzt.starts_with(BEREIT) {
                    let port = port_aus_zeile(gestutzt)
                        .ok_or_else(|| MotorFehler::UnlesbareMeldung(gestutzt.to_string()))?;
                    // Ab hier weiterlesen und verwerfen: der Lesefaden von
                    // oben laeuft ohnehin weiter und schiebt in den Kanal. Wir
                    // leeren ihn, damit er nicht volllaeuft und den Motor
                    // blockiert, dieselbe Sorge wie bei der Fehlerausgabe.
                    async_runtime::spawn_blocking(move || while empfaenger.recv().is_ok() {});
                    return Ok(Motor {
                        adresse: format!("http://127.0.0.1:{port}"),
                        kind: Mutex::new(Some(kind)),
                    });
                }
            }
        }
    }
}

/// Wie es dem Motor gerade geht. Die Oberfläche fragt das ab und zeigt
/// solange die Wartefläche.
///
/// WARUM ein Zustand und nicht einfach ein Rückgabewert: der Motor braucht
/// kalt 2,4 Sekunden (Sitzung A, gemessen). Würde der Rumpf im Startvorgang
/// darauf warten, stünde das Fenster in dieser Zeit als weisser Block da, und
/// unter Windows malt das Betriebssystem nach zwei Sekunden „reagiert nicht"
/// über eine Anwendung, die ihre Nachrichtenschleife nicht bedient. Deshalb
/// startet der Motor auf einem eigenen Faden, das Fenster erscheint sofort,
/// und die Oberfläche fragt hier nach.
#[derive(Clone, serde::Serialize)]
#[serde(tag = "stand", rename_all = "lowercase")]
pub enum MotorStand {
    /// Der Motor läuft hoch. Kalt 2,4 s, warm deutlich weniger.
    Startet,
    /// Bereit. `adresse` ist die Anschrift für die Oberfläche.
    Bereit { adresse: String },
    /// Gescheitert. `grund` ist Klartext für den Händler, kein Code.
    Fehler { grund: String },
}

/// Das Fach, in dem der Zustand liegt. Wird als Tauri-Zustand hinterlegt.
pub struct MotorFach {
    pub stand: Mutex<MotorStand>,
    pub motor: Mutex<Option<Motor>>,
}

impl Default for MotorFach {
    fn default() -> Self {
        Self {
            stand: Mutex::new(MotorStand::Startet),
            motor: Mutex::new(None),
        }
    }
}

/// Die Frage der Oberfläche: steht der Motor schon?
///
/// Sie wird beim Start wiederholt gestellt, bis eine Antwort kommt, die nicht
/// `Startet` ist. Nie ein Rateschritt: entweder eine Anschrift oder ein Grund.
#[tauri::command]
pub fn motor_stand(fach: tauri::State<'_, MotorFach>) -> MotorStand {
    fach.stand
        .lock()
        .map(|s| s.clone())
        .unwrap_or(MotorStand::Fehler {
            grund: "Der Zustand des Motors ist nicht lesbar.".into(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ein Prozess, der lange genug lebt, um beobachtet zu werden.
    #[cfg(not(windows))]
    fn prozess(sekunden: &str) -> std::process::Child {
        std::process::Command::new("sleep")
            .arg(sekunden)
            .spawn()
            .expect("sleep liess sich nicht starten")
    }

    #[cfg(windows)]
    fn prozess(sekunden: &str) -> std::process::Child {
        // ⚠️ NICHT `timeout`, und der Grund ist teuer erkauft:
        //
        // Bis zum 13.08.2026 stand hier `cmd /C timeout /T N /NOBREAK`.
        // `timeout` verweigert den Dienst, sobald die Standardeingabe
        // umgeleitet ist, und unter `cargo test` ist sie das IMMER. Im
        // Windows-Lauf stand deshalb wörtlich:
        //
        //     ERROR: Input redirection is not supported, exiting the process
        //     immediately.
        //
        // Der „lange lebende" Prozess war also nach Millisekunden tot, und
        // `ein_laufender_prozess_gilt_als_lebendig` war nur durch ein
        // Wettrennen grün: der Griff nach `lebt()` kam zufällig früher als der
        // Beendigungsstand. Ein Wächter, der die Aufsicht über den Motor der
        // Kasse absichert, mass auf der Plattform, an die AUSGELIEFERT wird,
        // eine Leiche.
        //
        // `ping` braucht keine Eingabe: `-n N` sendet N Pakete im Sekundentakt
        // und lebt dadurch verlässlich N-1 Sekunden.
        let pakete = sekunden.parse::<u32>().unwrap_or(0) + 1;
        std::process::Command::new("ping")
            .args(["-n", &pakete.to_string(), "127.0.0.1"])
            .stdout(std::process::Stdio::null())
            .spawn()
            .expect("ping liess sich nicht starten")
    }

    fn motor_um(kind: std::process::Child) -> Motor {
        Motor {
            adresse: "http://127.0.0.1:0".to_string(),
            kind: Mutex::new(Some(kind)),
        }
    }

    /// ⚠️ Der Wächter für die Aufsicht: `lebt()` muss die TATSACHE des
    /// Betriebssystems melden, nicht eine Vermutung.
    ///
    /// Er misst nicht, dass `try_wait` im Rumpf steht, das täte jede
    /// Textsuche. Er startet einen ECHTEN Prozess und fragt nach.
    #[test]
    fn ein_laufender_prozess_gilt_als_lebendig() {
        let m = motor_um(prozess("30"));
        assert!(m.lebt(), "ein laufender Prozess wurde für tot erklärt");

        // ⚠️ Zweimal fragen, mit Abstand. Sonst kann dieser Test grün sein,
        // OHNE dass je ein Prozess lebte: startet der Hilfsprozess gar nicht
        // richtig, liefert das Betriebssystem den Beendigungsstand oft erst
        // Millisekunden später, der erste Griff nach `lebt()` gewinnt dann
        // das Wettrennen und meldet „lebendig". Genau so war der Test auf
        // Windows monatelang grün. Ein Prozess, der sofort stirbt, übersteht
        // diese halbe Sekunde nicht.
        std::thread::sleep(Duration::from_millis(500));
        assert!(
            m.lebt(),
            "der Hilfsprozess war nach einer halben Sekunde schon tot, dann \
             misst dieser Wächter nicht, was er behauptet"
        );

        m.anhalten();
    }

    /// Die Gegenprobe, ohne die der Wächter wertlos wäre: stirbt der Prozess
    /// wirklich, muss `lebt()` das auch WIRKLICH merken. Gäbe diese Funktion
    /// stumpf `true` zurück, bliebe der Test oben trotzdem grün, und die
    /// Aufsicht schaute für immer einer Leiche beim Nichtstun zu.
    #[test]
    fn ein_beendeter_prozess_wird_als_tot_erkannt() {
        let m = motor_um(prozess("0"));

        // Gemessen statt geraten: bis zu fünf Sekunden nachsehen. Wann genau
        // das Betriebssystem den Beendigungsstand bereitstellt, ist seine
        // Sache, nicht unsere; feste Wartezeiten wären ein Wackelkandidat.
        let bis = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < bis {
            if !m.lebt() {
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        panic!("ein beendeter Prozess galt nach fünf Sekunden noch als lebendig");
    }

    /// Ein gewolltes Anhalten ist kein Absturz. Nach `anhalten()` darf die
    /// Aufsicht den Motor NICHT wiederbeleben, sonst startete das Schliessen
    /// des Fensters die Kasse jedes Mal neu.
    #[test]
    fn ein_gewollt_angehaltener_motor_ruft_nicht_nach_neustart() {
        let m = motor_um(prozess("30"));
        m.anhalten();
        assert!(
            m.lebt(),
            "ein gewolltes Anhalten wurde als Absturz gelesen; das Schliessen \
             des Fensters würde die Kasse neu starten"
        );
    }

    #[test]
    fn liest_den_port_aus_der_bereitschaftszeile() {
        assert_eq!(port_aus_zeile("NORNS_BEREIT {\"port\":3111}"), Some(3111));
        assert_eq!(
            port_aus_zeile("NORNS_BEREIT {\"port\": 49877 }"),
            Some(49877)
        );
    }

    /// Der Wächter gegen die Aussperrung: der Motor muss sein eigenes Fenster
    /// hereinlassen.
    ///
    /// Er misst nicht, dass die Zeile im Rumpf steht, das täte jede Textsuche.
    /// Er rechnet die Zeichenkette so nach, wie der SERVER sie liest
    /// (`parseOrigins`: an Kommas trennen, Ränder abschneiden, Leeres wegwerfen)
    /// und verlangt, dass am Ende genau die Herkunft übrig bleibt, die das
    /// Fenster auf JEDEM der drei Systeme benutzt.
    ///
    /// Wer eine der drei streicht, sie verschreibt, ein Komma vergisst oder die
    /// Liste leert, bekommt hier Rot statt einer Kasse, die vor dem eigenen
    /// Motor steht und „keine Verbindung" sagt.
    #[test]
    fn der_motor_laesst_das_eigene_fenster_herein() {
        let gesetzt = FENSTER_URSPRUENGE.join(",");

        // So liest der Server die Zeichenkette, Zeile für Zeile nachgebaut aus
        // `apps/api-cloud/src/config/env.ts::parseOrigins`.
        let gelesen: Vec<&str> = gesetzt
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();

        // 1. Leer ist der Fehler selbst: eine leere Liste heißt beim Server
        //    `origin: false`, und das weist das eigene Fenster ab.
        assert!(
            !gelesen.is_empty(),
            "leere Herkunftsliste: der Server weist damit JEDE Anfrage des Fensters ab"
        );

        // 2. macOS und Linux. Gemessen in tauri 2.11.2, manager/mod.rs.
        assert!(
            gelesen.contains(&"tauri://localhost"),
            "die Herkunft von macOS und Linux fehlt, die Kasse käme dort nie an ihren Motor: {gelesen:?}"
        );

        // 3. Windows und Android, beide Schreibweisen, welche gilt, entscheidet
        //    `useHttpsScheme`, also muss der Motor beide kennen.
        assert!(
            gelesen.contains(&"http://tauri.localhost"),
            "die Windows-Herkunft fehlt: {gelesen:?}"
        );
        assert!(
            gelesen.contains(&"https://tauri.localhost"),
            "die Windows-Herkunft mit TLS fehlt: {gelesen:?}"
        );

        // 4. Und keine weiter. Eine Wand, die alles durchlässt, ist keine Wand.
        assert_eq!(
            gelesen.len(),
            3,
            "die Liste soll das Fenster hereinlassen und sonst niemanden: {gelesen:?}"
        );
    }

    /// Hilfe: ein Fach mit vorgegebenen Fehlerzeilen.
    fn fach(zeilen: &[&str]) -> Mutex<Vec<String>> {
        Mutex::new(zeilen.iter().map(|z| z.to_string()).collect())
    }

    #[test]
    fn der_grund_des_motors_erreicht_den_haendler() {
        // DER Test dieser Ergänzung. Sitzung A lässt den Motor bei fehlendem
        // Geheimnis SOFORT abbrechen und den Grund auf die Fehlerausgabe
        // schreiben. Ohne diesen Weg sähe der Händler „meldete sich nicht
        // innerhalb von 30 Sekunden", falsch in der Zeit UND falsch in der
        // Sache, denn gesagt hat der Motor es ja.
        let f = fach(&[
            "creating subdirectories ... ok",
            "selecting dynamic shared memory implementation ... posix",
            "[norns-sidecar] ABBRUCH: NORNS_PII_KEY fehlt oder ist zu kurz.",
        ]);
        let fehler = abbruchgrund(&f);
        let text = fehler.to_string();
        assert!(
            text.contains("NORNS_PII_KEY"),
            "der Grund des Motors muss durchkommen, war: {text}"
        );
        assert!(
            !text.contains("30 Sekunden"),
            "es darf NICHT nach Wartezeit aussehen, war: {text}"
        );
        assert!(
            !text.contains("[norns-sidecar]"),
            "die Absendermarke gehört nicht auf den Bildschirm, war: {text}"
        );
    }

    #[test]
    fn die_ECHTE_abbruchzeile_des_dienstes_kommt_durch() {
        // Nicht erfunden: das ist die Zeile, die das gebündelte `start.mjs` am
        // 30.07.2026 wirklich ausgegeben hat, als es ohne Geheimnisse startete.
        // Damit ist der Vertrag zwischen Sitzung As Dienst und diesem Leser
        // nicht behauptet, sondern gemessen.
        let f = fach(&[
            "[norns-sidecar] ABBRUCH: AUTH_SECRET fehlt oder ist zu kurz. Der Rumpf muss es \
             aus dem Systemtresor hereinreichen; dieser Dienst erfindet es nicht.",
        ]);
        let text = abbruchgrund(&f).to_string();
        assert!(
            text.starts_with("ABBRUCH: AUTH_SECRET fehlt"),
            "war: {text}"
        );
        assert!(!text.contains("[norns-sidecar]"));
        assert!(!text.contains("30 Sekunden"));
    }

    #[test]
    fn das_geplauder_von_postgres_verdeckt_den_grund_nicht() {
        // Der Abbruch steht am ENDE, davor stehen vierzig Zeilen initdb. Wer
        // die erste Zeile nimmt, zeigt dem Händler „creating subdirectories".
        let mut zeilen: Vec<String> = (0..40)
            .map(|i| format!("creating thing {i} ... ok"))
            .collect();
        zeilen.push("[norns-sidecar] ABBRUCH: Der Datenordner ist nicht beschreibbar.".into());
        let f = Mutex::new(zeilen);
        assert!(abbruchgrund(&f).to_string().contains("nicht beschreibbar"));
    }

    #[test]
    fn ohne_jedes_wort_bleibt_es_bei_der_ehrlichen_wartezeit() {
        // Sagt der Motor gar nichts, wird NICHTS erfunden.
        let f = fach(&[]);
        assert!(matches!(abbruchgrund(&f), MotorFehler::KeineBereitschaft));
        let leer = fach(&["", "   "]);
        assert!(matches!(
            abbruchgrund(&leer),
            MotorFehler::KeineBereitschaft
        ));
    }

    #[test]
    fn eine_fremde_zeile_ergibt_keine_geratene_zahl() {
        // Die Gegenprobe ist der eigentliche Wert dieses Tests: was hier
        // durchrutscht, lässt die Kasse auf einen fremden Port zeigen.
        assert_eq!(port_aus_zeile("Listening on 3111"), None);
        assert_eq!(port_aus_zeile("NORNS_BEREIT {}"), None);
        assert_eq!(port_aus_zeile("[warn] port 3111 belegt"), None);
    }
}

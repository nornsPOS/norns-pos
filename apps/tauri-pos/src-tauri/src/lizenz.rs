//! lizenz — ist diese Kasse freigeschaltet.
//!
//! ── WAS EINE LIZENZ HIER IST ────────────────────────────────────────────────
//!
//! Vier Zeilen im Format von minisign. Geprüft wird mit `minisign-verify`, das
//! über den Aktualisierer ohnehin schon im Baum liegt: keine neue Abhängigkeit,
//! und es ist dasselbe Verfahren, mit dem die Freigaben signiert werden.
//!
//! Der Trick steckt im „trusted comment": minisign signiert ihn mit. Also steht
//! die ganze Lizenz dort, und der Händler fügt vier Zeilen ein statt einer
//! Textwand. Ausgestellt werden sie mit `werkzeug/lizenz.mjs`.
//!
//! ```text
//! untrusted comment: …                      (Beschriftung, ungeprüft)
//! <base64: "ED" ‖ Kennung ‖ Signatur>
//! trusted comment: haendler=…;ab=…;bis=…     ← die Lizenz, SIGNIERT
//! <base64: Gesamtsignatur>
//! ```
//!
//! ── DIE ENTSCHEIDUNG, DIE HIER WIRKLICH ZÄHLT ───────────────────────────────
//!
//! Nicht „echt oder gefälscht", sondern: **was darf eine Kasse ohne gültige
//! Lizenz noch?**
//!
//! Die bequeme Antwort wäre „nichts". Sie ist falsch, und zwar rechtlich. Nach
//! § 147 AO muss der HÄNDLER seine Aufzeichnungen zehn Jahre lang vorhalten und
//! einem Prüfer vorlegen können. Eine Kasse, die ihm bei abgelaufener Lizenz
//! den Zugang zu seinen eigenen Büchern sperrt, bringt ihn in die Pflichtver-
//! letzung, nicht uns zu unserem Geld. Sie wäre ausserdem genau dann verriegelt,
//! wenn der Prüfer im Laden steht.
//!
//! Deshalb die Trennung:
//!
//! ```text
//! IMMER OFFEN, ohne Ausnahme und ohne Frist:
//!     Bücher, Kassenbuch, DATEV, DSFinV-K, Prüferpaket,
//!     der TAGESABSCHLUSS und der STORNO.
//! VERLANGT einen gültigen Schlüssel:
//!     nur der neue Vorgang — verkaufen und ankaufen.
//! ```
//!
//! ⚠️ 13.08.2026: hier stand „abschliessen" in der zweiten Zeile. Das war
//! falsch und wäre teuer geworden. Der Tagesabschluss ist eine PFLICHT nach
//! § 146a AO, keine Leistung, die wir verkaufen; ihn zu sperren hiesse, den
//! Händler für unsere offene Rechnung in die Ordnungswidrigkeit zu schicken.
//! Dasselbe gilt für den Storno: ohne ihn sitzt er auf einem falschen Beleg,
//! den er nicht mehr berichtigen kann. Ein Wächter hält das jetzt fest
//! (`lizenzriegel-sperrt-keinen-fiskalweg.guard.test.ts`).
//!
//! Das ist die Linie, die verkauft, ohne den Händler seinen Pflichten zu
//! entziehen. Wer nicht zahlt, verkauft nicht weiter; wer nicht zahlt, kommt
//! trotzdem jederzeit an alles heran, was er von Gesetzes wegen braucht.

use minisign_verify::{PublicKey, Signature};

/// Der öffentliche Teil des Lizenzschlüssels. Er darf überall stehen; mit ihm
/// lässt sich prüfen, aber nichts ausstellen.
const OEFFENTLICH: &str = "RWTWtdrqDTz+QovjUuU/rz43i3songJbpOGcWYha7eTPpbUErcW9O51S";

/// Die Nachricht, die unter jeder Lizenz signiert ist. Bei allen gleich; die
/// Lizenz selbst steht im signierten Kommentar.
const NACHRICHT: &[u8] = b"norns-pos-lizenz-v1";

/// Die Datei, in der die eingelöste Lizenz neben den Daten liegt.
pub const ABLAGE: &str = "norns.lizenz";

/// Was die Kasse über ihre Freischaltung weiss.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "stand", rename_all = "lowercase")]
pub enum Stand {
    /// Keine Lizenz hinterlegt. Die Kasse zeigt ihre Bücher, verkauft aber nicht.
    Fehlt,
    /// Freigeschaltet.
    Gueltig {
        haendler: String,
        ab: String,
        /// Leer heisst unbefristet.
        bis: String,
    },
    /// Die Frist ist vorbei. Bücher bleiben offen, Verkauf steht.
    Abgelaufen { haendler: String, bis: String },
    /// Auf ein anderes Gerät ausgestellt.
    FremdesGeraet { haendler: String },
    /// Nicht echt: Text verändert, falsch abgeschrieben, oder erfunden.
    Ungueltig { grund: String },
}

impl Stand {
    /// Darf die Kasse einen NEUEN fiskalischen Vorgang beginnen?
    ///
    /// Das ist die einzige Frage, die diese Datei nach aussen beantwortet.
    /// Lesen und Ausführen fragen gar nicht erst.
    pub fn darf_verkaufen(&self) -> bool {
        matches!(self, Stand::Gueltig { .. })
    }
}

/// Die Felder aus dem signierten Kommentar.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Felder {
    pub haendler: String,
    pub ab: String,
    pub bis: String,
    pub geraet: String,
}

/// `haendler=…;ab=…;bis=…;geraet=…` zerlegen.
///
/// Unbekannte Felder werden übergangen, nicht abgelehnt: eine spätere Fassung
/// des Werkzeugs darf ein Feld hinzufügen, ohne alle ausgestellten Lizenzen
/// ungültig zu machen.
pub fn felder_lesen(kommentar: &str) -> Felder {
    let mut f = Felder::default();
    for teil in kommentar.split(';') {
        let Some((name, wert)) = teil.split_once('=') else {
            continue;
        };
        let wert = wert.trim().to_string();
        match name.trim() {
            "haendler" => f.haendler = wert,
            "ab" => f.ab = wert,
            "bis" => f.bis = wert,
            "geraet" => f.geraet = wert,
            _ => {}
        }
    }
    f
}

/// Das Urteil über eine ECHTE Lizenz: Frist und Gerät.
///
/// Reine Entscheidung, ohne Kryptographie und ohne Uhr, damit sie prüfbar ist.
/// `heute` und `geraet` kommen von aussen.
///
/// Der Datumsvergleich ist ein Textvergleich, und das ist Absicht: ISO-Daten
/// (JJJJ-MM-TT) sortieren als Text genauso wie als Datum, und ein Textvergleich
/// kann keine Zeitzone falsch verstehen. Eine Lizenz, die in Berlin einen Tag
/// früher abläuft als in Schorndorf, wäre ein Fehler, den niemand sucht.
pub fn urteil(f: &Felder, heute: &str, geraet: &str) -> Stand {
    if !f.geraet.is_empty() && f.geraet != geraet {
        return Stand::FremdesGeraet {
            haendler: f.haendler.clone(),
        };
    }
    // Leeres `bis` heisst unbefristet — der Regelfall bei einem Einmalpreis.
    if !f.bis.is_empty() && heute > f.bis.as_str() {
        return Stand::Abgelaufen {
            haendler: f.haendler.clone(),
            bis: f.bis.clone(),
        };
    }
    Stand::Gueltig {
        haendler: f.haendler.clone(),
        ab: f.ab.clone(),
        bis: f.bis.clone(),
    }
}

/// Eine Lizenz prüfen: erst die Unterschrift, dann Frist und Gerät.
pub fn pruefen(text: &str, heute: &str, geraet: &str) -> Stand {
    let schluessel = match PublicKey::from_base64(OEFFENTLICH) {
        Ok(s) => s,
        Err(e) => {
            return Stand::Ungueltig {
                grund: format!("Der eingebaute Prüfschlüssel ist unbrauchbar: {e}"),
            }
        }
    };
    let unterschrift = match Signature::decode(text.trim()) {
        Ok(s) => s,
        Err(_) => {
            return Stand::Ungueltig {
                grund: "Das ist kein Lizenzschlüssel. Bitte alle vier Zeilen einfügen.".into(),
            }
        }
    };
    // `false` = der alte, nicht vorgehashte Weg wird NICHT erlaubt. Ein Prüfer,
    // der Altlasten durchlässt, prüft weniger als einer, der es nicht tut.
    if schluessel.verify(NACHRICHT, &unterschrift, false).is_err() {
        return Stand::Ungueltig {
            grund: "Dieser Lizenzschlüssel gehört nicht zu Norns POS oder wurde verändert.".into(),
        };
    }
    let felder = felder_lesen(unterschrift.trusted_comment());
    if felder.haendler.is_empty() {
        return Stand::Ungueltig {
            grund: "In diesem Lizenzschlüssel steht kein Händler.".into(),
        };
    }
    urteil(&felder, heute, geraet)
}

/// Die Kennung dieses Geräts, für gerätegebundene Lizenzen.
///
/// Der Datenort, gehasht. Bewusst NICHT die Seriennummer der Platte oder die
/// Netzwerkadresse: die eine ändert sich beim Tausch einer defekten Platte, die
/// andere beim Wechsel von Kabel auf Funk. Beides würde eine gültige Lizenz an
/// einem Dienstagmorgen ohne Vorwarnung ungültig machen. Der Datenort ändert
/// sich nur, wenn jemand die Kasse wirklich neu aufsetzt.
pub fn geraete_kennung(datenort: &std::path::Path) -> String {
    crate::tresor::fingerabdruck(&datenort.to_string_lossy())
}

// ════════════════════════════════════════════════════════════════════════
//  DIE FREIGABE — was aus dem Stand wirklich FOLGT
// ════════════════════════════════════════════════════════════════════════
//
// ⚠️ GEMESSENER BEFUND, 13.08.2026: `darf_verkaufen()` wurde von NICHTS
// gerufen ausser den eigenen Tests. Die Prüfung war kryptographisch
// einwandfrei, die Rechtslinie richtig gezogen — und sie hielt nichts auf.
// Eine Kasse ganz ohne Schlüssel verkaufte unbegrenzt weiter. Gebaut und
// nie angeschlossen, im teuersten Sinn.
//
// ── BASELS WUNSCH UND MEIN WIDERSPRUCH ────────────────────────────────
//
// Basel wollte die Lizenz „in den Nerv weben": statt `if (lizenz gültig)`
// sollte der Schlüssel das DATENBANKPASSWORT entschlüsseln, damit ein
// manipuliertes Programm gar nicht erst an die Daten kommt und still
// stirbt.
//
// Den Teil baue ich NICHT, und zwar aus einem Grund, der schwerer wiegt
// als der Schutz: nach § 147 AO muss der Händler seine Aufzeichnungen zehn
// Jahre vorhalten und einem Prüfer VORLEGEN können. Wäre die Lizenz der
// Schlüssel zur Datenbank, dann verlöre er mit einer abgelaufenen Lizenz
// den Zugang zu seinen eigenen Büchern — und zwar genau in dem Moment, in
// dem der Prüfer im Laden steht. Wir würden einen Schalter bauen, der
// unseren zahlenden Kunden in die Pflichtverletzung zwingt. Das „stille
// Sterben ohne klare Fehlermeldung" widerspricht ausserdem Basels eigener
// Regel, dass ein Klick, der einen Fehler zeigt, ein grosses Problem ist.
//
// Was stattdessen gewebt wird: die Freigabe reist als Feld in die Umgebung
// des Motors, und der Motor weist NEUE fiskalische Vorgänge ab. Wer das
// umgehen will, muss das Rust-Programm ODER das Motorbündel verändern —
// nicht bloss einen Schalter im Fenster umlegen. Mehr ist bei einem
// Programm, das auf dem Rechner des Kunden liegt, ehrlich nicht zu haben;
// wer „unknackbar" verspricht, verkauft ein Gefühl.

/// Wie lange eine frisch aufgesetzte Kasse ohne Schlüssel verkaufen darf.
///
/// Ohne diese Frist wäre der Riegel unbrauchbar: eine gerade installierte
/// Kasse hat noch keinen Schlüssel, und ein Händler, der am Eröffnungstag
/// vor einer toten Kasse steht, ruft nicht an, sondern kauft eine andere.
/// Dreissig Tage sind lang genug für Einrichtung, Steuerberater und
/// Rechnungslauf, und kurz genug, um niemanden dauerhaft gratis zu tragen.
pub const KULANZ_TAGE: i64 = 30;

/// Die Datei, die den Tag des allerersten Starts festhält.
pub const ERSTSTART: &str = "norns.erststart";

/// Was der Motor wirklich wissen muss.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "freigabe", rename_all = "lowercase")]
pub enum Freigabe {
    /// Gültiger Schlüssel. Alles offen.
    Frei,
    /// Noch kein Schlüssel, aber die Kasse ist neu. Es läuft die Frist.
    Kulanz { verbleibende_tage: i64 },
    /// Kein gültiger Schlüssel und keine Frist mehr. NEUE Verkäufe und
    /// Ankäufe stehen; Bücher, Abschluss und Ausfuhr bleiben offen.
    Gesperrt { grund: String },
}

impl Freigabe {
    /// Darf ein NEUER fiskalischer Vorgang beginnen?
    pub fn darf_verkaufen(&self) -> bool {
        !matches!(self, Freigabe::Gesperrt { .. })
    }

    /// Der Wert, der in die Umgebung des Motors gereicht wird.
    pub fn fuer_den_motor(&self) -> &'static str {
        if self.darf_verkaufen() {
            "1"
        } else {
            "0"
        }
    }
}

/// Aus Stand und Alter der Kasse folgt die Freigabe.
///
/// Rein und ohne Uhr, damit jede Kante prüfbar ist.
pub fn freigabe(stand: &Stand, tage_seit_erststart: i64) -> Freigabe {
    if stand.darf_verkaufen() {
        return Freigabe::Frei;
    }
    // ⚠️ Die Kulanz gilt NUR, solange nie ein Schlüssel da war. Wer einmal
    // gezahlt hat und dessen Frist abläuft, bekommt nicht noch einmal
    // dreissig Gratistage — sonst wäre die Verlängerung freiwillig.
    if matches!(stand, Stand::Fehlt) {
        let verbleibende_tage = KULANZ_TAGE - tage_seit_erststart;
        if verbleibende_tage > 0 {
            return Freigabe::Kulanz { verbleibende_tage };
        }
    }
    Freigabe::Gesperrt {
        grund: grund_zum_sperren(stand),
    }
}

/// Der Satz, den der Händler liest. Er muss sagen, WAS geht und was nicht —
/// ein Händler, der glaubt, seine Kasse sei tot, ruft den Steuerberater an
/// statt uns.
fn grund_zum_sperren(stand: &Stand) -> String {
    const OFFEN: &str = " Ihre Bücher, der Tagesabschluss und alle Ausfuhren \
                         für das Finanzamt bleiben offen.";
    match stand {
        Stand::Abgelaufen { bis, .. } => format!(
            "Der Freischaltschlüssel dieser Kasse war bis zum {bis} gültig. \
             Neue Verkäufe und Ankäufe brauchen einen neuen Schlüssel.{OFFEN}"
        ),
        Stand::FremdesGeraet { .. } => format!(
            "Dieser Freischaltschlüssel gehört zu einer anderen Kasse. Für dieses \
             Gerät wird ein eigener Schlüssel gebraucht.{OFFEN}"
        ),
        Stand::Ungueltig { grund } => format!("{grund}{OFFEN}"),
        Stand::Fehlt => format!(
            "Diese Kasse ist noch nicht freigeschaltet. Die {KULANZ_TAGE} Tage zum \
             Einrichten sind vorbei; für neue Verkäufe und Ankäufe wird jetzt ein \
             Freischaltschlüssel gebraucht.{OFFEN}"
        ),
        // Kann nicht eintreten: eine gültige Lizenz kommt oben nie hierher.
        Stand::Gueltig { .. } => String::new(),
    }
}

/// Wie viele Tage diese Kasse schon steht.
///
/// Beim allerersten Aufruf wird der heutige Tag festgehalten. Fehlt die
/// Datei später (gelöscht, neuer Datenort), beginnt die Frist neu — das ist
/// hingenommen: der Datenort ist auch die Gerätekennung, ein neuer Datenort
/// ist also ohnehin eine neue Kasse.
pub fn tage_seit_erststart(datenort: &std::path::Path, heute: &str) -> i64 {
    let pfad = datenort.join(ERSTSTART);
    let erster = match std::fs::read_to_string(&pfad) {
        Ok(t) if !t.trim().is_empty() => t.trim().to_string(),
        _ => {
            let _ = std::fs::create_dir_all(datenort);
            let _ = std::fs::write(&pfad, heute);
            heute.to_string()
        }
    };
    tage_zwischen(&erster, heute)
}

/// Tage zwischen zwei ISO-Daten. Unlesbares zählt als „heute", nie als
/// „lange her" — ein kaputtes Datum darf keine Kasse sperren.
pub fn tage_zwischen(von: &str, bis: &str) -> i64 {
    let lesen = |s: &str| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok();
    match (lesen(von), lesen(bis)) {
        (Some(a), Some(b)) => (b - a).num_days().max(0),
        _ => 0,
    }
}

/// Die Freigabe dieser Kasse, gelesen von der Platte.
pub fn freigabe_lesen(datenort: &std::path::Path) -> Freigabe {
    let heute = heute();
    let stand = match std::fs::read_to_string(datenort.join(ABLAGE)) {
        Ok(text) => pruefen(&text, &heute, &geraete_kennung(datenort)),
        Err(_) => Stand::Fehlt,
    };
    freigabe(&stand, tage_seit_erststart(datenort, &heute))
}

/// Für die Fläche: Stand und Freigabe in einem Zug.
#[tauri::command]
pub fn lizenz_freigabe(app: tauri::AppHandle) -> Freigabe {
    freigabe_lesen(&datenort(&app))
}

/// Der aktuelle Stand, gelesen von der Platte.
#[tauri::command]
pub fn lizenz_stand(app: tauri::AppHandle) -> Stand {
    let ort = datenort(&app);
    match std::fs::read_to_string(ort.join(ABLAGE)) {
        Ok(text) => pruefen(&text, &heute(), &geraete_kennung(&ort)),
        Err(_) => Stand::Fehlt,
    }
}

/// Eine Lizenz einlösen: prüfen, und NUR bei Erfolg ablegen.
///
/// Die Reihenfolge ist der ganze Punkt. Erst schreiben und dann prüfen hiesse:
/// ein falsch eingefügter Schlüssel überschreibt den gültigen, der vorher da
/// war, und der Laden steht.
#[tauri::command]
pub fn lizenz_einloesen(app: tauri::AppHandle, text: String) -> Stand {
    let ort = datenort(&app);
    let stand = pruefen(&text, &heute(), &geraete_kennung(&ort));
    if matches!(stand, Stand::Gueltig { .. }) {
        let _ = std::fs::create_dir_all(&ort);
        if let Err(e) = std::fs::write(ort.join(ABLAGE), text.trim()) {
            return Stand::Ungueltig {
                grund: format!("Der Lizenzschlüssel ist echt, liess sich aber nicht ablegen: {e}"),
            };
        }
    }
    stand
}

pub(crate) fn datenort(app: &tauri::AppHandle) -> std::path::PathBuf {
    use tauri::Manager;
    app.path()
        .app_local_data_dir()
        .map(|p| p.join("daten"))
        .unwrap_or_else(|_| std::path::PathBuf::from("daten"))
}

/// Heute als JJJJ-MM-TT, aus der Uhr des Rechners.
///
/// Ja, der Händler kann die Uhr zurückstellen. Das ist bewusst hingenommen:
/// eine Kasse, die für die Lizenzfrist ins Internet fragt, ist keine
/// Offline-Kasse mehr, und eine zurückgestellte Uhr fällt in der fiskalischen
/// Kette ohnehin auf — die TSE signiert mit IHRER Zeit, nicht mit unserer.
fn heute() -> String {
    use chrono::Datelike;
    let t = chrono::Local::now();
    format!("{:04}-{:02}-{:02}", t.year(), t.month(), t.day())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Eine echte, mit dem echten Geheimschlüssel ausgestellte Lizenz.
    /// Erzeugt mit `node werkzeug/lizenz.mjs ausstellen`.
    const ECHT: &str = concat!(
        "untrusted comment: Norns POS Lizenz fuer Stampscoins Schorndorf\n",
        "RUTWtdrqDTz+Quexpg8QN76JWN0VrymW2F0pejcMoU90VcCgbeBFFXE2S65vGWEJNO9GcvfNTtwn32efSdu4+2vopeA+YddVSgs=\n",
        "trusted comment: haendler=Stampscoins Schorndorf;ab=2026-07-30;bis=2027-12-31\n",
        "UYaQhYxRW/iYYsZkZmMXpjuvWrwDnpMt5c0j/PO3hqAe8+mxN9nNYPudWXJ13cYh/C6AQukiwKdWjt4rdhuXAw==\n",
    );

    #[test]
    fn eine_echte_lizenz_schaltet_frei() {
        let stand = pruefen(ECHT, "2026-07-30", "egal");
        assert_eq!(
            stand,
            Stand::Gueltig {
                haendler: "Stampscoins Schorndorf".into(),
                ab: "2026-07-30".into(),
                bis: "2027-12-31".into(),
            }
        );
        assert!(stand.darf_verkaufen());
    }

    #[test]
    fn ein_veraenderter_haendlername_faellt_durch() {
        // DER Test dieser Datei. Wer den signierten Kommentar austauschen kann,
        // schreibt sich selbst eine Lizenz. Hier wird EIN Buchstabe getauscht.
        let gefaelscht = ECHT.replace("Stampscoins Schorndorf;", "Stampscoins Schorndorg;");
        let stand = pruefen(&gefaelscht, "2026-07-30", "egal");
        assert!(
            matches!(stand, Stand::Ungueltig { .. }),
            "ein veränderter Kommentar MUSS durchfallen, war: {stand:?}"
        );
        assert!(!stand.darf_verkaufen());
    }

    #[test]
    fn eine_erfundene_lizenz_faellt_durch() {
        assert!(matches!(
            pruefen("irgendein Text", "2026-07-30", "egal"),
            Stand::Ungueltig { .. }
        ));
    }

    #[test]
    fn nach_der_frist_steht_der_verkauf() {
        let stand = pruefen(ECHT, "2028-01-01", "egal");
        assert_eq!(
            stand,
            Stand::Abgelaufen {
                haendler: "Stampscoins Schorndorf".into(),
                bis: "2027-12-31".into(),
            }
        );
        assert!(!stand.darf_verkaufen());
    }

    #[test]
    fn am_letzten_tag_darf_noch_verkauft_werden() {
        // Die Fehlerklasse ist der Zaunpfahl: `>=` statt `>` hätte den Laden
        // einen Tag zu früh geschlossen, und zwar genau am Silvestertag.
        assert!(pruefen(ECHT, "2027-12-31", "egal").darf_verkaufen());
    }

    #[test]
    fn eine_lizenz_ohne_frist_laeuft_nie_ab() {
        let f = Felder {
            haendler: "Ein Laden".into(),
            ab: "2026-01-01".into(),
            bis: String::new(),
            geraet: String::new(),
        };
        // Einmalpreis heisst unbefristet. Ein leeres `bis` als „sofort
        // abgelaufen" zu lesen wäre der teuerste Fehler dieser Datei.
        assert!(urteil(&f, "2099-01-01", "egal").darf_verkaufen());
    }

    #[test]
    fn eine_lizenz_fuer_ein_anderes_geraet_schaltet_nicht_frei() {
        let f = Felder {
            haendler: "Ein Laden".into(),
            ab: "2026-01-01".into(),
            bis: String::new(),
            geraet: "kasse-eins".into(),
        };
        assert!(!urteil(&f, "2026-01-01", "kasse-zwei").darf_verkaufen());
        assert!(urteil(&f, "2026-01-01", "kasse-eins").darf_verkaufen());
    }

    #[test]
    fn ohne_lizenz_wird_nicht_verkauft() {
        assert!(!Stand::Fehlt.darf_verkaufen());
    }

    #[test]
    fn unbekannte_felder_machen_eine_lizenz_nicht_ungueltig() {
        let f = felder_lesen("haendler=Laden;ab=2026-01-01;neuesFeld=morgen");
        assert_eq!(f.haendler, "Laden");
        assert_eq!(f.ab, "2026-01-01");
    }

    // ── DIE FREIGABE ────────────────────────────────────────────────────

    fn gueltig() -> Stand {
        Stand::Gueltig {
            haendler: "Laden".into(),
            ab: "2026-01-01".into(),
            bis: String::new(),
        }
    }

    #[test]
    fn eine_gueltige_lizenz_gibt_sofort_frei() {
        for tage in [0, 1, 30, 400, 10_000] {
            assert_eq!(freigabe(&gueltig(), tage), Freigabe::Frei);
        }
    }

    /// ⚠️ Ohne diese Frist wäre der Riegel unbrauchbar: eine frisch
    /// installierte Kasse hat noch keinen Schlüssel, und ein Händler, der am
    /// Eröffnungstag vor einer toten Kasse steht, ruft nicht an.
    #[test]
    fn eine_frische_kasse_darf_einrichten_und_verkaufen() {
        assert_eq!(
            freigabe(&Stand::Fehlt, 0),
            Freigabe::Kulanz {
                verbleibende_tage: 30
            }
        );
        assert_eq!(
            freigabe(&Stand::Fehlt, 29),
            Freigabe::Kulanz {
                verbleibende_tage: 1
            }
        );
        assert!(freigabe(&Stand::Fehlt, 29).darf_verkaufen());
    }

    #[test]
    fn nach_der_frist_braucht_es_einen_schluessel() {
        let f = freigabe(&Stand::Fehlt, 30);
        assert!(!f.darf_verkaufen(), "die Frist endet nie");
        assert!(matches!(f, Freigabe::Gesperrt { .. }));
        assert!(!freigabe(&Stand::Fehlt, 365).darf_verkaufen());
    }

    /// ⚠️ Die Kulanz gilt NUR, solange nie ein Schlüssel da war. Bekäme ein
    /// abgelaufener Schlüssel wieder dreissig Gratistage, wäre jede
    /// Verlängerung freiwillig — und der Riegel Zierde.
    #[test]
    fn eine_abgelaufene_lizenz_bekommt_keine_neue_kulanz() {
        let abgelaufen = Stand::Abgelaufen {
            haendler: "Laden".into(),
            bis: "2026-08-01".into(),
        };
        for tage in [0, 1, 29] {
            assert!(
                !freigabe(&abgelaufen, tage).darf_verkaufen(),
                "die Kulanz wurde einem Zahler ein zweites Mal geschenkt"
            );
        }
    }

    #[test]
    fn ein_fremdes_geraet_bekommt_ebenfalls_keine_kulanz() {
        let fremd = Stand::FremdesGeraet {
            haendler: "Laden".into(),
        };
        assert!(!freigabe(&fremd, 0).darf_verkaufen());
    }

    /// Der Satz muss dem Händler sagen, was NOCH GEHT. Wer glaubt, seine
    /// Kasse sei tot, ruft den Steuerberater an statt uns — und macht in der
    /// Zwischenzeit seinen Tagesabschluss nicht.
    #[test]
    fn der_sperrsatz_nennt_was_offen_bleibt() {
        for stand in [
            Stand::Fehlt,
            Stand::Abgelaufen {
                haendler: "L".into(),
                bis: "2026-08-01".into(),
            },
            Stand::FremdesGeraet {
                haendler: "L".into(),
            },
            Stand::Ungueltig {
                grund: "Verändert.".into(),
            },
        ] {
            let Freigabe::Gesperrt { grund } = freigabe(&stand, 999) else {
                panic!("nicht gesperrt: {stand:?}");
            };
            assert!(
                grund.contains("Tagesabschluss"),
                "kein Tagesabschluss genannt: {grund}"
            );
            assert!(
                grund.contains("Finanzamt"),
                "keine Ausfuhr genannt: {grund}"
            );
            assert!(!grund.contains('_'), "Kennung im Händlersatz: {grund}");
        }
    }

    /// ⚠️ Der Riegel darf NIE einen fiskalischen Weg schliessen. Eine
    /// abgelaufene Lizenz, die den Tagesabschluss oder die DSFinV-K-Ausfuhr
    /// verhindert, zwingt den Händler in die Ordnungswidrigkeit nach
    /// § 146a AO — und zwar genau dann, wenn der Prüfer im Laden steht.
    /// Deshalb beantwortet die Freigabe GENAU EINE Frage.
    #[test]
    fn die_freigabe_kennt_nur_die_frage_nach_dem_verkauf() {
        let gesperrt = freigabe(&Stand::Fehlt, 999);
        assert!(!gesperrt.darf_verkaufen());
        // Und sonst nichts: es gibt keine zweite Frage, die man ihr stellen
        // könnte. Käme je eine `darf_abschliessen` dazu, fiele dieser Test.
        assert_eq!(gesperrt.fuer_den_motor(), "0");
        assert_eq!(Freigabe::Frei.fuer_den_motor(), "1");
        assert_eq!(
            Freigabe::Kulanz {
                verbleibende_tage: 3
            }
            .fuer_den_motor(),
            "1"
        );
    }

    #[test]
    fn tage_zwischen_zaehlt_vorwaerts_und_nie_rueckwaerts() {
        assert_eq!(tage_zwischen("2026-08-01", "2026-08-31"), 30);
        assert_eq!(tage_zwischen("2026-08-01", "2026-08-01"), 0);
        // Zurückgestellte Uhr: negativ wird zu null, nicht zu einer Sperre.
        assert_eq!(tage_zwischen("2026-08-31", "2026-08-01"), 0);
        // Unlesbares zählt als heute — ein kaputtes Datum sperrt keine Kasse.
        assert_eq!(tage_zwischen("kaputt", "2026-08-01"), 0);
        assert_eq!(tage_zwischen("2026-08-01", ""), 0);
    }

    /// Der erste Start schreibt den Tag, jeder weitere liest ihn.
    #[test]
    fn der_erststart_wird_einmal_festgehalten() {
        let ort = std::env::temp_dir().join(format!("norns-probe-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&ort);

        assert_eq!(tage_seit_erststart(&ort, "2026-08-13"), 0);
        // Beim zweiten Mal steht der ERSTE Tag noch da, nicht der heutige.
        assert_eq!(tage_seit_erststart(&ort, "2026-09-13"), 31);

        let _ = std::fs::remove_dir_all(&ort);
    }
}

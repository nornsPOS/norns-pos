//! Ist diese Warteschlange überhaupt in der Lage zu drucken?
//!
//! ── DER FUND VOM 02.08.2026 ─────────────────────────────────────────────────
//!
//! `lpr` liefert Rückgabewert 0, sobald der Auftrag in der WARTESCHLANGE liegt.
//! Nicht, wenn Papier herauskommt. Ist die Warteschlange angehalten oder nimmt
//! sie keine Aufträge an, meldet `lpr` trotzdem Erfolg — und die Kasse sagt dem
//! Kassierer „gedruckt".
//!
//! Am Tresen sieht das so aus: der Bon wird gedruckt, die Kasse ist zufrieden,
//! der Kunde wartet, es kommt nichts. Der Kassierer drückt noch einmal. Und
//! noch einmal. Wenn die Warteschlange später wieder anläuft, kommen vier
//! Belege auf einmal — bei einem fiskalischen Beleg ist das nicht nur peinlich.
//!
//! Eine angehaltene Warteschlange ist kein exotischer Fall. Sie entsteht von
//! selbst: CUPS hält eine Schlange an, wenn ein Auftrag mehrfach scheitert
//! (Drucker aus, Kabel ab, Papier leer), und sie bleibt danach angehalten, bis
//! ein Mensch sie fortsetzt. Tagelang.
//!
//! ── WAS HIER GEMESSEN WURDE UND WAS NICHT ──────────────────────────────────
//!
//! Am 02.08.2026 auf dieser Maschine, mit `lpstat` gegen ein echtes CUPS,
//! LESEND (keine Warteschlange wurde angefasst — das ist Basels Rechner, und
//! seine Drucker gehen mich nichts an):
//!
//! ```text
//! $ lpstat -p
//! printer Warehouse14-Bon is idle.  enabled since Fri Jul 24 12:20:17 2026
//!
//! $ lpstat -a
//! Warehouse14-Bon accepting requests since Fri Jul 24 12:20:17 2026
//!
//! $ lpstat -p NichtVorhandenXY   → Rückgabewert 1
//! $ lpstat -p Warehouse14-Bon    → Rückgabewert 0
//! ```
//!
//! Die Zeilen für „angehalten" und „nimmt nichts an" habe ich NICHT gemessen.
//! Dafür hätte ich eine echte Warteschlange anhalten müssen.
//!
//! Deshalb ist dieser Prüfer als POSITIVE BESTÄTIGUNG gebaut, nicht als
//! Fehlererkennung: er lässt nur durch, was er als „läuft und nimmt an"
//! WIEDERERKENNT. Alles andere — auch eine Zeile in einer Form, die ich nie
//! gesehen habe — führt zu einer Warnung, die den ROHTEXT von CUPS mitgibt.
//!
//! Das ist der entscheidende Unterschied. Ein Prüfer, der nach bekannten
//! Fehlerwörtern sucht, ist bei jedem unbekannten Zustand still und meldet
//! Erfolg. Dieser hier ist bei jedem unbekannten Zustand laut. Ein falscher
//! Alarm kostet einen Blick; ein verschluckter Beleg kostet den Kunden.

use crate::error::{HardwareError, HwResult};

/// Was `lpstat` über eine Warteschlange sagt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Warteschlangenlage {
    /// Bestätigt: läuft und nimmt Aufträge an.
    Bereit,
    /// NICHT bestätigt. `grund` trägt den Rohtext von CUPS, damit die
    /// Druckerdiagnose im Fenster daraus einen Satz mit Handlung machen kann
    /// („is stopped" → „Warteschlange angehalten, bitte fortsetzen").
    Fraglich { grund: String },
}

/// Aus den beiden `lpstat`-Ausgaben eine Lage machen.
///
/// `zustand` ist die Ausgabe von `lpstat -p <name>`, `annahme` die von
/// `lpstat -a <name>`. Beide werden gebraucht: eine Warteschlange kann laufen
/// und trotzdem nichts annehmen, und umgekehrt.
pub fn lage_aus(name: &str, zustand: &str, annahme: &str) -> Warteschlangenlage {
    let z = zustand.trim();
    let a = annahme.trim();

    // ⚠️ POSITIVE BESTÄTIGUNG. Es wird nicht nach Fehlern gesucht, sondern nach
    // dem einen Zustand, der beweisbar in Ordnung ist. Alles andere ist
    // fraglich — auch das, was ich nie gesehen habe.
    //
    // „is idle" und „now printing" sind beide gut: die zweite heisst, dass
    // gerade etwas läuft, und das ist der beste Beweis überhaupt.
    // ⚠️ DIE TEILWORTFALLE, 02.08.2026 vom eigenen Wächter gefunden.
    // Hier stand `a.contains("accepting requests")`. Die Zeile einer Schlange,
    // die NICHTS annimmt, lautet aber:
    //
    //     Warehouse14-Bon not accepting requests since …
    //
    // und die enthält „accepting requests" wörtlich. Eine Warteschlange, die
    // jeden Auftrag zurückweist, wäre also als bereit durchgegangen — das
    // Gegenteil des Zwecks dieser Datei, und ausgerechnet der Fall, den sie
    // fangen soll.
    //
    // Dasselbe gilt für den Zustand: „is not ready" und Verwandte. Deshalb
    // wird jede Bejahung gegen ihre Verneinung geprüft, nicht nur gesucht.
    let verneint = |text: &str, wort: &str| -> bool {
        text.contains(&format!("not {wort}")) || text.contains(&format!("no {wort}"))
    };
    let laeuft = (z.contains("is idle") || z.contains("now printing"))
        && z.contains("enabled since")
        && !verneint(z, "accepting")
        && !z.contains("disabled");
    let nimmt_an = a.contains("accepting requests") && !verneint(a, "accepting requests");

    if laeuft && nimmt_an {
        return Warteschlangenlage::Bereit;
    }

    // Leere Ausgabe heisst meist: die Warteschlange gibt es nicht (mehr).
    if z.is_empty() && a.is_empty() {
        return Warteschlangenlage::Fraglich {
            grund: format!(
                "Die Warteschlange „{name}\u{201c} ist dem System nicht bekannt. Sie wurde \
                 vermutlich im Betriebssystem entfernt."
            ),
        };
    }

    // Der Rohtext geht MIT. Er ist die einzige Auskunft, die wirklich sagt, was
    // los ist, und die Diagnose im Fenster kennt seine Wendungen.
    let roh = [z, a]
        .iter()
        .filter(|s| !s.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join(" | ");
    Warteschlangenlage::Fraglich { grund: roh }
}

/// Die Warteschlange fragen. Nur auf CUPS-Systemen; Windows hat kein `lpstat`.
///
/// Scheitert der Aufruf selbst, ist das KEIN Grund, den Druck abzubrechen:
/// dann ist die Prüfung ausgefallen, nicht der Drucker. Sie meldet `Bereit`,
/// damit ein kaputter Prüfer nicht das Drucken verhindert — das wäre ein
/// schlechterer Zustand als der, den er verhindern soll.
pub async fn lage_erfragen(name: &str) -> Warteschlangenlage {
    if cfg!(windows) {
        return Warteschlangenlage::Bereit;
    }
    let zustand = lpstat(&["-p", name]).await.unwrap_or_default();
    let annahme = lpstat(&["-a", name]).await.unwrap_or_default();
    if zustand.is_empty() && annahme.is_empty() {
        // Beide leer kann auch heissen: `lpstat` fehlt. Dann ist die Prüfung
        // ausgefallen und darf nicht als Befund gelten.
        return Warteschlangenlage::Bereit;
    }
    lage_aus(name, &zustand, &annahme)
}

async fn lpstat(args: &[&str]) -> Option<String> {
    let ausgabe = tokio::process::Command::new("lpstat")
        .args(args)
        .output()
        .await
        .ok()?;
    // ⚠️ Der Rückgabewert wird ABSICHTLICH nicht als Bedingung benutzt: bei
    // einer unbekannten Warteschlange ist er 1, und dann steht die Auskunft auf
    // der Fehlerausgabe. Beides wird gelesen.
    let mut text = String::from_utf8_lossy(&ausgabe.stdout).into_owned();
    if text.trim().is_empty() {
        text = String::from_utf8_lossy(&ausgabe.stderr).into_owned();
    }
    Some(text)
}

/// Vor dem Senden prüfen und mit einer brauchbaren Ablehnung abbrechen.
pub async fn vor_dem_senden_pruefen(name: &str) -> HwResult<()> {
    match lage_erfragen(name).await {
        Warteschlangenlage::Bereit => Ok(()),
        Warteschlangenlage::Fraglich { grund } => Err(HardwareError::Device(grund)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Wortgleich von dieser Maschine, 02.08.2026.
    const ECHT_ZUSTAND: &str =
        "printer Warehouse14-Bon is idle.  enabled since Fri Jul 24 12:20:17 2026";
    const ECHT_ANNAHME: &str = "Warehouse14-Bon accepting requests since Fri Jul 24 12:20:17 2026";

    #[test]
    fn die_echte_gemessene_ausgabe_gilt_als_bereit() {
        assert_eq!(
            lage_aus("Warehouse14-Bon", ECHT_ZUSTAND, ECHT_ANNAHME),
            Warteschlangenlage::Bereit
        );
    }

    #[test]
    fn ein_druckender_drucker_ist_erst_recht_bereit() {
        let z = "printer Warehouse14-Bon now printing Warehouse14-Bon-42.  enabled since Fri Jul 24 12:20:17 2026";
        assert_eq!(
            lage_aus("Warehouse14-Bon", z, ECHT_ANNAHME),
            Warteschlangenlage::Bereit
        );
    }

    #[test]
    fn eine_angehaltene_warteschlange_ist_fraglich() {
        // Diese Form habe ich nicht gemessen — genau deshalb ist der Prüfer als
        // positive Bestätigung gebaut. Sie fällt durch, WEIL sie nicht als
        // „läuft" wiedererkannt wird, nicht weil ein Wort erkannt wurde.
        let z = "printer Warehouse14-Bon disabled since Sat Aug  1 09:00:00 2026 -\n\tPaper jam";
        match lage_aus("Warehouse14-Bon", z, ECHT_ANNAHME) {
            Warteschlangenlage::Fraglich { grund } => {
                // Der Rohtext MUSS mit, sonst weiss der Mensch nichts.
                assert!(grund.contains("disabled"), "der Rohtext fehlt: {grund}");
                assert!(grund.contains("Paper jam"), "der Grund fehlt: {grund}");
            }
            andere => panic!("angehalten muss fraglich sein, war: {andere:?}"),
        }
    }

    #[test]
    fn eine_schlange_die_nichts_annimmt_ist_fraglich() {
        // Der tückischere Fall: der Drucker LÄUFT, nimmt aber nichts an. Wer
        // nur `lpstat -p` liest, hält ihn für in Ordnung.
        let a = "Warehouse14-Bon not accepting requests since Sat Aug  1 09:00:00 2026 -\n\tRejecting Jobs";
        match lage_aus("Warehouse14-Bon", ECHT_ZUSTAND, a) {
            Warteschlangenlage::Fraglich { grund } => {
                assert!(grund.contains("not accepting"), "{grund}");
            }
            andere => panic!("nicht annehmend muss fraglich sein, war: {andere:?}"),
        }
    }

    #[test]
    fn eine_voellig_unbekannte_form_ist_fraglich_statt_still() {
        // ⚠️ DER SATZ, AUF DEN ES ANKOMMT. Ein Prüfer, der nach bekannten
        // Fehlerwörtern sucht, wäre hier still und meldete Erfolg. Genau das
        // ist die Klasse Fehler, die dieser Prüfer verhindern soll.
        let z = "printer Warehouse14-Bon is in some state that has never been seen";
        match lage_aus("Warehouse14-Bon", z, ECHT_ANNAHME) {
            Warteschlangenlage::Fraglich { grund } => {
                assert!(grund.contains("never been seen"), "{grund}")
            }
            andere => panic!("unbekannt muss fraglich sein, war: {andere:?}"),
        }
    }

    #[test]
    fn eine_geloeschte_warteschlange_wird_benannt() {
        match lage_aus("Warehouse14-Bon", "", "") {
            Warteschlangenlage::Fraglich { grund } => {
                assert!(grund.contains("Warehouse14-Bon"));
                assert!(grund.contains("nicht bekannt"));
            }
            andere => panic!("gelöscht muss fraglich sein, war: {andere:?}"),
        }
    }

    #[test]
    fn die_teilwortfalle_bleibt_geschlossen() {
        // ⚠️ Dieser Satz existiert, weil der Fehler WIRKLICH im Code stand:
        // „not accepting requests" enthält „accepting requests". Eine
        // Warteschlange, die jeden Auftrag zurückweist, galt als bereit.
        //
        // Ohne diesen Satz kommt die Falle beim nächsten Umbau zurück, denn
        // die kürzere Schreibweise sieht völlig harmlos aus.
        for a in [
            "Warehouse14-Bon not accepting requests since Sat Aug  1 09:00:00 2026",
            "Warehouse14-Bon not accepting requests since Sat Aug  1 09:00:00 2026 -\n\tWartung",
        ] {
            assert_ne!(
                lage_aus("Warehouse14-Bon", ECHT_ZUSTAND, a),
                Warteschlangenlage::Bereit,
                "„not accepting requests\" darf NIE als bereit gelten: {a}"
            );
        }
    }

    #[test]
    fn beide_haelften_muessen_stimmen() {
        // Weder allein reicht. Ohne diesen Satz könnte jemand eine der beiden
        // Abfragen einsparen, und der jeweils andere Fall fiele still durch.
        assert_ne!(lage_aus("X", ECHT_ZUSTAND, ""), Warteschlangenlage::Bereit);
        assert_ne!(lage_aus("X", "", ECHT_ANNAHME), Warteschlangenlage::Bereit);
    }
}

/// ⚠️ Kein Druckweg darf je wieder ohne diese Prüfung senden.
///
/// Der Wächter dazu steht bewusst HIER und nicht in einer eigenen Datei: er
/// gehört zu der Regel, die er schützt. Eine namentliche Liste von Wegen wäre
/// blind geworden, sobald jemand einen fünften baut — deshalb sucht er im
/// Quelltext nach dem Aufruf von `lpr` und verlangt, dass jeder davon eine
/// Prüfung ÜBER sich hat.
#[cfg(test)]
mod kein_weg_ohne_pruefung {
    use std::fs;
    use std::path::Path;

    /// Jede Datei, die `lpr` startet, mit der Zeile des Aufrufs.
    fn lpr_stellen() -> Vec<(String, usize, String)> {
        let mut treffer = Vec::new();
        let ordner = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands");
        for eintrag in fs::read_dir(&ordner).expect("commands-Ordner fehlt") {
            let pfad = eintrag.expect("Eintrag").path();
            if pfad.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let name = pfad.file_name().unwrap().to_string_lossy().to_string();
            if name == "warteschlangenlage.rs" {
                continue; // die Regel selbst
            }
            let text = fs::read_to_string(&pfad).expect("lesbar");
            for (i, zeile) in text.lines().enumerate() {
                // Kommentare zählen nicht — sie erklären nur.
                let ohne = zeile.trim_start();
                if ohne.starts_with("//") {
                    continue;
                }
                if zeile.contains(r#"Command::new("lpr")"#) {
                    treffer.push((name.clone(), i + 1, text.clone()));
                }
            }
        }
        treffer
    }

    /// ⛔ JEDES CUPS-WERKZEUG BRAUCHT EINE PLATTFORMWEICHE ÜBER SICH
    ///
    /// ── DER BEFUND VOM 12.08.2026 ──────────────────────────────────────
    ///
    /// `label.rs` hatte EINE Fassung von `system_queue_exists` ohne Weiche,
    /// und sie startete `lpstat`. Windows hat kein `lpstat`, der Start ist
    /// dort immer `Err`, und der Zweig darunter lautete `return false`. Auf
    /// der Plattform des ersten Kunden war die Antwort auf „Verbindung
    /// prüfen" damit IMMER „nicht erreichbar", egal wie sauber der
    /// Etikettendrucker eingerichtet war.
    ///
    /// Der Bondrucker hatte die Weiche längst (`thermal.rs`), diese Datei
    /// hier ebenfalls (`if cfg!(windows)`). Nur der Etikettenweg nicht —
    /// die Hausklasse „der halbe Fix an derselben Ampel".
    ///
    /// ── WAS DIESER WÄCHTER MISST ──────────────────────────────────────
    ///
    /// Jeden Start von `lpstat` oder `lpinfo` im ganzen Befehlsordner. Über
    /// jedem MUSS in denselben 40 Zeilen eine Weiche stehen. Er führt KEINE
    /// Dateiliste: eine morgen angelegte Datei ist mitgeprüft.
    #[test]
    fn jedes_cups_werkzeug_hat_eine_plattformweiche_ueber_sich() {
        let ordner = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands");
        let mut ungeschuetzt = Vec::new();
        let mut gefunden = 0usize;
        for eintrag in fs::read_dir(&ordner).expect("commands-Ordner fehlt") {
            let pfad = eintrag.expect("Eintrag").path();
            if pfad.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let name = pfad.file_name().unwrap().to_string_lossy().to_string();
            if name == "warteschlangenlage.rs" {
                continue; // die Regel selbst
            }
            let text = fs::read_to_string(&pfad).expect("lesbar");
            let zeilen: Vec<&str> = text.lines().collect();
            for (i, zeile) in zeilen.iter().enumerate() {
                if zeile.trim_start().starts_with("//") {
                    continue;
                }
                let ruft_cups = zeile.contains(r#"Command::new("lpstat")"#)
                    || zeile.contains(r#"Command::new("lpinfo")"#);
                if !ruft_cups {
                    continue;
                }
                gefunden += 1;
                /*
                 * ⚠️ NICHT „die 40 Zeilen darueber" — das war meine erste
                 * Fassung, und sie meldete `drucker_erkennung.rs:405`
                 * faelschlich: dort steht die Weiche 57 Zeilen hoeher, am
                 * Kopf der FUNKTION. Ein Waechter, der ein Fenster misst
                 * statt der Sache, wird bei einer voellig richtigen Datei rot.
                 *
                 * Gemessen wird deshalb, was wirklich zaehlt: traegt die
                 * UMSCHLIESSENDE Funktion eine Weiche, oder steht eine
                 * Laufzeitweiche zwischen ihrem Kopf und diesem Aufruf.
                 */
                let kopf = zeilen[..i]
                    .iter()
                    .rposition(|z| {
                        let t = z.trim_start();
                        t.starts_with("fn ")
                            || t.starts_with("async fn ")
                            || t.starts_with("pub fn ")
                            || t.starts_with("pub async fn ")
                            || t.starts_with("pub(crate) fn ")
                            || t.starts_with("pub(crate) async fn ")
                    })
                    .unwrap_or(0);
                /*
                 * ⚠️ NUR ECHTE ATTRIBUTE, KEINE KOMMENTARE. Meine zweite
                 * Fassung las die sechs Zeilen ueber dem Kopf als Text — und
                 * blieb bei der Sabotage GRUEN, weil der Erklaerkommentar
                 * darueber das Wort `cfg(not(target_os = "windows"))`
                 * SELBST enthaelt. Der Waechter mass also die Erwaehnung
                 * statt den Gebrauch, genau die Klasse, gegen die er steht.
                 * Gezaehlt werden ab jetzt nur Zeilen, die mit `#[` beginnen.
                 */
                let attribute = zeilen[kopf.saturating_sub(8)..kopf]
                    .iter()
                    .filter(|z| z.trim_start().starts_with("#["))
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("\n");
                let im_rumpf = zeilen[kopf..i]
                    .iter()
                    .filter(|z| !z.trim_start().starts_with("//"))
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("\n");
                let hat_weiche = attribute.contains(r#"cfg(not(target_os = "windows"))"#)
                    || attribute.contains(r#"cfg(target_os = "windows")"#)
                    || im_rumpf.contains("cfg!(windows)");
                if !hat_weiche {
                    ungeschuetzt.push(format!("{name}:{}", i + 1));
                }
            }
        }
        assert!(
            gefunden > 0,
            "kein einziger Aufruf von lpstat oder lpinfo gefunden — misst dieser Wächter noch etwas?"
        );
        assert!(
            ungeschuetzt.is_empty(),
            "Diese Stellen starten ein CUPS-Werkzeug OHNE Plattformweiche. Auf Windows \
             gibt es das Werkzeug nicht, der Start scheitert, und der Zweig darunter \
             meldet dem Händler eine Unwahrheit:\n  {}",
            ungeschuetzt.join("\n  ")
        );
    }

    /// ⚠️ 12.08.2026: DIESER WÄCHTER LIEF NIE.
    ///
    /// Sein `#[test]` klebte doppelt am Nachbarn darüber (zwei Attribute an
    /// derselben Funktion sind für Rust nur eine Warnung), und hier stand
    /// keins. Gemessen an der Testliste: der Nachbar lief ZWEIMAL, dieser
    /// Name kam kein einziges Mal vor. Damit war der einzige Riegel, der
    /// einen neuen lpr-Druckweg auf eine vorherige Warteschlangenprüfung
    /// verpflichtet, wirkungslos — die Hausklasse „Tests, die still nie
    /// laufen".
    #[test]
    fn jeder_lpr_aufruf_hat_eine_pruefung_ueber_sich() {
        let stellen = lpr_stellen();
        assert!(
            !stellen.is_empty(),
            "kein einziger lpr-Aufruf gefunden — dieser Wächter prüft dann nichts"
        );
        let mut ungeschuetzt = Vec::new();
        for (datei, zeile, text) in &stellen {
            // Die Prüfung muss in derselben Funktion VOR dem Aufruf stehen.
            // Als Näherung: in den 60 Zeilen davor.
            let zeilen: Vec<&str> = text.lines().collect();
            let von = zeile.saturating_sub(60);
            let davor = zeilen[von..(zeile - 1)].join("\n");
            if !davor.contains("vor_dem_senden_pruefen") {
                ungeschuetzt.push(format!("{datei}:{zeile}"));
            }
        }
        assert!(
            ungeschuetzt.is_empty(),
            "Diese Druckwege senden, ohne die Warteschlange zu prüfen — sie melden \
             Erfolg, auch wenn kein Papier kommt:\n  {}",
            ungeschuetzt.join("\n  ")
        );
    }

    /// ⛔ KEINE BELEG-BYTES AUF DIE PLATTE, BEVOR DIE SCHLANGE GEPRÜFT IST
    ///
    /// ── DER BEFUND VOM 12.08.2026 ──────────────────────────────────────
    ///
    /// `thermal.rs` schrieb die Temp-Datei mit dem GANZEN Bon ZUERST und
    /// prüfte die Warteschlange danach. Die Prüfung verlässt die Funktion
    /// mit `?`; bei angehaltener Schlange blieb die Datei liegen. In ihr
    /// steht der vollständige Beleg als ESC/POS: TSE-Signatur, QR-Nutzlast,
    /// beim Ankauf der Name des Verkäufers. Jeder Fehlversuch legte eine
    /// weitere ab.
    ///
    /// `pdf.rs` hatte die richtige Reihenfolge längst. Wieder „der halbe Fix
    /// an derselben Ampel" — deshalb steht die Regel jetzt hier, statt nur
    /// einmal von Hand behoben zu sein.
    ///
    /// ── WAS DIESER WÄCHTER MISST ──────────────────────────────────────
    ///
    /// Jede Funktion im Befehlsordner, die `vor_dem_senden_pruefen` aufruft:
    /// darüber darf kein `fs::write` stehen. Keine Dateiliste, kein Fenster
    /// aus Zeilen — es zählt die Stelle IM SELBEN Funktionsrumpf.
    #[test]
    fn keine_belegbytes_auf_die_platte_vor_der_pruefung() {
        let ordner = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands");
        let mut verstoesse = Vec::new();
        let mut geprueft = 0usize;

        for eintrag in fs::read_dir(&ordner).expect("commands-Ordner fehlt") {
            let pfad = eintrag.expect("Eintrag").path();
            if pfad.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let name = pfad.file_name().unwrap().to_string_lossy().to_string();
            let inhalt = fs::read_to_string(&pfad).expect("lesbar");
            let zeilen: Vec<&str> = inhalt.lines().collect();

            for (i, zeile) in zeilen.iter().enumerate() {
                // Nur der ECHTE Aufruf, nicht seine Erwähnung im Kommentar:
                // der Wächter misst den GEBRAUCH, nicht das Wort.
                let roh = zeile.trim_start();
                if roh.starts_with("//") || roh.starts_with("///") || roh.starts_with("*") {
                    continue;
                }
                if !zeile.contains("vor_dem_senden_pruefen(") {
                    continue;
                }
                // Die Definition selbst ist kein Aufruf.
                if zeile.contains("pub async fn vor_dem_senden_pruefen") {
                    continue;
                }
                geprueft += 1;

                // Rückwärts bis zum Kopf der umschliessenden Funktion.
                let kopf = zeilen[..i]
                    .iter()
                    .rposition(|z| {
                        let t = z.trim_start();
                        t.starts_with("async fn ")
                            || t.starts_with("fn ")
                            || t.starts_with("pub async fn ")
                            || t.starts_with("pub fn ")
                    })
                    .unwrap_or(0);

                let rumpf_davor = zeilen[kopf..i]
                    .iter()
                    .filter(|z| {
                        let t = z.trim_start();
                        !t.starts_with("//") && !t.starts_with("*")
                    })
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("\n");

                if rumpf_davor.contains("fs::write") {
                    verstoesse.push(format!("{name}:{}", i + 1));
                }
            }
        }

        assert!(
            geprueft > 0,
            "kein einziger Aufruf von vor_dem_senden_pruefen gefunden — misst dieser Wächter noch etwas?"
        );
        assert!(
            verstoesse.is_empty(),
            "Hier werden Beleg-Bytes auf die Platte geschrieben, BEVOR die Warteschlange \
             geprüft ist. Schlägt die Prüfung an, verlässt die Funktion sich mit `?` und \
             die Datei bleibt liegen — mit TSE-Signatur und personenbezogenen Daten \
             darin:\n  {}",
            verstoesse.join("\n  ")
        );
    }
}

//! tresor — die Geheimnisse der Kasse, erzeugt und verwahrt vom Rumpf.
//!
//! ── WARUM ES DIESE DATEI GIBT ───────────────────────────────────────────────
//!
//! Der Motor (siehe `motor.rs`) ist der unveränderte Server aus Warehouse14. Er
//! verlangt beim Start drei Geheimnisse, und Sitzung A hat ihn ABSICHTLICH so
//! gelassen, dass er keines davon erfindet: fehlt eines, bricht er laut ab.
//!
//! Auf einem Ladenrechner gibt es aber niemanden, der `openssl rand` tippt. Also
//! erzeugt der Rumpf sie beim ersten Start und legt sie in den Systemtresor
//! (Windows-Anmeldeinformationsverwaltung, macOS-Schlüsselbund). Der Händler
//! tippt nichts, und nichts steht im Klartext auf der Platte.
//!
//! ── DER SCHLÜSSEL, DER NICHT VERLOREN GEHEN DARF ────────────────────────────
//!
//! Sitzung A hat davor gewarnt, und die Warnung ist der Grund für die halbe
//! Datei: `NORNS_PII_KEY` ist der Schlüssel, mit dem die Kundendaten
//! verschlüsselt in der Datenbank liegen. Geht er verloren, sind sie **für
//! immer** unlesbar. Nicht schwer, nicht teuer, sondern für immer.
//!
//! Die stille Bauform wäre: Schlüssel im Tresor nicht gefunden, also einen neuen
//! erzeugen. Die Kasse startet, sieht gesund aus, und jede alte Kundenzeile ist
//! ab diesem Moment Müll — bemerkt Wochen später, wenn jemand eine alte Rechnung
//! öffnet. Genau dieser Fall wird hier ROT statt still.
//!
//! Dafür liegt neben der Datenbank ein **Zeuge**: eine kleine Datei, die sagt
//! „für diesen Datenort wurde ein Schlüssel erzeugt, und sein Fingerabdruck ist
//! dieser". Beim Start werden Tresor und Zeuge gegeneinander gehalten:
//!
//!   Zeuge fehlt, Tresor leer     → erster Start. Erzeugen, Zeugen anlegen.
//!   Zeuge da,    Tresor gefüllt  → Fingerabdruck vergleichen. Gleich = weiter.
//!   Zeuge da,    Tresor leer     → ROT. Der Schlüssel ging verloren.
//!   Fingerabdruck ungleich       → ROT. Fremder Schlüssel zu diesen Daten.
//!
//! Der Zeuge enthält NUR den Fingerabdruck (SHA-256, gekürzt), nie den
//! Schlüssel. Wer die Datei liest, kann damit nichts entschlüsseln; wer den
//! Schlüssel rät, wird an ihr erkannt.

use std::path::Path;

use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::OsRng;
use base64::Engine;
use sha2::{Digest, Sha256};

/// Der Name, unter dem die Geheimnisse im Systemtresor liegen.
const DIENST: &str = "norns-pos";

/// Die Zeugendatei, die neben der Datenbank liegt.
const ZEUGE: &str = "schluessel-zeuge.txt";

/// Die drei Geheimnisse, die der Motor verlangt.
///
/// Die Namen sind die des Servers und bleiben es: der Motor ist unverändert,
/// also darf hier nichts umbenannt werden. Sie stehen in Anführungszeichen, weil
/// sie Umgebungsvariablen sind, keine Prosa.
const GEHEIMNISSE: [&str; 4] = [
    "AUTH_SECRET",
    "NORNS_PII_KEY",
    "KYC_IMAGE_ENCRYPTION_KEY",
    // 30.07.2026, von Sitzung A nachgereicht: das eingebettete Postgres will
    // ein Passwort, und es soll aus derselben Quelle kommen wie alles andere.
    // Es steht bewusst NICHT in einer Datei neben der Datenbank — wer den
    // Datenordner kopiert, hat damit noch keinen Zugang.
    "NORNS_DB_PASSWORT",
];

/// Der eine, dessen Verlust nicht heilbar ist.
const KUNDENSCHLUESSEL: &str = "NORNS_PII_KEY";

/// ═══════════════════════════════════════════════════════════════════════
///  ⛔ DIE ALTEN NAMEN DERSELBEN GEHEIMNISSE
/// ═══════════════════════════════════════════════════════════════════════
///
/// ── DER VORFALL VOM 19.08.2026, UND ER WAR MEIN FEHLER ─────────────────
///
/// Am 18.08. lief eine Umbenennung durch den ganzen Baum: `WAREHOUSE14_*`
/// wurde zu `NORNS_*`, 46 Dateien. Der Kopf DIESER Datei warnte davor,
/// wörtlich: „also darf hier nichts umbenannt werden. Sie stehen in
/// Anführungszeichen, weil sie Umgebungsvariablen sind, keine Prosa."
/// Die Umbenennung nahm die Warnung mit — und benannte die Namen um.
///
/// Diese Namen sind aber keine Variablen im Quelltext. Sie sind die
/// ADRESSE, unter der ein Geheimnis im Systemtresor des Händlers LIEGT.
/// Eine Kasse, die schon lief, hatte ihren Kundenschlüssel unter
/// `WAREHOUSE14_PII_KEY` abgelegt. Der neue Bau fragte nach
/// `NORNS_PII_KEY`, fand nichts, sah den Zeugen — und hielt an mit
/// „Der Schlüssel für die Kundendaten fehlt im Systemtresor".
///
/// Gemessen am 19.08. auf Basels Rechner: der Schlüssel lag die ganze Zeit
/// da, unter dem alten Namen. Es war kein Datenverlust, es war eine
/// falsche Adresse — aber die Kasse stand, und die Meldung sagte dem
/// Händler, er solle eine Sicherung zurückspielen, die er nie brauchte.
///
/// ── DIE HAUSREGEL, DIE DAS HÄTTE VERHINDERN MÜSSEN ────────────────────
///
/// „Gespeicherter Zustand wird von keiner Umbenennung angefasst." Sie
/// stand geschrieben; der Wächter kannte nur den KYC-Dienstnamen und
/// diese vier hier nicht. Er kennt sie jetzt.
///
/// Gelesen wird deshalb unter BEIDEN Namen. Der alte wird NICHT gelöscht:
/// bei dem einen unheilbaren Geheimnis ist ein zweiter Weg zurück mehr
/// wert als ein aufgeräumter Tresor.
const ALTNAME: [(&str, &str); 2] = [
    ("NORNS_PII_KEY", "WAREHOUSE14_PII_KEY"),
    ("NORNS_DB_PASSWORT", "WAREHOUSE14_DB_PASSWORT"),
];

/// Der alte Name eines Geheimnisses, falls es einen gibt.
fn altname(name: &str) -> Option<&'static str> {
    ALTNAME.iter().find(|(neu, _)| *neu == name).map(|(_, alt)| *alt)
}

/// ═══════════════════════════════════════════════════════════════════════
///  EIN FACH STATT VIER
/// ═══════════════════════════════════════════════════════════════════════
///
/// ── DER BEFUND VOM 08.08.2026 ─────────────────────────────────────────
///
/// Der Start las FÜNFMAL aus dem Systemtresor: einmal den Kundenschlüssel
/// zur Probe, danach alle vier Geheimnisse einzeln. Jedes Fach trägt eine
/// eigene Zugriffsliste, und jede Liste, die nicht passt, ist eine eigene
/// Passwortfrage.
///
/// Weil die Kasse ad hoc unterschrieben ist (`signingIdentity: "-"`),
/// wechselt ihre Kennung bei JEDEM Neubau — gemessen: installiert
/// `15158b0c…`, frisch gebaut `0b36c3b7…`. Keine der vier Listen passt dann
/// noch, und „Immer erlauben" hält nur bis zur nächsten Fassung. Ergebnis:
/// drei bis vier Passwortfragen je Start.
///
/// Ein Fach ist EINE Frage. Das wirkt sofort und unabhängig davon, ob die
/// Unterschrift schon stabil ist.
///
/// ── ⚠️ WARUM KEIN ALTES FACH GELÖSCHT WIRD ───────────────────────────
///
/// `NORNS_PII_KEY` ist der unheilbare Fall: ohne ihn sind Namen und
/// Anschriften der Kundschaft für immer unlesbar. Die alten Fächer bleiben
/// deshalb stehen, für immer. Sie kosten nichts, solange das Bündel
/// gelesen wird, und sie sind der Rückweg, wenn das Bündel je verlorengeht.
const BUENDEL: &str = "norns-geheimnisse";

/// Das Bündel aus Namen und Werten bauen. Rein, damit die Form prüfbar ist.
///
/// Bewusst von Hand statt über eine Bibliothek: der Inhalt sind vier
/// Base64-Werte ohne Sonderzeichen, und eine zusätzliche Abhängigkeit im
/// Startweg wäre ein zusätzlicher Weg, an dem der Start scheitern kann.
fn buendel_bauen(paare: &[(String, String)]) -> String {
    let felder: Vec<String> = paare
        .iter()
        .map(|(k, w)| {
            format!(
                "\"{}\":\"{}\"",
                k,
                w.replace('\\', "\\\\").replace('"', "\\\"")
            )
        })
        .collect();
    format!("{{{}}}", felder.join(","))
}

/// Das Bündel zerlegen. `None`, wenn es nicht die erwartete Form hat.
///
/// ⚠️ Ein halb gelesenes Bündel ist gefährlicher als gar keins: es sähe
/// vollständig aus und liesse den Kundenschlüssel fehlen. Deshalb gilt es
/// nur als gültig, wenn ALLE vier Namen darin stehen.
fn buendel_zerlegen(roh: &str) -> Option<Vec<(String, String)>> {
    let mut gefunden: Vec<(String, String)> = Vec::new();
    for name in GEHEIMNISSE {
        // ⚠️ Ein Bündel, das ein ÄLTERER Norns-Bau geschrieben hat, trägt die
        // alten Namen. Es ist dasselbe Geheimnis; nur die Aufschrift ist alt.
        let marke = format!("\"{}\":\"", name);
        let start = match roh.find(&marke) {
            Some(i) => i + marke.len(),
            None => {
                let alt_marke = format!("\"{}\":\"", altname(name)?);
                roh.find(&alt_marke)? + alt_marke.len()
            }
        };
        let rest = &roh[start..];
        // Der Wert endet am ersten unmaskierten Anführungszeichen.
        let mut wert = String::new();
        let mut zeichen = rest.chars();
        loop {
            match zeichen.next()? {
                '\\' => wert.push(zeichen.next()?),
                '"' => break,
                c => wert.push(c),
            }
        }
        if wert.is_empty() {
            return None;
        }
        gefunden.push((name.to_string(), wert));
    }
    Some(gefunden)
}

#[derive(Debug, PartialEq, Eq)]
pub enum TresorFehler {
    /// Der Systemtresor selbst antwortet nicht.
    TresorStumm(String),
    /// Der Zeuge sagt: hier gab es einen Schlüssel. Der Tresor hat keinen.
    SchluesselVerloren,
    /// Zeuge und Tresor kennen verschiedene Schlüssel.
    FremderSchluessel,
    /// Der Zeuge liess sich nicht schreiben — ohne ihn kein späterer Beweis.
    ZeugeNichtSchreibbar(String),
}

impl std::fmt::Display for TresorFehler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TresorStumm(e) => write!(
                f,
                "Der Systemtresor dieses Rechners antwortet nicht: {e}. \
                 Die Kasse startet nicht ohne ihn."
            ),
            Self::SchluesselVerloren => write!(
                f,
                "Der Schlüssel für die Kundendaten fehlt im Systemtresor, \
                 obwohl es ihn für diese Datenbank gab. Ohne ihn sind die \
                 gespeicherten Kundendaten nicht lesbar. Die Kasse erzeugt \
                 KEINEN neuen: das würde die alten Daten endgültig verlieren. \
                 Spielen Sie die Sicherung des Schlüssels zurück."
            ),
            Self::FremderSchluessel => write!(
                f,
                "Der Schlüssel im Systemtresor gehört nicht zu dieser Datenbank. \
                 Die Kasse startet nicht, damit keine Kundendaten überschrieben \
                 werden. Prüfen Sie, ob Datenordner und Rechner zusammengehören."
            ),
            Self::ZeugeNichtSchreibbar(e) => {
                write!(f, "Der Datenordner der Kasse ist nicht beschreibbar: {e}")
            }
        }
    }
}

/// Was beim Prüfen herauskam. Die Oberfläche zeigt bei `NeuErzeugt` einen
/// einmaligen Hinweis: es gibt jetzt einen Schlüssel, und er gehört gesichert.
#[derive(Debug, PartialEq, Eq)]
pub enum Herkunft {
    NeuErzeugt,
    Wiedergefunden,
}

/// Ein Geheimnis von 32 zufälligen Bytes, base64 kodiert.
///
/// 32 Bytes, weil der Server genau das verlangt: `KYC_IMAGE_ENCRYPTION_KEY`
/// muss zu exakt 32 Bytes dekodieren (AES-256), und `AUTH_SECRET` fordert
/// mindestens 32 Zeichen — base64 aus 32 Bytes ergibt 44.
fn wuerfeln() -> String {
    let mut rohe = [0u8; 32];
    OsRng.fill_bytes(&mut rohe);
    base64::engine::general_purpose::STANDARD.encode(rohe)
}

/// Der Fingerabdruck eines Schlüssels: die ersten 16 Hexzeichen seines
/// SHA-256. Genug, um zwei Schlüssel auseinanderzuhalten, zu wenig, um den
/// Schlüssel daraus zu gewinnen.
pub fn fingerabdruck(schluessel: &str) -> String {
    let summe = Sha256::digest(schluessel.as_bytes());
    summe.iter().take(8).map(|b| format!("{b:02x}")).collect()
}

/// Den Zeugen lesen. `None` heisst: es gab hier noch nie einen Schlüssel.
fn zeuge_lesen(datenort: &Path) -> Option<String> {
    let text = std::fs::read_to_string(datenort.join(ZEUGE)).ok()?;
    text.lines()
        .find_map(|z| z.trim().strip_prefix("fingerabdruck="))
        .map(|s| s.trim().to_string())
}

fn zeuge_schreiben(datenort: &Path, abdruck: &str) -> Result<(), TresorFehler> {
    let inhalt = format!(
        "# Norns POS — Zeuge des Kundenschlüssels.\n\
         # Diese Datei enthält KEINEN Schlüssel, nur seinen Fingerabdruck.\n\
         # Sie beweist, dass es für diese Datenbank einen Schlüssel gibt. Wird\n\
         # er im Systemtresor nicht mehr gefunden, startet die Kasse NICHT und\n\
         # erzeugt keinen neuen, weil das die Kundendaten endgültig verlöre.\n\
         # Nicht löschen.\n\
         fingerabdruck={abdruck}\n"
    );
    std::fs::create_dir_all(datenort)
        .and_then(|()| std::fs::write(datenort.join(ZEUGE), inhalt))
        .map_err(|e| TresorFehler::ZeugeNichtSchreibbar(e.to_string()))
}

/// Ein einzelnes Geheimnis aus dem Tresor holen, oder es dort anlegen.
fn holen_oder_anlegen(name: &str) -> Result<(String, Herkunft), TresorFehler> {
    let fach =
        keyring::Entry::new(DIENST, name).map_err(|e| TresorFehler::TresorStumm(e.to_string()))?;
    match fach.get_password() {
        Ok(wert) => Ok((wert, Herkunft::Wiedergefunden)),
        Err(keyring::Error::NoEntry) => {
            /*
             * ⛔ BEVOR ETWAS NEUES ENTSTEHT: liegt es unter dem alten Namen?
             *
             * Genau hier wäre der stille Datenverlust passiert. Ohne diese
             * Abfrage hätte der neue Bau einen frischen Kundenschlüssel
             * gewürfelt, ihn abgelegt, und jede alte Kundenzeile wäre für
             * immer unlesbar gewesen — der Zeuge hätte es zwar gemeldet,
             * aber nur, weil er zufällig da war.
             *
             * Wird der alte Wert gefunden, wandert er unter den heutigen
             * Namen MIT, und der alte bleibt liegen (zweiter Weg zurück).
             */
            if let Some(alt) = altname(name) {
                if let Some(wert) = lies_fach_genau(alt)? {
                    fach.set_password(&wert)
                        .map_err(|e| TresorFehler::TresorStumm(e.to_string()))?;
                    return Ok((wert, Herkunft::Wiedergefunden));
                }
            }
            let wert = wuerfeln();
            fach.set_password(&wert)
                .map_err(|e| TresorFehler::TresorStumm(e.to_string()))?;
            Ok((wert, Herkunft::NeuErzeugt))
        }
        Err(e) => Err(TresorFehler::TresorStumm(e.to_string())),
    }
}

/// Der Vergleich zwischen Zeuge und Tresor, als reine Entscheidung.
///
/// Bewusst ohne Tresor und ohne Dateisystem, damit der Kern prüfbar ist: hier
/// steckt das Urteil „verloren" gegen „fremd" gegen „in Ordnung", und ein
/// Fehler darin ist genau der stille Datenverlust, den die Datei verhindern
/// soll.
fn urteil(
    zeuge: Option<&str>,
    schluessel_im_tresor: Option<&str>,
) -> Result<Herkunft, TresorFehler> {
    match (zeuge, schluessel_im_tresor) {
        (None, None) => Ok(Herkunft::NeuErzeugt),
        (None, Some(_)) => Ok(Herkunft::Wiedergefunden),
        (Some(_), None) => Err(TresorFehler::SchluesselVerloren),
        (Some(abdruck), Some(schluessel)) => {
            if fingerabdruck(schluessel) == abdruck {
                Ok(Herkunft::Wiedergefunden)
            } else {
                Err(TresorFehler::FremderSchluessel)
            }
        }
    }
}

/// Alle drei Geheimnisse bereitstellen, für die Übergabe an den Motor.
///
/// `datenort` ist derselbe Ordner, den der Motor bekommt: der Zeuge gehört zu
/// den Daten, nicht zum Programm. Zieht der Händler den Datenordner auf einen
/// anderen Rechner, reist der Zeuge mit und deckt den fremden Schlüssel auf.
pub fn bereitstellen(datenort: &Path) -> Result<(Vec<(String, String)>, Herkunft), TresorFehler> {
    // ── DER SCHNELLE WEG: ein einziger Griff ──────────────────────────────
    //
    // Liegt das Bündel vollständig da, ist der Start mit EINER Abfrage fertig.
    // Das ist der Normalfall ab dem zweiten Start.
    let aus_buendel = lies_fach(BUENDEL)?.as_deref().and_then(buendel_zerlegen);

    // Das Urteil über den Kundenschlüssel, BEVOR irgendetwas angelegt wird.
    // Ein `holen_oder_anlegen` an dieser Stelle hätte den verlorenen Schlüssel
    // bereits durch einen neuen ersetzt und das Urteil unmöglich gemacht.
    //
    // ⚠️ Der Wert kommt aus dem Bündel, wenn es eines gibt, sonst aus dem
    // alten Einzelfach. Fehlt BEIDES und der Zeuge liegt da, hält `urteil`
    // die Kasse an — genau wie vorher.
    let bereits_da: Option<String> = match aus_buendel.as_ref() {
        Some(paare) => paare
            .iter()
            .find(|(k, _)| k == KUNDENSCHLUESSEL)
            .map(|(_, w)| w.clone()),
        None => lies_fach(KUNDENSCHLUESSEL)?,
    };
    let gesehen = zeuge_lesen(datenort);
    let herkunft = urteil(gesehen.as_deref(), bereits_da.as_deref())?;

    let fertig: Vec<(String, String)> = match aus_buendel {
        Some(paare) => paare,
        None => {
            // ── DER UMZUGSWEG, einmalig ────────────────────────────────────
            //
            // Die vier alten Fächer wie bisher lesen beziehungsweise anlegen,
            // dann das Bündel schreiben.
            //
            // ⚠️ Die alten Fächer werden NICHT gelöscht. `NORNS_PII_KEY`
            // ist der unheilbare Fall; solange sie stehen, gibt es einen
            // Rückweg, falls das Bündel je verlorengeht.
            let mut gesammelt = Vec::with_capacity(GEHEIMNISSE.len());
            for name in GEHEIMNISSE {
                let (wert, _) = holen_oder_anlegen(name)?;
                gesammelt.push((name.to_string(), wert));
            }
            // Scheitert das Schreiben, läuft der Start trotzdem weiter: die
            // Werte liegen vor. Nur die eine Passwortfrage bleibt dann.
            if let Ok(fach) = keyring::Entry::new(DIENST, BUENDEL) {
                let _ = fach.set_password(&buendel_bauen(&gesammelt));
            }
            gesammelt
        }
    };

    // Der Zeuge, immer neu geschrieben: fehlte er, weil jemand ihn gelöscht
    // hat, steht er danach wieder da.
    if let Some((_, schluessel)) = fertig.iter().find(|(k, _)| k == KUNDENSCHLUESSEL) {
        zeuge_schreiben(datenort, &fingerabdruck(schluessel))?;
    }

    Ok((fertig, herkunft))
}

/// Ein Fach lesen. `None` heisst: es gibt es nicht. Ein stummer Tresor wirft.
///
/// ⚠️ Fehlt das Fach unter dem heutigen Namen, wird der ALTE Name versucht
/// (siehe `ALTNAME`). Ein Geheimnis, das im Tresor liegt, gilt als gefunden —
/// unter welchem Namen es dort steht, ist Geschichte, kein Urteil.
fn lies_fach(name: &str) -> Result<Option<String>, TresorFehler> {
    if let Some(w) = lies_fach_genau(name)? {
        return Ok(Some(w));
    }
    match altname(name) {
        Some(alt) => lies_fach_genau(alt),
        None => Ok(None),
    }
}

/// Ein Fach unter GENAU diesem Namen lesen, ohne Rückfall.
fn lies_fach_genau(name: &str) -> Result<Option<String>, TresorFehler> {
    let fach =
        keyring::Entry::new(DIENST, name).map_err(|e| TresorFehler::TresorStumm(e.to_string()))?;
    match fach.get_password() {
        Ok(w) => Ok(Some(w)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(TresorFehler::TresorStumm(e.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ⛔ EIN BÜNDEL MIT DEN ALTEN NAMEN IST DASSELBE BÜNDEL
    ///
    /// ── DER VORFALL VOM 19.08.2026 ────────────────────────────────────
    ///
    /// Eine laufende Kasse hatte ihre Geheimnisse unter `WAREHOUSE14_*`
    /// abgelegt. Die Umbenennung vom 18.08. liess den neuen Bau nach
    /// `NORNS_*` fragen; `buendel_zerlegen` fand den Namen nicht, gab
    /// `None` zurück, das Einzelfach gab es unter dem neuen Namen auch
    /// nicht — und die Kasse hielt an mit „Der Schlüssel für die
    /// Kundendaten fehlt im Systemtresor". Der Schlüssel lag die ganze
    /// Zeit da.
    ///
    /// Dieser Satz hält den Rückweg offen. Fällt er, steht die Kasse
    /// jedes Händlers, der von einem älteren Norns-Bau kommt.
    #[test]
    fn ein_buendel_mit_alten_namen_wird_verstanden() {
        // Genau die Gestalt, die auf Basels Rechner lag: der Kundenschlüssel
        // und das Datenbankpasswort noch unter ihrem alten Namen, die
        // übrigen zwei schon unter dem heutigen.
        let roh = concat!(
            "{\"AUTH_SECRET\":\"a-wert\",",
            "\"WAREHOUSE14_PII_KEY\":\"kunden-wert\",",
            "\"KYC_IMAGE_ENCRYPTION_KEY\":\"kyc-wert\",",
            "\"WAREHOUSE14_DB_PASSWORT\":\"db-wert\"}"
        );
        let paare = buendel_zerlegen(roh).expect("das alte Bündel muss lesbar sein");
        assert_eq!(paare.len(), GEHEIMNISSE.len());
        // Die Werte reisen unter dem HEUTIGEN Namen weiter.
        let kunde = paare
            .iter()
            .find(|(k, _)| k == KUNDENSCHLUESSEL)
            .map(|(_, w)| w.as_str());
        assert_eq!(kunde, Some("kunden-wert"), "der Kundenschlüssel ging verloren");
    }

    /// ⛔ Und das Urteil danach lautet „wiedergefunden", nicht „verloren".
    #[test]
    fn ein_alter_schluessel_gilt_als_wiedergefunden() {
        let roh = concat!(
            "{\"AUTH_SECRET\":\"a\",",
            "\"WAREHOUSE14_PII_KEY\":\"k\",",
            "\"KYC_IMAGE_ENCRYPTION_KEY\":\"y\",",
            "\"WAREHOUSE14_DB_PASSWORT\":\"d\"}"
        );
        let paare = buendel_zerlegen(roh).expect("lesbar");
        let schluessel = paare
            .iter()
            .find(|(k, _)| k == KUNDENSCHLUESSEL)
            .map(|(_, w)| w.clone())
            .expect("Kundenschlüssel");
        // Der Zeuge trägt den Abdruck GENAU dieses Wertes — so lag es auf
        // dem Rechner des Händlers.
        let zeuge = fingerabdruck(&schluessel);
        assert_eq!(
            urteil(Some(&zeuge), Some(&schluessel)),
            Ok(Herkunft::Wiedergefunden),
            "eine Kasse mit gültigem alten Schlüssel darf nicht anhalten"
        );
    }

    /// Jeder Altname zeigt auf ein Geheimnis, das es wirklich gibt.
    #[test]
    fn jeder_altname_gehoert_zu_einem_echten_geheimnis() {
        for (neu, alt) in ALTNAME {
            assert!(
                GEHEIMNISSE.contains(&neu),
                "{neu} steht in ALTNAME, aber in keinem Geheimnis"
            );
            assert_ne!(neu, alt, "ein Altname, der derselbe ist, hilft niemandem");
        }
    }

    /// ⚠️ Das Bündel muss dasselbe zurückgeben, was hineingegangen ist.
    ///
    /// Ein Zeichen Verlust hier heisst: der Kundenschlüssel ist ein anderer,
    /// `urteil` meldet `FremderSchluessel`, und die Kasse startet nie wieder.
    #[test]
    fn das_buendel_gibt_zurueck_was_hineinging() {
        let ein: Vec<(String, String)> = GEHEIMNISSE
            .iter()
            .enumerate()
            .map(|(i, n)| (n.to_string(), format!("wert-{i}+/=AAAA")))
            .collect();
        let roh = buendel_bauen(&ein);
        assert_eq!(buendel_zerlegen(&roh), Some(ein));
    }

    /// Auch mit Zeichen, die die Form sprengen könnten.
    #[test]
    fn auch_anfuehrungszeichen_und_schraegstriche_ueberleben() {
        let ein: Vec<(String, String)> = GEHEIMNISSE
            .iter()
            .map(|n| (n.to_string(), r#"a"b\c"#.to_string()))
            .collect();
        assert_eq!(buendel_zerlegen(&buendel_bauen(&ein)), Some(ein));
    }

    /// ⚠️ DER GEFÄHRLICHSTE FALL.
    ///
    /// Ein Bündel, dem ein Name fehlt, darf NICHT als gültig gelten. Sonst
    /// startete die Kasse mit einem leeren Kundenschlüssel und machte die
    /// Kundendaten unlesbar, ohne dass jemand es merkt.
    #[test]
    fn ein_halbes_buendel_gilt_nicht() {
        let unvollstaendig = r#"{"AUTH_SECRET":"a","NORNS_DB_PASSWORT":"b"}"#;
        assert_eq!(buendel_zerlegen(unvollstaendig), None);
    }

    /// Und ein leerer Wert ist auch kein Wert.
    #[test]
    fn ein_leerer_wert_gilt_nicht() {
        let ein: Vec<(String, String)> = GEHEIMNISSE
            .iter()
            .map(|n| {
                (
                    n.to_string(),
                    if *n == KUNDENSCHLUESSEL {
                        String::new()
                    } else {
                        "x".into()
                    },
                )
            })
            .collect();
        assert_eq!(buendel_zerlegen(&buendel_bauen(&ein)), None);
    }

    /// Unsinn im Fach wird nicht halb geglaubt.
    #[test]
    fn unsinn_gilt_nicht() {
        assert_eq!(buendel_zerlegen("kein bündel"), None);
        assert_eq!(buendel_zerlegen(""), None);
        assert_eq!(buendel_zerlegen("{}"), None);
    }

    /// ⚠️ Der Umzug darf KEIN altes Fach löschen.
    ///
    /// Positiv gemessen am Quelltext dieser Datei: es gibt keinen einzigen
    /// Aufruf, der ein Tresorfach entfernt. `NORNS_PII_KEY` ist der
    /// unheilbare Fall — ohne ihn sind die Kundendaten für immer unlesbar.
    #[test]
    fn kein_altes_fach_wird_je_geloescht() {
        let ganze = include_str!("tresor.rs");
        // ⚠️ ZUM WIEDERHOLTEN MAL DIESELBE FALLE: die erste Fassung dieses
        // Wächters wurde an SICH SELBST rot — die Prüfzeile unten nennt das
        // verbotene Wort. Gemessen wird deshalb nur der LEBENDE Teil, alles
        // vor dem Prüfstand, und darin nur die Zeilen ohne Kommentar.
        let lebend = ganze.split("#[cfg(test)]").next().unwrap_or("");
        let code: String = lebend
            .lines()
            .filter(|z| {
                let t = z.trim_start();
                !t.starts_with("//") && !t.starts_with("///") && !t.starts_with("*")
            })
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            !code.contains("delete_password"),
            "eine Stelle loescht ein Tresorfach"
        );
        assert!(
            !code.contains("delete_credential"),
            "eine Stelle loescht ein Tresorfach"
        );
    }

    #[test]
    fn ein_frischer_rechner_darf_erzeugen() {
        assert_eq!(urteil(None, None), Ok(Herkunft::NeuErzeugt));
    }

    #[test]
    fn der_gleiche_schluessel_gilt_als_wiedergefunden() {
        let s = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
        let abdruck = fingerabdruck(s);
        assert_eq!(
            urteil(Some(&abdruck), Some(s)),
            Ok(Herkunft::Wiedergefunden)
        );
    }

    #[test]
    fn ein_verlorener_schluessel_wird_nie_stillschweigend_ersetzt() {
        // DIESER Test ist der Grund für die Datei. Fällt er weg, erzeugt die
        // Kasse beim leeren Tresor einen neuen Schlüssel, startet fröhlich und
        // hat alle Kundendaten unlesbar gemacht, ohne dass jemand es merkt.
        let abdruck = fingerabdruck("der alte schluessel");
        assert_eq!(
            urteil(Some(&abdruck), None),
            Err(TresorFehler::SchluesselVerloren)
        );
    }

    #[test]
    fn ein_fremder_schluessel_zu_fremden_daten_haelt_die_kasse_an() {
        let abdruck = fingerabdruck("der schluessel dieses ladens");
        assert_eq!(
            urteil(Some(&abdruck), Some("der schluessel eines anderen ladens")),
            Err(TresorFehler::FremderSchluessel)
        );
    }

    #[test]
    fn zwei_wuerfe_sind_nie_gleich_und_lang_genug() {
        let a = wuerfeln();
        let b = wuerfeln();
        assert_ne!(a, b);
        // Der Server verlangt mindestens 32 Zeichen für AUTH_SECRET …
        assert!(a.len() >= 32, "zu kurz für AUTH_SECRET: {}", a.len());
        // … und exakt 32 Bytes nach der Dekodierung für den Bildschlüssel.
        let rohe = base64::engine::general_purpose::STANDARD
            .decode(&a)
            .expect("muss base64 sein");
        assert_eq!(rohe.len(), 32, "AES-256 verlangt genau 32 Bytes");
    }

    #[test]
    fn der_zeuge_traegt_nie_den_schluessel_selbst() {
        let ort = std::env::temp_dir().join(format!("norns-zeuge-{}", uuid::Uuid::new_v4()));
        let schluessel = "ein sehr geheimer schluessel";
        zeuge_schreiben(&ort, &fingerabdruck(schluessel)).expect("schreibbar");
        let text = std::fs::read_to_string(ort.join(ZEUGE)).expect("lesbar");
        assert!(
            !text.contains(schluessel),
            "der Zeuge darf den Schlüssel niemals enthalten"
        );
        assert_eq!(
            zeuge_lesen(&ort).as_deref(),
            Some(fingerabdruck(schluessel).as_str())
        );
        let _ = std::fs::remove_dir_all(&ort);
    }
}

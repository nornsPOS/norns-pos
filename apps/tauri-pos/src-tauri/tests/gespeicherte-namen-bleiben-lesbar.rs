//! ⛔ EIN NAME IM SYSTEMTRESOR IST EINE ADRESSE, KEIN BEZEICHNER
//!
//! ── DER VORFALL VOM 19.08.2026 ─────────────────────────────────────────────
//!
//! Am 18.08. lief eine Umbenennung durch den Baum: `WAREHOUSE14_*` wurde zu
//! `NORNS_*`, sechsundvierzig Dateien. Der Kopf von `src/tresor.rs` warnte
//! wörtlich davor — „also darf hier nichts umbenannt werden. Sie stehen in
//! Anführungszeichen, weil sie Umgebungsvariablen sind, keine Prosa." Die
//! Umbenennung las die Warnung nicht; sie benannte um.
//!
//! Am 19.08. startete Basels Kasse nicht mehr:
//!
//!     „Der Schlüssel für die Kundendaten fehlt im Systemtresor, obwohl es
//!      ihn für diese Datenbank gab. … Spielen Sie die Sicherung zurück."
//!
//! Gemessen auf seinem Rechner lag der Schlüssel die ganze Zeit im Tresor —
//! unter `WAREHOUSE14_PII_KEY`. Es war kein Datenverlust, es war eine falsche
//! Adresse. Aber die Kasse stand, und der Satz schickte den Händler nach einer
//! Sicherung, die er nie gebraucht hätte.
//!
//! ── WARUM DIESER WÄCHTER EIGENSTÄNDIG IST ─────────────────────────────────
//!
//! Der Nachbar (`kein-fremdes-zeichen-in-tempdateien.rs`) bewacht die
//! Fremdmarke im SICHTBAREN. Er kannte den KYC-Dienstnamen und liess ihn
//! bewusst stehen — die vier Geheimnisnamen hier kannte er nicht. Genau durch
//! diese Lücke ging der Fehler.
//!
//! Dieser Satz hält die andere Richtung: was ein Händler auf seinem Rechner
//! LIEGEN hat, muss lesbar bleiben, auch wenn wir es heute anders nennen.

use std::fs;
use std::path::Path;

/// Der Quelltext des Tresors.
fn tresor() -> String {
    fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/tresor.rs"))
        .expect("src/tresor.rs muss lesbar sein")
}

#[test]
/// ⛔ Jeder Name, der je im Tresor eines Händlers stand, bleibt erreichbar.
fn jeder_alte_geheimnisname_wird_noch_gelesen() {
    let q = tresor();
    // Die Namen, unter denen ausgelieferte Kassen ihre Geheimnisse ABGELEGT
    // haben. Sie dürfen aus diesem Quelltext NIE verschwinden, solange auch
    // nur eine Kasse von damals noch startet.
    for alt in ["WAREHOUSE14_PII_KEY", "WAREHOUSE14_DB_PASSWORT"] {
        assert!(
            q.contains(alt),
            "Der alte Name {alt} steht nicht mehr im Tresor. Eine Kasse, die ihn \
             abgelegt hat, startet damit nie wieder — genau der Vorfall vom 19.08.2026."
        );
    }
}

#[test]
/// ⛔ Und der Rückfall wird auch WIRKLICH benutzt, nicht nur erwähnt.
fn der_rueckfall_haengt_am_lesenden_weg() {
    let q = tresor();
    // Erwähnung ist nicht Gebrauch: der Altname muss im Leseweg auftauchen,
    // nicht bloss in einem Kommentar. Beide Wege werden geprüft — das Bündel
    // und das Einzelfach.
    assert!(
        q.contains("fn altname("),
        "die Zuordnung alt->neu fehlt als Funktion"
    );
    assert!(
        q.contains("match altname(name)"),
        "lies_fach fragt den alten Namen nicht"
    );
    assert!(
        q.contains("altname(name)?"),
        "buendel_zerlegen fragt den alten Namen nicht"
    );
    assert!(
        q.contains("if let Some(alt) = altname(name)"),
        "holen_oder_anlegen wuerfelt einen neuen Schluessel, ohne den alten zu suchen"
    );
}

#[test]
/// ⚠️ Der Dienstname des Tresors selbst ist ebenfalls eine Adresse.
fn der_tresor_dienst_bleibt_wie_er_ist() {
    let q = tresor();
    assert!(
        q.contains(r#"const DIENST: &str = "norns-pos""#),
        "Der Dienstname des Systemtresors wurde geaendert. Jede Kasse, die ihre \
         Geheimnisse unter dem alten Dienst abgelegt hat, findet sie danach nicht \
         mehr — dieselbe Klasse wie der Vorfall vom 19.08.2026."
    );
    assert!(
        q.contains(r#"const BUENDEL: &str = "norns-geheimnisse""#),
        "Der Name des Buendelfachs wurde geaendert. Siehe oben."
    );
}

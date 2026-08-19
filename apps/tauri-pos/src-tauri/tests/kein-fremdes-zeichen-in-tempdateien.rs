//! ⛔ KEIN FREMDES ZEICHEN IN DEN DATEINAMEN, DIE DER HAENDLER SIEHT
//!
//! ── DER BEFUND (Basels Foto vom 18.08.2026) ────────────────────────────────
//!
//! Der Etikettendruck oeffnete auf Windows den Betrachter, und in der
//! Adressleiste stand fuer jeden lesbar:
//!
//!     C:/Users/User/AppData/Local/Temp/warehouse14-etikett-0880e2a9-….pdf
//!
//! warehouse14 ist Romans System, nicht unseres. Die Umbenennung vom 14.08.
//! nahm Paketnamen und Marken (Bauzeit), aber NICHT die Temp-Dateinamen —
//! genau die tauchen beim Haendler auf dem Bildschirm auf.
//!
//! ── WAS DIESER WAECHTER MISST ──────────────────────────────────────────────
//!
//! Kein `format!`-Dateiname im Quelltext traegt mehr das fremde Zeichen.
//! Kommentare zaehlen nicht (Geschichte darf erzaehlt werden); gemessen wird
//! der Code ohne Kommentare.
//!
//! ⚠️ BEWUSST NICHT verboten: `sqlite:warehouse14.db` in lib.rs. Das ist
//! GESPEICHERTER ZUSTAND auf ausgelieferten Kassen — eine Umbenennung wuerde
//! die bestehende Ausgangs-Warteschlange verwaisen. Sie faellt, wenn eine
//! Wanderung sie faellt, nicht ein Suchlauf.

use std::fs;
use std::path::{Path, PathBuf};

fn quelldateien(wurzel: &Path, sammel: &mut Vec<PathBuf>) {
    for eintrag in fs::read_dir(wurzel).expect("lesbar") {
        let pfad = eintrag.expect("eintrag").path();
        if pfad.is_dir() {
            quelldateien(&pfad, sammel);
        } else if pfad.extension().is_some_and(|e| e == "rs") {
            sammel.push(pfad);
        }
    }
}

/// Kommentare weg: eine Erklaerung ist kein Dateiname.
fn ohne_kommentare(text: &str) -> String {
    let mut aus = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find("/*") {
        aus.push_str(&rest[..i]);
        rest = match rest[i..].find("*/") {
            Some(j) => &rest[i + j + 2..],
            None => "",
        };
    }
    aus.push_str(rest);
    aus.lines()
        .map(|z| match z.find("//") {
            Some(i) => &z[..i],
            None => z,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn temp_dateinamen_tragen_kein_fremdes_zeichen() {
    let wurzel = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut dateien = Vec::new();
    quelldateien(&wurzel, &mut dateien);
    assert!(dateien.len() > 20, "der Suchlauf findet den Baum nicht");

    let mut befunde = Vec::new();
    for datei in &dateien {
        let text = fs::read_to_string(datei).expect("lesbar");
        let code = ohne_kommentare(&text);
        for (nr, zeile) in code.lines().enumerate() {
            let z = zeile.to_lowercase();
            /*
             * ⛔ GESPEICHERTER ZUSTAND wird nicht per Suchlauf umbenannt:
             *
             *   • `sqlite:warehouse14.db` — die Ausgangs-Warteschlange auf
             *     ausgelieferten Kassen. Umbenennen hiesse: bestehende, noch
             *     nicht uebertragene Fiskaldaten verwaisen.
             *   • KEYRING_SERVICE "warehouse14" (kyc.rs) — unter diesem
             *     Dienstnamen liegt der KYC-Schluessel im Systemtresor der
             *     Kunden. Umbenennen hiesse: verschluesselte Ausweisdaten
             *     werden unlesbar. Faellt nur mit einer Wanderung, die den
             *     Eintrag liest und neu ablegt.
             *   • "Warehouse14-Bon" (drucker_erkennung.rs) — GEMESSENE
             *     Wirklichkeit: so heisst die CUPS-Warteschlange an Basels
             *     Tresen wirklich. Ein Fixture umzubenennen, das eine Messung
             *     wiedergibt, faelschte die Messung.
             *   • WAREHOUSE14_PII_KEY / WAREHOUSE14_DB_PASSWORT (tresor.rs)
             *     — 19.08.2026, und dieser Eintrag ist mit Schaden bezahlt.
             *     Das sind ADRESSEN im Systemtresor ausgelieferter Kassen,
             *     keine Marke im Sichtbaren. Die Umbenennung vom 18.08. hat
             *     sie mitgenommen; am naechsten Morgen startete Basels Kasse
             *     nicht mehr und verlangte eine Sicherung, die es nicht
             *     brauchte — der Schluessel lag die ganze Zeit da, unter dem
             *     alten Namen. Sie MUESSEN im Quelltext bleiben, solange auch
             *     nur eine Kasse von damals noch startet; ein eigener
             *     Waechter (`gespeicherte-namen-bleiben-lesbar.rs`) erzwingt
             *     genau das von der anderen Seite.
             */
            if z.contains("sqlite:warehouse14.db")
                || z.contains("keyring_service")
                || z.contains("warehouse14-bon")
                || z.contains("warehouse14_pii_key")
                || z.contains("warehouse14_db_passwort")
            {
                continue;
            }
            if z.contains("warehouse14-") || z.contains("warehouse14_") || z.contains("\"warehouse14") {
                befunde.push(format!("{}:{}: {}", datei.display(), nr + 1, zeile.trim()));
            }
        }
    }
    assert!(
        befunde.is_empty(),
        "Fremdes Zeichen im Code (Temp-Namen, Dokumentnamen):\n{}",
        befunde.join("\n")
    );
}

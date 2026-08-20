//! ════════════════════════════════════════════════════════════════════════
//!  Die Fragen an den Steuerberater, als Papier
//! ════════════════════════════════════════════════════════════════════════
//!
//! Basels Auftrag vom 12.08.2026: viele Händler kennen die Antworten nicht
//! und sollen sie auch nicht kennen müssen. Die Kasse druckt die Fragen als
//! sauberes Blatt mit dem Zeichen des Hauses; der Händler gibt es seiner
//! Kanzlei, die füllt es mit dem Stift aus, und die Werte wandern danach
//! einmal in die Einstellungen.
//!
//! ── ⚠️ WAS DIESES DOKUMENT NIE TUT ─────────────────────────────────────
//!
//! Es erfindet keinen Wert. Eine schon eingetragene Angabe erscheint als
//! eingetragener Wert, eine offene als Schreiblinie für den Stift — nie als
//! stille Vorgabe, die wie eine Antwort aussieht. Die gesetzten
//! HAUSSTANDARDS (Abschnitt B) stehen ausdrücklich als solche da, mit ihrer
//! amtlichen Fundstelle und einer Zeile zum GEGENZEICHNEN.
//!
//! Der Inhalt kommt aus der Fläche (`SteuerberaterFragenDaten`), nicht aus
//! einer hier eingebackenen Kopie: die Fläche kennt die LEBENDEN Werte der
//! Einstellungen, und zwei Kopien desselben Briefs wären die Hauskrankheit
//! „zwei Listen driften".

use serde::{Deserialize, Serialize};

use super::pdf::{compile_typst_to_pdf, esc};
use super::verfahrensdoku_pdf::{zeichen, FADEN, LEISE, TINTE};
use crate::error::{HardwareError, HwResult};

// ────────────────────────────────────────────────────────────────────────
// Der Inhalt, wie ihn die Fläche liefert
// ────────────────────────────────────────────────────────────────────────

/// Eine einzelne Zeile im Frageblock.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrageZeile {
    pub etikett: String,
    /// Ein kurzer Satz, warum die Kasse das braucht. Darf leer sein.
    #[serde(default)]
    pub erklaerung: String,
    /// `None` = offene Frage, es wird eine Schreiblinie gesetzt.
    /// `Some(wert)` = bereits eingetragen; der Wert steht sichtbar da.
    #[serde(default)]
    pub wert: Option<String>,
}

/// Ein Abschnitt des Briefs.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrageAbschnitt {
    pub nummer: String,
    pub titel: String,
    /// Ein bis drei Sätze Kontext, gern mit der amtlichen Fundstelle.
    #[serde(default)]
    pub einleitung: String,
    #[serde(default)]
    pub zeilen: Vec<FrageZeile>,
    /// Freitext-Absätze nach den Zeilen (etwa die 3270-Warnung).
    #[serde(default)]
    pub absaetze: Vec<String>,
    /// `true` setzt eine Unterschriftszeile „Gegenzeichnung der Kanzlei".
    #[serde(default)]
    pub gegenzeichnung: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteuerberaterFragenDaten {
    /// Erzeugungszeitpunkt, schon in deutscher Schreibweise.
    pub erzeugt_am_text: String,
    /// Die Firma des Händlers. Leer heisst leer — dann bleibt die Zeile weg.
    pub firma: String,
    pub einleitung: Vec<String>,
    pub abschnitte: Vec<FrageAbschnitt>,
    pub schluss: Vec<String>,
}

// ────────────────────────────────────────────────────────────────────────
// Der Befehl
// ────────────────────────────────────────────────────────────────────────

/// Den Brief als PDF setzen. Reine Rechenarbeit, deshalb auf dem
/// blockierenden Vorrat — sonst hungert die Fensterschleife.
#[tauri::command]
pub async fn generate_steuerberater_fragen_pdf(
    daten: SteuerberaterFragenDaten,
) -> HwResult<Vec<u8>> {
    tauri::async_runtime::spawn_blocking(move || {
        compile_typst_to_pdf(baue_fragen_quelle(&daten)).map_err(|meldung| {
            HardwareError::Encoding(format!(
                "Die Steuerberater-Fragen konnten nicht gesetzt werden: {meldung}"
            ))
        })
    })
    .await
    .map_err(|e| HardwareError::Internal(format!("Der Setzvorgang wurde abgebrochen: {e}")))?
}

// ────────────────────────────────────────────────────────────────────────
// Die Quelle des Dokuments
// ────────────────────────────────────────────────────────────────────────

/// Ein Wert als Typst-Zeichenkette in Textstellung, damit `#` oder `*` im
/// Inhalt nicht als Auszeichnung gelesen werden.
fn t(s: &str) -> String {
    format!("#\"{}\"", esc(s))
}

/// Die Schreiblinie für den Stift der Kanzlei: gepunktet, mit Luft darüber,
/// damit eine Handschrift wirklich Platz hat.
fn schreiblinie() -> String {
    format!(
        "#v(0.9em)#line(length: 100%, stroke: (paint: rgb(\"{LEISE}\"), thickness: 0.6pt, dash: \"dotted\"))\n"
    )
}

/// Eine Fragezeile: Etikett, darunter leise die Erklärung, daneben der Wert
/// oder die Schreiblinie.
fn zeile_block(z: &FrageZeile) -> String {
    let mut q = String::new();
    q.push_str(&format!(
        "#text(size: 10.5pt)[#strong[{}]]\n",
        t(&z.etikett)
    ));
    let erkl = z.erklaerung.trim();
    if !erkl.is_empty() {
        q.push_str(&format!(
            "#v(0.15em)#text(size: 8.5pt, fill: rgb(\"{LEISE}\"))[{}]\n",
            t(erkl)
        ));
    }
    match z.wert.as_deref().map(str::trim) {
        Some(wert) if !wert.is_empty() => {
            // Bereits eingetragen: der Wert steht da, die Kanzlei prüft ihn.
            q.push_str(&format!(
                "#v(0.35em)#text(font: \"DejaVu Sans Mono\", size: 10pt)[{}] \
                 #text(size: 8.5pt, fill: rgb(\"{LEISE}\"))[in der Kasse hinterlegt, bitte prüfen oder korrigieren]\n",
                t(wert)
            ));
        }
        _ => q.push_str(&schreiblinie()),
    }
    q.push_str("#v(0.9em)\n");
    q
}

/// Die Unterschriftszeile der Kanzlei unter einem gesetzten Standard.
fn gegenzeichnung_block() -> String {
    format!(
        "#v(1.1em)\n\
         #grid(columns: (1fr, 1fr), column-gutter: 8%,\n\
         \x20 [#line(length: 100%, stroke: (paint: rgb(\"{TINTE}\"), thickness: 0.6pt))\n\
         \x20  #v(0.2em)#text(size: 8.5pt, fill: rgb(\"{LEISE}\"))[Ort, Datum]],\n\
         \x20 [#line(length: 100%, stroke: (paint: rgb(\"{TINTE}\"), thickness: 0.6pt))\n\
         \x20  #v(0.2em)#text(size: 8.5pt, fill: rgb(\"{LEISE}\"))[Gegenzeichnung der Kanzlei]])\n\
         #v(0.6em)\n"
    )
}

/// Der vollständige Typst-Quelltext.
pub fn baue_fragen_quelle(d: &SteuerberaterFragenDaten) -> String {
    let mut q = String::new();

    // ── Satzspiegel und Grundschrift — wie die Verfahrensdokumentation ──
    q.push_str(&format!(
        "#set text(font: \"Libertinus Serif\", size: 10.5pt, lang: \"de\", fill: rgb(\"{TINTE}\"))\n\
         #set par(leading: 0.72em)\n\
         #set page(paper: \"a4\", margin: (top: 2.4cm, bottom: 2.2cm, left: 2.4cm, right: 2.2cm),\n\
         \x20 footer: [#align(center)[#text(size: 8pt, fill: rgb(\"{LEISE}\"))[Norns POS, Fragen an den Steuerberater, Stand {}]]])\n",
        // ⚠️ t(), nicht esc() roh: der Fuss ist MARKUP-Kontext. esc() deckt nur
        // den String-Kontext #"..." — ein `]` im Text brach die Kompilierung,
        // ein `#strong[...]` schleuste lebendes Markup ein (Gegenpruefung vom
        // 12.08.2026, empirisch am echten Compiler gezeigt). Alle anderen
        // Werte liefen laengst durch t(); das hier war die zehnte Quelle an
        // derselben Ampel.
        t(&d.erzeugt_am_text)
    ));

    // ── Der Kopf: das Zeichen, der Titel, die Firma ─────────────────────
    q.push_str(&format!("#grid(columns: (auto, 1fr), column-gutter: 14pt, align: (top, top),\n\
         \x20 [{}],\n\
         \x20 [#text(size: 19pt, weight: \"regular\", tracking: 0.02em)[Fragen an den Steuerberater]\n\
         \x20  #v(0.2em)#text(size: 9.5pt, fill: rgb(\"{LEISE}\"))[damit Prüferpaket (DSFinV-K) und Buchungsstapel (DATEV) vollständig laufen]])\n",
        zeichen(13.0)
    ));
    let firma = d.firma.trim();
    if !firma.is_empty() {
        q.push_str(&format!(
            "#v(0.5em)#text(size: 10.5pt)[Betrieb: #strong[{}]]\n",
            t(firma)
        ));
    }
    q.push_str(&format!(
        "#v(0.6em)#line(length: 100%, stroke: (paint: rgb(\"{FADEN}\"), thickness: 0.8pt, cap: \"round\"))\n#v(1.0em)\n"
    ));

    for a in &d.einleitung {
        q.push_str(&format!("#par(justify: true)[{}]\n#v(0.55em)\n", t(a)));
    }
    q.push_str("#v(0.6em)\n");

    // ── Die Abschnitte ──────────────────────────────────────────────────
    for ab in &d.abschnitte {
        q.push_str(&format!(
            "#v(0.7em)#text(size: 13pt)[#strong[{} {}]]\n#v(0.35em)\n",
            t(&ab.nummer),
            t(&ab.titel)
        ));
        let einl = ab.einleitung.trim();
        if !einl.is_empty() {
            q.push_str(&format!(
                "#text(size: 9.5pt, fill: rgb(\"{LEISE}\"))[{}]\n#v(0.7em)\n",
                t(einl)
            ));
        }
        for z in &ab.zeilen {
            q.push_str(&zeile_block(z));
        }
        for abs in &ab.absaetze {
            q.push_str(&format!(
                "#par(justify: true)[#text(size: 9.5pt)[{}]]\n#v(0.5em)\n",
                t(abs)
            ));
        }
        if ab.gegenzeichnung {
            q.push_str(&gegenzeichnung_block());
        }
    }

    // ── Der Schluss ─────────────────────────────────────────────────────
    q.push_str(&format!(
        "#v(1.0em)#line(length: 30%, stroke: (paint: rgb(\"{FADEN}\"), thickness: 0.8pt, cap: \"round\"))\n#v(0.6em)\n"
    ));
    for a in &d.schluss {
        q.push_str(&format!(
            "#par(justify: true)[#text(size: 9.5pt, fill: rgb(\"{LEISE}\"))[{}]]\n#v(0.4em)\n",
            t(a)
        ));
    }

    q
}

#[cfg(test)]
mod tests {
    use super::*;

    fn daten() -> SteuerberaterFragenDaten {
        SteuerberaterFragenDaten {
            erzeugt_am_text: "12.08.2026, 12:00 Uhr".into(),
            firma: "Muster Edelmetallhandel e. K.".into(),
            einleitung: vec!["Bitte füllen Sie die offenen Felder aus.".into()],
            abschnitte: vec![FrageAbschnitt {
                nummer: "A1.".into(),
                titel: "Die sechs Kopfangaben".into(),
                einleitung: "Ohne diese Werte entsteht keine DATEV-Datei.".into(),
                zeilen: vec![
                    FrageZeile {
                        etikett: "Beraternummer der Kanzlei".into(),
                        erklaerung: "4 bis 7 Ziffern".into(),
                        wert: None,
                    },
                    FrageZeile {
                        etikett: "Kontenrahmen".into(),
                        erklaerung: String::new(),
                        wert: Some("SKR03".into()),
                    },
                ],
                absaetze: vec![],
                gegenzeichnung: false,
            }],
            schluss: vec!["Jede Antwort wird einmal eingetragen.".into()],
        }
    }

    /// Eine offene Frage bekommt eine Schreiblinie, NIE einen erfundenen
    /// Wert; eine beantwortete zeigt den Wert samt Prüfhinweis.
    #[test]
    fn offene_frage_ist_eine_schreiblinie_und_kein_erfundener_wert() {
        let q = baue_fragen_quelle(&daten());
        assert!(q.contains("dash: \"dotted\""), "die Schreiblinie fehlt");
        assert!(q.contains("Beraternummer der Kanzlei"));
        assert!(
            q.contains("in der Kasse hinterlegt"),
            "der eingetragene Wert traegt keinen Pruefhinweis"
        );
        assert!(q.contains("SKR03"));
        // Der Klassiker aus Wanderung 0123: nichts erfindet eine Antwort.
        assert!(
            !q.contains("12345/67890"),
            "ein Musterwert ist in das Dokument gerutscht"
        );
    }

    /// Das Blatt trägt das Zeichen des Hauses und den Titel.
    #[test]
    fn kopf_traegt_zeichen_und_titel() {
        let q = baue_fragen_quelle(&daten());
        assert!(q.contains("Fragen an den Steuerberater"));
        assert!(
            q.contains(TINTE) && q.contains(FADEN),
            "die Hausfarben fehlen"
        );
        // 20.08.2026: das Zeichen sind zwei Tintenstämme und die weinrote
        // Schräge — und die ist seither ein VIELECK, nicht mehr ein runder
        // Strich über den Stämmen (Basels Anweisung; die Begründung steht
        // bei `zeichen()` in verfahrensdoku_pdf.rs).
        //
        // ⚠️ Der alte Satz hier verbot JEDES `#polygon`. Gemeint war die
        // Schräge in TINTE, die den Buchstaben wieder durchgestrichen
        // wirken liesse; getroffen hätte es die Schräge selbst. Der Satz
        // misst deshalb jetzt die Gefahr statt der Bauform.
        assert!(q.contains("#rect"), "die Stämme des Zeichens fehlen");
        assert!(
            q.matches("#polygon").count() == 1,
            "die Schräge des Zeichens fehlt, oder es sind zwei (dann wieder ein X)"
        );
        // ⚠️ NUR am Zeichen gemessen, nicht am ganzen Dokument: die
        // Zierlinien dieses Briefes tragen absichtlich runde Enden, und ein
        // Satz über das ganze Dokument hätte SIE getroffen statt der Marke.
        assert!(
            !crate::commands::verfahrensdoku_pdf::zeichen(22.0).contains("cap: \"round\""),
            "die runden Kappen des Zeichens sind seit dem 20.08. abgeschafft"
        );
    }

    /// Die Gegenzeichnung erscheint nur, wo sie verlangt ist.
    #[test]
    fn gegenzeichnung_nur_auf_verlangen() {
        let mut d = daten();
        assert!(!baue_fragen_quelle(&d).contains("Gegenzeichnung der Kanzlei"));
        if let Some(ab) = d.abschnitte.first_mut() {
            ab.gegenzeichnung = true;
        }
        assert!(baue_fragen_quelle(&d).contains("Gegenzeichnung der Kanzlei"));
    }

    /// Der Fuss war die einzige Stelle ohne t(): ein `]` im Zeitpunkt brach
    /// die Kompilierung, ein `#strong[...]` schleuste Markup ein (Befund der
    /// Gegenpruefung vom 12.08.2026, am echten Compiler gezeigt). Beide
    /// Angriffe muessen jetzt wirkungslos durchlaufen.
    #[test]
    fn feindseliger_zeitpunkt_bricht_nichts_und_schleust_nichts_ein() {
        let mut d = daten();
        d.erzeugt_am_text = "12.08.2026] #strong[EINGESCHLEUST]".into();
        let q = baue_fragen_quelle(&d);
        // Der Wert steht als Zeichenkette im Code-Kontext, nicht als Markup.
        assert!(
            !q.contains("Stand 12.08.2026]"),
            "der Zeitpunkt liegt roh im Markup"
        );
        let bytes = compile_typst_to_pdf(q).expect("die Kompilierung brach");
        assert!(bytes.starts_with(b"%PDF"));
    }

    /// Und es kompiliert wirklich zu einem PDF, nicht nur zu einer Quelle.
    #[test]
    fn quelle_setzt_sich_zu_einem_pdf() {
        let bytes = compile_typst_to_pdf(baue_fragen_quelle(&daten())).expect("setzt nicht");
        assert!(bytes.starts_with(b"%PDF"), "kein PDF-Kopf");
        assert!(bytes.len() > 1_000, "verdaechtig kleines PDF");
    }
}

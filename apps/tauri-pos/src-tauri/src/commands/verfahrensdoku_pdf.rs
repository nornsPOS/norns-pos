//! ════════════════════════════════════════════════════════════════════════
//!  Die Verfahrensdokumentation als PDF — netzfrei, mit dem Zeichen des Hauses
//! ════════════════════════════════════════════════════════════════════════
//!
//! Rz. 151 GoBD verlangt eine Verfahrensdokumentation, Rz. 154 verlangt, dass
//! sie dem TATSÄCHLICH eingesetzten Verfahren voll entspricht. Bis zum
//! 08.08.2026 lieferte die Kasse dem Prüfer eine ins Programm gebackene
//! Textdatei über ein fremdes Erzeugnis.
//!
//! Diese Datei setzt den Befund aus `lib/verfahrensdokumentation.ts` als
//! mehrseitiges PDF. Sie erfindet keinen einzigen Wert: was der Motor als
//! `fehlt` meldet, erscheint sichtbar als offene Angabe.
//!
//! ── ⚠️ KEIN NETZ ──────────────────────────────────────────────────────
//!
//! Typst setzt im eigenen Prozess, mit den Schriften aus `typst-assets`, ohne
//! Browser und ohne Fremdprogramm. Ein PDF-Dienst oder eine Schrift von einem
//! fremden Rechner machte die Kasse an dem Tag stumm, an dem der Prüfer im
//! Laden steht.
//!
//! ── ⚠️ DAS ZEICHEN WIRD NICHT NEU ERFUNDEN ────────────────────────────
//!
//! Die Geometrie unten ist Zeile für Zeile aus `icons/generate.py`
//! übernommen — dieselben Verhältnisse, dieselbe Palette (Tinte #262019,
//! Faden #9c2630). Als Vektor gesetzt statt als Bild eingebettet, damit es
//! auf dem Papier des Prüfers scharf bleibt. `zeichen_stimmt_mit_der_quelle`
//! hält beide Fassungen aneinander.

use serde::{Deserialize, Serialize};

use super::pdf::{compile_typst_to_pdf, esc};
use crate::error::{HardwareError, HwResult};

// ────────────────────────────────────────────────────────────────────────
// Die Palette des Hauses. Eine einzige Stelle.
// ────────────────────────────────────────────────────────────────────────

/// Tinte — die Schriftfarbe des Zeichens. `icons/generate.py`, TINTE.
pub(crate) const TINTE: &str = "#262019";
/// Faden — der eine Akzent. `icons/generate.py`, ROT.
pub(crate) const FADEN: &str = "#9c2630";
/// Ein zurückgenommenes Grau für Beschriftungen und Fundstellen.
pub(crate) const LEISE: &str = "#6b6157";

// ────────────────────────────────────────────────────────────────────────
// Der Befund, wie ihn der Motor liefert
// ────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VdAngabe {
    pub etikett: String,
    pub wert: String,
    pub fehlt: bool,
    /// `erzeugnis` | `gemessen` | `haendler`
    pub herkunft: String,
    #[serde(default)]
    pub wo: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VdTabelle {
    pub kopf: Vec<String>,
    pub zeilen: Vec<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VdAbschnitt {
    pub nummer: String,
    pub titel: String,
    #[serde(default)]
    pub fundstelle: Option<String>,
    pub absaetze: Vec<String>,
    #[serde(default)]
    pub angaben: Option<Vec<VdAngabe>>,
    #[serde(default)]
    pub tabelle: Option<VdTabelle>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VdOffen {
    pub etikett: String,
    pub wo: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerfahrensdokuDaten {
    /// Der Erzeugungszeitpunkt, schon in deutscher Schreibweise.
    pub erzeugt_am_text: String,
    pub fassung: String,
    pub erzeugnis: String,
    /// Die Firma des Steuerpflichtigen. Leer heisst leer — nie ersetzt.
    pub firma: String,
    pub abschnitte: Vec<VdAbschnitt>,
    pub offene_angaben: Vec<VdOffen>,
    pub vollstaendig: bool,
}

// ────────────────────────────────────────────────────────────────────────
// Der Befehl
// ────────────────────────────────────────────────────────────────────────

/// Den Befund als PDF setzen. Reine Rechenarbeit, deshalb auf dem
/// blockierenden Vorrat — sonst hungert die Fensterschleife.
#[tauri::command]
pub async fn generate_verfahrensdoku_pdf(daten: VerfahrensdokuDaten) -> HwResult<Vec<u8>> {
    tauri::async_runtime::spawn_blocking(move || {
        compile_typst_to_pdf(baue_verfahrensdoku_quelle(&daten)).map_err(|meldung| {
            HardwareError::Encoding(format!(
                "Die Verfahrensdokumentation konnte nicht gesetzt werden: {meldung}"
            ))
        })
    })
    .await
    .map_err(|e| HardwareError::Internal(format!("Der Setzvorgang wurde abgebrochen: {e}")))?
}

// ────────────────────────────────────────────────────────────────────────
// Das Zeichen, als Vektor
// ────────────────────────────────────────────────────────────────────────

/// Das N mit dem Faden, in der Geometrie aus `icons/generate.py`.
///
/// `kante` ist die Kantenlänge des gedachten Quadrats in Millimetern; alle
/// Masse darin sind Verhältnisse, genau wie in der Quelle.
pub(crate) fn zeichen(kante_mm: f64) -> String {
    let c = kante_mm;
    let s = 0.60 * c;
    let w = 0.78 * s;
    let d = 0.16 * s;
    let (l, r) = (c / 2.0 - w / 2.0, c / 2.0 + w / 2.0);
    let (t, b) = (c / 2.0 - s / 2.0, c / 2.0 + s / 2.0);

    // Der Faden, an beiden Enden um seine halbe Dicke eingerückt, damit die
    // runde Kappe innerhalb der Balken sitzt — wie die Ellipsen in der Quelle.
    let dicke = 0.075 * s;
    let kappe = dicke / 2.0;
    let (dx, dy) = (r - l, t - b);
    let lang = (dx * dx + dy * dy).sqrt();
    let (ex, ey) = (dx / lang, dy / lang);
    let (x1, y1) = (l + ex * kappe, b + ey * kappe);
    let (x2, y2) = (r - ex * kappe, t - ey * kappe);

    format!(
        "#box(width: {c:.3}mm, height: {c:.3}mm)[\n\
         #place(dx: {l:.3}mm, dy: {t:.3}mm)[#rect(width: {d:.3}mm, height: {s:.3}mm, fill: rgb(\"{TINTE}\"), stroke: none)]\n\
         #place(dx: {rd:.3}mm, dy: {t:.3}mm)[#rect(width: {d:.3}mm, height: {s:.3}mm, fill: rgb(\"{TINTE}\"), stroke: none)]\n\
         #place(dx: 0mm, dy: 0mm)[#polygon(fill: rgb(\"{TINTE}\"), stroke: none, ({l:.3}mm, {t:.3}mm), ({ld:.3}mm, {t:.3}mm), ({r:.3}mm, {b:.3}mm), ({rr:.3}mm, {b:.3}mm))]\n\
         #place(dx: 0mm, dy: 0mm)[#line(start: ({x1:.3}mm, {y1:.3}mm), end: ({x2:.3}mm, {y2:.3}mm), stroke: (paint: rgb(\"{FADEN}\"), thickness: {dicke:.3}mm, cap: \"round\"))]\n\
         ]",
        rd = r - d,
        ld = l + d * 1.35,
        rr = r - d * 1.35,
    )
}

// ────────────────────────────────────────────────────────────────────────
// Die Quelle des Dokuments
// ────────────────────────────────────────────────────────────────────────

/// Ein Wert als Typst-Zeichenkette in Textstellung.
fn t(s: &str) -> String {
    format!("#\"{}\"", esc(s))
}

/// Ein Absatz. Der Text wird als Zeichenkette gesetzt, damit ein `#` oder
/// ein `*` im Inhalt nicht als Auszeichnung gelesen wird.
fn absatz(s: &str) -> String {
    format!("#par(justify: true)[{}]\n#v(0.55em)\n", t(s))
}

/// Die Angaben eines Abschnitts als zweispaltiges Verzeichnis.
///
/// ⚠️ Eine fehlende Angabe wird NICHT als leerer Kasten gesetzt, den man
/// überliest. Sie steht sichtbar in der Farbe des Fadens da, mit dem Weg zur
/// Pflege daneben. Wanderung 0123 musste eine erfundene USt-IdNr. wieder
/// ausbauen, die auf Produktion gedruckt hatte.
fn angaben_block(angaben: &[VdAngabe]) -> String {
    if angaben.is_empty() {
        return String::new();
    }
    let mut zeilen = String::new();
    for a in angaben {
        let wert = if a.fehlt {
            match a.wo.as_deref().map(str::trim) {
                Some(wo) if !wo.is_empty() => format!(
                    "[#text(fill: rgb(\"{FADEN}\"))[offen] #text(size: 8.5pt, fill: rgb(\"{LEISE}\"))[— einzutragen unter {}]]",
                    t(wo)
                ),
                _ => format!("[#text(fill: rgb(\"{FADEN}\"))[offen]]"),
            }
        } else {
            format!("[{}]", t(&a.wert))
        };
        zeilen.push_str(&format!(
            "  [#text(fill: rgb(\"{LEISE}\"))[{}]], {},\n",
            t(&a.etikett),
            wert
        ));
    }
    format!(
        "#v(0.2em)\n\
         #table(\n\
         \x20 columns: (36%, 1fr),\n\
         \x20 stroke: none,\n\
         \x20 inset: (x: 0pt, y: 4pt),\n\
         \x20 align: (left + top, left + top),\n\
         {zeilen})\n\
         #v(0.7em)\n"
    )
}

/// Eine gemessene Tabelle. Zahlen in der Monospace-Schrift, damit sie
/// untereinander stehen.
fn tabellen_block(tab: &VdTabelle) -> String {
    let spalten = tab.kopf.len().max(1);
    let mut inhalt = String::new();
    for k in &tab.kopf {
        inhalt.push_str(&format!("  table.cell[#strong[{}]],\n", t(k)));
    }
    for zeile in &tab.zeilen {
        for (i, z) in zeile.iter().enumerate() {
            if i + 1 == spalten {
                inhalt.push_str(&format!(
                    "  [#text(font: \"DejaVu Sans Mono\", size: 9pt)[{}]],\n",
                    t(z)
                ));
            } else {
                inhalt.push_str(&format!("  [{}],\n", t(z)));
            }
        }
    }
    let ausrichtung = if spalten >= 2 {
        "(left, right)"
    } else {
        "(left,)"
    };
    format!(
        "#v(0.2em)\n\
         #table(\n\
         \x20 columns: {spalten},\n\
         \x20 align: {ausrichtung},\n\
         \x20 stroke: (x, y) => if y == 0 {{ (bottom: 0.6pt + rgb(\"{TINTE}\")) }} else {{ (bottom: 0.3pt + rgb(\"#e0dad0\")) }},\n\
         \x20 inset: (x: 6pt, y: 6pt),\n\
         {inhalt})\n\
         #v(0.7em)\n"
    )
}

/// Der vollständige Typst-Quelltext des Dokuments.
pub fn baue_verfahrensdoku_quelle(d: &VerfahrensdokuDaten) -> String {
    let mut q = String::new();

    // ── Satzspiegel und Grundschrift ────────────────────────────────────
    q.push_str(&format!(
        "#set text(font: \"Libertinus Serif\", size: 10.5pt, lang: \"de\", fill: rgb(\"{TINTE}\"))\n\
         #set par(leading: 0.72em)\n\
         #set page(paper: \"a4\", margin: (top: 2.4cm, bottom: 2.2cm, left: 2.4cm, right: 2.2cm))\n"
    ));

    // ── Das Deckblatt ───────────────────────────────────────────────────
    // Eigene Seite ohne Kopf- und Fusszeile.
    q.push_str("#page(header: none, footer: none)[\n");
    q.push_str("#v(3.2cm)\n");
    q.push_str(&format!("#align(center)[{}]\n", zeichen(22.0)));
    q.push_str("#v(1.1cm)\n");
    q.push_str(&format!(
        "#align(center)[#text(size: 26pt, weight: \"regular\", tracking: 0.02em)[Verfahrensdokumentation]]\n"
    ));
    q.push_str("#v(0.5em)\n");
    q.push_str(&format!(
        "#align(center)[#text(size: 10.5pt, fill: rgb(\"{LEISE}\"))[nach Rz. 151 GoBD (BMF-Schreiben vom 28.11.2019)]]\n"
    ));
    q.push_str("#v(1.4cm)\n");
    // Der Faden als feine Trennlinie — der eine Akzent der Seite.
    q.push_str(&format!(
        "#align(center)[#line(length: 28%, stroke: (paint: rgb(\"{FADEN}\"), thickness: 0.8pt, cap: \"round\"))]\n"
    ));
    q.push_str("#v(1.4cm)\n");

    // Der Steuerpflichtige. Fehlt die Firma, steht das sichtbar da.
    let firma = d.firma.trim();
    if firma.is_empty() {
        q.push_str(&format!(
            "#align(center)[#text(size: 13pt, fill: rgb(\"{FADEN}\"))[Firma des Steuerpflichtigen: offen]]\n\
             #v(0.35em)\n\
             #align(center)[#text(size: 9pt, fill: rgb(\"{LEISE}\"))[einzutragen unter Einstellungen und dann Betrieb]]\n"
        ));
    } else {
        q.push_str(&format!(
            "#align(center)[#text(size: 15pt)[{}]]\n",
            t(firma)
        ));
    }

    q.push_str("#v(2.0cm)\n");
    q.push_str(&format!(
        "#align(center)[#table(\n\
         \x20 columns: 2,\n stroke: none,\n inset: (x: 10pt, y: 5pt),\n\
         \x20 align: (right, left),\n\
         \x20 [#text(fill: rgb(\"{LEISE}\"))[Verfahren]], [{erzeugnis}],\n\
         \x20 [#text(fill: rgb(\"{LEISE}\"))[Fassung]], [{fassung}],\n\
         \x20 [#text(fill: rgb(\"{LEISE}\"))[Erzeugt am]], [{stand}],\n\
         )]\n",
        erzeugnis = t(&d.erzeugnis),
        fassung = if d.fassung.trim().is_empty() {
            format!("#text(fill: rgb(\"{FADEN}\"))[offen]")
        } else {
            t(&d.fassung)
        },
        stand = t(&d.erzeugt_am_text),
    ));

    // Die ehrliche Zeile am Fuss des Deckblatts.
    q.push_str("#v(1fr)\n");
    if d.vollstaendig {
        q.push_str(&format!(
            "#align(center)[#text(size: 9pt, fill: rgb(\"{LEISE}\"))[Dieses Dokument wurde beim Abruf aus der laufenden Anlage erzeugt. Alle Angaben sind gepflegt.]]\n"
        ));
    } else {
        // ⚠️ Einzahl und Mehrzahl. „1 Angaben sind noch offen" auf dem
        // Deckblatt einer Urkunde ist ein Schnitzer, den ein Prüfer sieht,
        // bevor er den ersten Abschnitt liest.
        let satz = if d.offene_angaben.len() == 1 {
            "Eine Angabe ist noch offen. Sie ist im Dokument als offen gekennzeichnet und in Abschnitt 13 aufgeführt.".to_string()
        } else {
            format!(
                "{} Angaben sind noch offen. Sie sind im Dokument als offen gekennzeichnet und in Abschnitt 13 einzeln aufgeführt.",
                d.offene_angaben.len()
            )
        };
        q.push_str(&format!(
            "#align(center)[#text(size: 9pt, fill: rgb(\"{FADEN}\"))[{}]]\n",
            t(&satz)
        ));
    }
    q.push_str("]\n");

    // ── Ab hier laufender Kopf und Seitenzahl ───────────────────────────
    let kopf_firma = if firma.is_empty() {
        String::new()
    } else {
        format!(" #sym.dot.c {}", t(firma))
    };
    q.push_str(&format!(
        "#set page(\n\
         \x20 header: context {{ if counter(page).get().first() > 1 [\n\
         \x20   #text(size: 8pt, fill: rgb(\"{LEISE}\"))[Verfahrensdokumentation{kopf_firma} #h(1fr) Stand {stand}]\n\
         \x20   #line(length: 100%, stroke: 0.4pt + rgb(\"#ddd6cc\"))\n\
         \x20 ] }},\n\
         \x20 footer: context [#align(center)[#text(size: 8.5pt, fill: rgb(\"{LEISE}\"))[#counter(page).display()]]],\n\
         )\n",
        stand = t(&d.erzeugt_am_text),
    ));

    // ── Inhaltsverzeichnis ──────────────────────────────────────────────
    q.push_str(&format!(
        "#heading(level: 1, outlined: false, numbering: none)[Inhalt]\n\
         #v(0.4em)\n\
         #outline(title: none, depth: 2, indent: 1.2em)\n\
         #pagebreak()\n"
    ));

    // ── Überschriftenform ───────────────────────────────────────────────
    q.push_str(&format!(
        "#show heading.where(level: 1): it => block(above: 1.5em, below: 0.35em)[\n\
         \x20 #text(size: 14pt, weight: \"regular\")[#it.body]\n\
         \x20 #v(0.25em)\n\
         \x20 #line(length: 100%, stroke: 0.6pt + rgb(\"{TINTE}\"))\n]\n"
    ));

    // ── Die Abschnitte ──────────────────────────────────────────────────
    for a in &d.abschnitte {
        q.push_str(&format!(
            "#heading(level: 1)[{nummer}#h(0.7em){titel}]\n",
            nummer = t(&a.nummer),
            titel = t(&a.titel),
        ));
        if let Some(f) = a.fundstelle.as_deref().map(str::trim) {
            if !f.is_empty() {
                q.push_str(&format!(
                    "#text(size: 8.5pt, fill: rgb(\"{LEISE}\"))[{}]\n#v(0.6em)\n",
                    t(f)
                ));
            }
        }
        for p in &a.absaetze {
            q.push_str(&absatz(p));
        }
        if let Some(g) = a.angaben.as_ref() {
            q.push_str(&angaben_block(g));
        }
        if let Some(tab) = a.tabelle.as_ref() {
            q.push_str(&tabellen_block(tab));
        }
    }

    // ── Abschnitt 13: die offenen Angaben, gesammelt ────────────────────
    q.push_str("#heading(level: 1)[13#h(0.7em)Offene Angaben]\n");
    if d.offene_angaben.is_empty() {
        q.push_str(&absatz(
            "Zum Zeitpunkt der Erzeugung dieses Dokuments war keine Angabe offen.",
        ));
    } else {
        q.push_str(&absatz(
            "Die folgenden Angaben liegen der Kasse nicht vor. Sie werden nicht geschätzt und nicht aus anderen Feldern abgeleitet; das Dokument weist sie stattdessen offen aus. Der Steuerpflichtige trägt sie an der jeweils genannten Stelle nach und ruft das Dokument danach erneut ab.",
        ));
        let mut zeilen = String::new();
        for o in &d.offene_angaben {
            zeilen.push_str(&format!(
                "  [{}], [#text(fill: rgb(\"{LEISE}\"))[{}]],\n",
                t(&o.etikett),
                t(&o.wo)
            ));
        }
        q.push_str(&format!(
            "#v(0.2em)\n#table(\n\
             \x20 columns: (1fr, auto),\n\
             \x20 align: (left, left),\n\
             \x20 stroke: (x, y) => if y == 0 {{ (bottom: 0.6pt + rgb(\"{TINTE}\")) }} else {{ (bottom: 0.3pt + rgb(\"#e0dad0\")) }},\n\
             \x20 inset: (x: 6pt, y: 6pt),\n\
             \x20 table.cell[#strong[Angabe]], table.cell[#strong[Einzutragen unter]],\n\
             {zeilen})\n"
        ));
    }

    // ── Schlussvermerk ──────────────────────────────────────────────────
    q.push_str("#v(1.4em)\n");
    q.push_str(&format!(
        "#line(length: 100%, stroke: (paint: rgb(\"{FADEN}\"), thickness: 0.8pt))\n#v(0.7em)\n"
    ));
    q.push_str(&format!(
        "#text(size: 9pt, fill: rgb(\"{LEISE}\"))[{}]\n",
        t(&format!(
            "Dieses Dokument wurde am {} von {} in der Fassung {} aus der laufenden Anlage erzeugt. Es beschreibt den Stand zu diesem Zeitpunkt und wird nicht gepflegt, sondern bei jedem Abruf neu erstellt.",
            d.erzeugt_am_text.trim(),
            d.erzeugnis.trim(),
            if d.fassung.trim().is_empty() { "ohne Angabe" } else { d.fassung.trim() },
        ))
    ));

    q
}

// ────────────────────────────────────────────────────────────────────────
// Wächter
// ────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Ein Befund ohne jeden Händlerwert — genau der Fall, in dem eine ins
    /// Programm getippte Vorgabe sichtbar würde.
    fn leerer_befund() -> VerfahrensdokuDaten {
        VerfahrensdokuDaten {
            erzeugt_am_text: "08.08.2026, 14:00 Uhr".into(),
            fassung: "0.1.0".into(),
            erzeugnis: "Norns POS".into(),
            firma: String::new(),
            abschnitte: vec![VdAbschnitt {
                nummer: "1".into(),
                titel: "Der Steuerpflichtige".into(),
                fundstelle: Some("Rz. 151 GoBD".into()),
                absaetze: vec!["Ein Absatz.".into()],
                angaben: Some(vec![VdAngabe {
                    etikett: "Firma".into(),
                    wert: String::new(),
                    fehlt: true,
                    herkunft: "haendler".into(),
                    wo: Some("Einstellungen und dann Betrieb".into()),
                }]),
                tabelle: None,
            }],
            offene_angaben: vec![VdOffen {
                etikett: "Firma".into(),
                wo: "Einstellungen und dann Betrieb".into(),
            }],
            vollstaendig: false,
        }
    }

    /// ⚠️ DER WÄCHTER GEGEN DEN FREMDEN NAMEN.
    ///
    /// Die abgelöste Textdatei nannte elfmal „warehouse14", trug die Anschrift
    /// eines einzelnen Händlers und eine erfundene USt-IdNr. Gemessen wird der
    /// Quelltext bei LEEREM Befund: taucht dort ein Händlerwert auf, ist er
    /// eingetippt und nicht gelesen.
    #[test]
    fn keine_eingetippte_haendleridentitaet() {
        let q = baue_verfahrensdoku_quelle(&leerer_befund());
        for verboten in [
            "warehouse",
            "Warehouse",
            "WAREHOUSE",
            "Rosenstr",
            "Grützner",
            "Gruetzner",
            "DE123456789",
            "Schorndorf",
        ] {
            assert!(
                !q.contains(verboten),
                "die Quelle traegt einen eingetippten Haendlerwert: {verboten}"
            );
        }
    }

    /// Eine fehlende Angabe muss im Dokument SICHTBAR sein. Ein leerer Kasten
    /// wird überlesen; das war der Kern des Befunds.
    #[test]
    fn eine_fehlende_angabe_steht_sichtbar_da() {
        let q = baue_verfahrensdoku_quelle(&leerer_befund());
        assert!(q.contains("[offen]"), "die offene Angabe erscheint nicht");
        assert!(
            q.contains(FADEN),
            "die offene Angabe traegt nicht die Farbe des Fadens"
        );
        assert!(
            q.contains("Firma des Steuerpflichtigen: offen"),
            "das Deckblatt verschweigt die fehlende Firma"
        );
    }

    /// Und der Satz läuft wirklich durch — ein Dokument, das nicht setzt, ist
    /// dem Prüfer gegenüber dasselbe wie gar keins.
    #[test]
    fn der_satz_laeuft_durch_und_ergibt_ein_pdf() {
        let bytes = compile_typst_to_pdf(baue_verfahrensdoku_quelle(&leerer_befund()))
            .expect("die Verfahrensdokumentation setzt nicht");
        assert!(bytes.starts_with(b"%PDF"), "das Ergebnis ist kein PDF");
        assert!(bytes.len() > 2000, "das PDF ist verdaechtig klein");
    }

    /// Ein PDF zum Ansehen. Läuft nur auf Zuruf:
    ///
    ///     NORNS_VD_PROBE=/pfad/probe.pdf cargo test -- --ignored vd_probe
    ///
    /// Kein Teil des Laufs — ein Test, der Dateien ablegt, hat im normalen
    /// Lauf nichts zu suchen.
    #[test]
    #[ignore]
    fn vd_probe() {
        let ziel = std::env::var("NORNS_VD_PROBE").expect("NORNS_VD_PROBE fehlt");
        let mut d = leerer_befund();
        d.firma = "Muster Edelmetallhandel e. K.".into();
        d.abschnitte[0].angaben = Some(vec![
            VdAngabe {
                etikett: "Firma".into(),
                wert: "Muster Edelmetallhandel e. K.".into(),
                fehlt: false,
                herkunft: "haendler".into(),
                wo: Some("Einstellungen und dann Betrieb".into()),
            },
            VdAngabe {
                etikett: "Steuernummer".into(),
                wert: String::new(),
                fehlt: true,
                herkunft: "haendler".into(),
                wo: Some("Einstellungen und dann Betrieb".into()),
            },
        ]);
        d.abschnitte[0].absaetze.push(
            "Die Verantwortung für die Ordnungsmässigkeit der Aufzeichnungen bleibt nach Rz. 21 GoBD beim Steuerpflichtigen, auch soweit er Aufgaben auf Dritte überträgt. § 146a AO und § 25a UStG werden im Text genannt.".into(),
        );
        d.abschnitte.push(VdAbschnitt {
            nummer: "2.1".into(),
            titel: "Technische Systembeschreibung".into(),
            fundstelle: Some("Rz. 152 GoBD".into()),
            absaetze: vec!["Aus dem Katalog der laufenden Datenbank gelesen.".into()],
            angaben: None,
            tabelle: Some(VdTabelle {
                kopf: vec!["Merkmal der laufenden Anlage".into(), "Anzahl".into()],
                zeilen: vec![
                    vec!["Tabellen".into(), "87".into()],
                    vec!["Auslöser (Trigger)".into(), "73".into()],
                    vec!["Prüfbedingungen (CHECK)".into(), "303".into()],
                ],
            }),
        });
        let bytes = compile_typst_to_pdf(baue_verfahrensdoku_quelle(&d)).expect("setzt nicht");
        std::fs::write(&ziel, bytes).expect("schreibt nicht");
    }

    /// ⚠️ Das Zeichen stimmt mit `icons/generate.py` überein.
    ///
    /// Ohne diesen Griff driftet die eine Fassung von der anderen weg und das
    /// Haus trägt zwei verschiedene Zeichen. Gemessen werden die Verhältnisse
    /// UND die Palette, direkt aus der Quelldatei.
    #[test]
    fn zeichen_stimmt_mit_der_quelle() {
        let quelle = include_str!("../../icons/generate.py");
        for wert in ["0.60 * c", "0.78 * s", "0.16 * s", "1.35", "0.075 * s"] {
            assert!(
                quelle.contains(wert),
                "die Geometrie in generate.py hat sich geaendert: {wert} fehlt dort"
            );
        }
        assert!(
            quelle.contains("0x26, 0x20, 0x19"),
            "TINTE hat sich geaendert"
        );
        assert!(
            quelle.to_lowercase().contains("9c2630"),
            "der Faden hat sich geaendert"
        );
        // Und die Zeichnung selbst benutzt beide Farben.
        let z = zeichen(22.0);
        assert!(z.contains(TINTE) && z.contains(FADEN));
    }
}

#[cfg(test)]
mod zeichenprobe {
    use super::*;
    /// Nur das Zeichen, gross, zum Vergleich mit `icons/128x128@2x.png`.
    #[test]
    #[ignore]
    fn vd_zeichen_probe() {
        let ziel = std::env::var("NORNS_VD_ZEICHEN").expect("NORNS_VD_ZEICHEN fehlt");
        let q = format!(
            "#set page(width: 60mm, height: 60mm, margin: 5mm, fill: rgb(\"#faf6ee\"))\n#align(center + horizon)[{}]",
            zeichen(50.0)
        );
        std::fs::write(&ziel, compile_typst_to_pdf(q).expect("setzt nicht"))
            .expect("schreibt nicht");
    }
}

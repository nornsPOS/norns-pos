//! Mandate 3-B — A4 invoice PDF via the native **Typst** compiler.
//!
//! Typst is a Rust-native typesetting engine: it compiles a document template
//! to PDF entirely in-process (no Puppeteer, no headless Chrome, no external
//! binary). We embed a small `World` (the trait Typst uses to resolve sources +
//! fonts), bundle the default fonts from `typst-assets`, build the invoice
//! source from `InvoiceData`, compile it, and export PDF bytes via `typst-pdf`.
//!
//! `print_a4` / `open_pdf_preview` are unchanged — they take raw PDF bytes and
//! are agnostic to how the bytes were produced.

use std::sync::OnceLock;

use comemo::Prehashed;
use serde::{Deserialize, Serialize};
use typst::diag::{FileError, FileResult};
use typst::eval::Tracer;
use typst::foundations::{Bytes, Datetime, Smart};
use typst::syntax::{FileId, Source, VirtualPath};
use typst::text::{Font, FontBook};
use typst::{Library, World};

use crate::config;
use crate::error::{HardwareError, HwResult};
use crate::mock::printer_mock;

// ────────────────────────────────────────────────────────────────────────
// Wire-format structs — TypeScript mirror lives in `hooks/useInvoicePdf.ts`.
// ────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceItem {
    pub description: String,
    pub quantity: u32,
    pub unit_price_eur: String,
    /// VAT rate as printed, e.g. "19" / "7" / "" for §25a/§25c margin schemes.
    pub vat_rate: String,
    pub total_eur: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceData {
    pub invoice_number: String,
    pub date: String,
    pub seller_name: String,
    pub items: Vec<InvoiceItem>,
    pub subtotal_eur: String,
    /// ⚠️ NICHT DRUCKEN. Die Steuer der GANZEN Rechnung, einschliesslich der
    /// Margensteuer nach § 25a, die nicht gesondert ausgewiesen werden darf
    /// (§ 14a Abs. 6 Satz 2 UStG). Bleibt fuer die interne Aufzeichnung.
    pub vat_total_eur: String,
    /// Der Betrag, der als „MwSt. gesamt" auf die Rechnung DARF. `None`
    /// heisst: gar keine Steuerzeile.
    ///
    /// Bei der A4-Rechnung wiegt das schwerer als beim Kassenbon, denn sie
    /// traegt eine Rechnungsnummer und ist damit die Urkunde, mit der ein
    /// Kaeufer Vorsteuer zoege.
    #[serde(default)]
    pub vat_disclosable_eur: Option<String>,
    /// Die nach § 14a Abs. 6 Satz 1 UStG vorgeschriebenen Hinweise.
    #[serde(default)]
    pub special_scheme_notices: Vec<String>,
    pub total_eur: String,
    /// Legal tax note (§25a / §25c / §13b), printed if present.
    pub tax_note: Option<String>,

    /// Der Name des Ladens im Rechnungskopf (Basels Dekret, 26.07.2026).
    /// Bis zu diesem Tag stand hier fest verdrahtet „WAREHOUSE 14" in der
    /// Vorlage — derselbe Fehler wie das eingebrannte Bon-Logo, nur als
    /// Text. Der Name ist MANDANTENDATEN; fehlt er, bleibt der Kopf leer
    /// statt fremd.
    #[serde(default)]
    pub shop_name: Option<String>,
    /// § 14 Abs. 4 Nr. 1 UStG: die vollstaendige Anschrift des Leistenden.
    /// Bis zum 19.08.2026 kam sie NIE an — die Bon-Nutzlast trug sie laengst,
    /// der Abbilder warf sie weg, und die Rechnung war oberhalb der
    /// Kleinbetragsgrenze (250 Euro, § 33 UStDV) formal mangelhaft.
    #[serde(default)]
    pub seller_address_lines: Vec<String>,
    /// § 14 Abs. 4 Nr. 2 UStG: Steuernummer ODER USt-IdNr., fertig
    /// beschriftet (die Kasse weiss, welche von beiden sie hat).
    #[serde(default)]
    pub seller_tax_line: Option<String>,
    #[serde(default)]
    pub seller_phone: Option<String>,
    /// § 14 Abs. 4 Nr. 1 UStG, zweite Haelfte: der LEISTUNGSEMPFAENGER.
    /// Oberhalb der Kleinbetragsgrenze (250 Euro, § 33 UStDV) ist er
    /// Pflicht. Leer heisst: Kleinbetragsrechnung oder der Kaeufer wollte
    /// nicht genannt werden — die Anschriftzone bleibt dann frei. Die
    /// Erfassung an der Kasse (Kundenwahl beim A4-Druck) ist der naechste
    /// Schritt; dieses Feld ist der fertige Traeger dafuer.
    #[serde(default)]
    pub recipient_lines: Vec<String>,
    /// Das Logo des Haendlers — dasselbe wie auf dem Bon, hier als
    /// eingebettetes Bild im Typst-Dokument (Typst versteht PNG, JPEG und
    /// SVG nativ).
    #[serde(default)]
    pub logo_bytes_base64: Option<String>,
    /// "svg" | "png" | "jpeg".
    #[serde(default)]
    pub logo_format: Option<String>,
    /// "klein" | "mittel" | "gross" — feste Breiten (30/45/60 mm), dieselbe
    /// Dreiteilung wie auf dem Bon.
    #[serde(default)]
    pub logo_size: Option<String>,
}

/// Das Logo als virtuelle Datei fuer die Typst-Welt: (Dateiname, Bytes).
/// `None`, wenn keines mitkommt, das Format unbekannt ist oder das base64
/// nicht traegt — ein kaputtes Logo darf die Rechnung NIEMALS verhindern,
/// also verlangt die Quelle dann auch kein Bild.
fn logo_datei(data: &InvoiceData) -> Option<(String, Vec<u8>)> {
    use base64::Engine as _;
    let b64 = data.logo_bytes_base64.as_deref()?.trim();
    if b64.is_empty() {
        return None;
    }
    let format = data
        .logo_format
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let name = match format.as_str() {
        "svg" => "logo.svg",
        "png" => "logo.png",
        "jpg" | "jpeg" => "logo.jpg",
        _ => return None,
    };
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
    Some((name.to_string(), bytes))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintA4Params {
    /// macOS / Linux print queue name (from `lpstat -p`).
    pub printer_name: String,
    /// Raw PDF bytes — typically the output of `generate_invoice_pdf`.
    pub pdf_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfPreviewResult {
    /// Where on disk we saved the PDF before opening it.
    pub temp_path: String,
}

// ────────────────────────────────────────────────────────────────────────
// Commands
// ────────────────────────────────────────────────────────────────────────

/// Render an `InvoiceData` to PDF bytes via Typst. Pure CPU work — runs on the
/// blocking pool so we never starve the Tauri event loop.
///
/// Returns the shared `HardwareError` union (not a bare `String`) so a render
/// failure flows through `describeHardwareError` on the JS side and gets a clean
/// German message instead of a raw Typst diagnostic. `compile_typst_to_pdf` keeps
/// its `String` error (its unit tests depend on it); we adapt at this boundary.
#[tauri::command]
pub async fn generate_invoice_pdf(data: InvoiceData) -> HwResult<Vec<u8>> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = build_invoice_source(&data);
        // Das Logo geht als virtuelle Datei mit — dieselben Bytes, die der
        // Quellen-Bauer per `#image(...)` verlangt hat. Ist es nicht lesbar,
        // verlangt die Quelle auch keines (logo_datei entscheidet BEIDES).
        let dateien = logo_datei(&data).map(|d| vec![d]).unwrap_or_default();
        compile_typst_to_pdf_mit_dateien(source, dateien)
    })
    .await
    .map_err(|e| HardwareError::Internal(format!("invoice render task join failed: {e}")))?
    .map_err(HardwareError::Encoding)
}

/// Die Rechnung an den Drucker geben.
///
/// ⚠️ 02.08.2026: die Zeile darüber lautete „(macOS / Linux `lpr`)" — die
/// Einschränkung stand also im Kommentar, aber nirgends im Code. Auf Windows
/// scheiterte der Aufruf daran, dass es `lpr` nicht GIBT, und der Händler las
/// „bitte Speicherplatz prüfen". Keine Rechnung, und als Auskunft ein Hinweis
/// auf seine Festplatte.
///
/// Windows kann eine fertige Seite nicht roh an die Warteschlange geben: der
/// Spooler würde die PDF-Bytes unverändert weiterreichen, und aus dem Drucker
/// käme Quelltext. Deshalb der Weg über den Betrachter des Systems — ein Weg,
/// der WIRKLICH zum Papier führt, und ein Satz, der ihn nennt.
#[tauri::command]
pub async fn print_a4(params: PrintA4Params) -> HwResult<()> {
    if config::is_mock_mode() {
        return printer_mock::print_a4(params).await;
    }
    /*
     * ⚠️ 18.08.2026: hier stand fuer Windows eine glatte Absage mit dem Satz
     * SEITE_IM_BETRACHTER — kein Weg zum Papier. Fuer FERTIGE PDF-Bytes von
     * aussen bleibt das so (Windows bringt keinen PDF-Rasterer mit). Die
     * EIGENEN Rechnungen gehen seit heute ueber `print_invoice_a4` unten:
     * derselbe Typst-Setzer, als Pixel gerastert, ueber GDI durch den
     * Herstellertreiber. Direkt, ohne Betrachter.
     */
    if cfg!(windows) {
        return Err(HardwareError::NotConfigured(
            crate::commands::druckweg::SEITE_IM_BETRACHTER.to_string(),
        ));
    }
    crate::commands::warteschlangenlage::vor_dem_senden_pruefen(&params.printer_name).await?;

    let tmp = std::env::temp_dir().join(format!("norns-rechnung-{}.pdf", uuid_like()));
    std::fs::write(&tmp, &params.pdf_bytes).map_err(HardwareError::from)?;

    let status = tokio::process::Command::new("lpr")
        .arg("-P")
        .arg(&params.printer_name)
        .arg(&tmp)
        .status()
        .await
        .map_err(HardwareError::from)?;

    let _ = std::fs::remove_file(&tmp);

    if !status.success() {
        return Err(HardwareError::Device(format!(
            "lpr exited with {:?}",
            status.code()
        )));
    }
    Ok(())
}

/// Die A4-Rechnung DIREKT drucken: ein Aufruf von der Flaeche, ein Papier.
///
/// ── WARUM EIN EIGENER BEFEHL statt generate + print_a4 ────────────────────
///
/// `print_a4` nimmt fertige PDF-Bytes und kann sie auf Windows nicht drucken
/// (kein PDF-Rasterer im System). DIESER Befehl bekommt die Rechnungsdaten
/// selbst und haelt damit beide Ausgaenge in einer Hand:
///
///   • macOS/Linux: Typst → PDF → `lpr` an die Warteschlange (bewaehrt).
///   • Windows:     Typst → typst-render → Pixel in Treiber-DPI → GDI ueber
///                  den Herstellertreiber (win_print::print_raster_seiten).
///
/// Ein Setzer, eine Quelle, zwei Transportwege — die Rechnung sieht auf
/// beiden Systemen gleich aus, weil sie DASSELBE Dokument ist.
#[tauri::command]
pub async fn print_invoice_a4(data: InvoiceData, printer_name: String) -> HwResult<()> {
    if config::is_mock_mode() {
        // Im Testbetrieb denselben Zaehler fuettern wie print_a4.
        let pdf = generate_invoice_pdf(data).await?;
        return printer_mock::print_a4(PrintA4Params {
            printer_name,
            pdf_bytes: pdf,
        })
        .await;
    }

    let source = build_invoice_source(&data);
    let dateien: Vec<(String, Vec<u8>)> = logo_datei(&data).into_iter().collect();

    #[cfg(windows)]
    {
        let drucker = printer_name.clone();
        return tokio::task::spawn_blocking(move || -> Result<(), HardwareError> {
            let (dpi_x, _) = crate::commands::win_print::drucker_dpi(&drucker);
            let seiten = compile_typst_zu_seiten(source, dateien, dpi_x)
                .map_err(HardwareError::Encoding)?;
            crate::commands::win_print::print_raster_seiten(
                &drucker,
                "Norns Rechnung",
                &seiten,
                None, // A4 fuellt die bedruckbare Flaeche des Blatts
            )
            .map_err(HardwareError::Device)
        })
        .await
        .map_err(|e| HardwareError::Internal(format!("Druckauftrag abgebrochen: {e}")))?;
    }

    #[cfg(not(windows))]
    {
        let pdf = tokio::task::spawn_blocking(move || {
            compile_typst_to_pdf_mit_dateien(source, dateien)
        })
        .await
        .map_err(|e| HardwareError::Internal(format!("typst task abgebrochen: {e}")))?
        .map_err(HardwareError::Encoding)?;
        print_a4(PrintA4Params {
            printer_name,
            pdf_bytes: pdf,
        })
        .await
    }
}

/// Save the PDF to a temp path and ask the OS to open it (Preview.app on macOS).
#[tauri::command]
pub async fn open_pdf_preview(
    pdf_bytes: Vec<u8>,
    app_handle: tauri::AppHandle,
) -> HwResult<PdfPreviewResult> {
    let tmp = std::env::temp_dir().join(format!("norns-vorschau-{}.pdf", uuid_like()));
    std::fs::write(&tmp, &pdf_bytes).map_err(HardwareError::from)?;

    #[allow(deprecated)]
    {
        use tauri_plugin_shell::ShellExt;
        app_handle
            .shell()
            .open(tmp.to_string_lossy().into_owned(), None)
            .map_err(|e| HardwareError::Internal(format!("shell::open failed: {e}")))?;
    }

    // Best-effort same-session cleanup (DSGVO, Phase 3.8): the external viewer has
    // loaded the file long before this fires (it holds its own copy), so removing
    // the temp PDF — with the customer name + §25a data — is safe. If the app dies
    // before this fires, the boot-time sweep catches the orphan. Never blocks.
    let tmp_for_cleanup = tmp.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(300)).await;
        let _ = std::fs::remove_file(&tmp_for_cleanup);
    });

    Ok(PdfPreviewResult {
        temp_path: tmp.to_string_lossy().into_owned(),
    })
}

// ────────────────────────────────────────────────────────────────────────
// Typst compilation
// ────────────────────────────────────────────────────────────────────────

/// Compile a Typst source string to PDF bytes. Shared by the command and tests.
pub fn compile_typst_to_pdf(source: String) -> Result<Vec<u8>, String> {
    compile_typst_to_pdf_mit_dateien(source, Vec::new())
}

/// Wie `compile_typst_to_pdf`, aber mit virtuellen Dateien (Dateiname,
/// Bytes) — der Weg, ueber den das Haendler-Logo als `#image("logo.png")`
/// in die Rechnung kommt. Die Welt beantwortete bis zum 26.07.2026 JEDE
/// Dateianfrage mit NotFound; ein Bild scheiterte also am World-Trait,
/// nicht an Typst.
pub fn compile_typst_to_pdf_mit_dateien(
    source: String,
    dateien: Vec<(String, Vec<u8>)>,
) -> Result<Vec<u8>, String> {
    let world = TypstWorld::mit_dateien(source, dateien);
    let mut tracer = Tracer::new();
    let document = typst::compile(&world, &mut tracer).map_err(|errors| {
        errors
            .first()
            .map(|d| format!("typst compile error: {}", d.message))
            .unwrap_or_else(|| "typst compile failed".to_string())
    })?;
    Ok(typst_pdf::pdf(&document, Smart::Auto, None))
}

/// Eine fertig gerasterte Seite: RGBA-Bytes plus Breite und Hoehe in Pixeln.
///
/// Wohnt hier und nicht im Windows-Modul, weil das RASTERN auf jeder
/// Plattform laeuft (und getestet wird) — nur der GDI-DRUCK ist Windows.
pub struct RasterSeite {
    pub rgba: Vec<u8>,
    pub breite_px: u32,
    pub hoehe_px: u32,
}

/// Dieselbe Typst-Quelle, aber als PIXEL je Seite statt als PDF.
///
/// Der Windows-Direktdruck (win_print::print_raster_seiten) spricht GDI und
/// braucht Bitmaps; typst-render rastert die Seiten des SELBEN Dokuments,
/// das typst-pdf setzen wuerde — ein Setzer, zwei Ausgaenge, kein zweites
/// Layout, das abweichen koennte.
///
/// `dpi` kommt vom Zieldrucker (win_print::drucker_dpi), damit Pixel und
/// Treiberdichte 1:1 stehen und weder Text noch Balkencode weich werden.
pub fn compile_typst_zu_seiten(
    source: String,
    dateien: Vec<(String, Vec<u8>)>,
    dpi: f32,
) -> Result<Vec<RasterSeite>, String> {
    let world = TypstWorld::mit_dateien(source, dateien);
    let mut tracer = Tracer::new();
    let document = typst::compile(&world, &mut tracer).map_err(|errors| {
        errors
            .first()
            .map(|d| format!("typst compile error: {}", d.message))
            .unwrap_or_else(|| "typst compile failed".to_string())
    })?;
    let pixel_je_pt = dpi / 72.0;
    let mut seiten = Vec::with_capacity(document.pages.len());
    for frame in &document.pages {
        let pixmap = typst_render::render(&frame.frame, pixel_je_pt, typst::visualize::Color::WHITE);
        seiten.push(RasterSeite {
            breite_px: pixmap.width(),
            hoehe_px: pixmap.height(),
            rgba: pixmap.take(),
        });
    }
    if seiten.is_empty() {
        return Err("Das Dokument hat keine Seite.".into());
    }
    Ok(seiten)
}

/// Escape a value for safe insertion as a Typst code-mode string literal
/// (`#"..."`), which renders verbatim with no markup interpretation.
pub(crate) fn esc(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// ═══════════════════════════════════════════════════════════════════════
///  DIE RECHNUNGSFABRIK — aus den Mandantendaten entsteht das Blatt
/// ═══════════════════════════════════════════════════════════════════════
///
/// 19.08.2026, Basels Auftrag: „kein Flickwerk — ein Fabrikat wie bei den
/// grossen Haeusern, gebaut aus dem, was der Haendler eingetragen hat."
/// Der alte Bau war EIN format!-Aufruf ueber zwanzig Zeilen Rohtext; jede
/// Aenderung riss an drei Stellen. Jetzt baut jede Zone ihr eigenes Stueck
/// (Kopfband, Fenster, Metablock, Positionen, Summen, Fussband), und die
/// Fabrik setzt sie zusammen.
///
/// ── DIE ORDNUNG DES BLATTES (DIN 5008 Form B + Kanzleibrauch) ───────────
///
///   Kopfband      Logo links, Betriebsblock rechts, Haarlinie darunter.
///   Fenster       Anschriftzone 62,7 mm ab Kante — der Empfaenger faellt
///                 exakt ins DL-Kuvertfenster. Ohne Empfaenger entfaellt
///                 die Zone und das Blatt rueckt kompakt zusammen.
///   Metablock     rechts neben dem Fenster: Nummer, Datum, Kassierer.
///   Betreff       „Rechnung Nr. …" als kraeftige Zeile.
///   Positionen    Tabelle mit wiederholtem Kopf (mehrseitig sicher),
///                 Zebra-Hauch fuer die Lesbarkeit langer Listen.
///   Summen        rechter Kasten: Zwischensumme, MwSt. (nur wenn sie
///                 erscheinen DARF, § 14a Abs. 6 Satz 2), Gesamt betont.
///   Fussband      auf JEDER Seite: Kontakt | Steuer | Seitenzahl.
///
/// ── FARBHALTUNG: GRAPHIT, KEIN NORNS-ROT ────────────────────────────────
///
/// Das Blatt ist das Papier des HAENDLERS, nicht unseres. Mandanten-
/// neutralitaet heisst: reine Graphitleiter (#1c1c1c bis #8a8a8a), eine
/// einzige kraeftige Linie als Gewicht. Wer Farbe will, bringt sie ueber
/// sein Logo mit.
const DIN_KOPF: &str = "#set page(paper: \"a4\", margin: (left: 25mm, right: 20mm, top: 20mm, bottom: 28mm))\n#set text(size: 10pt, fill: rgb(\"#1c1c1c\"))";

/// Kopfband: Logo links (falls vorhanden), Betriebsblock rechts.
fn zone_kopfband(data: &InvoiceData) -> String {
    let logo = match logo_datei(data) {
        Some((dateiname, _)) => {
            let breite_mm = match data.logo_size.as_deref().map(str::trim) {
                Some("klein") => 26,
                Some("gross") => 48,
                _ => 36,
            };
            format!("#image(\"{dateiname}\", width: {breite_mm}mm, height: 22mm, fit: \"contain\")")
        }
        None => String::new(),
    };
    /*
     * ⚠️ Der Name kommt aus `shop_name` (Mandantendaten). Fehlt er, faellt
     * der Kopf auf `seller_name` zurueck — sonst traegt das Blatt GAR
     * KEINEN Namen, und genau das hat der Waechter beim Fabrik-Umbau am
     * 19.08.2026 gefangen. Fehlen beide, bleibt der Kopf leer statt fremd
     * (Mandantenneutralitaet, KOORDINATION §7).
     */
    let kopfname = data
        .shop_name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or(data.seller_name.trim());
    let name = if kopfname.is_empty() {
        String::new()
    } else {
        format!(
            "#text(size: 15pt, weight: \"bold\")[#\"{}\"] \\\n",
            esc(kopfname)
        )
    };
    let adresse: Vec<String> = data
        .seller_address_lines
        .iter()
        .filter(|z| !z.trim().is_empty())
        .map(|z| format!("#\"{}\"", esc(z)))
        .collect();
    let adresse_zeilen = if adresse.is_empty() {
        String::new()
    } else {
        format!("#text(size: 9pt, fill: rgb(\"#4c4a45\"))[{}]\n", adresse.join(" \\ "))
    };
    format!(
        "#grid(columns: (1fr, auto), align: (left + horizon, right + top),\n\
  [{logo}],\n\
  [#align(right)[{name}{adresse_zeilen}]],\n\
)\n\
#v(2.5mm)\n\
#line(length: 100%, stroke: 1.2pt + rgb(\"#1c1c1c\"))\n"
    )
}

/// Fenster + Metablock: links der Empfaenger (Kuvertlage), rechts die
/// Eckdaten. Ohne Empfaenger nur der Metablock, kompakt.
fn zone_fenster_und_meta(data: &InvoiceData) -> String {
    let meta_zeile = |k: &str, w: &str| -> String {
        format!(
            "  [#text(size: 9pt, fill: rgb(\"#605d56\"))[{k}]], [#text(size: 9pt)[#\"{}\"]],\n",
            esc(w)
        )
    };
    let mut meta = String::new();
    meta.push_str(&meta_zeile("Rechnungs-Nr.", &data.invoice_number));
    meta.push_str(&meta_zeile("Rechnungsdatum", &data.date));
    meta.push_str(&meta_zeile("Leistungsdatum", &data.date));
    // Der Kontakt wandert ins Fussband (Kanzleibrauch); hier steht, was den
    // VORGANG bestimmt. Die Zahlungszeile sagt die Wahrheit dieser Kasse:
    // am Tresen ist bar bezahlt worden, es gibt kein Zahlungsziel.
    meta.push_str(&meta_zeile("Zahlung", "bar bei Übergabe"));
    let metablock = format!(
        "#grid(columns: (auto, auto), column-gutter: 4mm, row-gutter: 1.6mm, align: (left, left),\n{meta})"
    );

    let empfaenger: Vec<String> = data
        .recipient_lines
        .iter()
        .filter(|z| !z.trim().is_empty())
        .map(|z| format!("#\"{}\"", esc(z)))
        .collect();
    if empfaenger.is_empty() {
        // Kompakt: Metablock rechtsbuendig, kein leeres Fenster.
        format!("#v(4mm)\n#align(right)[{metablock}]\n#v(4mm)\n")
    } else {
        // DIN-Lage: Fensterinhalt beginnt 62,7 mm ab Blattkante = 42,7 mm ab
        // Satzspiegel. Das Kopfband darueber ist ~30 mm hoch; der Block hier
        // schiebt mit fester Hoehe nach, sodass der Empfaenger im Fenster
        // sitzt und der Fliesstext UNTER der Zone weiterlaeuft.
        format!(
            "#block(width: 100%, height: 52mm)[\n\
#v(9mm)\n\
#grid(columns: (85mm, 1fr), align: (left + top, right + top),\n\
  [#text(size: 7.5pt, fill: rgb(\"#8a8a8a\"))[#underline[{absender}]] \\\n#v(1.2mm)\n{zeilen}],\n\
  [{metablock}],\n\
)]\n",
            absender = ruecksendezeile(data),
            zeilen = empfaenger.join(" \\ "),
        )
    }
}

/// Die kleine Ruecksendezeile ueber dem Fenster (DIN 5008 Zusatzzone).
fn ruecksendezeile(data: &InvoiceData) -> String {
    let mut teile: Vec<String> = Vec::new();
    let name = data
        .shop_name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or(data.seller_name.trim());
    if !name.is_empty() {
        teile.push(esc(name));
    }
    for z in &data.seller_address_lines {
        if !z.trim().is_empty() {
            teile.push(esc(z.trim()));
        }
    }
    if teile.is_empty() {
        String::new()
    } else {
        format!("#\"{}\"", teile.join(" · "))
    }
}

/// Positionen: wiederholter Tabellenkopf, Zebra-Hauch, saubere Ausrichtung.
fn zone_positionen(data: &InvoiceData) -> String {
    let mut rows = String::new();
    for item in &data.items {
        let vat = if item.vat_rate.trim().is_empty() {
            "—".to_string()
        } else {
            format!("{} %", item.vat_rate)
        };
        rows.push_str(&format!(
            "  [#\"{}\"], [#\"{}\"], [#\"{} €\"], [#\"{}\"], [#\"{} €\"],\n",
            esc(&item.description),
            item.quantity,
            esc(&item.unit_price_eur),
            esc(&vat),
            esc(&item.total_eur),
        ));
    }
    format!(
        "#table(\n\
  columns: (1fr, 14mm, 26mm, 16mm, 28mm),\n\
  align: (left, right, right, right, right),\n\
  stroke: none,\n\
  inset: (x: 2.5mm, y: 2.2mm),\n\
  fill: (_, y) => if y == 0 {{ rgb(\"#1c1c1c\") }} else if calc.odd(y) {{ rgb(\"#f5f3ef\") }} else {{ white }},\n\
  table.header(\n\
    [#text(fill: white, weight: \"bold\", size: 9pt)[Beschreibung]],\n\
    [#text(fill: white, weight: \"bold\", size: 9pt)[Menge]],\n\
    [#text(fill: white, weight: \"bold\", size: 9pt)[Einzelpreis]],\n\
    [#text(fill: white, weight: \"bold\", size: 9pt)[MwSt.]],\n\
    [#text(fill: white, weight: \"bold\", size: 9pt)[Summe]],\n\
  ),\n\
{rows})\n"
    )
}

/// Summenkasten rechts. MwSt. und Netto NUR, wenn sie erscheinen duerfen
/// (§ 14a Abs. 6 Satz 2 UStG — die Begruendung steht seit dem 26.07. hier
/// und gilt woertlich weiter).
fn zone_summen(data: &InvoiceData) -> String {
    let mut zeilen = String::new();
    if let Some(betrag) = data.vat_disclosable_eur.as_deref() {
        if !betrag.trim().is_empty() {
            zeilen.push_str(&format!(
                "  [#text(size: 9.5pt)[Zwischensumme (netto)]], [#text(size: 9.5pt)[#\"{} €\"]],\n",
                esc(&data.subtotal_eur)
            ));
            zeilen.push_str(&format!(
                "  [#text(size: 9.5pt)[MwSt. gesamt]], [#text(size: 9.5pt)[#\"{} €\"]],\n",
                esc(betrag)
            ));
        }
    }
    zeilen.push_str(&format!(
        "  [#text(size: 12pt, weight: \"bold\")[Gesamtbetrag]], [#text(size: 12pt, weight: \"bold\")[#\"{} €\"]],\n",
        esc(&data.total_eur)
    ));
    format!(
        "#v(3mm)\n\
#align(right)[#block(stroke: (top: 1.2pt + rgb(\"#1c1c1c\")), inset: (top: 2.5mm))[\n\
#grid(columns: (auto, 32mm), column-gutter: 6mm, row-gutter: 2mm, align: (left, right),\n\
{zeilen})]]\n"
    )
}

/// Pflichthinweise und freie Steuernotiz.
fn zone_hinweise(data: &InvoiceData) -> String {
    let mut aus = String::new();
    if !data.special_scheme_notices.is_empty() {
        let zeilen: Vec<String> = data
            .special_scheme_notices
            .iter()
            .map(|z| format!("#\"{}\"", esc(z)))
            .collect();
        aus.push_str(&format!(
            "#v(5mm)\n#text(size: 10pt)[{}]\n",
            zeilen.join(" \\ ")
        ));
    }
    if let Some(note) = &data.tax_note {
        if !note.trim().is_empty() {
            aus.push_str(&format!(
                "#v(2mm)\n#text(size: 9pt, fill: rgb(\"#605d56\"))[#\"{}\"]\n",
                esc(note)
            ));
        }
    }
    aus.push_str(
        "#v(2mm)\n#text(size: 8pt, fill: rgb(\"#8a8a8a\"))[Das Rechnungsdatum entspricht dem Leistungsdatum (§ 14 Abs. 4 Nr. 6 UStG, Barverkauf am Tresen).]\n",
    );
    aus
}

/// Fussband auf JEDER Seite: Kontakt | Steuerangabe | Seitenzahl.
fn zone_fussband(data: &InvoiceData) -> String {
    let name = data
        .shop_name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or(data.seller_name.trim());
    let anschrift = data
        .seller_address_lines
        .iter()
        .map(|z| z.trim())
        .filter(|z| !z.is_empty())
        .collect::<Vec<_>>()
        .join(", ");
    let links = if name.is_empty() && anschrift.is_empty() {
        String::new()
    } else if anschrift.is_empty() {
        esc(name)
    } else if name.is_empty() {
        esc(&anschrift)
    } else {
        esc(&format!("{name} · {anschrift}"))
    };
    let mut mitte_teile: Vec<String> = Vec::new();
    if let Some(z) = data.seller_tax_line.as_deref().map(str::trim) {
        if !z.is_empty() {
            mitte_teile.push(z.to_string());
        }
    }
    if let Some(z) = data.seller_phone.as_deref().map(str::trim) {
        if !z.is_empty() {
            mitte_teile.push(format!("Tel. {z}"));
        }
    }
    let mitte = esc(&mitte_teile.join("  ·  "));
    format!(
        "#set page(footer: [\n\
#line(length: 100%, stroke: 0.5pt + rgb(\"#c9c4bb\"))\n\
#v(1.5mm)\n\
#grid(columns: (1fr, auto, 22mm), column-gutter: 4mm, align: (left + horizon, center + horizon, right + horizon),\n\
  [#box(width: 100%, clip: true)[#text(size: 7.5pt, fill: rgb(\"#8a8a8a\"))[#\"{links}\"]]],\n\
  [#text(size: 7.5pt, fill: rgb(\"#8a8a8a\"))[#\"{mitte}\"]],\n\
  [#text(size: 7.5pt, fill: rgb(\"#8a8a8a\"))[Seite #context counter(page).display(\"1 von 1\", both: true)] \\ #text(size: 6pt, fill: rgb(\"#b9b4ab\"), tracking: 0.06em)[norns.de]],\n\
)])\n"
    )
}

/// Falzmarken und Lochmarke — Haarlinien in Blattrandnaehe.
fn zone_din_marken() -> String {
    "#place(top + left, dx: -15mm, dy: 85mm)[#line(length: 4mm, stroke: 0.3pt + rgb(\"#999999\"))]\n\
#place(top + left, dx: -15mm, dy: 128.5mm)[#line(length: 6mm, stroke: 0.3pt + rgb(\"#999999\"))]\n\
#place(top + left, dx: -15mm, dy: 190mm)[#line(length: 4mm, stroke: 0.3pt + rgb(\"#999999\"))]\n"
        .to_string()
}

fn build_invoice_source(data: &InvoiceData) -> String {
    format!(
        "{kopf}\n{fuss}{marken}{band}{fenster}\
#text(size: 13pt, weight: \"bold\")[Rechnung]\n\
#v(1mm)\n\
#text(size: 9pt, fill: rgb(\"#605d56\"))[Vielen Dank für Ihren Einkauf.]\n\
#v(3.5mm)\n\
{positionen}{summen}{hinweise}",
        kopf = DIN_KOPF,
        fuss = zone_fussband(data),
        marken = zone_din_marken(),
        band = zone_kopfband(data),
        fenster = zone_fenster_und_meta(data),
        positionen = zone_positionen(data),
        summen = zone_summen(data),
        hinweise = zone_hinweise(data),
    )
}


// ────────────────────────────────────────────────────────────────────────
// Typst World — in-memory single source + bundled default fonts.
// ────────────────────────────────────────────────────────────────────────

/// Process-wide font cache: loading + parsing the bundled fonts once.
fn shared_fonts() -> &'static (Vec<Font>, Prehashed<FontBook>) {
    static FONTS: OnceLock<(Vec<Font>, Prehashed<FontBook>)> = OnceLock::new();
    FONTS.get_or_init(|| {
        let mut fonts = Vec::new();
        for data in typst_assets::fonts() {
            let bytes = Bytes::from(data.to_vec());
            let mut index = 0;
            while let Some(font) = Font::new(bytes.clone(), index) {
                fonts.push(font);
                index += 1;
            }
        }
        let book = FontBook::from_fonts(&fonts);
        (fonts, Prehashed::new(book))
    })
}

struct TypstWorld {
    library: Prehashed<Library>,
    source: Source,
    /// Virtuelle Dateien (Dateiname → Bytes), z. B. das Haendler-Logo.
    dateien: Vec<(String, Bytes)>,
}

impl TypstWorld {
    fn mit_dateien(source_text: String, dateien: Vec<(String, Vec<u8>)>) -> Self {
        // Die Quelle bekommt einen ECHTEN virtuellen Pfad statt
        // `Source::detached`: relative Pfade wie `image("logo.png")` werden
        // am Pfad der Quelle aufgeloest, und eine losgeloeste Quelle hat
        // keinen — die Aufloesung scheiterte dann VOR dem `file()`-Aufruf.
        let id = FileId::new(None, VirtualPath::new("/rechnung.typ"));
        Self {
            library: Prehashed::new(Library::builder().build()),
            source: Source::new(id, source_text),
            dateien: dateien
                .into_iter()
                .map(|(name, bytes)| (name, Bytes::from(bytes)))
                .collect(),
        }
    }
}

impl World for TypstWorld {
    fn library(&self) -> &Prehashed<Library> {
        &self.library
    }

    fn book(&self) -> &Prehashed<FontBook> {
        &shared_fonts().1
    }

    fn main(&self) -> Source {
        self.source.clone()
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.source.id() {
            Ok(self.source.clone())
        } else {
            Err(FileError::NotFound(id.vpath().as_rootless_path().into()))
        }
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        // Nur die mitgegebenen virtuellen Dateien existieren — alles andere
        // bleibt NotFound. Die Rechnung greift NIE auf die echte Platte.
        let pfad = id.vpath().as_rootless_path();
        self.dateien
            .iter()
            .find(|(name, _)| std::path::Path::new(name) == pfad)
            .map(|(_, bytes)| bytes.clone())
            .ok_or_else(|| FileError::NotFound(pfad.into()))
    }

    fn font(&self, index: usize) -> Option<Font> {
        shared_fonts().0.get(index).cloned()
    }

    fn today(&self, _offset: Option<i64>) -> Option<Datetime> {
        None
    }
}

/// Tiny per-temp-file id — avoids pulling in the full `uuid` crate just for a
/// 12-char marker.
fn uuid_like() -> String {
    let r1: u64 = fastrand::u64(..);
    let r2: u32 = fastrand::u32(..);
    format!("{r1:016x}{r2:08x}")
}

const TEMP_PDF_PREFIXES: [&str; 2] = ["norns-rechnung-", "norns-vorschau-"];

/// DSGVO cleanup (Phase 3.8): delete every stale warehouse14 invoice/preview PDF
/// left in the OS temp dir. `print_a4` removes its own temp on success, but a
/// crash between write and remove — and EVERY `open_pdf_preview` (whose file is
/// held open by an external viewer, so it can't be deleted inline) — leaves a
/// temp PDF carrying a customer name + §25a data. Called at startup (purges the
/// previous session's orphans) and exposed as a command for the Art.17 erase
/// flow. Returns the number of files removed. Never panics.
pub fn sweep_stale_pdf_temp_files() -> usize {
    let dir = std::env::temp_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return 0;
    };
    let mut removed = 0usize;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let is_ours = TEMP_PDF_PREFIXES.iter().any(|p| name.starts_with(p));
        if is_ours && name.ends_with(".pdf") && std::fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// Sweep stale invoice/preview temp PDFs (DSGVO). Callable from the Art.17 flow
/// so an erase purges any at-rest PDF for the customer immediately, not just at
/// the next launch.
#[tauri::command]
pub fn sweep_temp_pdfs() -> usize {
    sweep_stale_pdf_temp_files()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    /// Die Fabrik unter LAST: viele Positionen, boesartige Zeichen.
    ///
    /// Ein Blatt, das bei zwanzig Zeilen bricht oder an einem
    /// Anfuehrungszeichen im Produktnamen platzt, ist kein Fabrikat. Der
    /// Satz baut die Grenzfaelle, uebersetzt bis zu Pixeln und legt das
    /// Ergebnis zur Sichtabnahme ab.
    fn fabrik_traegt_last_und_boese_zeichen() {
        let mut items = Vec::new();
        for i in 1..=22 {
            items.push(InvoiceItem {
                // Anfuehrungszeichen, Backslash und Semikolon in EINEM Namen:
                // genau die Zeichen, die eine Vorlage aus Rohtext zerreissen.
                description: format!("Ring \"Antik\" Nr. {i} \\ 585er; poliert"),
                quantity: 1,
                unit_price_eur: "199,00".to_string(),
                vat_rate: "19".to_string(),
                total_eur: "199,00".to_string(),
            });
        }
        let data = InvoiceData {
            invoice_number: "R-2026-9999".to_string(),
            date: "19.08.2026".to_string(),
            seller_name: "Goldhaus \"Zum Anker\" e. K.".to_string(),
            items,
            subtotal_eur: "3.672,27".to_string(),
            vat_total_eur: "705,73".to_string(),
            vat_disclosable_eur: Some("705,73".to_string()),
            special_scheme_notices: vec![],
            total_eur: "4.378,00".to_string(),
            tax_note: None,
            shop_name: Some("Goldhaus \"Zum Anker\" e. K.".to_string()),
            seller_address_lines: vec![
                "Marktgasse 1".to_string(),
                "73614 Schorndorf".to_string(),
            ],
            seller_tax_line: Some("Steuernummer: 12345/67890".to_string()),
            seller_phone: Some("07181 000000".to_string()),
            recipient_lines: vec!["Firma Müller & Söhne GmbH".to_string(), "70173 Stuttgart".to_string()],
            logo_bytes_base64: None,
            logo_format: None,
            logo_size: None,
        };
        let quelle = build_invoice_source(&data);
        // Die boesen Zeichen sind escaped, nicht durchgereicht.
        assert!(quelle.contains("\\\"Antik\\\""), "Anfuehrungszeichen nicht escaped");
        // Mit ausweisbarer Steuer erscheinen BEIDE Summenzeilen.
        assert!(quelle.contains("MwSt. gesamt"), "MwSt.-Zeile fehlt bei Regelware");
        assert!(quelle.contains("Zwischensumme (netto)"), "Nettozeile fehlt");

        let seiten = compile_typst_zu_seiten(quelle, vec![], 96.0).expect("Last uebersetzt nicht");
        // 22 Positionen passen auf EINE Seite; das Fussband traegt die Zahl.
        assert!(!seiten.is_empty(), "keine Seite");
        let s = &seiten[0];
        let png = std::env::temp_dir().join("norns-rechnung-last.png");
        let _ = image::save_buffer(&png, &s.rgba, s.breite_px, s.hoehe_px, image::ColorType::Rgba8);
        if seiten.len() > 1 {
            let s2 = &seiten[1];
            let png2 = std::env::temp_dir().join("norns-rechnung-last-2.png");
            let _ = image::save_buffer(&png2, &s2.rgba, s2.breite_px, s2.hoehe_px, image::ColorType::Rgba8);
        }
    }

    #[test]
    /// DIN 5008 Form B erreicht das Blatt, und das Blatt entsteht WIRKLICH.
    ///
    /// Quelle: Falzmarken, Lochmarke und die Anschriftzone stehen absolut
    /// platziert im Satz; der Empfaenger faellt exakt ins Kuvertfenster.
    /// Und weil ein Satzfehler in typst erst beim Uebersetzen platzt, wird
    /// die Quelle hier bis zu PIXELN uebersetzt: eine Seite, mit Tinte im
    /// oberen linken Viertel (der Empfaenger), und der Beweis liegt als PNG
    /// im Temp-Ordner fuer die Sichtabnahme.
    fn din_5008_erreicht_das_blatt_und_uebersetzt() {
        let data = InvoiceData {
            invoice_number: "R-2026-0815".to_string(),
            date: "19.08.2026".to_string(),
            seller_name: "Goldhaus Muster".to_string(),
            items: vec![InvoiceItem {
                description: "Herrenuhr, gebraucht · Ser.-Nr. R-88231-X".to_string(),
                quantity: 1,
                unit_price_eur: "3.200,00".to_string(),
                vat_rate: "".to_string(),
                total_eur: "3.200,00".to_string(),
            }],
            subtotal_eur: "3.200,00".to_string(),
            vat_total_eur: "0,00".to_string(),
            vat_disclosable_eur: None,
            special_scheme_notices: vec!["Gebrauchtgegenstände/Sonderregelung".to_string()],
            total_eur: "3.200,00".to_string(),
            tax_note: Some("Differenzbesteuerung nach § 25a UStG.".to_string()),
            shop_name: Some("Goldhaus Muster".to_string()),
            seller_address_lines: vec![
                "Marktgasse 1".to_string(),
                "73614 Schorndorf".to_string(),
            ],
            seller_tax_line: Some("USt-IdNr.: DE123456789".to_string()),
            seller_phone: Some("07181 000000".to_string()),
            recipient_lines: vec![
                "Herrn Max Beispiel".to_string(),
                "Beispielweg 2".to_string(),
                "70173 Stuttgart".to_string(),
            ],
            logo_bytes_base64: None,
            logo_format: None,
            logo_size: None,
        };
        let quelle = build_invoice_source(&data);
        // Geometrie in der Quelle: beide Falten, die Lochmarke, das Fenster.
        assert!(quelle.contains("dy: 85mm"), "erste Falzmarke fehlt");
        assert!(quelle.contains("dy: 190mm"), "zweite Falzmarke fehlt");
        assert!(quelle.contains("dy: 128.5mm"), "Lochmarke fehlt");
        /*
         * 19.08.2026, Fabrik-Umbau: die Anschriftzone ist kein absolut
         * platzierter Kasten mehr, sondern ein Flussblock fester Hoehe
         * (52 mm), der den Empfaenger in die Kuvertlage schiebt und den
         * Fliesstext DARUNTER weiterlaufen laesst. Geprueft wird deshalb
         * der Block plus die Lage im BILD (unten, per Tinte im Fenster).
         */
        assert!(quelle.contains("height: 52mm"), "Fensterblock fehlt");
        assert!(quelle.contains("Herrn Max Beispiel"), "Empfaenger fehlt");
        assert!(quelle.contains("counter(page)"), "Seitenzahl im Fussband fehlt");

        // Und sie uebersetzt bis zu Pixeln: A4 bei 96 dpi ist 794 x 1123.
        let seiten = compile_typst_zu_seiten(quelle, vec![], 96.0).expect("uebersetzt nicht");
        assert_eq!(seiten.len(), 1, "mehr als eine Seite");
        let s = &seiten[0];
        assert!((s.breite_px as i32 - 794).abs() <= 2, "Breite {}", s.breite_px);
        // Tinte im Fensterviertel (oben links, unterhalb des Briefkopfs).
        let mut tinte = 0u32;
        for y in (s.hoehe_px / 5)..(s.hoehe_px / 2) {
            for x in 0..(s.breite_px / 2) {
                let i = ((y * s.breite_px + x) * 4) as usize;
                if s.rgba[i] < 200 {
                    tinte += 1;
                }
            }
        }
        assert!(tinte > 200, "kein Empfaenger im Fenster ({} dunkle Pixel)", tinte);

        // Sichtabnahme: das Blatt liegt als PNG bereit (bewusst im Temp).
        let png = std::env::temp_dir().join("norns-rechnung-din-probe.png");
        let _ = image::save_buffer(
            &png,
            &s.rgba,
            s.breite_px,
            s.hoehe_px,
            image::ColorType::Rgba8,
        );

        // Und die ZWEITE Gestalt: ohne Empfaenger (der Kassen-Normalfall,
        // Kleinbetragsrechnung) — kompakter Kopf, keine leere Fensterzone.
        let mut ohne = data.clone();
        ohne.recipient_lines = vec![];
        let quelle2 = build_invoice_source(&ohne);
        assert!(!quelle2.contains("height: 52mm"), "Leerblock ohne Empfaenger");
        let seiten2 = compile_typst_zu_seiten(quelle2, vec![], 96.0).expect("Variante B");
        let s2 = &seiten2[0];
        let png2 = std::env::temp_dir().join("norns-rechnung-din-probe-b.png");
        let _ = image::save_buffer(
            &png2,
            &s2.rgba,
            s2.breite_px,
            s2.hoehe_px,
            image::ColorType::Rgba8,
        );
    }

    #[test]
    /// § 14 Abs. 4 Nr. 1, 2 und 6 UStG erreichen das Blatt (19.08.2026).
    ///
    /// Die Bon-Nutzlast trug Anschrift und Steuernummer seit jeher; der
    /// Abbilder warf sie weg, und die Rechnung war oberhalb der
    /// Kleinbetragsgrenze formal mangelhaft. Dieser Satz pinnt: mit
    /// Anschrift steht der Briefkopfblock samt Steuerzeile und dem
    /// Leistungsdatum-Satz in der Quelle; OHNE Anschrift bleibt der alte
    /// Verkaeufer-Rueckfall, damit ein Altaufrufer kein leereres Blatt
    /// bekommt.
    fn pflichtangaben_erreichen_das_blatt() {
        let mut data = InvoiceData {
            invoice_number: "R-2026-0001".to_string(),
            date: "19.08.2026".to_string(),
            seller_name: "Goldhaus Muster".to_string(),
            items: vec![],
            subtotal_eur: "0,00".to_string(),
            vat_total_eur: "0,00".to_string(),
            vat_disclosable_eur: None,
            special_scheme_notices: vec![],
            total_eur: "0,00".to_string(),
            tax_note: None,
            shop_name: Some("Goldhaus Muster".to_string()),
            seller_address_lines: vec![
                "Marktgasse 1".to_string(),
                "73614 Schorndorf".to_string(),
            ],
            seller_tax_line: Some("USt-IdNr.: DE123456789".to_string()),
            seller_phone: Some("07181 000000".to_string()),
            recipient_lines: vec![],
            logo_bytes_base64: None,
            logo_format: None,
            logo_size: None,
        };
        let quelle = build_invoice_source(&data);
        assert!(quelle.contains("Marktgasse 1"), "Anschrift fehlt (Nr. 1)");
        assert!(quelle.contains("USt-IdNr.: DE123456789"), "Steuerzeile fehlt (Nr. 2)");
        assert!(
            quelle.contains("Rechnungsdatum entspricht dem Leistungsdatum"),
            "Leistungsdatum-Satz fehlt (Nr. 6)"
        );
        assert!(quelle.contains("07181 000000"), "Telefon fehlt");
        // Mit Briefkopf gibt es die alte Verkaeufer-Zeile nicht doppelt.
        assert!(!quelle.contains("Verkäufer:"), "doppelter Kopf");

        /*
         * 19.08.2026: der Rueckfall heisst nicht mehr „Verkäufer: X" (eine
         * Zeile, die keine Kanzleivorlage kennt), sondern: fehlt shop_name,
         * traegt der Kopf den seller_name. Geprueft wird genau das.
         */
        data.seller_address_lines = vec![];
        data.shop_name = None;
        let alt = build_invoice_source(&data);
        assert!(alt.contains("Goldhaus Muster"), "Namens-Rueckfall fehlt");
    }

    #[test]
    /// Das Rastern ist der Traeger des Windows-Direktdrucks: dieselbe Quelle,
    /// die das PDF setzt, muss auch Pixel liefern — in der DICHTE des Ziels.
    ///
    /// 57 mm bei 300 dpi sind 673 Pixel (57/25.4*300 = 673,2). Der Satz prueft
    /// Groesse UND Inhalt: eine Seite, auf der etwas steht, ist nicht rein
    /// weiss. Ein Rasterer, der leere Seiten liefert, wuerde sonst still
    /// leere Etiketten drucken — gruen und nutzlos.
    #[test]
    fn rastert_dieselbe_quelle_zu_pixeln_in_zielgroesse() {
        let quelle = r##"#set page(width: 57mm, height: 32mm, margin: 2mm)
#set text(size: 8pt)
GS-260818-RV4E Testetikett"##;
        let seiten =
            compile_typst_zu_seiten(quelle.to_string(), Vec::new(), 300.0).expect("rastert");
        assert_eq!(seiten.len(), 1, "eine Etikettseite");
        let s = &seiten[0];
        // 300 dpi: 57 mm → 673 px, 32 mm → 378 px (je ±2 px Rundung).
        assert!((s.breite_px as i64 - 673).abs() <= 2, "Breite {} px", s.breite_px);
        assert!((s.hoehe_px as i64 - 378).abs() <= 2, "Hoehe {} px", s.hoehe_px);
        assert_eq!(s.rgba.len() as u32, s.breite_px * s.hoehe_px * 4);
        // Nicht rein weiss: mindestens ein Pixel traegt Tinte.
        let bedruckt = s.rgba.chunks_exact(4).any(|px| px[0] < 200);
        assert!(bedruckt, "die gerasterte Seite ist leer");
    }

    fn compiles_minimal_document_to_pdf_bytes() {
        let bytes = compile_typst_to_pdf("= Hello".to_string()).expect("typst should compile");
        assert!(bytes.starts_with(b"%PDF-"), "output should be a PDF");
    }

    /// ⚠️ Der Waechter fuer die A4-Rechnung, und sie wiegt schwerer als der Bon.
    ///
    /// Die Rechnung traegt eine Rechnungsnummer und ist damit die Urkunde, mit
    /// der ein Kaeufer Vorsteuer zoege. Ein gesonderter Steuerausweis bei
    /// Differenzbesteuerung ist nach § 14a Abs. 6 Satz 2 UStG verboten und
    /// loest § 14c aus.
    #[test]
    fn rechnung_ohne_gesonderten_steuerausweis_bei_25a() {
        let data = InvoiceData {
            invoice_number: "W14-2026-0002".to_string(),
            date: "26.07.2026".to_string(),
            seller_name: "WAREHOUSE 14".to_string(),
            items: vec![InvoiceItem {
                description: "Goldkette gebraucht".to_string(),
                quantity: 1,
                unit_price_eur: "1000,00".to_string(),
                vat_rate: "".to_string(),
                total_eur: "1000,00".to_string(),
            }],
            subtotal_eur: "1000,00".to_string(),
            // Die Margensteuer waere 47,90 — und darf NIRGENDS erscheinen.
            vat_total_eur: "47,90".to_string(),
            vat_disclosable_eur: None,
            special_scheme_notices: vec!["Gebrauchtgegenstände/Sonderregelung".to_string()],
            total_eur: "1000,00".to_string(),
            tax_note: Some("Differenzbesteuerung nach § 25a UStG.".to_string()),
            shop_name: None,
            seller_address_lines: vec![],
            seller_tax_line: None,
            seller_phone: None,
            recipient_lines: vec![],
            logo_bytes_base64: None,
            logo_format: None,
            logo_size: None,
        };
        let quelle = build_invoice_source(&data);

        assert!(
            !quelle.contains("MwSt. gesamt"),
            "die Steuerzeile steht auf der Rechnung"
        );
        assert!(
            !quelle.contains("47,90"),
            "die Margensteuer steht auf der Rechnung"
        );
        assert!(
            quelle.contains("Sonderregelung"),
            "der vorgeschriebene Hinweis fehlt auf der Rechnung"
        );
    }

    /// Gegenprobe: Regelware wird weiterhin ausgewiesen.
    #[test]
    fn rechnung_weist_regelsteuer_weiterhin_aus() {
        let data = InvoiceData {
            invoice_number: "W14-2026-0003".to_string(),
            date: "26.07.2026".to_string(),
            seller_name: "WAREHOUSE 14".to_string(),
            items: vec![InvoiceItem {
                description: "Neuware".to_string(),
                quantity: 1,
                unit_price_eur: "119,00".to_string(),
                vat_rate: "19".to_string(),
                total_eur: "119,00".to_string(),
            }],
            subtotal_eur: "100,00".to_string(),
            vat_total_eur: "19,00".to_string(),
            vat_disclosable_eur: Some("19,00".to_string()),
            special_scheme_notices: vec![],
            total_eur: "119,00".to_string(),
            tax_note: None,
            shop_name: None,
            seller_address_lines: vec![],
            seller_tax_line: None,
            seller_phone: None,
            recipient_lines: vec![],
            logo_bytes_base64: None,
            logo_format: None,
            logo_size: None,
        };
        let quelle = build_invoice_source(&data);
        assert!(
            quelle.contains("MwSt. gesamt"),
            "die Steuerzeile fehlt bei Regelware"
        );
        assert!(
            quelle.contains("19,00"),
            "der Steuerbetrag fehlt bei Regelware"
        );
    }

    #[test]
    fn builds_and_compiles_a_full_invoice() {
        let data = InvoiceData {
            invoice_number: "W14-2026-0001".to_string(),
            date: "29.05.2026".to_string(),
            seller_name: "Muster Edelmetall GmbH".to_string(),
            items: vec![InvoiceItem {
                description: "Goldring 585 \"Vintage\"".to_string(),
                quantity: 1,
                unit_price_eur: "249,00".to_string(),
                vat_rate: "".to_string(),
                total_eur: "249,00".to_string(),
            }],
            subtotal_eur: "249,00".to_string(),
            vat_total_eur: "0,00".to_string(),
            // Ein Goldring unter § 25a: nichts ausweisbar, Hinweis Pflicht.
            vat_disclosable_eur: None,
            special_scheme_notices: vec!["Gebrauchtgegenstände/Sonderregelung".to_string()],
            total_eur: "249,00".to_string(),
            tax_note: Some("Differenzbesteuerung nach §25a UStG.".to_string()),
            shop_name: None,
            seller_address_lines: vec![],
            seller_tax_line: None,
            seller_phone: None,
            recipient_lines: vec![],
            logo_bytes_base64: None,
            logo_format: None,
            logo_size: None,
        };
        let pdf = compile_typst_to_pdf(build_invoice_source(&data)).expect("invoice compiles");
        assert!(pdf.starts_with(b"%PDF-"));
    }

    // ════════════════════════════════════════════════════════════════════
    // DAS LOGO-WERK auf der A4-Rechnung (Basels Dekret, 26.07.2026):
    // dieselbe Kopfordnung wie auf dem Bon — Systemzeile, Logo, Ladenname.
    // ════════════════════════════════════════════════════════════════════

    fn als_base64(bytes: &[u8]) -> String {
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    fn test_png(w: u32, h: u32) -> Vec<u8> {
        let bild = image::RgbaImage::from_pixel(w, h, image::Rgba([0, 0, 0, 255]));
        let mut puffer = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(bild)
            .write_to(&mut puffer, image::ImageFormat::Png)
            .expect("PNG-Erzeugung im Test");
        puffer.into_inner()
    }

    const TEST_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#000"/></svg>"##;

    fn basis_rechnung() -> InvoiceData {
        InvoiceData {
            invoice_number: "W14-2026-0100".to_string(),
            date: "26.07.2026".to_string(),
            seller_name: "Roman".to_string(),
            items: vec![InvoiceItem {
                description: "Goldring".to_string(),
                quantity: 1,
                unit_price_eur: "249,00".to_string(),
                vat_rate: "".to_string(),
                total_eur: "249,00".to_string(),
            }],
            subtotal_eur: "249,00".to_string(),
            vat_total_eur: "0,00".to_string(),
            vat_disclosable_eur: None,
            special_scheme_notices: vec!["Gebrauchtgegenstände/Sonderregelung".to_string()],
            total_eur: "249,00".to_string(),
            tax_note: None,
            shop_name: None,
            seller_address_lines: vec![],
            seller_tax_line: None,
            seller_phone: None,
            recipient_lines: vec![],
            logo_bytes_base64: None,
            logo_format: None,
            logo_size: None,
        }
    }

    /// Ohne Logo und ohne Namen: die feine norns.de-Systemzeile steht auf
    /// dem Blatt, aber KEIN fremder Name und KEIN Bild. Vorher stand hier
    /// fest verdrahtet „WAREHOUSE 14" in 18 pt — derselbe Fehler wie das
    /// eingebrannte Bon-Logo, nur als Text.
    ///
    /// ⚠️ 19.08.2026, Fabrik-Umbau: die Systemzeile ist vom KOPF ins
    /// FUSSBAND gewandert, sechs Punkt, fast weiss. Oben ueber dem Namen
    /// des Haendlers stand SEIN Papier unter UNSERER Marke — kein grosses
    /// Haus macht das auf der Rechnung seines Kunden. Sie bleibt (Basels
    /// Dekret vom 26.07.), nur an der Stelle, wo Hersteller stehen.
    #[test]
    fn die_rechnung_traegt_norns_zeile_und_keinen_fremden_kopf() {
        let quelle = build_invoice_source(&basis_rechnung());
        assert!(quelle.contains("norns.de"), "die Systemzeile fehlt");
        assert!(
            !quelle.contains("WAREHOUSE 14"),
            "ein fremder Name steht im Rechnungskopf"
        );
        assert!(
            !quelle.contains("image("),
            "ohne Logo verlangt die Quelle kein Bild"
        );
        let pdf = compile_typst_to_pdf(quelle).expect("die Rechnung kompiliert");
        assert!(pdf.starts_with(b"%PDF-"));
    }

    /// Der Ladenname kommt als MANDANTENDATEN mit und steht im Kopf.
    #[test]
    fn der_ladenname_steht_im_kopf_wenn_er_mitkommt() {
        let mut d = basis_rechnung();
        d.shop_name = Some("Goldhaus Meier".into());
        let quelle = build_invoice_source(&d);
        assert!(
            quelle.contains("Goldhaus Meier"),
            "der Ladenname fehlt im Kopf"
        );
        let pdf = compile_typst_to_pdf(quelle).expect("die Rechnung kompiliert");
        assert!(pdf.starts_with(b"%PDF-"));
    }

    /// Ein PNG-Logo wird als virtuelle Datei eingebettet, und die Rechnung
    /// kompiliert WIRKLICH — bis zum 26.07.2026 beantwortete die Typst-Welt
    /// jede Dateianfrage mit NotFound.
    #[test]
    fn ein_png_logo_wird_eingebettet_und_die_rechnung_kompiliert() {
        let mut d = basis_rechnung();
        d.shop_name = Some("Goldhaus Meier".into());
        d.logo_bytes_base64 = Some(als_base64(&test_png(60, 20)));
        d.logo_format = Some("png".into());
        let quelle = build_invoice_source(&d);
        assert!(quelle.contains("logo.png"), "die Quelle verlangt das Logo");
        let dateien = logo_datei(&d).map(|x| vec![x]).unwrap_or_default();
        let pdf = compile_typst_to_pdf_mit_dateien(quelle, dateien)
            .expect("die Rechnung MIT Logo kompiliert");
        assert!(pdf.starts_with(b"%PDF-"));
    }

    /// Auch SVG — Typst versteht es nativ, die Welt muss nur die Bytes
    /// liefern.
    #[test]
    fn ein_svg_logo_wird_eingebettet_und_die_rechnung_kompiliert() {
        let mut d = basis_rechnung();
        d.logo_bytes_base64 = Some(als_base64(TEST_SVG.as_bytes()));
        d.logo_format = Some("svg".into());
        let quelle = build_invoice_source(&d);
        assert!(quelle.contains("logo.svg"), "die Quelle verlangt das SVG");
        let dateien = logo_datei(&d).map(|x| vec![x]).unwrap_or_default();
        let pdf = compile_typst_to_pdf_mit_dateien(quelle, dateien)
            .expect("die Rechnung MIT SVG-Logo kompiliert");
        assert!(pdf.starts_with(b"%PDF-"));
    }

    /// Ein kaputtes Logo (kein base64) darf die Rechnung NIEMALS verhindern:
    /// die Quelle verlangt dann KEIN Bild — sonst scheitert Typst an einer
    /// Datei, die es nie geben wird, und der Kunde bekommt keine Rechnung.
    #[test]
    fn ein_kaputtes_logo_verhindert_die_rechnung_nicht() {
        let mut d = basis_rechnung();
        d.logo_bytes_base64 = Some("das-ist-kein-base64!!!".into());
        d.logo_format = Some("png".into());
        assert!(
            logo_datei(&d).is_none(),
            "kaputtes base64 liefert keine Datei"
        );
        let quelle = build_invoice_source(&d);
        assert!(
            !quelle.contains("image("),
            "die Quelle verlangt ein Bild, das nie ankommt"
        );
        // Und die Systemzeile bleibt auch dann stehen — sie haengt nicht am
        // Logo.
        assert!(quelle.contains("norns.de"), "die Systemzeile fehlt");
        let pdf = compile_typst_to_pdf(quelle).expect("die Rechnung kompiliert ohne Bild");
        assert!(pdf.starts_with(b"%PDF-"));
    }

    #[test]
    fn sweep_removes_stale_invoice_and_preview_temps_but_not_foreign_files() {
        let dir = std::env::temp_dir();
        // Unique suffix so a concurrent run of this test can't fight over names.
        let tag = uuid_like();
        let invoice = dir.join(format!("norns-rechnung-{tag}.pdf"));
        let preview = dir.join(format!("norns-vorschau-{tag}.pdf"));
        let foreign = dir.join(format!("fremdes-programm-keepme-{tag}.txt"));
        std::fs::write(&invoice, b"customer name + 25a data").unwrap();
        std::fs::write(&preview, b"customer name + 25a data").unwrap();
        std::fs::write(&foreign, b"not ours").unwrap();

        let removed = sweep_stale_pdf_temp_files();

        assert!(removed >= 2, "should remove at least our two temp PDFs");
        assert!(!invoice.exists(), "stale invoice PDF must be purged");
        assert!(!preview.exists(), "stale preview PDF must be purged");
        assert!(
            foreign.exists(),
            "a non-warehouse14 file must be left untouched"
        );
        let _ = std::fs::remove_file(&foreign);
    }
}

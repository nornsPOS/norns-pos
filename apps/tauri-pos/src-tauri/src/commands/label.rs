//! Epic B — product sticker label printing (ZPL + ESC/POS).
//!
//! Prints compact inventory stickers: a Code128 barcode carrying the SKU (for
//! scanner lookups — the SKU IS the barcode, so ONE label serves both storage
//! and the cashier sale) across the top, with human-readable SKU / name /
//! weight / karat / storage location below it.
//!
//! Symbology is Code128 emitted via the printer's NATIVE barcode command
//! (ZPL `^BC`, ESC/POS `GS k 73`) — the printer rasterises a crisp, scannable
//! barcode from the SKU string; we never hand-rasterise pixels. Code128 (vs a
//! QR) reads on the common 1D handheld laser scanners used at the till.
//!
//! Two transports, mirroring the receipt printer:
//!   • TCP 9100 (AppSocket / JetDirect) — stream bytes to a network label printer.
//!   • System queue — write a temp file and hand it to CUPS via
//!     `lpr -P <printer> -o raw <file>` (the `-o raw` keeps CUPS from trying to
//!     re-render our ZPL/ESC-POS as a document).
//!
//! Two dialects: ZPL (Zebra/compatible) and ESC/POS (Epson-style label mode).
//! `print_label` takes a batch so "Alle Etiketten drucken" is one IPC call.
//!
//! ── DER FUND (26.07.2026): EIN DRITTER WEG WAR NÖTIG ───────────────────────
//! An Basels Tresen hängt ein DYMO LabelWriter 450. Der versteht WEDER ZPL noch
//! ESC/POS — er hat überhaupt keine Textsprache, sondern nimmt nur fertige
//! Rasterzeilen, die sein Treiber erzeugt. Damit war er hier doppelt heimatlos:
//! er passte in keine der zwei Sprachen, und der einzige Transportweg schaltete
//! mit `-o raw` genau den Treiber ab, der ihn hätte bedienen können. Am Tresen
//! sah das so aus: „Etikett drucken" meldete Erfolg, der Auftrag lief durch die
//! Warteschlange, und aus dem Gerät kam nichts. Gedruckt werden konnte nur an
//! der Kasse vorbei, von Hand über CUPS.
//!
//! Deshalb gibt es jetzt einen dritten Weg, `Raster`: das Etikett wird als
//! SEITE in Etikettengrösse gebaut (PDF, über denselben Typst-Setzer wie die
//! Rechnung) und OHNE `-o raw` an die Warteschlange gegeben. Dann rendert der
//! Herstellertreiber, den CUPS ohnehin mitbringt — und genau das ist bei einem
//! Rasterdrucker der EINZIGE Weg zum Gerät.
//!
//! Der Bauplan der Seite wird NICHT hier erfunden. Er kommt fertig aus
//! `src/lib/etikett-layout.ts` — feste Zonen, geprüfte Balkenbreiten, QR-Gitter,
//! Kollisionsschutz — und besteht nur aus Rechtecken und Texten in Millimetern.
//! Diese Datei setzt ihn, sie rechnet ihn nicht.

use serde::Deserialize;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};

use crate::config::{self, DEFAULT_TCP_TIMEOUT_MS};
use crate::error::{HardwareError, HwResult};
use crate::mock::printer_mock;

/// One product's sticker payload.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelData {
    pub sku: String,
    pub product_name: String,
    /// Decimal grams as a string (e.g. "14.5000"); None when not a metal item.
    pub weight_grams: Option<String>,
    /// Karat or fineness, e.g. "750" or "18K".
    pub karat: Option<String>,
    /// Lagerort coordinates, e.g. "Tresor-1 / Fach-3".
    pub storage_location: Option<String>,
    /// Der fertig gerechnete Bauplan aus `etikett-layout.ts`.
    ///
    /// Nur der Rasterweg braucht ihn; ZPL und ESC/POS lassen den Drucker selbst
    /// setzen und schicken ihn deshalb gar nicht erst mit. Fehlt er auf dem
    /// Rasterweg, wird das gesagt und NICHT ersatzweise etwas anderes gedruckt.
    #[serde(default)]
    pub plan: Option<EtikettPlan>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum LabelPrinterType {
    Zpl,
    Escpos,
    /// Ein Drucker OHNE eigene Sprache: DYMO, Seiko SLP, Brother QL.
    ///
    /// Er bekommt keine Steuerbytes, sondern eine fertige Seite in
    /// Etikettengrösse, und die Warteschlange rendert sie mit dem
    /// Herstellertreiber.
    Raster,
}

// ────────────────────────────────────────────────────────────────────────
// Der Bauplan, wie er aus `etikett-layout.ts` herüberkommt
//
// Bewusst STUMPF: reine Rechtecke und Texte in Millimetern, ohne jede Rechnung.
// Alles Kluge — Balkenbreiten, QR-Gitter, Zonen, Kollisionsschutz — ist dort
// schon geschehen und dort auch geprüft. Zwei Orte, die dasselbe Etikett
// rechnen, driften auseinander; einer, der rechnet, und einer, der setzt,
// nicht.
// ────────────────────────────────────────────────────────────────────────

/// Die Masse des Etiketts in Millimetern.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EtikettMasse {
    pub breite_mm: f64,
    pub hoehe_mm: f64,
}

/// Voll oder zurückhaltend. Auf einem Etikettendrucker gibt es nur schwarz oder
/// nichts, deshalb wird „blass" zu einem Grau, das der Treiber rastert.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Ton {
    Tinte,
    Blass,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Schrift {
    Mono,
    Sans,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Anker {
    Links,
    Rechts,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "art", rename_all = "lowercase")]
pub enum Primitiv {
    #[serde(rename_all = "camelCase")]
    Rechteck {
        x: f64,
        y: f64,
        breite: f64,
        hoehe: f64,
        ton: Ton,
    },
    #[serde(rename_all = "camelCase")]
    Text {
        x: f64,
        /// Die GRUNDLINIE, nicht die Oberkante.
        y: f64,
        text: String,
        /// Die Versalhöhe, nicht der Schriftgrad.
        hoehe_mm: f64,
        schrift: Schrift,
        fett: bool,
        anker: Anker,
        #[serde(default)]
        sperrung: Option<f64>,
        ton: Ton,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EtikettPlan {
    pub masse: EtikettMasse,
    pub primitive: Vec<Primitiv>,
    /// Die schmalste Linie des Strichcodes, wie der Bauplan sie gewählt hat.
    ///
    /// Wird gebraucht, um zu prüfen, ob der Code nach dem Einpassen in die
    /// bedruckbare Fläche noch scannbar ist. Fehlt sie, wird nicht geprüft —
    /// dann wurde sie eben nicht mitgeschickt, und eine erfundene Zahl wäre
    /// schlimmer als keine.
    #[serde(default)]
    pub modulbreite_mm: Option<f64>,
}

/// Printer configuration sent from the hardware store.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelConfig {
    /// "tcp" | "system".
    pub mode: String,
    pub ip: Option<String>,
    pub port: Option<u16>,
    pub printer_name: Option<String>,
    pub printer_type: LabelPrinterType,
}

/// One-tap reachability probe for the label printer — NO bytes sent, so it
/// never feeds a sticker. In `tcp` mode this opens a socket to `ip:port`; in
/// `system` mode it confirms the chosen CUPS queue still exists in
/// `lpstat -p`. Drives the green/red badge + the app-start auto-connect sweep.
///
/// Returns `Ok(true)` when reachable, `Ok(false)` when not — an offline printer
/// is a normal state, not a hard error. A missing config (no IP / no queue
/// name) is a real `NotConfigured` error so the UI can prompt for setup.
#[tauri::command]
pub async fn label_check_connection(config: LabelConfig) -> HwResult<bool> {
    if config::is_mock_mode() {
        return printer_mock::check_label(&config).await;
    }
    match config.mode.as_str() {
        "tcp" => {
            let ip = config
                .ip
                .ok_or_else(|| HardwareError::NotConfigured("label printer IP not set".into()))?;
            let port = config.port.unwrap_or(9100);
            Ok(crate::commands::thermal::probe_tcp(&ip, port).await)
        }
        "system" => {
            let printer = config
                .printer_name
                .ok_or_else(|| HardwareError::NotConfigured("label printer name not set".into()))?;
            Ok(system_queue_exists(&printer).await)
        }
        other => Err(HardwareError::InvalidArgument(format!(
            "unknown label printer mode: {other}"
        ))),
    }
}

/// Ob es eine Warteschlange dieses Namens gibt. Prueft, OHNE Papier zu ziehen.
///
/// ── ⛔ DER BEFUND VOM 12.08.2026 ────────────────────────────────────────
///
/// Hier stand EINE Fassung ohne Plattformweiche, und sie startete `lpstat`.
/// Windows hat kein `lpstat`, der Start ist dort immer `Err`, und der Zweig
/// darunter lautete `return false`. Auf der Plattform des ersten Kunden war
/// die Antwort damit IMMER „nicht erreichbar" — egal wie sauber der
/// Etikettendrucker eingerichtet war.
///
/// Der Haendler steckt den Drucker an, findet ihn in der Liste, uebernimmt
/// ihn, liest „Jetzt einmal Verbindung pruefen", tut genau das, und die Kasse
/// sagt nein. Aus seiner Sicht funktioniert die Erkennung nicht.
///
/// ⚠️ HAUSKLASSE „DER HALBE FIX AN DERSELBEN AMPEL": der BONdrucker hat diese
/// Weiche laengst (`thermal.rs`, `#[cfg(not(target_os = "windows"))]` gegen
/// `#[cfg(target_os = "windows")]` mit `win_print::queue_exists`), und
/// `warteschlangenlage.rs` ebenfalls. Nur dieser eine Weg hatte sie nicht.
#[cfg(not(target_os = "windows"))]
async fn system_queue_exists(printer_name: &str) -> bool {
    let output = tokio::process::Command::new("lpstat")
        .arg("-p")
        .output()
        .await;
    let stdout = match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        Err(_) => return false,
    };
    stdout
        .lines()
        .filter_map(|l| l.strip_prefix("printer "))
        .filter_map(|rest| rest.split_whitespace().next())
        .any(|name| name == printer_name)
}

#[cfg(target_os = "windows")]
async fn system_queue_exists(printer_name: &str) -> bool {
    let name = printer_name.to_string();
    tokio::task::spawn_blocking(move || crate::commands::win_print::queue_exists(&name))
        .await
        .unwrap_or(false)
}

/// Print a batch of labels. Returns the number of labels dispatched.
#[tauri::command]
pub async fn print_label(
    config: LabelConfig,
    labels: Vec<LabelData>,
    app_handle: tauri::AppHandle,
) -> HwResult<u32> {
    if labels.is_empty() {
        return Err(HardwareError::InvalidArgument("no labels to print".into()));
    }

    // Die bedruckbare Fläche gehört zur WARTESCHLANGE, nicht zum Bauplan —
    // deshalb wird der Treiber gefragt, BEVOR gesetzt wird. Im Testbetrieb
    // wird nichts vom System gelesen; dort gibt es keinen Treiber, den man
    // fragen könnte, und eine erfundene Fläche wäre eine Lüge über das Gerät.
    let flaeche = match (&config.printer_type, config.mode.as_str()) {
        (LabelPrinterType::Raster, "system") if !config::is_mock_mode() => config
            .printer_name
            .as_deref()
            .and_then(ppd_der_warteschlange)
            .as_deref()
            .and_then(ppd_bedruckbar),
        _ => None,
    };

    let auftrag = match config.printer_type {
        LabelPrinterType::Zpl => Auftrag::Roh(build_zpl(&labels)),
        LabelPrinterType::Escpos => Auftrag::Roh(build_escpos(&labels)),
        LabelPrinterType::Raster => Auftrag::Seite(
            baue_rasterdokument(&labels, flaeche.as_ref()).map_err(HardwareError::Encoding)?,
        ),
    };

    if config::is_mock_mode() {
        printer_mock::print_label(&config, labels.len(), auftrag.bytes()).await?;
        return Ok(labels.len() as u32);
    }

    match (config.mode.as_str(), &auftrag) {
        ("tcp", Auftrag::Roh(bytes)) => {
            let ip = config
                .ip
                .ok_or_else(|| HardwareError::NotConfigured("label printer IP not set".into()))?;
            let port = config.port.unwrap_or(9100);
            send_tcp(&ip, port, bytes).await?;
        }
        // Ein Rasterdrucker hat keinen Anschluss 9100, an dem er ein Dokument
        // annähme. Es gibt am Netzwerkweg auch niemanden, der es rendern würde:
        // rendern tut die Warteschlange, und die gibt es nur am Systemweg.
        ("tcp", Auftrag::Seite(_)) => {
            return Err(HardwareError::InvalidArgument(
                "Ein Rasterdrucker wird über die Warteschlange des Betriebssystems bedient, nicht über das Netzwerk. Bitte in den Geräten „System\u{201c} wählen.".into(),
            ));
        }
        ("system", Auftrag::Roh(bytes)) => {
            let printer = config
                .printer_name
                .ok_or_else(|| HardwareError::NotConfigured("label printer name not set".into()))?;
            send_system(&printer, bytes).await?;
        }
        ("system", Auftrag::Seite(bytes)) => {
            let printer = config
                .printer_name
                .ok_or_else(|| HardwareError::NotConfigured("label printer name not set".into()))?;
            // Das GEWÄHLTE Format, wie es im Wähler steht — nicht die
            // Vorgabe des Treibers. Alle Etiketten eines Auftrags teilen
            // denselben Bauplan; der erste trägt ihn für alle.
            let format = labels
                .first()
                .and_then(|l| l.plan.as_ref())
                .map(|p| (p.masse.breite_mm, p.masse.hoehe_mm));

            /*
             * ── WINDOWS DRUCKT SEIT DEM 18.08.2026 DIREKT ────────────────
             *
             * Basels Foto von diesem Tag: „Etikett drucken" oeffnete einen
             * Browser-Reiter mit dem PDF, und der Haendler suchte den
             * Druckknopf des Betrachters. Jetzt wird dieselbe Typst-Quelle
             * in der DPI des Treibers gerastert und ueber GDI direkt an die
             * Warteschlange gegeben — kein Betrachter, kein Umweg.
             *
             * Scheitert der Direktweg (exotischer Treiber), faellt der Weg
             * unten auf den Betrachter zurueck und SAGT beides: warum der
             * Direktdruck scheiterte und wo das Dokument jetzt liegt.
             */
            #[cfg(windows)]
            {
                let quelle = raster_quelle(&labels, flaeche.as_ref())
                    .map_err(HardwareError::Encoding)?;
                let drucker = printer.clone();
                let direkt = tokio::task::spawn_blocking(move || -> Result<(), String> {
                    let (dpi_x, _) = crate::commands::win_print::drucker_dpi(&drucker);
                    let seiten =
                        crate::commands::pdf::compile_typst_zu_seiten(quelle, Vec::new(), dpi_x)?;
                    crate::commands::win_print::print_raster_seiten(
                        &drucker,
                        "Norns Etikett",
                        &seiten,
                        format,
                    )
                })
                .await
                .map_err(|e| HardwareError::Internal(format!("Druckauftrag abgebrochen: {e}")))?;
                match direkt {
                    Ok(()) => return Ok(labels.len() as u32),
                    Err(grund) => {
                        // Der Betrachter als letzter Ausweg — mit BEIDEN Saetzen.
                        let ergebnis =
                            send_system_document(&printer, bytes, format, &app_handle).await;
                        return match ergebnis {
                            Err(HardwareError::NotConfigured(satz)) => {
                                Err(HardwareError::NotConfigured(format!(
                                    "Direktdruck fehlgeschlagen ({grund}). {satz}"
                                )))
                            }
                            sonst => sonst.map(|_| labels.len() as u32),
                        };
                    }
                }
            }

            #[cfg(not(windows))]
            send_system_document(&printer, bytes, format, &app_handle).await?;
        }
        (other, _) => {
            return Err(HardwareError::InvalidArgument(format!(
                "unknown label printer mode: {other}"
            )));
        }
    }

    Ok(labels.len() as u32)
}

/// Was am Ende in die Warteschlange geht — und ob CUPS es anfassen darf.
///
/// Diese Unterscheidung ist der ganze Fund. Rohe Steuerbytes MÜSSEN unberührt
/// durchgereicht werden, ein Dokument MUSS gerendert werden. Beides über
/// denselben Aufruf zu schicken, hiess bisher: der eine funktioniert, der
/// andere schweigt.
enum Auftrag {
    /// ZPL oder ESC/POS. Der Drucker setzt selbst; CUPS hält sich heraus.
    Roh(Vec<u8>),
    /// Eine fertige Seite in Etikettengrösse. Der Herstellertreiber rastert sie.
    Seite(Vec<u8>),
}

impl Auftrag {
    fn bytes(&self) -> &[u8] {
        match self {
            Auftrag::Roh(b) | Auftrag::Seite(b) => b,
        }
    }
}

// ────────────────────────────────────────────────────────────────────────
// Transports
// ────────────────────────────────────────────────────────────────────────

async fn send_tcp(ip: &str, port: u16, bytes: &[u8]) -> HwResult<()> {
    let addr = format!("{ip}:{port}");
    let mut stream = timeout(
        Duration::from_millis(DEFAULT_TCP_TIMEOUT_MS),
        TcpStream::connect(&addr),
    )
    .await
    .map_err(HardwareError::from)??;
    stream.write_all(bytes).await?;
    stream.flush().await?;
    Ok(())
}

/// Die Argumente für `lpr` — und die eine Zeile, an der es hing.
///
/// ── DER FUND ───────────────────────────────────────────────────────────────
/// `-o raw` heisst: CUPS reicht die Bytes unverändert durch und ruft KEINEN
/// Filter auf. Für ZPL und ESC/POS ist das genau richtig, denn dort setzt der
/// Drucker selbst. Für einen DYMO ist es tödlich: er versteht keine Steuerbytes,
/// und der Filter, der aus einer Seite seine Rasterzeilen macht, wird durch
/// `-o raw` gerade abgeschaltet. Der Auftrag lief sauber durch, das Gerät blieb
/// stumm — am Tresen sah das nach „Drucker kaputt" aus, war aber diese Zeile.
///
/// `fit-to-page` steht beim Seitenweg dabei, weil gemessen: der Treiber
/// `drv:///sample.drv/dymo.ppd` gibt für das Adressetikett w81h252 als
/// bedruckbare Fläche nur 77 × 222,2 Punkt frei, während das Papier 81 × 252
/// Punkt misst. Ohne diese Angabe schnitte der Treiber gut fünf Millimeter an
/// jedem Ende ab — und dort sitzt auf dem Bauplan der QR.
///
/// ── DER ZWEITE FUND: DIE GRÖSSE FUHR NIE MIT (30.07.2026, Basels Befund) ────
/// Der Seitenweg nannte der Warteschlange NUR `fit-to-page`, nie ein Format.
/// CUPS nimmt dann das VOREINGESTELLTE Etikett des Treibers, und `fit-to-page`
/// zieht unsere millimetergenau gesetzte Seite darauf gross oder klein. Wer im
/// Wähler „Regaletikett 28,6 × 88,9" wählte und im Treiber steht das
/// Adressetikett, bekam ein verzerrtes Etikett auf falschem Papier — und
/// niemand konnte sehen, woran es lag, denn der Auftrag lief ja durch.
/// Jetzt reist das gewählte Format als `media=Custom.BxHmm` mit; das versteht
/// CUPS bei jedem Treiber, auch ohne passenden PPD-Namen.
fn lpr_argumente(
    printer_name: &str,
    pfad: &str,
    roh: bool,
    format_mm: Option<(f64, f64)>,
) -> Vec<String> {
    let mut args = vec!["-P".to_string(), printer_name.to_string()];
    if roh {
        args.push("-o".to_string());
        args.push("raw".to_string());
    } else {
        if let Some((breite, hoehe)) = format_mm {
            args.push("-o".to_string());
            args.push(format!("media=Custom.{:.1}x{:.1}mm", breite, hoehe));
        }
        args.push("-o".to_string());
        args.push("fit-to-page".to_string());
    }
    args.push(pfad.to_string());
    args
}

/// Der einzige Ort im Haus, an dem `lpr` gestartet wird — und deshalb der
/// einzige Ort, an dem die Warteschlange geprüft werden muss.
///
/// ⚠️ Die Prüfung stand zuerst in den beiden AUFRUFERN. Der Wächter
/// `kein_weg_ohne_pruefung` hat das zu Recht rot gemacht: ein künftiger
/// dritter Aufrufer hätte sie vergessen können, und niemand hätte es bemerkt,
/// weil der Druck ja „gelingt". Hier kann man sie nicht umgehen.
async fn lpr_ausfuehren(printer_name: &str, args: Vec<String>) -> HwResult<()> {
    crate::commands::warteschlangenlage::vor_dem_senden_pruefen(printer_name).await?;

    let status = tokio::process::Command::new("lpr")
        .args(&args)
        .status()
        .await
        .map_err(HardwareError::from)?;
    if !status.success() {
        return Err(HardwareError::Device(format!(
            "lpr exited with {:?}",
            status.code()
        )));
    }
    Ok(())
}

async fn send_system(printer_name: &str, bytes: &[u8]) -> HwResult<()> {
    // ⚠️ 02.08.2026: hier stand nur der CUPS-Weg. Auf Windows gibt es kein
    // `lpr`; der Aufruf scheiterte an einem fehlenden PROGRAMM, wurde zu
    // `LocalIo`, und der Händler las „bitte Speicherplatz prüfen". Der
    // Bondrucker sprach auf Windows längst mit dem Spooler (`thermal.rs`).
    // Die Entscheidung liegt in `druckweg.rs` und ist dort geprüft.
    match crate::commands::druckweg::druckweg_fuer(
        crate::commands::druckweg::Druckgut::Steuerbytes,
        cfg!(windows),
    ) {
        crate::commands::druckweg::Druckweg::WindowsRoh => {
            #[cfg(windows)]
            {
                let name = printer_name.to_string();
                let daten = bytes.to_vec();
                return tokio::task::spawn_blocking(move || {
                    crate::commands::win_print::print_raw(&name, &daten)
                })
                .await
                .map_err(|e| HardwareError::Internal(format!("spooler task join failed: {e}")))?
                .map_err(HardwareError::Device);
            }
            #[cfg(not(windows))]
            unreachable!("WindowsRoh kann ausserhalb von Windows nicht gewählt werden")
        }
        crate::commands::druckweg::Druckweg::WindowsSeiteUeberBetrachter => {
            unreachable!("Steuerbytes sind keine Seite")
        }
        crate::commands::druckweg::Druckweg::Cups => {}
    }

    // CUPS reads from a path; `-o raw` stops it re-rendering our control bytes.
    let tmp = std::env::temp_dir().join(format!("norns-etikett-{}.bin", uuid::Uuid::new_v4()));
    std::fs::write(&tmp, bytes).map_err(HardwareError::from)?;

    let ergebnis = lpr_ausfuehren(
        printer_name,
        lpr_argumente(printer_name, &tmp.to_string_lossy(), true, None),
    )
    .await;

    let _ = std::fs::remove_file(&tmp);
    ergebnis
}

/// Der Seitenweg: dasselbe `lpr`, aber OHNE `-o raw`, damit der
/// Herstellertreiber die Seite rastert. Die Datei trägt `.pdf`, damit CUPS den
/// Typ nicht raten muss.
async fn send_system_document(
    printer_name: &str,
    pdf: &[u8],
    format_mm: Option<(f64, f64)>,
    app_handle: &tauri::AppHandle,
) -> HwResult<()> {
    /*
     * ── ⛔ DER BEFUND VOM 12.08.2026: DER SATZ WAR UNWAHR ──────────────────
     *
     * Auf Windows führt für eine SEITE kein roher Weg zum Papier: der Spooler
     * gäbe die PDF-Bytes unverändert weiter, und heraus käme Quelltext. So
     * weit stimmt es, und deshalb steht hier ein eigener Zweig.
     *
     * Was NICHT stimmte: der Zweig warf nur den Satz `SEITE_IM_BETRACHTER`,
     * und der beginnt wörtlich mit „Das Dokument wurde im Betrachter dieses
     * Rechners geöffnet." Es wurde NICHTS geöffnet. Das fertig gesetzte PDF
     * war eine Zeile vorher gebaut worden und wurde hier weggeworfen.
     *
     * Für den Händler heisst das: er drückt auf einem DYMO am Windows-Rechner
     * „Etikett drucken", liest, das Dokument sei geöffnet worden, sucht es
     * auf seinem Bildschirm und findet nichts. Auf dem Papier steht nie
     * etwas. Hausklasse „Ein Kommentar ist kein Riegel", hier sogar schärfer:
     * die MELDUNG behauptete eine Handlung, die nicht stattfand.
     *
     * Jetzt findet die Handlung statt. Der Satz bleibt ein Fehler und nicht
     * ein Erfolg — die Kasse hat das Etikett nicht gedruckt, der Mensch muss
     * im Betrachter auf Drucken gehen. Aber er findet jetzt, was der Satz ihm
     * verspricht.
     */
    if cfg!(windows) {
        let tmp =
            std::env::temp_dir().join(format!("norns-etikett-{}.pdf", uuid::Uuid::new_v4()));
        std::fs::write(&tmp, pdf).map_err(HardwareError::from)?;
        #[allow(deprecated)]
        {
            use tauri_plugin_shell::ShellExt;
            app_handle
                .shell()
                .open(tmp.to_string_lossy().into_owned(), None)
                .map_err(|e| {
                    HardwareError::Internal(format!(
                        "Das Etikett konnte nicht im Betrachter geöffnet werden: {e}"
                    ))
                })?;
        }
        // Dieselbe Aufräumfrist wie bei `open_pdf_preview`: der Betrachter hat
        // die Datei längst geladen, und auf einem Etikett steht ein Preis.
        let weg = tmp.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(300)).await;
            let _ = std::fs::remove_file(&weg);
        });
        return Err(HardwareError::NotConfigured(
            crate::commands::druckweg::SEITE_IM_BETRACHTER.to_string(),
        ));
    }

    let tmp = std::env::temp_dir().join(format!("norns-etikett-{}.pdf", uuid::Uuid::new_v4()));
    std::fs::write(&tmp, pdf).map_err(HardwareError::from)?;

    let ergebnis = lpr_ausfuehren(
        printer_name,
        lpr_argumente(printer_name, &tmp.to_string_lossy(), false, format_mm),
    )
    .await;

    let _ = std::fs::remove_file(&tmp);
    ergebnis
}

// ────────────────────────────────────────────────────────────────────────
// ZPL builder (Zebra)
// ────────────────────────────────────────────────────────────────────────

/// `^` and `~` are ZPL control prefixes — strip them from user data.
fn zpl_sanitize(s: &str) -> String {
    s.replace(['^', '~'], " ")
}

fn build_zpl(labels: &[LabelData]) -> Vec<u8> {
    let mut out = String::with_capacity(labels.len() * 320);
    for label in labels {
        let sku = zpl_sanitize(&label.sku);
        // ZPL steht auf `^CI28`: „…" ist dort ein einziges Zeichen.
        let name = zpl_sanitize(&truncate(&label.product_name, 24, 1));
        let weight = label.weight_grams.as_deref().unwrap_or("-");
        let karat = label.karat.as_deref().unwrap_or("-");
        let location = zpl_sanitize(label.storage_location.as_deref().unwrap_or("-"));

        // ~50 mm x ~40 mm sticker at 8 dots/mm. Code128 barcode of the SKU
        // across the top, human-readable rows beneath.
        out.push_str("^XA\n");
        out.push_str("^CI28\n"); // UTF-8 input
                                 // Code128 of the SKU. `^BY2,3,70` = module 2 dots, wide/narrow 3, height
                                 // 70. `^BCN,70,N,N,N` = Normal orientation, height 70, no interpretation
                                 // line (we print the SKU ourselves below), no line above, no UCC check.
                                 // ZPL auto-selects the Code128 subset for the data.
        out.push_str("^BY2,3,70\n");
        out.push_str(&format!("^FO20,20^BCN,70,N,N,N^FD{sku}^FS\n"));
        // Human-readable rows.
        out.push_str(&format!("^FO20,110^A0N,30,30^FD{sku}^FS\n"));
        out.push_str(&format!("^FO20,148^A0N,26,26^FD{name}^FS\n"));
        out.push_str(&format!("^FO20,180^A0N,24,24^FD{weight} g · {karat}^FS\n"));
        out.push_str(&format!("^FO20,210^A0N,22,22^FDLager: {location}^FS\n"));
        out.push_str("^XZ\n");
    }
    out.into_bytes()
}

// ────────────────────────────────────────────────────────────────────────
// ESC/POS builder (Epson-style label mode) — feeds lines, never full-cuts.
// ────────────────────────────────────────────────────────────────────────

const ESC: u8 = 0x1B;
const GS: u8 = 0x1D;

fn build_escpos(labels: &[LabelData]) -> Vec<u8> {
    let mut b = Vec::with_capacity(labels.len() * 256);
    b.extend_from_slice(&[ESC, b'@']); // init
    b.extend_from_slice(&[ESC, b't', 19]); // PC858 (Euro + umlauts)

    for label in labels {
        // Code128 (SKU) centred, then left-aligned text rows.
        b.extend_from_slice(&[ESC, b'a', 1]); // center
        code128(&mut b, &label.sku);
        b.extend_from_slice(&[ESC, b'a', 0]); // left

        b.extend_from_slice(&[ESC, b'E', 1]); // bold on
        text_line(&mut b, &label.sku);
        b.extend_from_slice(&[ESC, b'E', 0]); // bold off
                                              // ESC/POS steht auf PC858: „…" wird dort zu DREI Bytes, also kostet die
                                              // Marke hier drei Spalten. Stand hier `1`, ging ein auf 32 Spalten
                                              // gekuerzter Name als 34 Bytes zum Drucker; der brach stumm um, und
                                              // die Zeile mit Gewicht und Karat rutschte hinterher.
                                              //
                                              // ⚠️ Der Kommentar darueber nannte diese Folge schon und verhinderte
                                              // sie nicht — ein Kommentar ist kein Riegel. Die Zahl steht jetzt im
                                              // Aufruf, und `ein_gekuerzter_name_bleibt_auch_als_bytes_in_der_spur`
                                              // misst den ECHTEN Bytestrom dagegen.
        text_line(&mut b, &truncate(&label.product_name, 32, 3));

        let weight = label.weight_grams.as_deref().unwrap_or("-");
        let karat = label.karat.as_deref().unwrap_or("-");
        text_line(&mut b, &format!("{weight} g  ·  {karat}"));
        text_line(
            &mut b,
            &format!(
                "Lager: {}",
                label.storage_location.as_deref().unwrap_or("-")
            ),
        );

        // Feed past the label gap — NO cut (sticker rolls aren't cut per label).
        b.extend_from_slice(&[ESC, b'd', 4]);
    }
    b
}

fn text_line(out: &mut Vec<u8>, s: &str) {
    // ⚠️ 08.08.2026, DER HALBE FIX AN DERSELBEN AMPEL: hier stand
    // `s.as_bytes()`, also rohes UTF-8 — an einen Drucker, den Zeile 547
    // per `ESC t 19` gerade auf PC858 gestellt hat. Jeder Umlaut kam als
    // zwei Zeichen Unsinn heraus, und das Trennzeichen in Zeile 562 ist
    // fest im Code ein U+00B7, also war JEDES Etikett betroffen, auch ohne
    // Umlaut im Produktnamen.
    //
    // In `thermal.rs` war derselbe Fehler laengst behoben. Hier wird
    // DIESELBE Tabelle benutzt, keine zweite gebaut: zwei Tabellen wären
    // zwei Wahrheiten, und die nächste Korrektur landete wieder nur an
    // einer der beiden Ampeln.
    out.extend_from_slice(&crate::commands::thermal::encode_pc858(s));
    out.push(b'\n');
}

/// Code128 of the SKU via the ESC/POS `GS k 73` barcode command. The printer
/// rasterises the barcode from the SKU string — we never draw pixels.
///
/// Format: `GS h n` (height), `GS w n` (module width), `GS H 0` (no
/// human-readable interpretation line — we print the SKU text ourselves), then
/// `GS k 73 n d1..dn` where the data begins with the `{B` code-set-B selector
/// (covers the ASCII A–Z / 0–9 / '-' a SKU uses). A literal `{` in the payload
/// must be doubled per the ESC/POS Code128 data rules.
fn code128(out: &mut Vec<u8>, payload: &str) {
    let escaped = payload.replace('{', "{{");
    let mut data = Vec::with_capacity(escaped.len() + 2);
    data.extend_from_slice(b"{B"); // select Code128 subset B
    data.extend_from_slice(escaped.as_bytes());
    // Guard the GS k length byte (u8) — SKUs are short; truncate hostile input.
    let n = data.len().min(255) as u8;

    out.extend_from_slice(&[GS, b'h', 80]); // barcode height (dots)
    out.extend_from_slice(&[GS, b'w', 2]); // module width
    out.extend_from_slice(&[GS, b'H', 0]); // HRI: none
    out.extend_from_slice(&[GS, b'k', 73, n]); // CODE128, n data bytes follow
    out.extend_from_slice(&data[..n as usize]);
    out.push(b'\n');
}

// ────────────────────────────────────────────────────────────────────────
// Rasterweg — das Etikett als SEITE, gesetzt mit demselben Setzer wie die
// Rechnung (Typst, in Rust, ohne fremdes Programm).
// ────────────────────────────────────────────────────────────────────────

/// Voll deckendes Schwarz. Die Balken des Strichcodes dürfen nichts anderes sein.
const TINTE: &str = "#000000";
/// Das zurückhaltende Grau. Ein Etikettendrucker kennt nur Punkt oder kein
/// Punkt, also rastert der Treiber das zu einem feinen Muster — gewollt, denn
/// so bleibt die Rangfolge des Bauplans auch auf Thermopapier sichtbar.
const BLASS: &str = "#595959";

/// Versalhöhe je Geviert der beiden Schriften, die mitgeliefert werden.
///
/// ── WARUM ZWEI VERSCHIEDENE ZAHLEN, UND WARUM NICHT DIE AUS DEM BAUPLAN ────
/// Der Bauplan rechnet die BREITE eines Textes mit eigenen Verhältniszahlen
/// (mono 0,562 / sans 0,717). Das sind Schätzwerte für die Kollisionsprüfung,
/// keine Angaben über die Schriften, die hier wirklich gesetzt werden.
///
/// Gemessen an den mitgelieferten Schriftdateien:
///   • DejaVu Sans Mono: Versalhöhe 1493/2048 = 0,729, Vorschub 0,6021 Geviert.
///     Mit der Zahl 0,562 aus dem Bauplan käme die Artikelnummer rund 30 %
///     ZU HOCH heraus und stiesse von unten in den Strichcode. Deshalb hier die
///     gemessene Zahl: die Versalhöhe stimmt dann auf den Millimeter, und die
///     Zeile wird schmaler als geplant — die unschädliche Richtung.
///   • Linux Libertine (die Ersatzschrift für „sans", eine Grotesk liegt dem
///     Setzer nicht bei): gemessene Versalhöhe 1348/2048 = 0,658. Hier wird
///     BEWUSST die Zahl des Bauplans genommen und nicht die gemessene, weil
///     0,717 den kleineren Schriftgrad ergibt. Der Text wird damit rund 8 %
///     niedriger als geplant — dafür kann er die Zone, in der ihn der Bauplan
///     eingepasst hat, nicht überlaufen. Auf Papier ist eine Überschneidung
///     nicht mehr zu heilen, ein Achtel Millimeter weniger Höhe schon.
const VERSAL_MONO: f64 = 0.729;
const VERSAL_SANS: f64 = 0.717;

/// Um wie viel die quer stehende Seite gedreht wird.
///
/// Etikettenrollen laufen mit der KURZEN Kante quer zum Druckkopf: beim DYMO
/// misst die Seite 28,6 mm in der Breite und 88,9 mm in der Länge, gelesen wird
/// das Etikett aber der Länge nach. Der Bauplan kommt deshalb quer und wird
/// hier auf die Rolle gedreht.
///
/// Ob 90 oder 270 Grad richtig ist, entscheidet die Laufrichtung des Geräts —
/// beide ergeben ein lesbares Etikett, eines davon steht auf dem Kopf. Das
/// klärt ein einziger echter Druck; diese Zahl ist die einzige Stelle, an der
/// es dann zu ändern wäre.
const DREHUNG_GRAD: f64 = 90.0;

/// Die schmalste Linie, die ein Handscanner am Tresen noch sicher liest.
///
/// Dieselbe Zahl wie `SCHMALSTE_LINIE_MM` in `etikett-layout.ts`, und aus
/// demselben Grund: drei Druckpunkte bei 300 dpi. Sie steht hier ein zweites
/// Mal, weil erst NACH dem Einpassen in die bedruckbare Fläche feststeht, wie
/// breit die Linien wirklich werden.
const SCHMALSTE_LINIE_MM: f64 = 0.254;

fn mm(wert: f64) -> String {
    format!("{wert:.3}mm")
}

fn pt_zu_mm(pt: f64) -> f64 {
    pt * 25.4 / 72.0
}

/// Was eine Warteschlange wirklich bedrucken kann — in Millimetern.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bedruckbar {
    pub papier_breite: f64,
    pub papier_hoehe: f64,
    /// Die bedruckbare Fläche, von der linken oberen Ecke des Papiers gerechnet.
    pub feld_x: f64,
    pub feld_y: f64,
    pub feld_breite: f64,
    pub feld_hoehe: f64,
}

/// Aus der Treiberbeschreibung lesen, was der Drucker WIRKLICH aufs Papier bringt.
///
/// ── DER ZWEITE FUND, GEMESSEN STATT VERMUTET (26.07.2026) ──────────────────
/// Das erste Etikett aus dem neuen Weg lief sauber durch die ganze Filterkette
/// — und kam beschnitten heraus. Nachgemessen an dem, was der Treiber
/// tatsächlich rastert: 321 × 926 Punkte bei 300 dpi, also 27,2 × 78,4 mm,
/// während das Papier 28,6 × 88,9 mm misst. Es fehlten gut fünf Millimeter an
/// jedem Ende. Auf dem Muster war das der abgeschnittene erste Buchstabe von
/// „WAREHOUSE" und der halbe QR.
///
/// Der Treiber sagt das vorher, man muss ihn nur fragen: `*ImageableArea` nennt
/// die bedruckbare Fläche, `*PaperDimension` das Papier. `-o fit-to-page`
/// genügt NICHT — gemessen, der Setzer skalierte auf 0,999 und schnitt trotzdem.
/// Deshalb wird der Bauplan hier selbst in die Fläche eingepasst, mittig, ohne
/// je vergrössert zu werden.
///
/// Wird nichts gefunden, wird nichts angenommen: dann bleibt es bei der Seite in
/// Etikettengrösse. Lieber der bekannte Stand als eine erfundene Zahl.
pub fn ppd_bedruckbar(ppd: &str) -> Option<Bedruckbar> {
    let name = ppd
        .lines()
        .find_map(|z| z.strip_prefix("*DefaultPageSize:"))?
        .trim()
        .trim_matches('"')
        .to_string();

    // Die Zeilen lauten `*PaperDimension w81h252/Address: "81 252"` — der Name
    // steht vor dem Schrägstrich, die Zahlen in den Anführungszeichen.
    let zahlen = |schluessel: &str| -> Option<Vec<f64>> {
        ppd.lines()
            .filter_map(|z| z.strip_prefix(schluessel))
            .find(|rest| {
                let r = rest.trim_start();
                r.strip_prefix(&name)
                    .is_some_and(|n| n.starts_with('/') || n.starts_with(':'))
            })
            .and_then(|rest| rest.split('"').nth(1))
            .map(|werte| {
                werte
                    .split_whitespace()
                    .filter_map(|w| w.parse::<f64>().ok())
                    .collect()
            })
    };

    let papier = zahlen("*PaperDimension ")?;
    let feld = zahlen("*ImageableArea ")?;
    if papier.len() < 2 || feld.len() < 4 {
        return None;
    }
    let (pb, ph) = (pt_zu_mm(papier[0]), pt_zu_mm(papier[1]));
    let (links, unten, rechts, oben) = (
        pt_zu_mm(feld[0]),
        pt_zu_mm(feld[1]),
        pt_zu_mm(feld[2]),
        pt_zu_mm(feld[3]),
    );
    if rechts <= links || oben <= unten {
        return None;
    }
    Some(Bedruckbar {
        papier_breite: pb,
        papier_hoehe: ph,
        feld_x: links,
        // Die Treiberbeschreibung rechnet von UNTEN, gesetzt wird von OBEN.
        feld_y: ph - oben,
        feld_breite: rechts - links,
        feld_hoehe: oben - unten,
    })
}

/// Die Treiberbeschreibung der Warteschlange, wenn es eine gibt.
///
/// CUPS legt sie unter diesem Pfad ab — auf dem Mac wie unter Linux. Eine rohe
/// Warteschlange hat dort nichts Brauchbares stehen, und das ist in Ordnung:
/// der Rasterweg fragt nur, wenn er eine Seite setzt.
fn ppd_der_warteschlange(queue: &str) -> Option<String> {
    if queue.is_empty() || queue.contains('/') || queue.contains("..") {
        return None;
    }
    std::fs::read_to_string(format!("/etc/cups/ppd/{queue}.ppd")).ok()
}

/// Wie das Etikett auf die Seite kommt: Seitengrösse, Drehung, Verkleinerung
/// und der Punkt, an dem der Bauplan angesetzt wird.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Aufbau {
    pub seite_breite: f64,
    pub seite_hoehe: f64,
    pub quer: bool,
    /// 1,0 heisst: unverändert. Kleiner heisst: in die bedruckbare Fläche
    /// eingepasst. Grösser wird nie — ein Etikett darf nicht wachsen.
    pub skalierung: f64,
    pub anker_x: f64,
    pub anker_y: f64,
}

/// Den Aufbau rechnen. Rein, ohne Dateien und ohne Drucker.
///
/// Beim Drehen um die linke obere Ecke landet der Kasten LINKS neben seinem
/// Ansatzpunkt — deshalb wird der Ansatz um die gedrehte Breite nach rechts
/// gerückt. Ohne das läge das ganze Etikett neben dem Papier, und der Auftrag
/// käme leer heraus.
pub fn aufbau_rechnen(masse: &EtikettMasse, flaeche: Option<&Bedruckbar>) -> Aufbau {
    let quer = masse.breite_mm > masse.hoehe_mm;
    let (gedreht_breite, gedreht_hoehe) = if quer {
        (masse.hoehe_mm, masse.breite_mm)
    } else {
        (masse.breite_mm, masse.hoehe_mm)
    };

    match flaeche {
        None => Aufbau {
            seite_breite: gedreht_breite,
            seite_hoehe: gedreht_hoehe,
            quer,
            skalierung: 1.0,
            anker_x: if quer { gedreht_breite } else { 0.0 },
            anker_y: 0.0,
        },
        Some(f) => {
            let s = (f.feld_breite / gedreht_breite)
                .min(f.feld_hoehe / gedreht_hoehe)
                .min(1.0);
            let rand_x = (f.feld_breite - gedreht_breite * s) / 2.0;
            let rand_y = (f.feld_hoehe - gedreht_hoehe * s) / 2.0;
            let x = f.feld_x + rand_x;
            let y = f.feld_y + rand_y;
            Aufbau {
                seite_breite: f.papier_breite,
                seite_hoehe: f.papier_hoehe,
                quer,
                skalierung: s,
                anker_x: if quer { x + gedreht_breite * s } else { x },
                anker_y: y,
            }
        }
    }
}

fn farbe(ton: Ton) -> &'static str {
    match ton {
        Ton::Tinte => TINTE,
        Ton::Blass => BLASS,
    }
}

/// Aus der Versalhöhe in Millimetern den Schriftgrad in Punkt machen.
fn schriftgrad_pt(hoehe_mm: f64, schrift: Schrift) -> f64 {
    let versal = match schrift {
        Schrift::Mono => VERSAL_MONO,
        Schrift::Sans => VERSAL_SANS,
    };
    (hoehe_mm / versal) * 72.0 / 25.4
}

/// Text so einsetzen, dass er nichts steuert und nicht umbricht.
///
/// Die Anführungszeichen und der Rückstrich müssen entwertet werden, sonst
/// bricht die Quelle. Das gewöhnliche Leerzeichen wird zum geschützten: ein
/// Umbruch würde die zweite Hälfte einer Zeile an eine Stelle setzen, die der
/// Bauplan nie vorgesehen hat, und das fiele erst auf dem Papier auf.
fn typst_zeichenkette(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace(' ', "\u{00A0}")
}

/// Ein Primitiv des Bauplans in eine Setzanweisung übersetzen.
///
/// `y` ist beim Text die GRUNDLINIE. Deshalb wird von unten gesetzt
/// (`bottom + left`) und die Schrift auf `bottom-edge: "baseline"` gestellt:
/// dann liegt die Unterkante des Kastens genau auf der Grundlinie, ganz gleich,
/// welche Schrift und welcher Grad. Von oben zu setzen hiesse, die Oberlänge
/// jeder Schrift kennen zu müssen.
fn primitiv_typst(p: &Primitiv, masse: &EtikettMasse) -> String {
    match p {
        Primitiv::Rechteck {
            x,
            y,
            breite,
            hoehe,
            ton,
        } => format!(
            "#place(top + left, dx: {}, dy: {}, rect(width: {}, height: {}, fill: rgb(\"{}\"), stroke: none))\n",
            mm(*x),
            mm(*y),
            mm(*breite),
            mm(*hoehe),
            farbe(*ton),
        ),
        Primitiv::Text {
            x,
            y,
            text,
            hoehe_mm,
            schrift,
            fett,
            anker,
            sperrung,
            ton,
        } => {
            let familie = match schrift {
                Schrift::Mono => "DejaVu Sans Mono",
                Schrift::Sans => "Linux Libertine",
            };
            let gewicht = if *fett { "\"bold\"" } else { "\"regular\"" };
            let satz = format!(
                "text(font: \"{familie}\", size: {:.3}pt, weight: {gewicht}, tracking: {}, fill: rgb(\"{}\"), bottom-edge: \"baseline\")[#\"{}\"]",
                schriftgrad_pt(*hoehe_mm, *schrift),
                mm(sperrung.unwrap_or(0.0)),
                farbe(*ton),
                typst_zeichenkette(text),
            );
            // Der Kasten macht die Ausrichtung exakt, ohne die Breite des Textes
            // messen zu müssen: rechtsbündig sitzt er von der linken Kante bis
            // zum Ankerpunkt, linksbündig vom Ankerpunkt bis zur rechten Kante.
            match anker {
                Anker::Links => format!(
                    "#place(bottom + left, dx: {}, dy: {}, box(width: {}, align(left, {satz})))\n",
                    mm(*x),
                    mm(y - masse.hoehe_mm),
                    mm((masse.breite_mm - x).max(0.1)),
                ),
                Anker::Rechts => format!(
                    "#place(bottom + left, dx: 0mm, dy: {}, box(width: {}, align(right, {satz})))\n",
                    mm(y - masse.hoehe_mm),
                    mm(x.max(0.1)),
                ),
            }
        }
    }
}

/// Eine Seite in Etikettengrösse setzen.
///
/// `erste` unterscheidet nur, WIE die Seitengrösse gesetzt wird: die erste über
/// `set page`, damit dem Dokument kein leeres Blatt vorangestellt wird, jede
/// weitere über `page`, das eine neue Seite beginnt. So darf jedes Etikett im
/// selben Auftrag seine eigene Grösse haben.
pub fn rasterseite_typst(plan: &EtikettPlan, erste: bool, flaeche: Option<&Bedruckbar>) -> String {
    let a = aufbau_rechnen(&plan.masse, flaeche);

    let mut inhalt = String::with_capacity(plan.primitive.len() * 120);
    for p in &plan.primitive {
        inhalt.push_str(&primitiv_typst(p, &plan.masse));
    }

    let mut gesetzt = format!(
        "box(width: {}, height: {})[\n{inhalt}]",
        mm(plan.masse.breite_mm),
        mm(plan.masse.hoehe_mm),
    );
    if a.quer {
        gesetzt = format!("rotate({DREHUNG_GRAD}deg, origin: top + left, {gesetzt})");
    }
    if (a.skalierung - 1.0).abs() > 1e-9 {
        gesetzt = format!(
            "scale(x: {0:.4}%, y: {0:.4}%, origin: top + left, {gesetzt})",
            a.skalierung * 100.0
        );
    }
    let koerper = format!(
        "#place(top + left, dx: {}, dy: {}, {gesetzt})\n",
        mm(a.anker_x),
        mm(a.anker_y),
    );

    if erste {
        format!(
            "#set page(width: {}, height: {}, margin: 0pt, fill: white)\n{koerper}",
            mm(a.seite_breite),
            mm(a.seite_hoehe),
        )
    } else {
        format!(
            "#page(width: {}, height: {}, margin: 0pt, fill: white)[\n{koerper}]\n",
            mm(a.seite_breite),
            mm(a.seite_hoehe),
        )
    }
}

/// Die ganze Quelle für einen Stapel Etiketten.
///
/// Fehlt einem Etikett der Bauplan, wird das GESAGT und nichts gedruckt. Ein
/// Ersatzetikett zu erfinden wäre schlimmer als keines: am Regal klebt dann ein
/// Stück Papier, dem man nicht ansieht, dass es nicht das ist, was bestellt war.
pub fn raster_quelle(labels: &[LabelData], flaeche: Option<&Bedruckbar>) -> Result<String, String> {
    let mut quelle = String::new();
    for (i, label) in labels.iter().enumerate() {
        let plan = label.plan.as_ref().ok_or_else(|| {
            format!(
                "Für „{}“ fehlt der Bauplan des Etiketts. Der Rasterweg setzt eine Seite und braucht ihn.",
                label.sku
            )
        })?;
        // Ein Strichcode, den der Scanner nicht mehr liest, ist kein Etikett,
        // sondern ein Ärgernis am Tresen: die Kassiererin zieht ihn dreimal
        // über das Glas und tippt dann doch ab. Lieber ehrlich nicht drucken
        // und sagen, woran es liegt.
        if let Some(modul) = plan.modulbreite_mm {
            let gedruckt = modul * aufbau_rechnen(&plan.masse, flaeche).skalierung;
            if gedruckt < SCHMALSTE_LINIE_MM {
                return Err(format!(
                    "Die Artikelnummer „{}“ ist für dieses Etikett zu lang: der Strichcode käme mit {:.3} mm schmalsten Linien heraus, lesbar sind erst {:.3} mm. Entweder ein längeres Etikett einlegen oder eine kürzere Artikelnummer vergeben.",
                    label.sku, gedruckt, SCHMALSTE_LINIE_MM
                ));
            }
        }
        quelle.push_str(&rasterseite_typst(plan, i == 0, flaeche));
    }
    Ok(quelle)
}

/// Den Stapel zu einem PDF setzen — eine Seite je Etikett, jede so gross, wie
/// die Warteschlange wirklich bedrucken kann.
pub fn baue_rasterdokument(
    labels: &[LabelData],
    flaeche: Option<&Bedruckbar>,
) -> Result<Vec<u8>, String> {
    crate::commands::pdf::compile_typst_to_pdf(raster_quelle(labels, flaeche)?)
}

/// Auf `max` SPALTEN kuerzen, mit „…" als Marke.
///
/// ⚠️ 11.08.2026 — WAS DER BEFUND WAR: hier stand `take(max - 1)`, also
/// „ein Zeichen fuer die Auslassungspunkte". Auf dem ESC/POS-Weg stimmt das
/// nicht: PC858 kennt „…" nicht, `encode_pc858` schreibt dafuer drei Bytes.
/// Ein auf 32 Spalten gekuerzter Name ging als 34 Bytes zum Drucker, der ihn
/// stumm umbrach — die Zeile mit Gewicht und Karat rutschte hinterher.
///
/// WARUM NICHT einfach an der ESC/POS-Aufrufstelle enger kuerzen: dann traegt
/// die Aufrufstelle Wissen ueber die Kodierung, und der naechste Aufruf
/// vergisst es wieder. Die Marke kostet, was sie auf dem ZIEL kostet, und das
/// sagt der Aufrufer hier ausdruecklich:
///
///   • ZPL steht auf `^CI28` (UTF-8) — „…" ist dort EIN Zeichen.
///   • ESC/POS steht auf PC858 (`ESC t 19`) — „…" sind dort DREI.
///
/// Ist `max` kleiner als die Marke, gibt es fuer sie keinen Platz: dann wird
/// hart geschnitten, statt eine Marke zu setzen, die selbst ueberlaeuft.
fn truncate(s: &str, max: usize, marke_spalten: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    if max <= marke_spalten {
        return s.chars().take(max).collect();
    }
    s.chars()
        .take(max - marke_spalten)
        .chain(std::iter::once('…'))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> LabelData {
        LabelData {
            sku: "W14-AU-750-0012".into(),
            product_name: "Ring Gelbgold mit Brillant".into(),
            weight_grams: Some("14.5000".into()),
            karat: Some("750".into()),
            storage_location: Some("Tresor-1 / Fach-3".into()),
            plan: None,
        }
    }

    /// ⛔ DAS ETIKETT SPRICHT DIESELBE SPRACHE WIE DER BON.
    ///
    /// Gemessen am 08.08.2026: `text_line` schrieb rohes UTF-8 an einen
    /// Drucker, den derselbe Bytestrom zwei Zeilen vorher per `ESC t 19` auf
    /// PC858 gestellt hatte. Jeder Umlaut kam als zwei Zeichen Unsinn heraus.
    ///
    /// Und JEDES Etikett war betroffen, auch ohne Umlaut im Namen: das
    /// Trennzeichen zwischen Gewicht und Karat ist fest im Code ein U+00B7.
    ///
    /// Derselbe Fehler war in `thermal.rs` laengst behoben — der halbe Fix
    /// an derselben Ampel.
    #[test]
    fn das_etikett_spricht_pc858_wie_der_bon() {
        let mut l = sample();
        l.product_name = "Münze Österreich".into();
        let bytes = build_escpos(&[l]);

        // POSITIV: die richtigen Bytes sind da.
        assert!(bytes.contains(&0x81), "das ue fehlt als PC858-Byte");
        assert!(
            bytes.contains(&0xFA),
            "der Mittelpunkt fehlt als PC858-Byte"
        );

        // Und die Gegenprobe: kein rohes UTF-8 mehr im Strom.
        assert!(
            !bytes.windows(2).any(|w| w == [0xC3, 0xBC]),
            "rohes UTF-8 im Strom (ue als zwei Bytes)"
        );
        assert!(
            !bytes.windows(2).any(|w| w == [0xC2, 0xB7]),
            "rohes UTF-8 im Strom (Mittelpunkt als zwei Bytes)"
        );
    }

    /// Ein kleiner, aber echter Bauplan: zwei Balken und drei Texte, so wie
    /// `etikett-layout.ts` sie liefert — Grundlinien, Anker, Töne inbegriffen.
    /// Die Treiberbeschreibung, die auf dieser Maschine WIRKLICH unter
    /// `/etc/cups/ppd/Norns-Etikett.ppd` liegt — die Zeilen sind
    /// wortwörtlich übernommen, nichts nachgebaut.
    const DYMO_PPD: &str = r#"*ModelName: "DYMO Label Printer"
*LanguageLevel: "3"
*DefaultPageSize: w81h252
*PageSize w81h252/Address: "<</PageSize[81 252]/ImagingBBox null>>setpagedevice"
*PageSize w101h252/Large Address: "<</PageSize[101 252]/ImagingBBox null>>setpagedevice"
*ImageableArea w81h252/Address: "2 14.89999961853 79 237.100006103516"
*ImageableArea w101h252/Large Address: "2 14.89999961853 99 237.100006103516"
*PaperDimension w81h252/Address: "81 252"
*PaperDimension w101h252/Large Address: "101 252"
*DefaultResolution: 300dpi
"#;

    fn bauplan() -> EtikettPlan {
        EtikettPlan {
            modulbreite_mm: Some(0.503),
            masse: EtikettMasse {
                breite_mm: 88.9,
                hoehe_mm: 28.6,
            },
            primitive: vec![
                Primitiv::Rechteck {
                    x: 7.0,
                    y: 6.4,
                    breite: 0.5,
                    hoehe: 7.4,
                    ton: Ton::Tinte,
                },
                Primitiv::Rechteck {
                    x: 69.6,
                    y: 6.4,
                    breite: 0.18,
                    hoehe: 19.0,
                    ton: Ton::Blass,
                },
                Primitiv::Text {
                    x: 2.0,
                    y: 17.8,
                    text: "MZ-0042".into(),
                    hoehe_mm: 3.6,
                    schrift: Schrift::Mono,
                    fett: true,
                    anker: Anker::Links,
                    sperrung: Some(0.18),
                    ton: Ton::Tinte,
                },
                Primitiv::Text {
                    x: 68.4,
                    y: 25.4,
                    text: "890,00 €".into(),
                    hoehe_mm: 5.2,
                    schrift: Schrift::Sans,
                    fett: true,
                    anker: Anker::Rechts,
                    sperrung: None,
                    ton: Ton::Tinte,
                },
                Primitiv::Text {
                    x: 2.0,
                    y: 25.4,
                    text: "4,20 g · 585".into(),
                    hoehe_mm: 2.3,
                    schrift: Schrift::Sans,
                    fett: false,
                    anker: Anker::Links,
                    sperrung: None,
                    ton: Ton::Blass,
                },
            ],
        }
    }

    fn sample_mit_plan() -> LabelData {
        LabelData {
            plan: Some(bauplan()),
            ..sample()
        }
    }

    #[test]
    fn zpl_encodes_sku_as_code128_and_keeps_text() {
        let zpl = String::from_utf8(build_zpl(&[sample()])).unwrap();
        assert!(zpl.contains("^XA") && zpl.contains("^XZ"));
        assert!(zpl.contains("^BC")); // Code128 barcode element (NOT a QR ^BQ)
        assert!(!zpl.contains("^BQ")); // QR is gone
        assert!(zpl.contains("^BY")); // module/height defaults for the barcode
        assert!(zpl.contains("^BCN,70,N,N,N^FDW14-AU-750-0012")); // barcode carries the SKU
        assert!(zpl.contains("^A0N")); // human-readable font rows
        assert!(zpl.contains("Lager: Tresor-1 / Fach-3"));
    }

    #[test]
    fn zpl_strips_control_prefixes_from_data() {
        let mut s = sample();
        s.product_name = "Evil^~Name".into();
        let zpl = String::from_utf8(build_zpl(&[s])).unwrap();
        assert!(!zpl.contains("Evil^~"));
    }

    #[test]
    fn escpos_inits_and_feeds_without_cut() {
        let bytes = build_escpos(&[sample()]);
        assert_eq!(&bytes[0..2], &[ESC, b'@']); // init
                                                // No full-cut sequence (GS V).
        assert!(!bytes.windows(2).any(|w| w == [GS, b'V']));
        // Contains the SKU text.
        assert!(bytes.windows(15).any(|w| w == b"W14-AU-750-0012"));
    }

    /// ⛔ AUCH AUF DEM ETIKETT IST EIN ZEICHEN EINE SPALTE.
    ///
    /// BEFUND (11.08.2026, derselbe Fund wie in `thermal.rs`): `truncate`
    /// deckelt auf 32 ZEICHEN und setzt als letztes ein „…". Der Kodierer
    /// `encode_pc858` macht daraus DREI Bytes — auf dem Etikett stehen dann
    /// 34 Spalten, wo 32 zugesagt waren. Der Drucker bricht stumm um, und
    /// die naechste Zeile (Gewicht und Karat) rutscht.
    ///
    /// GEMESSEN wird der ECHTE Bytestrom aus `build_escpos`, nicht `truncate`
    /// mit von Hand mitgegebener Marke: sonst prueft der Waechter seine
    /// eigene Annahme und bleibt gruen, waehrend die Aufrufstelle den
    /// falschen Wert einsetzt.
    #[test]
    fn ein_gekuerzter_name_bleibt_auch_als_bytes_in_der_spur() {
        let mut l = sample();
        // Laenger als 32, damit `truncate` wirklich zuschlaegt.
        l.product_name = "Ring Gelbgold mit Brillant und Saphir, Handarbeit".into();
        let bytes = build_escpos(&[l]);

        // Die Namenszeile ist die, die direkt auf `fett aus` folgt.
        let start = bytes
            .windows(3)
            .position(|w| w == [ESC, b'E', 0])
            .expect("fett aus fehlt im Strom")
            + 3;
        let laenge = bytes[start..]
            .iter()
            .position(|&b| b == b'\n')
            .expect("die Namenszeile endet nie");
        assert!(
            laenge <= 32,
            "die Namenszeile geht als {laenge} Bytes auf ein 32-Spalten-Etikett: {:?}",
            String::from_utf8_lossy(&bytes[start..start + laenge])
        );
    }

    #[test]
    fn escpos_emits_code128_of_the_sku() {
        let bytes = build_escpos(&[sample()]);
        // GS k 73 = the CODE128 barcode command (function B).
        assert!(bytes.windows(3).any(|w| w == [GS, b'k', 73]));
        // The data payload selects code-set B and carries the SKU verbatim.
        assert!(bytes.windows(17).any(|w| w == b"{BW14-AU-750-0012"));
    }

    #[test]
    fn code128_doubles_a_literal_brace_in_the_payload() {
        let mut out = Vec::new();
        code128(&mut out, "AB{CD");
        // Selector "{B" then the escaped payload "AB{{CD".
        assert!(out.windows(8).any(|w| w == b"{BAB{{CD"));
    }

    #[test]
    fn batch_emits_one_block_per_label() {
        let zpl = String::from_utf8(build_zpl(&[sample(), sample(), sample()])).unwrap();
        assert_eq!(zpl.matches("^XA").count(), 3);
    }

    // ── Der Rasterweg ───────────────────────────────────────────────────────

    /// DIE Prüfung zum Fund: eine Seite darf NICHT mit `-o raw` gehen.
    ///
    /// Genau diese Angabe schaltet den Herstellertreiber ab, und ohne ihn kommt
    /// aus einem DYMO nichts heraus. Umgekehrt MUSS sie beim rohen Weg stehen
    /// bleiben, sonst versucht CUPS die ZPL-Zeichen als Text zu setzen und der
    /// Zebra spuckt Buchstabensalat.
    #[test]
    fn der_seitenweg_geht_ohne_o_raw_und_der_rohe_weg_mit() {
        let roh = lpr_argumente("Norns-Etikett", "/tmp/a.bin", true, None);
        assert!(
            roh.windows(2).any(|w| w == ["-o", "raw"]),
            "ZPL und ESC/POS brauchen weiterhin -o raw: {roh:?}"
        );

        let seite = lpr_argumente("Norns-Etikett", "/tmp/a.pdf", false, None);
        assert!(
            !seite.iter().any(|a| a == "raw"),
            "der Rasterweg darf den Treiber nicht abschalten: {seite:?}"
        );
        assert!(
            seite.windows(2).any(|w| w == ["-o", "fit-to-page"]),
            "ohne diese Angabe schneidet der Treiber die Enden des Etiketts ab: {seite:?}"
        );
        // Die Warteschlange und die Datei stehen in beiden Fällen dran.
        for args in [roh, seite] {
            assert!(args.windows(2).any(|w| w == ["-P", "Norns-Etikett"]));
            assert!(args.last().unwrap().starts_with("/tmp/a."));
        }
    }

    /// Der Bauplan kommt quer, die Rolle läuft hochkant.
    /// Basels Befund (30.07.2026): das gewählte Format erreichte den Drucker
    /// nie. Der Seitenweg nannte nur `fit-to-page`, also nahm CUPS das
    /// voreingestellte Etikett des Treibers und zog unsere Seite darauf.
    #[test]
    fn das_gewaehlte_format_faehrt_mit_zum_drucker() {
        let args = lpr_argumente("DYMO", "/tmp/x.pdf", false, Some((28.6, 88.9)));
        let zeile = args.join(" ");
        assert!(
            zeile.contains("media=Custom.28.6x88.9mm"),
            "das gewaehlte Format fehlt im Auftrag: {zeile}"
        );
        assert!(
            zeile.contains("fit-to-page"),
            "der Randausgleich fehlt: {zeile}"
        );
    }

    /// Der ROHE Weg darf KEIN Format tragen: dort setzt der Drucker selbst,
    /// und CUPS haelt sich vollstaendig heraus.
    #[test]
    fn der_rohe_weg_bleibt_unberuehrt() {
        let zeile = lpr_argumente("Zebra", "/tmp/x.bin", true, Some((28.6, 88.9))).join(" ");
        assert!(zeile.contains("raw"), "der rohe Weg braucht raw: {zeile}");
        assert!(
            !zeile.contains("media="),
            "der rohe Weg darf kein Format setzen: {zeile}"
        );
        assert!(
            !zeile.contains("fit-to-page"),
            "der rohe Weg darf nicht skalieren: {zeile}"
        );
    }

    #[test]
    fn raster_dreht_den_querliegenden_bauplan_auf_die_rolle() {
        let quelle = raster_quelle(&[sample_mit_plan()], None).expect("Bauplan liegt bei");
        // Die Seite ist 28,6 breit und 88,9 hoch — nicht umgekehrt.
        assert!(
            quelle.contains("width: 28.600mm, height: 88.900mm"),
            "Seitengrösse falsch: {quelle}"
        );
        assert!(quelle.contains("rotate(90deg, origin: top + left"));
        // Der gedrehte Kasten wird um die volle Seitenbreite nach rechts gesetzt,
        // sonst läge er neben dem Papier.
        assert!(quelle.contains("#place(top + left, dx: 28.600mm, dy: 0.000mm, rotate("));
        assert!(quelle.contains("margin: 0pt"));
        // Ohne Treiberangaben wird nicht verkleinert.
        assert!(
            !quelle.contains("scale("),
            "unerwartete Verkleinerung: {quelle}"
        );
    }

    /// Der Bauplan wird gesetzt, nicht neu gerechnet.
    #[test]
    fn raster_setzt_jedes_primitiv_des_bauplans() {
        let quelle = raster_quelle(&[sample_mit_plan()], None).expect("Bauplan liegt bei");
        // Ein Balken des Strichcodes: volle Deckung, keine Kontur.
        assert!(quelle.contains(
            "#place(top + left, dx: 7.000mm, dy: 6.400mm, rect(width: 0.500mm, height: 7.400mm, fill: rgb(\"#000000\"), stroke: none))"
        ));
        // Die zurückhaltende Trennlinie bleibt zurückhaltend.
        assert!(quelle.contains("fill: rgb(\"#595959\")"));
        // Die Artikelnummer: Festbreitenschrift, fett, Sperrung, an der Grundlinie
        // 17,8 mm — gesetzt wird von unten, also 17,8 - 28,6 = -10,8.
        assert!(
            quelle.contains("#place(bottom + left, dx: 2.000mm, dy: -10.800mm"),
            "Grundlinie der Artikelnummer falsch: {quelle}"
        );
        assert!(quelle.contains("font: \"DejaVu Sans Mono\""));
        assert!(quelle.contains("tracking: 0.180mm"));
        assert!(quelle.contains("bottom-edge: \"baseline\""));
        // Der Preis steht rechtsbündig: Kasten von der Kante bis zum Anker.
        assert!(
            quelle.contains("dx: 0mm, dy: -3.200mm, box(width: 68.400mm, align(right,"),
            "Preis nicht rechtsbündig am Anker: {quelle}"
        );
        assert!(
            quelle.contains("890,00\u{a0}€"),
            "Euro-Zeichen fehlt: {quelle}"
        );
    }

    /// Die Versalhöhe wird zum Schriftgrad — mit der Zahl, die zur wirklich
    /// gesetzten Schrift gehört.
    #[test]
    fn schriftgrad_kommt_aus_der_versalhoehe() {
        // 3,6 mm Versalhöhe bei DejaVu Sans Mono: 3,6 / 0,729 mm = 4,938 mm
        // Geviert = 14,00 pt.
        assert!((schriftgrad_pt(3.6, Schrift::Mono) - 13.998).abs() < 0.01);
        // Dieselbe Höhe in der Grotesk-Ersatzschrift fällt kleiner aus — die
        // sichere Richtung, siehe VERSAL_SANS.
        assert!(schriftgrad_pt(3.6, Schrift::Sans) > schriftgrad_pt(3.6, Schrift::Mono));
    }

    /// Kein Bauplan heisst: sagen, nicht erfinden.
    #[test]
    fn raster_ohne_bauplan_sagt_es_und_druckt_nichts() {
        let fehler =
            raster_quelle(&[sample()], None).expect_err("ohne Bauplan darf nichts entstehen");
        assert!(fehler.contains("W14-AU-750-0012"), "{fehler}");
        assert!(fehler.contains("Bauplan"), "{fehler}");
    }

    /// Die Treiberbeschreibung wird gelesen, nicht geraten.
    #[test]
    fn liest_die_bedruckbare_flaeche_aus_der_echten_treiberbeschreibung() {
        let f = ppd_bedruckbar(DYMO_PPD).expect("die Fläche steht in der Beschreibung");
        // 81 x 252 Punkt Papier = 28,58 x 88,9 mm.
        assert!((f.papier_breite - 28.575).abs() < 0.01, "{f:?}");
        assert!((f.papier_hoehe - 88.9).abs() < 0.01, "{f:?}");
        // Bedruckbar sind nur 77 x 222,2 Punkt = 27,16 x 78,4 mm …
        assert!((f.feld_breite - 27.164).abs() < 0.01, "{f:?}");
        assert!((f.feld_hoehe - 78.383).abs() < 0.01, "{f:?}");
        // … und die Beschreibung rechnet von unten, gesetzt wird von oben.
        assert!((f.feld_x - 0.706).abs() < 0.01, "{f:?}");
        assert!((f.feld_y - 5.256).abs() < 0.01, "{f:?}");
    }

    /// Eine Beschreibung ohne die nötigen Angaben führt zu KEINER Annahme.
    #[test]
    fn ohne_angaben_wird_nichts_angenommen() {
        assert!(ppd_bedruckbar("*ModelName: \"Irgendwas\"\n").is_none());
        // Der Name der Vorgabeseite steht da, die Masse aber nicht.
        assert!(ppd_bedruckbar("*DefaultPageSize: w81h252\n").is_none());
    }

    /// DIE Prüfung zum zweiten Fund: das Etikett muss in die Fläche passen, die
    /// der Drucker wirklich bedruckt — sonst fehlt an jedem Ende ein halber
    /// Zentimeter, und dort stehen der Kopf und der QR.
    #[test]
    fn passt_das_etikett_in_die_bedruckbare_flaeche_ein() {
        let f = ppd_bedruckbar(DYMO_PPD).unwrap();
        let a = aufbau_rechnen(
            &EtikettMasse {
                breite_mm: 88.9,
                hoehe_mm: 28.6,
            },
            Some(&f),
        );
        // Die Seite ist das ganze Papier — beschnitten wird trotzdem nichts.
        assert!((a.seite_breite - 28.575).abs() < 0.01);
        assert!((a.seite_hoehe - 88.9).abs() < 0.01);
        assert!(a.quer);
        // Verkleinert, aber nur so weit wie nötig.
        assert!(a.skalierung < 1.0, "es MUSS verkleinert werden: {a:?}");
        assert!((a.skalierung - 78.383 / 88.9).abs() < 0.005, "{a:?}");

        // Und nun die Probe: nichts ragt aus der bedruckbaren Fläche heraus.
        let breite = 28.6 * a.skalierung;
        let hoehe = 88.9 * a.skalierung;
        let links = a.anker_x - breite;
        assert!(
            links >= f.feld_x - 0.01,
            "links raus: {links} < {}",
            f.feld_x
        );
        assert!(
            a.anker_x <= f.feld_x + f.feld_breite + 0.01,
            "rechts raus: {a:?}"
        );
        assert!(a.anker_y >= f.feld_y - 0.01, "oben raus: {a:?}");
        assert!(
            a.anker_y + hoehe <= f.feld_y + f.feld_hoehe + 0.01,
            "unten raus: {a:?}"
        );
    }

    /// Ohne Treiberangaben bleibt es beim bekannten Stand: Seite in
    /// Etikettengrösse, unverkleinert.
    #[test]
    fn ohne_treiberangaben_bleibt_die_seite_das_etikett() {
        let a = aufbau_rechnen(
            &EtikettMasse {
                breite_mm: 88.9,
                hoehe_mm: 28.6,
            },
            None,
        );
        assert_eq!(a.skalierung, 1.0);
        assert!((a.seite_breite - 28.6).abs() < 1e-9);
        assert!((a.seite_hoehe - 88.9).abs() < 1e-9);
    }

    /// Ein Etikett wird eingepasst, aber NIE vergrössert.
    #[test]
    fn ein_kleines_etikett_wird_nicht_aufgeblasen() {
        let f = ppd_bedruckbar(DYMO_PPD).unwrap();
        let a = aufbau_rechnen(
            &EtikettMasse {
                breite_mm: 40.0,
                hoehe_mm: 20.0,
            },
            Some(&f),
        );
        assert_eq!(a.skalierung, 1.0);
    }

    /// Ein Strichcode, der nach dem Einpassen unlesbar wäre, wird nicht
    /// gedruckt — es wird gesagt, warum.
    #[test]
    fn zu_schmale_striche_werden_nicht_gedruckt_sondern_benannt() {
        let f = ppd_bedruckbar(DYMO_PPD).unwrap();
        let mut label = sample_mit_plan();
        if let Some(plan) = label.plan.as_mut() {
            // Eine sehr lange Artikelnummer drückt die Modulbreite auf das
            // Mindestmass; nach dem Einpassen liegt sie darunter.
            plan.modulbreite_mm = Some(SCHMALSTE_LINIE_MM);
        }
        let fehler = raster_quelle(&[label], Some(&f)).expect_err("das darf nicht gedruckt werden");
        assert!(fehler.contains("zu lang"), "{fehler}");
        assert!(fehler.contains("Strichcode"), "{fehler}");

        // Dieselbe Breite OHNE Einpassen ist in Ordnung und wird gedruckt.
        let mut label = sample_mit_plan();
        if let Some(plan) = label.plan.as_mut() {
            plan.modulbreite_mm = Some(SCHMALSTE_LINIE_MM);
        }
        assert!(raster_quelle(&[label], None).is_ok());
    }

    /// Ein Stapel wird zu einem Dokument mit einer Seite je Etikett — und der
    /// ersten Seite geht kein leeres Blatt voraus.
    #[test]
    fn raster_stapel_gibt_eine_seite_je_etikett() {
        let quelle = raster_quelle(
            &[sample_mit_plan(), sample_mit_plan(), sample_mit_plan()],
            None,
        )
        .unwrap();
        assert_eq!(quelle.matches("#set page(").count(), 1);
        assert_eq!(quelle.matches("#page(").count(), 2);
        assert!(
            quelle.starts_with("#set page("),
            "vor dem ersten Etikett darf kein leeres Blatt stehen"
        );
    }

    /// Und am Ende muss ein echtes PDF herauskommen, sonst nimmt es die
    /// Warteschlange nicht an.
    #[test]
    fn raster_erzeugt_ein_echtes_pdf() {
        let f = ppd_bedruckbar(DYMO_PPD).unwrap();
        let pdf = baue_rasterdokument(&[sample_mit_plan()], Some(&f))
            .expect("das Etikett muss setzbar sein");
        assert!(pdf.starts_with(b"%PDF-"), "kein PDF entstanden");
        assert!(
            pdf.len() > 500,
            "verdächtig kleines Dokument: {}",
            pdf.len()
        );
        // Die Seite hat genau die Masse, die die Treiberbeschreibung nennt —
        // 81 x 252 Punkt. Steht dort etwas anderes, dreht oder staucht der
        // Treiber, und niemand sieht es vor dem Papier.
        let text = String::from_utf8_lossy(&pdf);
        assert!(
            text.contains("/MediaBox [0 0 81"),
            "die Seite passt nicht zum Papier des Treibers"
        );
    }

    /// Der Bauplan kommt als JSON aus der Oberfläche. Diese Prüfung liest ihn
    /// wortwörtlich so, wie `etikett-layout.ts` ihn schreibt — samt der Felder,
    /// die hier gar nicht gebraucht werden.
    #[test]
    fn liest_den_bauplan_so_wie_die_oberflaeche_ihn_schickt() {
        let json = r#"{
            "sku": "MZ-0042",
            "productName": "Silbergroschen 1871",
            "weightGrams": null,
            "karat": null,
            "storageLocation": null,
            "plan": {
                "masse": { "breiteMm": 88.9, "hoeheMm": 28.6 },
                "modulbreiteMm": 0.503,
                "strichcodeModule": 132,
                "qrInhalt": "w14://p/MZ-0042",
                "primitive": [
                    { "art": "rechteck", "x": 2, "y": 5.2, "breite": 66.4, "hoehe": 0.18, "ton": "tinte" },
                    { "art": "text", "x": 2, "y": 4.2, "text": "WAREHOUSE 14", "hoeheMm": 2.1,
                      "schrift": "sans", "fett": true, "anker": "links", "sperrung": 0.35, "ton": "tinte" }
                ]
            }
        }"#;
        let label: LabelData = serde_json::from_str(json).expect("der Bauplan muss lesbar sein");
        let plan = label.plan.expect("Bauplan liegt bei");
        assert_eq!(plan.primitive.len(), 2);
        assert!((plan.masse.breite_mm - 88.9).abs() < 1e-9);
        match &plan.primitive[1] {
            Primitiv::Text {
                text,
                hoehe_mm,
                anker,
                schrift,
                sperrung,
                ..
            } => {
                assert_eq!(text, "WAREHOUSE 14");
                assert!((hoehe_mm - 2.1).abs() < 1e-9);
                assert_eq!(*anker, Anker::Links);
                assert_eq!(*schrift, Schrift::Sans);
                assert_eq!(*sperrung, Some(0.35));
            }
            other => panic!("falsches Primitiv gelesen: {other:?}"),
        }
    }

    /// Die dritte Sprache muss auch als Wort über die Brücke kommen.
    #[test]
    fn raster_ist_eine_gleichberechtigte_sprache() {
        let cfg: LabelConfig = serde_json::from_str(
            r#"{"mode":"system","printerName":"Norns-Etikett","printerType":"RASTER"}"#,
        )
        .expect("RASTER muss eine gültige Sprache sein");
        assert_eq!(cfg.printer_type, LabelPrinterType::Raster);
    }
}

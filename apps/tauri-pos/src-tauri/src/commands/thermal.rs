//! Mandate 3-A — ESC/POS thermal receipt over TCP.
//!
//! ESC/POS is Epson's de-facto standard; Star / Bixolon / generic Chinese
//! receipt printers all speak a compatible dialect. The control codes are
//! short enough (init, align, bold, cut, feed) that pulling in a crate
//! buys us nothing — we hand-write the bytes here.
//!
//! Transport: TCP port 9100 (the standard "AppSocket / JetDirect" port).
//! No TLS — receipt printers on a shop LAN are trusted devices.

use serde::Deserialize;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};

use crate::config::{self, DEFAULT_TCP_TIMEOUT_MS};
use crate::error::{HardwareError, HwResult};
use crate::mock::printer_mock;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalEndpoint {
    pub ip: String,
    pub port: u16,
    /// USB / local mode. When set (non-empty), the receipt is printed as raw
    /// ESC/POS to this OS print queue (CUPS `lpr -o raw`) instead of opening a
    /// TCP socket — so a USB receipt printer needs no IP, just plug it in.
    /// Optional + defaulted so existing network-mode callers keep working.
    #[serde(default)]
    pub printer_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalLineItem {
    pub name: String,
    pub quantity: u32,
    pub unit_price_eur: String,
    pub line_total_eur: String,
    pub vat_label: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalReceiptData {
    // Shop header
    pub shop_name: String,
    pub shop_address: Vec<String>,
    pub shop_vat_id: String,
    /// Die Steuernummer. § 14 Abs. 4 Nr. 2 UStG laesst sie ALTERNATIV zur
    /// USt-IdNr. zu.
    ///
    /// ⚠️ 08.08.2026: dieses Feld fehlte. Die Kasse SENDET es seit jeher
    /// (`shopTaxNumber` in BezahlenDialog und ankauf-receipt), serde verwarf
    /// es still, und der Bon druckte bedingungslos „USt-IdNr.: " mit einem
    /// leeren Wert dahinter. Ein Haendler ohne USt-IdNr. bekam damit einen
    /// Beleg, der eine Kennung BEHAUPTET und keine traegt.
    #[serde(default)]
    pub shop_tax_number: String,
    pub shop_phone: Option<String>,

    // Receipt meta
    pub receipt_locator: String,
    pub printed_at: String, // already-localised "27.05.2026 16:43"
    pub cashier_name: String,
    pub shift_id: Option<String>,

    // Body
    pub items: Vec<ThermalLineItem>,
    pub subtotal_eur: String,
    /// ⚠️ NICHT DRUCKEN. Die Steuer des GANZEN Belegs, einschliesslich der
    /// Margensteuer nach § 25a, die nicht gesondert ausgewiesen werden darf
    /// (§ 14a Abs. 6 Satz 2 UStG). Bleibt fuer die interne Aufzeichnung.
    pub vat_eur: String,
    /// Der Betrag, der als „MwSt." auf den Beleg DARF. `None` heisst: gar
    /// keine Steuerzeile drucken.
    ///
    /// `#[serde(default)]`, damit eine aeltere Nutzlast ohne dieses Feld
    /// weiterhin angenommen wird. Fehlt es, wird KEINE Steuerzeile gedruckt:
    /// im Zweifel lieber eine Angabe zu wenig als ein verbotener Ausweis.
    #[serde(default)]
    pub vat_disclosable_eur: Option<String>,
    /// Die nach § 14a Abs. 6 Satz 1 UStG vorgeschriebenen Hinweise zu den
    /// angewandten Sonderregelungen, etwa „Gebrauchtgegenstaende/
    /// Sonderregelung". Pflichtangabe, nicht Beiwerk.
    #[serde(default)]
    pub special_scheme_notices: Vec<String>,
    pub total_eur: String,
    pub payment_method_label: String,
    pub cash_received_eur: Option<String>,
    pub change_eur: Option<String>,

    // TSE block (KassenSichV-mandatory on every receipt)
    /// § 6 Satz 1 Nr. 6 KassenSichV, erste Haelfte: die Seriennummer des
    /// AUFZEICHNUNGSSYSTEMS. Auf einem gesunden Bon traegt sie der QR
    /// (§ 6 Satz 2 Nr. 2); im TSE-AUSFALL fehlt der QR — und mit ihm fiel
    /// bis zum 19.08.2026 auch diese Nummer, obwohl sie die TSE gar nicht
    /// braucht. Der RUMPF fuellt das Feld selbst (lizenz::geraete_kennung),
    /// die WebView wird nicht gefragt. `#[serde(default)]`: alte Aufrufer
    /// ohne das Feld drucken wie bisher.
    #[serde(default)]
    pub kassen_seriennummer: Option<String>,
    /// § 6 Satz 1 Nr. 2: der VORGANGSBEGINN, ortszeitlich formatiert. Auch
    /// er lebt sonst nur im QR. `printed_at` ist das Ende.
    #[serde(default)]
    pub vorgang_beginn: Option<String>,
    pub tse_signature_value: String,
    pub tse_signature_counter: String,
    pub tse_transaction_number: String,
    pub tse_qr_payload: String,

    // Footer
    pub footer_lines: Vec<String>,

    /// Welche Art Beleg das ist. Fehlt das Feld, ist es ein VERKAUF — so
    /// verhalten sich alle Aufrufer, die es noch nicht senden.
    ///
    /// Bis zum 25.07.2026 kannte diese Struktur das Feld GAR NICHT. Ein
    /// Ankaufbeleg wurde deshalb als gewoehnlicher Kassenbon gedruckt: ohne
    /// seine Ueberschrift und ohne den Namen des Verkaeufers. Auf einem
    /// Ankauf ist beides Pflichtangabe.
    #[serde(default)]
    pub document_kind: Option<String>,

    /// Die andere Partei bei einem Ankauf, z. B. „Verkaeufer: Hans Mustermann".
    #[serde(default)]
    pub counterparty_label: Option<String>,

    /// Zeichen je Zeile. 32 fuer 58-mm-Papier, 48 fuer 80-mm-Papier bei
    /// Schrift A.
    ///
    /// Fehlt das Feld, bleiben es 32 — genau der Wert, mit dem bisher
    /// gedruckt wurde. Ein Kassenzettel, der sich beim Aktualisieren
    /// stillschweigend umbaut, waere schlimmer als einer, der schmal bleibt.
    #[serde(default)]
    pub paper_cols: Option<usize>,

    /// Das Logo des Haendlers, base64-kodiert (Basels Dekret, 26.07.2026).
    /// Es kommt als MANDANTENDATEN ueber die Bruecke — nie aus dem Programm.
    /// FEHLT es, wird KEIN Logo gedruckt: es gibt keinen Rueckfall auf ein
    /// eingebautes Bild mehr. Bis zu diesem Tag lag hier ein per
    /// `include_bytes!` eingebranntes Warehouse-14-Raster, bedingungslos auf
    /// jedem Bon.
    #[serde(default)]
    pub logo_bytes_base64: Option<String>,
    /// "svg" | "png" | "jpeg". SVG wird fuer JEDE Papierbreite frisch
    /// gerastert — „die praeziseste Form", darum nahm Basel sie in den
    /// Pflichtumfang.
    #[serde(default)]
    pub logo_format: Option<String>,
    /// "klein" | "mittel" | "gross" — feste Anteile der Druckbreite, keine
    /// Pixelfummelei fuer den Haendler. Fehlt oder unbekannt: mittel.
    #[serde(default)]
    pub logo_size: Option<String>,
}

/// Die Papierbreite dieses Belegs. Nur die zwei Werte, die es real gibt;
/// alles andere faellt auf 32 zurueck statt eine krumme Spaltenzahl zu
/// erfinden, an der jede Ausrichtung zerbricht.
fn cols_of(data: &ThermalReceiptData) -> usize {
    match data.paper_cols {
        Some(48) => 48,
        _ => 32,
    }
}

/// One-tap reachability probe for the receipt printer — open a TCP connection
/// to the configured `ip:port` (AppSocket 9100) and close it. Drives the green/
/// red "verbunden / nicht erreichbar" badge and the app-start auto-connect sweep
/// WITHOUT sending any bytes, so probing never wakes the cutter or feeds paper.
///
/// Returns `Ok(true)` when the socket opened, `Ok(false)` on refusal/timeout —
/// an unreachable printer is a normal state to surface, not a hard error.
#[tauri::command]
pub async fn thermal_check_connection(endpoint: ThermalEndpoint) -> HwResult<bool> {
    if config::is_mock_mode() {
        return printer_mock::check_connection(&endpoint.ip, endpoint.port).await;
    }
    // USB / local mode: "reachable" means the OS print queue still exists.
    if let Some(name) = endpoint.printer_name.as_deref().filter(|n| !n.is_empty()) {
        return Ok(system_queue_exists(name).await);
    }
    Ok(probe_tcp(&endpoint.ip, endpoint.port).await)
}

/// True iff a print queue with this exact name is installed. Lets the USB-mode
/// reachability badge confirm the printer is present WITHOUT dispatching a job
/// (never feeds paper). macOS/Linux: `lpstat -p`. Windows: the spooler list.
#[cfg(not(target_os = "windows"))]
async fn system_queue_exists(printer_name: &str) -> bool {
    let Ok(output) = tokio::process::Command::new("lpstat")
        .arg("-p")
        .output()
        .await
    else {
        return false;
    };
    String::from_utf8_lossy(&output.stdout).lines().any(|line| {
        line.strip_prefix("printer ")
            .and_then(|rest| rest.split_whitespace().next())
            .map(|name| name == printer_name)
            .unwrap_or(false)
    })
}

#[cfg(target_os = "windows")]
async fn system_queue_exists(printer_name: &str) -> bool {
    let name = printer_name.to_string();
    tokio::task::spawn_blocking(move || crate::commands::win_print::queue_exists(&name))
        .await
        .unwrap_or(false)
}

/// Auto-detect the most likely USB receipt printer among the OS queues so the
/// operator just plugs it in — no IP, no manual pick. Reads each queue's
/// device-uri (`lpstat -v`), prefers a USB queue whose name/uri looks like a
/// receipt printer, else the only USB queue, else `None`. Returns the CUPS
/// queue name to store as `printerName`.
#[tauri::command]
pub async fn detect_receipt_printer() -> HwResult<Option<String>> {
    if config::is_mock_mode() {
        return Ok(Some("Mock-Bondrucker".to_string()));
    }
    detect_receipt_printer_impl().await
}

/// macOS/Linux: parse each CUPS queue's device-uri (`lpstat -v`), prefer a USB
/// queue whose name reads like a receipt printer, else the only USB queue.
#[cfg(not(target_os = "windows"))]
async fn detect_receipt_printer_impl() -> HwResult<Option<String>> {
    let Ok(output) = tokio::process::Command::new("lpstat")
        .arg("-v")
        .output()
        .await
    else {
        return Ok(None);
    };
    let text = String::from_utf8_lossy(&output.stdout);
    // Lines look like: "device for Warehouse14-Bon: usb://SAMSUNG/SRP-350?..."
    let mut usb_queues: Vec<String> = Vec::new();
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("device for ") {
            if let Some((name, uri)) = rest.split_once(": ") {
                if uri.trim().to_lowercase().starts_with("usb:") {
                    usb_queues.push(name.trim().to_string());
                }
            }
        }
    }
    // A USB queue whose name reads like a receipt printer wins.
    const HINTS: [&str; 12] = [
        "bon", "receipt", "beleg", "srp", "thermal", "pos", "tm-", "tm_", "star", "bixolon",
        "epson", "kasse",
    ];
    if let Some(name) = usb_queues
        .iter()
        .find(|n| HINTS.iter().any(|h| n.to_lowercase().contains(h)))
    {
        return Ok(Some(name.clone()));
    }
    // Otherwise, if exactly one USB printer is present, it must be the one.
    if usb_queues.len() == 1 {
        return Ok(Some(usb_queues.remove(0)));
    }
    Ok(None)
}

/// Windows: enumerate spooler queues + auto-pick the USB receipt printer by
/// port + name keyword (same heuristic as macOS). Blocking spooler call → off-thread.
#[cfg(target_os = "windows")]
async fn detect_receipt_printer_impl() -> HwResult<Option<String>> {
    Ok(
        tokio::task::spawn_blocking(crate::commands::win_print::detect_receipt)
            .await
            .unwrap_or(None),
    )
}

/// Shared TCP reachability probe — connect, then drop. `true` iff the socket
/// opened within [`DEFAULT_TCP_TIMEOUT_MS`]. Never errors; the caller maps a
/// `false` into a calm "nicht erreichbar" state.
pub(crate) async fn probe_tcp(ip: &str, port: u16) -> bool {
    let addr = format!("{ip}:{port}");
    matches!(
        timeout(
            Duration::from_millis(DEFAULT_TCP_TIMEOUT_MS),
            TcpStream::connect(&addr),
        )
        .await,
        Ok(Ok(_))
    )
}

/// Send a receipt to the thermal printer. Idempotent — if the operator
/// re-prints (e.g. the paper jammed), we just re-fire the same bytes.
#[tauri::command]
pub async fn print_thermal_receipt(
    app: tauri::AppHandle,
    endpoint: ThermalEndpoint,
    mut data: ThermalReceiptData,
) -> HwResult<()> {
    // Die Kassen-Seriennummer stammt vom RUMPF, nie aus der WebView: sie ist
    // dieselbe Kennung, mit der das Geraet gepaart ist (lizenz.rs), und ein
    // Bon, der eine andere behauptet, waere eine gedruckte Falschangabe.
    // Gebraucht wird sie nur im TSE-Ausfall (siehe den Block in build_escpos);
    // gefuellt wird sie immer — entscheiden tut der Drucker-Baustein.
    if data.kassen_seriennummer.as_deref().unwrap_or("").is_empty() {
        data.kassen_seriennummer =
            Some(crate::lizenz::geraete_kennung(&crate::lizenz::datenort(&app)));
    }
    if config::is_mock_mode() {
        return printer_mock::print_thermal(endpoint, data).await;
    }

    let bytes = build_escpos(&data);

    // USB / local mode — raw ESC/POS to the OS print queue (no network).
    if let Some(name) = endpoint.printer_name.as_deref().filter(|n| !n.is_empty()) {
        return send_to_system_printer(name, &bytes).await;
    }

    // Network mode — AppSocket / JetDirect on TCP 9100.
    let addr = format!("{}:{}", endpoint.ip, endpoint.port);
    let mut stream = timeout(
        Duration::from_millis(DEFAULT_TCP_TIMEOUT_MS),
        TcpStream::connect(&addr),
    )
    .await
    .map_err(HardwareError::from)??;

    let write_fut = async {
        stream.write_all(&bytes).await?;
        stream.flush().await?;
        Ok::<(), std::io::Error>(())
    };
    timeout(Duration::from_millis(DEFAULT_TCP_TIMEOUT_MS), write_fut)
        .await
        .map_err(HardwareError::from)??;

    Ok(())
}

/// Send raw ESC/POS bytes to an OS print queue. The USB receipt printer is owned
/// by the OS spooler; we hand it the bytes with raw passthrough so the driver
/// does NOT re-render our control codes.
///
/// macOS/Linux: `lpr -P <name> -o raw <tmpfile>` (mirrors the label printer's
/// proven system path). Windows has no `lpr`, so we drive the Win32 spooler
/// directly (`win_print::print_raw`, "RAW" datatype) on a blocking thread.
#[cfg(not(target_os = "windows"))]
async fn send_to_system_printer(printer_name: &str, bytes: &[u8]) -> HwResult<()> {
    // ⚠️ VOR dem Senden UND VOR DER TEMP-DATEI. `lpr` liefert 0, sobald der
    // Auftrag in der WARTESCHLANGE liegt — nicht wenn Papier herauskommt. Beim
    // BON wiegt das am schwersten: der Kassierer drückt drei Mal, und wenn die
    // Schlange später anläuft, fallen drei fiskalische Belege auf einmal heraus.
    //
    // ⚠️ 12.08.2026, DIE REIHENFOLGE: die Prüfung stand bis heute NACH dem
    // Schreiben der Temp-Datei. Bei angehaltener Schlange (Papierstau, Drucker
    // aus, Kabel ab) verliess die Funktion sich hier mit `?` — und die Datei
    // blieb liegen. In ihr steht der VOLLSTÄNDIGE Beleg als ESC/POS: die
    // TSE-Signatur, die QR-Nutzlast, beim Ankauf der Name des Verkäufers. Jeder
    // Fehlversuch legte eine weitere ab, unbegrenzt, unbereinigt.
    //
    // `pdf.rs` hatte die richtige Reihenfolge längst; nur dieser Weg nicht —
    // die Hausklasse „der halbe Fix an derselben Ampel". Wer nichts senden
    // darf, muss auch nichts auf die Platte schreiben.
    crate::commands::warteschlangenlage::vor_dem_senden_pruefen(printer_name).await?;

    let tmp = std::env::temp_dir().join(format!("warehouse14-bon-{}.bin", uuid::Uuid::new_v4()));
    std::fs::write(&tmp, bytes).map_err(HardwareError::from)?;

    let status = tokio::process::Command::new("lpr")
        .arg("-P")
        .arg(printer_name)
        .arg("-o")
        .arg("raw")
        .arg(&tmp)
        .status()
        .await
        .map_err(HardwareError::from)?;

    let _ = std::fs::remove_file(&tmp);

    if !status.success() {
        return Err(HardwareError::Device(format!(
            "lpr exited with {:?} (Drucker '{printer_name}')",
            status.code()
        )));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
async fn send_to_system_printer(printer_name: &str, bytes: &[u8]) -> HwResult<()> {
    let name = printer_name.to_string();
    let data = bytes.to_vec();
    tokio::task::spawn_blocking(move || crate::commands::win_print::print_raw(&name, &data))
        .await
        .map_err(|e| HardwareError::Device(format!("Druckauftrag-Thread fehlgeschlagen: {e}")))?
        .map_err(HardwareError::Device)
}

// ────────────────────────────────────────────────────────────────────────
// ESC/POS byte builder — handcrafted, the spec is small enough.
// ────────────────────────────────────────────────────────────────────────

// Control sequences we use.
const ESC: u8 = 0x1B;
const GS: u8 = 0x1D;

fn build_escpos(data: &ThermalReceiptData) -> Vec<u8> {
    let mut b = Vec::with_capacity(16384);
    let cols = cols_of(data);
    let ankauf = data.document_kind.as_deref() == Some("ANKAUF");

    // Initialize + set codepage to PC858 (Euro + German umlauts).
    b.extend_from_slice(&[ESC, b'@']);
    b.extend_from_slice(&[ESC, b't', 19]); // PC858

    // ── Die Systemzeile ─────────────────────────────────────────────────────
    // Basels Dekret (26.07.2026): ganz oben auf JEDEM Bon steht klein, fein
    // und dezent „norns.de" — die Zeile des SYSTEMS, nicht des Ladens. Schrift
    // B, mittig, ohne Rahmen; „braucht Konzentration um sie zu bemerken". Sie
    // ist NICHT abschaltbar und ersetzt kein Logo.
    align_center(&mut b);
    font_b_on(&mut b);
    text_line(&mut b, "norns.de");
    font_b_off(&mut b);
    feed(&mut b, 1);

    // ── Kopf ────────────────────────────────────────────────────────────────
    // Bis zum 26.07.2026 lag hier ein per `include_bytes!` eingebranntes
    // Warehouse-14-Raster, bedingungslos auf jedem Bon, und `shop_name` wurde
    // NIE gelesen. Seit dem Dekret ist das Logo MANDANTENDATEN: es kommt als
    // Bytes ueber die Bruecke und wird hier fuer die ECHTE Papierbreite
    // gerastert. FEHLT es, druckt niemand ein fremdes Bild — dann traegt der
    // Kopf nur den Namen des Ladens.
    if let Some(raster) = logo_raster(data, cols) {
        b.extend_from_slice(&raster);
        feed(&mut b, 1);
    }
    // Der Name des Ladens, als Text unter dem Logo (oder allein). Das alte
    // eingebrannte Zeichen trug den Namen im Bild; ein Haendler-Logo tut das
    // nicht zwingend, also gehoert die Namenszeile wieder auf das Papier.
    let name = data.shop_name.trim();
    if !name.is_empty() {
        bold_on(&mut b);
        double_height_on(&mut b);
        for zeile in wrap(name, cols) {
            text_line(&mut b, &zeile);
        }
        double_height_off(&mut b);
        bold_off(&mut b);
    }

    // Auch die Anschrift wird umgebrochen. „Antiquitaeten · Briefmarken ·
    // Muenzen" sind 35 Zeichen und liefen auf 32 Spalten ueber — mitten im
    // Wort, gleich in der zweiten Zeile jedes Belegs.
    for line in &data.shop_address {
        for zeile in wrap(line, cols) {
            text_line(&mut b, &zeile);
        }
    }
    if let Some(phone) = &data.shop_phone {
        for zeile in wrap(&format!("Tel.: {phone}"), cols) {
            text_line(&mut b, &zeile);
        }
    }
    // Die Steuerkennung, mit ihrem EIGENEN Wort. Spiegel der Freigabe in
    // `shop-info.ts`: USt-IdNr. zuerst, sonst Steuernummer, sonst nichts.
    // ⚠️ Keine Kennung heisst KEINE Zeile — nichts wird erfunden.
    let ust = data.shop_vat_id.trim();
    let stnr = data.shop_tax_number.trim();
    let kennung: Option<(&str, &str)> = if !ust.is_empty() {
        Some(("USt-IdNr.", ust))
    } else if !stnr.is_empty() {
        Some(("Steuernummer", stnr))
    } else {
        None
    };
    if let Some((wort, wert)) = kennung {
        for zeile in wrap(&format!("{wort}: {wert}"), cols) {
            text_line(&mut b, &zeile);
        }
    }
    feed(&mut b, 1);

    // ── Belegart ────────────────────────────────────────────────────────────
    // Ein Ankaufbeleg NENNT SICH. Bis zum 25.07.2026 kannte diese Schicht das
    // Feld nicht und druckte ihn als gewoehnlichen Kassenbon — ein Dokument,
    // das aussieht wie ein Verkauf, obwohl das Haus gekauft hat.
    if ankauf {
        bold_on(&mut b);
        double_height_on(&mut b);
        text_line(&mut b, "ANKAUFBELEG");
        double_height_off(&mut b);
        bold_off(&mut b);
        feed(&mut b, 1);
    }
    align_left(&mut b);

    // ── Kennzahlen des Belegs ───────────────────────────────────────────────
    // Wort links, Wert rechts — dieselbe Spalte wie die Betraege weiter unten.
    // Vorher waren es fest gepolsterte Zeilen („Datum:     "), die bei 48
    // Spalten in der Mitte des Papiers geendet haetten.
    text_line(&mut b, &kv_row("Beleg-Nr.", &data.receipt_locator, cols));
    text_line(&mut b, &kv_row("Datum", &data.printed_at, cols));
    text_line(&mut b, &kv_row("Kassierer", &data.cashier_name, cols));
    if let Some(shift) = &data.shift_id {
        text_line(&mut b, &kv_row("Schicht", shift, cols));
    }
    // Der Verkaeufer gehoert auf einen Ankauf, sonst weiss niemand, von wem
    // gekauft wurde.
    if let Some(gegen) = &data.counterparty_label {
        let sauber = gegen.trim();
        if !sauber.is_empty() {
            for zeile in wrap(sauber, cols) {
                text_line(&mut b, &zeile);
            }
        }
    }
    rule(&mut b, cols);

    // ── Die Positionen ──────────────────────────────────────────────────────
    //
    // Der Aufbau folgt dem, was ein deutscher Kassenbon seit jeher tut:
    //
    //     Preussen 1867, 1 Silbergroschen,
    //     gestempelt                 48,00 A
    //       3 x 170,83              512,50
    //
    // Drei Dinge sind daran anders als vorher:
    //
    //   1. Der Name wird UMGEBROCHEN, nicht bei 32 Zeichen mit „…"
    //      abgeschnitten. Ein Bon hat Platz nach unten.
    //   2. Die Zeile mit Einzelpreis und Summe war 41 Zeichen lang und lief
    //      auf 32 Spalten ueber — auf JEDEM Beleg, bei JEDER Position. Sie ist
    //      jetzt aufgeteilt und passt in jede Breite.
    //   3. Die Steuerklasse steht direkt hinter dem Betrag, wie beim
    //      Lebensmittelhaendler, nicht am Ende einer ueberlaufenden Zeile.
    for item in &data.items {
        let steuer = item.vat_label.trim();
        let rechts = if steuer.is_empty() {
            format!("{} EUR", item.line_total_eur)
        } else {
            format!("{} EUR {steuer}", item.line_total_eur)
        };
        /*
         * Der Name bekommt die VOLLE Breite, nicht nur den Rest neben dem
         * Betrag.
         *
         * Der erste Anlauf reservierte den Platz des Betrags auf JEDER Zeile.
         * Bei 32 Spalten blieben 17 fuer den Namen, und
         * „Preussen 1867, 1 Silbergroschen, gestempelt, sehr gute Erhaltung"
         * zerfiel in VIER schmale Zeilen mit einer breiten leeren Spalte
         * daneben — im Papierbild sofort zu sehen, im Quelltext nicht.
         *
         * Jetzt laeuft der Name ueber die ganze Breite, und nur die LETZTE
         * Zeile teilt sich den Platz mit dem Betrag. Passt er dort nicht mehr,
         * bekommt er seine eigene rechtsbuendige Zeile — dieselbe Spalte wie
         * ueberall, nur eine Zeile tiefer.
         */
        let zeilen = wrap(&item.name, cols);
        let letzte = zeilen.len() - 1;
        for (i, zeile) in zeilen.iter().enumerate() {
            if i < letzte {
                text_line(&mut b, zeile);
                continue;
            }
            if zeile.chars().count() + 1 + rechts.chars().count() <= cols {
                text_line(&mut b, &kv_row(zeile, &rechts, cols));
            } else {
                text_line(&mut b, zeile);
                text_line(&mut b, &right_align(&rechts, cols));
            }
        }
        // Nur wenn es etwas zu rechnen gibt. Bei einem Einzelstueck ist
        // „1 x 48,00" gegenueber der Summe daneben reine Wiederholung.
        if item.quantity > 1 {
            text_line(
                &mut b,
                &format!("  {} x {} EUR", item.quantity, item.unit_price_eur),
            );
        }
    }
    rule(&mut b, cols);

    // ── Summen ──────────────────────────────────────────────────────────────
    // ⚠️ 14.08.2026 (0.6.0-Begehung): Die Zwischensumme ist das NETTO und
    // stand bedingungslos da. Wer Summe minus Zwischensumme rechnet, hat
    // die Margensteuer, deren gesonderten Ausweis § 14a Abs. 6 Satz 2 UStG
    // verbietet. Sie folgt jetzt demselben Schalter wie die Steuerzeile.
    if data.vat_disclosable_eur.is_some() {
        text_line(
            &mut b,
            &kv_row("Zwischensumme", &format!("{} EUR", data.subtotal_eur), cols),
        );
    }
    // ⚠️ Die Steuerzeile erscheint NUR, wenn sie erscheinen DARF.
    //
    // Bis zum 26.07.2026 stand hier bedingungslos `data.vat_eur`, also bei
    // Differenzbesteuerung die Margensteuer. § 14a Abs. 6 Satz 2 UStG
    // verbietet genau diesen gesonderten Ausweis; die Folge ist die
    // zusaetzlich geschuldete Steuer nach § 14c, die der Haendler dem
    // Finanzamt schuldet, ohne sie vom Kunden bekommen zu haben.
    //
    // Der Beleg widersprach sich dabei selbst: die Fusszeile sagte
    // „Vorsteuerabzug ist ausgeschlossen", drei Zeilen darueber stand der
    // Betrag, den der Kaeufer angeblich nicht ziehen darf.
    if let Some(ausweisbar) = data.vat_disclosable_eur.as_deref() {
        text_line(
            &mut b,
            &kv_row("MwSt.", &format!("{} EUR", ausweisbar), cols),
        );
    }
    // Die SUMME ist die eine Zahl, die der Mensch am Tresen prueft. Fett
    // allein hebt sie kaum ab; doppelte Hoehe schon, und sie kostet keine
    // Spalte (nur `GS ! 1`, nicht doppelte Breite — die halbierte die
    // Spaltenzahl und die Zeile liefe ueber).
    bold_on(&mut b);
    double_height_on(&mut b);
    text_line(
        &mut b,
        &kv_row("SUMME", &format!("{} EUR", data.total_eur), cols),
    );
    double_height_off(&mut b);
    bold_off(&mut b);
    feed(&mut b, 1);

    // ── Zahlung ─────────────────────────────────────────────────────────────
    text_line(&mut b, &kv_row("Zahlung", &data.payment_method_label, cols));
    if let Some(cash) = &data.cash_received_eur {
        text_line(
            &mut b,
            &kv_row("Bar erhalten", &format!("{cash} EUR"), cols),
        );
    }
    if let Some(change) = &data.change_eur {
        text_line(
            &mut b,
            &kv_row("Wechselgeld", &format!("{change} EUR"), cols),
        );
    }
    rule(&mut b, cols);

    // ── TSE ─────────────────────────────────────────────────────────────────
    // Ist die Sicherheitseinrichtung im Ausfall oder noch nicht eingerichtet,
    // sendet die App fuer JEDES Feld dasselbe Wort. Dann steht hier EIN
    // sauberer, gesetzlich geforderter Hinweis — nicht viermal „TSE Ausfall"
    // und ein QR-Code, der dieses Wort kodiert. Ein QR, wo keine Signatur ist,
    // waere eine gedruckte Behauptung.
    let tse_down = is_tse_down(&data.tse_signature_value)
        || is_tse_down(&data.tse_qr_payload)
        || data.tse_qr_payload.trim().is_empty();
    if tse_down {
        align_center(&mut b);
        bold_on(&mut b);
        text_line(&mut b, "TSE-Ausfall");
        bold_off(&mut b);
        // ⚠️ 11.08.2026: dieser Satz ist 39 Zeichen lang, 58-mm-Papier traegt
        // 32. Er ging ungebrochen an den Drucker, der ihn stumm mitten im
        // Wort umbrach — ausgerechnet der Satz, der den Ausfall der
        // Sicherheitseinrichtung erklaert. Auf 80 mm fiel es nie auf.
        //
        // WARUM NICHT kuerzen (wie es die Nachbarzeile „TSE-Pruefcode" tut):
        // dieser Satz ist der Hinweis selbst, kein Etikett. Er wird
        // UMGEBROCHEN, also geht kein Wort verloren, und er passt auf beide
        // Papierbreiten ohne zweite Fassung.
        for zeile in wrap("Sicherheitseinrichtung nicht verfuegbar", cols) {
            text_line(&mut b, &zeile);
        }
        align_left(&mut b);
        // ── § 6-Felder, die KEINE TSE brauchen (19.08.2026, Audit M1) ────
        //
        // Kassen-Seriennummer (Nr. 6, erste Haelfte) und Vorgangsbeginn
        // (Nr. 2) lebten nur im QR. Faellt die TSE aus, faellt der QR — und
        // der Bon war keiner Kasse mehr zuzuordnen, obwohl die Nummer im
        // Rumpf die ganze Zeit vorlag. Nur im Ausfall gedruckt: auf dem
        // gesunden Bon traegt sie weiterhin der QR, und das Papier bleibt
        // schlank.
        if let Some(nr) = data.kassen_seriennummer.as_deref().filter(|n| !n.is_empty()) {
            text_line(&mut b, &kv_row("Kasse Serien-Nr.", nr, cols));
        }
        if let Some(beginn) = data.vorgang_beginn.as_deref().filter(|v| !v.is_empty()) {
            text_line(&mut b, &kv_row("Vorgangsbeginn", beginn, cols));
            text_line(&mut b, &kv_row("Vorgangsende", &data.printed_at, cols));
        }
    } else {
        // Die Signatur ist lang und opak. Sie wird UMGEBROCHEN statt
        // abgeschnitten: eine halbe Signatur ist als Nachweis wertlos, und
        // genau dafuer steht sie auf dem Papier.
        text_line(&mut b, "TSE-Signatur:");
        for zeile in wrap_hard(&data.tse_signature_value, cols) {
            text_line(&mut b, &zeile);
        }
        text_line(
            &mut b,
            &kv_row("Signatur-Zaehler", &data.tse_signature_counter, cols),
        );
        text_line(
            &mut b,
            &kv_row("Trans-Nr.", &data.tse_transaction_number, cols),
        );

        // Der QR-Code, mittig, mit Luft darum und einer Beschriftung darunter.
        // Vorher klebte er ohne Abstand und ohne Wort am Text darueber; auf
        // Papier sah das aus wie ein Druckfehler, nicht wie ein Pruefzeichen.
        feed(&mut b, 1);
        align_center(&mut b);
        qr_code(&mut b, &data.tse_qr_payload, cols);
        // Kurz genug fuer 32 Spalten. „Pruefcode der Sicherheitseinrichtung"
        // waren 36 Zeichen und liefen ueber — ausgerechnet die Zeile, die den
        // Pruefcode erklaeren soll.
        text_line(&mut b, "TSE-Pruefcode");
        align_left(&mut b);
    }
    feed(&mut b, 1);

    /*
     * ── DER FUSS ────────────────────────────────────────────────────────────
     *
     * Vorher war er EIN Block: Dank und Steuerklausel standen unmittelbar
     * untereinander, in derselben Groesse, ohne Trennung vom TSE-Block
     * darueber. Auf Papier las sich das als ein einziger grauer Absatz, in dem
     * das Wichtige und das Pflichtgemaesse gleich schwer wogen.
     *
     * Jetzt sind es drei Dinge mit drei Gewichten:
     *
     *   1. Eine Trennlinie. Der Fuss beginnt sichtbar, statt aus dem
     *      Pruefcode herauszuwachsen.
     *   2. Der DANK in normaler Schrift, mit Luft darum. Er ist das, was der
     *      Mensch mitnimmt.
     *   3. Die RECHTSSAETZE in Schrift B — kleiner, ruhiger, und ein Drittel
     *      mehr Zeichen je Zeile. Die §25a-Klausel nahm in Schrift A vier
     *      Zeilen und schrie so laut wie der Dank; jetzt sind es zwei leise.
     *
     * Erkannt wird ein Rechtssatz an seinem Paragrafen — nicht an seiner
     * Stelle in der Liste. Der Inhaber ordnet die Zeilen im Belegdesigner frei
     * an, und eine Regel „die letzten zwei sind rechtlich" waere schon beim
     * naechsten Umsortieren falsch.
     */
    let ist_rechtssatz = |z: &str| {
        let t = z.to_lowercase();
        t.contains('\u{a7}') || t.contains("paragraf") || t.contains("ustg") || t.contains("gobd")
    };
    let dank: Vec<&String> = data
        .footer_lines
        .iter()
        .filter(|z| !ist_rechtssatz(z))
        .collect();

    // Die Hinweise zu den Sonderregelungen stehen VOR den freien Rechtssaetzen
    // und gehoeren in denselben Block: sie sind eine Pflichtangabe nach
    // § 14a Abs. 6 Satz 1 UStG, nicht Beiwerk.
    //
    // Sie werden bewusst NICHT durch `ist_rechtssatz` geschickt. Der
    // vorgeschriebene Begriff „Gebrauchtgegenstaende/Sonderregelung" enthaelt
    // weder ein Paragrafenzeichen noch „UStG" und waere von dieser Erkennung
    // faelschlich als Hoeflichkeitszeile eingestuft worden.
    let mut recht: Vec<&String> = data.special_scheme_notices.iter().collect();
    recht.extend(data.footer_lines.iter().filter(|z| ist_rechtssatz(z)));

    if !dank.is_empty() || !recht.is_empty() {
        rule(&mut b, cols);
        align_center(&mut b);

        let hatte_dank = !dank.is_empty();
        for line in dank {
            for zeile in wrap(line, cols) {
                text_line(&mut b, &zeile);
            }
        }

        if !recht.is_empty() {
            // Eine Leerzeile trennt die Hoeflichkeit von der Pflicht.
            if hatte_dank {
                // Eine Leerzeile nur, wenn darueber wirklich etwas stand.
                feed(&mut b, 1);
            }
            font_b_on(&mut b);
            let schmal = cols_font_b(cols);
            for line in recht {
                for zeile in wrap(line, schmal) {
                    text_line(&mut b, &zeile);
                }
            }
            font_b_off(&mut b);
        }
        align_left(&mut b);
    }

    // Vorschub bis ueber die Schneide, dann trennen. Drei Zeilen sind das
    // Mass, bei dem der Bon abreisst, ohne dass die naechste Zeile mitgeht.
    feed(&mut b, 3);

    // Full cut.
    b.extend_from_slice(&[GS, b'V', 0x00]);
    b
}

// ────────────────────────────────────────────────────────────────────────
// Das Logo-Werk (Basels Dekret, 26.07.2026): Haendler-Logo → `GS v 0`.
// ────────────────────────────────────────────────────────────────────────

/// Die Druckbreite der Rolle in Punkten. 58-mm-Papier (32 Spalten) traegt
/// 384 Punkte, 80-mm-Papier (48 Spalten) 576 — dieselbe Zuordnung, die auch
/// die Spaltenlogik (`cols_of`) kennt.
fn druckbreite_punkte(cols: usize) -> u32 {
    if cols >= 48 {
        576
    } else {
        384
    }
}

/// Der Hoehendeckel des Logos in Punkten. Ein turmhohes Logo wuerde sonst
/// eine Handbreit Papier je Bon verbrennen — der Deckel haelt den Kopf
/// kompakt, das Seitenverhaeltnis bleibt gewahrt.
const LOGO_HOEHE_DECKEL: u32 = 200;

/// Die Zielbreite des Logos: feste Anteile der Druckbreite („keine
/// Pixelfummelei fuer den Haendler"). Unbekanntes faellt auf mittel — im
/// Zweifel das unauffaellige Mass, nie ein Fehler.
fn logo_zielbreite(cols: usize, groesse: Option<&str>) -> u32 {
    let anteil = match groesse.map(str::trim) {
        Some("klein") => 40,
        Some("gross") => 80,
        _ => 60, // „mittel" und alles Unbekannte
    };
    druckbreite_punkte(cols) * anteil / 100
}

/// Das Haendler-Logo als fertiger `GS v 0`-Rasterbefehl fuer DIESE
/// Papierbreite — oder `None`, wenn keines mitkommt oder es nicht lesbar
/// ist. Ein kaputtes Logo darf den Beleg NIEMALS verhindern: der Bon druckt
/// dann ohne Bild, denn ein Kassenausfall wegen Kosmetik waere der
/// schlimmere Fehler.
fn logo_raster(data: &ThermalReceiptData, cols: usize) -> Option<Vec<u8>> {
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
    let roh = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
    let ziel_breite = logo_zielbreite(cols, data.logo_size.as_deref());
    let grau = match format.as_str() {
        // SVG wird fuer JEDE Breite frisch gerastert — nie ein skaliertes
        // Einheitsbild. Das ist der Praezisionsgewinn des Formats.
        "svg" => rastere_svg(&roh, ziel_breite, LOGO_HOEHE_DECKEL)?,
        "png" | "jpg" | "jpeg" => rastere_pixelbild(&roh, ziel_breite, LOGO_HOEHE_DECKEL)?,
        _ => return None,
    };
    Some(packe_gs_v0(&grau))
}

/// PNG/JPEG: dekodieren, im Seitenverhaeltnis auf Zielbreite und
/// Hoehendeckel skalieren, ueber Weiss legen.
fn rastere_pixelbild(roh: &[u8], ziel_breite: u32, hoehe_deckel: u32) -> Option<image::GrayImage> {
    let bild = image::load_from_memory(roh).ok()?;
    let (bw, bh) = (bild.width(), bild.height());
    if bw == 0 || bh == 0 {
        return None;
    }
    let massstab = (ziel_breite as f32 / bw as f32).min(hoehe_deckel as f32 / bh as f32);
    let w = ((bw as f32) * massstab).round().max(1.0) as u32;
    let h = ((bh as f32) * massstab).round().max(1.0) as u32;
    let rgba = image::imageops::resize(
        &bild.to_rgba8(),
        w,
        h,
        image::imageops::FilterType::Triangle,
    );
    Some(ueber_weiss(&rgba))
}

/// SVG: mit resvg fuer GENAU diese Zielbreite rastern. Systemschriften
/// werden geladen, damit ein Logo mit `<text>`-Elementen nicht stumm leer
/// bleibt.
fn rastere_svg(roh: &[u8], ziel_breite: u32, hoehe_deckel: u32) -> Option<image::GrayImage> {
    let mut optionen = resvg::usvg::Options::default();
    optionen.fontdb_mut().load_system_fonts();
    let baum = resvg::usvg::Tree::from_data(roh, &optionen).ok()?;
    let groesse = baum.size();
    if groesse.width() <= 0.0 || groesse.height() <= 0.0 {
        return None;
    }
    let massstab =
        (ziel_breite as f32 / groesse.width()).min(hoehe_deckel as f32 / groesse.height());
    let w = ((groesse.width() * massstab).round()).max(1.0) as u32;
    let h = ((groesse.height() * massstab).round()).max(1.0) as u32;
    let mut flaeche = resvg::tiny_skia::Pixmap::new(w, h)?;
    resvg::render(
        &baum,
        resvg::tiny_skia::Transform::from_scale(massstab, massstab),
        &mut flaeche.as_mut(),
    );
    let mut grau = image::GrayImage::new(w, h);
    for (i, px) in flaeche.pixels().iter().enumerate() {
        let c = px.demultiply();
        let a = c.alpha() as f32 / 255.0;
        let ueber = |v: u8| v as f32 * a + 255.0 * (1.0 - a);
        let hell = 0.299 * ueber(c.red()) + 0.587 * ueber(c.green()) + 0.114 * ueber(c.blue());
        grau.put_pixel(
            (i as u32) % w,
            (i as u32) / w,
            image::Luma([hell.round() as u8]),
        );
    }
    Some(grau)
}

/// Transparenz ueber WEISS legen und zur Helligkeit mischen — Thermopapier
/// kennt kein Alpha, und ein transparenter Hintergrund, der schwarz
/// gerechnet wird, ergaebe einen vollschwarzen Kasten statt eines Logos.
fn ueber_weiss(rgba: &image::RgbaImage) -> image::GrayImage {
    image::GrayImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let p = rgba.get_pixel(x, y).0;
        let a = p[3] as f32 / 255.0;
        let ueber = |c: u8| c as f32 * a + 255.0 * (1.0 - a);
        let hell = 0.299 * ueber(p[0]) + 0.587 * ueber(p[1]) + 0.114 * ueber(p[2]);
        image::Luma([hell.round() as u8])
    })
}

/// Graubild → `GS v 0`-Rasterbefehl. Schwellwert 128: heller ist Papier,
/// dunkler ist Punkt — 1 Bit je Punkt, MSB zuerst, Zeilen auf ganze Bytes
/// aufgefuellt (die Fuellbits bleiben weiss).
fn packe_gs_v0(grau: &image::GrayImage) -> Vec<u8> {
    let (w, h) = (grau.width() as usize, grau.height() as usize);
    let bytes_je_zeile = w.div_ceil(8);
    let mut aus = Vec::with_capacity(8 + bytes_je_zeile * h);
    aus.extend_from_slice(&[
        GS,
        b'v',
        b'0',
        0x00,
        (bytes_je_zeile & 0xFF) as u8,
        ((bytes_je_zeile >> 8) & 0xFF) as u8,
        (h & 0xFF) as u8,
        ((h >> 8) & 0xFF) as u8,
    ]);
    for y in 0..h {
        for bx in 0..bytes_je_zeile {
            let mut byte = 0u8;
            for bit in 0..8 {
                let x = bx * 8 + bit;
                if x < w && grau.get_pixel(x as u32, y as u32).0[0] < 128 {
                    byte |= 0x80 >> bit;
                }
            }
            aus.push(byte);
        }
    }
    aus
}

/// ⭐ DIE KODIERSEITE PC858 (CP858), Zeichen fuer Zeichen fuer die Bytes 0x80
/// bis 0xFE. Index i traegt das Zeichen des Bytes 0x80 + i.
///
/// ⚠️ 11.08.2026 — WAS DER BEFUND WAR: `encode_pc858` kannte 39 dieser 127
/// Zeichen, die uebrigen 86 fielen still in `_ => b'?'`. Ein franzoesischer
/// Kundenname mit `À`, ein Stueck mit `µ`, `±`, `¼`, `©` oder `®` — auf dem
/// Papier stand ein Fragezeichen, obwohl der Drucker das Zeichen kann. Der
/// Papiersimulator, aus dem die Belegdesigner-Vorschau lebt, kannte nur 11
/// Bytes zurueck: 28 RICHTIG gedruckte Zeichen zeigte die Vorschau als
/// Fragezeichen, log also gegen das Papier.
///
/// WARUM EINE TABELLE UND NICHT ZWEI LISTEN: Hinweg und Rueckweg als
/// getrennte `match`-Baeume driften auseinander — genau diese Drift IST der
/// Vorschau-Fund. Hier lesen beide dieselbe Reihe.
///
/// GEMESSEN, NICHT GERATEN — erzeugt aus der Kodierseite selbst:
///   python3 -c "print(''.join(bytes([b]).decode('cp858') for b in range(0x80,0xFF)))"
///
/// 0xFF (NO-BREAK SPACE) steht bewusst NICHT drin: es wird zum gewoehnlichen
/// Leerzeichen vereinfacht, damit auf dem Papier kein Byte steht, das je nach
/// Geraet blank oder als Zeichen herauskommt.
const PC858_HOHE_HAELFTE: [char; 127] = [
    'Ç', 'ü', 'é', 'â', 'ä', 'à', 'å', 'ç', // 0x80 bis 0x87
    'ê', 'ë', 'è', 'ï', 'î', 'ì', 'Ä', 'Å', // 0x88 bis 0x8F
    'É', 'æ', 'Æ', 'ô', 'ö', 'ò', 'û', 'ù', // 0x90 bis 0x97
    'ÿ', 'Ö', 'Ü', 'ø', '£', 'Ø', '×', 'ƒ', // 0x98 bis 0x9F
    'á', 'í', 'ó', 'ú', 'ñ', 'Ñ', 'ª', 'º', // 0xA0 bis 0xA7
    '¿', '®', '¬', '½', '¼', '¡', '«', '»', // 0xA8 bis 0xAF
    '░', '▒', '▓', '│', '┤', 'Á', 'Â', 'À', // 0xB0 bis 0xB7
    '©', '╣', '║', '╗', '╝', '¢', '¥', '┐', // 0xB8 bis 0xBF
    '└', '┴', '┬', '├', '─', '┼', 'ã', 'Ã', // 0xC0 bis 0xC7
    '╚', '╔', '╩', '╦', '╠', '═', '╬', '¤', // 0xC8 bis 0xCF
    'ð', 'Ð', 'Ê', 'Ë', 'È', '€', 'Í', 'Î', // 0xD0 bis 0xD7
    'Ï', '┘', '┌', '█', '▄', '¦', 'Ì', '▀', // 0xD8 bis 0xDF
    'Ó', 'ß', 'Ô', 'Ò', 'õ', 'Õ', 'µ', 'þ', // 0xE0 bis 0xE7
    'Þ', 'Ú', 'Û', 'Ù', 'ý', 'Ý', '¯', '´', // 0xE8 bis 0xEF
    '\u{00AD}', '±', '‗', '¾', '¶', '§', '÷', '¸', // 0xF0 bis 0xF7
    '°', '¨', '·', '¹', '³', '²', '■', // 0xF8 bis 0xFE
];

/// Encode a UTF-8 string to PC858 (CP858) bytes — the code page the printer was
/// put into (`ESC t 19`). Sending raw UTF-8 is what garbled the umlauts / middle
/// dot / Euro on the receipt (`ä` = UTF-8 `C3 A4` rendered as two PC858 glyphs).
///
/// Die Reihenfolge ist tragend: erst ASCII, dann die Zeichen, die BEWUSST
/// vereinfacht werden (typografische Satzzeichen, das echte Minuszeichen, das
/// geschuetzte Leerzeichen), dann die Kodierseite selbst, und erst danach das
/// Fragezeichen. Andersherum wuerden « und » als Kodierseiten-Bytes gedruckt
/// statt als Anfuehrungszeichen.
///
/// ⚠️ Jeder Zweig schreibt GENAU EIN Byte — bis auf `…`, das drei schreibt und
/// deshalb vor dem Umbruch aufgeloest wird (siehe `fuer_papier`). Ein Zeichen
/// ist eine Spalte: darauf steht die Zusicherung von `wrap`.
pub(crate) fn encode_pc858(s: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '\u{0}'..='\u{7F}' => out.push(ch as u8),
            // Typographic punctuation Word/macOS love to insert → ASCII.
            //
            // ⚠️ 11.08.2026: U+2212 MINUS SIGN gehoert hierher, nicht in den
            // Auffangzweig. Die Oberflaeche setzt fuer Rabatt und Gutschein
            // das echte Minuszeichen (BezahlenDialog.tsx:1139 und :1186), und
            // ohne diesen Zweig druckte JEDER geminderte Beleg
            // „(Rabatt ?50,00 €)". PC858 kennt U+2212 nicht; der ASCII-
            // Bindestrich 0x2D ist das, was die Kodierseite dafuer hat.
            '–' | '—' | '\u{2212}' => out.push(b'-'),
            // « und » KANN PC858 drucken (0xAE, 0xAF). Sie bleiben trotzdem
            // ASCII-Anfuehrungszeichen: sie kommen aus Textverarbeitungen als
            // Anfuehrungszeichen, und der Bon beschriftet deutsche Ware.
            '“' | '”' | '„' | '«' | '»' => out.push(b'"'),
            '‘' | '’' | '‚' => out.push(b'\''),
            '…' => out.extend_from_slice(b"..."),
            '\u{00A0}' => out.push(b' '), // non-breaking space
            _ => match PC858_HOHE_HAELFTE.iter().position(|&k| k == ch) {
                // ⚠️ 08.08.2026: bevor die ganze Kodierseite hier stand, fehlte
                // unter anderem U+00A7, und JEDES Paragrafenzeichen wurde zu
                // einem Fragezeichen. Betroffen waren keine Verzierungen,
                // sondern Pflichttexte: „Differenzbesteuerung nach § 25a
                // UStG.", „nach § 25c UStG.", „nach § 13b UStG.". Der Kunde
                // bekam ein Papier, auf dem die Rechtsgrundlage seines Belegs
                // als „?" stand.
                Some(i) => out.push(0x80 + i as u8),
                // Was die Kodierseite nicht hat, wird EIN Fragezeichen — nie
                // mehrere Bytes, sonst verrutscht die Spaltenrechnung.
                None => out.push(b'?'),
            },
        }
    }
    out
}

fn text_line(out: &mut Vec<u8>, s: &str) {
    out.extend_from_slice(&encode_pc858(s));
    out.push(b'\n');
}

/// True when a TSE field carries the "no TSE / Ausfall" sentinel the app sends in
/// test mode (empty or "TSE Ausfall"). A real signature/QR payload is long opaque
/// data and never matches, so this only fires when there is genuinely no TSE.
fn is_tse_down(field: &str) -> bool {
    let t = field.trim();
    t.is_empty() || t.eq_ignore_ascii_case("tse ausfall") || t.eq_ignore_ascii_case("ausfall")
}

fn feed(out: &mut Vec<u8>, lines: u8) {
    out.extend_from_slice(&[ESC, b'd', lines]);
}

fn align_left(out: &mut Vec<u8>) {
    out.extend_from_slice(&[ESC, b'a', 0]);
}
fn align_center(out: &mut Vec<u8>) {
    out.extend_from_slice(&[ESC, b'a', 1]);
}

fn bold_on(out: &mut Vec<u8>) {
    out.extend_from_slice(&[ESC, b'E', 1]);
}
fn bold_off(out: &mut Vec<u8>) {
    out.extend_from_slice(&[ESC, b'E', 0]);
}

/// Schrift B — die kleinere Type des Kopfes (9 mal 17 statt 12 mal 24 Punkte).
///
/// Sie traegt ein Drittel mehr Zeichen je Zeile und ist fuer den rechtlichen
/// Teil des Fusses gedacht: die Steuerklausel MUSS auf dem Beleg stehen, aber
/// sie ist nicht das, was der Mensch liest. In Schrift A nahm sie drei bis
/// vier Zeilen und wog genauso schwer wie der Dank.
fn font_b_on(out: &mut Vec<u8>) {
    out.extend_from_slice(&[ESC, b'M', 1]);
}
fn font_b_off(out: &mut Vec<u8>) {
    out.extend_from_slice(&[ESC, b'M', 0]);
}

/// Zeichen je Zeile in Schrift B. Das Verhaeltnis ist fest: 12 zu 9 Punkte
/// Breite, also vier Drittel. 32 wird zu 42, 48 zu 64.
fn cols_font_b(cols: usize) -> usize {
    cols * 4 / 3
}

/// Doppelte HOEHE, nicht doppelte Breite (`GS ! 0x01`, nicht `0x11`).
///
/// Der Unterschied entscheidet, ob die Zeile passt: doppelte Breite halbiert
/// die Spaltenzahl, und „SUMME              560,50 EUR" waere auf 16 Spalten
/// sofort ueber den Rand gelaufen. Doppelte Hoehe gibt der Zahl Gewicht und
/// laesst das Raster unberuehrt.
fn double_height_on(out: &mut Vec<u8>) {
    out.extend_from_slice(&[GS, b'!', 0x01]);
}
fn double_height_off(out: &mut Vec<u8>) {
    out.extend_from_slice(&[GS, b'!', 0x00]);
}

/// ⭐ EIN ZEICHEN IST EINE SPALTE — hier wird das wahr gemacht.
///
/// ⚠️ 11.08.2026 — WAS DER BEFUND WAR: `wrap`, `wrap_hard`, `kv_row` und
/// `right_align` zaehlen ZEICHEN, `encode_pc858` schreibt BYTES. Fuer jedes
/// Zeichen ist das eins zu eins — bis auf „…", das zu drei Bytes wird. Eine
/// Zeile, die `wrap` fuer genau 32 Spalten breit haelt, ging als 34 Bytes zum
/// Drucker und lief ueber. Die Zusicherung war still gebrochen.
///
/// WARUM NICHT „…" auf einen Punkt eindampfen: das waere eine andere Aussage
/// auf einem Kundendokument. Die drei Punkte werden aufgeloest, BEVOR
/// gemessen wird — danach ist jede Breite die echte.
///
/// Der Aufruf steht in JEDER messenden Funktion, nicht an den Aufrufstellen:
/// eine neue Aufrufstelle darf die Zusage nicht wieder verlieren koennen.
fn fuer_papier(text: &str) -> String {
    if text.contains('…') {
        text.replace('…', "...")
    } else {
        text.to_string()
    }
}

/// Harter Umbruch fuer eine Zeichenkette ohne Leerzeichen — eine TSE-Signatur
/// ist genau das. `wrap` haette sie als EIN Wort behandelt und hart geteilt;
/// das tut diese Funktion direkt und ohne Umweg.
fn wrap_hard(text: &str, cols: usize) -> Vec<String> {
    let text = fuer_papier(text);
    if cols == 0 {
        return vec![text];
    }
    let zeichen: Vec<char> = text.chars().collect();
    if zeichen.is_empty() {
        return vec![String::new()];
    }
    zeichen
        .chunks(cols)
        .map(|stueck| stueck.iter().collect())
        .collect()
}

/// Eine Trennlinie ueber die volle Papierbreite.
///
/// Vorher waren es fest 32 Striche mit dem Kommentar „passt auf 80 mm" — das
/// stimmt nicht: 80-mm-Papier traegt bei Schrift A 48 Zeichen, 32 ist die
/// Breite von 58-mm-Papier. Der Kommentar hat die Zahl erklaert, statt sie zu
/// pruefen.
fn rule(out: &mut Vec<u8>, cols: usize) {
    text_line(out, &"-".repeat(cols));
}

/// Wort links, Zahl rechts, ueber die volle Breite.
///
/// Passt beides zusammen nicht auf eine Zeile, wird NICHT mehr blind mit
/// einem Leerzeichen aneinandergehaengt (das ergab eine Zeile, die ueber das
/// Papier lief). Stattdessen bekommt die Zahl ihre eigene, rechtsbuendige
/// Zeile — dieselbe Spalte wie ueberall, nur eine Zeile tiefer.
fn kv_row(key: &str, value: &str, cols: usize) -> String {
    let key = fuer_papier(key);
    let value = fuer_papier(value);
    let (key, value) = (key.as_str(), value.as_str());
    let total_used = key.chars().count() + value.chars().count();
    if total_used >= cols {
        format!("{key}\n{}", right_align(value, cols))
    } else {
        let padding = " ".repeat(cols - total_used);
        format!("{key}{padding}{value}")
    }
}

/// Einen Text an den rechten Rand schieben. Laenger als das Papier: unveraendert
/// zurueck, denn Abschneiden waere hier ein stiller Datenverlust.
fn right_align(value: &str, cols: usize) -> String {
    let value = fuer_papier(value);
    let n = value.chars().count();
    if n >= cols {
        value
    } else {
        format!("{}{value}", " ".repeat(cols - n))
    }
}

/// Einen langen Namen UMBRECHEN statt abschneiden — an Wortgrenzen, wo es
/// geht.
///
/// Vorher schnitt `truncate` bei 32 Zeichen mit einem „…" ab. Dieses Haus
/// verkauft Stuecke mit Namen wie „Preussen 1867, 1 Silbergroschen,
/// gestempelt" — der Kunde bekam davon die Haelfte und drei Punkte. Ein
/// Kassenbon hat Platz nach unten, nicht nach rechts.
fn wrap(text: &str, cols: usize) -> Vec<String> {
    let text = fuer_papier(text);
    if cols == 0 {
        return vec![text];
    }
    let mut zeilen: Vec<String> = Vec::new();
    let mut jetzt = String::new();
    for wort in text.split_whitespace() {
        let laenge = wort.chars().count();
        // Ein einzelnes Wort, das breiter ist als das Papier (eine lange
        // Artikelnummer), wird hart geteilt — sonst waere es die eine Zeile,
        // die doch ueberlaeuft.
        if laenge > cols {
            if !jetzt.is_empty() {
                zeilen.push(std::mem::take(&mut jetzt));
            }
            let zeichen: Vec<char> = wort.chars().collect();
            for stueck in zeichen.chunks(cols) {
                zeilen.push(stueck.iter().collect());
            }
            continue;
        }
        if jetzt.is_empty() {
            jetzt = wort.to_string();
        } else if jetzt.chars().count() + 1 + laenge <= cols {
            jetzt.push(' ');
            jetzt.push_str(wort);
        } else {
            zeilen.push(std::mem::take(&mut jetzt));
            jetzt = wort.to_string();
        }
    }
    if !jetzt.is_empty() {
        zeilen.push(jetzt);
    }
    if zeilen.is_empty() {
        zeilen.push(String::new());
    }
    zeilen
}

/// Emit a QR code via the GS ( k ESC/POS extension. Most modern printers
/// support it; older ones will print garbage, which is acceptable for V1
/// (the QR is supplementary — the human-readable TSE block above carries
/// the same data).
fn qr_code(out: &mut Vec<u8>, payload: &str, cols: usize) {
    let p = payload.as_bytes();
    // Set model: GS ( k 4 0 49 65 50 0
    out.extend_from_slice(&[GS, b'(', b'k', 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
    /*
     * Modulgroesse in Punkten.
     *
     * Der Kopf druckt 8 Punkte je Zeichen, also 256 Punkte auf 58 mm und 384
     * auf 80 mm. Ein DSFinV-K-Bezug ist rund 350 Bytes und ergibt Version 14:
     * 73 Module. Bei Modul 4 waeren das 292 Punkte — auf schmalem Papier
     * BREITER ALS DIE ROLLE, und der Drucker schneidet rechts ab. Genau so
     * entsteht ein QR, der gedruckt aussieht und von keinem Geraet gelesen
     * wird.
     *
     * Auf 58 mm faellt die Modulgroesse deshalb auf 3. 73 mal 3 = 219 Punkte,
     * das passt mit Rand. Auf 80 mm bleiben es 4 fuer ein ruhig lesbares Bild.
     */
    let modul: u8 = if cols >= 48 { 4 } else { 3 };
    out.extend_from_slice(&[GS, b'(', b'k', 0x03, 0x00, 0x31, 0x43, modul]);
    // Set error correction: M
    out.extend_from_slice(&[GS, b'(', b'k', 0x03, 0x00, 0x31, 0x45, 0x31]);
    // Store data: GS ( k (len + 3) 0 49 80 48 <payload>
    let plen = p.len() + 3;
    out.extend_from_slice(&[
        GS,
        b'(',
        b'k',
        (plen & 0xFF) as u8,
        ((plen >> 8) & 0xFF) as u8,
        0x31,
        0x50,
        0x30,
    ]);
    out.extend_from_slice(p);
    // Print: GS ( k 3 0 49 81 48
    out.extend_from_slice(&[GS, b'(', b'k', 0x03, 0x00, 0x31, 0x51, 0x30]);
    out.push(b'\n');
}

// ════════════════════════════════════════════════════════════════════════
// DER PAPIERSIMULATOR
//
// Basel am 25.07.2026: „محتاج نشوف كل شي كيف يعمل، محاكاة لكل شي بشكل
// طبيعي" — er will sehen, wie es wirklich aussieht, bevor Papier
// durchlaeuft. Und am 26.07.2026 (Dekret, Logo-Werk): die Live-Vorschau
// im Belegdesigner MUSS aus den ECHTEN ESC/POS-Bytes kommen, nicht aus
// einer zweiten Nachbildung.
//
// Deshalb lebt der Simulator seit dem 26.07.2026 NICHT mehr im Testmodul:
// er ist jetzt der eine Uebersetzer von Bytes zu Papier, den Tests UND die
// Oberflaeche (ueber `preview_thermal_receipt`) benutzen. Er liest keine
// Absichten, sondern Bytes: er folgt denselben Steuerzeichen wie das
// Geraet und kann deshalb nicht mit dem Aufbau auseinanderlaufen.
// ════════════════════════════════════════════════════════════════════════

/// Eine Zeile, wie sie aus dem Kopf kommt. Serialisierbar, weil die
/// Belegdesigner-Vorschau genau diese Zeilen anzeigt.
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Papierzeile {
    pub text: String,
    pub mittig: bool,
    pub fett: bool,
    pub doppelt_hoch: bool,
    /// Schrift B traegt ein Drittel mehr Zeichen je Zeile. Ohne diese
    /// Angabe haelt der Breiten-Waechter eine voellig korrekte Zeile fuer
    /// einen Ueberlauf — genau das ist beim Umbau des Fusses passiert.
    pub schrift_b: bool,
    /// Ein `GS v 0`-Rasterbild (das Logo): die ECHTEN Bits aus dem Strom,
    /// als PNG verpackt und base64-kodiert, damit die Vorschau das
    /// endgueltige Druckbild zeigt — nicht einen Platzhalter.
    pub raster_png_base64: Option<String>,
    pub raster_breite_punkte: Option<u32>,
    pub raster_hoehe_punkte: Option<u32>,
    /// Der Inhalt des QR-Codes, wenn diese Zeile der QR-Druckbefehl ist.
    /// Die Vorschau zeichnet daraus denselben Code, den der Drucker druckt.
    pub qr_daten: Option<String>,
}

/// Der Bytestrom, zurueckuebersetzt in Papier.
pub fn simuliere(bytes: &[u8]) -> Vec<Papierzeile> {
    let mut zeilen = Vec::new();
    let mut jetzt = Vec::<u8>::new();
    let mut mittig = false;
    let mut fett = false;
    let mut doppelt = false;
    let mut schrift_b = false;
    // Der zuletzt GESPEICHERTE QR-Inhalt. Der Druckbefehl selbst traegt
    // keine Daten; sie kommen aus dem Speicherbefehl davor.
    let mut qr_wartend: Option<String> = None;
    let mut i = 0usize;

    let abschliessen = |roh: &mut Vec<u8>,
                        zeilen: &mut Vec<Papierzeile>,
                        mittig: bool,
                        fett: bool,
                        doppelt: bool,
                        schrift_b: bool| {
        if roh.is_empty() {
            return;
        }
        zeilen.push(Papierzeile {
            text: dekodiere_pc858(roh),
            mittig,
            fett,
            doppelt_hoch: doppelt,
            schrift_b,
            ..Papierzeile::default()
        });
        roh.clear();
    };

    while i < bytes.len() {
        let byte = bytes[i];
        match byte {
            ESC if i + 1 < bytes.len() => {
                match bytes[i + 1] {
                    b'@' => i += 2, // Init
                    b't' => i += 3, // Zeichensatz
                    b'd' => {
                        // Vorschub: so viele Leerzeilen, wie angefordert.
                        abschliessen(&mut jetzt, &mut zeilen, mittig, fett, doppelt, schrift_b);
                        let n = bytes[i + 2];
                        for _ in 0..n {
                            zeilen.push(Papierzeile::default());
                        }
                        i += 3;
                    }
                    b'a' => {
                        abschliessen(&mut jetzt, &mut zeilen, mittig, fett, doppelt, schrift_b);
                        mittig = bytes[i + 2] == 1;
                        i += 3;
                    }
                    b'E' => {
                        fett = bytes[i + 2] == 1;
                        i += 3;
                    }
                    b'M' => {
                        // ESC M 1 = Schrift B, ESC M 0 = Schrift A.
                        schrift_b = bytes[i + 2] == 1;
                        i += 3;
                    }
                    _ => i += 2,
                }
            }
            GS if i + 1 < bytes.len() => match bytes[i + 1] {
                b'!' => {
                    doppelt = bytes[i + 2] & 0x01 == 1;
                    i += 3;
                }
                b'V' => i += 3, // Schnitt
                b'v' => {
                    // Das Logo als Rasterbild. Seit dem 26.07.2026 werden die
                    // ECHTEN Bits mitgenommen (vorher nur ein Platzhaltertext):
                    // die Vorschau soll das endgueltige Druckbild zeigen.
                    abschliessen(&mut jetzt, &mut zeilen, mittig, fett, doppelt, schrift_b);
                    /*
                     * `GS v 0` ist DREI Bytes — die 0 ist das Zeichen
                     * '0' (0x30) und gehoert zum Befehl. Danach erst
                     * kommt der Modus, dann Breite und Hoehe:
                     *
                     *   1D 76 30 | m | xL xH | yL yH | Daten
                     *
                     * Beim ersten Anlauf las ich xL eine Stelle zu
                     * frueh. Ergebnis: eine Bildlaenge von 28 Millionen
                     * Bytes, der Zeiger sprang hinter das Ende, und der
                     * Simulator zeigte NUR das Zeichen und sonst leeres
                     * Papier — ohne Fehler, ohne Warnung. Genau die Art
                     * Fehler, die ein Simulator finden soll und selber
                     * haben kann.
                     */
                    let xl = bytes.get(i + 4).copied().unwrap_or(0) as usize;
                    let xh = bytes.get(i + 5).copied().unwrap_or(0) as usize;
                    let yl = bytes.get(i + 6).copied().unwrap_or(0) as usize;
                    let yh = bytes.get(i + 7).copied().unwrap_or(0) as usize;
                    let bytes_je_zeile = xl + xh * 256;
                    let hoehe = yl + yh * 256;
                    let laenge = bytes_je_zeile * hoehe;
                    let daten = bytes.get(i + 8..i + 8 + laenge).unwrap_or(&[]);
                    let breite = (bytes_je_zeile * 8) as u32;
                    zeilen.push(Papierzeile {
                        text: format!("[ LOGO {breite}x{hoehe} ]"),
                        mittig,
                        raster_png_base64: raster_als_png_base64(daten, bytes_je_zeile, hoehe),
                        raster_breite_punkte: Some(breite),
                        raster_hoehe_punkte: Some(hoehe as u32),
                        ..Papierzeile::default()
                    });
                    i += 8 + laenge;
                }
                b'(' => {
                    // GS ( k — die QR-Befehle. Nur der Druckbefehl (49 81)
                    // erzeugt sichtbares Papier; der Speicherbefehl (49 80)
                    // traegt die Daten, die die Vorschau zum Zeichnen braucht.
                    let pl = bytes.get(i + 3).copied().unwrap_or(0) as usize
                        + bytes.get(i + 4).copied().unwrap_or(0) as usize * 256;
                    // GS ( k pL pH cn fn … — cn steht auf i+5, fn auf i+6.
                    // Auch hier las ich zuerst eine Stelle zu spaet, und der
                    // QR fehlte im Papierbild vollstaendig.
                    let ist_speicher =
                        bytes.get(i + 5) == Some(&0x31) && bytes.get(i + 6) == Some(&0x50);
                    let ist_druck =
                        bytes.get(i + 5) == Some(&0x31) && bytes.get(i + 6) == Some(&0x51);
                    if ist_speicher && pl >= 3 {
                        // Nutzlast: pl minus cn, fn, m.
                        if let Some(nutz) = bytes.get(i + 8..i + 5 + pl) {
                            qr_wartend = Some(String::from_utf8_lossy(nutz).into_owned());
                        }
                    }
                    if ist_druck {
                        abschliessen(&mut jetzt, &mut zeilen, mittig, fett, doppelt, schrift_b);
                        zeilen.push(Papierzeile {
                            text: "[ QR-CODE ]".into(),
                            mittig: true,
                            qr_daten: qr_wartend.take(),
                            ..Papierzeile::default()
                        });
                    }
                    i += 5 + pl;
                }
                _ => i += 2,
            },
            b'\n' => {
                abschliessen(&mut jetzt, &mut zeilen, mittig, fett, doppelt, schrift_b);
                i += 1;
            }
            _ => {
                jetzt.push(byte);
                i += 1;
            }
        }
    }
    abschliessen(&mut jetzt, &mut zeilen, mittig, fett, doppelt, schrift_b);
    zeilen
}

/// Die echten Rasterbits aus dem Strom als PNG, base64-kodiert. `None` bei
/// verstuemmelten Laengen — eine Vorschau, die aus zu kurzen Daten still ein
/// halbes Bild baut, wuerde genau die Fehler verdecken, die sie finden soll.
fn raster_als_png_base64(daten: &[u8], bytes_je_zeile: usize, hoehe: usize) -> Option<String> {
    use base64::Engine as _;
    if bytes_je_zeile == 0 || hoehe == 0 || daten.len() < bytes_je_zeile * hoehe {
        return None;
    }
    let breite = (bytes_je_zeile * 8) as u32;
    let bild = image::GrayImage::from_fn(breite, hoehe as u32, |x, y| {
        let byte = daten[y as usize * bytes_je_zeile + (x as usize) / 8];
        let schwarz = byte & (0x80 >> (x % 8)) != 0;
        image::Luma([if schwarz { 0u8 } else { 255 }])
    });
    let mut puffer = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageLuma8(bild)
        .write_to(&mut puffer, image::ImageFormat::Png)
        .ok()?;
    Some(base64::engine::general_purpose::STANDARD.encode(puffer.into_inner()))
}

/// PC858 zurueck nach UTF-8 — der Rueckweg des Kodierers.
///
/// ⚠️ 11.08.2026 — WAS DER BEFUND WAR: hier stand eine eigene, viel kuerzere
/// Liste mit elf Zeichen. Die Belegdesigner-Vorschau lebt von dieser Zeile
/// (`preview_thermal_receipt` → `simuliere` → hier), also zeigte sie 28
/// Zeichen als Fragezeichen, die auf dem Papier RICHTIG herauskamen. Eine
/// Vorschau, die schlechter aussieht als das Papier, ist so unbrauchbar wie
/// eine, die besser aussieht: der Haendler kann ihr nicht glauben.
///
/// WARUM NICHT die Liste ergaenzen: zwei Listen driften wieder auseinander.
/// Hin- und Rueckweg lesen jetzt dieselbe Reihe `PC858_HOHE_HAELFTE`.
///
/// 0xFF erzeugt der Kodierer nie (siehe dort), es bleibt darum ein ehrliches
/// Fragezeichen statt einer erfundenen Glyphe.
fn dekodiere_pc858(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|&b| match b {
            0x00..=0x7F => b as char,
            0x80..=0xFE => PC858_HOHE_HAELFTE[(b - 0x80) as usize],
            _ => '?',
        })
        .collect()
}

/// Das Papier als Text, mit Rand — so wie es aus dem Schlitz kommt.
pub fn als_papier(bytes: &[u8], cols: usize) -> String {
    let mut aus = String::new();
    aus.push_str(&format!("+{}+\n", "-".repeat(cols + 2)));
    for z in simuliere(bytes) {
        for teil in if z.text.is_empty() {
            vec![String::new()]
        } else {
            vec![z.text.clone()]
        } {
            // Mittig: die Einrueckung ist Teil der Breite, nicht
            // zusaetzlich zu ihr — sonst zeigt der Rahmen eine Spalte mehr,
            // als das Papier hat, und der Wächter darüber würde eine
            // überlaufende Zeile für normal halten.
            let n = teil.chars().count();
            let sichtbar: String = if z.mittig && n < cols {
                let links = (cols - n) / 2;
                format!(
                    "{}{teil}{}",
                    " ".repeat(links),
                    " ".repeat(cols - n - links)
                )
            } else {
                teil
            };
            let marke = if z.doppelt_hoch {
                "="
            } else if z.schrift_b {
                "."
            } else if z.fett {
                "*"
            } else {
                " "
            };
            // Der Rahmen ist auf Schrift A gezeichnet. Eine Zeile in
            // Schrift B ist SCHMALER gesetzt und darf deshalb ueber den
            // gezeichneten Rand hinausragen — auf Papier passt sie. Das
            // Zeichen „." in der Randspalte sagt genau das, damit das Bild
            // nicht wie ein Ueberlauf aussieht.
            aus.push_str(&format!("|{marke}{sichtbar:<cols$}|\n", cols = cols));
        }
    }
    aus.push_str(&format!("+{}+\n", "-".repeat(cols + 2)));
    aus
}

/// Die Vorschau des Belegdesigners: derselbe Datensatz wie beim Drucken, aber
/// statt zum Geraet gehen die Bytes durch den Simulator zurueck aufs Papier.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalPreview {
    /// Die Spaltenzahl, auf der die Zeilen gerechnet sind (32 oder 48).
    pub paper_cols: usize,
    pub zeilen: Vec<Papierzeile>,
}

/// Basels Dekret (26.07.2026, Logo-Werk): der Haendler sieht SOFORT das
/// ENDGUELTIGE Druckbild, ohne Probebons. Dieser Befehl baut EXAKT denselben
/// Bytestrom wie `print_thermal_receipt` und uebersetzt ihn zurueck in
/// Papierzeilen — ohne zu drucken, ohne zweite Nachbildung.
#[tauri::command]
pub fn preview_thermal_receipt(data: ThermalReceiptData) -> ThermalPreview {
    let cols = cols_of(&data);
    let bytes = build_escpos(&data);
    ThermalPreview {
        paper_cols: cols,
        zeilen: simuliere(&bytes),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pc858_maps_german_glyphs_and_euro_not_raw_utf8() {
        // The bug: raw UTF-8 sent to a PC858 printer garbled umlauts/·/€.
        // ä=0x84, ü=0x81, ö=0x94, ß=0xE1, ·=0xFA, €=0xD5 in PC858.
        assert_eq!(
            encode_pc858("Antiquitäten · Münzen ß €"),
            vec![
                b'A', b'n', b't', b'i', b'q', b'u', b'i', b't', 0x84, b't', b'e', b'n', b' ', 0xFA,
                b' ', b'M', 0x81, b'n', b'z', b'e', b'n', b' ', 0xE1, b' ', 0xD5,
            ],
        );
        // Pure ASCII is byte-identical.
        assert_eq!(
            encode_pc858("Beleg-Nr.: RCP-1"),
            b"Beleg-Nr.: RCP-1".to_vec()
        );
        // Typographic junk degrades to ASCII, never multi-byte garbage.
        assert_eq!(encode_pc858("„x“ — y…"), b"\"x\" - y...".to_vec());
        // An unmappable char becomes a single '?', never desyncing columns.
        assert_eq!(encode_pc858("☃"), vec![b'?']);
    }

    /// ⛔ DAS VORZEICHEN DER MINDERUNG ERREICHT DAS PAPIER.
    ///
    /// BEFUND: die Oberflaeche setzt fuer Rabatt und Gutschein U+2212
    /// (MINUS SIGN), nicht den ASCII-Bindestrich — `BezahlenDialog.tsx:1139`
    /// und `:1186`. `encode_pc858` hatte fuer U+2212 keinen Zweig, also fiel
    /// es in `_ => b'?'`. Auf Papier stand „(Rabatt ?50,00 €)".
    ///
    /// WARUM NICHT die Oberflaeche auf einen Bindestrich umstellen: der Bon
    /// ist nicht der einzige Leser dieser Texte, und das naechste U+2212 aus
    /// einer anderen Feder faellt wieder still um. Der Kodierer ist die
    /// Stelle, an der Zeichen auf Bytes treffen.
    ///
    /// GEMESSEN werden die BYTES: kein 0x3F im Strom, und der 0x2D steht an
    /// genau der Stelle, an der das Vorzeichen stand.
    #[test]
    fn das_minuszeichen_der_minderung_wird_kein_fragezeichen() {
        // U+2212, buchstabengetreu wie die Oberflaeche es sendet.
        let roh = "Rabatt \u{2212}50,00 EUR";
        let bytes = encode_pc858(roh);
        assert!(
            !bytes.contains(&0x3F),
            "das Vorzeichen wurde zu einem Fragezeichen: {:?}",
            String::from_utf8_lossy(&bytes)
        );
        assert_eq!(bytes, b"Rabatt -50,00 EUR".to_vec());

        // Und im ECHTEN Strom, an der Positionszeile, wo der Finder es sah.
        let mut d = sample("qr", "sig");
        d.items = vec![ThermalLineItem {
            name: "Ring (Rabatt \u{2212}50,00 €)".into(),
            quantity: 1,
            unit_price_eur: "1.200,00".into(),
            line_total_eur: "1.200,00".into(),
            vat_label: "A".into(),
        }];
        let papier = als_papier(&build_escpos(&d), 32);
        assert!(
            papier.contains("(Rabatt -50,00 €)"),
            "das Vorzeichen fehlt auf dem Papier:\n{papier}"
        );
    }

    /// ⛔ DIE GANZE KODIERSEITE, IN BEIDE RICHTUNGEN.
    ///
    /// BEFUND (11.08.2026): `encode_pc858` kannte 39 der 127 Zeichen, die
    /// PC858 auf den Bytes 0x80 bis 0xFE wirklich drucken kann. Die
    /// uebrigen 86 fielen still in `_ => b'?'` — ein Kunde aus Frankreich
    /// (`Rue de la Paix`, `À`), ein Stueck mit `µ`, `±`, `¼`, `©` oder `®`
    /// im Namen: alles Fragezeichen. Und der Papiersimulator, aus dem die
    /// Belegdesigner-Vorschau lebt, kannte nur 11 davon zurueck: die
    /// Vorschau zeigte 28 RICHTIG gedruckte Zeichen als Fragezeichen, log
    /// also gegen das Papier.
    ///
    /// WARUM NICHT einfach mehr Zweige anhaengen: zwei getrennte Listen
    /// driften auseinander, und genau diese Drift IST der Vorschau-Fund.
    /// Hin- und Rueckweg teilen sich deshalb EINE Tabelle.
    ///
    /// GEMESSEN wird gegen eine UNABHAENGIGE Abschrift der Kodierseite —
    /// erzeugt aus der Kodierseite selbst, nicht aus dem Gedaechtnis:
    ///
    ///   python3 -c "print(''.join(bytes([b]).decode('cp858') \
    ///               for b in range(0x80,0xFF)))"
    ///
    /// Zeichen i dieser Reihe gehoert auf Byte 0x80 + i.
    #[test]
    fn die_ganze_kodierseite_traegt_und_kommt_zurueck() {
        const KODIERSEITE: &str = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐\
                                   └┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈ€ÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u{00AD}±‗¾¶§÷¸°¨·¹³²■";
        assert_eq!(
            KODIERSEITE.chars().count(),
            127,
            "die Abschrift ist unvollstaendig"
        );

        let mut hinweg: Vec<String> = Vec::new();
        let mut rueckweg: Vec<String> = Vec::new();
        for (i, ch) in KODIERSEITE.chars().enumerate() {
            let byte = 0x80u8 + i as u8;
            // 0xAE und 0xAF sind « und ». Sie werden BEWUSST zum ASCII-
            // Anfuehrungszeichen vereinfacht (der Zweig darueber), weil sie
            // aus Textverarbeitungen als Anfuehrungszeichen kommen und der
            // Bon deutsche Ware beschriftet. Kein Fragezeichen, also kein
            // Befund — aber auch keine Rueckkehr.
            if byte == 0xAE || byte == 0xAF {
                assert_eq!(encode_pc858(&ch.to_string()), vec![b'"']);
                continue;
            }
            if encode_pc858(&ch.to_string()) != vec![byte] {
                hinweg.push(format!("0x{byte:02X}={ch:?}"));
            }
            if dekodiere_pc858(&[byte]) != ch.to_string() {
                rueckweg.push(format!("0x{byte:02X}={ch:?}"));
            }
        }
        assert!(
            hinweg.is_empty(),
            "{} Zeichen, die PC858 drucken KANN, macht der Kodierer zum Fragezeichen: {}",
            hinweg.len(),
            hinweg.join(" ")
        );
        assert!(
            rueckweg.is_empty(),
            "{} Zeichen zeigt die Vorschau falsch, obwohl sie richtig gedruckt werden: {}",
            rueckweg.len(),
            rueckweg.join(" ")
        );
    }

    #[test]
    fn tse_down_detects_the_ausfall_sentinel_not_a_real_signature() {
        assert!(is_tse_down("TSE Ausfall"));
        assert!(is_tse_down("tse ausfall"));
        assert!(is_tse_down("Ausfall"));
        assert!(is_tse_down("   "));
        assert!(is_tse_down(""));
        // A real (long, opaque) TSE signature/QR payload is NOT "down".
        assert!(!is_tse_down(
            "1.0,2026-06-16T18:11:24Z,ecdsa-plain-SHA256,Aj8kP9q...base64..."
        ));
    }

    /// ⛔ DAS PARAGRAFENZEICHEN ERREICHT DAS PAPIER.
    ///
    /// Gemessen am 08.08.2026: `encode_pc858` hatte keinen Zweig für U+00A7,
    /// also fiel jedes § in den Auffangzweig `_ => b'?'`. Betroffen waren
    /// Pflichttexte, keine Verzierung:
    ///
    ///     „Differenzbesteuerung nach § 25a UStG."  →  „... nach ? 25a UStG."
    ///
    /// Gemessen wird POSITIV: das Byte IM Strom und das Zeichen AUF dem
    /// simulierten Papier.
    #[test]
    fn das_paragrafenzeichen_erreicht_das_papier() {
        let mut d = sample("qr", "sig");
        d.footer_lines = vec!["Differenzbesteuerung nach § 25a UStG.".into()];
        let bytes = build_escpos(&d);
        assert!(
            bytes.contains(&0xF5),
            "das PC858-Byte fuer das Paragrafenzeichen fehlt im Strom"
        );
        assert!(
            als_papier(&bytes, 32).contains('§'),
            "der Papiersimulator zeigt kein Paragrafenzeichen"
        );
    }

    /// ⛔ DIE STEUERKENNUNG TRÄGT IHR EIGENES WORT.
    ///
    /// Vorher druckte der Bon bedingungslos „USt-IdNr.: " — bei einem
    /// Händler ohne USt-IdNr. also eine BEHAUPTETE Kennung ohne Wert. Die
    /// Steuernummer kam nie an: das Feld fehlte in der Rust-Struktur, und
    /// serde verwarf es still.
    #[test]
    fn die_steuerkennung_traegt_ihr_eigenes_wort() {
        // Nur Steuernummer: sie steht da, mit ihrem Wort.
        let mut d = sample("qr", "sig");
        d.shop_vat_id = String::new();
        d.shop_tax_number = "93815/08152".into();
        assert!(
            als_papier(&build_escpos(&d), 32).contains("Steuernummer: 93815/08152"),
            "die Steuernummer erreicht das Papier nicht"
        );

        // USt-IdNr. hat Vorrang, und BEIDE zusammen erscheinen nie.
        d.shop_vat_id = "DE123456789".into();
        let papier = als_papier(&build_escpos(&d), 32);
        assert!(papier.contains("USt-IdNr.: DE123456789"));
        assert!(
            !papier.contains("93815/08152"),
            "beide Kennungen auf einem Beleg"
        );

        // ⚠️ Und ohne beides: KEINE Zeile. Nichts wird erfunden.
        d.shop_vat_id = String::new();
        d.shop_tax_number = String::new();
        let leer = als_papier(&build_escpos(&d), 32);
        assert!(
            !leer.contains("USt-IdNr."),
            "der Bon behauptet eine leere USt-IdNr."
        );
        assert!(
            !leer.contains("Steuernummer"),
            "der Bon behauptet eine leere Steuernummer"
        );
    }

    /// ── § 6-Felder auf dem AUSFALL-Bon (19.08.2026, Audit M1) ────────────
    ///
    /// Faellt die TSE aus, faellt der QR — und mit ihm fielen bis heute die
    /// Kassen-Seriennummer (§ 6 Nr. 6, erste Haelfte) und die Vorgangszeiten
    /// (§ 6 Nr. 2), obwohl KEINES davon die TSE braucht. Der Ausfall-Bon war
    /// keiner Kasse zuzuordnen. Gesund traegt der QR beides weiter, und das
    /// Papier bleibt schlank — der zweite Satz prueft genau das.
    #[test]
    fn ausfall_bon_traegt_seriennummer_und_vorgangszeiten() {
        let mut d = sample("TSE Ausfall", "TSE Ausfall");
        d.kassen_seriennummer = Some("GERAET-0815".into());
        d.vorgang_beginn = Some("27.05.2026 16:39".into());
        let papier = als_papier(&build_escpos(&d), 32);
        assert!(papier.contains("GERAET-0815"), "Seriennummer fehlt im Ausfall-Bon");
        assert!(papier.contains("Vorgangsbeginn"), "Vorgangsbeginn fehlt im Ausfall-Bon");
        assert!(papier.contains("Vorgangsende"), "Vorgangsende fehlt im Ausfall-Bon");
    }

    #[test]
    fn gesunder_bon_bleibt_schlank_der_qr_traegt_die_felder() {
        let mut d = sample("V0;K;Kassenbeleg-V1;...", "echte-signatur");
        d.kassen_seriennummer = Some("GERAET-0815".into());
        d.vorgang_beginn = Some("27.05.2026 16:39".into());
        let papier = als_papier(&build_escpos(&d), 32);
        assert!(!papier.contains("GERAET-0815"));
        assert!(!papier.contains("Vorgangsbeginn"));
    }

    fn sample(tse_qr: &str, tse_sig: &str) -> ThermalReceiptData {
        ThermalReceiptData {
            shop_name: "WAREHOUSE 14".into(),
            shop_address: vec![
                "Antiquitäten · Briefmarken · Münzen".into(),
                "Kirchgasse 14".into(),
                "73614 Schorndorf".into(),
            ],
            shop_vat_id: "DE123456789".into(),
            shop_tax_number: String::new(),
            shop_phone: Some("+49 7181 0".into()),
            receipt_locator: "RCP-1".into(),
            printed_at: "16.06.2026 18:11".into(),
            kassen_seriennummer: None,
            vorgang_beginn: None,
            cashier_name: "Roman".into(),
            shift_id: None,
            items: vec![ThermalLineItem {
                name: "Münze".into(),
                quantity: 1,
                unit_price_eur: "0,95".into(),
                line_total_eur: "0,95".into(),
                vat_label: "A".into(),
            }],
            subtotal_eur: "0,95".into(),
            vat_eur: "0,00".into(),
            vat_disclosable_eur: None,
            special_scheme_notices: vec![],
            total_eur: "0,95".into(),
            payment_method_label: "Bar".into(),
            cash_received_eur: Some("5,00".into()),
            change_eur: Some("4,05".into()),
            tse_signature_value: tse_sig.into(),
            tse_signature_counter: "5".into(),
            tse_transaction_number: "60".into(),
            tse_qr_payload: tse_qr.into(),
            footer_lines: vec!["Danke für Ihren Einkauf".into()],
            document_kind: None,
            counterparty_label: None,
            paper_cols: None,
            logo_bytes_base64: None,
            logo_format: None,
            logo_size: None,
        }
    }

    /// ⚠️ DER WAECHTER GEGEN § 14c.
    ///
    /// Bis zum 26.07.2026 druckte diese Funktion bedingungslos eine Zeile
    /// „MwSt. X EUR". Bei Differenzbesteuerung ist das der nach
    /// § 14a Abs. 6 Satz 2 UStG VERBOTENE gesonderte Steuerausweis, und die
    /// Folge ist die zusaetzlich geschuldete Steuer nach § 14c: der Haendler
    /// schuldet dem Finanzamt einen Betrag, den er vom Kunden nie bekommen hat.
    ///
    /// Es gab keinen Test, der das verboten haette. Das Haus wusste sogar
    /// davon (docs/fiskal/recherche/differenzbesteuerung-25a.md, „Befund C")
    /// und forderte genau diesen Waechter.
    #[test]
    fn kein_gesonderter_steuerausweis_bei_differenzbesteuerung() {
        let mut d = sample("QR", "SIG");
        // Ein Stueck fuer 1.000 Euro mit 700 Euro Einstand: Margensteuer
        // 47,90. Genau diese Zahl stand bisher auf dem Beleg.
        d.vat_eur = "47,90".into();
        d.vat_disclosable_eur = None; // nichts ausweisbar
        d.special_scheme_notices = vec![
            "Gebrauchtgegenstände/Sonderregelung".into(),
            "Differenzbesteuerung nach § 25a UStG.".into(),
        ];

        let out = build_escpos(&d);
        let text = String::from_utf8_lossy(&out);

        // Weder das Wort noch der Betrag duerfen auftauchen.
        assert!(
            !text.contains("MwSt."),
            "die Steuerzeile steht auf dem Beleg"
        );
        assert!(
            !text.contains("47,90"),
            "die Margensteuer steht auf dem Beleg"
        );
    }

    /// Und die zweite Haelfte des Gesetzes: der Hinweis ist PFLICHT
    /// (§ 14a Abs. 6 Satz 1 UStG), nicht Beiwerk. Ein Beleg ohne ihn ist
    /// unvollstaendig, auch wenn die Steuer korrekt weggelassen wurde.
    #[test]
    fn der_vorgeschriebene_hinweis_steht_auf_dem_beleg() {
        let mut d = sample("QR", "SIG");
        d.vat_disclosable_eur = None;
        d.special_scheme_notices = vec!["Gebrauchtgegenstände/Sonderregelung".into()];

        let out = build_escpos(&d);
        // Der Beleg ist PC858 kodiert, deshalb wortweise pruefen: „Sonderregelung"
        // traegt kein Sonderzeichen und ueberlebt die Kodierung unveraendert.
        let text = String::from_utf8_lossy(&out);
        assert!(
            text.contains("Sonderregelung"),
            "der vorgeschriebene Hinweis fehlt auf dem Beleg"
        );
    }

    /// Sitzung A bat um genau diese Pruefung (KOORDINATION §11.4): seit dem
    /// 13b-Fix liefert der Server einen WOERTLICHEN Nachweis der EU-Abfrage
    /// (`belegvermerk`), und vorher stand auf JEDEM § 13b-Beleg „Nachweis der
    /// EU-Abfrage FEHLT.", auch wenn die Abfrage gueltig war. § 6a Abs. 4 UStG
    /// schuetzt den guten Glauben nur bei BELEGTER Sorgfalt — bei einer
    /// Pruefung liegt der gedruckte Beleg auf dem Tisch, nicht der Bildschirm.
    /// Hier faehrt der ECHTE Bytestrom, kein Blick auf die Vorschau.
    #[test]
    fn der_eu_abfrage_nachweis_erreicht_das_papier() {
        let mut d = sample("QR", "SIG");
        d.special_scheme_notices = vec![
            "Steuerschuldnerschaft des Leistungsempfaengers".into(),
            "USt-IdNr. DE811907980 - EU-Abfrage vom 23.07.2026 - gueltig".into(),
        ];

        let out = build_escpos(&d);
        let text = String::from_utf8_lossy(&out);
        // Wortweise pruefen (PC858 + Zeilenumbruch): jedes Fragment muss da sein.
        for teil in ["DE811907980", "EU-Abfrage", "23.07.2026"] {
            assert!(
                text.contains(teil),
                "Nachweis-Fragment fehlt auf dem Papier: {teil}"
            );
        }
        // Und die alte Luege darf NICHT mehr daneben stehen.
        assert!(
            !text.contains("FEHLT"),
            "der alte FEHLT-Vermerk steht noch auf dem Beleg"
        );
    }

    /// Die Gegenprobe: bei Regelbesteuerung MUSS die Steuer weiterhin
    /// erscheinen. Ein Waechter, der alles unterdrueckt, waere genauso falsch.
    #[test]
    fn regelbesteuerung_weist_die_steuer_weiterhin_aus() {
        let mut d = sample("QR", "SIG");
        d.vat_disclosable_eur = Some("19,00".into());
        d.special_scheme_notices = vec![];

        let out = build_escpos(&d);
        let text = String::from_utf8_lossy(&out);
        assert!(
            text.contains("MwSt."),
            "die Steuerzeile fehlt bei Regelware"
        );
        assert!(
            text.contains("19,00"),
            "der Steuerbetrag fehlt bei Regelware"
        );
    }

    #[test]
    fn build_escpos_pc858_encodes_tagline_prints_name_and_cleans_ausfall() {
        let out = build_escpos(&sample("TSE Ausfall", "TSE Ausfall"));
        // Die Zeile des Hauses ist PC858 kodiert.
        //
        // GEPRÜFT WIRD JETZT WORTWEISE, nicht als ein Stück: seit dem
        // 25.07.2026 wird die Anschrift umgebrochen, weil
        // „Antiquitäten · Briefmarken · Münzen" 35 Zeichen sind und auf 32
        // Spalten überlief. Ein zusammenhängender Bytelauf über die ganze
        // Zeile kann es deshalb nicht mehr geben — die alte Zusicherung prüfte
        // in Wahrheit die AbwesenheIT des Umbruchs, nicht die Kodierung.
        for wort in ["Antiquitäten", "Briefmarken", "Münzen"] {
            let kodiert = encode_pc858(wort);
            assert!(
                out.windows(kodiert.len()).any(|w| w == kodiert.as_slice()),
                "{wort} steht PC858-kodiert auf dem Beleg"
            );
        }
        // … and NO raw UTF-8 ä (C3 A4) ever reaches the PC858 printer.
        assert!(
            !out.windows(2).any(|w| w == [0xC3, 0xA4]),
            "no raw-UTF-8 umlaut leaked to the printer"
        );
        // GEDREHT am 26.07.2026 (Dekret): bis dahin trug das eingebrannte
        // Raster den Namen, und diese Zusicherung VERBOT die Textzeile. Das
        // Raster ist raus, ein Haendler-Logo traegt den Namen nicht zwingend
        // — also MUSS `shop_name` jetzt als Text auf dem Beleg stehen.
        let ascii = String::from_utf8_lossy(&out);
        assert!(
            ascii.contains("WAREHOUSE 14"),
            "der Ladenname steht als Text auf dem Beleg"
        );
        // Ausfall → ONE clean note, NOT the four-line signature block.
        //
        // ⚠️ 11.08.2026: der Hinweis wird auf 58-mm-Papier UMGEBROCHEN (39
        // Zeichen auf 32 Spalten), also gibt es ihn nicht mehr als einen
        // zusammenhaengenden Bytelauf. Er wird aus den Papierzeilen wieder
        // zusammengesetzt — so misst diese Zusicherung den SATZ und nicht
        // nebenbei die Abwesenheit eines Umbruchs.
        let satz = simuliere(&out)
            .into_iter()
            .map(|z| z.text)
            .collect::<Vec<_>>()
            .join(" ");
        assert!(
            satz.contains("Sicherheitseinrichtung nicht verfuegbar"),
            "der Ausfallhinweis fehlt oder ist zerrissen:\n{satz}"
        );
        assert!(!ascii.contains("TSE-Signatur:"));
        assert!(!ascii.contains("Signatur-Z"));
    }

    /// Ein Beleg, der die schwierigen Faelle traegt: ein sehr langer Name, eine
    /// Menge groesser eins, eine echte TSE-Signatur, ein langer Fusstext.
    fn harter_beleg(cols: Option<usize>) -> ThermalReceiptData {
        let mut d = sample(
            "V0;BSP-KASSE-01;Kassenbeleg-V1;Beleg^560.50_0.00_0.00_0.00_0.00^560.50:Bar;16;19;\
             2026-07-25T09:12:00.000Z;2026-07-25T09:12:02.000Z;ecdsa-plain-SHA256;unixTime;\
             MEUCIQDx3lKjT8Qm2vN0pR4sV7bYcW9eL1nZfH6uA5gK8jD2wAIgP1qT7mE0rY4sX9cB3nV6hJ2kL8pW5tR0uZ7iQ4dF3aE=",
            "MEUCIQDx3lKjT8Qm2vN0pR4sV7bYcW9eL1nZfH6uA5gK8jD2wAIgP1qT7mE0rY4sX9cB3nV6hJ2kL8pW5tR0uZ7iQ4dF3aE=",
        );
        d.paper_cols = cols;
        d.items = vec![
            ThermalLineItem {
                name: "Preussen 1867, 1 Silbergroschen, gestempelt, sehr gute Erhaltung".into(),
                quantity: 1,
                unit_price_eur: "48,00".into(),
                line_total_eur: "48,00".into(),
                vat_label: "A".into(),
            },
            ThermalLineItem {
                // ⚠️ 11.08.2026: die Auslassungspunkte gehoeren in die Vorlage.
                // Sie zaehlen EINE Spalte und schreiben DREI Bytes — genau der
                // Fall, den der Breiten-Waechter nie zu sehen bekam.
                name: "20 Mark Kaiserreich Wilhelm II … 1913 gepraegt".into(),
                quantity: 3,
                unit_price_eur: "170,83".into(),
                line_total_eur: "512,50".into(),
                vat_label: "".into(),
            },
        ];
        d.subtotal_eur = "560,50".into();
        d.total_eur = "560,50".into();
        d.footer_lines = vec![
            "Danke fuer Ihren Einkauf".into(),
            "Differenzbesteuerung nach Paragraf 25a UStG, kein gesonderter Steuerausweis".into(),
        ];
        d
    }

    /// DER WÄCHTER.
    ///
    /// Am 25.07.2026 war die Positionszeile 41 Zeichen lang und lief auf 32
    /// Spalten ueber — auf JEDEM Beleg, bei JEDER Position. Der Drucker bricht
    /// so etwas stumm um, mitten in einer Zahl. Nichts hat gewarnt: der Aufbau
    /// war ein `format!`, und ein `format!` hat keine Breite.
    ///
    /// ⚠️ 11.08.2026 — DIE LUECKE DES WAECHTERS: seine Vorlage `harter_beleg`
    /// setzte IMMER eine echte Signatur, also lief er nie durch den
    /// TSE-Ausfall-Zweig. Genau dort stand „Sicherheitseinrichtung nicht
    /// verfuegbar", 39 Zeichen auf 32 Spalten Papier. Solange keine TSE
    /// eingerichtet ist, traegt JEDER Beleg diese Zeile. Der Waechter laeuft
    /// jetzt durch BEIDE Zustaende der Sicherheitseinrichtung.
    #[test]
    fn keine_zeile_ist_breiter_als_das_papier() {
        for spalten in [None, Some(32usize), Some(48usize)] {
            for tse_faellt_aus in [false, true] {
                let mut daten = harter_beleg(spalten);
                if tse_faellt_aus {
                    // Wortgetreu das, was die Oberflaeche ohne TSE sendet
                    // (BezahlenDialog.tsx: alle vier Felder „TSE Ausfall").
                    daten.tse_signature_value = "TSE Ausfall".into();
                    daten.tse_signature_counter = "TSE Ausfall".into();
                    daten.tse_transaction_number = "TSE Ausfall".into();
                    daten.tse_qr_payload = "TSE Ausfall".into();
                }
                let cols = cols_of(&daten);
                let bytes = build_escpos(&daten);
                for zeile in simuliere(&bytes) {
                    // Jede Zeile wird gegen IHRE Breite gehalten: Schrift B traegt
                    // ein Drittel mehr. Ein fester Vergleich gegen `cols` haette
                    // den kleiner gesetzten Rechtssatz faelschlich verurteilt.
                    let erlaubt = if zeile.schrift_b {
                        cols_font_b(cols)
                    } else {
                        cols
                    };
                    let n = zeile.text.chars().count();
                    assert!(
                        n <= erlaubt,
                        "Zeile laeuft ueber das Papier ({n} Zeichen, erlaubt {erlaubt}, \
                         TSE-Ausfall={tse_faellt_aus}): {:?}",
                        zeile.text
                    );
                }
            }
        }
    }

    /// ⛔ EIN ZEICHEN IST EINE SPALTE — AUCH DIE AUSLASSUNGSPUNKTE.
    ///
    /// BEFUND (11.08.2026): `wrap` zaehlt Zeichen, `encode_pc858` schreibt
    /// Bytes. Fuer JEDES Zeichen ist das eins zu eins — bis auf „…", das zu
    /// drei Bytes wird. Eine Zeile, die `wrap` fuer genau 32 Spalten breit
    /// haelt, geht als 34 Bytes zum Drucker und laeuft ueber. Die
    /// Zusicherung von `wrap` war damit gebrochen, still.
    ///
    /// WARUM NICHT „…" auf einen Punkt eindampfen: das waere eine andere
    /// Aussage auf einem Kundendokument. Die drei Punkte werden aufgeloest,
    /// BEVOR gemessen wird.
    ///
    /// GEMESSEN werden die BYTES der Zeile, nicht ihre Zeichen.
    #[test]
    fn die_auslassungspunkte_zaehlen_so_viel_wie_sie_drucken() {
        // Genau 32 Zeichen, mit den Auslassungspunkten als letztem Wort.
        let text = "20 Mark Kaiserreich Wilhelm II … 1913 gepraegt";
        for zeile in wrap(text, 32) {
            let bytes = encode_pc858(&zeile);
            assert!(
                bytes.len() <= 32,
                "wrap verspricht 32 Spalten, an den Drucker gehen {} Bytes: {:?}",
                bytes.len(),
                zeile
            );
        }
        // Dasselbe fuer die rechtsbuendige Spalte und die Wort-Zahl-Zeile.
        assert!(encode_pc858(&right_align("…12,34", 32)).len() <= 32);
        for zeile in kv_row("Rabatt…", "…5,00 EUR", 32).lines() {
            assert!(
                encode_pc858(zeile).len() <= 32,
                "kv_row laeuft ueber: {zeile:?}"
            );
        }
    }

    /// Ein langer Name wird UMGEBROCHEN, nicht mit „…" abgeschnitten. Der
    /// Kunde bekommt sonst die Haelfte dessen, was er gekauft hat.
    #[test]
    fn ein_langer_name_wird_umgebrochen_statt_abgeschnitten() {
        let bytes = build_escpos(&harter_beleg(None));
        let papier: Vec<String> = simuliere(&bytes).into_iter().map(|z| z.text).collect();
        let alles = papier.join("\n");
        assert!(!alles.contains('…'), "kein Abschneiden mehr");
        // Beide Haelften des Namens stehen auf dem Papier.
        assert!(alles.contains("Preussen 1867"), "Anfang des Namens");
        assert!(alles.contains("Erhaltung"), "Ende des Namens");
    }

    /// Bei einer Menge groesser eins steht der EINZELPREIS da. Vorher gab es
    /// nur „3 x Name" und eine Summe — nachrechnen war unmoeglich.
    #[test]
    fn eine_menge_groesser_eins_zeigt_den_einzelpreis() {
        let bytes = build_escpos(&harter_beleg(None));
        let alles: String = simuliere(&bytes)
            .into_iter()
            .map(|z| z.text)
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            alles.contains("3 x 170,83 EUR"),
            "Einzelpreis der Dreierposition"
        );
        // Beim Einzelstueck bleibt die Wiederholung weg.
        assert!(
            !alles.contains("1 x 48,00"),
            "beim Einzelstueck bleibt die Mengenzeile weg"
        );
    }

    /// Die SUMME traegt doppelte Hoehe — sie ist die eine Zahl, die geprueft
    /// wird. Fett allein hebt sie auf Thermopapier kaum ab.
    #[test]
    fn die_summe_steht_in_doppelter_hoehe() {
        let bytes = build_escpos(&harter_beleg(None));
        let summe = simuliere(&bytes)
            .into_iter()
            .find(|z| z.text.starts_with("SUMME"))
            .expect("die SUMME steht auf dem Beleg");
        assert!(summe.doppelt_hoch, "die SUMME ist doppelt hoch");
        assert!(summe.fett, "und fett");
        assert!(summe.text.trim_end().ends_with("560,50 EUR"));
    }

    /// Ein Ankaufbeleg NENNT SICH und nennt den Verkaeufer. Bis zum
    /// 25.07.2026 kannte diese Schicht die Felder gar nicht und druckte ihn
    /// als gewoehnlichen Kassenbon.
    #[test]
    fn ein_ankaufbeleg_nennt_sich_und_den_verkaeufer() {
        let mut d = harter_beleg(None);
        d.document_kind = Some("ANKAUF".into());
        d.counterparty_label = Some("Verkaeufer: Hans Mustermann".into());
        let alles: String = simuliere(&build_escpos(&d))
            .into_iter()
            .map(|z| z.text)
            .collect::<Vec<_>>()
            .join("\n");
        assert!(alles.contains("ANKAUFBELEG"), "die Ueberschrift");
        assert!(alles.contains("Hans Mustermann"), "der Verkaeufer");

        // Und ein VERKAUF traegt beides NICHT.
        let verkauf: String = simuliere(&build_escpos(&harter_beleg(None)))
            .into_iter()
            .map(|z| z.text)
            .collect::<Vec<_>>()
            .join("\n");
        assert!(!verkauf.contains("ANKAUFBELEG"));
    }

    /// Die TSE-Signatur wird vollstaendig gedruckt. Eine halbe Signatur ist
    /// als Nachweis wertlos — und genau dafuer steht sie auf dem Papier.
    #[test]
    fn die_tse_signatur_wird_vollstaendig_gedruckt() {
        let d = harter_beleg(None);
        let erwartet = d.tse_signature_value.clone();
        let bytes = build_escpos(&d);
        // Der Umbruch trennt sie in Zeilen; wieder zusammengesetzt muss sie
        // Zeichen fuer Zeichen dieselbe sein.
        let zusammen: String = simuliere(&bytes)
            .into_iter()
            .map(|z| z.text)
            .collect::<Vec<_>>()
            .join("");
        assert!(
            zusammen.contains(&erwartet),
            "die Signatur steht ungekuerzt auf dem Papier"
        );
    }

    /// Auf schmalem Papier wird der QR KLEINER gerechnet. Bei Modul 4 waere
    /// ein 350-Byte-Bezug (Version 14, 73 Module) 292 Punkte breit — mehr als
    /// die 256 Punkte einer 58-mm-Rolle. Der Drucker schneidet dann rechts ab,
    /// und der Code ist gedruckt, aber unlesbar.
    #[test]
    fn der_qr_passt_auf_die_schmale_rolle() {
        let schmal = build_escpos(&harter_beleg(Some(32)));
        let breit = build_escpos(&harter_beleg(Some(48)));
        // GS ( k 3 0 49 67 <modul>
        let modul = |b: &[u8]| -> u8 {
            b.windows(8)
                .find(|w| {
                    w[0] == GS && w[1] == b'(' && w[2] == b'k' && w[5] == 0x31 && w[6] == 0x43
                })
                .map(|w| w[7])
                .expect("die Groessenangabe des QR steht im Strom")
        };
        assert_eq!(modul(&schmal), 3, "58 mm: Modul 3");
        assert_eq!(modul(&breit), 4, "80 mm: Modul 4");
    }

    /// Eine unbekannte Spaltenzahl faellt auf 32 zurueck, statt eine krumme
    /// Breite zu erfinden, an der jede Ausrichtung zerbricht.
    #[test]
    fn eine_unbekannte_papierbreite_faellt_ehrlich_zurueck() {
        let mut d = harter_beleg(Some(37));
        assert_eq!(cols_of(&d), 32);
        d.paper_cols = None;
        assert_eq!(cols_of(&d), 32);
        d.paper_cols = Some(48);
        assert_eq!(cols_of(&d), 48);
    }

    /// Das Papier zum Ansehen. Laeuft mit:
    ///     cargo test -p norns-pos druckbild -- --nocapture
    #[test]
    fn druckbild() {
        for cols in [32usize, 48usize] {
            let bytes = build_escpos(&harter_beleg(Some(cols)));
            println!("\n══ {cols} Spalten ══");
            println!("{}", als_papier(&bytes, cols));
        }
        let mut ankauf = harter_beleg(Some(32));
        ankauf.document_kind = Some("ANKAUF".into());
        ankauf.counterparty_label = Some("Verkaeufer: Hans Mustermann".into());
        println!("\n══ Ankaufbeleg, 32 Spalten ══");
        println!("{}", als_papier(&build_escpos(&ankauf), 32));
    }

    // ════════════════════════════════════════════════════════════════════
    // DAS LOGO-WERK (Basels Dekret, 26.07.2026)
    //
    // Alle Beweise laufen ueber den Papiersimulator: er liest Bytes, nicht
    // Absichten — genau deshalb ist er der Beweisapparat.
    // ════════════════════════════════════════════════════════════════════

    fn als_base64(bytes: &[u8]) -> String {
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    /// Ein vollschwarzes PNG in gewuenschter Groesse — reicht, um Rasterung,
    /// Skalierung und Schwellwert zu beweisen.
    fn test_png(w: u32, h: u32) -> Vec<u8> {
        let bild = image::RgbaImage::from_pixel(w, h, image::Rgba([0, 0, 0, 255]));
        let mut puffer = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(bild)
            .write_to(&mut puffer, image::ImageFormat::Png)
            .expect("PNG-Erzeugung im Test");
        puffer.into_inner()
    }

    const TEST_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#000"/></svg>"##;

    fn raster_zeile(bytes: &[u8]) -> Option<Papierzeile> {
        simuliere(bytes)
            .into_iter()
            .find(|z| z.raster_breite_punkte.is_some())
    }

    /// Dekret Punkt 3, Vorgabe ohne eigenes Logo: KEIN fremdes Logo, ganz
    /// oben die feine Systemzeile „norns.de", darunter der Name des Ladens
    /// als Text. Vorher: eingebranntes Warehouse-14-Raster, und `shop_name`
    /// wurde nie gelesen.
    #[test]
    fn ohne_logo_norns_zeile_dann_ladenname_und_kein_bild() {
        let bytes = build_escpos(&sample("QR", "SIG"));
        let zeilen = simuliere(&bytes);
        let erste = zeilen
            .iter()
            .find(|z| !z.text.trim().is_empty())
            .expect("der Beleg hat sichtbare Zeilen");
        assert_eq!(
            erste.text.trim(),
            "norns.de",
            "die Systemzeile steht ganz oben"
        );
        assert!(erste.mittig, "die Systemzeile steht mittig");
        assert!(
            erste.schrift_b,
            "die Systemzeile ist klein gesetzt (Schrift B)"
        );
        assert!(
            zeilen.iter().all(|z| z.raster_breite_punkte.is_none()),
            "ohne hochgeladenes Logo liegt KEIN Rasterbild im Strom"
        );
        let alles: String = zeilen
            .iter()
            .map(|z| z.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            alles.contains("WAREHOUSE 14"),
            "der Ladenname wird jetzt WIRKLICH gedruckt"
        );
    }

    /// Dekret Punkt 2: das eingebrannte Warehouse-14-Logo ist RAUS. Der
    /// Beweis laeuft ueber die Bytes selbst: die ersten 64 Byte der alten
    /// Binaerdatei (Kopf + erste Rasterzeilen) duerfen im Strom nicht mehr
    /// vorkommen — mit und ohne Haendler-Logo.
    #[test]
    fn das_eingebrannte_logo_liegt_nicht_mehr_im_strom() {
        const ALTES_LOGO: &[u8] = include_bytes!("../../assets/logo-escpos.bin");
        let probe = &ALTES_LOGO[..64];
        let ohne = build_escpos(&sample("QR", "SIG"));
        assert!(
            !ohne.windows(probe.len()).any(|w| w == probe),
            "das eingebrannte Logo liegt noch im Strom (ohne Haendler-Logo)"
        );
        let mut mit = sample("QR", "SIG");
        mit.logo_bytes_base64 = Some(als_base64(&test_png(300, 100)));
        mit.logo_format = Some("png".into());
        let mit = build_escpos(&mit);
        assert!(
            !mit.windows(probe.len()).any(|w| w == probe),
            "das eingebrannte Logo liegt noch im Strom (mit Haendler-Logo)"
        );
    }

    /// Ein PNG-Logo wird gerastert: mittig, hoechstens Druckbreite, und in
    /// der festen Groesse „mittel" (60 % von 384 = 230 Punkte, auf ganze
    /// Rasterbytes 232). Die Hoehe folgt dem Seitenverhaeltnis (300 x 100
    /// beim Massstab 230/300 → 77).
    #[test]
    fn ein_png_logo_wird_gerastert_zentriert_und_passt_aufs_papier() {
        let mut d = sample("QR", "SIG");
        d.logo_bytes_base64 = Some(als_base64(&test_png(300, 100)));
        d.logo_format = Some("png".into());
        let bytes = build_escpos(&d);
        let raster = raster_zeile(&bytes).expect("ein Raster liegt im Strom");
        assert!(raster.mittig, "das Logo steht mittig");
        let b = raster.raster_breite_punkte.unwrap();
        let h = raster.raster_hoehe_punkte.unwrap();
        assert!(b <= 384, "das Raster ist nie breiter als die Rolle ({b})");
        assert_eq!(
            (b, h),
            (232, 77),
            "feste Groesse mittel, Seitenverhaeltnis gewahrt"
        );
        assert!(
            raster.raster_png_base64.is_some(),
            "die Vorschau bekommt die echten Bits"
        );
    }

    /// SVG — „die praeziseste Form" — wird fuer JEDE Papierbreite FRISCH
    /// gerastert: 58 mm (384 Punkte) und 80 mm (576 Punkte) ergeben zwei
    /// verschiedene Raster, beide innerhalb ihrer Rolle.
    #[test]
    fn ein_svg_logo_wird_je_papierbreite_frisch_gerastert() {
        let mut breiten = Vec::new();
        for (cols, druckbreite) in [(32usize, 384u32), (48, 576)] {
            let mut d = sample("QR", "SIG");
            d.paper_cols = Some(cols);
            d.logo_bytes_base64 = Some(als_base64(TEST_SVG.as_bytes()));
            d.logo_format = Some("svg".into());
            let raster = raster_zeile(&build_escpos(&d))
                .unwrap_or_else(|| panic!("bei {cols} Spalten liegt ein Raster im Strom"));
            let b = raster.raster_breite_punkte.unwrap();
            assert!(
                b <= druckbreite,
                "{cols} Spalten: {b} Punkte laufen ueber {druckbreite}"
            );
            assert!(
                raster.raster_hoehe_punkte.unwrap() <= 200,
                "der Hoehendeckel gilt auch hier"
            );
            breiten.push(b);
        }
        assert_ne!(
            breiten[0], breiten[1],
            "zwei Breiten, zwei frische Rasterungen"
        );
    }

    /// Der Hoehendeckel: ein turmhohes Logo (100 x 800) wuerde ungebremst
    /// 1840 Punkte hoch — fast ein Viertelmeter Papier. Der Deckel haelt es
    /// bei 200 Punkten, die Breite schrumpft im Verhaeltnis mit.
    #[test]
    fn der_hoehendeckel_haelt_ein_turmhohes_logo_klein() {
        let mut d = sample("QR", "SIG");
        d.logo_bytes_base64 = Some(als_base64(&test_png(100, 800)));
        d.logo_format = Some("png".into());
        let raster = raster_zeile(&build_escpos(&d)).expect("ein Raster liegt im Strom");
        assert!(
            raster.raster_hoehe_punkte.unwrap() <= 200,
            "der Hoehendeckel greift"
        );
        assert!(raster.raster_breite_punkte.unwrap() <= 384);
    }

    /// Ein kaputtes Logo (verstuemmeltes base64, Bytes die kein Bild sind)
    /// darf den Beleg NIEMALS verhindern — der Bon druckt dann ohne Bild.
    /// Ein Beleg, der am Logo scheitert, waere ein Kassenausfall wegen
    /// Kosmetik.
    #[test]
    fn ein_kaputtes_logo_verhindert_den_beleg_nicht() {
        let mut d = sample("QR", "SIG");
        d.logo_bytes_base64 = Some("das-ist-kein-base64!!!".into());
        d.logo_format = Some("png".into());
        let zeilen = simuliere(&build_escpos(&d));
        assert!(
            zeilen.iter().all(|z| z.raster_breite_punkte.is_none()),
            "kein halbes Bild"
        );
        let alles: String = zeilen
            .iter()
            .map(|z| z.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            alles.contains("SUMME"),
            "der Beleg selbst wird trotzdem gebaut"
        );

        // Und gueltiges base64, dessen Inhalt kein Bild ist:
        d.logo_bytes_base64 = Some(als_base64(b"kein bild"));
        let zeilen = simuliere(&build_escpos(&d));
        assert!(zeilen.iter().all(|z| z.raster_breite_punkte.is_none()));
    }

    /// Die Vorschau des Belegdesigners kommt aus DEMSELBEN Bytestrom wie der
    /// Druck: gleicher Datensatz, gleiche Zeilen, inklusive Systemzeile und
    /// echtem QR-Inhalt.
    #[test]
    fn die_vorschau_liefert_die_zeilen_des_echten_stroms() {
        let vorschau = preview_thermal_receipt(harter_beleg(Some(48)));
        assert_eq!(vorschau.paper_cols, 48);
        let alles: String = vorschau
            .zeilen
            .iter()
            .map(|z| z.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            alles.contains("norns.de"),
            "die Systemzeile steht in der Vorschau"
        );
        assert!(alles.contains("SUMME"));
        assert!(alles.contains("[ QR-CODE ]"));
        let qr = vorschau
            .zeilen
            .iter()
            .find(|z| z.qr_daten.is_some())
            .expect("der QR traegt seine Daten");
        assert!(
            qr.qr_daten.as_deref().unwrap().starts_with("V0;"),
            "die Vorschau bekommt den echten QR-Inhalt"
        );
    }

    #[test]
    fn build_escpos_real_tse_prints_signature_block_and_qr() {
        let payload = "1.0,2026-06-16T18:11:24Z,ecdsa-plain-SHA256,Aj8kP9qVeryLongOpaqueBase64";
        let out = build_escpos(&sample(payload, "Aj8kP9qVeryLongOpaqueBase64Signature"));
        let ascii = String::from_utf8_lossy(&out);
        assert!(
            ascii.contains("TSE-Signatur:"),
            "a real TSE prints the block"
        );
        // The QR store-data command (GS ( k … 49 80 48) is emitted for a real payload.
        assert!(
            out.windows(3).any(|w| w == [0x31, 0x50, 0x30]),
            "the QR data command is emitted for a real payload"
        );
    }
}

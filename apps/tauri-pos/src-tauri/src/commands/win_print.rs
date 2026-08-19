//! Windows raw printing + printer enumeration via the Win32 print spooler
//! (winspool). The macOS/Linux path shells out to CUPS (`lpr -o raw` / `lpstat`);
//! Windows has no `lpr`, so we drive the spooler directly:
//!
//!   • `print_raw` opens the queue, starts a doc with the **"RAW"** datatype (so
//!     the driver does NOT re-render our ESC/POS control bytes), writes the
//!     bytes, and closes — the spooler owns the USB transport.
//!   • `list_printers` / `detect_receipt` enumerate installed queues with
//!     `EnumPrintersW` (level 2 → name + port) and auto-pick the USB receipt
//!     printer by port + name keyword (SRP-350 / BIXOLON / Receipt / POS / …),
//!     so the cashier just plugs it in — same behaviour as the macOS auto-detect.
//!
//! These functions are synchronous + blocking (the spooler API is); callers wrap
//! them in `tokio::task::spawn_blocking`. This whole module is `cfg(windows)`.

use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Graphics::Printing::{
    ClosePrinter, EndDocPrinter, EndPagePrinter, EnumPrintersW, OpenPrinterW, StartDocPrinterW,
    StartPagePrinter, WritePrinter, DOC_INFO_1W, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL,
    PRINTER_HANDLE, PRINTER_INFO_2W,
};

/// UTF-16, NUL-terminated — the encoding every `...W` Win32 entry point wants.
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe fn pwstr_to_string(p: PWSTR) -> String {
    if p.is_null() {
        return String::new();
    }
    p.to_string().unwrap_or_default()
}

/// Send raw ESC/POS bytes to a named Windows print queue via the spooler with
/// the "RAW" datatype. Returns a German-friendly error string on any failure.
pub fn print_raw(printer_name: &str, bytes: &[u8]) -> Result<(), String> {
    let name = wide(printer_name);
    let mut hprinter = PRINTER_HANDLE::default();
    unsafe {
        OpenPrinterW(PCWSTR(name.as_ptr()), &mut hprinter, None)
            .map_err(|e| format!("Drucker '{printer_name}' nicht erreichbar: {e}"))?;
    }

    // Everything between Open and Close must run so the handle is always closed.
    let res = (|| -> Result<(), String> {
        let mut datatype = wide("RAW");
        let mut docname = wide("Norns Bon");
        let doc = DOC_INFO_1W {
            pDocName: PWSTR(docname.as_mut_ptr()),
            pOutputFile: PWSTR::null(),
            pDatatype: PWSTR(datatype.as_mut_ptr()),
        };
        unsafe {
            let job = StartDocPrinterW(hprinter, 1, &doc);
            if job == 0 {
                return Err("StartDocPrinter fehlgeschlagen".into());
            }
            StartPagePrinter(hprinter)
                .ok()
                .map_err(|e| format!("StartPagePrinter: {e}"))?;
            let mut written: u32 = 0;
            WritePrinter(
                hprinter,
                bytes.as_ptr() as *const core::ffi::c_void,
                bytes.len() as u32,
                &mut written,
            )
            .ok()
            .map_err(|e| format!("WritePrinter: {e}"))?;
            EndPagePrinter(hprinter)
                .ok()
                .map_err(|e| format!("EndPagePrinter: {e}"))?;
            EndDocPrinter(hprinter)
                .ok()
                .map_err(|e| format!("EndDocPrinter: {e}"))?;
            if written as usize != bytes.len() {
                return Err(format!(
                    "WritePrinter schrieb {written}/{} Bytes",
                    bytes.len()
                ));
            }
        }
        Ok(())
    })();

    unsafe {
        let _ = ClosePrinter(hprinter);
    }
    res
}

/// Enumerate installed printers as `(name, port)`. Best-effort — returns empty
/// on any spooler error (a perfectly valid "no printers" state for the UI).
pub fn list_printers() -> Vec<(String, String)> {
    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    let mut needed: u32 = 0;
    let mut returned: u32 = 0;
    unsafe {
        // First call sizes the buffer (it "fails" with ERROR_INSUFFICIENT_BUFFER).
        let _ = EnumPrintersW(flags, PCWSTR::null(), 2, None, &mut needed, &mut returned);
        if needed == 0 {
            return Vec::new();
        }
        let mut buf = vec![0u8; needed as usize];
        if EnumPrintersW(
            flags,
            PCWSTR::null(),
            2,
            Some(&mut buf),
            &mut needed,
            &mut returned,
        )
        .is_err()
        {
            return Vec::new();
        }
        let infos = buf.as_ptr() as *const PRINTER_INFO_2W;
        let mut out = Vec::with_capacity(returned as usize);
        for i in 0..returned as isize {
            let info = &*infos.offset(i);
            out.push((
                pwstr_to_string(info.pPrinterName),
                pwstr_to_string(info.pPortName),
            ));
        }
        out
    }
}

/// Just the queue names — for `list_system_printers` (the Gerätemanager dropdown).
pub fn list_printer_names() -> Vec<String> {
    list_printers().into_iter().map(|(name, _)| name).collect()
}

/// True iff a queue with this exact name is installed.
pub fn queue_exists(printer_name: &str) -> bool {
    list_printers().iter().any(|(name, _)| name == printer_name)
}

const HINTS: [&str; 12] = [
    "srp-350", "srp", "bixolon", "receipt", "beleg", "bon", "pos", "thermal", "epson", "star",
    "kasse", "tm-",
];

/// Auto-detect the most likely USB receipt printer by port + name keyword.
pub fn detect_receipt() -> Option<String> {
    let printers = list_printers();
    let is_usb = |port: &str| port.to_lowercase().contains("usb");

    // 1. A USB-port printer whose name reads like a receipt printer — best signal.
    for (name, port) in &printers {
        if is_usb(port) && HINTS.iter().any(|h| name.to_lowercase().contains(h)) {
            return Some(name.clone());
        }
    }
    // 2. Any printer whose name reads like a receipt printer (some show a virtual port).
    for (name, _) in &printers {
        if HINTS.iter().any(|h| name.to_lowercase().contains(h)) {
            return Some(name.clone());
        }
    }
    // 3. The only USB printer present must be the one.
    let usb: Vec<&(String, String)> = printers.iter().filter(|(_, p)| is_usb(p)).collect();
    if usb.len() == 1 {
        return Some(usb[0].0.clone());
    }
    None
}

// ════════════════════════════════════════════════════════════════════════════
//  SEITENDRUCK UEBER GDI — der Weg, den es bis zum 18.08.2026 nicht gab
// ════════════════════════════════════════════════════════════════════════════
//
// ── DER BEFUND (Basels Foto vom 18.08.2026) ────────────────────────────────
//
// Auf Windows fuehrte fuer eine SEITE (A4-Rechnung, Raster-Etikett) kein Weg
// zum Papier: der rohe Spooler-Weg oben gibt PDF-Bytes unveraendert weiter,
// heraus kaeme Quelltext. Der Ausweg war, das PDF im Betrachter zu oeffnen —
// der Haendler drueckte „Etikett drucken" und bekam einen Browser-Reiter.
// Ein Klick mehr, jedes Mal, an der Stelle, an der es schnell gehen muss.
//
// ── WAS DIESER WEG TUT ─────────────────────────────────────────────────────
//
// Er nimmt fertig GERASTERTE Seiten (RGBA-Pixel, von typst-render erzeugt,
// demselben Setzer, der auch das PDF setzt) und gibt sie ueber GDI an den
// HERSTELLERTREIBER: CreateDC auf die Warteschlange, StartDoc, je Seite
// StartPage + StretchDIBits + EndPage, EndDoc. Genau so drucken Word und
// jeder Windows-Betrachter — nur ohne Betrachter dazwischen.
//
// ⚠️ Pixel statt PDF ist hier kein Notbehelf, sondern der einzige Weg, der
// OHNE fremdes Programm auskommt: Windows bringt keinen PDF-Rasterer mit,
// den ein Prozess ohne Bündel-Abhaengigkeit rufen duerfte.

// ⚠️ ZWEI HAEUSER, NICHT EINS (19.08.2026, vom Windows-Tor gefangen).
//
// Der Zeichenkasten (`Gdi`) und der DRUCKAUFTRAG sind in `windows` 0.61
// getrennte Module: `StartDocW`, `StartPage`, `EndPage`, `EndDoc` und
// `DOCINFOW` liegen unter `Win32::Storage::Xps`, nicht unter `Gdi`.
// Gemessen im Quelltext der Kiste selbst
// (`windows-0.61.3/src/Windows/Win32/Storage/Xps/mod.rs`), nicht geraten.
//
// ⛔ Und die Lehre dahinter, zum ZWEITEN Mal in dieser Datei: dieser Block
// steht hinter `#[cfg(windows)]`. Auf dem Mac uebersetzt er NIE, also sagt
// ein gruenes `cargo check` hier ueberhaupt nichts ueber ihn. Nur das
// Windows-Tor sieht ihn — und es hat ihn gesehen.
use windows::Win32::Graphics::Gdi::{
    CreateDCW, DeleteDC, GetDeviceCaps, SetStretchBltMode, StretchDIBits, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HALFTONE, HORZRES, LOGPIXELSX, LOGPIXELSY,
    PHYSICALOFFSETX, PHYSICALOFFSETY, SRCCOPY, VERTRES,
};
use windows::Win32::Storage::Xps::{DOCINFOW, EndDoc, EndPage, StartDocW, StartPage};

use crate::commands::pdf::RasterSeite;

/// Die Aufloesung der Warteschlange in Punkten je Zoll, damit der Aufrufer in
/// GENAU der Dichte rastern kann, die der Treiber erwartet. 300, wenn der
/// Treiber nichts sagt — die uebliche Dichte der Etiketten- und Buerodrucker.
pub fn drucker_dpi(printer_name: &str) -> (f32, f32) {
    let name = wide(printer_name);
    unsafe {
        let hdc = CreateDCW(PCWSTR::null(), PCWSTR(name.as_ptr()), PCWSTR::null(), None);
        if hdc.is_invalid() {
            return (300.0, 300.0);
        }
        let x = GetDeviceCaps(Some(hdc), LOGPIXELSX);
        let y = GetDeviceCaps(Some(hdc), LOGPIXELSY);
        let _ = DeleteDC(hdc);
        (
            if x > 0 { x as f32 } else { 300.0 },
            if y > 0 { y as f32 } else { 300.0 },
        )
    }
}

/// Gerasterte Seiten auf eine Windows-Warteschlange drucken.
///
/// `seiten_mm`: die Zielgroesse jeder Seite in Millimetern. `Some` beim
/// Etikett (die Seite ist so gross wie das Etikett und liegt an der oberen
/// linken Ecke des bedruckbaren Bereichs), `None` bei A4 (die Seite fuellt
/// den ganzen bedruckbaren Bereich, das Verhaeltnis stimmt, weil Quelle und
/// Ziel dasselbe Blatt beschreiben).
pub fn print_raster_seiten(
    printer_name: &str,
    doc_name: &str,
    seiten: &[RasterSeite],
    seiten_mm: Option<(f64, f64)>,
) -> Result<(), String> {
    if seiten.is_empty() {
        return Err("Keine Seite zu drucken.".into());
    }
    let name = wide(printer_name);
    unsafe {
        let hdc = CreateDCW(PCWSTR::null(), PCWSTR(name.as_ptr()), PCWSTR::null(), None);
        if hdc.is_invalid() {
            return Err(format!("Drucker '{printer_name}' nicht erreichbar (CreateDC)."));
        }

        // Alles zwischen CreateDC und DeleteDC laeuft in dieser Klammer, damit
        // der Geraetekontext IMMER freigegeben wird — dasselbe Muster wie beim
        // rohen Weg oben mit dem Druckergriff.
        let ergebnis = (|| -> Result<(), String> {
            let dpi_x = GetDeviceCaps(Some(hdc), LOGPIXELSX).max(1) as f64;
            let dpi_y = GetDeviceCaps(Some(hdc), LOGPIXELSY).max(1) as f64;
            let flaeche_b = GetDeviceCaps(Some(hdc), HORZRES).max(1);
            let flaeche_h = GetDeviceCaps(Some(hdc), VERTRES).max(1);
            // Der unbedruckbare Rand: HORZRES beginnt NACH ihm. Fuer ein
            // Etikett, das an der Blattkante klebt, ziehen wir ihn ab, sonst
            // wandert der Druck um den Rand nach innen.
            let rand_x = GetDeviceCaps(Some(hdc), PHYSICALOFFSETX).max(0);
            let rand_y = GetDeviceCaps(Some(hdc), PHYSICALOFFSETY).max(0);

            let mut docname = wide(doc_name);
            let di = DOCINFOW {
                cbSize: std::mem::size_of::<DOCINFOW>() as i32,
                lpszDocName: PCWSTR(docname.as_mut_ptr()),
                ..Default::default()
            };
            if StartDocW(hdc, &di) <= 0 {
                return Err("StartDoc fehlgeschlagen — druckt ein anderes Programm gerade?".into());
            }

            for seite in seiten {
                if StartPage(hdc) <= 0 {
                    let _ = EndDoc(hdc);
                    return Err("StartPage fehlgeschlagen.".into());
                }

                // GDI erwartet BGRA und, bei negativer Hoehe, Zeilen von oben
                // nach unten — exakt die Reihenfolge, in der tiny-skia liefert,
                // nur mit getauschtem Rot- und Blaukanal.
                let mut bgra = seite.rgba.clone();
                for px in bgra.chunks_exact_mut(4) {
                    px.swap(0, 2);
                }

                let bmi = BITMAPINFO {
                    bmiHeader: BITMAPINFOHEADER {
                        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                        biWidth: seite.breite_px as i32,
                        biHeight: -(seite.hoehe_px as i32), // negativ = von oben
                        biPlanes: 1,
                        biBitCount: 32,
                        biCompression: BI_RGB.0,
                        ..Default::default()
                    },
                    ..Default::default()
                };

                let (ziel_b, ziel_h, ziel_x, ziel_y) = match seiten_mm {
                    Some((mm_b, mm_h)) => {
                        let b = (mm_b / 25.4 * dpi_x).round() as i32;
                        let h = (mm_h / 25.4 * dpi_y).round() as i32;
                        // An die PHYSISCHE Blattecke, nicht an die bedruckbare:
                        // ein 57x32-Etikett sitzt am Blattanfang.
                        (b.min(flaeche_b + rand_x), h.min(flaeche_h + rand_y), -rand_x, -rand_y)
                    }
                    None => (flaeche_b, flaeche_h, 0, 0),
                };

                // HALFTONE: der Treiber mittelt beim Verkleinern, statt Zeilen
                // zu werfen — Text bleibt lesbar, Balkencodes bleiben scharf,
                // weil wir ohnehin in Treiber-DPI rastern (Verhaeltnis 1:1).
                SetStretchBltMode(hdc, HALFTONE);
                let gezeichnet = StretchDIBits(
                    hdc,
                    ziel_x,
                    ziel_y,
                    ziel_b,
                    ziel_h,
                    0,
                    0,
                    seite.breite_px as i32,
                    seite.hoehe_px as i32,
                    Some(bgra.as_ptr() as *const core::ffi::c_void),
                    &bmi,
                    DIB_RGB_COLORS,
                    SRCCOPY,
                );
                if gezeichnet == 0 {
                    let _ = EndPage(hdc);
                    let _ = EndDoc(hdc);
                    return Err("StretchDIBits zeichnete nichts — Treiberfehler.".into());
                }
                if EndPage(hdc) <= 0 {
                    let _ = EndDoc(hdc);
                    return Err("EndPage fehlgeschlagen.".into());
                }
            }

            if EndDoc(hdc) <= 0 {
                return Err("EndDoc fehlgeschlagen — der Auftrag wurde verworfen.".into());
            }
            Ok(())
        })();

        let _ = DeleteDC(hdc);
        ergebnis
    }
}

//! Was hängt WIRKLICH am Rechner — gefragt beim Bus, nicht beim Drucksystem.
//!
//! ── DER AUFTRAG ────────────────────────────────────────────────────────────
//!
//! Basel, wörtlich: „مجرد ما تكون مشبوكة بل جهاز يتعرف عليه التطبيق تلقائيا"
//! — sobald das Gerät angesteckt ist, erkennt die Anwendung es von selbst.
//!
//! Bis heute fragte die Kasse dafür CUPS (`lpstat -v`, `lpinfo -v`). Das ist
//! ein Umweg mit drei Zöllen:
//!
//!   • `lpstat` kennt nur, was schon eine WARTESCHLANGE hat. Ein frisch
//!     eingesteckter Drucker steht dort nicht.
//!   • `lpinfo` liegt in `/usr/sbin` und antwortet nicht überall.
//!   • Beides sagt nichts, wenn CUPS steht — und die Kasse hielt das für
//!     „nichts angeschlossen".
//!
//! ── WARUM `nusb` UND NICHT SELBST GEBAUT ───────────────────────────────────
//!
//! Am 02.08.2026 gesucht und gemessen, statt das Rad zu bauen:
//!
//!   • `nusb` 0.2.6, freigegeben am 01.08.2026, Apache-2.0 ODER MIT.
//!   • REINES RUST. Abhängig nur von Deklarationskisten: `windows-sys`,
//!     `io-kit-sys`, `core-foundation-sys`, `rustix`. Kein `cc`, kein
//!     mitgeliefertes C. Das ist entscheidend: `ring` macht in diesem Haus
//!     schon heute jedes Windows-Übersetzen auf einem Mac unmöglich, und eine
//!     weitere C-Kiste hätte die Lage verschlimmert.
//!   • `watch_devices()` liefert ein Ereignis beim An- und Abstecken, auf
//!     macOS UND Windows. Das ist der Beobachter, den der Auftrag verlangt.
//!
//! GEMESSEN auf dieser Maschine, ohne dass ein Dialog erschien:
//!
//! ```text
//! USB-Geräte gesamt: 5
//!   DRUCKERKLASSE vid=03f0 pid=3454 hersteller="HP" modell="ENVY 6000 series"
//!                 seriennr="TH0933D25C"
//! ```
//!
//! Hersteller, Modell und Seriennummer kommen damit AUS DEM GERÄT. Das ist
//! genauer als das bisherige Zerlegen von `usb://DYMO/LabelWriter%20450` —
//! eine Zeichenkette, die CUPS sich selbst zusammensetzt.
//!
//! ── DIE GRENZE, DIE HIER NIE ÜBERSCHRITTEN WIRD ────────────────────────────
//!
//! ⚠️ NUR AUFZÄHLEN, NIE ÖFFNEN.
//!
//! Auf Windows gehören Geräte der Klasse 7 (Drucker) dem Treiber
//! `usbprint.sys`. `nusb` kann sie dort nur öffnen, wenn WinUSB gebunden ist,
//! und das ist bei einem Drucker NIE der Fall — Microsofts eigene Doku
//! schliesst Klasse 0x07 aus dem WinUSB-Namensraum ausdrücklich aus. Wer
//! versuchte, hier zu drucken, baute einen Weg, der auf der Hälfte der
//! ausgelieferten Rechner niemals funktioniert.
//!
//! Gedruckt wird deshalb weiter über den Spooler (`win_print.rs`) bzw. über
//! CUPS. Dieses Modul beantwortet EINE Frage: was steckt da?

use serde::Serialize;

/// Die USB-Klasse für Drucker, aus der Gerätespezifikation.
const KLASSE_DRUCKER: u8 = 7;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsbGeraet {
    pub hersteller_id: u16,
    pub produkt_id: u16,
    /// Aus dem Gerät gelesen, nicht aus einer Adresse geraten.
    pub hersteller: Option<String>,
    pub modell: Option<String>,
    pub seriennummer: Option<String>,
    /// Wahr, wenn das Gerät sich selbst als Drucker ausweist.
    pub ist_drucker: bool,
}

/// Ob dieses Gerät ein Drucker ist.
///
/// ⚠️ Die Geräteklasse allein genügt NICHT. Viele Drucker melden auf der
/// Geräteebene 0 („siehe Schnittstellen") und tragen die 7 erst in einer
/// Schnittstelle. Die HP auf dieser Maschine ist genau so ein Fall: `class()`
/// gab 0, und nur der Blick in die Schnittstellen fand sie. Wer nur die
/// Geräteklasse prüft, übersieht den halben Markt.
fn ist_drucker(geraeteklasse: u8, schnittstellenklassen: &[u8]) -> bool {
    geraeteklasse == KLASSE_DRUCKER || schnittstellenklassen.contains(&KLASSE_DRUCKER)
}

/// Alles auflisten, was am Bus hängt.
///
/// Scheitert die Abfrage, ist das eine ehrliche Absage — NICHT eine leere
/// Liste. Genau diese Verwechslung war der Fehler des CUPS-Weges: sein
/// Schweigen sah aus wie „nichts angeschlossen".
pub fn auflisten() -> Result<Vec<UsbGeraet>, String> {
    use nusb::MaybeFuture;
    let geraete = nusb::list_devices()
        .wait()
        .map_err(|e| format!("Der USB-Bus dieses Rechners gab keine Auskunft: {e}"))?;

    Ok(geraete
        .map(|d| {
            let klassen: Vec<u8> = d.interfaces().map(|i| i.class()).collect();
            UsbGeraet {
                hersteller_id: d.vendor_id(),
                produkt_id: d.product_id(),
                hersteller: d.manufacturer_string().map(str::to_string),
                modell: d.product_string().map(str::to_string),
                seriennummer: d.serial_number().map(str::to_string),
                ist_drucker: ist_drucker(d.class(), &klassen),
            }
        })
        .collect())
}

/// Nur die Drucker.
pub fn drucker_auflisten() -> Result<Vec<UsbGeraet>, String> {
    Ok(auflisten()?.into_iter().filter(|g| g.ist_drucker).collect())
}

#[tauri::command]
pub async fn usb_drucker_auflisten() -> Result<Vec<UsbGeraet>, String> {
    // Die Abfrage ist blockierend; sie gehört nicht in den Ereignisstrang.
    tokio::task::spawn_blocking(drucker_auflisten)
        .await
        .map_err(|e| format!("Die USB-Abfrage brach ab: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn die_geraeteklasse_allein_genuegt_nicht() {
        // ⚠️ DER SATZ, AUF DEN ES ANKOMMT, und er kommt aus einer echten
        // Messung: die HP auf dieser Maschine meldet Geräteklasse 0 und trägt
        // die 7 nur in einer Schnittstelle. Wer nur `class()` prüft, findet
        // sie nicht — und der Händler steht wieder vor einer leeren Liste.
        assert!(
            ist_drucker(0, &[7]),
            "Verbundgerät mit Druckerschnittstelle"
        );
        assert!(
            ist_drucker(7, &[]),
            "Gerät, das sich selbst als Drucker meldet"
        );
        assert!(
            ist_drucker(0, &[3, 7, 255]),
            "Drucker unter mehreren Schnittstellen"
        );
    }

    #[test]
    fn eine_tastatur_ist_kein_drucker() {
        assert!(!ist_drucker(0, &[3]));
        assert!(!ist_drucker(9, &[]), "ein Verteiler");
        assert!(!ist_drucker(0, &[]), "gar keine Auskunft");
    }

    /// ⚠️ Nur DRUCKER dürfen den Beobachter auslösen.
    ///
    /// Ein Hotplug-Ereignis lässt sich hier nicht erzeugen — dafür müsste ein
    /// Mensch etwas einstecken. Also wird die REGEL im Quelltext geprüft, wie
    /// bei `kein_weg_ohne_pruefung` in `warteschlangenlage.rs`.
    ///
    /// Der Grund ist kein Geschmack: reagierte der Beobachter auf jedes Gerät,
    /// löste jeder eingesteckte Stick, jede Maus, jedes Telefon eine
    /// Druckersuche aus. Nach einer Woche wäre das Ereignis Rauschen, und beim
    /// echten Drucker schaute niemand mehr hin.
    #[test]
    fn nur_drucker_loesen_den_beobachter_aus() {
        let quelle = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands/usb_geraete.rs"),
        )
        .expect("die eigene Datei ist lesbar");
        // ⚠️ Der ERSTE Anlauf dieses Satzes war grün, obwohl die Prüfung
        // entfernt war — weil `find("HotplugEvent::Connected")` seinen EIGENEN
        // Kommentar traf und die Zeichenketten dieser Zusicherungen die
        // gesuchten Wörter enthalten. Ein Wächter, der sich selbst liest, ist
        // immer zufrieden.
        //
        // Deshalb der volle Zweig-Kopf, wie er nur im Code steht.
        //
        // Und `rfind` statt `find`: der ERSTE Treffer ist die Zeichenkette in
        // GENAU DIESER Zeile. Der Beobachter steht hinter dem Prüfmodul, also
        // ist der LETZTE Treffer der echte Code.
        let i = quelle
            .rfind("nusb::hotplug::HotplugEvent::Connected(d) =>")
            .expect("der Anstecke-Zweig ist nicht auffindbar");
        let zweig = &quelle[i..(i + 700).min(quelle.len())];
        // ⚠️ Die Selbstsicherung. Zöge jemand das Prüfmodul ans Dateiende,
        // läse dieser Satz wieder sich selbst und wäre immer zufrieden.
        assert!(
            !zweig.contains("assert!"),
            "dieser Wächter liest seinen eigenen Quelltext statt des Beobachters"
        );
        assert!(
            zweig.contains("ist_drucker("),
            "der Beobachter prüft nicht, ob es ein Drucker ist — dann löst jeder Stick \
             eine Druckersuche aus"
        );
        assert!(
            zweig.contains("continue"),
            "der Beobachter prüft zwar, springt aber nicht ab — die Prüfung wäre folgenlos"
        );
    }

    /// Läuft gegen den ECHTEN Bus dieser Maschine. Er darf nie scheitern und
    /// nie behaupten, es gäbe kein USB — ein Rechner ohne einen einzigen
    /// USB-Verteiler existiert praktisch nicht.
    #[test]
    fn der_echte_bus_antwortet() {
        match auflisten() {
            Ok(liste) => {
                // Keine Behauptung über die ANZAHL: die hängt davon ab, was
                // gerade steckt. Nur, dass die Abfrage durchging.
                for g in &liste {
                    assert!(g.hersteller_id > 0 || g.produkt_id > 0);
                }
            }
            Err(e) => panic!("der USB-Bus gab keine Auskunft: {e}"),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Der Beobachter — „sobald das Gerät angesteckt ist"
// ─────────────────────────────────────────────────────────────────────────
//
// Bis hierher musste ein Mensch „Suchen" drücken. Basels Auftrag lautet aber
// wörtlich: „مجرد ما تكون مشبوكة بل جهاز يتعرف عليه التطبيق تلقائيا" — sobald
// es steckt, erkennt die Anwendung es von selbst.
//
// `nusb::watch_devices()` liefert genau das, auf macOS UND Windows. Der
// Beobachter läuft ab dem Start des Rumpfes und schickt ein Ereignis ins
// Fenster; die Fläche sucht daraufhin neu.
//
// ⚠️ ZWEI ENTSCHEIDUNGEN, DIE NICHT KOSMETIK SIND
//
// 1. NUR DRUCKER lösen etwas aus. Ein Mensch, der einen Stick einsteckt, soll
//    keine Druckersuche auslösen — sonst ist das Ereignis nach einer Woche
//    Rauschen, und beim echten Drucker schaut niemand mehr hin.
//
// 2. Beim ABSTECKEN liefert nusb nur eine Kennung, keine Angaben (siehe
//    `HotplugEvent::Disconnected(DeviceId)`). Ohne eigenes Gedächtnis wüsste
//    die Kasse nicht, WELCHES Gerät ging — und könnte auch nicht sagen, ob es
//    überhaupt ein Drucker war. Deshalb merkt sich der Beobachter die
//    Druckerkennungen, die er beim Anstecken gesehen hat.

use std::collections::HashSet;
use std::sync::Mutex;

use tauri::Emitter;

/// Das Ereignis, das im Fenster ankommt.
pub const EREIGNIS_ANGESTECKT: &str = "drucker-angesteckt";
pub const EREIGNIS_ABGESTECKT: &str = "drucker-abgesteckt";

/// Den Beobachter starten. Läuft, bis die Anwendung endet.
///
/// Scheitert der Start, ist das KEIN Grund, die Kasse anzuhalten: dann fehlt
/// nur die Bequemlichkeit, und der Knopf „Suchen" tut es weiterhin. Der Fehler
/// wird protokolliert, nicht geworfen.
pub fn beobachter_starten(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let watch = match nusb::watch_devices() {
            Ok(w) => w,
            Err(e) => {
                // Kein Absturz, kein stiller Tod: eine Zeile, die erklärt,
                // warum das automatische Erkennen nicht arbeitet.
                eprintln!(
                    "[usb] Der Ansteck-Beobachter konnte nicht starten: {e}. \
                     Die Suche über den Knopf bleibt unberührt."
                );
                return;
            }
        };
        // ⚠️ Das Gedächtnis. Ohne es kann das Abstecken nicht zugeordnet
        // werden, weil nusb dort nur eine Kennung liefert.
        let bekannte_drucker: Mutex<HashSet<nusb::DeviceId>> = Mutex::new(HashSet::new());

        // ⚠️ Von Hand abgefragt statt mit einer Hilfskiste. `futures-core`
        // liefert nur die Merkmalsdefinition; ein eigener Läufer wäre eine
        // weitere Abhängigkeit für dreissig Zeilen, und tokio ist schon da.
        let laufzeit = match tokio::runtime::Builder::new_current_thread().build() {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[usb] Der Ansteck-Beobachter bekam keinen Läufer: {e}");
                return;
            }
        };
        laufzeit.block_on(async {
            use std::pin::Pin;
            use std::task::Poll;
            let mut strom = Box::pin(watch);
            loop {
                let ereignis = std::future::poll_fn(|cx| {
                    futures_core::Stream::poll_next(Pin::as_mut(&mut strom), cx)
                })
                .await;
                let Some(ereignis) = ereignis else { break };
                match ereignis {
                    nusb::hotplug::HotplugEvent::Connected(d) => {
                        let klassen: Vec<u8> = d.interfaces().map(|i| i.class()).collect();
                        if !ist_drucker(d.class(), &klassen) {
                            continue;
                        }
                        if let Ok(mut m) = bekannte_drucker.lock() {
                            m.insert(d.id());
                        }
                        let g = UsbGeraet {
                            hersteller_id: d.vendor_id(),
                            produkt_id: d.product_id(),
                            hersteller: d.manufacturer_string().map(str::to_string),
                            modell: d.product_string().map(str::to_string),
                            seriennummer: d.serial_number().map(str::to_string),
                            ist_drucker: true,
                        };
                        let _ = app.emit(EREIGNIS_ANGESTECKT, g);
                    }
                    nusb::hotplug::HotplugEvent::Disconnected(id) => {
                        let war_drucker = bekannte_drucker
                            .lock()
                            .map(|mut m| m.remove(&id))
                            .unwrap_or(false);
                        if war_drucker {
                            let _ = app.emit(EREIGNIS_ABGESTECKT, ());
                        }
                    }
                }
            }
        });
    });
}

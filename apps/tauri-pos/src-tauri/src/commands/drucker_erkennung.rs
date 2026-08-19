//! Drucker erkennen — ALLE, gleich welcher Art, und auch die, die das
//! Betriebssystem noch gar nicht eingerichtet hat.
//!
//! ── WARUM ES DAS GIBT (Basel, 25.07.2026) ──────────────────────────────────
//! „التعرف على الطباعات المتصلة تلقائيا اين يكن نوعها واذا يحتاج تعريفات
//!  يحملها … الان الطباعة اليبل مشبوكة … المهم تعرف عليها شابكة بل usb"
//!
//! Bis hierher konnte die Kasse GENAU EINE Sache: unter den vorhandenen
//! Warteschlangen den Bondrucker erraten. Für den Etikettendrucker gab es
//! keine Erkennung, und — der eigentliche Punkt — ein frisch eingestecktes
//! Gerät hat oft ÜBERHAUPT KEINE Warteschlange. Es taucht dann in keiner
//! Liste auf, und für den Menschen davor sieht es aus, als sei es nicht
//! angeschlossen.
//!
//! Auf der Prüfmaschine sah das so aus:
//!
//! ```text
//! device for Warehouse14-Bon: usb://SAMSUNG/SRP-350?location=1120000
//! direct usb://DYMO/LabelWriter%20450?serial=01010112345600
//! ```
//!
//! Die erste Zeile ist eine eingerichtete Warteschlange. Die zweite ist ein
//! angeschlossenes Gerät OHNE Warteschlange — sichtbar nur für `lpinfo -v`.
//!
//! ── „UND WENN ES TREIBER BRAUCHT?" ─────────────────────────────────────────
//! Es braucht keine. Ein Beleg- oder Etikettendrucker wird hier NICHT über
//! einen Herstellertreiber angesprochen, sondern in seiner eigenen Sprache:
//! ESC/POS beziehungsweise ZPL, als rohe Bytes. Dafür genügt eine ROHE
//! Warteschlange (`lpadmin -m raw`), und die kann das Programm selbst anlegen
//! — ohne Installationspaket, ohne Neustart, ohne dass irgendwo ein Treiber
//! gesucht werden muss.
//!
//! Was das Programm NICHT kann und auch nicht behauptet: einen echten
//! Herstellertreiber installieren. Für einen A4-Bürodrucker, der PostScript
//! oder PCL erwartet, bleibt das Sache des Betriebssystems. Das wird gesagt,
//! nicht verschwiegen.

use serde::Serialize;

use crate::config;
use crate::error::{HardwareError, HwResult};

/// Wofür ein Gerät nach seinem Namen und seiner Anschrift vermutlich da ist.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Druckerrolle {
    /// Kassenbon, ESC/POS, schmale Rolle.
    Bon,
    /// Etiketten, ZPL oder ESC/POS.
    Etikett,
    /// Bürodrucker für A4.
    A4,
    /// Angeschlossen, aber die Art ist nicht sicher zu erkennen.
    Unbekannt,
}

/// Welche Sprache ein Etikettendrucker versteht.
///
/// ── WARUM DAS HIER STEHT UND NICHT ERST IN DER EINSTELLUNG (26.07.2026) ────
/// Die Erkennung WEISS aus der Geräteadresse, dass da ein DYMO hängt — und
/// warf dieses Wissen genau an der Stelle weg, an der es zählte. Beim
/// Übernehmen wurden Name und Anschlussart geschrieben, die Sprache blieb auf
/// der Vorgabe ZPL stehen. Ein DYMO versteht kein ZPL; er versteht überhaupt
/// keine Sprache. Am Tresen hiess das: übernommen, geprüft, grün — und beim
/// Drucken kam nichts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Etikettensprache {
    /// Zebra und die vielen Nachbauten.
    Zpl,
    /// Epson-artige Etikettendrucker im Bonmodus.
    Escpos,
    /// Keine Sprache, sondern Rasterzeilen aus dem Herstellertreiber:
    /// DYMO, Seiko, Brother QL.
    Raster,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErkannterDrucker {
    /// Name der Warteschlange, oder leer wenn es noch keine gibt.
    pub queue: String,
    /// Die Geräteadresse, z. B. `usb://DYMO/LabelWriter%20450?serial=…`.
    pub device_uri: String,
    /// Aus der Adresse gelesen, entschlüsselt: „DYMO".
    pub hersteller: String,
    /// Aus der Adresse gelesen, entschlüsselt: „LabelWriter 450".
    pub modell: String,
    /// `usb`, `netzwerk` oder `andere`.
    pub verbindung: String,
    /// Wofür es vermutlich da ist.
    pub rolle: Druckerrolle,
    /// WARUM diese Vermutung. Ein Rateergebnis ohne Begründung ist wertlos.
    pub begruendung: String,
    /// `false` = angeschlossen, aber ohne Warteschlange, also noch nicht nutzbar.
    pub eingerichtet: bool,
    /// Welche Sprache das Gerät als Etikettendrucker verstünde.
    pub sprache: Etikettensprache,
    /// WARUM diese Sprache — wird dem Menschen gezeigt, damit er sie
    /// begründet ändern kann statt blind zu vertrauen.
    pub sprache_grund: String,
}

/// Prozentkodierung einer Geräteadresse auflösen: `LabelWriter%20450`.
fn entschluesseln(roh: &str) -> String {
    let bytes = roh.as_bytes();
    let mut aus = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let Ok(b) = u8::from_str_radix(hex, 16) {
                aus.push(b);
                i += 3;
                continue;
            }
        }
        aus.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&aus).to_string()
}

/// Hersteller und Modell aus einer Geräteadresse ziehen.
///
/// `usb://DYMO/LabelWriter%20450?serial=…` → („DYMO", „LabelWriter 450")
fn hersteller_und_modell(uri: &str) -> (String, String) {
    let ohne_schema = uri.split("://").nth(1).unwrap_or(uri);
    let ohne_frage = ohne_schema.split('?').next().unwrap_or(ohne_schema);
    let mut teile = ohne_frage.splitn(2, '/');
    let h = entschluesseln(teile.next().unwrap_or("").trim());
    let m = entschluesseln(teile.next().unwrap_or("").trim());
    (h, m)
}

/// Die Art des Anschlusses, in einem Wort.
fn verbindungsart(uri: &str) -> &'static str {
    let u = uri.to_lowercase();
    if u.starts_with("usb:") || u.starts_with("ippusb:") {
        "usb"
    } else if u.starts_with("socket:")
        || u.starts_with("ipp:")
        || u.starts_with("ipps:")
        || u.starts_with("lpd:")
        || u.starts_with("dnssd:")
    {
        "netzwerk"
    } else {
        "andere"
    }
}

/// Wofür ist das Gerät da?
///
/// Erst der HERSTELLER und das MODELL aus der Geräteadresse — die kommen aus
/// den USB-Deskriptoren und sind damit die verlässlichste Quelle. Der Name der
/// Warteschlange zählt nur nach, weil ihn ein Mensch getippt hat und er alles
/// heissen kann.
pub fn rolle_raten(uri: &str, queue: &str) -> (Druckerrolle, String) {
    let (h, m) = hersteller_und_modell(uri);
    // Getrimmt, weil ein leeres Modell sonst ein Leerzeichen in die Begruendung
    // schreibt — auf Windows ist das der Normalfall, dort gibt es nur den Namen.
    let anzeige = format!("{h} {m}").trim().to_string();
    let geraet = anzeige.to_lowercase();
    let name = queue.to_lowercase();

    // Etikettendrucker. DYMO und Zebra bauen fast nur solche; bei den anderen
    // entscheidet die Modellreihe.
    const ETIKETT: [&str; 18] = [
        "dymo",
        "zebra",
        "labelwriter",
        "label",
        "etikett",
        "tsc",
        "godex",
        "argox",
        "brother ql",
        "ql-",
        "zd220",
        "zd230",
        "zd420",
        "gk420",
        "gc420",
        "lp2844",
        "seiko slp",
        "munbyn",
    ];
    // Bondrucker. Die Modellreihen sind eindeutiger als die Marken: Epson und
    // Star bauen auch anderes.
    const BON: [&str; 14] = [
        "srp-", "tm-t", "tm-u", "tm-m", "tsp1", "tsp6", "tsp7", "tup", "bixolon", "sewoo", "bon",
        "receipt", "thermal", "pos-",
    ];
    // Bürodrucker.
    const A4: [&str; 12] = [
        "laserjet",
        "officejet",
        "envy",
        "deskjet",
        "pixma",
        "imageclass",
        "mfc-",
        "dcp-",
        "hl-",
        "lexmark",
        "kyocera",
        "workforce",
    ];

    for (liste, rolle, was) in [
        (&ETIKETT[..], Druckerrolle::Etikett, "Etikettendrucker"),
        (&BON[..], Druckerrolle::Bon, "Bondrucker"),
        (&A4[..], Druckerrolle::A4, "Bürodrucker"),
    ] {
        if let Some(treffer) = liste.iter().find(|k| geraet.contains(*k)) {
            return (
                rolle,
                format!("\u{201e}{treffer}\u{201c} im Ger\u{e4}tenamen \u{201e}{anzeige}\u{201c} \u{2014} typisch f\u{fc}r einen {was}."),
            );
        }
        if let Some(treffer) = liste.iter().find(|k| name.contains(*k)) {
            return (
                rolle,
                format!("\u{201e}{treffer}\u{201c} im Namen der Warteschlange \u{201e}{queue}\u{201c} \u{2014} vermutlich ein {was}."),
            );
        }
    }

    (
        Druckerrolle::Unbekannt,
        format!("\u{201e}{anzeige}\u{201c} ist keiner bekannten Bauart zuzuordnen. Bitte von Hand w\u{e4}hlen."),
    )
}

/// Welche Sprache spricht dieses Gerät als Etikettendrucker?
///
/// Dieselbe Quelle wie bei der Rolle: Hersteller und Modell aus der
/// Geräteadresse, hilfsweise der Name der Warteschlange. Und dieselbe Haltung:
/// die Begründung wird mitgeliefert, weil ein Mensch sie überstimmen können
/// muss.
///
/// Die Vorgabe ist ZPL — nicht, weil es wahrscheinlicher wäre, sondern weil es
/// die bisherige Vorgabe war und ein stiller Wechsel schlimmer wäre als eine
/// Vermutung, die dabeisteht.
pub fn sprache_raten(uri: &str, queue: &str) -> (Etikettensprache, String) {
    let (h, m) = hersteller_und_modell(uri);
    let anzeige = format!("{h} {m}").trim().to_string();
    let geraet = anzeige.to_lowercase();
    let name = queue.to_lowercase();
    let beides = format!("{geraet} {name}");

    // Geräte ohne eigene Sprache. Sie bekommen eine fertige Seite, die der
    // Herstellertreiber rastert.
    const RASTER: [&str; 8] = [
        "dymo",
        "labelwriter",
        "labelmanager",
        "seiko",
        "slp ",
        "brother ql",
        "ql-",
        "quicklabel",
    ];
    // Bonmodus. Ein Bondrucker, der Etiketten bekommt, spricht ESC/POS.
    const ESCPOS: [&str; 9] = [
        "srp-", "tm-t", "tm-u", "tm-m", "tsp1", "tsp6", "tsp7", "bixolon", "sewoo",
    ];

    if let Some(treffer) = RASTER.iter().find(|k| beides.contains(*k)) {
        return (
            Etikettensprache::Raster,
            format!(
                "\u{201e}{treffer}\u{201c} in \u{201e}{anzeige}\u{201c} \u{2014} dieses Ger\u{e4}t hat keine eigene Druckersprache. Es bekommt das Etikett als fertige Seite, die der Systemtreiber rastert."
            ),
        );
    }
    if let Some(treffer) = ESCPOS.iter().find(|k| beides.contains(*k)) {
        return (
            Etikettensprache::Escpos,
            format!(
                "\u{201e}{treffer}\u{201c} in \u{201e}{anzeige}\u{201c} \u{2014} ein Ger\u{e4}t aus der Bonreihe, das ESC/POS versteht."
            ),
        );
    }
    (
        Etikettensprache::Zpl,
        format!(
            "F\u{fc}r \u{201e}{anzeige}\u{201c} ist die Sprache nicht sicher zu erkennen. Angenommen wird ZPL, die verbreitetste \u{2014} bitte pr\u{fc}fen, wenn nichts herauskommt."
        ),
    )
}

/// Aus dem, was `lpinfo -m` WIRKLICH anbietet, den passenden Treiber wählen.
///
/// Es wird nicht geraten und nichts fest verdrahtet: die Liste kommt vom
/// System, gesucht wird der Eintrag, in dem der Hersteller vorkommt. Passt
/// keiner, wird das gesagt — ein falscher Treiber druckt Unsinn und ist
/// schlimmer als eine ehrliche Absage.
///
/// Eine Zeile lautet: `drv:///sample.drv/dymo.ppd DYMO Label Printer`.
pub fn treiber_waehlen(angebot: &str, hersteller: &str, modell: &str) -> Option<(String, String)> {
    let marke = hersteller.trim().to_lowercase();
    if marke.is_empty() {
        return None;
    }
    let modellwoerter: Vec<String> = modell
        .to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| w.len() >= 3)
        .map(|w| w.to_string())
        .collect();

    let mut bestes: Option<(usize, String, String)> = None;
    for zeile in angebot.lines() {
        let zeile = zeile.trim();
        let Some((adresse, bezeichnung)) = zeile.split_once(char::is_whitespace) else {
            continue;
        };
        let bezeichnung = bezeichnung.trim();
        let heuhaufen = format!("{adresse} {bezeichnung}").to_lowercase();
        if !heuhaufen.contains(&marke) {
            continue;
        }
        // Der Hersteller zählt, jedes wiedererkannte Modellwort zählt nach.
        let punkte = 1 + modellwoerter
            .iter()
            .filter(|w| heuhaufen.contains(w.as_str()))
            .count();
        // `map_or` und nicht `is_none_or`: das gibt es erst ab Rust 1.82, und
        // dieses Programm wird ab 1.75 übersetzt. Sonst scheitert der Bau erst
        // auf der Baumaschine, nicht hier.
        if bestes.as_ref().map_or(true, |(p, _, _)| punkte > *p) {
            bestes = Some((punkte, adresse.to_string(), bezeichnung.to_string()));
        }
    }
    bestes.map(|(_, adresse, bezeichnung)| (adresse, bezeichnung))
}

/// Alles finden: eingerichtete Warteschlangen UND angeschlossene Geräte ohne.
#[tauri::command]
pub async fn detect_printers() -> HwResult<Vec<ErkannterDrucker>> {
    if config::is_mock_mode() {
        return Ok(vec![
            ErkannterDrucker {
                queue: "Mock-Bondrucker".into(),
                device_uri: "usb://BIXOLON/SRP-350".into(),
                hersteller: "BIXOLON".into(),
                modell: "SRP-350".into(),
                verbindung: "usb".into(),
                rolle: Druckerrolle::Bon,
                begruendung: "Testbetrieb.".into(),
                eingerichtet: true,
                sprache: Etikettensprache::Escpos,
                sprache_grund: "Testbetrieb.".into(),
            },
            ErkannterDrucker {
                queue: String::new(),
                device_uri: "usb://DYMO/LabelWriter%20450".into(),
                hersteller: "DYMO".into(),
                modell: "LabelWriter 450".into(),
                verbindung: "usb".into(),
                rolle: Druckerrolle::Etikett,
                begruendung: "Testbetrieb.".into(),
                eingerichtet: false,
                sprache: Etikettensprache::Raster,
                sprache_grund: "Testbetrieb.".into(),
            },
        ]);
    }
    detect_printers_impl().await
}

#[cfg(not(target_os = "windows"))]
async fn detect_printers_impl() -> HwResult<Vec<ErkannterDrucker>> {
    let mut gefunden: Vec<ErkannterDrucker> = Vec::new();
    // ⚠️ 02.08.2026. Beide Blöcke prüften nur `if let Ok(…)`. Das `Ok` sagt
    // allein, dass der Prozess GESTARTET werden konnte — nicht, dass er eine
    // Antwort gab. Läuft CUPS nicht, fehlt das Programm, oder verweigert es
    // die Auskunft, blieb `stdout` leer, die Schleife lief nullmal, und heraus
    // kam `Ok(vec![])`: ununterscheidbar von „nichts angeschlossen".
    //
    // Die Fläche sagte dann „Kein Drucker gefunden. Gerät einschalten,
    // USB-Kabel prüfen." Der Händler hält das Gerät in der Hand und prüft ein
    // Kabel, an dem es nie lag — dieselbe Klasse wie das „[object Object]":
    // die Kasse redet über den Drucker, wenn sie über SICH reden müsste.
    let mut werkzeug_versagt: Vec<String> = Vec::new();

    // ── 1. Was bereits eine Warteschlange hat ───────────────────────────────
    match tokio::process::Command::new("lpstat")
        .arg("-v")
        .output()
        .await
    {
        Err(e) => werkzeug_versagt.push(format!("lpstat liess sich nicht starten: {e}")),
        Ok(out) if !out.status.success() && out.stdout.is_empty() => {
            werkzeug_versagt.push(format!(
                "lpstat endete mit {:?}: {}",
                out.status.code(),
                String::from_utf8_lossy(&out.stderr).trim()
            ))
        }
        Ok(out) => {
            for zeile in String::from_utf8_lossy(&out.stdout).lines() {
                let Some(rest) = zeile.strip_prefix("device for ") else {
                    continue;
                };
                let Some((queue, uri)) = rest.split_once(": ") else {
                    continue;
                };
                let (queue, uri) = (queue.trim(), uri.trim());
                let (h, m) = hersteller_und_modell(uri);
                let (rolle, begruendung) = rolle_raten(uri, queue);
                let (sprache, sprache_grund) = sprache_raten(uri, queue);
                gefunden.push(ErkannterDrucker {
                    queue: queue.to_string(),
                    device_uri: uri.to_string(),
                    hersteller: h,
                    modell: m,
                    verbindung: verbindungsart(uri).to_string(),
                    rolle,
                    begruendung,
                    eingerichtet: true,
                    sprache,
                    sprache_grund,
                });
            }
        }
    }

    // ── 2. Was ANGESCHLOSSEN ist, aber noch keine Warteschlange hat ─────────
    //
    // Genau hier lag Basels Etikettendrucker: eingesteckt, vom System gesehen,
    // aber ohne Warteschlange — und damit in jeder Liste unsichtbar.
    match tokio::process::Command::new("lpinfo")
        .arg("-v")
        .output()
        .await
    {
        Err(e) => werkzeug_versagt.push(format!("lpinfo liess sich nicht starten: {e}")),
        Ok(out) if !out.status.success() && out.stdout.is_empty() => {
            werkzeug_versagt.push(format!(
                "lpinfo endete mit {:?}: {}",
                out.status.code(),
                String::from_utf8_lossy(&out.stderr).trim()
            ))
        }
        Ok(out) => {
            for zeile in String::from_utf8_lossy(&out.stdout).lines() {
                // Zeilen lauten: „direct usb://DYMO/LabelWriter%20450?serial=…"
                let mut teile = zeile.split_whitespace();
                let _art = teile.next();
                let Some(uri) = teile.next() else { continue };
                if !uri.contains("://") {
                    continue;
                }
                // Schon als Warteschlange bekannt? Dann nicht doppelt zeigen. Die
                // Seriennummer haengt mal dran und mal nicht, deshalb wird nur der
                // Teil VOR dem Fragezeichen verglichen.
                let kern = uri.split('?').next().unwrap_or(uri);
                if gefunden
                    .iter()
                    .any(|d| d.device_uri.split('?').next().unwrap_or("") == kern)
                {
                    continue;
                }
                let (h, m) = hersteller_und_modell(uri);
                if h.is_empty() && m.is_empty() {
                    continue;
                }
                let (rolle, begruendung) = rolle_raten(uri, "");
                let (sprache, sprache_grund) = sprache_raten(uri, "");
                gefunden.push(ErkannterDrucker {
                    queue: String::new(),
                    device_uri: uri.to_string(),
                    hersteller: h,
                    modell: m,
                    verbindung: verbindungsart(uri).to_string(),
                    rolle,
                    begruendung,
                    eingerichtet: false,
                    sprache,
                    sprache_grund,
                });
            }
        }
    }

    // ⚠️ Nur wenn BEIDE Werkzeuge versagt haben UND nichts gefunden wurde, ist
    // die leere Liste eine Lüge. Versagt nur eines, stehen die Warteschlangen
    // noch da — dann fehlt zwar das noch nicht eingerichtete Gerät, aber eine
    // Ablehnung wäre schlimmer als eine unvollständige Liste.
    if gefunden.is_empty() && !werkzeug_versagt.is_empty() {
        return Err(HardwareError::LocalIo(format!(
            "Das Drucksystem dieses Rechners hat keine Auskunft gegeben, deshalb ist diese Liste \
             leer — es heisst NICHT, dass kein Drucker angeschlossen ist. {}",
            werkzeug_versagt.join(" ")
        )));
    }

    Ok(gefunden)
}

/// Eine Windows-Warteschlange in einen erkannten Drucker übersetzen.
///
/// ── WARUM DAS HIER OHNE `cfg` STEHT ────────────────────────────────────────
/// Die Auslieferung 0.7.5 scheiterte, weil in diesem Zweig eine Funktion des
/// Spoolers aufgerufen wurde, die es nicht gibt. Auf dem Mac fiel das NICHT
/// auf: alles hinter `#[cfg(target_os = "windows")]` ist für den Übersetzer
/// dieser Maschine schlicht nicht vorhanden. Grün hiess also nur „der
/// macOS-Teil ist in Ordnung".
///
/// Deshalb liegt jetzt ALLES, was ohne Windows-Systemaufrufe auskommt, in
/// dieser gewöhnlichen Funktion. Sie wird auf jedem Rechner übersetzt und
/// geprüft. Im `cfg`-Zweig bleibt nur noch die eine Zeile, die wirklich
/// Windows braucht — und genau die ist gegen die echte Signatur von
/// `win_print::list_printers` geschrieben: `Vec<(String, String)>`, also
/// (Warteschlange, Anschluss).
pub fn aus_windows_warteschlange(queue: String, port: String) -> ErkannterDrucker {
    // Windows kennt keine CUPS-Adresse. Der Name der Warteschlange ist hier die
    // einzige Kennung, die Hersteller und Modell trägt, also wird die Rolle aus
    // ihm geraten — der Anschluss sagt nur, WIE das Gerät hängt, nicht WAS es ist.
    let gross = port.to_uppercase();
    let verbindung = if gross.starts_with("USB") {
        "usb"
    } else if gross.starts_with("IP_")
        || gross.starts_with("WSD")
        || gross.starts_with("HTTP")
        || gross.contains('.')
    {
        "netzwerk"
    } else {
        "andere"
    };
    let (rolle, begruendung) = rolle_raten(&queue, &queue);
    let (sprache, sprache_grund) = sprache_raten(&queue, &queue);
    ErkannterDrucker {
        hersteller: queue.clone(),
        modell: String::new(),
        verbindung: verbindung.to_string(),
        device_uri: port,
        queue,
        rolle,
        begruendung,
        sprache,
        sprache_grund,
        // Unter Windows richtet der Spooler die Warteschlange beim Einstecken
        // selbst ein. Was hier auftaucht, ist damit immer eingerichtet.
        eingerichtet: true,
    }
}

#[cfg(target_os = "windows")]
async fn detect_printers_impl() -> HwResult<Vec<ErkannterDrucker>> {
    let queues = tokio::task::spawn_blocking(crate::commands::win_print::list_printers)
        .await
        .map_err(|e| HardwareError::Device(format!("Spooler-Abfrage fehlgeschlagen: {e}")))?;
    Ok(queues
        .into_iter()
        .map(|(queue, port)| aus_windows_warteschlange(queue, port))
        .collect())
}

/// Für ein angeschlossenes Gerät eine Warteschlange anlegen — passend zu dem,
/// was das Gerät versteht.
///
/// ── WARUM DAS SEIT DEM 26.07.2026 VERZWEIGT ────────────────────────────────
/// Bis hierher wurde IMMER eine rohe Warteschlange angelegt (`-m raw`). Für
/// ZPL und ESC/POS ist das richtig: die Kasse spricht diese Sprachen selbst,
/// und roh heisst, dass niemand dazwischenfunkt. Für einen DYMO ist es die
/// Sackgasse — er hat keine Sprache, er braucht genau den Herstellertreiber,
/// den eine rohe Warteschlange ausschliesst. Basels Etikettendrucker war damit
/// zwar eingerichtet, aber unbedruckbar.
///
/// Der Name des Befehls bleibt, weil ihn die Oberfläche so ruft; roh ist er
/// nur noch für die zwei Sprachen, für die roh richtig ist.
#[tauri::command]
pub async fn create_raw_queue(
    device_uri: String,
    name: String,
    sprache: Option<String>,
) -> HwResult<String> {
    if config::is_mock_mode() {
        return Ok(name);
    }
    create_raw_queue_impl(device_uri, name, sprache.as_deref() == Some("RASTER")).await
}

/// Den Namen so beschneiden, wie CUPS ihn annimmt: keine Leerzeichen, kein
/// Schrägstrich, kein Doppelpunkt, kein Raute-Zeichen.
pub fn cups_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

#[cfg(not(target_os = "windows"))]
async fn create_raw_queue_impl(
    device_uri: String,
    name: String,
    braucht_treiber: bool,
) -> HwResult<String> {
    let sauber = cups_name(&name);
    if sauber.is_empty() {
        return Err(HardwareError::Device(
            "Der Name der Warteschlange ist leer.".into(),
        ));
    }

    // Der Treiber wird nicht geraten, sondern aus dem gewählt, was das System
    // anbietet. Bietet es keinen an, wird das gesagt — mit einem Weg, der
    // weiterhilft, statt mit dem Wort „Fehler".
    let modell: String = if braucht_treiber {
        let angebot = tokio::process::Command::new("lpinfo")
            .arg("-m")
            .output()
            .await
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
            .unwrap_or_default();
        let (h, m) = hersteller_und_modell(&device_uri);
        match treiber_waehlen(&angebot, &h, &m) {
            Some((adresse, bezeichnung)) => {
                eprintln!("norns-pos: Treiber f\u{fc}r {h} {m}: {adresse} ({bezeichnung})");
                adresse
            }
            None => {
                return Err(HardwareError::Device(format!(
                    "F\u{fc}r \u{201e}{h} {m}\u{201c} bietet das Betriebssystem keinen Treiber an. Dieses Ger\u{e4}t druckt keine Steuerbytes, es braucht einen. Bitte den Treiber des Herstellers installieren und danach erneut suchen."
                )));
            }
        }
    } else {
        // KEIN Herstellertreiber: die Kasse spricht ZPL und ESC/POS selbst.
        "raw".to_string()
    };

    let ausgabe = tokio::process::Command::new("lpadmin")
        .args([
            "-p",
            &sauber,
            "-E", // sofort aktiv und annehmend
            "-v",
            &device_uri,
            "-m",
            &modell,
        ])
        .output()
        .await
        .map_err(|e| HardwareError::Device(format!("lpadmin liess sich nicht starten: {e}")))?;

    if !ausgabe.status.success() {
        let meldung = String::from_utf8_lossy(&ausgabe.stderr).trim().to_string();
        // Die haeufigste Ursache ehrlich benennen, statt „Fehler" zu sagen.
        let hinweis = if meldung.to_lowercase().contains("forbidden")
            || meldung.to_lowercase().contains("not authorized")
        {
            " Das Betriebssystem verlangt dafür Administratorrechte. Bitte den Drucker einmal über die Systemeinstellungen hinzufügen; danach erkennt die Kasse ihn von selbst."
        } else {
            ""
        };
        return Err(HardwareError::Device(format!(
            "Warteschlange konnte nicht angelegt werden: {meldung}{hinweis}"
        )));
    }
    Ok(sauber)
}

#[cfg(target_os = "windows")]
async fn create_raw_queue_impl(
    _device_uri: String,
    _name: String,
    _braucht_treiber: bool,
) -> HwResult<String> {
    Err(HardwareError::Device(
        "Unter Windows richtet das System die Warteschlange beim Einstecken selbst ein. Ist der Drucker angeschlossen und erscheint hier nicht, bitte einmal \u{fc}ber \u{201e}Drucker & Scanner\u{201c} hinzuf\u{fc}gen.".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Die ECHTEN Zeilen der Pruefmaschine vom 25.07.2026, wortwoertlich.
    ///
    /// Kein erfundenes Beispiel: genau diese drei Geraete meldete `lpstat -v`
    /// und `lpinfo -v`. Das dritte ist der Fall, um den es Basel ging — ein
    /// angeschlossener Etikettendrucker OHNE Warteschlange.
    #[test]
    fn ordnet_die_echten_geraete_der_pruefmaschine_richtig_zu() {
        let faelle: [(&str, &str, Druckerrolle); 3] = [
            (
                "ippusb://HP%20ENVY%206000%20series%20%5B3C445B%5D._ipp._tcp.local./",
                "HP_ENVY_6000_series",
                Druckerrolle::A4,
            ),
            (
                "usb://SAMSUNG/SRP-350?location=1120000",
                "Warehouse14-Bon",
                Druckerrolle::Bon,
            ),
            (
                "usb://DYMO/LabelWriter%20450?serial=01010112345600",
                "", // noch keine Warteschlange — genau darum ging es
                Druckerrolle::Etikett,
            ),
        ];
        for (uri, queue, erwartet) in faelle {
            let (rolle, grund) = rolle_raten(uri, queue);
            assert_eq!(rolle, erwartet, "{uri} -> {grund}");
        }
    }

    #[test]
    fn liest_hersteller_und_modell_aus_der_geraeteadresse() {
        // Genau die Zeile, die auf der Pruefmaschine stand.
        let (h, m) = hersteller_und_modell("usb://DYMO/LabelWriter%20450?serial=01010112345600");
        assert_eq!(h, "DYMO");
        assert_eq!(m, "LabelWriter 450");

        let (h, m) = hersteller_und_modell("usb://SAMSUNG/SRP-350?location=1120000");
        assert_eq!(h, "SAMSUNG");
        assert_eq!(m, "SRP-350");
    }

    #[test]
    fn erkennt_den_etikettendrucker_am_geraet_nicht_am_namen() {
        // Der Name der Warteschlange ist leer — das Geraet allein muss reichen.
        let (rolle, grund) = rolle_raten("usb://DYMO/LabelWriter%20450", "");
        assert_eq!(rolle, Druckerrolle::Etikett);
        assert!(
            grund.contains("DYMO"),
            "die Begruendung nennt das Geraet: {grund}"
        );
    }

    #[test]
    fn erkennt_den_bondrucker_an_der_modellreihe() {
        assert_eq!(
            rolle_raten("usb://SAMSUNG/SRP-350", "").0,
            Druckerrolle::Bon
        );
        assert_eq!(rolle_raten("usb://EPSON/TM-T88VI", "").0, Druckerrolle::Bon);
        assert_eq!(rolle_raten("usb://STAR/TSP143", "").0, Druckerrolle::Bon);
    }

    #[test]
    fn erkennt_den_buerodrucker() {
        assert_eq!(
            rolle_raten("ippusb://HP%20ENVY%206000%20series/", "").0,
            Druckerrolle::A4
        );
    }

    #[test]
    fn raet_lieber_nicht_als_falsch() {
        // Ein unbekanntes Geraet wird NICHT dem Bondrucker zugeschlagen, nur
        // weil es das haeufigste waere. Der Mensch waehlt.
        let (rolle, grund) = rolle_raten("usb://ACME/Widget%209000", "");
        assert_eq!(rolle, Druckerrolle::Unbekannt);
        assert!(grund.contains("von Hand"));
    }

    #[test]
    fn der_name_der_warteschlange_zaehlt_nach() {
        // Kein bekanntes Geraet, aber der Mensch hat die Warteschlange
        // „Etiketten" genannt — das ist ein Hinweis, wenn auch ein schwaecherer.
        let (rolle, grund) = rolle_raten("usb://ACME/Widget%209000", "Etiketten-links");
        assert_eq!(rolle, Druckerrolle::Etikett);
        assert!(grund.contains("Warteschlange"));
    }

    #[test]
    fn benennt_die_anschlussart() {
        assert_eq!(verbindungsart("usb://DYMO/LabelWriter"), "usb");
        assert_eq!(verbindungsart("ippusb://HP/ENVY"), "usb");
        assert_eq!(verbindungsart("socket://192.168.1.50:9100"), "netzwerk");
        assert_eq!(
            verbindungsart("dnssd://Drucker._ipp._tcp.local/"),
            "netzwerk"
        );
        assert_eq!(verbindungsart("file:///dev/null"), "andere");
    }

    // ── Die Sprache ─────────────────────────────────────────────────────────

    /// DIE Prüfung zum Fund: der DYMO an Basels Tresen darf NICHT als
    /// ZPL-Drucker durchgehen.
    ///
    /// Genau das war der Fehler. Er wurde als Etikettendrucker erkannt, richtig
    /// übernommen — und blieb auf der Vorgabe ZPL stehen, die er nicht
    /// versteht. Danach meldete die Kasse Erfolg und es kam nichts.
    #[test]
    fn der_dymo_am_tresen_ist_ein_rasterdrucker_und_kein_zpl_drucker() {
        let (sprache, grund) =
            sprache_raten("usb://DYMO/LabelWriter%20450?serial=01010112345600", "");
        assert_eq!(sprache, Etikettensprache::Raster);
        assert_ne!(sprache, Etikettensprache::Zpl);
        assert!(grund.contains("keine eigene Druckersprache"), "{grund}");
    }

    #[test]
    fn ordnet_die_sprachen_der_gaengigen_geraete_zu() {
        let faelle: [(&str, &str, Etikettensprache); 7] = [
            // Rasterdrucker: keine Sprache, Seite plus Systemtreiber.
            ("usb://DYMO/LabelWriter%20450", "", Etikettensprache::Raster),
            ("usb://Seiko/SLP%20650", "", Etikettensprache::Raster),
            ("usb://Brother/QL-820NWB", "", Etikettensprache::Raster),
            // Zebra und Verwandte sprechen ZPL.
            ("usb://Zebra/ZD420", "", Etikettensprache::Zpl),
            ("usb://TSC/TE200", "", Etikettensprache::Zpl),
            // Bonreihe im Etikettenbetrieb: ESC/POS.
            ("usb://SAMSUNG/SRP-350", "", Etikettensprache::Escpos),
            // Der Name der Warteschlange zaehlt nach, wenn das Geraet schweigt.
            (
                "usb://ACME/Widget%209000",
                "DYMO-links",
                Etikettensprache::Raster,
            ),
        ];
        for (uri, queue, erwartet) in faelle {
            let (sprache, grund) = sprache_raten(uri, queue);
            assert_eq!(sprache, erwartet, "{uri} -> {grund}");
        }
    }

    /// Ein unbekanntes Gerät bekommt die bisherige Vorgabe — aber mit einem
    /// Satz, der zugibt, dass es geraten ist.
    #[test]
    fn eine_unbekannte_marke_gibt_die_unsicherheit_zu() {
        let (sprache, grund) = sprache_raten("usb://ACME/Widget%209000", "");
        assert_eq!(sprache, Etikettensprache::Zpl);
        assert!(grund.contains("nicht sicher"), "{grund}");
        assert!(grund.contains("pr\u{fc}fen"), "{grund}");
    }

    // ── Der Treiber ─────────────────────────────────────────────────────────

    /// Das ECHTE Angebot dieser Maschine, wortwörtlich aus `lpinfo -m`.
    ///
    /// Die DYMO-Zeile ist genau die, mit der am 25.07.2026 von Hand erfolgreich
    /// gedruckt wurde. Die anderen stehen dabei, damit die Wahl auch dann noch
    /// stimmt, wenn viel angeboten wird.
    const LPINFO_M: &str = "\
drv:///sample.drv/deskjet.ppd HP DeskJet Series
drv:///sample.drv/dymo.ppd DYMO Label Printer
drv:///sample.drv/epson24.ppd Epson 24-Pin Series
drv:///sample.drv/zebra.ppd Zebra ZPL Label Printer
drv:///sample.drv/generic.ppd Generic PostScript Printer
raw Raw Queue
";

    #[test]
    fn waehlt_den_dymo_treiber_aus_dem_echten_angebot() {
        let (adresse, bezeichnung) = treiber_waehlen(LPINFO_M, "DYMO", "LabelWriter 450")
            .expect("der Treiber wird angeboten");
        assert_eq!(adresse, "drv:///sample.drv/dymo.ppd");
        assert_eq!(bezeichnung, "DYMO Label Printer");
    }

    #[test]
    fn nimmt_nicht_den_erstbesten_sondern_den_zum_hersteller_passenden() {
        let (adresse, _) = treiber_waehlen(LPINFO_M, "Zebra", "ZD420").expect("angeboten");
        assert_eq!(adresse, "drv:///sample.drv/zebra.ppd");
    }

    /// Kein passender Treiber heisst: sagen, nicht irgendeinen nehmen.
    ///
    /// Ein falscher Treiber druckt Unsinn auf teure Etiketten. Eine ehrliche
    /// Absage kostet nur einen Satz.
    #[test]
    fn nennt_keinen_treiber_wenn_keiner_passt() {
        assert!(treiber_waehlen(LPINFO_M, "Munbyn", "ITPP941").is_none());
        assert!(treiber_waehlen(LPINFO_M, "", "LabelWriter").is_none());
        assert!(treiber_waehlen("", "DYMO", "LabelWriter 450").is_none());
    }

    #[test]
    fn beschneidet_den_namen_der_warteschlange_auf_das_erlaubte() {
        assert_eq!(
            cups_name("W14-DYMO-LabelWriter 450"),
            "W14-DYMO-LabelWriter-450"
        );
        assert_eq!(cups_name("A/B:C#D"), "A-B-C-D");
        assert_eq!(cups_name(""), "");
    }

    /// Der Windows-Zweig, geprüft auf dem Mac.
    ///
    /// Genau dieser Zweig hat 0.7.5 zu Fall gebracht, weil er hier nie
    /// übersetzt wurde. Jetzt hängt seine gesamte Logik an einer gewöhnlichen
    /// Funktion, und diese Prüfung läuft auf jeder Maschine mit.
    #[test]
    fn uebersetzt_eine_windows_warteschlange() {
        // So meldet der Spooler einen per USB angeschlossenen Etikettendrucker.
        let d = aus_windows_warteschlange("DYMO LabelWriter 450".into(), "USB003".into());
        assert_eq!(d.rolle, Druckerrolle::Etikett);
        assert_eq!(d.verbindung, "usb");
        assert_eq!(d.device_uri, "USB003");
        assert_eq!(d.queue, "DYMO LabelWriter 450");
        // Unter Windows gibt es keine Geraete ohne Warteschlange.
        assert!(d.eingerichtet);
        // Und auch dort ist ein DYMO ein Rasterdrucker — der Windows-Zweig
        // kennt nur den Namen, und der genuegt fuer diese Aussage.
        assert_eq!(d.sprache, Etikettensprache::Raster);

        let netz = aus_windows_warteschlange("BIXOLON SRP-350".into(), "IP_192.168.1.50".into());
        assert_eq!(netz.rolle, Druckerrolle::Bon);
        assert_eq!(netz.verbindung, "netzwerk");

        // Ein Anschluss, der weder USB noch Netz ist, wird auch so genannt.
        let sonst = aus_windows_warteschlange("Irgendwas".into(), "LPT1:".into());
        assert_eq!(sonst.verbindung, "andere");
        assert_eq!(sonst.rolle, Druckerrolle::Unbekannt);
    }
}

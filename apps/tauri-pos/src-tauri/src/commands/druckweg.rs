//! Welcher Weg führt auf DIESEM Betriebssystem zum Papier.
//!
//! ── DER FUND VOM 02.08.2026 ─────────────────────────────────────────────────
//!
//! `label.rs` und `pdf.rs` riefen beide `lpr`. Ohne Zweig, ohne Prüfung. Auf
//! macOS und Linux ist das richtig: `lpr` gehört zu CUPS.
//!
//! Windows hat kein `lpr`. Der Aufruf scheitert nicht am Drucker, sondern schon
//! daran, dass es das Programm nicht gibt: `std::io::ErrorKind::NotFound`. Das
//! wird zu `HardwareError::LocalIo`, und der Händler liest den Satz, den das
//! Haus für diese Art vorsieht:
//!
//! ```text
//! Eine lokale Datei konnte nicht gespeichert werden.
//! Bitte Speicherplatz prüfen und erneut versuchen.
//! ```
//!
//! Kein Etikett, keine Rechnung, und als Auskunft ein Hinweis auf die
//! Festplatte. Der Händler prüft seinen Speicherplatz, findet 400 Gigabyte
//! frei, und hat keine Ahnung, was er tun soll.
//!
//! Bitter daran: der Bondrucker funktioniert auf Windows längst. `thermal.rs`
//! ruft `win_print::print_raw`, spricht also direkt mit dem Spooler. Nur die
//! beiden anderen Wege wussten davon nichts.
//!
//! ── WARUM DIESE ENTSCHEIDUNG EINE EIGENE, REINE FUNKTION IST ───────────────
//!
//! Auf diesem Rechner lässt sich Windows-Code NICHT übersetzen: `ring` (über
//! rustls hereingezogen) braucht einen C-Übersetzer für das Windows-Ziel, und
//! den hat ein Mac nicht. Ein `cargo check --target x86_64-pc-windows-msvc`
//! bricht ab, BEVOR unser Code an der Reihe ist.
//!
//! Alles, was hinter `#[cfg(windows)]` steht, ist hier also ungeprüft. Deshalb
//! liegt die ENTSCHEIDUNG in einer reinen Funktion, die auf jeder Plattform
//! übersetzt und geprüft wird, und hinter dem `cfg` steht nur noch der eine
//! Aufruf, den sie ausgewählt hat.
//!
//! Genau dieses Muster benutzt `label.rs` schon: `lpr_argumente` ist rein und
//! hat Prüfungen, `lpr_ausfuehren` ist die dünne, ungeprüfte Schale.

/// Wie die Bytes zum Drucker kommen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Druckweg {
    /// CUPS: `lpr`. macOS und Linux.
    Cups,
    /// Der Windows-Spooler, Datentyp „RAW". Für Steuerbytes (ZPL, ESC/POS).
    WindowsRoh,
    /// Auf Windows gibt es für eine fertige SEITE keinen rohen Weg: der
    /// Spooler würde die PDF-Bytes unverändert an den Drucker schicken, und
    /// heraus käme der Quelltext des Dokuments statt eines Bildes.
    ///
    /// Deshalb der Umweg über den Betrachter des Systems. Das ist keine
    /// Notlüge, sondern ein Weg, der WIRKLICH zum Papier führt: die Datei
    /// öffnet sich, und ein Druck ist ein Tastendruck entfernt.
    WindowsSeiteUeberBetrachter,
}

/// Was gedruckt werden soll.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Druckgut {
    /// Steuerbytes, die der Drucker selbst versteht: ZPL, ESC/POS.
    Steuerbytes,
    /// Eine fertige Seite als PDF: der Rasterweg und die A4-Rechnung.
    Seite,
}

/// Die Entscheidung. `windows` kommt vom Aufrufer, damit dieser Satz auf JEDER
/// Plattform prüfbar ist — würde er `cfg!(windows)` selbst lesen, liesse sich
/// der Windows-Fall auf einem Mac nie prüfen, und das ist der ganze Punkt.
pub fn druckweg_fuer(gut: Druckgut, windows: bool) -> Druckweg {
    match (gut, windows) {
        (_, false) => Druckweg::Cups,
        (Druckgut::Steuerbytes, true) => Druckweg::WindowsRoh,
        (Druckgut::Seite, true) => Druckweg::WindowsSeiteUeberBetrachter,
    }
}

/// Der Satz, den der Händler liest, wenn die Seite im Betrachter landet.
///
/// Er sagt WAS geschehen ist und WAS zu tun ist. Ein Satz, der nur „nicht
/// unterstützt" sagt, wäre zwar ehrlich, liesse den Menschen aber genauso
/// stehen wie der Hinweis auf den Speicherplatz.
pub const SEITE_IM_BETRACHTER: &str = "Das Dokument wurde im Betrachter dieses Rechners geöffnet. \
Windows kann eine fertige Seite nicht roh an die Warteschlange geben; bitte dort auf Drucken \
gehen und den gewünschten Drucker wählen. Etiketten mit eigener Druckersprache (Zebra und \
Verwandte, Bonreihe) druckt die Kasse auf Windows direkt.";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ohne_windows_bleibt_alles_bei_cups() {
        // Der bisherige Weg darf sich NICHT ändern. Diese Kasse läuft heute auf
        // macOS, und ein stiller Wechsel wäre schlimmer als die Lücke.
        assert_eq!(druckweg_fuer(Druckgut::Steuerbytes, false), Druckweg::Cups);
        assert_eq!(druckweg_fuer(Druckgut::Seite, false), Druckweg::Cups);
    }

    #[test]
    fn auf_windows_gehen_steuerbytes_roh_an_den_spooler() {
        // Genau der Weg, den der Bondrucker seit jeher benutzt und der dort
        // beweisbar funktioniert.
        assert_eq!(
            druckweg_fuer(Druckgut::Steuerbytes, true),
            Druckweg::WindowsRoh
        );
    }

    #[test]
    fn auf_windows_geht_eine_seite_NICHT_roh() {
        // ⚠️ Der teuerste Fehler, den man hier machen könnte: die Seite auch
        // roh schicken, weil der Zweig dann kürzer ist. Der Spooler gibt die
        // PDF-Bytes unverändert weiter, und aus dem Drucker kommen Seiten
        // voller Quelltext. Grün wäre es trotzdem — es käme ja Papier.
        assert_ne!(druckweg_fuer(Druckgut::Seite, true), Druckweg::WindowsRoh);
        assert_eq!(
            druckweg_fuer(Druckgut::Seite, true),
            Druckweg::WindowsSeiteUeberBetrachter
        );
    }

    #[test]
    fn kein_weg_fuehrt_je_zu_lpr_auf_windows() {
        // Der eigentliche Fund, als Satz: auf Windows darf NIE `lpr`
        // herauskommen. Genau das war der Zustand, und genau das las sich für
        // den Händler wie ein Problem mit seiner Festplatte.
        for gut in [Druckgut::Steuerbytes, Druckgut::Seite] {
            assert_ne!(
                druckweg_fuer(gut, true),
                Druckweg::Cups,
                "auf Windows gibt es kein lpr — dieser Weg endet in „Speicherplatz prüfen\""
            );
        }
    }

    #[test]
    fn der_satz_nennt_die_handlung_und_die_grenze() {
        // Ein Satz ohne Handlung ist so wenig wert wie der falsche Satz.
        assert!(SEITE_IM_BETRACHTER.contains("Drucken"));
        // Und er darf nicht den Eindruck erwecken, auf Windows ginge gar
        // nichts: die Steuerbytes-Etiketten druckt die Kasse dort direkt.
        assert!(SEITE_IM_BETRACHTER.contains("direkt"));
        // Kein Wort über Speicherplatz. Das war die Lüge.
        assert!(!SEITE_IM_BETRACHTER.contains("Speicherplatz"));
    }
}

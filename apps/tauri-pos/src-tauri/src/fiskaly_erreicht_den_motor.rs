//! ═══════════════════════════════════════════════════════════════════════
//!  ⛔ DIE FISKALY-SCHLUESSEL ERREICHEN DEN MOTOR
//! ═══════════════════════════════════════════════════════════════════════
//!
//! ── DER FUND VOM 20.08.2026, LIVE GEMESSEN ─────────────────────────────
//!
//! Basels Frage war: „wenn ich die fiskaly-Schluessel eintrage, laeuft es
//! dann sofort?" Der Weg wurde am ECHTEN Dienst nachgefahren: Anmeldung,
//! TSE anlegen, in Betrieb nehmen, Kasse anmelden, Verkauf signieren —
//! alles gelingt. Nur die Einrichtungsroute des Motors antwortete
//!
//!     geprueft: false
//!     „Fuer diese Kasse sind keine fiskaly-Zugangsdaten hinterlegt."
//!
//! und trug die Kennung UNGEPRUEFT ein. Der Grund: die Schluessel wohnen im
//! Schluesselbund (`commands/tse.rs`), und der Rumpf reichte dem Motor nur
//! die vier Startgeheimnisse des Tresors durch. Zwei Haelften desselben
//! Weges, die sich nie begegnet sind. Ein Zahlendreher in der Kennung waere
//! erst beim ersten Verkauf aufgefallen.
//!
//! Nach der Bruecke, am selben Motor gemessen:
//!
//!     geprueft: true
//!     „Die TSE ist erreichbar, scharf und dieser Kassenklient ist dort
//!      registriert."
//!
//! ── WAS DIESER WAECHTER HAELT ──────────────────────────────────────────
//!
//! Dass der Rumpf die Bruecke WIRKLICH aufruft. Ein Umbau von `motor.rs`,
//! der sie beilaeufig entfernt, macht die Live-Pruefung still wieder
//! wirkungslos — und die Kasse saehe genauso aus wie vorher.

#[cfg(test)]
mod tests {
    /// Der Rumpf reicht die Zugangsdaten an den Kindprozess durch.
    #[test]
    fn der_motor_bekommt_die_zugangsdaten() {
        let motor = include_str!("motor.rs");
        assert!(
            motor.contains("fiskaly_fuer_motor()"),
            "der Rumpf reicht die fiskaly-Zugangsdaten nicht mehr an den Motor durch; \
             die Einrichtung traegt jede Kennung dann wieder UNGEPRUEFT ein"
        );
        // Und zwar als Umgebung des Kindprozesses, nicht nur als toter Aufruf.
        let ab = motor
            .find("fiskaly_fuer_motor()")
            .expect("Aufruf ist da, aber nicht auffindbar");
        assert!(
            motor[ab..].contains("befehl.env("),
            "der Aufruf steht da, aber sein Ergebnis landet nicht in der Umgebung"
        );
    }

    /// Eine halbe Angabe ist schlimmer als keine.
    #[test]
    fn nur_beide_zusammen_oder_gar_nichts() {
        let tse = include_str!("commands/tse.rs");
        let ab = tse
            .find("pub(crate) fn fiskaly_fuer_motor")
            .expect("die Bruecke ist verschwunden");
        let rumpf = &tse[ab..];
        assert!(
            rumpf.contains("(Some(k), Some(s))"),
            "die Bruecke gibt womoeglich eine halbe Zugangsangabe heraus; \
             der Motor versuchte dann eine Pruefung, die nur scheitern kann"
        );
        assert!(
            rumpf.contains("_ => Vec::new()"),
            "der Rueckfall auf NICHTS fehlt"
        );
    }
}

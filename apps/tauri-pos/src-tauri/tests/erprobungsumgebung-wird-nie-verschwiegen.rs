//! ⚠️ WÄCHTER: Eine Erprobungssignatur darf NIE als rechtsgültig durchgehen.
//!
//! ── DER BEFUND VOM 13.08.2026 ───────────────────────────────────────────
//!
//! Derselbe halbe Fix an derselben Ampel. Die Attrappe bekam einen Riegel für
//! den Freigabebau (`attrappe-im-freigabebau.rs`). Der Schalter für die
//! fiskaly-ADRESSE bekam keinen.
//!
//! Gemessen: ausserhalb von `config.rs` wird `NORNS_FISKALY_BASE_URL`
//! nur in `tests/tse_hil.rs` gesetzt, und in der ganzen Fläche gibt es NULL
//! Treffer für „Testumgebung" oder „Produktivumgebung".
//!
//! Eine ausgelieferte Kasse konnte damit mit EINER Umgebungsvariablen gegen
//! die Erprobungsumgebung signieren, und alles sah grün aus: grüne Ampel,
//! signierte Belege, QR-Codes, DSFinV-K-Ausfuhr. Nur wäre jede einzelne
//! Signatur vor dem Finanzamt wertlos gewesen — und der Händler hätte es am
//! Tag der Prüfung erfahren, mit Jahren ungültiger Aufzeichnungen.
//!
//! ── WAS DIESER WÄCHTER MISST ────────────────────────────────────────────
//!
//! Nicht, dass die Erprobung verboten ist — sie ist erlaubt und nötig, sonst
//! liesse sich der fiskalische Weg nie üben. Er misst, dass sie NIE
//! VERSCHWIEGEN wird: keine fremde Adresse darf je als `Produktiv` gelten,
//! und `ist_rechtsgueltig` muss für sie falsch sein.

use norns_pos_lib::config::{fiskal_umgebung_entscheiden, FiskalUmgebung, FISKALY_PRODUKTIV};

#[test]
fn ohne_schalter_gilt_die_amtliche_umgebung() {
    // Der Regelfall beim Händler: niemand setzt eine Umgebungsvariable.
    assert_eq!(fiskal_umgebung_entscheiden(None), FiskalUmgebung::Produktiv);
    assert!(fiskal_umgebung_entscheiden(None).ist_rechtsgueltig());
}

#[test]
fn die_amtliche_adresse_bleibt_produktiv() {
    // Auch ausdrücklich gesetzt, auch mit Schrägstrich am Ende.
    for a in [FISKALY_PRODUKTIV, &format!("{FISKALY_PRODUKTIV}/"), " "] {
        let u = fiskal_umgebung_entscheiden(Some(a));
        assert_eq!(
            u,
            FiskalUmgebung::Produktiv,
            "Adresse {a:?} wurde nicht als amtlich erkannt"
        );
    }
}

/// ⚠️ Der eigentliche Wächter. Wer diesen Test rot macht, hat einen Weg
/// gebaut, auf dem eine wertlose Signatur wie eine gültige aussieht.
#[test]
fn jede_fremde_adresse_ist_erprobung_und_nie_rechtsgueltig() {
    for a in [
        "https://test.hub.fiskaly.com",
        "https://kassensichv-test.fiskaly.com/api/v2",
        "http://127.0.0.1:8080",
        "https://kassensichv.fiskaly.com/api/v1",
        "https://boeser-zwilling.example/api/v2",
    ] {
        let u = fiskal_umgebung_entscheiden(Some(a));
        assert!(
            matches!(u, FiskalUmgebung::Erprobung { .. }),
            "{a} wurde als amtliche Umgebung durchgelassen"
        );
        assert!(
            !u.ist_rechtsgueltig(),
            "{a} liefert angeblich rechtsgueltige Signaturen"
        );
        assert_eq!(u.adresse(), a, "die Adresse wurde unterwegs verbogen");
    }
}

/// Ein Tippfehler darf nicht still zur amtlichen Umgebung werden. Wer sich
/// vertippt, soll eine Erprobung sehen und stutzen, statt zu glauben, er
/// signiere amtlich.
#[test]
fn ein_tippfehler_gilt_nicht_als_amtlich() {
    for a in [
        "https://kassensich.fiskaly.com/api/v2",
        "https://kassensichv.fiskaly.de/api/v2",
        "http://kassensichv.fiskaly.com/api/v2",
    ] {
        assert!(
            !fiskal_umgebung_entscheiden(Some(a)).ist_rechtsgueltig(),
            "der Tippfehler {a} galt als amtliche Umgebung"
        );
    }
}

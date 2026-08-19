//! ════════════════════════════════════════════════════════════════════════
//!  ⛔ Im Freigabebau gibt es KEINEN Weg zur Attrappe
//! ════════════════════════════════════════════════════════════════════════
//!
//! ── DER BEFUND ──────────────────────────────────────────────────────────
//!
//! `NORNS_MOCK_HARDWARE=1` schlug das Bauprofil, auch im Freigabebau.
//! Eine gesetzte Umgebungsvariable genügte, und `tse_finish_transaction`
//! lieferte eine erfundene Signatur `MOCK-SIG-…` statt einer echten. Die
//! Kasse druckte dazu einen echt aussehenden QR-Code mit `MOCK-QR;…`, der
//! Motor nahm den Wert in `tse_signatures` auf, und von dort ging er
//! unverändert in `TSE_TA_SIG` des amtlichen Prüfpakets.
//!
//! Der Prüfer läse eine Signatur, die es nie gab, und die Kasse behauptete
//! sie in einem Auszug nach § 146a AO. Hausklasse „erfinden, wenn nicht
//! eingerichtet", an der teuersten denkbaren Stelle.
//!
//! ── ⚠️ WARUM DER NAHELIEGENDE RIEGEL SICH NICHT MESSEN LIESSE ──────────
//!
//! Ein `#[cfg(not(debug_assertions))]` mitten in `is_mock_mode` wäre der
//! erste Gedanke. Der Läufer fährt `cargo test` aber OHNE `--release`
//! (.github/workflows/ci.yml). Der Satz hinter dem Bauprofil würde dort nie
//! übersetzt, also nie ausgeführt und nie rot. Ein Riegel, den kein Lauf je
//! anfasst, ist eine Behauptung.
//!
//! Deshalb trägt `attrappe_entscheiden` das Bauprofil als ARGUMENT. Sie ist
//! damit in JEDEM Profil prüfbar, und `is_mock_mode` ist nur noch ihr
//! Aufrufer. Diese Datei misst die reine Entscheidung.

use norns_pos_lib::config::attrappe_entscheiden;

#[test]
fn im_freigabebau_ist_der_schalter_wirkungslos() {
    // ⛔ DER KERN. Jede Schreibweise, die ein Mensch je gesetzt hat.
    for schalter in [Some("1"), Some("true"), Some("TRUE"), Some("True")] {
        assert!(
            !attrappe_entscheiden(true, schalter),
            "der Freigabebau laesst sich mit {schalter:?} in die Attrappe kippen — \
             ein Haendler wuerde Belege mit erfundenen Signaturen drucken"
        );
    }
}

#[test]
fn und_auch_ohne_schalter_bleibt_der_freigabebau_echt() {
    assert!(
        !attrappe_entscheiden(true, None),
        "der Freigabebau faellt ohne Schalter in die Attrappe"
    );
}

#[test]
fn im_entwicklungsbau_bleibt_die_attrappe_erreichbar() {
    /*
     * ⚠️ Die Gegenrichtung gehört dazu. Ein Riegel, der die Attrappe ÜBERALL
     * abschaltet, macht die Entwicklung ohne Gerät unmöglich, und der
     * nächste Mensch schaltet ihn wieder ab. Ein Wächter, der bei einer
     * Verbesserung rot wird, wird abgeschafft.
     */
    assert!(
        attrappe_entscheiden(false, Some("1")),
        "im Entwicklungsbau laesst sich die Attrappe nicht mehr einschalten"
    );
    assert!(
        attrappe_entscheiden(false, None),
        "im Entwicklungsbau ist die Attrappe ohne Schalter nicht mehr die Vorgabe"
    );
}

#[test]
fn ein_unsinniger_wert_schaltet_nichts_ein() {
    // „0", „nein", „vielleicht" sind kein Ja. Nur ein ausdrückliches Ja zählt.
    for schalter in [Some("0"), Some("nein"), Some("false"), Some("")] {
        assert!(
            !attrappe_entscheiden(false, schalter),
            "der Wert {schalter:?} hat die Attrappe eingeschaltet"
        );
    }
}

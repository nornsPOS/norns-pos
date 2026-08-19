//! Ein Test gegen das ECHTE fiskaly (Testumgebung), kein Mock.
//!
//! Der Zweck: beweisen, dass der Anmeldeweg stimmt. Ein Unit-Test kann das
//! nicht, denn genau dieser Weg war monatelang falsch UND die Suite gruen.
//!
//! ── ⚠️ DER BEFUND VOM 13.08.2026 ────────────────────────────────────────
//!
//! Bis heute stand hier: „laeuft nur, wenn die Zugangsdaten in der Umgebung
//! stehen, und wird sonst uebersprungen". Die Absicht war richtig, die
//! Ausfuehrung log. Gemessen:
//!
//!     cargo test --test fiskaly_echt
//!     test der_rohe_schluessel_wird_von_fiskaly_abgelehnt ... ok
//!     test der_tausch_liefert_ein_brauchbares_token ... ok
//!     test result: ok. 2 passed; 0 failed; 0 ignored
//!
//! ZWEI BESTANDEN, ohne dass irgendetwas geschehen waere. Rust kennt fuer
//! `#[test]` kein „uebersprungen": ein frueher `return` ist ein BESTANDEN. Das
//! `eprintln!` daneben sieht niemand, weil cargo die Ausgabe bestandener Tests
//! verschluckt. Und gemessen setzt KEIN Fliessband `FISKALY_API_KEY`, diese
//! zwei Saetze haben also noch nie mit fiskaly gesprochen und melden auf jedem
//! Lauf „bestanden".
//!
//! Genau die Hausklasse, gegen die es sie gibt: „der Weg war falsch UND die
//! Suite gruen".
//!
//! ── DIE REPARATUR ───────────────────────────────────────────────────────
//!
//! `#[ignore]`. Damit meldet der Lauf ehrlich `0 passed; 2 ignored`, und
//! „ignoriert" ist eine wahre Aussage, „bestanden" war es nicht. Wer sie
//! wirklich fahren will:
//!
//!     FISKALY_API_KEY=... FISKALY_API_SECRET=... \
//!       cargo test --test fiskaly_echt -- --ignored --nocapture
//!
//! Und wer sie so faehrt OHNE Zugangsdaten, bekommt jetzt einen Abbruch mit
//! Begruendung statt eines stillen Bestehens.

use std::env;

/// Die Zugangsdaten, oder ein Abbruch mit Namen.
///
/// ⚠️ Kein `Option` mehr. Ein `None` fuehrte hier zu einem frueheren `return`,
/// und der ist in Rust ein BESTANDEN. Wer diese Tests ausdruecklich mit
/// `--ignored` startet, will sie fahren, und dann ist ein fehlender Schluessel
/// ein Fehler und keine Nebensache.
fn zugang() -> (String, String) {
    let k = env::var("FISKALY_API_KEY").unwrap_or_default();
    let s = env::var("FISKALY_API_SECRET").unwrap_or_default();
    assert!(
        !k.is_empty() && !s.is_empty(),
        "FISKALY_API_KEY und FISKALY_API_SECRET fehlen. Dieser Test spricht mit dem \
         ECHTEN fiskaly und kann ohne sie nichts beweisen. Er ist deshalb `#[ignore]`; \
         gefahren wird er mit:\n\n    FISKALY_API_KEY=... FISKALY_API_SECRET=... \\\n\
         \x20     cargo test --test fiskaly_echt -- --ignored --nocapture\n"
    );
    (k, s)
}

#[tokio::test]
#[ignore = "spricht mit dem ECHTEN fiskaly, braucht FISKALY_API_KEY und _SECRET"]
async fn der_rohe_schluessel_wird_von_fiskaly_abgelehnt() {
    let (key, _) = zugang();
    let base = env::var("FISKALY_BASE_URL")
        .unwrap_or_else(|_| "https://kassensichv-middleware.fiskaly.com/api/v2".into());

    // GENAU das, was der Code bis zum 26.07.2026 tat.
    let res = reqwest::Client::new()
        .get(format!("{base}/tss"))
        .bearer_auth(&key)
        .send()
        .await
        .expect("Netz");

    assert_eq!(
        res.status().as_u16(),
        401,
        "Wenn fiskaly den rohen Schluessel plotzlich AKZEPTIERT, ist die Begruendung \
         fuer den Token-Tausch hinfaellig und dieser Test muss neu bewertet werden."
    );
}

#[tokio::test]
#[ignore = "spricht mit dem ECHTEN fiskaly, braucht FISKALY_API_KEY und _SECRET"]
async fn der_tausch_liefert_ein_brauchbares_token() {
    let (key, secret) = zugang();
    let base = env::var("FISKALY_BASE_URL")
        .unwrap_or_else(|_| "https://kassensichv-middleware.fiskaly.com/api/v2".into());
    let c = reqwest::Client::new();

    let auth: serde_json::Value = c
        .post(format!("{base}/auth"))
        .json(&serde_json::json!({"api_key": key, "api_secret": secret}))
        .send()
        .await
        .expect("Netz")
        .json()
        .await
        .expect("JSON");

    let token = auth["access_token"].as_str().expect("kein access_token");
    assert!(token.starts_with("eyJ"), "das Token muss ein JWT sein");

    // Lebensdauer: fiskaly gibt 24 h. Wir puffern 120 s. Waere die Lebensdauer
    // kuerzer als der Puffer, wuerde der Zwischenspeicher bei JEDEM Aufruf neu
    // tauschen, und das faellt sonst niemandem auf.
    let gueltig = auth["access_token_expires_in"]
        .as_i64()
        .expect("keine Laufzeit");
    assert!(
        gueltig > 300,
        "Token laeuft nach {gueltig}s ab, der Puffer von 120s waere sinnlos"
    );

    // Und der Beweis, dass es wirklich oeffnet, was der Schluessel nicht oeffnet.
    let res = c
        .get(format!("{base}/tss"))
        .bearer_auth(token)
        .send()
        .await
        .expect("Netz");
    assert!(
        res.status().is_success(),
        "mit Token muss /tss antworten, bekam {}",
        res.status()
    );
}

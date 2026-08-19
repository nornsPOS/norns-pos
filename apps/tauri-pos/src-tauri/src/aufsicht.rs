//! ════════════════════════════════════════════════════════════════════════
//!  DIE AUFSICHT, der Motor darf nicht sterben, ohne dass es jemand merkt
//! ════════════════════════════════════════════════════════════════════════
//!
//! Basels Auftrag vom 12.08.2026: „إذا توقف الخادم الداخلي (Fastify) لأي سبب،
//! يقوم Rust باكتشاف ذلك وإعادة تشغيله بصمت دون أن يشعر الكاشير."
//!
//! ── DER BEFUND, DER DAS NÖTIG MACHT (gemessen am 12.08.2026) ────────────
//!
//! `motor.rs` beaufsichtigt den Motor NUR während des Hochfahrens: es liest
//! die Bereitschaftszeile, und wenn der Motor dabei auflegt, kommt sein
//! eigener Abbruchsatz zurück. Danach ist Schluss. Der Faden, der übrig
//! bleibt, tut wörtlich nur noch das:
//!
//! ```text
//! while empfaenger.recv().is_ok() {}
//! ```
//!
//! ⚠️ Das `text` an diesem Block ist kein Schmuck: rustdoc liest einen
//! EINGERÜCKTEN Block in einem Doc-Kommentar als Rust-Code und übersetzt ihn.
//! Diese Zeile ist aber ein ZITAT aus einer anderen Datei, ohne den Umgebungs-
//! kontext, in dem `empfaenger` existiert. Eingerückt geschrieben war sie am
//! 13.08.2026 der einzige Doktest des ganzen Kistchens, und er war dauerhaft
//! rot („cannot find value `empfaenger` in this scope"). Sichtbar wurde das
//! nur auf Windows, weil nur dort `cargo test` läuft; die Linux-Strecke fährt
//! `cargo check` und sieht Doktests nie.
//!
//! Er LEERT den Kanal, damit der Motor nicht blockiert, er URTEILT nicht.
//! Stirbt der Motor um 14 Uhr mitten im Geschäft, merkt es niemand: die
//! Kasse zeigt Fehler, und der Kassierer steht mit Kundschaft davor.
//!
//! ── ⚠️ WARUM DIESE DATEI SO VORSICHTIG IST ──────────────────────────────
//!
//! Eine Aufsicht, die zu schnell zuschlägt, ist schlimmer als keine. Sie
//! würde einen Motor abschiessen, der nur gerade beschäftigt ist, mitten in
//! einem Verkauf. Deshalb zwei getrennte Signale mit sehr verschiedenem
//! Gewicht:
//!
//!   1. GESTORBEN (`try_wait` liefert einen Beendigungsstand). Das ist keine
//!      Vermutung, das ist eine Tatsache des Betriebssystems: der Prozess ist
//!      weg. Hier wird neu gestartet.
//!   2. ANTWORTET NICHT (die Bereitschaftsfrage läuft ins Leere). Das kann
//!      auch ein langer Auszug sein. Hier wird NICHT abgeschossen, sondern
//!      der Zustand ehrlich gemeldet, damit die Fläche es zeigen kann.
//!
//! Ein toter Prozess kann keinen Verkauf mehr verderben, ein lebender schon.
//!
//! ── UND WARUM DAS FISKALISCH SICHER IST ─────────────────────────────────
//!
//! Ein Neustart mitten in einer Buchung zerreisst keinen Beleg: die
//! Schreibwege laufen in Datenbank-Transaktionen, und eine abgerissene
//! Verbindung rollt zurück. Es entsteht also KEIN halber Beleg, sondern gar
//! keiner, und der Vorgang liegt im Ausgangskorb der Kasse und wird
//! nachgereicht. Genau dafür ist der Korb gebaut.

use std::time::{Duration, Instant};

/// Was die Aufsicht nach einem Blick auf den Motor tut.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Entscheidung {
    /// Alles in Ordnung, nichts tun.
    Weiterschauen,
    /// Der Prozess ist nachweislich weg. Neu starten.
    NeuStarten,
    /// Zu oft zu schnell gescheitert. Nicht weiter versuchen, sondern es
    /// dem Menschen sagen, ein Motor, der nach mehreren Anläufen nicht
    /// bleibt, hat einen Grund, den ein weiterer Anlauf nicht behebt.
    Aufgeben,
}

/// Wie oft hintereinander neu gestartet werden darf, bevor die Aufsicht es
/// aufgibt und den Menschen holt.
///
/// Drei, weil zwei zu knapp ist (ein einzelner Ausrutscher plus ein
/// unglücklicher zweiter kommt vor) und fünf einen kaputten Datenort fünfmal
/// hochfahren liesse, bevor jemand etwas erfährt.
pub const HOECHSTENS_VERSUCHE: u32 = 3;

/// Wie lange ein Motor durchhalten muss, damit sein Start als GELUNGEN gilt
/// und der Zähler zurückgeht.
///
/// Gemessen (Sitzung A): kalt braucht der Motor 2,4 s bis zur Bereitschaft.
/// Wer danach zwei Minuten läuft, ist nicht in einer Startschleife, sondern
/// hatte einen einmaligen Unfall.
pub const ALS_GELUNGEN_NACH: Duration = Duration::from_secs(120);

/// Der Gedächtnisstand der Aufsicht. Rein, damit die Regel prüfbar ist,
/// ohne einen Prozess zu starten.
#[derive(Debug, Clone)]
pub struct Lage {
    /// Neustarts seit dem letzten dauerhaft gelungenen Start.
    pub versuche: u32,
    /// Wann der Motor zuletzt bereit gemeldet wurde.
    pub seit_start: Duration,
}

/// Die Regel, in einer Funktion.
///
/// `lebt` ist die TATSACHE aus `try_wait`, keine Vermutung: `true` heisst,
/// das Betriebssystem führt den Prozess noch.
pub fn entscheide(lebt: bool, lage: &Lage) -> Entscheidung {
    if lebt {
        return Entscheidung::Weiterschauen;
    }
    // Hat der Motor lange genug durchgehalten, zählt der Unfall als
    // einmalig, der Zähler wird beim Neustart ohnehin zurückgesetzt.
    if lage.seit_start >= ALS_GELUNGEN_NACH {
        return Entscheidung::NeuStarten;
    }
    if lage.versuche >= HOECHSTENS_VERSUCHE {
        return Entscheidung::Aufgeben;
    }
    Entscheidung::NeuStarten
}

/// Nach einem Neustart: der Zähler steigt, die Uhr beginnt neu. Hat der
/// vorige Lauf lange genug gehalten, beginnt der Zähler wieder bei eins.
pub fn nach_neustart(lage: &Lage) -> Lage {
    let versuche = if lage.seit_start >= ALS_GELUNGEN_NACH {
        1
    } else {
        lage.versuche + 1
    };
    Lage {
        versuche,
        seit_start: Duration::ZERO,
    }
}

/// Der Takt, in dem die Aufsicht hinsieht.
///
/// Basel hat fünf Sekunden genannt, und das passt: ein Blick auf
/// `try_wait` kostet praktisch nichts (kein Netz, kein Prozessstart), und
/// fünf Sekunden sind kürzer, als ein Kassierer braucht, um einen Fehler zu
/// lesen und noch einmal zu drücken.
pub const TAKT: Duration = Duration::from_secs(5);

/// Der Satz, den der Händler liest, wenn die Aufsicht aufgibt.
///
/// ⚠️ `bisher` ist der Grund, den der Motor bei seinem letzten Anlauf SELBST
/// genannt hat („Port belegt", „Datenort nicht beschreibbar"). Er ist immer
/// genauer als alles, was hier allgemein stehen kann, und wird deshalb
/// behalten statt überschrieben. Diese Funktion existiert getrennt, weil das
/// Überschreiben genau der Fehler ist, den man beim Schreiben nicht bemerkt
/// und beim Suchen dann vermisst.
pub fn aufgabe_satz(bisher: Option<&str>) -> String {
    const SATZ: &str = "Der Motor der Kasse bleibt nicht oben. Er wurde mehrfach neu \
                        gestartet und ist jedes Mal wieder ausgefallen. Bitte die Kasse \
                        neu starten; bleibt es dabei, ist Hilfe nötig.";
    match bisher.map(str::trim).filter(|s| !s.is_empty()) {
        Some(grund) => format!("{SATZ}\n\nZuletzt gemeldet: {grund}"),
        None => SATZ.to_string(),
    }
}

/// Die Aufsicht als Ganzes: Gedächtnis, Uhr und Regel in einem Stück.
///
/// Sie liegt hier und nicht in `lib.rs`, damit die ganze Leiter prüfbar ist.
/// In `lib.rs` bliebe genau das, was man nicht testen kann (Schlösser, ein
/// Tauri-Griff, ein echter Prozessstart), und mitten darin die Regel, die
/// man testen MÜSSTE. Getrennt ist beides ehrlich: die Regel wird gemessen,
/// der Griff bleibt dünn genug, um ihn zu lesen.
pub struct Aufsicht {
    lage: Lage,
    seit: Instant,
}

impl Default for Aufsicht {
    fn default() -> Self {
        Self::neu()
    }
}

impl Aufsicht {
    pub fn neu() -> Self {
        Self {
            lage: Lage {
                versuche: 0,
                seit_start: Duration::ZERO,
            },
            seit: Instant::now(),
        }
    }

    /// Ein Takt mit der echten Uhr. `lebt` ist die Tatsache aus `try_wait`.
    pub fn takt(&mut self, lebt: bool) -> Entscheidung {
        let vergangen = self.seit.elapsed();
        let entscheidung = self.takt_mit(lebt, vergangen);
        if entscheidung == Entscheidung::NeuStarten {
            self.seit = Instant::now();
        }
        entscheidung
    }

    /// Derselbe Takt mit gestellter Uhr. Nur so lassen sich acht Stunden
    /// Ladenbetrieb in Millisekunden nachfahren.
    pub fn takt_mit(&mut self, lebt: bool, seit_start: Duration) -> Entscheidung {
        self.lage.seit_start = seit_start;
        let entscheidung = entscheide(lebt, &self.lage);
        if entscheidung == Entscheidung::NeuStarten {
            self.lage = nach_neustart(&self.lage);
        }
        entscheidung
    }

    /// Nur für Prüfungen und Meldungen: wie viele Anläufe stehen zu Buche.
    pub fn versuche(&self) -> u32 {
        self.lage.versuche
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lage(versuche: u32, sekunden: u64) -> Lage {
        Lage {
            versuche,
            seit_start: Duration::from_secs(sekunden),
        }
    }

    #[test]
    fn ein_lebender_motor_wird_in_ruhe_gelassen() {
        // Der wichtigste Satz der Datei: die Aufsicht fasst nichts an, was
        // läuft. Ein abgeschossener Motor mitten im Verkauf wäre teurer als
        // gar keine Aufsicht.
        for versuche in 0..=10 {
            for sekunden in [0u64, 1, 60, 3600] {
                assert_eq!(
                    entscheide(true, &lage(versuche, sekunden)),
                    Entscheidung::Weiterschauen,
                    "ein lebender Motor wurde angefasst"
                );
            }
        }
    }

    #[test]
    fn ein_toter_motor_wird_neu_gestartet() {
        assert_eq!(entscheide(false, &lage(0, 30)), Entscheidung::NeuStarten);
        assert_eq!(entscheide(false, &lage(1, 30)), Entscheidung::NeuStarten);
        assert_eq!(entscheide(false, &lage(2, 30)), Entscheidung::NeuStarten);
    }

    #[test]
    fn nach_drei_schnellen_fehlschlaegen_gibt_die_aufsicht_auf() {
        // Ein Motor, der dreimal kurz nach dem Start wieder stirbt, hat einen
        // Grund (kaputter Datenort, belegter Port). Ein vierter Anlauf behebt
        // ihn nicht, dann muss es ein Mensch erfahren.
        assert_eq!(entscheide(false, &lage(3, 10)), Entscheidung::Aufgeben);
        assert_eq!(entscheide(false, &lage(9, 10)), Entscheidung::Aufgeben);
    }

    #[test]
    fn ein_motor_der_lange_lief_bekommt_immer_einen_neuen_anlauf() {
        // ⚠️ Der Fall, der eine dumme Aufsicht am Abend stilllegen würde:
        // die Kasse läuft acht Stunden, dann fällt der Motor einmal. Wäre der
        // Zähler von einem Vormittags-Unfall noch voll, bliebe der Laden zu.
        assert_eq!(
            entscheide(false, &lage(HOECHSTENS_VERSUCHE, 8 * 3600)),
            Entscheidung::NeuStarten
        );
        assert_eq!(entscheide(false, &lage(99, 121)), Entscheidung::NeuStarten);
    }

    #[test]
    fn ein_langer_lauf_setzt_den_zaehler_zurueck() {
        let nach = nach_neustart(&lage(3, 8 * 3600));
        assert_eq!(nach.versuche, 1, "der Zähler haelt den Laden sonst zu");
        assert_eq!(nach.seit_start, Duration::ZERO);

        // Ein KURZER Lauf zählt dagegen weiter hoch.
        let nach_kurz = nach_neustart(&lage(1, 5));
        assert_eq!(nach_kurz.versuche, 2);
    }

    /// ⚠️ Der Wächter gegen „gebaut und nie angeschlossen".
    ///
    /// Alle Tests darüber prüfen die REGEL. Keiner von ihnen würde rot, wenn
    /// jemand die Aufsichtsschleife aus `lib.rs` entfernte, dann läge hier
    /// eine tadellos geprüfte Datei, die im laufenden Programm niemand ruft,
    /// und die Kasse stünde wieder ohne Aufsicht da.
    ///
    /// Er misst den GEBRAUCH, nicht die Erwähnung: Kommentarzeilen werden
    /// vorher entfernt, sonst hielte ihn schon dieser Absatz hier grün.
    ///
    /// Was er NICHT kann: beweisen, dass die Schleife zur Laufzeit auch
    /// dreht. Das messen die Prozesstests in `motor.rs` an ihrem Teil
    /// (`lebt()` gegen einen echten Prozess) und die Leitertests hier an
    /// ihrem. Dieser Wächter schliesst nur die Lücke dazwischen.
    #[test]
    fn die_aufsicht_ist_im_rumpf_wirklich_angeschlossen() {
        let rumpf = include_str!("lib.rs");
        let ohne_kommentare: String = rumpf
            .lines()
            .filter(|z| {
                let t = z.trim_start();
                !t.starts_with("//")
            })
            .collect::<Vec<_>>()
            .join("\n");

        for (was, muster) in [
            ("die Aufsicht wird angelegt", "aufsicht::Aufsicht::neu()"),
            ("sie wird getaktet", ".takt("),
            ("sie fragt den Motor, ob er lebt", ".lebt()"),
            ("sie startet wirklich neu", "starte_motor("),
            ("sie sagt es dem Händler", "aufsicht::aufgabe_satz("),
            ("sie schläft im vereinbarten Takt", "aufsicht::TAKT"),
        ] {
            assert!(
                ohne_kommentare.contains(muster),
                "{was}: `{muster}` steht in keiner Codezeile von lib.rs. \
                 Die Aufsicht ist gebaut, aber nicht angeschlossen, der Motor \
                 könnte mitten im Geschäft sterben, ohne dass es jemand merkt."
            );
        }
    }

    // ── Die Leiter als Ganzes, so wie `lib.rs` sie fährt ────────────────

    /// Ein ganzer Ladentag in Millisekunden: der Motor läuft, fällt einmal
    /// nach acht Stunden, kommt zurück, läuft weiter. Genau EIN Neustart,
    /// und die Aufsicht bleibt danach in Bereitschaft.
    #[test]
    fn ein_ladentag_mit_einem_einzigen_ausfall() {
        let mut w = Aufsicht::neu();
        let mut neustarts = 0;

        for stunde in 0..8 {
            let e = w.takt_mit(true, Duration::from_secs(stunde * 3600));
            assert_eq!(e, Entscheidung::Weiterschauen);
        }
        // Der Ausfall.
        assert_eq!(
            w.takt_mit(false, Duration::from_secs(8 * 3600)),
            Entscheidung::NeuStarten
        );
        neustarts += 1;
        // Und weiter geht der Tag.
        for minute in 0..10 {
            assert_eq!(
                w.takt_mit(true, Duration::from_secs(minute * 60)),
                Entscheidung::Weiterschauen
            );
        }
        assert_eq!(neustarts, 1);
        assert_eq!(
            w.versuche(),
            1,
            "ein Ausfall am Abend darf nicht als Serie zählen"
        );
    }

    /// ⚠️ Der Fall, an dem die erste Fassung dieser Aufsicht scheiterte:
    /// ein Neustart, der SELBST nicht hochkommt.
    ///
    /// In `lib.rs` bleibt das Motorfach dann leer. Stand dort `continue`,
    /// drehte sich die Aufsicht für den Rest des Tages im Leerlauf: die
    /// Leiter kam nie bei „Aufgeben" an, und niemand erfuhr je etwas. Hier
    /// wird nachgefahren, dass drei tote Takte hintereinander wirklich beim
    /// Menschen enden.
    #[test]
    fn ein_neustart_der_selbst_nicht_hochkommt_endet_beim_menschen() {
        let mut w = Aufsicht::neu();
        let mut neustarts = 0;
        let mut aufgegeben = false;

        // Zwanzig Takte à fünf Sekunden, der Motor kommt nie hoch.
        for takt in 0..20u64 {
            match w.takt_mit(false, TAKT * (takt as u32)) {
                Entscheidung::NeuStarten => neustarts += 1,
                Entscheidung::Aufgeben => {
                    aufgegeben = true;
                    break;
                }
                Entscheidung::Weiterschauen => unreachable!("der Motor ist tot"),
            }
        }

        assert!(
            aufgegeben,
            "die Aufsicht drehte sich im Kreis, statt Hilfe zu holen"
        );
        assert_eq!(neustarts, HOECHSTENS_VERSUCHE);
        // Und das in weniger als einer Minute, nicht erst am Abend.
        assert!(TAKT * (HOECHSTENS_VERSUCHE + 1) < Duration::from_secs(60));
    }

    /// Der Grund des Motors ist genauer als jeder allgemeine Satz und muss
    /// den Weg zum Händler überleben.
    #[test]
    fn der_grund_des_motors_ueberlebt_das_aufgeben() {
        let satz = aufgabe_satz(Some("Port 3111 ist belegt."));
        assert!(
            satz.contains("Port 3111 ist belegt."),
            "der genaue Grund ging verloren"
        );
        assert!(
            satz.contains("bleibt nicht oben"),
            "der Händler erfährt nicht, was los ist"
        );

        // Ohne Grund bleibt es beim allgemeinen Satz, ohne leeren Anhang.
        for leer in [None, Some(""), Some("   ")] {
            let s = aufgabe_satz(leer);
            assert!(!s.contains("Zuletzt gemeldet"), "leerer Anhang: {s:?}");
        }
    }

    /// Der Satz ist für den HÄNDLER, nicht für ein Protokoll.
    #[test]
    fn der_aufgabesatz_spricht_deutsch_und_nennt_den_naechsten_schritt() {
        let satz = aufgabe_satz(None);
        assert!(
            satz.contains("Kasse neu starten"),
            "kein nächster Schritt genannt"
        );
        assert!(
            !satz.contains('_'),
            "Kennungen gehören nicht in einen Händlersatz"
        );
        for englisch in ["error", "failed", "restart", "process", "exit"] {
            assert!(
                !satz.to_lowercase().contains(englisch),
                "englisches Wort im Händlersatz: {englisch}"
            );
        }
    }

    #[test]
    fn die_startschleife_endet_wirklich() {
        // Gegenprobe zur Regel oben: ein Motor, der sofort stirbt, wird
        // GENAU dreimal neu gestartet und dann nicht mehr.
        let mut l = lage(0, 0);
        let mut neustarts = 0;
        for _ in 0..20 {
            match entscheide(false, &l) {
                Entscheidung::NeuStarten => {
                    neustarts += 1;
                    l = nach_neustart(&l);
                }
                Entscheidung::Aufgeben => break,
                Entscheidung::Weiterschauen => unreachable!("der Motor ist tot"),
            }
        }
        assert_eq!(
            neustarts, HOECHSTENS_VERSUCHE,
            "die Aufsicht dreht sich im Kreis"
        );
    }
}

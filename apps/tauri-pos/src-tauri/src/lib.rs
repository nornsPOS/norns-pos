// norns-pos library entry.
//
// The Rust side owns the native bridges (printer, card terminal, TSE).
// Every command goes through `commands/*` and respects mock mode
// (env `NORNS_MOCK_HARDWARE=1`). See memory.md §18 for the
// architecture-of-record.

// `pub` so the in-repo hardware-in-the-loop integration tests (src-tauri/tests/)
// can drive the REAL command paths (commands::zvt / commands::tse) and match on
// `error::HardwareError`. Widening visibility only — no runtime behaviour change.
pub mod aufsicht;
pub mod commands;
pub mod config;
pub mod error;
// Der Server, der im Gerät wohnt (Norns POS). Siehe motor.rs.
pub mod lizenz;
pub mod motor;
pub mod sicherung;
// Die Geheimnisse des Motors, erzeugt und verwahrt im Systemtresor.
pub mod mock;
pub mod tresor;
mod verbund;

/// Geheimnisse holen, Motor starten, Ergebnis in Klartext fassen.
///
/// Ausgelagert, damit der Startvorgang oben lesbar bleibt und jeder Fehlweg
/// GENAU einen Satz für den Händler hat statt eines Codes. Die drei Wege, die
/// hier scheitern können, sind alle echt: kein Tresor, kein Motor im Paket,
/// kein Lebenszeichen.
fn starte_motor(
    griff: &tauri::AppHandle,
    datenort: std::path::PathBuf,
) -> (motor::MotorStand, Option<motor::Motor>) {
    let (geheimnisse, herkunft) = match tresor::bereitstellen(&datenort) {
        Ok(g) => g,
        Err(e) => {
            return (
                motor::MotorStand::Fehler {
                    grund: e.to_string(),
                },
                None,
            )
        }
    };
    if herkunft == tresor::Herkunft::NeuErzeugt {
        // Der Händler MUSS wissen, dass es diesen Schlüssel gibt: ohne ihn
        // sind die Kundendaten später nicht wiederherstellbar. Sitzung A hat
        // ausdrücklich darauf bestanden.
        log_erststart(&datenort);
    }
    // Der LÄUFER liegt neben der Anwendung: `bundle.externalBin` legt ihn
    // dorthin. Er ist eine umbenannte node.exe und tut ohne Skript nichts.
    let neben_mir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(std::path::Path::to_path_buf))
        .unwrap_or_default();
    let name = if cfg!(windows) {
        "norns-sidecar.exe"
    } else {
        "norns-sidecar"
    };

    // Das SKRIPT liegt bei den Ressourcen (`bundle.resources`), nicht neben
    // der Anwendung. Tauri kennt den Ort; wir raten ihn nicht.
    let skript = {
        use tauri::Manager;
        match griff.path().resolve(
            "resources/sidecar/start.mjs",
            tauri::path::BaseDirectory::Resource,
        ) {
            Ok(p) => p,
            Err(e) => {
                return (
                    motor::MotorStand::Fehler {
                        grund: format!(
                            "Der Motor der Kasse wurde nicht gefunden ({e}).                              Die Anwendung ist unvollständig installiert."
                        ),
                    },
                    None,
                )
            }
        }
    };

    // Die Gerätekennung reist als eigenes Feld mit: Sitzung A sät daraus bei
    // JEDEM Start den Inhaber und das gepaarte Gerät. Ohne sie kann der
    // Händler seinen ersten Beleg nicht schreiben — `device_id` ist notNull
    // mit Fremdschlüssel, daran führt kein Weg vorbei.
    //
    // Der Fingerabdruck des DATENORTS, bewusst nicht Plattenseriennummer und
    // nicht Netzwerkadresse: die eine ändert sich beim Tausch einer defekten
    // Platte, die andere beim Wechsel von Kabel auf Funk, und beides würde
    // eine laufende Kasse an einem Dienstagmorgen ohne Vorwarnung töten.
    // ⚠️ Das Datenbankpasswort einmal merken. Ohne diese Zeile griffe JEDE
    // Sicherung erneut in den Systemtresor — bei ad-hoc-Unterschrift ist das
    // eine Passwortfrage je Sicherung.
    if let Some((_, w)) = geheimnisse.iter().find(|(k, _)| k == "NORNS_DB_PASSWORT") {
        sicherung::db_passwort_merken(w);
    }

    let mut geheimnisse = geheimnisse;
    geheimnisse.push((
        "NORNS_GERAETE_KENNUNG".to_string(),
        lizenz::geraete_kennung(&datenort),
    ));

    // ── DIE FREIGABE REIST MIT ──────────────────────────────────────────
    //
    // Basels Auftrag: der Schlüssel soll „im Nerv der Anwendung" liegen und
    // nicht als ein `if` im Fenster, das man löscht.
    //
    // ⚠️ GEMESSEN am 13.08.2026: `darf_verkaufen()` wurde von NICHTS
    // gerufen ausser den eigenen Tests. Die Prüfung war kryptographisch
    // einwandfrei und hielt trotzdem nichts auf — eine Kasse ganz ohne
    // Schlüssel verkaufte unbegrenzt weiter.
    //
    // Die Freigabe wird deshalb HIER entschieden, in dem Programmteil, der
    // den Motor besitzt, und dem Motor als Umgebung übergeben. Wer den
    // Riegel umgehen will, muss das Rust-Programm ODER das Motorbündel
    // verändern, nicht bloss einen Schalter im Fenster umlegen. Mehr ist
    // bei einem Programm auf dem Rechner des Kunden ehrlich nicht zu haben.
    //
    // Der Wert wird beim START gelesen und gilt bis zum nächsten. Das ist
    // Absicht: eine Kasse, die einem Kassierer mitten im Verkauf den Riegel
    // vorschiebt, weil um 00:00 eine Frist ablief, wäre schlimmer als eine,
    // die es beim nächsten Öffnen sagt.
    let freigabe = lizenz::freigabe_lesen(&datenort);
    geheimnisse.push((
        "NORNS_VERKAUF_FREI".to_string(),
        freigabe.fuer_den_motor().to_string(),
    ));

    match motor::starten(neben_mir.join(name), skript, datenort, geheimnisse) {
        Ok(m) => (
            motor::MotorStand::Bereit {
                adresse: m.adresse.clone(),
            },
            Some(m),
        ),
        Err(e) => (
            motor::MotorStand::Fehler {
                grund: e.to_string(),
            },
            None,
        ),
    }
}

/// Beim allerersten Start eine Notiz neben die Daten legen.
///
/// Kein Protokoll für uns, sondern ein Zettel für den Menschen, der eines
/// Tages den Rechner tauscht und wissen muss, dass die Datenbank allein nicht
/// reicht.
fn log_erststart(datenort: &std::path::Path) {
    let text = "Norns POS wurde auf diesem Rechner zum ersten Mal gestartet.\n\
                Dabei ist ein Schlüssel für die Kundendaten entstanden. Er liegt im\n\
                Systemtresor dieses Benutzerkontos, nicht in diesem Ordner.\n\n\
                Wird der Rechner getauscht oder das Benutzerkonto neu angelegt,\n\
                muss dieser Schlüssel mitgenommen werden. Ohne ihn sind die\n\
                gespeicherten Kundendaten nicht mehr lesbar.\n";
    let _ = std::fs::write(datenort.join("WICHTIG-Schluessel.txt"), text);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ADR-0044 Phase 3 — forward-only outbox migrations, applied on startup
    // before any UI mounts. NEVER edit a shipped migration (§25a UStG bars a
    // destructive rollback on financial-record tables); add 0002+ instead.
    let outbox_migrations = vec![
        tauri_plugin_sql::Migration {
            version: 1,
            description: "create offline outbox tables",
            sql: include_str!("../migrations/0001_outbox.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        // Epic C Part 2 — local KYC document index (offline preview).
        tauri_plugin_sql::Migration {
            version: 2,
            description: "create customer_kyc table",
            sql: include_str!("../migrations/0002_kyc.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        // Phase 1.3 — durable TSE signature replay queue (STRICT). Replaces the
        // volatile localStorage queue; fiscal records, never dropped.
        tauri_plugin_sql::Migration {
            version: 3,
            description: "create TSE signature replay queue",
            sql: include_str!("../migrations/0003_tse_queue.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        // 08.08.2026 — der BON_TYP gehört mit in die Warteschlange, sonst wird
        // ein nachgereichter Storno als gewöhnlicher Beleg signiert.
        tauri_plugin_sql::Migration {
            version: 4,
            description: "TSE-Warteschlange traegt den BON_TYP",
            sql: include_str!("../migrations/0004_bon_typ_in_der_warteschlange.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
    ];

    // DSGVO boot-time sweep (Phase 3.8): purge any stale invoice/preview temp PDFs
    // — each carries a customer name + §25a data — left behind by a previous
    // session (a crash mid-print, or a preview whose external viewer held the
    // file open so it couldn't be deleted inline). Off the main thread so it never
    // delays the UI; a temp-dir scan is fast and failures are swallowed.
    std::thread::spawn(commands::pdf::sweep_stale_pdf_temp_files);

    tauri::Builder::default()
        // Das Fach, in dem der Zustand des Motors liegt. Siehe motor.rs.
        .manage(motor::MotorFach::default())
        // ── Der Motor startet hier ──────────────────────────────────────────
        //
        // Auf einem EIGENEN Faden, und das ist der ganze Punkt: kalt braucht er
        // 2,4 Sekunden (Sitzung A, gemessen). Würde hier gewartet, stünde das
        // Fenster so lange weiss da und Windows schriebe „reagiert nicht"
        // darüber. So erscheint es sofort mit der Wartefläche und fragt über
        // `motor_stand` nach, bis eine Antwort kommt.
        .setup(|app| {
            use tauri::Manager;
            let griff = app.handle().clone();

            // ⚠️ „مجرد ما تكون مشبوكة" — sobald es steckt. Der Beobachter läuft
            // ab hier und schickt ein Ereignis ins Fenster, wenn ein DRUCKER
            // an- oder abgesteckt wird. Scheitert sein Start, hält das die
            // Kasse NICHT auf: dann fehlt nur die Bequemlichkeit, und der Knopf
            // „Suchen" tut es weiterhin.
            commands::usb_geraete::beobachter_starten(griff.clone());
            // Der Datenort gehört NICHT ins Programmverzeichnis: dorthin zu
            // schreiben verbietet Windows seit Vista. `app_local_data_dir`
            // liefert unter Windows %LOCALAPPDATA%\de.norns.pos.
            let datenort = app
                .path()
                .app_local_data_dir()
                .map(|p| p.join("daten"))
                .unwrap_or_else(|_| std::path::PathBuf::from("daten"));
            std::thread::spawn(move || {
                let stand = starte_motor(&griff, datenort.clone());
                if let Some(fach) = griff.try_state::<motor::MotorFach>() {
                    if let (motor::MotorStand::Bereit { .. }, Ok(mut f)) =
                        (&stand.0, fach.motor.lock())
                    {
                        *f = stand.1;
                    }
                    if let Ok(mut s) = fach.stand.lock() {
                        *s = stand.0;
                    }
                }

                // ── DIE AUFSICHT ─────────────────────────────────────────
                //
                // Basels Auftrag vom 12.08.2026. Bis heute endete dieser
                // Faden HIER: der Motor wurde einmal gestartet, der Zustand
                // gesetzt, fertig. Starb der Motor um 14 Uhr mitten im
                // Geschäft, merkte es niemand — die Kasse zeigte Fehler, und
                // der Kassierer stand mit Kundschaft davor.
                //
                // Die Regel steht in `aufsicht.rs` und ist dort geprüft; hier
                // steht nur der Blick und die Hand. Siehe dort, warum
                // ausschliesslich auf einen NACHWEISLICH toten Prozess hin
                // neu gestartet wird und nie auf eine langsame Antwort.
                let mut wache = aufsicht::Aufsicht::neu();
                loop {
                    std::thread::sleep(aufsicht::TAKT);
                    let Some(fach) = griff.try_state::<motor::MotorFach>() else {
                        break;
                    };

                    // ⚠️ Es gibt genau ZWEI Arten, tot zu sein, und beide
                    // gehören auf dieselbe Leiter:
                    //   • ein Motor lief und ist gestorben → `lebt()` ist falsch;
                    //   • ein Motor kam nie hoch → im Fach liegt gar keiner.
                    // Der zweite Fall stand hier zuerst auf `continue`. Dann
                    // hätte ein Neustart, der SELBST nicht hochkommt, die
                    // Aufsicht für den Rest des Tages stillgelegt: das Fach
                    // bliebe leer, die Leiter käme nie bei „Aufgeben" an, und
                    // niemand erführe je etwas. Ein gewolltes Anhalten sieht
                    // anders aus — `anhalten()` nimmt nur das Kind heraus und
                    // lässt den Motor im Fach, deshalb ist ein LEERES Fach
                    // immer ein misslungener Start und nie ein Feierabend.
                    let lebt = match fach.motor.lock() {
                        Ok(f) => match f.as_ref() {
                            Some(m) => m.lebt(),
                            None => false,
                        },
                        // Verklemmtes Schloss: nichts anfassen.
                        Err(_) => true,
                    };

                    match wache.takt(lebt) {
                        aufsicht::Entscheidung::Weiterschauen => {}
                        aufsicht::Entscheidung::NeuStarten => {
                            let neu = starte_motor(&griff, datenort.clone());
                            if let Ok(mut f) = fach.motor.lock() {
                                *f = neu.1;
                            }
                            if let Ok(mut s) = fach.stand.lock() {
                                *s = neu.0;
                            }
                        }
                        aufsicht::Entscheidung::Aufgeben => {
                            // Ehrlich stehen bleiben, statt weiter im Kreis zu
                            // starten. Ein Motor, der mehrfach kurz nach dem
                            // Start wieder stirbt, hat einen Grund, den ein
                            // weiterer Anlauf nicht behebt. Den Satz dafür
                            // formuliert `aufsicht::aufgabe_satz`, weil er dort
                            // geprüft ist — samt der Regel, dass der genauere
                            // Grund des Motors erhalten bleibt.
                            if let Ok(mut s) = fach.stand.lock() {
                                let bisher = match &*s {
                                    motor::MotorStand::Fehler { grund } => Some(grund.clone()),
                                    _ => None,
                                };
                                *s = motor::MotorStand::Fehler {
                                    grund: aufsicht::aufgabe_satz(bisher.as_deref()),
                                };
                            }
                            break;
                        }
                    }
                }
            });
            Ok(())
        })
        // Plugins — order doesn't matter, registration is idempotent.
        // V1 only needs `shell` (for the PDF preview opener); store +
        // dialog land in V1.1 if the operator asks for a save dialog.
        .plugin(tauri_plugin_shell::init())
        // ADR-0044 — local SQLite outbox. Path is relative to the app data
        // dir; the JS TauriSqlOutboxStore loads the same `sqlite:warehouse14.db`.
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:warehouse14.db", outbox_migrations)
                .build(),
        )
        // Auto-update plugin reads tauri.conf.json plugins.updater.*
        // (endpoint URL + minisign public key). The frontend calls
        // `check()` + `download_and_install()` via @tauri-apps/plugin-updater.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Process plugin exposes `exit()` and `relaunch()` to the
        // frontend — the updater calls relaunch() after install lands.
        .plugin(tauri_plugin_process::init())
        // Every hardware command registers here. The macro stitches them
        // into the invoke handler; if a command moves or is renamed, this
        // is the single point that needs to change.
        .invoke_handler(tauri::generate_handler![
            // Norns POS — der Motor im Gerät
            motor::motor_stand,
            lizenz::lizenz_stand,
            lizenz::lizenz_freigabe,
            lizenz::lizenz_einloesen,
            sicherung::sicherung_jetzt,
            // Mandate 1 — image compression
            commands::image::compress_to_webp,
            // Mandate 2-A — TSE (Fiskaly Cloud)
            commands::tse::tse_start_transaction,
            commands::tse::tse_finish_transaction,
            commands::tse::tse_status,
            // TSE credentials — OS-keychain backed (never in localStorage)
            commands::tse::tse_store_credentials,
            commands::tse::tse_credentials_present,
            commands::tse::tse_clear_credentials,
            // Mandate 2-B — ZVT card terminal
            commands::zvt::zvt_check_connection,
            commands::zvt::zvt_authorize_payment,
            commands::zvt::zvt_reverse_payment,
            // Mandate 3-A — ESC/POS thermal
            commands::thermal::print_thermal_receipt,
            commands::thermal::thermal_check_connection,
            commands::thermal::detect_receipt_printer,
            // Dekret 26.07.2026 — die Belegdesigner-Vorschau aus den ECHTEN
            // ESC/POS-Bytes: derselbe Strom wie beim Druck, ohne zu drucken.
            commands::thermal::preview_thermal_receipt,
            commands::drucker_erkennung::detect_printers,
            commands::drucker_erkennung::create_raw_queue,
            // Der Blick auf den BUS statt auf das Drucksystem: sieht ein Gerät,
            // BEVOR es eine Warteschlange hat, und ohne jede Rechtefrage.
            commands::usb_geraete::usb_drucker_auflisten,
            // Epic B — product sticker labels (ZPL / ESC-POS)
            commands::label::print_label,
            commands::label::label_check_connection,
            // Mandate 3-B — A4 PDF
            commands::pdf::generate_invoice_pdf,
            commands::verfahrensdoku_pdf::generate_verfahrensdoku_pdf,
            commands::steuerberater_fragen_pdf::generate_steuerberater_fragen_pdf,
            commands::pdf::print_a4,
            commands::pdf::print_invoice_a4,
            commands::pdf::open_pdf_preview,
            commands::pdf::sweep_temp_pdfs,
            // Mandate 4 — system probe
            commands::system::list_system_printers,
            commands::system::wirt_steckbrief,
            // Vierzehn recovery — open the OS microphone privacy pane
            commands::system::open_microphone_settings,
            // Google sign-in — open the consent page in the OS browser
            commands::system::open_url,
            // Google sign-in — in-app account-picker window (no external browser)
            commands::system::start_google_login,
            commands::system::fiskal_umgebung_lesen,
            // Epic C — encrypted local KYC vault
            commands::kyc::encrypt_and_save_kyc_document,
            commands::kyc::decrypt_and_load_kyc_document,
            commands::kyc::delete_kyc_document,
            // USB digital scale (MT-SICS over serial)
            commands::scale::read_scale_weight,
            commands::scale::tare_scale,
            commands::scale::list_scale_ports,
        ])
        .build(tauri::generate_context!())
        .expect("error while running norns-pos")
        // Beim Beenden den Motor mitnehmen. Ein verwaister Server hielte sonst
        // die Datenbank, und der NÄCHSTE Start fände sie belegt, ohne dass
        // irgendwo sichtbar wäre warum. Siehe motor.rs, Vertragspunkt 1.
        .run(|griff, ereignis| {
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = ereignis {
                use tauri::Manager;
                if let Some(fach) = griff.try_state::<motor::MotorFach>() {
                    if let Ok(mut m) = fach.motor.lock() {
                        if let Some(motor) = m.take() {
                            motor.anhalten();
                        }
                    }
                }
            }
        });
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  NORNS POS, DER SIDECAR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Dienst, den der Tauri-Rumpf als Kindprozess startet. Er tut vier Dinge
 * und sonst nichts:
 *
 *   1. das eingebettete Postgres hochfahren (beim ersten Mal anlegen)
 *   2. beim ersten Mal Schema, Referenzsaat und Nachzügler einspielen
 *   3. `apps/api-cloud` booten, UNVERÄNDERT, auf 127.0.0.1
 *   4. EINE Zeile auf stdout melden: NORNS_BEREIT {"port":…}
 *
 * ── WARUM ER EXISTIERT ─────────────────────────────────────────────────────
 *
 * Damit `apps/api-cloud` nicht angefasst werden muss. Basel hat es wörtlich
 * verlangt: kopieren, nicht umbauen. Jede dort geänderte Zeile liefe zwischen
 * Warehouse14 und Norns POS auseinander, und in einem Jahr wüsste niemand
 * mehr, warum.
 *
 * ── DIE LEHREN DES ERSTEN TAGES, hier eingebaut ────────────────────────────
 *
 * Jede dieser Regeln hat am 30.07.2026 einen echten Fehlschlag gekostet:
 *
 *   • PORT 0 GEHT NICHT: `config/env.ts` verlangt minimum 1. Der Dienst
 *     erfragt den freien Port selbst und reicht eine echte Zahl weiter.
 *   • POSTGRES SCHREIBT AUF STDOUT: initdb erzählt vierzig Zeilen auf genau
 *     dem Kanal, auf dem der Rumpf das JSON erwartet. stdout wird während
 *     des Hochfahrens umgeleitet und nur für die eine Meldung freigegeben.
 *   • DER SERVER HÖRTE AUF 0.0.0.0: richtig im Container, falsch im Laden.
 *     Hier bootet `buildApp({ env: loadEnv() })` und bindet auf 127.0.0.1;
 *     `server.ts` bleibt unberührt.
 *   • EIN SCHEMA-AUSZUG TRÄGT KEINE DATEN: Steuerarten, Feingehalte, Punzen
 *     sät auf der Produktion eine Wanderung. Hier: erststart/referenz.sql.
 *   • DIE LEDGER-KETTE BRAUCHT IHRE GENESIS (Wanderung 0048), sonst stirbt
 *     jeder Verkauf am prev_hash. Und NICHT den Kopf der Produktion nehmen —
 *     das wäre die Mitte einer fremden Kette.
 *   • DER AUSZUG TRÄGT DEN STAND DER PRODUKTION, und der fehlt 0125. Nach
 *     dem Auszug laufen die NACHZÜGLER, jünger als der Auszug, wiederholbar.
 *   • pg_dump SETZT search_path = '': nach dem Einspielen einmal
 *     zurücksetzen, sonst ist jede Funktion „nicht vorhanden".
 *   • KEIN psql, KEIN pg_dump im Paket: nur initdb, pg_ctl, postgres. Die
 *     Sicherung kann dieser Dienst deshalb SELBST: `--sicherung <zielordner>`
 *     schreibt einen konsistenten Datenauszug (eine REPEATABLE-READ-Sitzung,
 *     ein Schnappschuss) samt Fotos und KYC-Bildern. Läuft die Kasse, wird
 *     ihre Instanz benutzt (Portdatei im Datenort); steht sie, startet der
 *     Modus Postgres kurz selbst und stoppt es wieder.
 */
import { createServer, Socket } from 'node:net';
import { createRequire } from 'node:module';
import { appendFileSync, createWriteStream, cpSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
// ── DIE FASSUNG DER KASSE, AUS DER EINZIGEN WAHREN QUELLE ──────────────────
//
// ⚠️ 04.08.2026 gemessen: die amtliche `cashregister.csv` meldete dem
// Finanzamt in `KASSE_SW_VERSION` die Fassung `1.0.0`. Die Kasse ist `0.0.2`.
// Der Wert kam aus `process.env.APP_VERSION ?? '1.0.0'` in
// `routes/closing-export.ts`, und `APP_VERSION` wird im ganzen Baum nirgends
// gesetzt — der Ersatzwert griff also IMMER.
//
// Diese Einbindung ist bewusst ein `import` und kein `readFileSync`:
//
//   • Sie ist die Quelle, die `scripts/set-version.mjs` zur einzigen wahren
//     erklärt, und dieselbe, aus der der Installer seine Fassung nimmt.
//   • esbuild BÄCKT sie beim Bündeln in `start.mjs` hinein (gemessen: aus
//     `import c from './conf.json' with { type: 'json' }` wird
//     `var conf_default = { version: "0.0.2", … }`). Ein `readFileSync` ginge
//     im ausgelieferten Paket ins Leere: dort liegt neben `start.mjs` nur
//     `erststart/` und `node_modules/`, keine `tauri.conf.json`.
//   • Damit stimmt die gemeldete Fassung bei JEDEM Bau von selbst, ohne
//     zweite Stelle, die jemand nachziehen müsste.
//
// Der Motor selbst erfindet nichts: kennt er die Fassung nicht, bleibt die
// Umgebungsgrösse ungesetzt und das amtliche Feld LEER.
import tauriKonfiguration from '../../tauri-pos/src-tauri/tauri.conf.json' with { type: 'json' };

const HIER = dirname(fileURLToPath(import.meta.url));
// embedded-postgres und pg wohnen im EIGENEN node_modules dieses Ordners —
// so bleibt die Sperrdatei des Arbeitsbaums unberührt (Vertrag mit Sitzung B).
const eigenes = createRequire(join(HIER, 'package.json'));
const EmbeddedPostgres = eigenes('embedded-postgres').default ?? eigenes('embedded-postgres');
const pg = eigenes('pg');

const DATENORT = process.env['NORNS_DATENORT'] || join(HIER, 'norns-daten');
const PGORT = join(DATENORT, 'pg');
const DB = 'norns_pos';
const APPROLLE = 'warehouse14_app';
/** Wanderungen, die JÜNGER sind als der Schema-Auszug. In Reihenfolge. */
const NACHZUEGLER = [
  '0125_ein_tag_in_einer_langen_schicht_ist_abschliessbar.sql',
  '0128_das_siegel_haelt_auch_kuenftige_spalten.sql',
  '0129_der_kurs_traegt_seine_herkunft.sql',
  '0130_die_woche_darf_ersetzt_werden.sql',
  '0131_die_tse_darf_ein_geraet_sein.sql',
  '0132_der_preis_darf_dem_kurs_folgen.sql',
  '0133_eine_ausgabe_weiss_womit_sie_bezahlt_wurde.sql',
  // Befund 10 (11.08.2026): entzieht der App-Rolle das nie genutzte UPDATE
  // auf transactions.receipt_locator (§ 146 Abs. 4 AO). Muss auch auf
  // BESTEHENDE Kassen, denn deren Datenbanken tragen das Recht aus 0009.
  '0135_die_belegnummer_verliert_ihr_stilles_schreibrecht.sql',
  // Befund vom 11.08.2026 (P0): Wanderung 0044 säte Firma und Anschrift eines
  // FREMDEN Betriebs in den Belegkopf, und der Rückfall in
  // beleg-identitaet.ts greift nur bei LEEREM Feld — der Bon trug den Namen
  // des anderen Unternehmens auch nach vollständig ausgefülltem Assistenten.
  // Diese Kassen bekommen ihre Saat aus erststart/referenz.sql, wo die vier
  // Felder LEER stehen: hier ist die Wanderung deshalb ein Nichttun. Sie
  // reist trotzdem mit, damit ein Stand, der einmal aus den Wanderungen
  // aufgebaut wurde, sie ebenfalls erreicht.
  '0140_der_belegkopf_traegt_keinen_fremden_betrieb.sql',
  // Befund vom 13.08.2026: `tse_signatures` hatte keinen Ort für die
  // Seriennummer und den öffentlichen Schlüssel der Sicherungseinrichtung.
  // Deshalb blieben `TSE_SERIAL` und `TSE_PUBLIC_KEY` in JEDEM gezogenen
  // DSFinV-K-Paket leer, und ein Prüfer konnte keine Signatur nachrechnen.
  // Muss auch auf jede FRISCHE Kasse: ohne diese Zeile hier bekäme genau die
  // sie nie, und der Defekt wäre für neue Händler unrepariert.
  '0141_die_signatur_wird_nachrechenbar.sql',
  // Basels Anweisung vom 13.08.2026: zehn Belege, bevor die TSE steht, dann
  // ist Schluss. Die laufende Nummer steht AN DER ZEILE, damit der Vorrat
  // eine Messung über Zeilen ist und kein zurücksetzbarer Zähler.
  // ⚠️ Ohne diesen Eintrag bekäme genau die FRISCHE Kasse die Spalte nie —
  // also der Händler, der gerade auspackt und für den der Vorrat gebaut ist.
  // Der Wächter `nachzuegler-liegen-im-buendel` hat das gefangen.
  '0142_die_belege_vor_der_sicherungseinrichtung.sql',
  // 19.08.2026: Seriennummer und Gravur am Stueck (GwG-Zuordnung). Der
  // Schema-Auszug einer frischen Kasse kennt die Spalten erst nach dem
  // naechsten Auszug; bis dahin traegt der Nachzuegler sie ueberall hin.
  '0143_das_stueck_traegt_seine_nummer_und_seine_gravur.sql',
  // 19.08.2026: haelt Betriebsausgaben aus festgeschriebenen Tagen heraus.
  // Muss auch auf BESTEHENDE Kassen, deren Datenbanken den Waechter nicht
  // kennen — sonst aendern sich dort weiter Berichte rueckwirkend.
  '0144_ausgaben_eines_abgeschlossenen_tages_stehen_fest.sql',
  '0145_zwei_abfragen_finden_ihren_index.sql',
  '0146_der_name_wird_suchbar_ohne_lesbar_zu_werden.sql',
  '0147_der_vorgang_kennt_seinen_beginn.sql',
  '0148_die_rueckgabe_ist_ein_eigener_beleg.sql',
  // 19.08.2026, Basels Anweisung: das Kanalerbe des Webshops zieht aus —
  // neun Tabellen, eine Spalte, und die Loeschung kennt sie nicht mehr.
  // Muss auch auf BESTEHENDE Kassen, deren Grundriss sie noch traegt.
  '0149_das_kanalerbe_des_webshops_zieht_aus.sql',
  // 20.08.2026: die Steuerausfuhr laeuft ab Werk — Berater- und
  // Mandantennummer bekommen ihren Platzhalter, sauber als UNBESTAETIGT
  // ausgewiesen. Muss auch auf BESTEHENDE Kassen, deren Felder leer sind.
  '0150_die_steuerausfuhr_laeuft_ab_werk.sql',
  // 21.08.2026: der Notfallschluessel bekommt seinen Platz. MUSS auf
  // BESTEHENDE Kassen — genau der Haendler, der seinen Kassencode schon
  // gesetzt hat und ihn vergessen kann, ist der, fuer den der Weg zurueck
  // gebaut wird. Eine frische Kasse bekaeme ihn aus dem Grundriss, eine
  // laufende nur hier.
  '0151_der_notfallschluessel_bekommt_seinen_platz.sql',
  // 21.08.2026: der Rettungsstick (USB) — Basels Auftrag fuer den Haendler,
  // der lieber ein Ding als einen Zettel verwahrt. MUSS auf BESTEHENDE
  // Kassen: genau dort ist der Kassencode schon gesetzt und vergessbar.
  '0152_der_rettungsstick_bekommt_seinen_platz.sql',
];

const melde = (s) => process.stderr.write(`[norns-sidecar] ${s}\n`);

// stdout gehört dem Rumpf. Alles andere wandert nach stderr, bis die eine
// Meldung fällig ist.
const echtesStdout = process.stdout.write.bind(process.stdout);
process.stdout.write = (stueck, ...rest) => process.stderr.write(stueck, ...rest);
const meldeBereit = (zeile) => { process.stdout.write = echtesStdout; echtesStdout(zeile); };

function freierPort() {
  return new Promise((auf, ab) => {
    const s = createServer();
    s.on('error', ab);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => auf(port));
    });
  });
}

/**
 * Hört auf diesem Port jemand zu? Ein Klopfen, keine Anmeldung.
 *
 * ⚠️ Mit Zeitgrenze. Ein schweigender Zuhörer (Netzfilter, halb toter
 * Prozess) liesse `connect` sonst hängen, und der Knopf in der Kasse käme
 * nie zurück — der Mensch sähe eine Sicherung, die ewig läuft.
 */
function hoertJemandZu(port, msFrist = 800) {
  return new Promise((auf) => {
    const s = new Socket();
    let fertig = false;
    const ende = (antwort) => {
      if (fertig) return;
      fertig = true;
      s.destroy();
      auf(antwort);
    };
    s.setTimeout(msFrist, () => ende(false));
    s.once('error', () => ende(false));
    s.connect(port, '127.0.0.1', () => ende(true));
  });
}

/**
 * Die `postmaster.pid`, gelesen statt geraten.
 *
 * Zeile 1 ist die Prozesskennung, Zeile 2 das Datenverzeichnis, Zeile 4 der
 * Port. Fehlt die Datei oder ist sie unvollständig, kommt `null` zurück —
 * NICHT ein halb gefülltes Objekt, das später wie eine Antwort aussieht.
 */
function pidDateiLesen() {
  const pfad = join(PGORT, 'postmaster.pid');
  if (!existsSync(pfad)) return null;
  let zeilen;
  try {
    zeilen = readFileSync(pfad, 'utf8').split('\n');
  } catch {
    return null;
  }
  const pid = Number((zeilen[0] ?? '').trim());
  const verzeichnis = (zeilen[1] ?? '').trim();
  const port = Number((zeilen[3] ?? '').trim());
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return { pid, verzeichnis, port: Number.isInteger(port) && port > 0 ? port : null };
}

/** Lebt dieser Prozess? `kill(pid, 0)` sendet nichts, es fragt nur. */
function prozessLebt(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * ⛔ LÄUFT GERADE EINE KASSE AUF UNSEREM DATENVERZEICHNIS?
 *
 * ── DER BEFUND VOM 08.08.2026 ────────────────────────────────────────────
 *
 * Die Sicherung las die Datei `pg-port`, versuchte eine Verbindung, und
 * deutete JEDEN Fehler ausser dem Kennwort als „Eintrag veraltet". Danach
 * lief `waisenErloesen()` und schickte SIGKILL an die Kennung aus der
 * `postmaster.pid` — also an die laufende Kasse, mitten im Verkauf.
 *
 * Gemessen wurden zwei Fehler, die genau so aussehen und eine LEBENDE Kasse
 * bedeuten:
 *
 *     53300  sorry, too many clients already
 *     3D000  database "norns_pos" does not exist
 *
 * ── WARUM DIE ANTWORT AUS DER `postmaster.pid` KOMMT, NICHT AUS `pg-port` ─
 *
 * `pg-port` wird beim Start geschrieben und (bis heute) nie gelöscht. Die
 * Zahl darin stammt aus dem Kurzzeitbereich; nach einem harten Ende kann ein
 * völlig fremdes Programm des Benutzers darauf sitzen. Wer `pg-port` als
 * Beweis nimmt, verweigert dem Händler die Sicherung dauerhaft.
 *
 * `postmaster.pid` gehört dagegen Postgres selbst und nennt drei Dinge:
 * Kennung, Datenverzeichnis und Port. Erst wenn ALLE DREI zutreffen — unser
 * Verzeichnis, die Kennung lebt, und auf dem Port antwortet jemand — ist es
 * unsere laufende Kasse.
 *
 * Zwei davon allein reichen nicht: eine liegengebliebene Datei nennt eine
 * Kennung, die inzwischen ein fremdes Programm trägt, und ein antwortender
 * Port sagt nichts über das Verzeichnis.
 */
async function laeuftUnsereKasse() {
  const p = pidDateiLesen();
  if (!p) return false;
  if (p.verzeichnis !== PGORT) return false;
  if (!prozessLebt(p.pid)) return false;
  if (p.port === null) return false;
  return hoertJemandZu(p.port);
}

/** Ein Geheimnis aus dem Systemtresor des Rumpfs — oder ein lauter, deutscher Abbruch. */
function geheim(name, mindest) {
  const w = process.env[name];
  if (!w || w.length < mindest) {
    // NICHTS erfinden: ein selbst gewürfelter Kundenschlüssel wäre beim
    // nächsten Start ein anderer, und alles damit Verschlüsselte für immer
    // unlesbar. Lieber stehenbleiben und es sagen.
    throw new Error(
      `${name} fehlt oder ist zu kurz. Der Rumpf muss es aus dem Systemtresor ` +
      `hereinreichen; dieser Dienst erfindet es nicht.`,
    );
  }
  return w;
}

const ohneMeta = (sql) => sql.split('\n').filter((z) => !z.startsWith('\\')).join('\n');

/**
 * ⚠️ WINDOWS STELLT KEIN SIGTERM ZU. Stirbt der Rumpf hart (Absturz,
 * Stromtritt, TerminateProcess), läuft `process.on('SIGTERM')` hier NIE,
 * postgres überlebt als Waise, hält das Datenverzeichnis — und die Kasse
 * kommt am nächsten Morgen nicht mehr hoch. Der Rumpf bekommt dafür ein
 * Job-Objekt (Sitzung B); DIES ist die zweite, unabhängige Wand: beim
 * Start eine lebende Waise erkennen und beenden. `postmaster.pid` nennt
 * die PID in der ersten Zeile; ob sie lebt, sagt kill(pid, 0). Beendet
 * wird über taskkill (Windows kennt keine Signale) beziehungsweise
 * SIGKILL — einer Waise hilft sanft niemand mehr. Die liegengebliebene
 * pid-Datei erkennt Postgres beim Neustart selbst als verwaist.
 */
async function waisenErloesen() {
  const p = pidDateiLesen();
  if (!p) return;
  // ⚠️ 08.08.2026: erst pruefen, dass die Datei UNSER Verzeichnis nennt.
  // Nach einem harten Ende kann die Kennung inzwischen einem fremden Programm
  // des Benutzers gehoeren; ohne diesen Vergleich beendet der Start es.
  //
  // ⚠️ Der Klopftest gehoert hier ausdruecklich NICHT hinein. Beim Start ist
  // die Waise LEBENDIG und antwortet womoeglich sogar — sie muss trotzdem weg,
  // sonst kommt die Kasse morgens nicht hoch.
  if (p.verzeichnis !== PGORT) return;
  const pid = p.pid;
  if (!prozessLebt(pid)) return; /* tot; Postgres räumt die Datei selbst */
  melde(`verwaistes Postgres (PID ${pid}) hält das Datenverzeichnis; wird beendet`);
  try {
    if (process.platform === 'win32') {
      const { execSync } = await import('node:child_process');
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch { /* schon weg */ }
  // Dateisperren brauchen einen Atemzug, besonders unter Windows.
  await new Promise((weiter) => setTimeout(weiter, 1500));
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 *  DER KURSDIENST: Metallkurse ohne Arbeiter
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Basels Chefsache vom 31.07.2026. Der Kursauftrag wohnt in `apps/worker`,
 * und der reist mit Norns NICHT — ohne dieses Stück bliebe die Kurstabelle
 * jeder Kasse für immer leer (gemessen: `metal_rates` kam im Motorbündel
 * null mal vor). Alle fünf Minuten, plus einmal sofort nach dem Start:
 *
 *   • Metall von Swissquote (Vorgabe seit 11.08.2026): Gold und Silber
 *     DIREKT in Euro, Mitte aus Geld und Brief. gold-api.com (USD je
 *     Feinunze, schlüssellos) bleibt wählbar.
 *   • USD→EUR AMTLICH aus der STATISCHEN EZB-Datei eurofxref-daily.xml.
 *     Ausdrücklich NICHT das EZB-Datenportal: das sperrte den Prüfer mit
 *     HTTP 400 „blocked due to security concerns" (Messung Sitzung B) —
 *     eine Kasse, die bei Netzstörung wiederholt, klopft an so eine Tür
 *     nicht. Der alte Weg über open.er-api.com kostete den Händler
 *     gemessen 253,50 EUR je Kilogramm Feingold, immer in dieselbe
 *     Richtung. Wählbar bleibt er trotzdem: system_settings['kurs'],
 *     Feld fx_quelle = 'EZB' (Vorgabe) oder 'ANBIETER'.
 *   • Jede Zeile trägt ihre Herkunft (Wanderung 0129): USD je Unze,
 *     benutzter Kurs, Kursdatum, Kursquelle, Anbieterstand. Quelle ist
 *     SPOT_VENDOR — 'LBMA' wird ohne Lizenz nie mehr behauptet.
 *   • Kein Netz ist KEIN Fehler: der Bestand bleibt stehen und altert
 *     ehrlich (die Fläche zeigt das Alter; Sitzung B). Gemeldet wird die
 *     Störung einmal, nicht im Fünfminutentakt.
 */
const GRAMM_JE_UNZE = 31.1034768;

/**
 * ⚠️ DIESE ZWEI LISTEN SIND EINE KOPIE.
 *
 * Der Rumpf ist TypeScript, dieser Beipack eine einzelne .mjs-Datei ohne
 * Bündler; ein `import` gäbe es hier nicht. Also stehen die Kennungen zweimal,
 * und ein Wächter (`kursquelle-wirkt-wirklich`) liest BEIDE Dateien und stellt
 * sie gegenüber. Ohne ihn wäre das die Klasse „zwei Listen driften": die
 * Oberfläche böte eine Quelle an, die der Dienst nicht kennt, und der Kurs
 * bliebe stumm stehen, ohne dass irgendwo etwas rot würde.
 *
 * Die kanonische Fassung mit allen Messungen: `src/lib/kursquellen.ts`.
 */
/*
 * ⚰️ 18.08.2026: 'HAND' ist aus der Liste gefallen. Basels Anweisung dieses
 * Tages hebt seine eigene vom 02.08. auf: ein Goldpreis wird nicht mehr von
 * Hand eingetragen, verboten. Ein gespeicherter Altwert 'HAND' faellt unten
 * in `gewaehlt` auf die Vorgabe zurueck — der Dienst zieht also wieder, und
 * die Protokollzeile darunter sagt es dem Betreuer.
 */
const METALLQUELLEN_KENNUNGEN = ['GOLDPREIS_DE', 'GOLD_API', 'SWISSQUOTE'];
const FXQUELLEN_KENNUNGEN = ['EZB', 'ANBIETER'];
const ZEICHEN = { gold: 'XAU', silver: 'XAG', platinum: 'XPT', palladium: 'XPD' };

async function kursZiehen(pgPort, PGPASS) {
  const holen = async (url) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
    return r;
  };
  const db = new pg.Client({
    host: '127.0.0.1', port: pgPort, user: 'norns', password: PGPASS, database: DB,
  });
  await db.connect();
  try {
    await db.query('SET search_path TO public');
    const { rows: einstellung } = await db.query(
      `SELECT key, value #>> '{}' AS wert FROM system_settings
        WHERE key IN ('kurs.metall_quelle', 'kurs.fx_quelle')`);
    const gewaehlt = (schluessel, erlaubt, vorgabe) => {
      const roh = (einstellung.find((z) => z.key === schluessel)?.wert ?? '').trim().toUpperCase();
      return erlaubt.includes(roh) ? roh : vorgabe;
    };
    // Vorgabe seit 13.08.2026: goldpreis.de. Dort kommen ALLE VIER Metalle
    // direkt in Euro, die Umrechnung faellt ganz weg, und es ist der Kurs, an
    // dem sich der deutsche Handel ausrichtet (Basels Anweisung vom 13.08.).
    // Begruendung und Messung: src/lib/kursquellen.ts, METALLQUELLE_VORGABE.
    const metallQuelle = gewaehlt('kurs.metall_quelle', METALLQUELLEN_KENNUNGEN, 'GOLDPREIS_DE');
    const fxQuelle = gewaehlt('kurs.fx_quelle', FXQUELLEN_KENNUNGEN, 'EZB');

    // ⚰️ 18.08.2026: hier stand `if (metallQuelle === 'HAND') return;` —
    // die Betriebsart „Nur von Hand" hielt den Dienst an. Sie ist abgeschafft
    // (Basels Anweisung dieses Tages). Steht in einer aelteren Einstellung
    // noch 'HAND', greift oben die Vorgabe, und diese Zeile macht es sichtbar
    // statt still:
    {
      const roh = (einstellung.find((z) => z.key === 'kurs.metall_quelle')?.wert ?? '')
        .trim()
        .toUpperCase();
      if (roh === 'HAND') {
        console.error(
          '[norns-sidecar] Kursquelle HAND ist abgeschafft (18.08.2026); es zieht wieder die Vorgabe.',
        );
      }
    }

    /**
     * ⚠️ DER UMRECHNUNGSKURS WIRD ERST GEHOLT, WENN IHN JEMAND BRAUCHT.
     *
     * Bis zum 13.08.2026 stand dieser Abruf hier UNBEDINGT, ganz vorn. Das
     * hiess: war die EZB-Datei nicht erreichbar, warf `kursZiehen`, und es
     * wurde KEIN EINZIGER Kurs geschrieben. Auch nicht die, die den Dollar
     * gar nicht anfassen: Gold und Silber von Swissquote kommen direkt in
     * Euro, und bei goldpreis.de gilt das für alle vier Metalle.
     *
     * Ein Abruf, den der gewählte Weg nicht braucht, wäre damit ein
     * zusätzlicher Ausfallpunkt für den Ankaufpreis gewesen: eine fremde
     * Behördenseite hätte den Goldkurs im Laden anhalten können, obwohl ihre
     * Zahl in der Rechnung nirgends vorkommt.
     *
     * Jetzt wird er beim ERSTEN Metall geholt, das ihn wirklich braucht, und
     * das Ergebnis gemerkt. Braucht ihn keines, wird die Datei nie angefasst.
     */
    let eurJeUsd = null; let fxDatum = null; let fxName = null; let fxVersprechen = null;
    const umrechnungskurs = async () => {
      if (eurJeUsd !== null) return eurJeUsd;
      // Ein einziger Abruf, auch wenn vier Metalle gleichzeitig fragen.
      fxVersprechen ??= (async () => {
        if (fxQuelle === 'EZB') {
          const xml = await (await holen('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml')).text();
          const usdJeEur = Number((xml.match(/currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/) ?? [])[1]);
          if (!Number.isFinite(usdJeEur) || usdJeEur <= 0) throw new Error('EZB-Datei ohne USD-Kurs');
          fxDatum = (xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/) ?? [])[1] ?? null;
          fxName = 'EZB eurofxref-daily';
          return 1 / usdJeEur;
        }
        const j = await (await holen('https://open.er-api.com/v6/latest/USD')).json();
        const kurs = Number(j?.rates?.EUR);
        if (!Number.isFinite(kurs) || kurs <= 0) throw new Error('Anbieter ohne EUR-Kurs');
        const d = j?.time_last_update_utc ? new Date(j.time_last_update_utc) : null;
        fxDatum = d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
        fxName = 'open.er-api.com';
        return kurs;
      })();
      eurJeUsd = await fxVersprechen;
      return eurJeUsd;
    };

    // Vernunftgrenzen in EUR je Gramm: ein Anbieterfehler (Cent statt
    // Dollar, Unze statt Gramm) darf NIE als Kurs in die Bücher.
    const SINNVOLL = { gold: [20, 500], silver: [0.2, 10], platinum: [10, 200], palladium: [10, 200] };

    /**
     * ─────────────────────────────────────────────────────────────────────
     *  goldpreis.de: EIN Abruf, alle vier Metalle, direkt in Euro
     * ─────────────────────────────────────────────────────────────────────
     *
     * Basels Anweisung vom 13.08.2026: der deutsche Handel richtet sich nach
     * dieser Seite, also soll die Kasse genau diesen Kurs zeigen.
     *
     * `goldpreis.de` selbst hat keine Schnittstelle, und die Seite abzugreifen
     * wäre falsch: sie nennt am Fuss Six Financial Information und Morningstar
     * als Herkunft, also fremde, lizenzierte Daten. DASSELBE HAUS bietet die
     * Zahlen aber frei an, und es ist gemessen dasselbe Haus:
     * Amtsgericht Ulm, HRB 4847 (ADEOS MEDIA GmbH) steht in beiden Impressen.
     * Gegenprobe am 13.08.2026: die Seite zeigte 3.773,60 EUR je Unze Gold,
     * die Schnittstelle gab 3773.6.
     *
     * ⚠️ Die Antwort trägt ALLE Metalle auf einmal. Deshalb wird sie EINMAL
     * geholt und gemerkt, sonst fragte die Schleife unten viermal dasselbe ab.
     *
     * ⚠️ Der Zeitstempel ist in SEKUNDEN. Als Millisekunden gelesen wäre er
     * 1970, und jede Zeile trüge einen Stand aus der Vorzeit.
     */
    const GOLDPREIS_FELD = {
      XAU: ['gold_eur', 'gold_usd'], XAG: ['silber_eur', 'silber_usd'],
      XPT: ['platin_eur', 'platin_usd'], XPD: ['palladium_eur', 'palladium_usd'],
    };
    let goldpreisVersprechen = null;
    const vonGoldpreisDe = async (zeichen) => {
      goldpreisVersprechen ??= holen('https://api.edelmetalle.de/public.json').then((r) => r.json());
      const j = await goldpreisVersprechen;
      const [feldEur, feldUsd] = GOLDPREIS_FELD[zeichen];
      const eurJeUnze = Number(j?.[feldEur]);
      if (!Number.isFinite(eurJeUnze) || eurJeUnze <= 0) return null;
      const usd = Number(j?.[feldUsd]);
      const sekunden = Number(j?.timestamp);
      const fx = Number(j?.wechselkurs_usd_eur);
      return {
        eurJeUnze,
        // ⚠️ NULL, obwohl das Haus einen Dollarpreis nennt: dieses Feld
        // steuert unten, ob `fx_rate_used` gefüllt wird. Gefüllt hiesse
        // „umgerechnet", und umgerechnet wurde hier nichts. Der Dollarpreis
        // des Hauses steht stattdessen im Klartext der Herkunft.
        usdJeUnze: null,
        anbieter:
          'goldpreis.de (ADEOS MEDIA GmbH), Euro direkt' +
          (Number.isFinite(usd) && usd > 0 ? `; Dollarpreis des Hauses: ${usd.toFixed(4)} USD/oz` : '') +
          (Number.isFinite(fx) && fx > 0 ? `; Dollarkurs des Hauses: ${fx.toFixed(6)} USD/EUR` : ''),
        stand: Number.isFinite(sekunden) && sekunden > 0
          ? new Date(sekunden * 1000).toISOString()
          : null,
      };
    };

    /**
     * Ein Metall bei gold-api.com. Immer Dollar je Unze, also immer umgerechnet.
     */
    const vonGoldApi = async (zeichen) => {
      const j = await (await holen(`https://api.gold-api.com/price/${zeichen}`)).json();
      const usdJeUnze = Number(j?.price);
      if (!Number.isFinite(usdJeUnze) || usdJeUnze <= 0) return null;
      return {
        eurJeUnze: usdJeUnze * (await umrechnungskurs()),
        usdJeUnze,
        anbieter: 'gold-api.com',
        stand: typeof j?.updatedAt === 'string' ? j.updatedAt : null,
      };
    };

    /**
     * Ein Metall bei Swissquote.
     *
     * Erst gegen EURO fragen: Gold und Silber kommen dort direkt in Euro, und
     * dann entfällt die Umrechnung samt ihrer Fehlerquelle ganz. Antwortet der
     * Kursstrom mit einer LEEREN Liste (gemessen bei Platin und Palladium: die
     * Paare XPT/EUR und XPD/EUR gibt es dort nicht), noch einmal gegen Dollar.
     *
     * Genommen wird die MITTE aus Geld- und Briefkurs. Der Briefkurs allein
     * wäre der Preis, zu dem die Bank verkauft, und den als „Marktwert" in den
     * Ankauf zu tragen hiesse, dem Kunden zu viel zu zahlen; der Geldkurs
     * allein wäre der umgekehrte Fehler.
     */
    const vonSwissquote = async (zeichen) => {
      const mitte = (liste) => {
        const p = liste?.[0]?.spreadProfilePrices;
        const wahl = p?.find((x) => x.spreadProfile === 'prime') ?? p?.[0];
        const geld = Number(wahl?.bid);
        const brief = Number(wahl?.ask);
        if (!Number.isFinite(geld) || !Number.isFinite(brief) || geld <= 0) return null;
        return {
          preis: (geld + brief) / 2,
          stand: Number.isFinite(liste?.[0]?.ts) ? new Date(liste[0].ts).toISOString() : null,
        };
      };
      const strom = (waehrung) =>
        holen(
          `https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${zeichen}/${waehrung}`,
        ).then((r) => r.json());

      const inEuro = mitte(await strom('EUR'));
      if (inEuro) {
        return {
          eurJeUnze: inEuro.preis,
          usdJeUnze: null,
          anbieter: 'Swissquote (direkt in Euro)',
          stand: inEuro.stand,
        };
      }
      const inDollar = mitte(await strom('USD'));
      if (!inDollar) return null;
      return {
        eurJeUnze: inDollar.preis * (await umrechnungskurs()),
        usdJeUnze: inDollar.preis,
        anbieter: 'Swissquote',
        stand: inDollar.stand,
      };
    };

    const stand = [];
    for (const [metall, zeichen] of Object.entries(ZEICHEN)) {
      let treffer;
      try {
        treffer =
          metallQuelle === 'GOLDPREIS_DE' ? await vonGoldpreisDe(zeichen)
          : metallQuelle === 'SWISSQUOTE' ? await vonSwissquote(zeichen)
          : await vonGoldApi(zeichen);
      } catch { continue; /* ein totes Symbol reisst die anderen nicht mit */ }
      if (!treffer) continue;
      const { eurJeUnze, usdJeUnze, anbieter } = treffer;
      if (!Number.isFinite(eurJeUnze) || eurJeUnze <= 0) continue;
      const eurJeGramm = eurJeUnze / GRAMM_JE_UNZE;
      // Diese absoluten Grenzen sind seit dem 18.08.2026 der EINZIGE
      // Kurswaechter: das relative ±50%-Band (lib/kursband.ts) starb mit der
      // Handeingabe. Relativ GEGEN DIE LETZTE ZEILE waere hier eine Falle:
      // steht die Kasse Monate still und der Markt laeuft weiter als das
      // Band, lehnte der Dienst die echte Quelle fuer immer ab, ohne
      // menschlichen Notausgang.
      const [unten, oben] = SINNVOLL[metall];
      if (eurJeGramm < unten || eurJeGramm > oben) {
        melde(`Kurs ${metall} ${eurJeGramm.toFixed(4)} EUR/g ausserhalb jeder Vernunft; verworfen`);
        continue;
      }
      const preis = eurJeGramm.toFixed(4);
      const { rows: aktuell } = await db.query(
        `SELECT id, price_per_gram_eur FROM metal_prices
          WHERE metal = $1 AND valid_to IS NULL LIMIT 1`, [metall]);
      if (aktuell[0] && Number(aktuell[0].price_per_gram_eur) === Number(preis)) continue;
      await db.query('BEGIN');
      try {
        if (aktuell[0]) {
          await db.query(`UPDATE metal_prices SET valid_to = now() WHERE id = $1`, [aktuell[0].id]);
        }
        await db.query(
          `INSERT INTO metal_prices
             (metal, price_per_gram_eur, source, source_payload,
              price_usd_per_ounce, fx_rate_used, fx_rate_date, fx_source, source_asof)
           VALUES ($1, $2, 'SPOT_VENDOR', $3::jsonb, $4, $5, $6, $7, $8)`,
          [metall, preis,
           JSON.stringify({
             dienst: 'norns-sidecar', anbieter, quelle: metallQuelle,
             // Bei Gold und Silber von Swissquote steht hier bewusst „ohne
             // Umrechnung": dann hat der Dollarkurs den Preis NICHT berührt.
             fx: usdJeUnze === null ? 'ohne Umrechnung' : fxName,
           }),
           usdJeUnze === null ? null : usdJeUnze.toFixed(4),
           usdJeUnze === null || eurJeUsd === null ? null : eurJeUsd.toFixed(8),
           usdJeUnze === null ? null : fxDatum,
           usdJeUnze === null ? null : fxName,
           treffer.stand ?? new Date().toISOString()]);
        await db.query('COMMIT');
      } catch (fehler) {
        await db.query('ROLLBACK');
        throw fehler;
      }
      stand.push(`${metall} ${preis}`);
    }
    if (stand.length > 0) {
      // Die Meldung nennt die GEWÄHLTE Quelle. Nur den Umrechnungskurs zu
      // nennen wäre irreführend, sobald Gold direkt in Euro kam. Und wurde
      // gar nicht umgerechnet, sagt die Meldung genau das, statt eine
      // Herkunft zu nennen, die nichts beigetragen hat.
      const fxTeil = fxName === null
        ? 'ohne Umrechnung'
        : `${fxName}${fxDatum ? ', ' + fxDatum : ''}`;
      melde(`Kurse (${metallQuelle}, ${fxTeil}): ${stand.join(', ')}`);
    }
  } finally {
    await db.end();
  }
}

async function main() {
  const t0 = Date.now();
  const takt = () => ((Date.now() - t0) / 1000).toFixed(2) + 's';

  const AUTH = geheim('AUTH_SECRET', 32);
  const PII = geheim('NORNS_PII_KEY', 16);
  const KYC = geheim('KYC_IMAGE_ENCRYPTION_KEY', 43);
  const PGPASS = geheim('NORNS_DB_PASSWORT', 8);
  // Die stabile Gerätekennung des Rumpfs (Fingerabdruck des Datenorts, bewusst
  // NICHT Plattenseriennummer oder Netzwerkadresse). Ohne sie gäbe es kein
  // gepaartes Gerät — und transactions.device_id ist notNull mit
  // Fremdschlüssel: die Kasse könnte keinen einzigen Beleg schreiben.
  const KENNUNG = geheim('NORNS_GERAETE_KENNUNG', 8);

  mkdirSync(DATENORT, { recursive: true });
  const erstmalig = !existsSync(join(PGORT, 'PG_VERSION'));

  // ── 1. Postgres ────────────────────────────────────────────────────────
  const pgs = new EmbeddedPostgres({
    databaseDir: PGORT,
    user: 'norns',
    password: PGPASS,
    port: await freierPort(),
    persistent: true,
    /*
     * ── ⚠️ DIE KODIERUNG WIRD GESAGT, NICHT DER UMGEBUNG UEBERLASSEN ──────
     *
     * Ohne diese Zeile uebernimmt initdb die Sprachumgebung des Rechners.
     * Auf einem deutschen Windows heisst das WIN1252 — und die erste
     * Wanderung mit einem Zeichenstrich (`─`, Bytes 0xe2 0x94 0x80) bricht
     * mit „has no equivalent in encoding WIN1252" ab. Genau so stand die
     * Kasse am 10.08.2026 auf Basels Windows-Rechner: sie startete NIE.
     *
     * Kein Fliessband hat das je gesehen, weil jeder Laeufer (Ubuntu, macOS)
     * eine UTF-8-Umgebung traegt. Ein Verhalten, das von der Umgebung des
     * Geraets abhaengt, sieht ueberall gut aus, ausser dort, wo es zaehlt.
     *
     * Postgres erlaubt auf Windows UTF8 mit JEDER Sprachumgebung; deutsche
     * Sortierung und Gross-Klein-Behandlung bleiben erhalten.
     */
    initdbFlags: ['--encoding=UTF8'],
  });
  if (erstmalig) {
    mkdirSync(PGORT, { recursive: true });
    await pgs.initialise();
    melde(`Datenverzeichnis angelegt (${takt()})`);
  }
  await waisenErloesen();
  await pgs.start();

  /*
   * ── EIN SCHON FALSCH ANGELEGTES VERZEICHNIS HEILEN ──────────────────────
   *
   * Auf dem Rechner, der den Befund lieferte, LIEGT bereits ein
   * WIN1252-Verzeichnis: dort war `erstmalig` beim naechsten Start falsch,
   * die Anlage wurde uebersprungen, und derselbe Abbruch kaeme wieder — fuer
   * immer. Deshalb wird die Kodierung nach dem Start GEMESSEN.
   *
   * ⚠️ Beiseitegelegt (umbenannt, NIE geloescht) wird nur ein Verzeichnis,
   * das nachweislich KEINEN Beleg und KEINEN Abschluss traegt. Ein solches
   * Verzeichnis ist der Rest eines Starts, der nie zu Ende kam. Traegt es
   * auch nur eine Zeile, bricht der Motor mit einer ehrlichen Meldung ab:
   * Aufzeichnungen nach § 147 AO fasst ein Startskript nicht an.
   */
  {
    const probe = new pg.Client({
      host: '127.0.0.1', port: pgs.options.port, user: 'norns', password: PGPASS, database: 'postgres',
    });
    await probe.connect();
    const kodierung = (await probe.query('SHOW server_encoding')).rows[0].server_encoding;
    if (kodierung !== 'UTF8') {
      let leer = true;
      const hatDb = (await probe.query(
        'SELECT 1 FROM pg_database WHERE datname = $1', [DB],
      )).rowCount > 0;
      await probe.end();
      if (hatDb) {
        const inhalt = new pg.Client({
          host: '127.0.0.1', port: pgs.options.port, user: 'norns', password: PGPASS, database: DB,
        });
        await inhalt.connect();
        for (const tabelle of ['transactions', 'daily_closings']) {
          const reg = await inhalt.query('SELECT to_regclass($1) AS t', [`public.${tabelle}`]);
          if (reg.rows[0].t !== null) {
            const n = await inhalt.query(`SELECT count(*)::int AS n FROM ${tabelle}`);
            if (n.rows[0].n > 0) leer = false;
          }
        }
        await inhalt.end();
      }
      if (!leer) {
        throw new Error(
          `Das Datenverzeichnis traegt die Kodierung ${kodierung} statt UTF8 und enthaelt ` +
          `bereits Belege. Es wird NICHT angefasst. Bitte den Norns-Support verstaendigen; ` +
          `die Daten sind unversehrt, nur die Kasse kann mit dieser Kodierung nicht arbeiten.`,
        );
      }
      await pgs.stop();
      const ablage = `${PGORT}-${kodierung.toLowerCase()}-beiseitegelegt-${new Date().toISOString().slice(0, 19).replace(/[:]/g, '-')}`;
      renameSync(PGORT, ablage);
      melde(`Datenverzeichnis mit Kodierung ${kodierung} ohne Belege beiseitegelegt: ${ablage}`);
      mkdirSync(PGORT, { recursive: true });
      await pgs.initialise();
      await pgs.start();
      melde(`Datenverzeichnis neu als UTF8 angelegt (${takt()})`);
    } else {
      await probe.end();
    }
  }

  const PGPORT_NR = pgs.options.port;
  // Die Portdatei ist für die Sicherung da: sie findet darüber die laufende
  // Instanz. Ist der Eintrag veraltet, scheitert dort nur der erste
  // Verbindungsversuch, und die Sicherung startet ihr eigenes Postgres.
  writeFileSync(join(DATENORT, 'pg-port'), String(PGPORT_NR));
  melde(`Postgres ${erstmalig ? 'angelegt und ' : ''}gestartet auf ${PGPORT_NR} (${takt()})`);

  // ── 2. Erststart: Schema, Rollen, Saat, Nachzügler ─────────────────────
  const admin = new pg.Client({
    host: '127.0.0.1', port: PGPORT_NR, user: 'norns', password: PGPASS, database: 'postgres',
  });
  await admin.connect();
  const { rows: schonDa } = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [DB]);
  if (schonDa.length === 0) {
    const schema = ohneMeta(readFileSync(join(HIER, 'erststart', 'schema.sql'), 'utf8'));
    // Die Rollen stehen NICHT in den Wanderungen; auf dem Server legt sie
    // das Anlegeskript an. Der Auszug nennt sie alle: lesen, nicht raten.
    const rollen = [...new Set(
      [...schema.matchAll(/(?:OWNER TO|GRANT[^;]*? TO|REVOKE[^;]*? FROM)\s+([a-z][a-z0-9_]*)/g)].map((m) => m[1]),
    )].filter((r) => r !== 'public' && r !== 'norns');
    for (const r of rollen) {
      try { await admin.query(`CREATE ROLE "${r}" NOLOGIN NOINHERIT`); } catch { /* schon da */ }
    }
    await admin.query(`ALTER ROLE ${APPROLLE} WITH LOGIN PASSWORD '${PGPASS.replace(/'/g, "''")}'`);
    await admin.query(`CREATE DATABASE ${DB}`);

    const neu = new pg.Client({
      host: '127.0.0.1', port: PGPORT_NR, user: 'norns', password: PGPASS, database: DB,
    });
    await neu.connect();
    await neu.query(schema);
    await neu.query('SET search_path TO public');
    const { rows: [tz] } = await neu.query(
      `SELECT count(*)::int AS t FROM information_schema.tables WHERE table_schema='public'`);
    melde(`Schema: ${tz.t} Tabellen`);

    // Referenzsaat. Ihre Zeilen tragen Verweise auf Produktionsnutzer, die es
    // hier nicht gibt — der Standardgriff jeder Wiederherstellung: Auslöser
    // kurz still, laden, wieder scharf. Nur der Eigner darf das.
    const referenz = ohneMeta(readFileSync(join(HIER, 'erststart', 'referenz.sql'), 'utf8'));
    await neu.query('SET session_replication_role = replica');
    await neu.query(referenz);
    await neu.query('SET session_replication_role = DEFAULT');
    // ⚠️ referenz.sql ist SELBST ein pg_dump-Auszug und setzt search_path
    // wieder auf ''. Wer danach unqualifiziert weiterarbeitet, sieht ein
    // Schema voller Tabellen und findet KEINE davon. Zwanzig Minuten, Nummer
    // zwei: derselbe Griff, eine Ebene tiefer.
    await neu.query('SET search_path TO public');

    // Die Genesis der Ledger-Kette (Wanderung 0048).
    await neu.query(`INSERT INTO public.ledger_chain_head (only_row, last_row_hash)
      VALUES (TRUE, decode('0000000000000000000000000000000000000000000000000000000000000000','hex'))
      ON CONFLICT (only_row) DO NOTHING`);

    await neu.query(`GRANT CONNECT ON DATABASE ${DB} TO ${APPROLLE}`);
    await neu.query(`GRANT USAGE ON SCHEMA public TO ${APPROLLE}`);
    await neu.end();
    melde(`Erststart: Schema, ${rollen.length} Rollen, Saat, ${NACHZUEGLER.length} Nachzügler (${takt()})`);
  }
  await admin.end();

  // ── 2b. Inhaber und gepaartes Gerät, bei JEDEM Start nachgezogen ───────
  //
  // Befund von Sitzung B, an der Datenbank nachgemessen: ohne Zeile in
  // `devices` ist die Kasse gesund gebootet und trotzdem unbenutzbar. Die
  // Paarung ist keine Politik, sondern eine Voraussetzung des Schemas.
  // Konfliktziel ist cert_serial (UNIQUE): dieselbe Kennung bleibt dieselbe
  // Zeile; nach einer Rückspielung auf neuer Maschine entsteht eine neue
  // Paarung, statt die Aufstellung an einem Dienstagmorgen zu töten.
  const saat = new pg.Client({
    host: '127.0.0.1', port: PGPORT_NR, user: 'norns', password: PGPASS, database: DB,
  });
  await saat.connect();
  await saat.query('SET search_path TO public');

  // Nachzügler: Wanderungen, die jünger sind als der Schema-Auszug. EIN Weg
  // für frische UND bestehende Bestände, bei jedem Start — mit eigener
  // Buchführung, denn die Lehre der Produktion lautet: von Hand Eingespieltes
  // ohne Buchung spielt sich irgendwann doppelt ein. So kommen auch künftige
  // Wanderungen per Aktualisierung zu Bestandskunden.
  //
  // Zwei Fundorte, in dieser Reihenfolge: im BÜNDEL liegt die Kopie unter
  // erststart/nachzuegler/ (der Arbeitsbaum reist nicht mit ins Erzeugnis);
  // im Arbeitsbaum gilt das Original in packages/db/migrations.
  await saat.query(`CREATE TABLE IF NOT EXISTS norns_nachzuegler (
    name text PRIMARY KEY, eingespielt_am timestamptz NOT NULL DEFAULT now())`);
  for (const n of NACHZUEGLER) {
    const { rows: schon } = await saat.query(
      `SELECT 1 FROM norns_nachzuegler WHERE name = $1`, [n]);
    if (schon.length > 0) continue;
    const imBuendel = join(HIER, 'erststart', 'nachzuegler', n);
    const imBaum = join(HIER, '..', '..', '..', 'packages', 'db', 'migrations', n);
    await saat.query(readFileSync(existsSync(imBuendel) ? imBuendel : imBaum, 'utf8'));
    await saat.query('SET search_path TO public');
    await saat.query(`INSERT INTO norns_nachzuegler (name) VALUES ($1)`, [n]);
    melde(`Nachzügler eingespielt: ${n}`);
  }
  // ── Referenzsaat NACHZIEHEN, bei jedem Start ──────────────────────────
  //
  // ⚠️ BASELS BEFUND VOM 05.08.2026, an SEINER Datenbank nachgemessen.
  //
  // Er drückte „Anlegen & verkaufsbereit" und bekam „Aktion derzeit nicht
  // möglich der aktuelle Stand passt nicht mehr". Dahinter stand kein
  // Wettlauf und kein veralteter Stand, sondern:
  //
  //   SQLSTATE 23503
  //   violates foreign key constraint "products_tax_treatment_code_fkey"
  //
  // In seiner Datenbank standen NULL Zeilen in `tax_treatment_codes`. Jedes
  // Produkt trägt eine Steuerart, und die Spalte zeigt per Fremdschlüssel
  // dorthin. Also war JEDER Lagerzugang unmöglich, seit dem ersten Tag.
  // Ebenso leer: karat_grades, categories, hallmarks, shipping_zones.
  //
  // WARUM ES NIEMAND MERKTE
  // Die Saat lief in Zweig 2 oben, und der Zweig läuft NUR, wenn die
  // Datenbank noch nicht existiert. Seine wurde am 31.07. von einem Bau
  // angelegt, der sie noch nicht kannte. Ab da gab es keinen Weg mehr, sie
  // nachzuholen: die Datenbank existierte ja. Ein Schritt, den nur der
  // allererste Start ausführt, ist für jeden bestehenden Bestand für immer
  // unerreichbar — und schweigt dabei.
  //
  // Deshalb steht sie jetzt HIER, bei den Dingen, die bei jedem Start
  // nachgezogen werden, genau wie die Wanderungen und der Inhaber.
  //
  // ⚠️ Sie greift nur, wenn eine Tabelle WIRKLICH leer ist. Eine gefüllte
  // wird nie angefasst; der Händler soll seine eigenen Sammlungen behalten.
  // Jede Anweisung läuft in ihrem eigenen Sicherungspunkt, damit eine
  // Tabelle, die schon steht, die übrigen nicht mitreisst.
  {
    const referenzPfad = join(HIER, 'erststart', 'referenz.sql');
    if (existsSync(referenzPfad)) {
      const roh = ohneMeta(readFileSync(referenzPfad, 'utf8'));
      // Jede `INSERT INTO public.<tabelle> …;` einzeln, mit ihrem Ziel.
      const bloecke = [...roh.matchAll(/INSERT INTO public\.(\w+)[\s\S]*?;\s*$/gm)]
        .map((m) => ({ tabelle: m[1], sql: m[0] }));
      const nachgezogen = [];
      for (const b of bloecke) {
        let leer = false;
        try {
          const { rows } = await saat.query(`SELECT count(*)::int AS n FROM public.${b.tabelle}`);
          leer = rows[0].n === 0;
        } catch {
          continue; // Tabelle gibt es hier nicht — nichts zu säen.
        }
        if (!leer) continue;
        // ⚠️ EIGENE Transaktion je Tabelle, kein SAVEPOINT. Der erste Wurf
        // nahm Sicherungspunkte, und die verlangen einen offenen
        // Transaktionsblock — ausserhalb wirft Postgres „SAVEPOINT can only
        // be used in transaction blocks", und die ganze Saat lief ins Leere.
        // Am laufenden Motor gemessen, nicht überlegt.
        try {
          await saat.query('BEGIN');
          // Die Referenzzeilen tragen Verweise auf Produktionsnutzer, die es
          // hier nicht gibt: Auslöser kurz still, laden, wieder scharf.
          await saat.query('SET LOCAL session_replication_role = replica');
          await saat.query(b.sql);
          await saat.query('COMMIT');
          nachgezogen.push(b.tabelle);
        } catch (e) {
          try { await saat.query('ROLLBACK'); } catch { /* schon zurückgerollt */ }
          melde(`Referenzsaat ${b.tabelle} NICHT eingespielt: ${e.message}`);
        }
      }
      await saat.query('SET search_path TO public');
      if (nachgezogen.length > 0) melde(`Referenzsaat nachgezogen: ${nachgezogen.join(', ')}`);
    }
  }

  // is_owner MUSS mit: die Inhaberflächen (Leitstand, Einstellungen) sind
  // owner-gated, ein ADMIN ohne Eignerbit stünde vor verschlossenen Türen.
  // Die Probe hat genau das gefunden: actor.isOwner war false.
  await saat.query(`INSERT INTO users (id, email, email_verified, name, role, is_owner)
    VALUES ('00000000-0000-4000-8000-000000000001', 'inhaber@norns.lokal', true, 'Inhaber', 'ADMIN', true)
    ON CONFLICT (id) DO UPDATE SET is_owner = true`);
  await saat.query(`INSERT INTO devices
      (id, device_class, hostname, cert_serial, cert_issued_at, cert_expires_at, status, paired_by_user_id)
    VALUES (gen_random_uuid(), 'POS_TERMINAL', 'norns-kasse', $1, now(), now() + interval '10 years', 'active',
      '00000000-0000-4000-8000-000000000001')
    ON CONFLICT (cert_serial) DO UPDATE SET status = 'active'`, [KENNUNG]);

  // ── 2c. Der geblendete Suchindex der Bestandskunden (Wanderung 0146) ────
  //
  // Die Wanderung selbst laeuft als Migrator OHNE den PII-Schluessel und KANN
  // die Bestandsnamen nicht zerlegen. HIER liegt der Schluessel vor. Einmal
  // echte Arbeit (gemessen: 2.000 Kunden in 3,3 s), danach trifft das WHERE
  // null Zeilen und der Schritt kostet eine Rundreise.
  //
  // ⚠️ Der Schluessel wird als Sitzungseinstellung gereicht und die Sitzung
  // danach beendet — er landet nirgends auf der Platte.
  {
    const t = Date.now();
    await saat.query(`SELECT set_config('warehouse14.pii_key', $1, false)`, [PII]);
    const r = await saat.query(`UPDATE customers
      SET name_such_tokens = pii_such_tokens_ablage(decrypt_pii(full_name_encrypted))
      WHERE name_such_tokens IS NULL AND full_name_encrypted IS NOT NULL`);
    if (r.rowCount > 0) melde(`Suchindex: ${r.rowCount} Kundennamen geblendet (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  }

  await saat.end();
  melde('Inhaber und gepaartes Gerät stehen');

  // ── 3. Der Server, unverändert, nach innen gebunden ────────────────────
  const url = `postgresql://${APPROLLE}:${encodeURIComponent(PGPASS)}@127.0.0.1:${PGPORT_NR}/${DB}`;
  const PORT = await freierPort();
  Object.assign(process.env, {
    NODE_ENV: 'production',
    LOG_LEVEL: process.env['LOG_LEVEL'] || 'warn',
    PORT: String(PORT),
    DATABASE_URL: url,
    LISTEN_DATABASE_URL: url,
    AUTH_SECRET: AUTH,
    NORNS_PII_KEY: PII,
    KYC_IMAGE_ENCRYPTION_KEY: KYC,
    PHOTOS_DIR: join(DATENORT, 'fotos'),
    KYC_PHOTOS_DIR: join(DATENORT, 'kyc'),
    // Die Bilder liegen auf DIESER Platte; die öffentliche Adresse muss
    // deshalb auf DIESEN Server zeigen. Mit der Vorgabe aus der Wolke sähe
    // der Kassierer leere Kästen, während die Dateien daneben liegen.
    PHOTOS_PUBLIC_BASE_URL: process.env['PHOTOS_PUBLIC_BASE_URL'] || `http://127.0.0.1:${PORT}`,
    // Die Gerätebindung offline: der Wächter löst über devices.cert_serial
    // auf, und die Kennung des Rumpfs IST die Bespannung dieser Aufstellung
    // (Zeile dazu steht seit Abschnitt 2b in der Tabelle).
    // 21.08.2026: sagt dem Motor, dass er IN einer Kasse laeuft (nicht in der
    // Wolke). Nur dann existieren die Wege, die an Laufwerke fassen
    // (Rettungsstick) — in der Wolke antworten sie 404, als gaebe es sie nicht.
    NORNS_LOKALE_KASSE: '1',
    TEST_DEVICE_FINGERPRINT: KENNUNG,
    ALLOW_TEST_DEVICE_FINGERPRINT_IN_PROD: 'true',
    // Basels Entscheidung vom 30.07.2026: offline meldet sich der Händler
    // mit sechs bis zwölf SELBST GEWÄHLTEN Ziffern an (keine Vorgabe,
    // nirgends; pin-login ohne Geheimnis antwortet PIN_NOT_SET und die
    // Kasse zeigt die Einrichtung). In Warehouse14 bleibt die PIN
    // pensioniert; hier wird der Weg ausdrücklich geöffnet, damit ein
    // künftiger Vorgaben-Wechsel im Motor ihn nicht still schliesst.
    DISABLE_PIN_AUTH: 'false',
    // ── Die Fassung, die dem Finanzamt genannt wird ──────────────────────
    //
    // Landet über `kassensoftwareFassung()` als `KASSE_SW_VERSION` in der
    // amtlichen `cashregister.csv` — der Datei, die ein Betriebsprüfer bei
    // einer Kassennachschau nach § 146b AO aufschlägt.
    //
    // Ein von aussen gesetzter Wert gewinnt, damit ein Prüflauf sie stellen
    // kann; sonst gilt, was oben aus `tauri.conf.json` eingebacken wurde.
    // Steht dort nichts (kaputter Bau), bleibt es LEER und der Motor meldet
    // nichts, statt etwas zu erfinden.
    NORNS_KASSE_VERSION:
      process.env['NORNS_KASSE_VERSION'] || String(tauriKonfiguration.version ?? ''),
  });

  const { loadEnv } = await import('../src/config/env.ts');
  const { buildApp } = await import('../src/app.ts');
  // Aus derselben Quelle wie der Motor; siehe Abschnitt 6 weiter unten.
  const { starteKettenpruefung } = await import('../src/lib/kettenpruefung.ts');
  const app = await buildApp({ env: loadEnv() });
  await app.listen({ port: PORT, host: '127.0.0.1' });
  melde(`Server bereit (${takt()})`);

  // ── 4. Die eine Zeile, auf die der Rumpf wartet ────────────────────────
  meldeBereit(`NORNS_BEREIT ${JSON.stringify({ port: PORT, datenort: DATENORT })}\n`);

  // ── 5. Kurse: sofort und alle fünf Minuten, NACH der Bereitmeldung ─────
  // (der Rumpf wartet nicht auf das Internet). Störung wird EINMAL gemeldet.
  let kursStumm = false;
  const kursLauf = async () => {
    try {
      await kursZiehen(PGPORT_NR, PGPASS);
      kursStumm = false;
    } catch (fehler) {
      if (!kursStumm) {
        melde(`Kurse nicht erreichbar (${fehler.message}); der Bestand bleibt und altert ehrlich`);
        kursStumm = true;
      }
    }
  };
  void kursLauf();
  setInterval(kursLauf, 5 * 60 * 1000);

  // ── 6. Die Prüfsummenkette prüft sich selbst ───────────────────────────
  //
  // ⛔ BEFUND vom 21.08.2026: `starteKettenpruefung` steht in `server.ts`,
  // und dieser Beiläufer bootet `buildApp` DIREKT (Zeile 1022, „server.ts
  // bleibt unberührt"). Auf einer ausgelieferten Kasse lief die Selbstprüfung
  // der Fiskalkette damit NIE. Geprüft wurde sie nur beim Ziehen des
  // Prüferpakets — und das kann Monate auseinanderliegen. Ein Bruch fiele
  // dann bei der Kassennachschau auf, nicht am Tag danach.
  //
  // Am 08.08. wurde die ANZEIGE dieser Lücke ehrlich gemacht („nie geprüft"
  // ist nicht grün). Jetzt wird auch die Lücke selbst geschlossen.
  //
  // ⚠️ GEMESSEN, bevor es hier steht: `verify_ledger_chain()` läuft über
  // 20 000 Zeilen in 84 ms, also 0,0042 ms je Zeile. Ein Jahrzehnt einer
  // belebten Kasse (500 000 Zeilen) kostet 2,1 Sekunden — einmal beim
  // Anlauf, danach einmal täglich, und NACH der Bereitmeldung. Die Kasse
  // wartet keine Millisekunde darauf.
  starteKettenpruefung(app);

  const zu = async () => {
    try { await app.close(); } catch { /* schon zu */ }
    try { await pgs.stop(); } catch { /* schon zu */ }
    // ⚠️ 08.08.2026: die Portdatei MUSS weg. Sie wurde beim Start geschrieben
    // und bis heute nie geloescht; die Zahl darin stammt aus dem
    // Kurzzeitbereich, und nach einem Neustart des Rechners kann ein voellig
    // fremdes Programm des Benutzers darauf sitzen. Eine liegengebliebene
    // Zahl, die jemand fuer einen Beweis haelt, ist die Wurzel der Klasse.
    try { unlinkSync(join(DATENORT, 'pg-port')); } catch { /* nie geschrieben */ }
    process.exit(0);
  };
  process.on('SIGTERM', zu);
  process.on('SIGINT', zu);
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 *  DIE SICHERUNG: `--sicherung <zielordner>`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Das eingebettete Paket bringt kein pg_dump mit. Fiskaldaten ohne Sicherung
 * sind aber keine Option — also macht der Dienst sie selbst:
 *
 *   • EIN Schnappschuss: eine REPEATABLE-READ-READ-ONLY-Sitzung liest alle
 *     Tabellen aus demselben Stand, auch während die Kasse verkauft.
 *   • ROHTEXT statt Deutung: jeder Wert wird GENAU so geschrieben, wie der
 *     Server ihn liefert (eigener Typ-Parser, der nichts parst). bytea,
 *     Zeitstempel, JSON, Felder — alles kehrt Byte für Byte zurück.
 *   • Die Datei ist selbst ausführbar: Auslöser still (replica), Einfügen
 *     in Blöcken, Sequenzstände, COMMIT. Wiederherstellung = frisches
 *     Verzeichnis, Rollen, schema.sql, Nachzügler, dann diese Datei.
 *   • Fotos und KYC-Bilder wandern als Ordner mit; sie liegen nicht in der
 *     Datenbank.
 *
 * Meldung am Ende, stdout, eine Zeile: NORNS_SICHERUNG_FERTIG {json}.
 */
async function sicherung(ziel) {
  if (!ziel) throw new Error('ABBRUCH: Aufruf: --sicherung <zielordner>');
  const t0 = Date.now();
  const takt = () => ((Date.now() - t0) / 1000).toFixed(2) + 's';
  const PGPASS = geheim('NORNS_DB_PASSWORT', 8);
  mkdirSync(ziel, { recursive: true });

  const verbinde = async (p) => {
    const c = new pg.Client({
      host: '127.0.0.1', port: p, user: 'norns', password: PGPASS, database: DB,
      // ⚠️ Ohne Zeitgrenze haengt `connect()` gegen einen schweigenden
      // Zuhoerer, und der Rumpf liest den Ausgabestrom ohne Frist: der Knopf
      // in der Kasse kaeme nie zurueck.
      connectionTimeoutMillis: 5000,
      // Der Parser, der nichts parst: Werte bleiben die Textdarstellung des
      // Servers. Nur so ist die Rückreise verlustfrei.
      types: { getTypeParser: () => (w) => w },
    });
    await c.connect();
    return c;
  };

  let eigenes_pg = null;
  let db = null;
  const portdatei = join(DATENORT, 'pg-port');
  // ⚠️ AUSSERHALB des `try`. Stand die Deklaration innen, war die Zahl im
  // `catch` nicht sichtbar, und jeder Riegel, der sie dort braucht, stirbt an
  // einem ReferenceError — also genau dann, wenn er greifen soll.
  let port = null;
  if (existsSync(portdatei)) {
    try {
      port = Number(readFileSync(portdatei, 'utf8').trim());
      db = await verbinde(port);
      melde(`Sicherung gegen die laufende Kasse auf ${port}`);
    } catch (fehler) {
      // ⚠️ Zwei sehr verschiedene Gründe sehen hier gleich aus: ein
      // VERALTETER Eintrag (nichts hört zu → eigener Start folgt) und eine
      // LEBENDE Kasse, die das Kennwort abweist. Die zweite darf auf keinen
      // Fall im nächsten Schritt als „Waise" beendet werden — mitten im
      // Verkauf. Ein Kennwortfehler ist ein harter Halt, kein Rückfall.
      if (/password|Passwort|28P01|28000/i.test(String(fehler?.message ?? '') + (fehler?.code ?? ''))) {
        throw new Error(
          'ABBRUCH: Die laufende Kasse weist das Kennwort ab; die Sicherung wurde abgebrochen und NICHTS beendet.',
        );
      }
      // ⚠️ HIER STEHT ABSICHTLICH KEIN `throw`.
      //
      // Diese Portdatei ist KEIN Beweis. Sie wird beim Start geschrieben und
      // trägt eine Zahl aus dem Kurzzeitbereich; nach einem harten Ende kann
      // ein fremdes Programm des Benutzers darauf sitzen. Wer den Fehlschlag
      // hier zum Abbruch macht, verweigert dem Händler die Sicherung dauerhaft.
      //
      // Ob eine Kasse LÄUFT, beantwortet gleich `laeuftUnsereKasse()` aus der
      // `postmaster.pid`, und nur dessen Antwort zählt.
      db = null;
    }
  }
  if (!db) {
    if (!existsSync(join(PGORT, 'PG_VERSION'))) {
      throw new Error(`ABBRUCH: kein Datenbestand unter ${PGORT}; es gibt nichts zu sichern.`);
    }

    /**
     * ⛔ 08.08.2026 — DER RIEGEL, DER VORHER FEHLTE.
     *
     * Ohne ihn lief `waisenErloesen()` an dieser Stelle und schickte SIGKILL
     * an die Kennung aus der `postmaster.pid` — also an die laufende Kasse,
     * mitten im Verkauf. Es genügte, dass die Verbindung oben aus IRGENDEINEM
     * Grund ausser dem Kennwort scheiterte. Gemessen genügen dafür:
     *
     *     53300  sorry, too many clients already
     *     3D000  database "norns_pos" does not exist
     *
     * Die Kassiererin sah einen Abbruch mitten im Bezahlen, ausgelöst von der
     * einen Aufgabe, deren Zweck es ist, Daten zu SCHÜTZEN.
     *
     * ⚠️ Der Satz nennt BEIDE Auswege. Steht die Kasse und liegt nur eine
     * Waise herum, wäre „Schliessen Sie die Kasse" ein Rat ins Leere — sie ist
     * ja schon zu. Genau daran wäre der erste Entwurf gescheitert.
     */
    if (await laeuftUnsereKasse()) {
      throw new Error(
        'ABBRUCH: Auf dem Datenverzeichnis dieser Kasse läuft gerade ein Postgres. ' +
          'Die Sicherung hat es nicht gestartet und fasst es nicht an. ' +
          'Bitte die Kasse schliessen und erneut sichern. Ist die Kasse bereits ' +
          'geschlossen, einmal starten und wieder schliessen: der Start räumt ' +
          'einen liegengebliebenen Postgres selbst weg.',
      );
    }

    // Eine Waise aus einem harten Ende würde auch die Sicherung blocken.
    // Ab hier ist gemessen, dass KEINE Kasse läuft.
    await waisenErloesen();
    eigenes_pg = new EmbeddedPostgres({
      databaseDir: PGORT, user: 'norns', password: PGPASS,
      port: await freierPort(), persistent: true,
      // Dieselbe Regel wie beim Hauptstart: die Kodierung wird GESAGT. Dieser
      // Weg legt zwar nie neu an, aber eine Anlage ohne die Zeile waere die
      // eine Stelle, an der der Windows-Fehler zurueckkaeme.
      initdbFlags: ['--encoding=UTF8'],
    });
    await eigenes_pg.start();
    db = await verbinde(eigenes_pg.options.port);
    melde(`Kasse steht; eigenes Postgres für die Sicherung auf ${eigenes_pg.options.port}`);
  }

  /**
   * ⛔ IST DAS UEBERHAUPT UNSERE DATENBANK?
   *
   * Die Verbindung ist gelungen — das beweist nur, dass auf diesem Port ein
   * Postgres steht, das den Namen und das Kennwort annimmt. Sass ein fremdes
   * Postgres des Benutzers darauf, landete dessen Bestand als „Sicherung
   * dieses Ladens" im Zielordner, mit glaubwuerdigen Zahlen in der
   * Erfolgsmeldung. Ein Datentraeger, der die falschen Buecher traegt, ist
   * schlimmer als gar keiner.
   */
  {
    const [wo] = (await db.query('SHOW data_directory')).rows;
    const gemeldet = String(wo?.data_directory ?? '');
    if (gemeldet !== PGORT) {
      try { await db.end(); } catch { /* egal */ }
      throw new Error(
        `ABBRUCH: Auf diesem Port antwortet eine FREMDE Datenbank (${gemeldet || 'ohne Angabe'}), ` +
          `nicht die dieser Kasse (${PGORT}). Es wurde nichts gesichert und nichts angefasst.`,
      );
    }
  }

  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await db.query('SET search_path TO public');

    // ⚠️ 08.08.2026 — AUF DIE SEKUNDE, nicht auf die Minute.
    //
    // Mit `slice(0, 16)` trugen zwei Läufe innerhalb derselben Minute
    // DENSELBEN Dateinamen. `writeFileSync` kürzt die Datei des ersten, beide
    // melden am Ende `NORNS_SICHERUNG_FERTIG` mit Zahlen — der Händler sieht
    // zwei gelungene Sicherungen und hat eine halbe Datei.
    //
    // Die Sekunde allein reicht nicht als Riegel; der sitzt im Rumpf
    // (`sicherung.rs`, `LAEUFT`). Sie nimmt dem Zusammenstoss aber das
    // Zeitfenster von sechzig Sekunden.
    const stempel = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

    // ── GEPACKT, UND ZWAR IM STROM ──────────────────────────────────────
    //
    // Basels Auftrag vom 12.08.2026: die Sicherung soll gepackt weggelegt
    // werden. Eine Kassendatenbank besteht fast nur aus INSERT-Zeilen mit
    // wiederkehrenden Spaltennamen; das packt sich sehr gut.
    //
    // ⚠️ Durch einen STROM und nicht mit `gzipSync` am Ende. Sonst läge die
    // gesamte Sicherung noch einmal vollständig im Arbeitsspeicher, und der
    // Rechner, auf dem das zuerst weh tut, ist die schwache Ladenmaschine —
    // also genau die, für die dieses Programm gebaut ist.
    const datei = join(ziel, `norns-sicherung-${stempel}.sql.gz`);
    const packer = createGzip({ level: 9 });
    const aufDiePlatte = createWriteStream(datei);
    const fertigGeschrieben = finished(aufDiePlatte);
    packer.pipe(aufDiePlatte);
    // Gegendruck beachten: schreibt der Packer schneller, als die Platte
    // annimmt, wächst sonst still ein Puffer im Speicher.
    const schreibe = async (text) => {
      if (!packer.write(text)) await once(packer, 'drain');
    };

    await schreibe([
      `-- Norns POS, Sicherung vom ${new Date().toISOString()}`,
      `-- Diese Datei ist mit gzip gepackt. Auspacken: gunzip <datei>.`,
      `-- Wiederherstellung: frisches Datenverzeichnis, Rollen, erststart/schema.sql,`,
      `-- Nachzügler, dann diese Datei in einem Stück. KEINE Referenzsaat und KEINE`,
      `-- Genesis davor: beides steht bereits hier drin.`,
      `SET session_replication_role = replica;`,
      `SET search_path TO public;`,
      `BEGIN;`,
      ``,
    ].join('\n'));

    const { rows: tabellen } = await db.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
    const wert = (w) => (w === null
      ? 'NULL'
      : "E'" + String(w).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'");
    let zeilen = 0;
    let befuellt = 0;
    for (const { tablename: t } of tabellen) {
      // ⚠️ Zwei Spaltenarten vertragen kein schlichtes INSERT, und beide hat
      // dieses Schema wirklich: GENERATED-Spalten (feingewicht_grams) rechnet
      // der Server selbst, sie bleiben DRAUSSEN; GENERATED ALWAYS AS IDENTITY
      // nimmt Werte nur mit OVERRIDING SYSTEM VALUE an. Genau so macht es
      // auch pg_dump. Die erste Rückspiel-Probe scheiterte an Ersterem.
      const { rows: sp } = await db.query({
        text: `SELECT column_name, identity_generation
               FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = $1
                 AND is_generated = 'NEVER'
               ORDER BY ordinal_position`,
        values: [t], rowMode: 'array',
      });
      const spalten = sp.map((z) => `"${z[0]}"`).join(', ');
      const ueberschreiben = sp.some((z) => z[1] === 'ALWAYS') ? ' OVERRIDING SYSTEM VALUE' : '';
      // Eine Ladenkasse hält Tage, nicht Jahrzehnte; die Tabelle passt in den
      // Speicher. Sollte das je kippen, wird hier ein Cursor daraus.
      const r = await db.query({ text: `SELECT ${spalten} FROM "${t}"`, rowMode: 'array' });
      if (r.rows.length === 0) continue;
      const stuecke = [`-- ${t}: ${r.rows.length} Zeilen`];
      for (let i = 0; i < r.rows.length; i += 500) {
        stuecke.push(`INSERT INTO "${t}" (${spalten})${ueberschreiben} VALUES\n` +
          r.rows.slice(i, i + 500).map((z) => `(${z.map(wert).join(',')})`).join(',\n') + ';');
      }
      await schreibe(stuecke.join('\n') + '\n');
      zeilen += r.rows.length;
      befuellt += 1;
    }

    // Sequenzstände; ohne sie kollidiert die erste neue Zeile nach der
    // Wiederherstellung mit einer alten Nummer.
    const { rows: seq } = await db.query(
      `SELECT sequencename, last_value FROM pg_sequences
       WHERE schemaname = 'public' AND last_value IS NOT NULL`);
    if (seq.length > 0) {
      await schreibe(seq.map((s) =>
        `SELECT pg_catalog.setval('public."${s.sequencename}"', ${s.last_value}, true);`).join('\n') + '\n');
    }
    await schreibe('COMMIT;\nSET session_replication_role = DEFAULT;\n');
    await db.query('COMMIT');

    // ⚠️ ERST der Abschluss des Stroms, DANN die Erfolgsmeldung.
    //
    // Ein Packer hält immer noch etwas zurück, bis er `end()` sieht — der
    // letzte Block und die Prüfsumme stehen bis dahin im Speicher. Wer hier
    // meldet, ohne zu warten, meldet eine Sicherung, die es auf der Platte
    // noch nicht ganz gibt; zieht der Händler in dieser Sekunde den
    // USB-Stick, hat er eine abgeschnittene Datei und ein grünes Häkchen.
    // Bricht das Schreiben ab, wirft `fertigGeschrieben` — und dann darf
    // gerade KEIN Erfolg gemeldet werden.
    packer.end();
    await fertigGeschrieben;

    for (const ordner of ['fotos', 'kyc']) {
      if (existsSync(join(DATENORT, ordner))) {
        cpSync(join(DATENORT, ordner), join(ziel, ordner), { recursive: true });
      }
    }
    melde(`Sicherung geschrieben (${takt()})`);
    meldeBereit(`NORNS_SICHERUNG_FERTIG ${JSON.stringify(
      { datei, tabellen: befuellt, zeilen, sequenzen: seq.length })}\n`);
  } finally {
    try { await db.end(); } catch { /* schon zu */ }
    if (eigenes_pg) { try { await eigenes_pg.stop(); } catch { /* schon zu */ } }
  }
}

const sicherungAb = process.argv.indexOf('--sicherung');

/**
 * ⚠️ ZWEI AUFGABEN, ZWEI FEHLERPFADE — UND DAS IST DER KERN
 *
 * Bis zum 08.08.2026 hingen START und SICHERUNG an EINEM gemeinsamen
 * `.catch`, und darin stand die Notreinigung: PID aus `postmaster.pid`,
 * SIGKILL beziehungsweise `taskkill /F`.
 *
 * Für den START ist das richtig. Wer Postgres selbst hochgefahren hat und
 * dann scheitert, darf keine Waise zuruecklassen; sie haelt das
 * Datenverzeichnis, und der naechste Start findet es belegt.
 *
 * Fuer die SICHERUNG war es zerstoererisch. Sie verbindet sich mit dem
 * LAUFENDEN Postgres; in `postmaster.pid` steht dann die Kennung des
 * Prozesses, der gerade Verkaeufe bedient. Scheiterte die Sicherung — Platte
 * voll, Zielordner weg, Netzlaufwerk nicht da — schoss sie die Kasse mitten
 * im Verkauf ab. Mit SIGKILL, ohne sauberes Herunterfahren, ausgeloest von
 * der einen Aufgabe, deren ganzer Zweck der SCHUTZ der Daten ist.
 *
 * Die Regel, die beide Pfade jetzt trennt: nur wer einen Prozess GESTARTET
 * hat, darf ihn beenden.
 */

/** Die Notreinigung. NUR fuer den Start; sie beendet, was dieser Lauf hielt. */
async function raeumeVerwaistesPostgres() {
  try {
    const pidDatei = join(PGORT, 'postmaster.pid');
    if (!existsSync(pidDatei)) return;
    const pid = Number(readFileSync(pidDatei, 'utf8').split('\n')[0].trim());
    if (!Number.isInteger(pid) || pid <= 0) return;
    if (process.platform === 'win32') {
      const { execSync } = await import('node:child_process');
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch { /* schon weg, oder der Rumpf raeumt per Job-Objekt */ }
}

/** Der Grund einer Ablehnung, auch wenn sie keine `message` traegt. */
function grundVon(e) {
  // embedded-postgres weist auf Windows mit UNDEFINED zurueck, wenn Postgres
  // den Start verweigert. Ein Absturz IM Fehlerpfad war frueher die einzige
  // Meldung, die der Runner je sah.
  return e && e.message ? e.message : String(e ?? 'unbekannter Grund; siehe Zeilen darueber');
}

if (sicherungAb === -1) {
  // ── FEHLERPFAD DES STARTS ────────────────────────────────────────────
  // Dieser Lauf hat Postgres hochgefahren. Scheitert er, raeumt er auf.
  main().catch(async (e) => {
    melde(`ABBRUCH: ${grundVon(e)}`);
    await raeumeVerwaistesPostgres();
    process.exit(1);
  });
} else {
  // ── FEHLERPFAD DER SICHERUNG ─────────────────────────────────────────
  // ⚠️ HIER WIRD NICHTS BEENDET. Die Sicherung hat den laufenden Postgres
  // nicht gestartet; ihn abzuschiessen hiesse, einen Verkauf abzubrechen,
  // um eine Kopie zu retten, die ohnehin gescheitert ist.
  //
  // Ein eigenes Postgres, das die Sicherung selbst hochgefahren hat, haelt
  // sie in `eigenes_pg` und stoppt es in ihrem eigenen `finally` — sauber
  // und ohne die PID-Datei anzufassen.
  sicherung(process.argv[sicherungAb + 1]).catch((e) => {
    melde(`SICHERUNG GESCHEITERT: ${grundVon(e)}`);
    melde('Der laufende Postgres wurde NICHT angefasst. Die Kasse laeuft weiter.');
    process.exit(1);
  });
}

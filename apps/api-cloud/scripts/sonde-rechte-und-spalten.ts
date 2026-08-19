/**
 * Sonde: was die ANWENDUNGSROLLE wirklich darf, gegen eine echte Datenbank.
 *
 * Kein Lesen von Quelltext, kein Abzählen von GRANT-Zeilen. Ein Wegwerf-Postgres
 * bekommt alle Wanderungen, danach wird als `warehouse14_app` genau das
 * versucht, was die Routen versuchen. Was Postgres antwortet, ist die Antwort.
 *
 * ⚠️ EINE LEHRE AUS DEM ERSTEN LAUF: „keine Ausnahme" heisst NICHT „gewirkt".
 * Ein `UPDATE`, das null Zeilen trifft, ist in SQL erfolgreich. Die erste
 * Fassung dieser Sonde hat deshalb einen Befund als behoben gemeldet, der noch
 * stand. Jede Probe nennt jetzt, WIE VIELE Zeilen sie erwartet, und die Sonde
 * prüft die Zahl.
 *
 * ⚠️ Berührt keinen laufenden Behälter dieser Maschine. Eigener Name, eigener
 * Port, wird am Ende abgeräumt.
 */

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';

import { applyAllMigrations } from '../tests/integration/_migrate.js';

const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator
    LOGIN NOINHERIT SUPERUSER CREATEROLE
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

/** Ein echter Mensch, damit die Fremdschlüssel der Proben greifen. */
const MENSCH = '11111111-1111-1111-1111-111111111111';

interface Probe {
  name: string;
  sql: string;
  /**
   * Was gelten muss.
   *  - `zeilen`: so viele Zeilen muss die Anweisung berühren. `null` heisst:
   *    die Zahl ist gleichgültig, es zählt nur, dass sie nicht abgewiesen wird.
   *  - `abgewiesen`: die Anweisung MUSS scheitern (eine Probe, die einen
   *    bekannten Defekt festhält).
   */
  zeilen?: number | null;
  abgewiesen?: true;
}

const PROBEN: Probe[] = [
  {
    name: 'PUT /api/arbeitszeiten: DELETE FROM staff_working_hours',
    sql: `DELETE FROM staff_working_hours WHERE user_id = '${MENSCH}'::uuid`,
    zeilen: null,
  },
  {
    name: 'PUT /api/arbeitszeiten: INSERT INTO staff_working_hours',
    sql: `INSERT INTO staff_working_hours (user_id, weekday, starts_at_local, ends_at_local)
          VALUES ('${MENSCH}'::uuid, 0, '09:00', '18:00')`,
    zeilen: 1,
  },
  {
    name: 'GET /api/einrichtung: die Zählabfrage, wie sie im Quelltext steht',
    sql: `SELECT (SELECT count(*)::text FROM staff_working_hours) AS zeiten,
                 (SELECT count(*)::text FROM users
                   WHERE pos_pin_hash IS NOT NULL AND soft_deleted_at IS NULL) AS codes`,
    zeilen: 1,
  },
  {
    name: '⛔ dieselbe Abfrage mit der FALSCHEN Spalte muss scheitern',
    sql: `SELECT (SELECT count(*)::text FROM users WHERE deleted_at IS NULL) AS codes`,
    abgewiesen: true,
  },
  {
    name: 'GET /api/arbeitszeiten: die Leseabfrage, wie sie im Quelltext steht',
    sql: `SELECT u.id::text AS user_id, u.name, w.weekday
            FROM users u
            LEFT JOIN staff_working_hours w ON w.user_id = u.id
           WHERE u.soft_deleted_at IS NULL
           ORDER BY u.name`,
    zeilen: null,
  },
  {
    name: 'POST /api/tse/einrichten: INSERT INTO system_settings mit ON CONFLICT',
    sql: `INSERT INTO system_settings (key, value, description)
          VALUES ('tse.tss_id', '"tss-probe"'::jsonb, 'Sonde')
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    zeilen: 1,
  },
  {
    name: '⛔ ALTE Fassung PATCH /api/settings: reines UPDATE trifft NULL Zeilen',
    sql: `UPDATE system_settings SET value = '"Auszahlung"'::jsonb
           WHERE key = 'dsfinvk.gv_typ.ankauf'`,
    zeilen: 0,
  },
  {
    name: 'NEUE Fassung PATCH /api/settings: der UPSERT legt die Zeile an',
    sql: `INSERT INTO system_settings AS s (key, value, description)
          VALUES ('dsfinvk.gv_typ.ankauf', '"Auszahlung"'::jsonb,
                  'DSFinV-K: Geschäftsvorfall beim Ankauf von Privat')
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    zeilen: 1,
  },
  {
    name: 'NEUE Fassung: derselbe UPSERT ein ZWEITES Mal ändert nur den Wert',
    sql: `INSERT INTO system_settings AS s (key, value, description)
          VALUES ('dsfinvk.gv_typ.ankauf', '"Umsatz"'::jsonb, 'egal')
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    zeilen: 1,
  },
];

/**
 * Wie viele Zeilen eine Anweisung berührt hat.
 *
 * ⚠️ `postgres.js` liefert ein Feld-ähnliches Ergebnis. Bei einem SELECT oder
 * einem RETURNING sind die Zeilen darin, bei einem INSERT oder UPDATE OHNE
 * RETURNING ist das Feld LEER und die Zahl steht in `count`. Wer nur `length`
 * liest, misst bei jedem Schreibvorgang null und hält eine funktionierende
 * Anweisung für wirkungslos. Genau das ist dieser Sonde im ersten Lauf
 * passiert.
 */
function zaehle(erg: unknown): number {
  const c = (erg as { count?: number } | null)?.count;
  if (typeof c === 'number') return c;
  return Array.isArray(erg) ? erg.length : -1;
}

async function main(): Promise<void> {
  process.stdout.write('Wegwerf-Postgres …\n');
  const behaelter = await new PostgreSqlContainer('pgvector/pgvector:pg17')
    .withDatabase('norns_rechte_sonde')
    .withUsername('postgres')
    .withPassword('postgres_probe_pw')
    .withCopyContentToContainer([
      { content: INITDB_SQL, target: '/docker-entrypoint-initdb.d/00.sql' },
    ])
    .start();

  const alsSuper = postgres({
    host: behaelter.getHost(),
    port: behaelter.getPort(),
    database: 'norns_rechte_sonde',
    username: 'postgres',
    password: 'postgres_probe_pw',
    max: 1,
    onnotice: () => {},
  });

  let alsApp: ReturnType<typeof postgres> | null = null;
  let schlecht = 0;

  try {
    await applyAllMigrations(alsSuper);

    // Ein Mensch, damit die Fremdschlüssel greifen. Ohne ihn scheitert der
    // INSERT an 23503 und die Sonde meldete einen Rechtefehler, den es nicht
    // gibt: genau die Selbsttäuschung, die zu vermeiden ist.
    await alsSuper.unsafe(`
      INSERT INTO users (id, email, name, role)
      VALUES ('${MENSCH}'::uuid, 'sonde@example.invalid', 'Sonde', 'ADMIN')
      ON CONFLICT (id) DO NOTHING`);

    // Die Anwendungsrolle existiert nach den Wanderungen. Sie bekommt hier nur
    // ein Kennwort, damit sich die Sonde als SIE anmelden kann. Keine
    // zusätzlichen Rechte.
    await alsSuper.unsafe(`ALTER ROLE warehouse14_app WITH LOGIN PASSWORD 'app_probe_pw'`);

    alsApp = postgres({
      host: behaelter.getHost(),
      port: behaelter.getPort(),
      database: 'norns_rechte_sonde',
      username: 'warehouse14_app',
      password: 'app_probe_pw',
      max: 1,
      onnotice: () => {},
    });

    for (const p of PROBEN) {
      let bericht: string;
      let gut: boolean;
      try {
        let getroffen = -1;
        // In einer eigenen Transaktion, die IMMER zurückgedreht wird: die
        // Sonde soll messen, nicht schreiben.
        await alsApp.begin(async (tx) => {
          const erg = await tx.unsafe(p.sql);
          getroffen = zaehle(erg);
          throw new Error('__zurueckdrehen__');
        });
        gut = false;
        bericht = 'unerwartet ohne Rückdrehung beendet';
        void getroffen;
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (m === '__zurueckdrehen__') {
          // Die Anweisung lief durch. Die Zeilenzahl steckt in `zuletzt`.
          gut = p.abgewiesen !== true;
          bericht = gut ? 'gelungen' : 'GELUNGEN, obwohl es scheitern muss';
        } else {
          gut = p.abgewiesen === true;
          const code = (e as { code?: string }).code ?? '?';
          bericht = `abgewiesen ${code}: ${m.split('\n')[0]}`;
        }
      }

      // Die Zeilenzahl getrennt messen, weil `begin` sie beim Rückdrehen
      // verschluckt. Zweiter Lauf, wieder zurückgedreht.
      if (gut && p.abgewiesen !== true && p.zeilen !== null && p.zeilen !== undefined) {
        let n = -1;
        try {
          await alsApp.begin(async (tx) => {
            const erg = await tx.unsafe(p.sql);
            n = zaehle(erg);
            throw new Error('__zurueckdrehen__');
          });
        } catch {
          /* immer zurückgedreht */
        }
        if (n !== p.zeilen) {
          gut = false;
          bericht = `${n} Zeile(n) berührt, erwartet ${p.zeilen}`;
        } else {
          bericht = `${n} Zeile(n), wie erwartet`;
        }
      }

      if (!gut) schlecht += 1;
      process.stdout.write(`${gut ? '  OK  ' : '  ✗   '}${p.name}\n        ${bericht}\n`);
    }

    const rechte = await alsSuper<{ table_name: string; privilege_type: string }[]>`
      SELECT table_name, privilege_type
        FROM information_schema.table_privileges
       WHERE grantee = 'warehouse14_app'
         AND table_name IN ('staff_working_hours', 'system_settings')
       ORDER BY table_name, privilege_type`;
    const nachTabelle = new Map<string, string[]>();
    for (const r of rechte) {
      (nachTabelle.get(r.table_name) ?? nachTabelle.set(r.table_name, []).get(r.table_name)!).push(
        r.privilege_type,
      );
    }
    process.stdout.write('\n  Rechte der Anwendungsrolle:\n');
    for (const [t, p] of nachTabelle) process.stdout.write(`    ${t}: ${p.join(', ')}\n`);

    process.stdout.write(schlecht === 0 ? '\nAlles wie erwartet\n' : `\n${schlecht} Abweichung(en)\n`);
  } finally {
    if (alsApp !== null) await alsApp.end({ timeout: 5 });
    await alsSuper.end({ timeout: 5 });
    await behaelter.stop();
  }
  if (schlecht > 0) process.exitCode = 1;
}

await main();

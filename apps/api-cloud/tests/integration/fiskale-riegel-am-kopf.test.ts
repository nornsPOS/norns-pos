/**
 * ════════════════════════════════════════════════════════════════════════
 *  DIE FISKALEN RIEGEL, GEMESSEN AM HEUTIGEN STAND
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 13.08.2026 ──────────────────────────────────────────────
 *
 * `packages/db` hat 42 Pruefdateien, die in KEINEM Tor laufen:
 *
 *   · das Testskript des Pakets schliesst `tests/audit`, `tests/inventory-lock`
 *     und `tests/migrations` ausdruecklich aus,
 *   · das einzige Fliessband, das sie fuehre (`db-suites.yml`), hat keinen
 *     push-Ausloeser und ist in diesem Baum NIE gelaufen,
 *   · und sein Schritt traegt `continue-on-error: true`, kann also gar nicht
 *     rot werden.
 *
 * Gefahren ergeben sie 17 rote Dateien und 96 rote Tests. Fuenf Agenten haben
 * jede einzelne eingeordnet und ein Skeptiker jede Behauptung angegriffen:
 * KEIN echter Defekt. Die Wurzel ist bei allen dieselbe, und sie ist
 * lehrreich: diese Tests frieren die Datenbank per `applyMigrations(sql, 9)`
 * bei Wanderung 9 ein und fahren sie mit Code vom KOPF des Baumes an. Sie
 * messen ein Schema, das es seit den Wanderungen 0045, 0055, 0067 und 0118
 * nicht mehr gibt.
 *
 * ── WARUM ES DIESE DATEI TROTZDEM GIBT ─────────────────────────────────────
 *
 * Weil dabei etwas Echtes sichtbar wurde: die fiskal TRAGENDEN Riegel
 * (kein Loeschen, keine Geldspalte aenderbar, die Bilanz muss stimmen) wurden
 * bisher NUR in diesem eingefrorenen Museum gemessen. Fuer den HEUTIGEN Stand
 * gab es keine Messung. Ein Riegel, den nur ein Museum prueft, ist ein
 * Riegel, dessen Verschwinden niemand bemerkt.
 *
 * Diese Datei liegt in `tests/integration`, also faehrt sie im Fiskaltor auf
 * JEDEN Push (`.github/workflows/fiskal-gate.yml` weckt auf
 * `apps/api-cloud/tests/integration/**`), gegen ein echtes Postgres, nach dem
 * Anwenden ALLER Wanderungen.
 *
 * ── SIE MISST DAS VERHALTEN, NICHT DEN NAMEN ───────────────────────────────
 *
 * ⚠️ Das ist der Kern und die zweite Lehre des Tages. Ein Waechter, der auf
 * einen Bedingungsnamen prueft (`transactions_balance_equation`), wird gruen,
 * sobald jemand die Bedingung umbenennt, und ROT, sobald jemand sie
 * gleichwertig umschreibt. Genau daran sind die alten Tests reihenweise
 * gestorben: sie verlangten `users_preferred_language_chk`, waehrend Postgres
 * den Riegel selbst `..._check` genannt hatte. Der Riegel griff, der Test log.
 *
 * Deshalb klopft diese Datei an, statt den Bauplan zu lesen: sie versucht das
 * Verbotene als die Anwendungsrolle SELBST und verlangt eine Abweisung.
 */

import { randomUUID } from 'node:crypto';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyAllMigrations } from './_migrate.js';

const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator LOGIN NOINHERIT SUPERUSER CREATEROLE
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

/**
 * Die Tabellen, aus denen NICHTS verschwinden darf.
 *
 * § 146a Abs. 1 AO: eine Aufzeichnung muss unveraenderbar sein, und eine
 * geloeschte Zeile ist die vollstaendigste aller Aenderungen. Ein Loeschrecht
 * hier waere kein Schoenheitsfehler, sondern das Ende der Beweiskraft.
 */
const UNLOESCHBAR = ['transactions', 'transaction_items', 'transaction_payments'] as const;

/**
 * Die Spalten von `transactions`, an denen sich der Betrag oder die Art des
 * Vorgangs entscheidet. Wer eine davon nachtraeglich aendern kann, kann einen
 * abgeschlossenen Beleg zu einem anderen machen, ohne dass es auffaellt.
 */
const UNVERAENDERLICH = [
  'total_eur',
  'subtotal_eur',
  'vat_eur',
  'tax_treatment_code',
  'direction',
  'storno_of_transaction_id',
] as const;

describe('⛔ Die fiskalen Riegel stehen am HEUTIGEN Stand, nicht nur bei Wanderung 9', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;

  let geraetId: string;
  let kassiererId: string;
  let produktId: string;
  let belegId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
      .withDatabase('warehouse14_test')
      .withUsername('postgres')
      .withPassword('postgres_test_pw')
      .withCopyContentToContainer([
        { content: INITDB_SQL, target: '/docker-entrypoint-initdb.d/00.sql' },
      ])
      .start();

    migratorSql = postgres({
      host: container.getHost(),
      port: container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_migrator',
      password: 'warehouse14_migrator_test_pw',
      max: 1,
      onnotice: () => {},
    });

    // ⚠️ ALLE Wanderungen, nicht bis zu einer Nummer. Genau das ist der
    // Unterschied zu den Museumstests.
    await applyAllMigrations(migratorSql);
    await migratorSql.unsafe(`ALTER ROLE warehouse14_app PASSWORD 'warehouse14_app_test_pw'`);

    appSql = postgres({
      host: container.getHost(),
      port: container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_app',
      password: 'warehouse14_app_test_pw',
      max: 1,
      onnotice: () => {},
    });

    // Saat als Migrator: ein Geraet, ein Kassierer, ein Stueck, ein fertiger
    // Beleg. Der Beleg entsteht VOLLSTAENDIG in einer Transaktion, weil der
    // Bilanzwaechter DEFERRABLE ist und erst beim COMMIT zuschlaegt.
    const [inhaber] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role, is_owner)
      VALUES (${`riegel-owner-${randomUUID()}@x.test`}, 'Riegelprobe', 'ADMIN'::user_role, TRUE)
      RETURNING id`;

    const [kassierer] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`riegel-cash-${randomUUID()}@x.test`}, 'Riegelprobe', 'CASHIER'::user_role)
      RETURNING id`;
    kassiererId = kassierer!.id;

    const [geraet] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${randomUUID().replace(/-/g, '')},
              now() - interval '1 day', now() + interval '365 days', ${inhaber!.id})
      RETURNING id`;
    geraetId = geraet!.id;

    const [produkt] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, name, published_at)
      VALUES (${`RIEGEL-${randomUUID()}`}, 'AVAILABLE'::product_status, 'STANDARD_19',
              'gold_jewelry'::item_type, '10.00', '100.00', 'Riegelprobe', now())
      RETURNING id`;
    produktId = produkt!.id;

    belegId = await migratorSql.begin(async (tx) => {
      const [kopf] = await tx<{ id: string }[]>`
        INSERT INTO transactions (direction, device_id, cashier_user_id,
                                  subtotal_eur, vat_eur, total_eur, tax_treatment_code)
        VALUES ('VERKAUF'::transaction_direction, ${geraetId}, ${kassiererId},
                '84.03', '15.97', '100.00', 'STANDARD_19')
        RETURNING id`;
      await tx`
        INSERT INTO transaction_items (transaction_id, product_id,
                                       line_subtotal_eur, line_vat_eur, line_total_eur,
                                       applied_tax_treatment_code, applied_vat_rate, display_order)
        VALUES (${kopf!.id}, ${produktId}, '84.03', '15.97', '100.00',
                'STANDARD_19', '0.1900', 1)`;
      await tx`
        INSERT INTO transaction_payments (transaction_id, payment_method, amount_eur)
        VALUES (${kopf!.id}, 'CASH'::payment_method, '100.00')`;
      return kopf!.id;
    });
  }, 300_000);

  afterAll(async () => {
    await appSql?.end({ timeout: 5 });
    await migratorSql?.end({ timeout: 5 });
    await container?.stop();
  });

  it('die Saat steht (sonst misst alles Weitere ins Leere)', () => {
    // „null ist nicht gruen": ohne einen echten Beleg waeren alle
    // Abweisungen unten trivial erfuellt.
    expect(belegId, 'kein Beleg angelegt').toBeTruthy();
  });

  describe('⛔ Aus einem Beleg verschwindet nichts', () => {
    it.each(UNLOESCHBAR)('die Anwendungsrolle hat kein DELETE auf %s', async (tabelle) => {
      const [r] = await appSql<{ darf: boolean }[]>`
        SELECT has_table_privilege('warehouse14_app', ${tabelle}, 'DELETE') AS darf`;
      expect(
        r!.darf,
        `Die Anwendungsrolle darf aus \`${tabelle}\` loeschen. Nach § 146a ` +
          'Abs. 1 AO muss eine Aufzeichnung unveraenderbar sein, und eine ' +
          'geloeschte Zeile ist die vollstaendigste aller Aenderungen. Eine ' +
          'Wanderung hat dieses Recht vergeben, oder ein `GRANT ALL` hat es ' +
          'nebenbei mitgenommen.',
      ).toBe(false);
    });

    it('⛔ und ein echter Loeschversuch wird abgewiesen, nicht bloss der Katalog', async () => {
      // Angeklopft statt den Bauplan gelesen: ein Recht kann auf Umwegen
      // entstehen (Rollenvererbung), und dann sagt der Katalogeintrag der
      // Rolle selbst nicht die ganze Wahrheit.
      let fehler: unknown;
      try {
        await appSql`DELETE FROM transactions WHERE id = ${belegId}`;
      } catch (e) {
        fehler = e;
      }
      expect(fehler, 'Der Loeschversuch ging DURCH. Der Beleg ist weg.').toBeDefined();
      expect(
        (fehler as { code?: string }).code,
        'Abgewiesen wurde er, aber nicht wegen fehlenden Rechts (42501). ' +
          'Dann haengt die Unloeschbarkeit an etwas anderem als am Recht, ' +
          'zum Beispiel an einem Fremdschluessel, und der kann wegfallen.',
      ).toBe('42501');

      const [zeile_da] = await migratorSql<{ da: number }[]>`
        SELECT COUNT(*)::int AS da FROM transactions WHERE id = ${belegId}`;
      // Eine Zaehlabfrage liefert immer genau eine Zeile. Fehlt sie, ist die
      // Abfrage kaputt, und das ist ein Fehler DIESER Pruefung, keine Aussage
      // ueber den Pruefling.
      if (!zeile_da) throw new Error("Die Abfrage lieferte keine Zeile.");
      const { da } = zeile_da;
      expect(da, 'Der Beleg ist trotz Abweisung verschwunden.').toBe(1);
    });
  });

  describe('⛔ Der Betrag eines Belegs bleibt, was er war', () => {
    it.each(UNVERAENDERLICH)('%s ist fuer die Anwendungsrolle nicht aenderbar', async (spalte) => {
      const [r] = await appSql<{ darf: boolean }[]>`
        SELECT has_column_privilege('warehouse14_app', 'transactions', ${spalte}, 'UPDATE') AS darf`;
      expect(
        r!.darf,
        `\`transactions.${spalte}\` ist fuer die Anwendungsrolle aenderbar. ` +
          'Damit laesst sich ein abgeschlossener Beleg nachtraeglich zu einem ' +
          'anderen machen. Ein Storno ist der vorgesehene Weg, und er legt ' +
          'eine NEUE Zeile an, statt die alte umzuschreiben.',
      ).toBe(false);
    });

    it('⛔ und ein echter Schreibversuch auf den Betrag wird abgewiesen', async () => {
      let fehler: unknown;
      try {
        await appSql`UPDATE transactions SET total_eur = '1.00' WHERE id = ${belegId}`;
      } catch (e) {
        fehler = e;
      }
      expect(fehler, 'Der Betrag liess sich ueberschreiben.').toBeDefined();
      expect((fehler as { code?: string }).code).toBe('42501');

      const [r] = await migratorSql<{ total_eur: string }[]>`
        SELECT total_eur FROM transactions WHERE id = ${belegId}`;
      expect(r!.total_eur, 'Der Betrag hat sich trotz Abweisung geaendert.').toBe('100.00');
    });
  });

  describe('⛔ Die Bilanz eines Belegs muss aufgehen', () => {
    it('ein Beleg, dessen Zahlungen nicht zur Summe passen, kommt nicht durch den COMMIT', async () => {
      // ⚠️ Gemessen wird als MIGRATOR, also mit allen Rechten. Wenn selbst
      // die maechtigste Rolle das nicht schreiben kann, haengt der Riegel an
      // der Datenbank und nicht an einer Rechtevergabe, die jemand aendern
      // koennte.
      //
      // ⚠️ Und er muss beim COMMIT scheitern, nicht beim INSERT: der Waechter
      // aus Wanderung 0016 ist DEFERRABLE. Ein Test, der nur den INSERT
      // ansieht, bekommt sein RETURNING und haelt den Riegel fuer weg.
      let fehler: unknown;
      try {
        await migratorSql.begin(async (tx) => {
          const [kopf] = await tx<{ id: string }[]>`
            INSERT INTO transactions (direction, device_id, cashier_user_id,
                                      subtotal_eur, vat_eur, total_eur, tax_treatment_code)
            VALUES ('VERKAUF'::transaction_direction, ${geraetId}, ${kassiererId},
                    '84.03', '15.97', '100.00', 'STANDARD_19')
            RETURNING id`;
          await tx`
            INSERT INTO transaction_items (transaction_id, product_id,
                                           line_subtotal_eur, line_vat_eur, line_total_eur,
                                           applied_tax_treatment_code, applied_vat_rate, display_order)
            VALUES (${kopf!.id}, ${produktId}, '84.03', '15.97', '100.00',
                    'STANDARD_19', '0.1900', 1)`;
          // Die Luege: bezahlt wurde angeblich ein Euro, der Beleg lautet
          // auf hundert.
          await tx`
            INSERT INTO transaction_payments (transaction_id, payment_method, amount_eur)
            VALUES (${kopf!.id}, 'CASH'::payment_method, '1.00')`;
        });
      } catch (e) {
        fehler = e;
      }
      expect(
        fehler,
        'Ein Beleg ueber 100,00 EUR mit einer Zahlung von 1,00 EUR wurde ' +
          'angenommen. Dann kann die Kasse eine Summe ausweisen, die nie ' +
          'geflossen ist, und der Kassenbericht rechnet mit einer Zahl, die ' +
          'es nicht gibt.',
      ).toBeDefined();
    });
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════
 *  Die Belegnummer verliert ihr stilles Schreibrecht (Befund 10, 11.08.2026)
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND ──────────────────────────────────────────────────────────
 *
 * Wanderung 0009 vergab der Anwendungsrolle `warehouse14_app` ein
 * spaltenweises UPDATE auf `transactions.receipt_locator`, mit dem Kommentar
 * „TSE may rewrite if Fiskaly assigns". Dieser Umschreiber wurde nie gebaut:
 * KEIN Aufrufer im Haus schreibt die Spalte (gemessen über `apps/api-cloud/src`
 * und `apps/worker/src`; `shipping.ts` schreibt andere Spalten).
 *
 * Die Belegnummer ist die EINZIGE fiskalisch tragende Spalte mit einem
 * Schreibrecht: `total_eur`, `finalized_at` und die übrigen tragen nur INSERT
 * und SELECT. Kein Auslöser zeichnet eine Änderung an ihr auf. Nach § 146
 * Abs. 4 AO muss eine Änderung feststellbar bleiben — ein stehendes Recht
 * ohne Spur ist kein Riegel, sondern eine Beobachtung, die darauf wartet,
 * dass jemand sie benutzt.
 *
 * ── WARUM DER NAHELIEGENDE WEG FALSCH WÄRE ─────────────────────────────
 *
 * Ein `REVOKE UPDATE ON transactions` auf TABELLENEBENE würde auch die
 * spaltenweisen Rechte aus 0009, 0018 und 0019 mitreissen (printed_at,
 * Versandspalten, GwG-Markierungen, shift_id) — die Kasse könnte keinen
 * Beleg mehr als gedruckt markieren. Der Eingriff (Wanderung 0135) entzieht
 * deshalb GENAU EINE Spalte, und dieser Wächter misst BEIDES: das entzogene
 * Recht UND dass jede Nachbarspalte ihres behält.
 *
 * ── WAS DIESER WÄCHTER MISST ────────────────────────────────────────────
 *
 * Gegen ein echtes Postgres, nach Anwenden ALLER Wanderungen, als die
 * Anwendungsrolle selbst (kein Blick in den Bauplan, ein echtes Anklopfen):
 *
 *   1. UPDATE auf `receipt_locator` ist ENTZOGEN (Katalog UND echter Versuch,
 *      der mit 42501 abgewiesen wird).
 *   2. Jede andere UPDATE-Spalte der Tabelle bleibt nutzbar (Katalog und ein
 *      echter Schreibversuch auf `printed_at`).
 *   3. Das ANLEGEN stirbt nicht: ein INSERT über die Vorgabe (Sequenz) und
 *      ein INSERT mit ausdrücklicher Belegnummer funktionieren weiter.
 *
 * ⚠️ Jeder Beleg entsteht hier VOLLSTÄNDIG (Kopf + Position + Zahlung) in
 * EINER Datenbanktransaktion. Der DEFERRABLE-Wächter aus Wanderung 0016
 * prüft die Bilanz erst beim COMMIT — ein nackter Kopf-INSERT liefert sein
 * RETURNING und die Zeile verschwindet danach lautlos. Der erste Entwurf
 * dieses Tests ist genau daran gescheitert.
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
 * Die Spalten von `transactions`, die der Anwendungsrolle nach 0135 noch per
 * UPDATE gehören. Abgelesen aus den Vergaben in 0009 (Umschlag), 0018
 * (Versand) und 0019 (GwG + Beleg-Zustellung + Schicht) — receipt_locator
 * fehlt hier mit Absicht: genau das misst dieser Wächter.
 */
const BLEIBENDE_UPDATE_SPALTEN = [
  'printed_at',
  'notes_internal',
  'updated_at',
  'shipping_status',
  'shipping_carrier',
  'tracking_number',
  'suspicious_aml_flag',
  'suspicious_aml_reason',
  'suspicious_flagged_by_user_id',
  'receipt_declined_at',
  'receipt_emailed_at',
  'returned_at',
  'shift_id',
] as const;

describe('transactions.receipt_locator — das Schreibrecht ist entzogen, die Nachbarn leben', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;

  /** Ein fertiger Beleg, als Migrator gesät, an dem die App-Rolle anklopft. */
  let belegId: string;
  let geraetId: string;
  let kassiererId: string;
  let produktId: string;

  /**
   * Ein VOLLSTÄNDIGER Beleg (Kopf + Position + Zahlung) in einer
   * Transaktion, über die angegebene Verbindung — also wahlweise als
   * Migrator (Saat) oder als Anwendungsrolle (die eigentliche Messung).
   */
  async function legeBelegAn(
    verbindung: Sql,
    kennung?: string,
  ): Promise<{ id: string; receipt_locator: string }> {
    return verbindung.begin(async (tx) => {
      const [kopf] =
        kennung === undefined
          ? await tx<{ id: string; receipt_locator: string }[]>`
              INSERT INTO transactions (direction, device_id, cashier_user_id,
                                        subtotal_eur, vat_eur, total_eur, tax_treatment_code)
              VALUES ('VERKAUF'::transaction_direction, ${geraetId}, ${kassiererId},
                      '84.03', '15.97', '100.00', 'STANDARD_19')
              RETURNING id, receipt_locator`
          : await tx<{ id: string; receipt_locator: string }[]>`
              INSERT INTO transactions (direction, device_id, cashier_user_id,
                                        subtotal_eur, vat_eur, total_eur, tax_treatment_code,
                                        receipt_locator)
              VALUES ('VERKAUF'::transaction_direction, ${geraetId}, ${kassiererId},
                      '84.03', '15.97', '100.00', 'STANDARD_19', ${kennung})
              RETURNING id, receipt_locator`;
      await tx`
        INSERT INTO transaction_items (transaction_id, product_id,
                                       line_subtotal_eur, line_vat_eur, line_total_eur,
                                       applied_tax_treatment_code, applied_vat_rate, display_order)
        VALUES (${kopf!.id}, ${produktId}, '84.03', '15.97', '100.00',
                'STANDARD_19', '0.1900', 1)`;
      await tx`
        INSERT INTO transaction_payments (transaction_id, payment_method, amount_eur)
        VALUES (${kopf!.id}, 'CASH'::payment_method, '100.00')`;
      return kopf!;
    });
  }

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
    await applyAllMigrations(migratorSql);
    await migratorSql.unsafe(`ALTER ROLE warehouse14_app PASSWORD 'warehouse14_app_test_pw'`);

    appSql = postgres({
      host: container.getHost(),
      port: container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_app',
      password: 'warehouse14_app_test_pw',
      max: 2,
      onnotice: () => {},
    });

    // ── Die Akteure, die ein Beleg per Fremdschlüssel verlangt ──────────
    const [inhaber] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role, is_owner)
      VALUES (${`owner-${randomUUID()}@x.test`}, 'Owner', 'ADMIN'::user_role, TRUE)
      RETURNING id`;
    const [kassierer] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`cash-${randomUUID()}@x.test`}, 'Cashier', 'CASHIER'::user_role)
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
      VALUES (${`SKU-${randomUUID()}`}, 'AVAILABLE'::product_status, 'STANDARD_19',
              'gold_jewelry'::item_type, '10.00', '100.00', 'Pruefposten', now())
      RETURNING id`;
    produktId = produkt!.id;

    const beleg = await legeBelegAn(migratorSql);
    belegId = beleg.id;
  }, 180_000);

  afterAll(async () => {
    await appSql?.end({ timeout: 5 }).catch(() => {});
    await migratorSql?.end({ timeout: 5 }).catch(() => {});
    await container?.stop().catch(() => {});
  });

  it('⛔ der Katalog kennt KEIN UPDATE-Recht der Anwendungsrolle auf receipt_locator', async () => {
    const [zeile] = await migratorSql<{ darf: boolean }[]>`
      SELECT has_column_privilege('warehouse14_app', 'public.transactions',
                                  'receipt_locator', 'UPDATE') AS darf`;
    expect(
      zeile!.darf,
      'warehouse14_app traegt ein stehendes UPDATE-Recht auf transactions.receipt_locator. ' +
        'Kein Aufrufer nutzt es, kein Ausloeser zeichnet eine Aenderung auf — nach ' +
        'Paragraf 146 Abs. 4 AO muss es weg (Wanderung 0135).',
    ).toBe(false);
  });

  it('⛔ ein ECHTER Umschreibeversuch der Belegnummer wird mit 42501 abgewiesen', async () => {
    // Kein Blick in den Bauplan: die Rolle klopft selbst an.
    let fehlerCode: string | undefined;
    try {
      await appSql`
        UPDATE transactions SET receipt_locator = 'RCP-0000-000000' WHERE id = ${belegId}`;
    } catch (e) {
      fehlerCode = (e as { code?: string }).code;
    }
    expect(
      fehlerCode,
      'Die Anwendungsrolle konnte die Belegnummer eines fertigen Belegs umschreiben. ' +
        'Erwartet war permission denied (42501).',
    ).toBe('42501');

    const [nachher] = await migratorSql<{ receipt_locator: string }[]>`
      SELECT receipt_locator FROM transactions WHERE id = ${belegId}`;
    expect(nachher!.receipt_locator).not.toBe('RCP-0000-000000');
  });

  it('jede NACHBARSPALTE behaelt ihr UPDATE-Recht (die Spaltenrechte-Falle)', async () => {
    // Ein REVOKE auf Tabellenebene haette sie alle mitgerissen. Gemessen wird
    // jede einzeln, damit der Fehlertext die getroffene Spalte nennt.
    for (const spalte of BLEIBENDE_UPDATE_SPALTEN) {
      const [zeile] = await migratorSql<{ darf: boolean }[]>`
        SELECT has_column_privilege('warehouse14_app', 'public.transactions',
                                    ${spalte}, 'UPDATE') AS darf`;
      expect(
        zeile!.darf,
        `transactions.${spalte} hat ihr UPDATE-Recht verloren — der Entzug der ` +
          'Belegnummer hat mehr getroffen als die eine Spalte.',
      ).toBe(true);
    }
  });

  it('ein echter Schreibvorgang auf printed_at funktioniert weiter', async () => {
    await appSql`UPDATE transactions SET printed_at = now() WHERE id = ${belegId}`;
    const [zeile] = await migratorSql<{ printed_at: string | null }[]>`
      SELECT printed_at FROM transactions WHERE id = ${belegId}`;
    expect(zeile!.printed_at).not.toBeNull();
  });

  it('das ANLEGEN stirbt nicht: die App legt einen Beleg an, die Vorgabe vergibt die Nummer', async () => {
    const neu = await legeBelegAn(appSql);
    expect(neu.receipt_locator).toMatch(/^RCP-\d{4}-\d{6}$/);
    // Und zwar DAUERHAFT: der COMMIT hat den 0016-Waechter ueberlebt.
    const [zeile] = await migratorSql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM transactions WHERE id = ${neu.id}`;
    expect(zeile!.n).toBe(1);
  });

  it('das ANLEGEN stirbt nicht: die App darf die Belegnummer BEIM Anlegen ausdruecklich setzen', async () => {
    // Der Weg, den der 0009-Kommentar meinte: eine von aussen vergebene
    // Kennung gehoert an den Beleg BEIM Anlegen, nicht per Umschreiben danach.
    const kennung = `RCP-TEST-${randomUUID().slice(0, 6)}`;
    const neu = await legeBelegAn(appSql, kennung);
    expect(neu.receipt_locator).toBe(kennung);
  });
});

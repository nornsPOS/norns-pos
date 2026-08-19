/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Die Fiskal-Buehne — ein echtes Postgres, alle Wanderungen, die echte App
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Herausgeloest am 26.07.2026 aus `tests/integration/fiscal-export.test.ts`
 * (1368 Zeilen), damit die kommenden Szenariendateien das Aufsetzen nicht
 * jedes Mal neu erfinden. Wer eine Szenariendatei schreibt, braucht davon
 * nichts zu wissen — er ruft `baueFiskalBuehne()`, `starten()`, `leeren()`,
 * legt Belege an und zieht die Ausgabewege.
 *
 * Was die Buehne aufstellt:
 *   • einen Postgres-Behaelter (pgvector/pgvector:pg17) mit der Rolle
 *     `warehouse14_migrator` aus dem initdb-Skript,
 *   • JEDE Produktionswanderung, eingespielt mit derselben Treue wie auf dem
 *     Server (`_migrate.ts`: `check_function_bodies = off`, Anweisung fuer
 *     Anweisung, psql-Semantik),
 *   • die ECHTE Fastify-Anwendung ueber `buildApp()`, angeschlossen an dieselbe
 *     Datenbank, aber mit der App-Rolle `warehouse14_app` — also mit genau den
 *     Rechten der Produktion, samt Spalten-GRANTs.
 *
 * ── Was ein Nutzer WISSEN MUSS, sonst kostet es ihn eine Stunde ────────────
 *
 * 1. REIHENFOLGE: erst die Belege, DANN der Abschluss. Wanderung 0013 haengt
 *    einen BEFORE-INSERT-Waechter an `transactions`, der jeden neuen Beleg auf
 *    einen Tag verweigert, fuer den bereits ein FINALIZED-Abschluss steht.
 *
 * 2. EIN Beleg ist EINE Datenbanktransaktion. Wanderung 0016 haengt einen
 *    DEFERRABLE INITIALLY DEFERRED Waechter an Kopf, Positionen und Zahlungen,
 *    der beim COMMIT nachrechnet:
 *        Σ Positionen.Teilbetrag = Kopf.subtotal
 *        Σ Positionen.Steuer     = Kopf.vat
 *        Σ Positionen.Gesamt     = Kopf.total
 *        Σ Zahlungen             = Kopf.total     ← auch bei GETEILTER Zahlung
 *    Deshalb schreibt `legeBelegAn` alles in EINEM `begin()`.
 *
 * 3. GETEILTE ZAHLUNG ist ausdruecklich vorgesehen: `payments: [...]` nimmt
 *    beliebig viele Beine mit frei gewaehlter Zahlart. Sie MUESSEN auf den
 *    Kopfbetrag aufgehen (siehe 2). Der DATEV-Weg erzeugt daraus je Zahlart
 *    eine eigene Buchungszeile — das ist gewollt, die Kasse darf kein Geld
 *    tragen, das nie in ihr lag.
 *
 * 4. Der GwG-Riegel (Wanderungen 0050 + 0111) ist ECHT und scharf: ein VERKAUF
 *    ueber den Ladentisch (`sales_channel = 'POS'`) ab 2.000 EUR verlangt einen
 *    ausweisgeprueften Kunden, und eine BAR-Zahlung ab dieser Schwelle
 *    ebenfalls. `akteure.kundeId` ist genau so ein Kunde. Wer die Schwelle
 *    ohne ihn reisst, bekommt einen `check_violation` — das ist kein Fehler
 *    der Buehne, das ist das Gesetz im Schema.
 *
 * 5. `leeren()` raeumt mit TRUNCATE, nicht mit DELETE: `transactions` und
 *    `tse_signatures` sind nachtraeglich unveraenderlich und weisen jedes
 *    Zeilen-DELETE per Ausloeser zurueck. TRUNCATE ist eine Tabellenoperation
 *    und geht an den Zeilen-Ausloesern vorbei; nur die Migrator-Rolle darf das.
 *    `ledger_events` bleibt ABSICHTLICH stehen — die Kette ist ein Beweis, und
 *    der Abschluss verankert sich an ihrem jeweiligen Kopf.
 *
 * NUR FUER TESTS. Die Buehne fasst keinen Produktionsquelltext an; die
 * Datenbank lebt in einem Wegwerf-Behaelter.
 */

import { randomUUID } from 'node:crypto';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AppDb } from '@norns/db/client';
import * as schema from '@norns/db/schema';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import postgres, { type Sql } from 'postgres';

import { buildApp } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';
import { applyAllMigrations } from '../integration/_migrate.js';

/** Der PII-Schluessel der Buehne. Ein Testwert, nie ein Produktionswert. */
export const PII_SCHLUESSEL = 'test-pii-key-do-not-use-in-production-32b';

/** Das initdb-Skript, das die Migrator-Rolle im frischen Behaelter anlegt. */
const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator
    LOGIN
    NOINHERIT
    SUPERUSER
    CREATEROLE
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

// ── Formen, die eine Szenariendatei anfasst ────────────────────────────────

/** Ein Zahlungsbein. Mehrere davon ergeben eine geteilte Zahlung. */
export interface ZahlungAngabe {
  /** Wert des Aufzaehlungstyps `payment_method`, z. B. 'CASH', 'ZVT_CARD'. */
  method: string;
  /** NUMERIC(18,2)-Zeichenkette, z. B. '59.50'. Beim Storno negativ. */
  amount: string;
}

/** Eine Belegposition. */
export interface PositionAngabe {
  productId: string;
  /** Positionsbezogener Steuerbehandlungscode (muss ein echter Code sein). */
  treatment: string;
  vatRate: string | null;
  lineSubtotal: string;
  lineVat: string;
  lineTotal: string;
  acquisition?: string | null;
  margin?: string | null;
  displayOrder: number;
}

/**
 * Die Angaben eines Belegs.
 *
 * Die Feldnamen sind WOERTLICH die des bisherigen `seedTransaction` in
 * `fiscal-export.test.ts` — damit ist die Buehne dort ein Austausch ohne
 * Umschreiben, und ein Vergleich der beiden Wege bleibt lesbar. Neu sind nur
 * `payments`, `salesChannel` und `cashierUserId`.
 */
export interface BelegAngaben {
  direction: 'VERKAUF' | 'ANKAUF';
  /** Kopfbezogener `tax_treatment_code` (muss ein echter Code sein). */
  treatment: string;
  subtotal: string;
  vat: string;
  total: string;
  customerId: string | null;
  /** ISO-Zeitpunkt innerhalb des Berliner Geschaeftstags, siehe `ts()`. */
  finalizedAt: string;
  items: PositionAngabe[];
  /**
   * Die Schicht, zu der dieser Beleg gehört.
   *
   * ⚠️ 09.08.2026 nachgetragen: bis dahin legte die Bühne JEDEN Beleg ohne
   * Schicht an. Jede Messung, die über `shift_id` verbindet — der erwartete
   * Ladenbestand, der Schichtumsatz — sah deshalb NULL und blieb grün, ohne
   * je etwas berührt zu haben.
   */
  shiftId?: string;
  /** EIN Zahlungsbein — die alte Form. Entweder dieses oder `payments`. */
  payment?: ZahlungAngabe;
  /**
   * MEHRERE Zahlungsbeine — die geteilte Zahlung, die es auf der Produktion
   * wirklich gibt. Die Summe MUSS `total` ergeben (Wanderung 0016).
   */
  payments?: readonly ZahlungAngabe[];
  tse?: boolean;
  stornoOf?: string | null;
  /** 'POS' (Vorgabe), 'WEB', 'EBAY', 'PHONE' — entscheidet ueber den GwG-Riegel. */
  salesChannel?: string;
  /**
   * 'NOT_REQUIRED' | 'PENDING' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'RETURNED'.
   * Ohne Angabe: 'NOT_REQUIRED' am Ladentisch, 'PENDING' im Netz — anders
   * verweigert `transactions_shipping_status_per_channel` den Beleg.
   */
  shippingStatus?: string;
  /** Abweichender Kassierer; ohne Angabe der Kassierer der Buehne. */
  cashierUserId?: string;
}

/** Das Ergebnis von `legeBelegAn`. */
export interface BelegErgebnis {
  id: string;
  locator: string;
}

/** Die Angaben eines Tagesabschlusses. */
export interface AbschlussAngaben {
  /** 'YYYY-MM-DD'. */
  geschaeftstag: string;
  /** Vorgabe 'FINALIZED'. */
  zustand?: 'COUNTING' | 'FINALIZED';
  verkaufAnzahl?: number;
  ankaufAnzahl?: number;
  stornoAnzahl?: number;
  bruttoVerkauf?: string;
  bruttoAnkauf?: string;
  nettoVerkauf?: string;
  nettoAnkauf?: string;
  ustJeBehandlung?: Record<string, string>;
  zahlungenJeArt?: Record<string, string>;
  kasseErwartet?: string;
  kasseGezaehlt?: string;
  kasseAbweichung?: string;
  tseFertig?: number;
  tseOffen?: number;
  tseFehler?: number;
  /**
   * Am Kopf der Beweiskette verankern. Vorgabe: ja bei 'FINALIZED' (das Schema
   * verlangt es dort), nein sonst.
   */
  mitAnker?: boolean;
}

/** Die Angaben eines Produkts. Alles hat eine brauchbare Vorgabe. */
export interface ProduktAngaben {
  name?: string;
  sku?: string;
  behandlung?: string;
  einkaufspreis?: string;
  listenpreis?: string;
  metall?: string;
  gewichtGramm?: string;
}

/** Wer auf der Buehne steht. Nach jedem `leeren()` frisch. */
export interface Akteure {
  /** ADMIN mit `is_owner` — der Inhaber. */
  inhaberId: string;
  /** CASHIER — der Kassierer, der jeden Beleg unterschreibt. */
  kassiererId: string;
  /** Das gepaarte mTLS-Geraet. */
  geraetId: string;
  /** Sein Zertifikats-Fingerabdruck, den `hol()` als Kopfzeile mitschickt. */
  geraetFingerabdruck: string;
  /** Ein ausweisgeprueter Kunde — noetig fuer ANKAUF und ueber der GwG-Schwelle. */
  kundeId: string;
  /** Sitzung: ADMIN mit frischer Stufenanhebung. Die Vorgabe von `hol()`. */
  inhaberSitzung: string;
  /** Sitzung: ADMIN OHNE Stufenanhebung — fuer die 403-Proben. */
  inhaberSitzungOhneStufe: string;
  /** Sitzung: CASHIER mit Stufenanhebung — fuer die 403-Proben. */
  kassiererSitzung: string;
}

/** Die Angaben an `hol()` / `sende()`. */
export interface AnfrageAngaben {
  /** `null` = gar keine Sitzung mitschicken. Ohne Angabe: der Inhaber. */
  token?: string | null;
  /** `null` = gar keinen Fingerabdruck mitschicken. Ohne Angabe: das Geraet. */
  fingerprint?: string | null;
}

/** Die Angaben an `leeren()`. */
export interface LeerenAngaben {
  /**
   * Die sechs DATEV-Einstellungen gleich mitsetzen. Vorgabe: ja — ohne sie
   * verweigert der DATEV-Weg den Export, und das ist Absicht. Auf `false`
   * setzen, wer genau diese Verweigerung pruefen will.
   */
  datevEinstellungen?: boolean;
}

/** Die Angaben an `baueFiskalBuehne()`. */
export interface BuehnenAngaben {
  /** Vorgabetag fuer `ts()`. Vorgabe '2026-05-04' (ein Montag, Sommerzeit). */
  geschaeftstag?: string;
  /** Abbild des Behaelters. Vorgabe 'pgvector/pgvector:pg17'. */
  abbild?: string;
  /** Zusaetzliche/abweichende Umgebungswerte fuer `buildApp`. */
  umgebung?: Record<string, unknown>;
}

/** Die Buehne selbst. */
export interface FiskalBuehne {
  starten(): Promise<void>;
  stoppen(): Promise<void>;
  leeren(angaben?: LeerenAngaben): Promise<void>;
  /**
   * Die Lade oeffnen, den Storno fahren, die Lade zaehlen und schliessen.
   * Ein Barstorno ohne offene Schicht wird seit dem 11.08.2026 abgewiesen;
   * die ganze Begruendung steht an der Umsetzung.
   */
  mitOffenerSchichtFuerStorno<T>(urbelegId: string, lauf: () => Promise<T>): Promise<T>;
  saeeDatevEinstellungen(): Promise<void>;
  /**
   * Die fiskalischen Voraussetzungen eines arbeitenden Ladens: die
   * Sicherungseinrichtung nach § 146a AO, der Umsatzsteuer-Status, die
   * Stammdaten und die drei Angaben des Steuerberaters. Ohne sie verweigert
   * die Kasse zu Recht JEDEN Verkauf.
   */
  saeeFiskalischeVoraussetzungen(): Promise<void>;
  legeProduktAn(angaben?: ProduktAngaben): Promise<string>;
  legeBelegAn(angaben: BelegAngaben): Promise<BelegErgebnis>;
  legeAbschlussAn(angaben: AbschlussAngaben): Promise<string>;
  hol(url: string, angaben?: AnfrageAngaben): Promise<LightMyRequestResponse>;
  sende(url: string, nutzlast: unknown, angaben?: AnfrageAngaben): Promise<LightMyRequestResponse>;
  /** Ein Zeitpunkt im Berliner Geschaeftstag, mit ECHTEM Zonenversatz. */
  ts(stunde: number, minute?: number, tag?: string): string;
  /** Der Vorgabetag, auf den sich `ts()` bezieht. */
  readonly geschaeftstag: string;
  readonly akteure: Akteure;
  /** Die Drizzle-Verbindung mit der APP-Rolle (wie die Anwendung sie sieht). */
  readonly db: AppDb;
  /** Die rohe Verbindung mit der APP-Rolle. */
  readonly sql: Sql;
  /** Die rohe Verbindung mit der MIGRATOR-Rolle (darf alles, auch TRUNCATE). */
  readonly migratorSql: Sql;
  /** Die echte Fastify-Anwendung. */
  readonly app: FastifyInstance;
}

// ── Zeit ───────────────────────────────────────────────────────────────────

/**
 * Der ECHTE Berliner Zonenversatz eines Tages, als '+02:00' bzw. '+01:00'.
 *
 * Die alte Buehne schrieb '+02:00' fest. Fuer den Maitag stimmte das; fuer
 * einen Januartag waere jeder Zeitpunkt um eine Stunde verrutscht, und genau
 * eine Stunde entscheidet an der Tagesgrenze darueber, auf WELCHEN
 * Geschaeftstag ein Beleg faellt. Bestimmt wird der Versatz zu 12:00 UTC des
 * Tages; an einem Umstellungstag gilt damit fuer den ganzen Tag der Versatz
 * des Nachmittags.
 */
export function berlinerVersatz(tag: string): string {
  const teile = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(`${tag}T12:00:00Z`));
  const name = teile.find((t) => t.type === 'timeZoneName')?.value ?? 'GMT+01:00';
  const treffer = /GMT([+-]\d{2}:\d{2})/.exec(name);
  return treffer?.[1] ?? '+01:00';
}

/** '2026-05-04', 9, 30 → '2026-05-04T09:30:00+02:00'. */
export function berlinerZeitpunkt(tag: string, stunde: number, minute = 0): string {
  const hh = String(stunde).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${tag}T${hh}:${mm}:00${berlinerVersatz(tag)}`;
}

// ── Die Buehne ─────────────────────────────────────────────────────────────

export function baueFiskalBuehne(angaben: BuehnenAngaben = {}): FiskalBuehne {
  const geschaeftstag = angaben.geschaeftstag ?? '2026-05-04';
  const abbild = angaben.abbild ?? 'pgvector/pgvector:pg17';

  let behaelter: StartedPostgreSqlContainer | undefined;
  let migratorSql: Sql | undefined;
  let appSql: Sql | undefined;
  let appDb: AppDb | undefined;
  let fastify: FastifyInstance | undefined;
  let akteure: Akteure | undefined;

  /** Zugriff auf etwas, das erst nach `starten()` existiert. */
  function fordere<T>(wert: T | undefined, was: string): T {
    if (wert === undefined) {
      throw new Error(
        `Fiskal-Buehne: ${was} steht noch nicht. Erst \`starten()\` aufrufen ` +
          '(und fuer die Akteure danach `leeren()`).',
      );
    }
    return wert;
  }

  async function starten(): Promise<void> {
    behaelter = await new PostgreSqlContainer(abbild)
      .withDatabase('warehouse14_test')
      .withUsername('postgres')
      .withPassword('postgres_test_pw')
      .withCommand(['postgres', '-c', 'shared_preload_libraries=pg_stat_statements'])
      .withCopyContentToContainer([
        { content: INITDB_SQL, target: '/docker-entrypoint-initdb.d/00.sql' },
      ])
      .start();

    migratorSql = postgres({
      host: behaelter.getHost(),
      port: behaelter.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_migrator',
      password: 'warehouse14_migrator_test_pw',
      max: 1,
      onnotice: () => {},
    });
    await applyAllMigrations(migratorSql);
    await migratorSql.unsafe(`ALTER ROLE warehouse14_app PASSWORD 'warehouse14_app_test_pw'`);

    appSql = postgres({
      host: behaelter.getHost(),
      port: behaelter.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_app',
      password: 'warehouse14_app_test_pw',
      max: 5,
      onnotice: () => {},
    });
    appDb = drizzle(appSql, { schema });

    // Bewusst nur die Schluessel, auf die diese Buehne wirklich wirkt. Alle
    // uebrigen traegt das Zod-Schema mit seinen Vorgabewerten nach, deshalb die
    // Teilmenge und die Zusicherung darauf — den Typ `Env` einfach zu behaupten
    // waere schlicht falsch (so stand es bis zum 26.07.2026 in der Vorlage).
    const umgebung = {
      NODE_ENV: 'test',
      PORT: 0,
      LOG_LEVEL: 'error',
      DATABASE_URL: 'unused-because-override',
      DB_POOL_MAX: 5,
      NORNS_PII_KEY: PII_SCHLUESSEL,
      TRUSTED_ORIGINS: '',
      TRANSACTION_STEP_UP_THRESHOLD_EUR: '1000.00',
      R2_ACCOUNT_ID: '',
      R2_BUCKET: '',
      R2_ACCESS_KEY_ID: '',
      R2_SECRET_ACCESS_KEY: '',
      R2_PUBLIC_URL_BASE: '',
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
      STRIPE_API_VERSION: '2024-12-18.acacia',
      STRIPE_WEBHOOK_TOLERANCE_SECONDS: 300,
    };

    // Abweichungen der Szenariendatei nachtragen. Bewusst als Zuweisung und
    // nicht als Spread: ein Spread wuerde die Typen der Teilmenge oben
    // aufweichen und die Zusicherung darauf wertlos machen.
    const env = umgebung as Env;
    for (const [schluessel, wert] of Object.entries(angaben.umgebung ?? {})) {
      (env as unknown as Record<string, unknown>)[schluessel] = wert;
    }

    fastify = await buildApp({
      env,
      dbOverride: { db: appDb, sql: appSql },
      fastifyOpts: { disableRequestLogging: true },
    });
  }

  async function stoppen(): Promise<void> {
    await fastify?.close().catch(() => {});
    await appSql?.end({ timeout: 5 }).catch(() => {});
    await migratorSql?.end({ timeout: 5 }).catch(() => {});
    await behaelter?.stop().catch(() => {});
    fastify = undefined;
    appSql = undefined;
    appDb = undefined;
    migratorSql = undefined;
    behaelter = undefined;
    akteure = undefined;
  }

  /**
   * Die fuenf Angaben des Steuerberaters (plus der Kontenrahmen).
   *
   * Seit dem 26.07.2026 verweigert der DATEV-Weg ohne sie den Export, und das
   * ist Absicht: eine Kopfzeile mit leeren Ordnungsbegriffen sieht aus wie ein
   * Export und ist keiner.
   */
  async function saeeDatevEinstellungen(): Promise<void> {
    const db = fordere(appDb, 'die Datenbank');
    await db.execute(sql`
      INSERT INTO system_settings (key, value, description) VALUES
        ('datev.beraternummer',          '29098'::jsonb,       'Testwert'),
        ('datev.mandantennummer',        '55003'::jsonb,       'Testwert'),
        ('datev.wirtschaftsjahr_beginn', '"2026-01-01"'::jsonb,'Testwert'),
        ('datev.sachkontenlaenge',       '4'::jsonb,           'Testwert'),
        ('datev.festschreibung',         'false'::jsonb,       'Testwert'),
        ('datev.sachkontenrahmen',       '"03"'::jsonb,        'Testwert')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  }

  /**
   * Die fiskalischen VORAUSSETZUNGEN eines arbeitenden Ladens.
   *
   * ── WARUM ES DIESEN EINEN ORT GIBT (04.08.2026) ────────────────────────
   *
   * ⚠️ Am 02.08.2026 kam der Riegel nach § 146a AO: ohne eingerichtete
   * Sicherungseinrichtung KEIN Verkauf. Richtig so. Nur sät keine Bühne die
   * Einrichtung, und deshalb antwortete ab da JEDER Verkauf im
   * Integrationslauf mit 409.
   *
   * Aufgefallen ist es nicht, weil `pnpm test` die Integrationsmappe
   * ausschliesst. Ein Riegel, den niemand messen kann, ist ein Riegel, der
   * beim Kunden zuschlägt.
   *
   * Deshalb EIN Ort statt sechs Bühnen mit sechs Kopien: kommt der nächste
   * Riegel, wird er hier ergänzt, und alle Bühnen bekommen ihn.
   *
   * ⚠️ Die Werte sind ausdrücklich TESTWERTE. Sie behaupten keine
   * Rechtsauffassung, und sie gehören zu keinem echten Betrieb.
   */
  async function saeeFiskalischeVoraussetzungen(): Promise<void> {
    const db = fordere(appDb, 'die Datenbank');
    await db.execute(sql`
      INSERT INTO system_settings (key, value, description) VALUES
        -- § 146a AO: ohne diese Kennung verweigert die Kasse jeden Verkauf.
        ('tse.tss_id',     '"11111111-2222-3333-4444-555555555555"'::jsonb, 'Testwert'),
        ('tse.client_id',  '"66666666-7777-8888-9999-000000000000"'::jsonb, 'Testwert'),
        -- Ohne Umsatzsteuer-Status vermutet die Kasse NICHTS, sie hält an.
        ('steuer.modus',         '"REGELBESTEUERUNG"'::jsonb,               'Testwert'),
        -- ⚠️ BEIDE: ohne das Datum gilt der Status als nicht hinterlegt.
        ('steuer.modus_gilt_ab', '"2020-01-01"'::jsonb,                       'Testwert'),
        -- Die Stammdaten, ohne die kein Prüferpaket entsteht.
        ('shop.legal_name',   '"Pruefbetrieb Edelmetall GmbH"'::jsonb,      'Testwert'),
        ('shop.street',       '"Musterstrasse 1"'::jsonb,                   'Testwert'),
        ('shop.postal_code',  '"28195"'::jsonb,                             'Testwert'),
        ('shop.city',         '"Bremen"'::jsonb,                            'Testwert'),
        ('shop.country_code', '"DEU"'::jsonb,                               'Testwert'),
        ('shop.tax_number',   '"60/123/45678"'::jsonb,                      'Testwert'),
        -- Die drei Fragen, die sonst nur eine Kanzlei beantwortet.
        ('dsfinvk.gv_typ.ankauf',                     '"Auszahlung"'::jsonb, 'Testwert'),
        ('dsfinvk.ust_schluessel.margin_25a',         '"1001"'::jsonb,       'Testwert'),
        ('dsfinvk.ust_schluessel.reverse_charge_13b', '"1002"'::jsonb,       'Testwert')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  }

  async function leeren(leerAngaben: LeerenAngaben = {}): Promise<void> {
    const msql = fordere(migratorSql, 'die Migrator-Verbindung');

    // TRUNCATE und nicht DELETE: `transactions` + `tse_signatures` sind
    // nachtraeglich unveraenderlich und weisen jedes Zeilen-DELETE per
    // Ausloeser zurueck (fiskalische Unveraenderbarkeit). TRUNCATE ist eine
    // Tabellenoperation und geht daran vorbei; die Migrator-Rolle darf es.
    // CASCADE folgt dem Fremdschluessel-Graphen. `ledger_events` bleibt
    // absichtlich stehen — die Kette ist Beweis, der Abschluss verankert sich
    // an ihrem jeweiligen Kopf.
    await msql.unsafe(
      'TRUNCATE tse_signatures, transaction_payments, transaction_items, ' +
        'transactions, daily_closings, shifts, sessions, devices, customers CASCADE',
    );
    await msql`DELETE FROM users WHERE is_owner = TRUE OR role <> 'ADMIN'`;

    const [inhaber] = await msql<{ id: string }[]>`
      INSERT INTO users (email, name, role, is_owner)
      VALUES (${`admin-${randomUUID()}@x.test`}, 'Owner', 'ADMIN'::user_role, TRUE)
      RETURNING id`;
    const inhaberId = inhaber!.id;

    const [kassierer] = await msql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`cash-${randomUUID()}@x.test`}, 'Cashier', 'CASHIER'::user_role)
      RETURNING id`;
    const kassiererId = kassierer!.id;

    const geraetFingerabdruck = randomUUID().replace(/-/g, '');
    const [geraet] = await msql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${geraetFingerabdruck},
              now() - interval '1 day', now() + interval '365 days', ${inhaberId})
      RETURNING id`;
    const geraetId = geraet!.id;

    const inhaberSitzung = randomUUID().replace(/-/g, '');
    await msql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${inhaberId}, ${inhaberSitzung}, now() + interval '8 hours', ${geraetId}, now())`;

    const inhaberSitzungOhneStufe = randomUUID().replace(/-/g, '');
    await msql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${inhaberId}, ${inhaberSitzungOhneStufe}, now() + interval '8 hours', ${geraetId}, NULL)`;

    const kassiererSitzung = randomUUID().replace(/-/g, '');
    await msql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${kassiererId}, ${kassiererSitzung}, now() + interval '8 hours', ${geraetId}, now())`;

    // Ein ausweisgeprueter Kunde — noetig fuer jeden ANKAUF und fuer jeden
    // Ladenverkauf ab der GwG-Barschwelle von 2.000 EUR.
    const [kunde] = await msql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_SCHLUESSEL}, true))
      INSERT INTO customers (full_name_encrypted, retention_until, kyc_verified_at, kyc_verified_by_user_id)
      SELECT encrypt_pii('Audit Kunde'), (now() + interval '5 years')::date, now(), ${inhaberId} FROM s
      RETURNING id`;

    akteure = {
      inhaberId,
      kassiererId,
      geraetId,
      geraetFingerabdruck,
      kundeId: kunde!.id,
      inhaberSitzung,
      inhaberSitzungOhneStufe,
      kassiererSitzung,
    };

    if (leerAngaben.datevEinstellungen !== false) await saeeDatevEinstellungen();
    // ⚠️ IMMER. Ein Riegel, den die Bühne nicht erfüllt, macht jeden Verkauf
    // zu einer 409, und der Grund steht dann in keinem Testnamen.
    await saeeFiskalischeVoraussetzungen();
  }

  async function legeProduktAn(p: ProduktAngaben = {}): Promise<string> {
    const msql = fordere(migratorSql, 'die Migrator-Verbindung');
    const [zeile] = await msql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, name, metal, weight_grams,
                            published_at)
      VALUES (${p.sku ?? `SKU-${randomUUID()}`}, 'AVAILABLE'::product_status,
              ${p.behandlung ?? 'MARGIN_25A'}, 'gold_jewelry'::item_type,
              ${p.einkaufspreis ?? '10.00'}, ${p.listenpreis ?? '100.00'},
              ${p.name ?? `Posten ${randomUUID().slice(0, 8)}`},
              ${p.metall ?? null}, ${p.gewichtGramm ?? null},
              now())
      RETURNING id`;
    return zeile!.id;
  }

  async function legeBelegAn(b: BelegAngaben): Promise<BelegErgebnis> {
    const msql = fordere(migratorSql, 'die Migrator-Verbindung');
    const wer = fordere(akteure, 'die Akteure');

    // Genau EINE der beiden Formen. Beides anzugeben waere zweideutig, keins
    // von beidem laesst den Waechter aus 0016 beim COMMIT zuschlagen — dann
    // aber mit einer Meldung ueber Datenbankausloeser statt ueber den Test.
    const zahlungen: readonly ZahlungAngabe[] =
      b.payments ?? (b.payment !== undefined ? [b.payment] : []);
    if (b.payments !== undefined && b.payment !== undefined) {
      throw new Error('legeBelegAn: entweder `payment` ODER `payments`, nicht beides.');
    }
    if (zahlungen.length === 0) {
      throw new Error('legeBelegAn: mindestens eine Zahlung (`payment` oder `payments`).');
    }

    const kanal = b.salesChannel ?? 'POS';

    // Der ganze Beleg in EINER Datenbanktransaktion: der DEFERRED-Waechter aus
    // Wanderung 0016 prueft beim COMMIT, dass Positionen UND Zahlungen den
    // Kopf ausgleichen — genau so schreibt es auch der Abschlussweg.
    return msql.begin(async (tx) => {
      const [kopf] = await tx<{ id: string; receipt_locator: string }[]>`
        INSERT INTO transactions (
          direction, storno_of_transaction_id, customer_id, device_id, cashier_user_id,
          subtotal_eur, vat_eur, total_eur, tax_treatment_code,
          sales_channel, shipping_status, finalized_at, shift_id
        ) VALUES (
          ${b.direction}::transaction_direction,
          ${b.stornoOf ?? null},
          ${b.customerId},
          ${wer.geraetId},
          ${b.cashierUserId ?? wer.kassiererId},
          ${b.subtotal}, ${b.vat}, ${b.total},
          ${b.treatment},
          ${kanal}::sales_channel,
          ${b.shippingStatus ?? (kanal === 'WEB' ? 'PENDING' : 'NOT_REQUIRED')}::shipping_status,
          ${b.finalizedAt}::timestamptz,
          ${b.shiftId ?? null}
        ) RETURNING id, receipt_locator`;
      const id = kopf!.id;

      for (const p of b.items) {
        await tx`
          INSERT INTO transaction_items (
            transaction_id, product_id,
            line_subtotal_eur, line_vat_eur, line_total_eur,
            applied_tax_treatment_code, applied_vat_rate,
            acquisition_cost_eur_snapshot, margin_eur, display_order
          ) VALUES (
            ${id}, ${p.productId},
            ${p.lineSubtotal}, ${p.lineVat}, ${p.lineTotal},
            ${p.treatment}, ${p.vatRate},
            ${p.acquisition ?? null}, ${p.margin ?? null}, ${p.displayOrder}
          )`;
      }

      // Ein INSERT je Zahlungsbein. Die Reihenfolge bleibt die angegebene, weil
      // der DATEV-Weg die Zahlungen nach `created_at` liest und daraus die
      // Reihenfolge der Buchungszeilen ableitet.
      for (const z of zahlungen) {
        await tx`
          INSERT INTO transaction_payments (transaction_id, payment_method, amount_eur)
          VALUES (${id}, ${z.method}::payment_method, ${z.amount})`;
      }

      if (b.tse) {
        await tx`
          INSERT INTO tse_signatures (
            transaction_id, fiskaly_tss_id, fiskaly_client_id,
            fiskaly_transaction_number, signature_value, signature_counter,
            signature_algorithm, process_type, tse_start_time, tse_end_time
          ) VALUES (
            ${id}, ${randomUUID()}, ${randomUUID()},
            ${Math.floor(Math.random() * 1_000_000) + 1},
            ${`sig-${randomUUID()}`}, ${Math.floor(Math.random() * 1_000_000) + 1},
            'ecdsa-plain-SHA256', 'Kassenbeleg-V1',
            ${b.finalizedAt}::timestamptz, ${b.finalizedAt}::timestamptz
          )`;
      }

      return { id, locator: kopf!.receipt_locator };
    });
  }

  async function legeAbschlussAn(a: AbschlussAngaben): Promise<string> {
    const msql = fordere(migratorSql, 'die Migrator-Verbindung');
    const wer = fordere(akteure, 'die Akteure');

    const zustand = a.zustand ?? 'FINALIZED';
    const abgeschlossen = zustand === 'FINALIZED';
    const mitAnker = a.mitAnker ?? abgeschlossen;

    // Der Anker ist der JEWEILIGE Kopf der Beweiskette: jeder Beleg oben hat
    // ein `ledger_event` erzeugt, der Kopf ist also wohlbestimmt.
    let ankerId: string | null = null;
    let ankerHash: Buffer | null = null;
    if (mitAnker) {
      const [kopf] = await msql<{ id: string; row_hash: Buffer }[]>`
        SELECT id, row_hash FROM ledger_events ORDER BY id DESC LIMIT 1`;
      if (kopf === undefined) {
        throw new Error(
          'legeAbschlussAn: die Beweiskette ist leer, es gibt nichts zu verankern. ' +
            'Erst einen Beleg anlegen — oder `mitAnker: false` setzen.',
        );
      }
      ankerId = kopf.id;
      ankerHash = kopf.row_hash;
    }

    const wann = abgeschlossen ? new Date() : null;

    /*
     * ⚠️ ZWEI PFLICHTANGABEN, DIE NACH DIESER BUEHNE KAMEN.
     *
     * Wanderung 0124 verlangt bei einem festgeschriebenen Abschluss die
     * Z-NUMMER, Wanderung 0125 die HERKUNFT des Kassenbestands. Beide sind
     * CHECK-Regeln, also scheitert das INSERT, nicht erst der Export.
     *
     * Die Buehne wusste von keiner der beiden, und weil `pnpm test` die
     * Integrationsmappe ausschliesst, fiel es monatelang niemandem auf: JEDER
     * festgeschriebene Abschluss dieser Buehne prallte an
     * `daily_closings_festgeschrieben_hat_z_nr` ab.
     *
     * Die Z-Nummer kommt aus dem HOECHSTSTAND plus eins, nicht aus einer
     * Sequenz: eine Sequenz risse bei einem Rollback eine Luecke, und genau
     * die Luecke ist der Zweck der Nummer. Ein Pruefer soll an ihr sehen, dass
     * ein Abschluss FEHLT.
     */
    const [hoechste] = abgeschlossen
      ? await msql<{ naechste: number }[]>`
          SELECT COALESCE(MAX(z_nr), 0) + 1 AS naechste FROM daily_closings`
      : [{ naechste: 0 }];
    const zNr = abgeschlossen ? (hoechste?.naechste ?? 1) : null;

    /*
     * Die Herkunft des Kassenbestands. `EIGENER_STURZ` ist der Regelfall: der
     * Haendler hat gezaehlt. Die Pruefregel verlangt dann BEIDE Zahlen, und
     * die Buehne liefert sie ohnehin.
     */
    const sturzQuelle = abgeschlossen ? 'EIGENER_STURZ' : null;

    const [zeile] = await msql<{ id: string }[]>`
      INSERT INTO daily_closings (
        business_day, state,
        verkauf_count, ankauf_count, storno_count,
        gross_verkauf_eur, gross_ankauf_eur, net_verkauf_eur, net_ankauf_eur,
        vat_by_treatment, payments_by_method,
        cash_drawer_expected_eur, cash_drawer_counted_eur, cash_drawer_variance_eur,
        tse_finished_count, tse_pending_count, tse_failed_count,
        ledger_anchor_id, ledger_anchor_hash,
        counted_by_user_id, counted_at, finalized_by_user_id, finalized_at,
        z_nr, kassensturz_quelle
      ) VALUES (
        ${a.geschaeftstag}::date, ${zustand}::closing_state,
        ${a.verkaufAnzahl ?? 0}, ${a.ankaufAnzahl ?? 0}, ${a.stornoAnzahl ?? 0},
        ${a.bruttoVerkauf ?? '0.00'}, ${a.bruttoAnkauf ?? '0.00'},
        ${a.nettoVerkauf ?? '0.00'}, ${a.nettoAnkauf ?? '0.00'},
        ${msql.json(a.ustJeBehandlung ?? {})}, ${msql.json(a.zahlungenJeArt ?? {})},
        ${a.kasseErwartet ?? '0.00'}, ${a.kasseGezaehlt ?? '0.00'}, ${a.kasseAbweichung ?? '0.00'},
        ${a.tseFertig ?? 0}, ${a.tseOffen ?? 0}, ${a.tseFehler ?? 0},
        ${ankerId}, ${ankerHash},
        ${abgeschlossen ? wer.inhaberId : null}, ${wann},
        ${abgeschlossen ? wer.inhaberId : null}, ${wann},
        ${zNr}, ${sturzQuelle}::kassensturz_quelle
      ) RETURNING id`;
    return zeile!.id;
  }

  function kopfzeilen(an: AnfrageAngaben): Record<string, string> {
    const wer = fordere(akteure, 'die Akteure');
    const headers: Record<string, string> = {};
    if (an.token !== null) {
      headers.cookie = `warehouse14.session=${an.token ?? wer.inhaberSitzung}`;
    }
    if (an.fingerprint !== null) {
      headers['x-dev-device-fingerprint'] = an.fingerprint ?? wer.geraetFingerabdruck;
    }
    return headers;
  }

  function hol(url: string, an: AnfrageAngaben = {}): Promise<LightMyRequestResponse> {
    const f = fordere(fastify, 'die Anwendung');
    return f.inject({ method: 'GET', url, headers: kopfzeilen(an) });
  }

  function sende(
    url: string,
    nutzlast: unknown,
    an: AnfrageAngaben = {},
  ): Promise<LightMyRequestResponse> {
    const f = fordere(fastify, 'die Anwendung');
    const optionen: InjectOptions = {
      method: 'POST',
      url,
      headers: { ...kopfzeilen(an), 'content-type': 'application/json' },
      payload: nutzlast as NonNullable<InjectOptions['payload']>,
    };
    return f.inject(optionen);
  }

  /**
   * ── DIE LADE MUSS OFFEN SEIN, WENN BARGELD SIE VERLAESST ────────────────
   *
   * Seit dem 11.08.2026 weist der Storno eine BARRUECKGABE ohne offene
   * Schicht ab (`StornoBargeldOhneSchichtError`) — genau wie der Verkauf
   * Bargeld ohne Schicht seit dem 08.08. abweist. Beides aus demselben
   * Grund: was in keiner Schicht steht, liegt in keinem Kassensturz.
   *
   * Die Szenariendateien massen bis dahin einen Zustand, den die Kasse gar
   * nicht herstellen kann: einen Barverkauf ohne Schicht. Sie legen ihre
   * Belege per SQL an und umgehen damit den Riegel der Verkaufsroute.
   *
   * ── WARUM DIE SCHICHT NICHT PER SQL GESCHLOSSEN WIRD ───────────────────
   *
   * Mein erster Versuch setzte `status = 'CLOSED'` per UPDATE und liess
   * `blind_count_eur` auf NULL — „keine erfundene Zaehlung". Die Datenbank
   * hat das abgewiesen:
   *
   *     new row for relation "shifts" violates check constraint
   *     "shifts_closed_has_evidence"
   *
   * Und sie hat recht: eine geschlossene Schicht OHNE Zaehlung waere genau
   * die leere Aufzeichnung, die ein Pruefer beanstandet (Wanderung 0019).
   * Die Buehne geht deshalb den ECHTEN Weg — oeffnen, stornieren, zaehlen,
   * schliessen — und rechnet die Zaehlung so aus, dass sie STIMMT.
   *
   * ── DIE RECHNUNG, UND WARUM SIE GEPRUEFT WIRD ──────────────────────────
   *
   * `shifts.ts` erwartet: Anfangsbestand + Σ(VERKAUF bar) − Σ(ANKAUF bar).
   * Der Storno eines Barverkaufs traegt eine NEGATIVE Barzeile auf der
   * Verkaufsseite, der Storno eines Ankaufs eine negative auf der
   * Ankaufsseite. Also:
   *
   *   Verkaufsstorno  Lade hatte X, gibt X zurueck  → Anfang X, gezaehlt 0
   *   Ankaufsstorno   Lade war leer, bekommt X      → Anfang 0, gezaehlt X
   *
   * Beide ergeben eine Abweichung von 0,00 — und genau das prueft der
   * Helfer nach. Stimmt meine Rechnung nicht, faellt er laut aus, statt
   * still einen erfundenen Fehlbetrag in den Tagesabschluss zu schreiben.
   */
  async function mitOffenerSchichtFuerStorno<T>(
    urbelegId: string,
    lauf: () => Promise<T>,
  ): Promise<T> {
    const [urbeleg] = await fordere(migratorSql, 'die Migrator-Verbindung')<
      { richtung: string; bar: string }[]
    >`
      SELECT t.direction::text AS richtung,
             COALESCE((SELECT SUM(tp.amount_eur)
                         FROM transaction_payments tp
                        WHERE tp.transaction_id = t.id
                          AND tp.payment_method = 'CASH'::payment_method), 0)::text AS bar
        FROM transactions t WHERE t.id = ${urbelegId}::uuid`;
    if (!urbeleg) throw new Error(`mitOffenerSchichtFuerStorno: Urbeleg ${urbelegId} fehlt`);

    const barbetrag = urbeleg.bar;
    const istVerkauf = urbeleg.richtung === 'VERKAUF';
    const anfang = istVerkauf ? barbetrag : '0.00';
    const gezaehlt = istVerkauf ? '0.00' : barbetrag;

    const auf = await sende('/api/shifts/open', { openingFloatEur: anfang });
    if (auf.statusCode !== 200) {
      throw new Error(`mitOffenerSchichtFuerStorno: Schicht ging nicht auf — ${auf.body}`);
    }
    const schichtId = (auf.json() as { id: string }).id;

    try {
      return await lauf();
    } finally {
      const zu = await sende(`/api/shifts/${schichtId}/close`, { blindCountEur: gezaehlt });
      if (zu.statusCode !== 200) {
        throw new Error(`mitOffenerSchichtFuerStorno: Kassensturz scheiterte — ${zu.body}`);
      }
      const { varianceEur } = zu.json() as { varianceEur: string };
      if (varianceEur !== '0.00') {
        // Laut ausfallen statt still einen erfundenen Fehlbetrag festschreiben.
        throw new Error(
          `mitOffenerSchichtFuerStorno: die Rechnung der Buehne stimmt nicht. ` +
            `Anfang ${anfang}, gezaehlt ${gezaehlt}, Abweichung ${varianceEur} statt 0,00.`,
        );
      }
    }
  }

  return {
    starten,
    stoppen,
    leeren,
    mitOffenerSchichtFuerStorno,
    saeeDatevEinstellungen,
    saeeFiskalischeVoraussetzungen,
    legeProduktAn,
    legeBelegAn,
    legeAbschlussAn,
    hol,
    sende,
    ts: (stunde, minute = 0, tag = geschaeftstag) => berlinerZeitpunkt(tag, stunde, minute),
    geschaeftstag,
    get akteure() {
      return fordere(akteure, 'die Akteure');
    },
    get db() {
      return fordere(appDb, 'die Datenbank');
    },
    get sql() {
      return fordere(appSql, 'die App-Verbindung');
    },
    get migratorSql() {
      return fordere(migratorSql, 'die Migrator-Verbindung');
    },
    get app() {
      return fordere(fastify, 'die Anwendung');
    },
  };
}

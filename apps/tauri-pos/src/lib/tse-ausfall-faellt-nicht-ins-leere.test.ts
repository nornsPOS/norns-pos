/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EIN GESCHEITERTER TSE-SCHRITT FAELLT NICHT INS LEERE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 13.08.2026 ──────────────────────────────────────────────
 *
 * Der Bezahlweg hat drei Beruehrungen mit der Sicherungseinrichtung:
 *
 *     BezahlenDialog.tsx:823   openTseSession        ← Eroeffnung
 *     BezahlenDialog.tsx:954   closeTseSession       ← Abschluss
 *     BezahlenDialog.tsx:981   recordTseSignature    ← Melden an den Server
 *
 * Eine Zeile im Nachreiche-Korb entstand an ZWEI davon (tse-service.ts:119
 * und :170). Bei der EROEFFNUNG entstand nirgends eine — und genau sie ist
 * die erste, die bei einem Netzausfall scheitert. Der Kassierer las trotzdem
 * „Die Signatur wird nachgeholt, sobald die Sicherungseinrichtung wieder
 * antwortet". Sie wurde nie nachgeholt.
 *
 * Dazu die kleinere Luege: `closeTseSession` faengt einen Fehlschlag SEINES
 * eigenen Korbschreibers ab (tse-service.ts:135) und meldet trotzdem
 * `queued_offline` — auch dann wurde eine Nachreichung versprochen, die es
 * nicht gab.
 *
 * ── WAS DIESE PRUEFUNG MISST ──────────────────────────────────────────────
 *
 * Gegen ECHTES SQLite mit den ECHTEN Wanderungen (STRICT und alles), nicht
 * gegen einen Nachbau: jeder gescheiterte Schritt hinterlaesst wirklich eine
 * Zeile, und der Satz auf dem Schirm verspricht eine Nachreichung NUR dann,
 * wenn eine Zeile liegt UND der Vorgang bei der Sicherungseinrichtung
 * ueberhaupt existiert.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
  };
};

import {
  OHNE_EROEFFNUNG,
  ausfallSichern,
  istNachreichbar,
  meldungNachAusfall,
  tseQueueStore,
  type EnrichedTseQueueEntry,
  type TseAusfallSchritt,
} from './tse-queue-store.js';

const MIGRATIONS_DIR = new URL('../../src-tauri/migrations/', import.meta.url);

/** Alle Wanderungen, die diesen Tisch betreffen — keine Namensliste. */
function alleWanderungen(): string[] {
  const namen = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const treffer = namen
    .map((n) => readFileSync(new URL(n, MIGRATIONS_DIR), 'utf8'))
    .filter((s) => s.includes('tse_signature_queue'));
  if (treffer.length === 0) throw new Error('keine Wanderung fuer tse_signature_queue gefunden');
  return treffer;
}

/**
 * EINE Datenbank fuer die ganze Datei: `ausfallSichern` benutzt den Korb des
 * Moduls, und der merkt sich seine Verbindung nach dem ersten Zugriff. Der
 * Schalter `kaputt` macht daraus eine Kasse, deren oertlicher Speicher nicht
 * mehr schreibt — der einzige Fall echten Datenverlusts.
 */
const h = vi.hoisted(() => {
  const zustand = { kaputt: false, db: null as unknown };
  return zustand;
});

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: async () => h.db,
  },
}));

const sqlite = new DatabaseSync(':memory:');
for (const sql of alleWanderungen()) sqlite.exec(sql);
h.db = {
  async execute(sql: string, params: unknown[] = []) {
    if (h.kaputt) throw new Error('database is locked');
    sqlite.prepare(sql.replace(/\$\d+/g, '?')).run(...(params as never[]));
    return { rowsAffected: 1, lastInsertId: 0 };
  },
  async select(sql: string, params: unknown[] = []) {
    if (h.kaputt) throw new Error('database is locked');
    return sqlite.prepare(sql.replace(/\$\d+/g, '?')).all(...(params as never[]));
  },
};

function eintrag(over: Partial<EnrichedTseQueueEntry> = {}): EnrichedTseQueueEntry {
  return {
    intentionId: 'absicht-1',
    fiskalyTransactionId: 'ftx-1',
    tssId: 'tss-1',
    clientId: 'cli-1',
    serverTransactionId: 'srv-1',
    amountCents: 1990,
    paymentKind: 'CASH',
    amountsPerVatRate: [{ vatRate: 'NORMAL', amountCents: 1990 }],
    receiptType: 'RECEIPT',
    processType: 'Kassenbeleg-V1',
    receiptLocator: 'RCP-1',
    signature: null,
    createdAt: 1_760_000_000_000,
    ...over,
  };
}

function zeilen(intentionId: string): unknown[] {
  return sqlite
    .prepare('SELECT * FROM tse_signature_queue WHERE intention_id = ?')
    .all(intentionId);
}

beforeEach(() => {
  h.kaputt = false;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('⛔ jeder gescheiterte TSE-Schritt hinterlaesst eine Zeile', () => {
  it('EROEFFNUNG gescheitert: eine Zeile entsteht, ohne erfundene Vorgangsnummer', async () => {
    const e = eintrag({ intentionId: 'eroeffnung-1', fiskalyTransactionId: OHNE_EROEFFNUNG });

    const gesichert = await ausfallSichern(e, 'eroeffnung');

    expect(gesichert, 'der Ausfall muss dauerhaft gesichert sein').toBe(true);
    const gefunden = zeilen('eroeffnung-1') as Array<Record<string, unknown>>;
    expect(gefunden).toHaveLength(1);
    /**
     * ⚠️ HIER STAND `toBe('pending')` — UND DAS PINNTE DEN DEFEKT FEST.
     *
     * Eine Zeile ohne Eroeffnung kann nie nachgereicht werden (Begruendung in
     * `istNachreichbar`). Stand sie auf „wartend", las der Geraetemanager
     * daraus „Ausstehende TSE-Signaturen werden automatisch nachgereicht"
     * (`screens/secondary/GeraeteManager.tsx:1331`) — dauerhaft und falsch.
     */
    expect(gefunden[0]?.['status'], 'ein nicht nachreichbarer Ausfall darf nicht „wartend" sein').toBe(
      'failed_terminal',
    );
    // Nichts erfunden: die Absichtsnummer ist NICHT die Vorgangsnummer.
    expect(gefunden[0]?.['fiskaly_transaction_id']).toBe('');
    expect(gefunden[0]?.['fiskaly_transaction_id']).not.toBe('eroeffnung-1');
    // Die fiskalen Angaben liegen vollstaendig auf der Zeile.
    expect(gefunden[0]?.['amount_cents']).toBe(1990);
    expect(gefunden[0]?.['server_transaction_id']).toBe('srv-1');
    expect(gefunden[0]?.['payment_kind']).toBe('CASH');
  });

  it('ABSCHLUSS gescheitert: die Zeile traegt die ECHTE Vorgangsnummer und ist nachreichbar', async () => {
    const e = eintrag({ intentionId: 'abschluss-1', fiskalyTransactionId: 'ftx-echt' });

    expect(await ausfallSichern(e, 'abschluss')).toBe(true);

    const gefunden = zeilen('abschluss-1') as Array<Record<string, unknown>>;
    expect(gefunden).toHaveLength(1);
    expect(gefunden[0]?.['status'], 'ein nachreichbarer Ausfall gehoert in die Warteschlange').toBe(
      'pending',
    );
    expect(gefunden[0]?.['fiskaly_transaction_id']).toBe('ftx-echt');
    expect(gefunden[0]?.['signature_json']).toBeNull(); // Weg a: neu abschliessen
    const drainbar = await tseQueueStore.listDrainable(1_760_000_100_000);
    expect(drainbar.map((d) => d.intentionId)).toContain('abschluss-1');
  });

  it('liegt schon eine Zeile, wird nicht doppelt geschrieben und trotzdem WAHR gemeldet', async () => {
    const e = eintrag({ intentionId: 'doppelt-1' });
    expect(await ausfallSichern(e, 'abschluss')).toBe(true);
    expect(await ausfallSichern(e, 'abschluss')).toBe(true);
    expect(zeilen('doppelt-1')).toHaveLength(1);
  });

  it('⚠️ schreibt der oertliche Speicher nicht, wird das EHRLICH gemeldet', async () => {
    h.kaputt = true;
    const gesichert = await ausfallSichern(eintrag({ intentionId: 'verloren-1' }), 'eroeffnung');
    expect(gesichert, 'ohne Zeile darf nicht "gesichert" gemeldet werden').toBe(false);
    h.kaputt = false;
    expect(zeilen('verloren-1')).toHaveLength(0);
  });
});

describe('⛔ der Satz auf dem Schirm verspricht nur, was gemessen wurde', () => {
  const SCHRITTE: TseAusfallSchritt[] = ['keine_tse', 'eroeffnung', 'abschluss', 'melden'];
  /**
   * Ein Versprechen einer spaeteren Signatur — in jeder Beugung.
   *
   * ⚠️ 13.08.2026 ERWEITERT. Der Satz kommt seit heute aus
   * `lib/fiskalzustand-satz.ts`, und der Zustand „Melden gescheitert" heisst
   * dort genauer „wird nachgemeldet": der Beleg IST signiert, nur die Meldung
   * fehlt. Das alte Muster kannte dieses Wort nicht.
   *
   * Die Erweiterung macht den Waechter STRENGER, nicht milder: die Pruefungen,
   * die ein Versprechen VERBIETEN, fangen damit eine Formulierung mehr. Ein
   * Muster, das nur die Woerter von gestern kennt, laesst jede neue
   * Formulierung durch — und genau so entsteht die naechste stille Zusage.
   */
  const VERSPRICHT_NACHREICHUNG = /nachger|nachreich|nachhol|nachmeld|holt die Signatur|meldet sie selbst nach/i;

  /**
   * Der Satz benennt einen VERLUST. Beide Woerter sind zulaessig, weil beide
   * dasselbe sagen: es liegt nichts. Der Grossbuchstabe ist Teil der Messung —
   * „nicht gesichert" im Fliesstext waere ein Nebensatz, „NICHT" ist eine
   * Ansage.
   */
  const NENNT_DEN_VERLUST = /NICHT (?:gesichert|vermerkt)/;

  it('ohne Zeile verspricht KEIN Schritt eine Nachreichung, und der Verlust steht da', () => {
    for (const schritt of SCHRITTE) {
      const m = meldungNachAusfall(schritt, false, 'Verkauf');
      const text = `${m.title} ${m.body}`;
      expect(text, `${schritt}: verspricht eine Nachreichung, obwohl NICHTS gesichert ist`).not.toMatch(
        VERSPRICHT_NACHREICHUNG,
      );
      expect(text, `${schritt}: nennt den Verlust nicht`).toMatch(NENNT_DEN_VERLUST);
      expect(text, `${schritt}: sagt dem Kassierer nicht, was zu tun ist`).toMatch(
        /Beleg aufbewahren/,
      );
    }
  });

  it('⚠️ KEINE TSE und EROEFFNUNG versprechen auch MIT Zeile keine Nachreichung', () => {
    // Was die Sicherungseinrichtung nie gesehen hat, kann sie nicht
    // nachtraeglich signieren. Der Ausfall wird vermerkt, nicht geheilt.
    for (const schritt of ['keine_tse', 'eroeffnung'] as const) {
      const m = meldungNachAusfall(schritt, true, 'Verkauf');
      const text = `${m.title} ${m.body}`;
      expect(text, `${schritt}: verspricht eine Nachreichung, die unmoeglich ist`).not.toMatch(
        VERSPRICHT_NACHREICHUNG,
      );
      expect(text).toMatch(/KEINE Signatur/);
      expect(text).toMatch(/vermerkt/);
    }
  });

  it('Abschluss und Melden duerfen MIT Zeile eine Nachreichung versprechen', () => {
    for (const schritt of ['abschluss', 'melden'] as const) {
      const m = meldungNachAusfall(schritt, true, 'Verkauf');
      expect(`${m.title} ${m.body}`).toMatch(VERSPRICHT_NACHREICHUNG);
    }
  });

  it('⛔ genau die Schritte, die `istNachreichbar` bejaht, duerfen etwas versprechen', () => {
    // Ein Satz und eine Zeile stuetzen sich auf DIESELBE Entscheidung. Waeren
    // es zwei, koennte der Schirm etwas anderes sagen als der Korb tut.
    for (const schritt of SCHRITTE) {
      const m = meldungNachAusfall(schritt, true, 'Verkauf');
      const verspricht = VERSPRICHT_NACHREICHUNG.test(`${m.title} ${m.body}`);
      expect(verspricht, `${schritt}: Satz und Korb sind sich uneinig`).toBe(
        istNachreichbar(schritt),
      );
    }
  });

  it('kein englisches Wort, kein Unterstrich, kein Fehlercode im Text', () => {
    for (const schritt of SCHRITTE) {
      for (const eingereiht of [true, false]) {
        const m = meldungNachAusfall(schritt, eingereiht, 'Verkauf');
        const text = `${m.title} ${m.body}`;
        expect(text, `${schritt}/${String(eingereiht)}: Unterstrich im Text`).not.toMatch(/_/);
        expect(text, `${schritt}/${String(eingereiht)}: englisches Wort`).not.toMatch(
          /\b(queue|offline|failed|error|signature|pending|retry)\b/i,
        );
        // Der Satz beginnt mit dem, was GEHT: der Verkauf ist gebucht.
        expect(m.body).toMatch(/^Verkauf gebucht/);
      }
    }
  });

  /**
   * ⚠️ DER BEFUND VOM 13.08.2026 — „oertlich", „verstaendigen", „Geraete".
   *
   * Drei Ersatzschreibungen standen in Saetzen, die am Tresen gelesen werden.
   * Der Nachbarhinweis derselben Sache (`ohne-signatur-hinweis.ts:85`) machte
   * es von Anfang an richtig — es war also kein Zeichensatzproblem, sondern
   * eine Nachlaessigkeit, die kein Test bemerkt haette.
   *
   * Gemessen werden AUSGESCHRIEBENE Woerter, keine Buchstabenpaare: „neue",
   * „Steuer" und „Beleg aufbewahren" enthalten `ue` bzw. `ae` voellig zu Recht.
   */
  it('⛔ kein Umlaut ist durch zwei Buchstaben ersetzt', () => {
    const ERSATZSCHREIBUNGEN =
      /\b(oertlich\w*|verstaendig\w*|Geraet\w*|fuer|ueber\w*|waehrend|koenn\w*|muess\w*|naechst\w*|zurueck\w*|Schluessel\w*|Ausfaelle|dauerhaft\w*e?r? Ausfaelle)\b/i;
    for (const schritt of SCHRITTE) {
      for (const eingereiht of [true, false]) {
        const m = meldungNachAusfall(schritt, eingereiht, 'Verkauf');
        const text = `${m.title} ${m.body}`;
        const treffer = ERSATZSCHREIBUNGEN.exec(text);
        expect(
          treffer?.[0] ?? null,
          `${schritt}/${String(eingereiht)}: „${treffer?.[0] ?? ''}" gehoert mit Umlaut geschrieben`,
        ).toBeNull();
      }
    }
  });
});

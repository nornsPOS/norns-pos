/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ EIN VERMERKTER AUSFALL ERREICHT WIRKLICH SEIN ENDE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 13.08.2026 (NACHMESSUNG) ────────────────────────────────
 *
 * Die Luecke vor dem ersten TSE-Schritt war geschlossen worden: ein
 * gescheiterter Eroeffnungs-Schritt hinterliess endlich eine Zeile. Nur endete
 * diese Zeile nie. Gemessen an der echten Kette:
 *
 *   1. `ausfallSichern` schrieb sie als `pending`.
 *   2. `listDrainable` waehlte sie (tse-queue-store.ts).
 *   3. Der Nachreicher rief `finish` — das ist `tseClient.finish`, also
 *      `invoke('tse_finish_transaction')` (tse-queue-drain-hook.ts:41,
 *      hardware-client.ts:233).
 *   4. Rust lehnte ab mit `HardwareError::Device("Fiskaly PUT /tx (FINISHED)
 *      returned 404 …")`, serialisiert als `{ kind, details }`
 *      (src-tauri/src/error.rs:22).
 *   5. `istDauerhaftAbgelehnt` kannte weder `kind` noch `details`, las also
 *      keinen Status, sagte „voruebergehend" — und die Zeile ging zurueck auf
 *      `pending`. Fuer immer.
 *
 * FOLGE AUF DER FLAECHE: `screens/secondary/GeraeteManager.tsx:1326` zeigt bei
 * `pending > 0` und `failedTerminal === 0` den Satz „Ausstehende
 * TSE-Signaturen werden automatisch nachgereicht, sobald die TSE erreichbar
 * ist." Fuer diese Zeile war er dauerhaft falsch — dieselbe Luege wie vorher,
 * nur auf einer anderen Flaeche.
 *
 * ── WAS DIESE PRUEFUNG MISST ──────────────────────────────────────────────
 *
 * Gegen ECHTES SQLite mit den ECHTEN Wanderungen und durch den ECHTEN
 * Nachreicher (`drainTseQueue`), nicht gegen einen Nachbau:
 *
 *   A. Ein nicht nachreichbarer Ausfall steht sofort auf `failed_terminal`,
 *      wird auch ein Jahr spaeter nicht ausgewaehlt, und die Zahlen, die der
 *      Geraetemanager liest, ergeben den EHRLICHEN Satz.
 *   B. Ein nachreichbarer Ausfall bleibt wartend und wird bedient.
 *   C. Die Erkennung versteht die ECHTE Fehlerform der Bruecke.
 *   D. Und die ganze Kette zusammen: eine wartende Zeile, deren Abschluss die
 *      Bruecke dauerhaft ablehnt, erreicht `failed_terminal` — waehrend eine
 *      voruebergehende Ablehnung sie wartend laesst.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
  };
};

import type { TseSignature } from './hardware-client.js';
import { istDauerhaftAbgelehnt } from './tse-nachreichen-regel.js';
import { drainTseQueue } from './tse-queue-drain.js';
import {
  OHNE_EROEFFNUNG,
  ausfallSichern,
  istNachreichbar,
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

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => h.db } }));

const sqlite = new DatabaseSync(':memory:');
for (const sql of alleWanderungen()) sqlite.exec(sql);
h.db = {
  async execute(sql: string, params: unknown[] = []) {
    sqlite.prepare(sql.replace(/\$\d+/g, '?')).run(...(params as never[]));
    return { rowsAffected: 1, lastInsertId: 0 };
  },
  async select(sql: string, params: unknown[] = []) {
    return sqlite.prepare(sql.replace(/\$\d+/g, '?')).all(...(params as never[]));
  },
};

const JETZT = 1_760_000_000_000;
const EIN_JAHR_MS = 365 * 24 * 60 * 60 * 1000;

function eintrag(over: Partial<EnrichedTseQueueEntry> = {}): EnrichedTseQueueEntry {
  return {
    intentionId: 'absicht',
    fiskalyTransactionId: 'ftx-echt',
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
    createdAt: JETZT,
    ...over,
  };
}

function zeile(intentionId: string): Record<string, unknown> | undefined {
  return (
    sqlite.prepare('SELECT * FROM tse_signature_queue WHERE intention_id = ?').all(intentionId) as
      | Array<Record<string, unknown>>
      | undefined
  )?.[0];
}

/**
 * Genau die Rechnung, die der Geraetemanager macht
 * (`screens/secondary/GeraeteManager.tsx:1042` und `:1045`) — damit hier nicht
 * eine Zahl geprueft wird, die auf dem Schirm ganz anders zusammenkommt.
 */
async function wasDerGeraetemanagerSagt(): Promise<string> {
  const s = await tseQueueStore.getStats();
  const ausstehend = s.pending + s.inFlight + s.failedTerminal;
  if (ausstehend === 0) return 'nichts';
  return s.failedTerminal > 0
    ? 'Einige Signaturen konnten nicht übertragen werden. Bitte TSE-Verbindung prüfen.'
    : 'Ausstehende TSE-Signaturen werden automatisch nachgereicht, sobald die TSE erreichbar ist.';
}

/** Der Satz, der eine Heilung verspricht — in jeder Beugung. */
const VERSPRICHT_NACHREICHUNG = /nachger|nachreich|nachhol/i;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('⛔ A — ein nicht nachreichbarer Ausfall steht sofort und fuer immer auf endgueltig', () => {
  const NICHT_NACHREICHBAR: TseAusfallSchritt[] = ['keine_tse', 'eroeffnung'];

  for (const schritt of NICHT_NACHREICHBAR) {
    it(`${schritt}: endgueltig vermerkt, nie wieder ausgewaehlt`, async () => {
      const id = `ende-${schritt}`;
      expect(istNachreichbar(schritt), `${schritt} darf nicht als nachreichbar gelten`).toBe(false);

      expect(await ausfallSichern(eintrag({ intentionId: id, fiskalyTransactionId: OHNE_EROEFFNUNG }), schritt)).toBe(
        true,
      );

      const gefunden = zeile(id);
      expect(gefunden, 'der Ausfall muss dauerhaft festgehalten sein').toBeDefined();
      expect(gefunden?.['status']).toBe('failed_terminal');
      // Nie geloescht, zehn Jahre aufbewahrt.
      expect(Number(gefunden?.['retention_until'])).toBeGreaterThan(JETZT + 9 * EIN_JAHR_MS);

      // Weder jetzt noch in einem Jahr waehlt der Nachreicher sie aus.
      for (const wann of [JETZT, JETZT + EIN_JAHR_MS]) {
        const drainbar = await tseQueueStore.listDrainable(wann);
        expect(drainbar.map((d) => d.intentionId), `bei ${wann} doch ausgewaehlt`).not.toContain(id);
      }
    });
  }

  it('⚠️ und der Geraetemanager verspricht daraufhin KEINE Nachreichung mehr', async () => {
    const satz = await wasDerGeraetemanagerSagt();
    expect(satz, 'auf dem Schirm steht nichts').not.toBe('nichts');
    expect(satz, 'der Schirm verspricht eine Nachreichung, die es nie geben wird').not.toMatch(
      VERSPRICHT_NACHREICHUNG,
    );
  });
});

describe('⛔ B — ein nachreichbarer Ausfall bleibt wartend', () => {
  it('abschluss: wartend, ausgewaehlt, mit echter Vorgangsnummer', async () => {
    expect(istNachreichbar('abschluss')).toBe(true);
    expect(await ausfallSichern(eintrag({ intentionId: 'wartet-1' }), 'abschluss')).toBe(true);

    expect(zeile('wartet-1')?.['status']).toBe('pending');
    const drainbar = await tseQueueStore.listDrainable(JETZT);
    expect(drainbar.map((d) => d.intentionId)).toContain('wartet-1');
  });
});

describe('⛔ C — die Erkennung versteht die ECHTE Fehlerform der Bruecke', () => {
  /**
   * Woertlich die Saetze aus `src-tauri/src/commands/tse.rs`, in der Huelle aus
   * `src-tauri/src/error.rs` (`#[serde(tag = "kind", content = "details")]`).
   * KEIN `status`, KEIN `message` — genau daran scheiterte die Erkennung.
   */
  const bruecke = (kind: string, details: string): unknown => ({ kind, details });

  it('ein dauerhaft abgelehnter Rumpf wird als dauerhaft erkannt', () => {
    for (const status of [400, 404, 409, 422]) {
      expect(
        istDauerhaftAbgelehnt(
          bruecke('device', `Fiskaly PUT /tx (FINISHED) returned ${status} Bad Request: {}`),
        ),
        `${status} muss endgueltig sein`,
      ).toBe(true);
    }
  });

  it('voruebergehendes bleibt voruebergehend', () => {
    expect(istDauerhaftAbgelehnt(bruecke('network', 'error sending request for url'))).toBe(false);
    expect(istDauerhaftAbgelehnt(bruecke('timeout', 'operation timed out'))).toBe(false);
    expect(
      istDauerhaftAbgelehnt(bruecke('device', 'Fiskaly PUT /tx (FINISHED) returned 503: busy')),
    ).toBe(false);
    // Die Sitzung kommt von selbst zurueck — siehe SITZUNGS_STATUS.
    expect(
      istDauerhaftAbgelehnt(bruecke('device', 'Fiskaly PUT /tx (FINISHED) returned 401: expired')),
    ).toBe(false);
    expect(
      istDauerhaftAbgelehnt(bruecke('device', 'Fiskaly PUT /tx (FINISHED) returned 429: slow down')),
    ).toBe(false);
  });

  it('ohne jede Zahl im Satz bleibt es voruebergehend — im Zweifel weiterversuchen', () => {
    expect(istDauerhaftAbgelehnt(bruecke('internal', 'hardware not configured'))).toBe(false);
  });
});

describe('⛔ D — die ganze Kette: der Nachreicher bringt die Zeile wirklich ans Ende', () => {
  const signatur = (): TseSignature =>
    ({
      signatureValue: 'sig',
      signatureCounter: 1,
      signatureAlgorithm: 'ecdsa-plain-SHA384',
      tssSerialNumber: 'ser',
      transactionNumber: 1,
      startedAt: '2026-08-13T10:00:00.000Z',
      finishedAt: '2026-08-13T10:00:01.000Z',
      qrCodePayload: 'qr',
    }) as unknown as TseSignature;

  it('⚠️ eine dauerhafte Ablehnung der Bruecke endet auf endgueltig, nicht wieder auf wartend', async () => {
    await ausfallSichern(eintrag({ intentionId: 'kette-tot' }), 'abschluss');

    const ergebnis = await drainTseQueue({
      store: tseQueueStore,
      finish: async (e) => {
        if (e.intentionId !== 'kette-tot') return signatur();
        throw { kind: 'device', details: 'Fiskaly PUT /tx (FINISHED) returned 404 Not Found: {}' };
      },
      record: async () => undefined,
      now: () => JETZT + 1,
    });

    expect(ergebnis.terminal, 'die Zeile haette endgueltig werden muessen').toBeGreaterThanOrEqual(
      1,
    );
    expect(zeile('kette-tot')?.['status']).toBe('failed_terminal');
    // Und sie kommt nie wieder — auch nicht ein Jahr spaeter.
    const spaeter = await tseQueueStore.listDrainable(JETZT + EIN_JAHR_MS);
    expect(spaeter.map((d) => d.intentionId)).not.toContain('kette-tot');
  });

  it('eine voruebergehende Ablehnung laesst die Zeile wartend — eine Signatur wird nicht aufgegeben', async () => {
    await ausfallSichern(eintrag({ intentionId: 'kette-netz' }), 'abschluss');

    const ergebnis = await drainTseQueue({
      store: tseQueueStore,
      finish: async (e) => {
        if (e.intentionId !== 'kette-netz') return signatur();
        throw { kind: 'network', details: 'error sending request for url' };
      },
      record: async () => undefined,
      now: () => JETZT + 2,
    });

    expect(ergebnis.retryable).toBeGreaterThanOrEqual(1);
    expect(zeile('kette-netz')?.['status']).toBe('pending');
    expect(Number(zeile('kette-netz')?.['attempt_count'])).toBe(1);
  });
});

/**
 * ⛔ E — DER WIDERSPRUCH, DEN DER BEZAHLWEG MIT SICH TRUG
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Zweig OHNE hinterlegte Sicherungseinrichtung begruendete sein Schweigen
 * ausdruecklich damit, der Nachreicher liefe sonst „ewig" ins Leere. Genau
 * dieser Zustand war zur selben Stunde im Zweig darunter eingebaut. Aufgeloest
 * ist er so: BEIDE halten den Ausfall fest, KEINER stellt ihn zum Nachreichen.
 *
 * ⚠️ Gemessen wird der GEBRAUCH, nicht die Erwaehnung: die Kommentare fallen
 * vorher weg. Ein Zweig, der den Aufruf nur beschreibt, ist hier rot — und
 * genau das war der Zustand, den diese Pruefung fangen soll.
 */
describe('⛔ E — auch OHNE hinterlegte Sicherungseinrichtung wird der Ausfall festgehalten', () => {
  const DIALOG = new URL('../screens/verkauf/BezahlenDialog.tsx', import.meta.url);

  function zweigOhneTse(): string {
    const alle = readFileSync(DIALOG, 'utf8').split('\n');
    const von = alle.findIndex((z) => z.includes("=== 'keine_tse_hinterlegt') {"));
    if (von < 0) {
      throw new Error(
        'Der Zweig ohne hinterlegte Sicherungseinrichtung ist nicht mehr auffindbar — misst diese Pruefung noch den Bezahlweg?',
      );
    }
    const bis = alle.findIndex((z, i) => i > von && /^\s*\} else \{/.test(z));
    if (bis < 0) throw new Error('Der Zweig hat kein Ende mehr.');
    return alle
      .slice(von, bis)
      .filter((z) => {
        const t = z.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');
  }

  it('der Zweig schreibt wirklich eine Zeile, und zwar als NICHT nachreichbar', () => {
    const zweig = zweigOhneTse();
    expect(zweig, 'dieser Zweig sagt dem Kassierer etwas, ohne den Ausfall festzuhalten').toContain(
      'ausfallSichern(',
    );
    expect(zweig, 'der Schritt fehlt — dann entschiede nichts ueber die Nachreichbarkeit').toContain(
      "'keine_tse'",
    );
    expect(istNachreichbar('keine_tse'), 'sonst liefe der Nachreicher genau ins Leere').toBe(false);
  });
});

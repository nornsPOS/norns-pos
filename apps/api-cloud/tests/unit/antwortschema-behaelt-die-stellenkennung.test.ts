/**
 * ════════════════════════════════════════════════════════════════════════
 *  Das Antwortschema darf die Stellenkennung nicht abschneiden
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND (11.08.2026, 3 von 3 Stimmen) ────────────────────────────
 *
 * Die Stellenkennung (`stelle`, z. B. `NORNS-INVENTUR-SITZUNG-OFFEN`) wurde
 * gebaut, weil 194 Fehlerklassen auf 20 Codes fallen und allein 50 auf
 * CONFLICT. Der Haendler ruft an und sagt „es kam ein Konflikt" — davon gibt
 * es fuenfzig. Die Kennung ist die EINE Angabe, die zur Wurfstelle fuehrt.
 *
 * Live an der echten Kasse gemessen kam sie NIE an. Grund: 74 Routendateien
 * erklaeren ein eigenes `ErrorResponse`-Schema mit genau vier Feldern (code,
 * message, details?, requestId). `fast-json-stringify` streift jedes nicht
 * deklarierte Feld ab. Der Behandler setzt `stelle` — der Serialisierer wirft
 * es weg, lautlos. Dasselbe trifft `details` auf neun Routen, deren Schema
 * das Feld nicht kennt: die Belegnummer aus einem Zeitraumexport faellt weg.
 *
 * ── ⚠️ WARUM DER NAHELIEGENDE WEG FALSCH IST ────────────────────────────
 *
 * Naheliegend waere: `stelle` und `details` in die 74 Schemata nachtragen.
 * Das ist die Klasse „Waechter mit Namensliste wird blind" als Bauanleitung —
 * die 75. Routendatei bringt das Loch zurueck, und niemand merkt es, weil das
 * Feld ohne Fehlermeldung verschwindet. Der Fehlerkoerper gehoert NICHT der
 * einzelnen Route: er wird zentral in `plugins/error-handler.ts` gebaut. Also
 * muss die zentrale Stelle ihn auch zentral ausliefern.
 *
 * ── WAS DIESER WAECHTER MISST ───────────────────────────────────────────
 *
 * Die HTTP-ANTWORT, nicht das Objekt davor. Er baut eine echte Fastify-
 * Instanz mit dem ECHTEN Behandler und zwei Routen: eine mit einem knappen
 * Fehlerschema (wie die 74 im Haus), eine ohne. Beide werfen denselben
 * Domaenenfehler. Der gelesene Koerper muss in BEIDEN Faellen die Kennung
 * tragen. Eine Quelltextsuche haette hier gruen gemeldet — `err.stelle` steht
 * seit dem 09.08. im Behandler und erreichte den Draht trotzdem nicht.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { afterEach, describe, expect, it } from 'vitest';

import fehlerBehandler, { type ApiErrorCode, DomainError } from '../../src/plugins/error-handler.js';

/**
 * Woertlich die Gestalt aus `routes/inventory-sessions.ts:30` — vier Felder,
 * kein `stelle`, kein `details`. Genau so steht sie 465 mal im Haus.
 */
const KnappesFehlerschema = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
  }),
});

class InventurSitzungOffenError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

class BelegOhneSteuerschluesselError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
  public readonly details: { beleg: string };
  public constructor(message: string, beleg: string) {
    super(message);
    this.details = { beleg };
  }
}

async function buehne(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fehlerBehandler);

  app.get('/mit-schema', { schema: { response: { 409: KnappesFehlerschema } } }, async () => {
    throw new InventurSitzungOffenError('Es ist bereits eine Inventur offen.');
  });

  app.get('/ohne-schema', async () => {
    throw new InventurSitzungOffenError('Es ist bereits eine Inventur offen.');
  });

  app.get('/mit-schema-details', { schema: { response: { 409: KnappesFehlerschema } } }, async () => {
    throw new BelegOhneSteuerschluesselError('Beleg ohne Steuerschluessel.', 'B-2026-000123');
  });

  /** Ein 404 aus dem NotFound-Behandler, ebenfalls unter einem knappen Schema. */
  app.get('/mit-schema-404', { schema: { response: { 404: KnappesFehlerschema } } }, async () => {
    class SitzungUnbekanntError extends DomainError {
      public readonly httpStatus = 404;
      public readonly code: ApiErrorCode = 'NOT_FOUND';
    }
    throw new SitzungUnbekanntError('Inventory session 000 not found.');
  });

  await app.ready();
  return app;
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('⛔ Die Stellenkennung ueberlebt das Antwortschema', () => {
  it('⛔ ein knappes Fehlerschema darf `stelle` nicht abschneiden', async () => {
    app = await buehne();
    const antwort = await app.inject({ method: 'GET', url: '/mit-schema' });
    const koerper = JSON.parse(antwort.body) as { error: Record<string, unknown> };

    expect(antwort.statusCode).toBe(409);
    expect(
      koerper.error['stelle'],
      `Der Draht trug: ${antwort.body}\n` +
        'Das knappe Antwortschema hat die Stellenkennung abgestreift. Der Haendler ' +
        'kann am Telefon nur „es kam ein Konflikt" sagen — davon gibt es fuenfzig.',
    ).toBe('NORNS-INVENTUR-SITZUNG-OFFEN');
  });

  it('⚠️ die Gegenprobe: ohne Schema war sie immer schon da', async () => {
    app = await buehne();
    const antwort = await app.inject({ method: 'GET', url: '/ohne-schema' });
    const koerper = JSON.parse(antwort.body) as { error: Record<string, unknown> };
    expect(koerper.error['stelle']).toBe('NORNS-INVENTUR-SITZUNG-OFFEN');
  });

  it('⛔ und `details` faellt unter demselben Schema ebenfalls weg', async () => {
    app = await buehne();
    const antwort = await app.inject({ method: 'GET', url: '/mit-schema-details' });
    const koerper = JSON.parse(antwort.body) as {
      error: { details?: { beleg?: string }; stelle?: string };
    };
    expect(
      koerper.error.details?.beleg,
      `Der Draht trug: ${antwort.body}\n` +
        'Die Belegnummer aus einem Zeitraumexport ist die einzige Angabe, mit der ' +
        'jemand die Stelle unter hunderten Belegen findet.',
    ).toBe('B-2026-000123');
  });

  it('⛔ auch der 404 traegt seine Kennung', async () => {
    app = await buehne();
    const antwort = await app.inject({ method: 'GET', url: '/mit-schema-404' });
    const koerper = JSON.parse(antwort.body) as { error: Record<string, unknown> };
    expect(antwort.statusCode).toBe(404);
    expect(koerper.error['stelle']).toBe('NORNS-SITZUNG-UNBEKANNT');
  });

  it('⚠️ und der Koerper bleibt gueltiges JSON mit dem richtigen Inhaltstyp', async () => {
    // Der Fix umgeht den Schema-Serialisierer. Damit muss der Behandler den
    // Inhaltstyp selbst setzen — sonst antwortet Fastify `text/plain`, und
    // jeder Klient, der `response.json()` ruft, bekommt einen Parserfehler.
    app = await buehne();
    const antwort = await app.inject({ method: 'GET', url: '/mit-schema' });
    expect(antwort.headers['content-type']).toMatch(/application\/json/);
    expect(() => JSON.parse(antwort.body)).not.toThrow();
    const koerper = JSON.parse(antwort.body) as { error: { code: string; requestId: string } };
    expect(koerper.error.code).toBe('CONFLICT');
    expect(koerper.error.requestId).toEqual(expect.any(String));
  });
});

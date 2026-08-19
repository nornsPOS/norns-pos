import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { customersVerifyVatRoute } from '../../src/routes/customers-verify-vat.js';
import errorHandlerPlugin from '../../src/plugins/error-handler.js';

describe('customers-verify-vat route', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    await app.register(customersVerifyVatRoute);

    // Decorate request with mock auth to satisfy requireAuth and requireRole
    app.addHook('onRequest', async (req: FastifyRequest) => {
      // Diese Nachbildung war ZWEIFACH falsch, und beides fiel erst auf, als
      // die Tests am 26.07.2026 zum ersten Mal typgeprüft wurden: sie trug ein
      // `email`, das `Actor` gar nicht kennt, und ihr fehlte das erforderliche
      // `preferredLanguage`. Eine Nachbildung, die vom echten Typ abweicht,
      // prüft eine Welt, die es nicht gibt.
      req.actor = {
        id: 'actor-123',
        role: 'CASHIER',
        isOwner: false,
        preferredLanguage: 'de',
      };
      req.session = {
        userId: 'actor-123',
        actorId: 'actor-123',
        role: 'CASHIER',
      } as any;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects invalid format VAT IDs early without fetching VIES', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    // Too short after cleanup
    const res1 = await app.inject({
      method: 'GET',
      url: '/api/customers/verify-vat?vatId=DE%201', // length 4, cleans up to DE1 (length 3)
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.json()).toMatchObject({ valid: false, ergebnis: 'FORMFEHLER', error: 'INVALID_FORMAT' });

    // Invalid country code characters
    const res2 = await app.inject({
      method: 'GET',
      url: '/api/customers/verify-vat?vatId=1234567', // cleans up to 1234567, country code starts with 12
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json()).toMatchObject({ valid: false, ergebnis: 'FORMFEHLER', error: 'INVALID_FORMAT' });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns valid: true and VIES details when EU VIES returns isValid: true', async () => {
    const mockResponse = {
      isValid: true,
      name: 'Google Ireland Limited',
      address: 'Gordon House, Barrow Street, Dublin 4',
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/customers/verify-vat?vatId=IE6388047V',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      valid: true,
      name: 'Google Ireland Limited',
      address: 'Gordon House, Barrow Street, Dublin 4',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://ec.europa.eu/taxation_customs/vies/rest-api/ms/IE/vat/6388047V',
      expect.any(Object)
    );
  });

  it('replaces masked or empty details with --- (DE/ES privacy rules)', async () => {
    const mockResponse = {
      isValid: true,
      name: ' ', // empty name
      address: '---', // masked address
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/customers/verify-vat?vatId=DE123456789',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      valid: true,
      name: '---',
      address: '---',
    });
  });

  it('returns valid: false when EU VIES returns isValid: false', async () => {
    const mockResponse = {
      isValid: false,
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/customers/verify-vat?vatId=DE999999999',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      valid: false,
    });
  });

  it('handles VIES service non-200 outage gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/customers/verify-vat?vatId=DE123456789',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      valid: false,
      error: 'VIES_UNAVAILABLE',
      ergebnis: 'NICHT_ERREICHBAR',
    });
  });

  it('handles VIES lookup timeout gracefully', async () => {
    const abortError = new Error('The user aborted a request.');
    abortError.name = 'AbortError';

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortError);

    const res = await app.inject({
      method: 'GET',
      url: '/api/customers/verify-vat?vatId=DE123456789',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      valid: false,
      error: 'VIES_TIMEOUT',
      // ⚠️ NICHT 'UNGUELTIG': eine Zeitueberschreitung ist keine Aussage ueber
      // die Nummer. Vorher war beides `valid: false` und nicht zu unterscheiden.
      ergebnis: 'NICHT_ERREICHBAR',
    });
  });

  it('handles generic network/lookup errors gracefully as VIES_UNAVAILABLE', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('DNS lookup failed'));

    const res = await app.inject({
      method: 'GET',
      url: '/api/customers/verify-vat?vatId=DE123456789',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      valid: false,
      error: 'VIES_UNAVAILABLE',
      ergebnis: 'NICHT_ERREICHBAR',
    });
  });
});

/**
 * ⚠️ Die Unterscheidung, die es bis zum 26.07.2026 gar nicht gab.
 *
 * Die Route gab bei Zeitueberschreitung und bei Netzausfall `valid: false`
 * zurueck — GENAU DASSELBE wie bei einer wirklich ungueltigen Nummer. Ein
 * Aufrufer, der nur dieses Feld liest, haelt eine Stoerung bei der EU fuer
 * eine falsche USt-IdNr. und sagt das einem Geschaeftskunden ins Gesicht.
 *
 * Fiskalisch fuehren beide Faelle zum selben Ergebnis (kein § 13b), aber der
 * Satz fuer den Menschen ist ein voellig anderer.
 */
describe('Stoerung ist nicht dasselbe wie ungueltig', () => {
  it('das Antwortschema traegt `ergebnis` — sonst entfernt Fastify es still', async () => {
    // Dieselbe Falle wie beim Kursalter: was nicht im Antwortschema steht,
    // faellt aus der Antwort, ohne dass irgendwo ein Fehler auftaucht.
    const quelle = (await import('node:fs')).readFileSync(
      new URL('../../src/routes/customers-verify-vat.ts', import.meta.url),
      'utf8',
    );
    const schema = quelle.slice(
      quelle.indexOf('const ResponseSchema'),
      quelle.indexOf('const ErrorResponse'),
    );
    for (const feld of ['ergebnis', 'gespeichert']) {
      expect(schema, `${feld} fehlt im Antwortschema`).toContain(feld);
    }
    for (const wert of ['GUELTIG', 'UNGUELTIG', 'NICHT_ERREICHBAR', 'FORMFEHLER']) {
      expect(schema, `${wert} fehlt in der Aufzaehlung`).toContain(wert);
    }
  });

  it('es gibt genau EINEN Weg aus der Route, und der haelt fest', async () => {
    // Sechs Rueckgabestellen, und bei jeder einzeln „nicht vergessen, auch zu
    // speichern" ist die Sorte Vorsatz, die beim naechsten Zweig bricht.
    const quelle = (await import('node:fs')).readFileSync(
      new URL('../../src/routes/customers-verify-vat.ts', import.meta.url),
      'utf8',
    );
    expect(quelle.match(/reply\.status\(200\)\.send/g)?.length ?? 0).toBe(1);
    expect(quelle).toContain('vat_id_check_result');
  });
});

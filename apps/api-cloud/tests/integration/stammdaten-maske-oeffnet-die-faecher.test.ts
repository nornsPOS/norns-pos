/**
 * Die Stammdaten-Maske (Einstellungen → Betrieb) braucht eine offene Tür.
 *
 * ── WORUM ES GEHT (KOORDINATION §11.5, 28.07.2026) ──────────────────────────
 * Wanderung 0126 legte die Fächer des Steuerpflichtigen an — LEER, mit
 * Absicht. Der allgemeine `PATCH /api/settings/:key` fährt eine Allowlist
 * (`EDITABLE_SETTINGS`): was dort nicht steht, kann KEINE Oberfläche füllen,
 * egal wie fertig sie aussieht. Genau so ein toter Knopf wäre die Maske
 * gewesen: die Fächer standen in der Datenbank, die Tür war zu.
 *
 * Diese Datei beweist beides am ECHTEN Server (Testcontainer, echte
 * Migrationen, echte Inhaber-Sitzung mit Step-up):
 *
 *   1. Jeder Schlüssel, den die Maske schreibt, geht durch die Tür und
 *      kommt beim Lesen unverändert zurück.
 *   2. Die Tür ist trotzdem eine Tür: ein unbekannter Schlüssel prallt mit
 *      400 ab. Ohne diese Gegenprobe wäre Grün wertlos — eine Allowlist,
 *      die alles durchlässt, macht denselben Test auch grün.
 */

import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { baueFiskalBuehne } from '../helfer/fiskal-buehne.js';

/**
 * Von Hand abgeschrieben aus `BetriebSection.tsx`, NICHT importiert: ändert
 * die Maske ihre Schlüssel, muss dieser Test rot werden und die Frage
 * stellen, ob die Tür mitgezogen ist.
 */
const MASKEN_SCHLUESSEL = [
  'shop.legal_name',
  'shop.street',
  'shop.postal_code',
  'shop.city',
  'shop.country_code',
  'shop.tax_number',
  'shop.vat_id',
  'kasse.seriennummer',
] as const;

const PROBEWERTE: Record<(typeof MASKEN_SCHLUESSEL)[number], string> = {
  'shop.legal_name': 'Steinauge Handels GmbH',
  'shop.street': 'Am Alten Markt 3a, Hinterhaus',
  'shop.postal_code': '73614',
  'shop.city': 'Schorndorf',
  'shop.country_code': 'DEU',
  'shop.tax_number': '82/815/08155',
  'shop.vat_id': 'DE811907980',
  'kasse.seriennummer': 'W14-KASSE-0001',
};

describe('die Stammdaten-Maske öffnet die Fächer', () => {
  const buehne = baueFiskalBuehne({});

  beforeAll(async () => {
    await buehne.starten();
    await buehne.leeren(); // richtet die Akteure ein (Inhaber-Sitzung, Gerät)
  }, 180_000);

  afterAll(async () => {
    await buehne.stoppen();
  });

  function schreibe(schluessel: string, wert: string): Promise<LightMyRequestResponse> {
    const wer = buehne.akteure;
    return buehne.app.inject({
      method: 'PATCH',
      url: `/api/settings/${schluessel}`,
      headers: {
        cookie: `warehouse14.session=${wer.inhaberSitzung}`,
        'x-dev-device-fingerprint': wer.geraetFingerabdruck,
        'content-type': 'application/json',
      },
      payload: { value: wert },
    });
  }

  it('jeder Schlüssel der Maske geht durch und kommt unverändert zurück', async () => {
    for (const schluessel of MASKEN_SCHLUESSEL) {
      const antwort = await schreibe(schluessel, PROBEWERTE[schluessel]);
      expect(antwort.statusCode, `${schluessel}: ${antwort.body}`).toBe(200);
    }

    const wer = buehne.akteure;
    const gelesen = await buehne.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: {
        cookie: `warehouse14.session=${wer.inhaberSitzung}`,
        'x-dev-device-fingerprint': wer.geraetFingerabdruck,
      },
    });
    expect(gelesen.statusCode).toBe(200);
    const { settings } = gelesen.json() as {
      settings: Array<{ key: string; value: string }>;
    };
    const nachSchluessel = new Map(settings.map((z) => [z.key, z.value]));

    for (const schluessel of MASKEN_SCHLUESSEL) {
      const roh = nachSchluessel.get(schluessel);
      expect(roh, `${schluessel} fehlt in GET /api/settings`).toBeDefined();
      // `value::text` einer jsonb-Zeichenkette trägt Anführungszeichen —
      // dieselbe Auspack-Regel wie in der Maske.
      expect(JSON.parse(roh as string)).toBe(PROBEWERTE[schluessel]);
    }
  });

  it('die Tür bleibt eine Tür: ein unbekannter Schlüssel prallt mit 400 ab', async () => {
    const antwort = await schreibe('shop.erfundenes_fach', 'egal');
    expect(antwort.statusCode).toBe(400);
    expect(antwort.body).toContain('not editable');
  });
});

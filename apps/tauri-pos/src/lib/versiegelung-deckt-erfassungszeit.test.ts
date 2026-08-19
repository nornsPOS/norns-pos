/**
 * Die Versiegelung MUSS Erfassungszeit und Schicht mittragen (0118).
 *
 * ── WARUM DIESER TEST EXISTIERT ───────────────────────────────────────────
 *
 * Der ganze Fix von 0118 haengt an einer Bedingung, die man nicht sieht: die
 * vom Geraet erfasste Zeit und die Schicht des Kassierens muessen in DEMSELBEN
 * Rumpf stehen, den `sealFiscalRequest` versiegelt und `posIntentsStore.create`
 * VOR dem Netz auf Platte schreibt. Nur dann traegt der am naechsten Morgen
 * nachgespielte Beleg noch die Zeit von gestern 17:50.
 *
 * ⚠️ Wuerden die zwei Angaben spaeter angehaengt — etwa erst beim Senden, oder
 * beim Wiedereinspielen aus dem Ausgangskorb — truege der nachgespielte Beleg
 * wieder die Zeit des Nachspielens, und der Verkauf landete erneut im Z-Bon
 * des falschen Tages. Genau das war der gemeldete Fehler.
 *
 * Der Test faehrt die Kette, die auch die Wiederherstellung faehrt:
 * `sealFiscalRequest` → `sealedToOutboxRecord`. Was hier durchkommt, kommt
 * auch beim Nachspielen beim Server an.
 */

import { describe, expect, it } from 'vitest';

import { sealFiscalRequest, sealedToOutboxRecord } from './pos-intents-store.js';

const ERFASST_AM = '2026-07-25T15:50:00.000Z'; // gestern 17:50 Berliner Zeit
const SCHICHT = '11111111-2222-3333-4444-555555555555';

describe('0118 — die Versiegelung deckt Erfassungszeit und Schicht', () => {
  it('traegt beide Angaben unveraendert in die gesiegelte Anfrage', () => {
    const gesiegelt = sealFiscalRequest({
      baseUrl: 'https://api.warehouse14.de',
      path: '/api/transactions/finalize',
      body: {
        totalEur: '150.00',
        idempotencyKey: 'idem-1',
        erfasstAm: ERFASST_AM,
        shiftId: SCHICHT,
      },
      idempotencyKey: 'idem-1',
      deviceId: 'dev-1',
    });

    const rumpf = gesiegelt.body as Record<string, unknown>;
    expect(rumpf.erfasstAm).toBe(ERFASST_AM);
    expect(rumpf.shiftId).toBe(SCHICHT);
  });

  it('traegt beide Angaben durch das WIEDEREINSPIELEN hindurch', () => {
    const gesiegelt = sealFiscalRequest({
      baseUrl: 'https://api.warehouse14.de',
      path: '/api/transactions/finalize',
      body: {
        totalEur: '150.00',
        idempotencyKey: 'idem-1',
        erfasstAm: ERFASST_AM,
        shiftId: SCHICHT,
      },
      idempotencyKey: 'idem-1',
      deviceId: 'dev-1',
    });

    // Der Weg der Wiederherstellung: gesiegelt → auf Platte → Ausgangskorb.
    const wiederhergestellt = JSON.parse(JSON.stringify(gesiegelt)) as typeof gesiegelt;
    const eintrag = sealedToOutboxRecord(wiederhergestellt, Date.now());

    const rumpf = eintrag.body as Record<string, unknown>;
    // DAS ist der Kern: nach einer Nacht auf Platte steht dort immer noch die
    // Zeit des Kassierens, nicht die des Nachspielens.
    expect(rumpf.erfasstAm).toBe(ERFASST_AM);
    expect(rumpf.shiftId).toBe(SCHICHT);
    expect(eintrag.idempotencyKey).toBe('idem-1');
    expect(eintrag.gobdRelevant).toBe(true);
  });
});

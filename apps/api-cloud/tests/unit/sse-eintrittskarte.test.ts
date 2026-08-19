/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER SITZUNGSSCHLÜSSEL GEHÖRT NICHT IN EINE ADRESSZEILE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Am 26.07.2026 im Tunnelprotokoll gefunden und selbst nachgemessen: der Wert
 * hinter `access_token=` war der volle Anmeldeschlüssel. EIN Schlüssel in 24
 * Stunden, eine echte Zeile in `sessions`, **noch 4,7 Stunden gültig und nicht
 * widerrufen.** Sofort widerrufen.
 *
 * Er stand an zwei Orten, die niemand als Geheimnisspeicher betrachtet: im
 * Behälterprotokoll und in den Zugriffsprotokollen von Cloudflare — ausserhalb
 * jeder eigenen Kontrolle.
 */

import { describe, expect, it } from 'vitest';

import {
  KARTE_TTL_MS,
  loeseKarteEin,
  offeneKarten,
  stelleKarteAus,
} from '../../src/lib/sse-eintrittskarte.js';

const sitzung = { sessionId: 's-1', actor: { id: 'a-1' } };

describe('die Eintrittskarte', () => {
  it('loest sich zur hinterlegten Sitzung auf', () => {
    const k = stelleKarteAus(sitzung);
    // ⚠️ 08.08.2026: die eingeloeste Sitzung traegt jetzt zusaetzlich
    // `ausKarte: true`. Die Marke ist der zweite Riegel gegen den Kreislauf,
    // in dem eine Karte eine neue Karte loeste — siehe
    // `karte-erneuert-sich-nicht-selbst.test.ts`. Deshalb `toMatchObject`
    // statt `toEqual`: geprueft wird, dass die Sitzung DRIN ist, nicht dass
    // sonst nichts drin ist.
    expect(loeseKarteEin(k)).toMatchObject(sitzung);
  });

  it('⚠️ gilt GENAU EINMAL', () => {
    // Das ist die Eigenschaft, die einen Mitleser wirkungslos macht: selbst
    // innerhalb der 30 Sekunden kaeme er zu spaet, weil der rechtmaessige
    // Client die Karte im selben Atemzug einloest.
    const k = stelleKarteAus(sitzung);
    expect(loeseKarteEin(k)).toMatchObject(sitzung);
    expect(loeseKarteEin(k), 'die Karte laesst sich ein ZWEITES Mal einloesen').toBeNull();
  });

  it('⚠️ ist nach 30 Sekunden tot', () => {
    const t0 = 1_000_000;
    const k = stelleKarteAus(sitzung, t0);
    expect(loeseKarteEin(k, t0 + KARTE_TTL_MS - 1)).toMatchObject(sitzung);

    const k2 = stelleKarteAus(sitzung, t0);
    expect(loeseKarteEin(k2, t0 + KARTE_TTL_MS), 'eine abgelaufene Karte gilt noch').toBeNull();
  });

  it('⚠️ traegt den Sitzungsschluessel NIRGENDS', () => {
    // Der erste Entwurf hinterlegte ihn — und haette damit genau das getan, was
    // hier abgestellt wird: ein Geheimnis an einem zweiten Ort ablegen.
    const k = stelleKarteAus({ ...sitzung, token: 'GEHEIM-abc123' });
    expect(k).not.toContain('GEHEIM');
    expect(k).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it('zwei Karten sind nie gleich', () => {
    expect(stelleKarteAus(sitzung)).not.toBe(stelleKarteAus(sitzung));
  });

  it('eine unbekannte oder fehlende Karte loest nichts aus', () => {
    for (const murks of [undefined, '', 'gibt-es-nicht']) {
      expect(loeseKarteEin(murks), String(murks)).toBeNull();
    }
  });

  it('abgelaufene Karten haeufen sich NICHT an', () => {
    // Ohne den Kehraus wuechse die Karte unbegrenzt — und eine alte Karte
    // bliebe theoretisch auffindbar.
    //
    // ⚠️ Der erste Entwurf verglich die ABSOLUTE Zahl und wurde rot: die Karten
    // der vorigen Pruefungen leben noch, weil sie mit der echten Uhr angelegt
    // wurden. Ein Test, der fremden Zustand mitzaehlt, misst nicht das, was er
    // behauptet. Also die DIFFERENZ.
    const t0 = 2_000_000;
    const vorher = offeneKarten();
    for (let i = 0; i < 50; i += 1) stelleKarteAus(sitzung, t0);
    expect(offeneKarten()).toBe(vorher + 50);

    // Ein Ausstellen NACH dem Ablauf raeumt genau diese 50 weg.
    stelleKarteAus(sitzung, t0 + KARTE_TTL_MS + 1);
    expect(offeneKarten(), 'die 50 abgelaufenen Karten liegen noch da').toBe(vorher + 1);
  });
});

/**
 * ⚠️ Die Wächter gegen die Rückkehr des Schlüssels in die Adresszeile.
 */
describe('kein Sitzungsschluessel mehr in der Adresse', () => {
  const lies = async (p: string) =>
    (await import('node:fs')).readFileSync(new URL(p, import.meta.url), 'utf8');

  it('die Kasse haengt KEINEN access_token mehr an', async () => {
    const q = await lies('../../../tauri-pos/src/hooks/useLedgerStream.ts');
    const ohneKommentare = q
      .split('\n')
      .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z))
      .join('\n');
    expect(
      ohneKommentare.includes('access_token='),
      'die Kasse schreibt den Schluessel wieder in die Adresse',
    ).toBe(false);
    expect(ohneKommentare).toContain('/api/sse/ticket');
  });

  it('die Karte wird ueber POST geholt, nicht ueber GET', async () => {
    // Ein GET traegt seine Adresse in jedes Zugriffsprotokoll. Die Anmeldung
    // fuer diesen Aufruf steckt im Keks oder in einer Kopfzeile — beides
    // erscheint dort nicht.
    const q = await lies('../../src/routes/sse-ledger.ts');
    expect(q).toContain("app.post(\n    '/api/sse/ticket'");
  });

  it('der Server nimmt die Karte an', async () => {
    const q = await lies('../../src/plugins/auth.ts');
    expect(/(?<!as\s)\bloeseKarteEin\s*[<(]/.test(q), 'auth.ts loest keine Karte ein').toBe(true);
  });

  it('⚠️ der alte Weg steht noch — und das ist eine benannte Schuld', async () => {
    // Eine bereits ausgelieferte Kasse kennt die Karte nicht. Faellt
    // `access_token` sofort weg, verliert jedes laufende Geraet seinen Strom.
    //
    // Solange dieser Zweig steht, LECKT der Schluessel bei alten Clients
    // weiter. Diese Pruefung haelt fest, dass es eine WARNUNG dazu gibt —
    // sobald sie im Betrieb nicht mehr auftaucht, ist der Zweig tot und
    // gehoert entfernt.
    const q = await lies('../../src/plugins/auth.ts');
    expect(q).toContain('sse.veralteter_zugang');
  });
});

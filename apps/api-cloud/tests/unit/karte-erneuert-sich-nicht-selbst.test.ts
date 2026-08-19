/**
 * ════════════════════════════════════════════════════════════════════════
 *  Eine Eintrittskarte darf keine neue Eintrittskarte lösen
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
 *
 * Die Karte ist gut gebaut: 30 Sekunden, einmalig, sie trägt die aufgelöste
 * Sitzung statt des Schlüssels. Alle drei Eigenschaften waren wirkungslos.
 *
 * `plugins/auth.ts` liess die Karte für JEDEN Pfad gelten, der mit
 * `/api/sse/` beginnt. Die ausstellende Route heisst `POST /api/sse/ticket`
 * und beginnt genau so. Damit ging:
 *
 *   1. Ein Mitleser fischt eine Karte aus einem Protokoll.
 *   2. Er ruft `POST /api/sse/ticket?ticket=<Karte>`.
 *   3. Die Karte wird eingelöst, `req.session` steht, `requireAuth` und
 *      `requireRole('ADMIN')` gehen durch — die Karte TRÄGT ja eine
 *      Inhabersitzung.
 *   4. Die Route stellt eine FRISCHE Karte aus.
 *   5. Zurück zu Schritt 2, für immer.
 *
 * Aus dreissig Sekunden wird unbegrenzter Inhaberzugang. Die Einmaligkeit
 * hilft nicht: verbraucht wird die alte, zurück kommt eine neue.
 *
 * ── ZWEI RIEGEL, JEDER FÜR SICH AUSREICHEND ────────────────────────────
 *
 * 1. NUR GET. `EventSource` kann ausschliesslich GET. Ein POST konnte also
 *    nie eine Karte brauchen, und die ausstellende Route ist ein POST.
 * 2. Die eingelöste Sitzung trägt eine MARKE. Wer sie trägt, bekommt keine
 *    neue Karte, egal über welchen Weg er kommt.
 *
 * Der erste allein genügte heute. Der zweite hält auch, wenn morgen jemand
 * eine ausstellende Route als GET baut. Beide bleiben.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  darfMitKarteRein,
  loeseKarteEin,
  offeneKarten,
  stelleKarteAus,
} from '../../src/lib/sse-eintrittskarte.js';

describe('⛔ Womit eine Karte NICHT hineinkommt', () => {
  it('nicht in die ausstellende Route — das war der Kreislauf', () => {
    expect(darfMitKarteRein('POST', '/api/sse/ticket')).toBe(false);
  });

  it('⚠️ auch dann nicht, wenn sie eines Tages ein GET wäre', () => {
    /**
     * Ohne diesen Satz misst nichts den Ausschluss der ausstellenden Route:
     * heute ist sie ein POST, und die Methodenprüfung fängt sie schon. Bei
     * einer Sabotage, die NUR den Ausschluss entfernt, bliebe alles grün —
     * gemessen am 08.08.2026, und deshalb steht dieser Satz hier.
     *
     * Er ist der einzige, der den zweiten Riegel wirklich prüft.
     */
    expect(darfMitKarteRein('GET', '/api/sse/ticket')).toBe(false);
  });

  it('in KEINE schreibende Anfrage, egal auf welchem Pfad', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(darfMitKarteRein(m, '/api/sse/ledger'), m).toBe(false);
    }
  });

  it('nicht ausserhalb des Live-Strom-Bereichs', () => {
    for (const p of ['/api/transactions/finalize', '/api/closings/finalize', '/api/settings']) {
      expect(darfMitKarteRein('GET', p), p).toBe(false);
    }
  });

  it('⚠️ und nicht über einen Pfad, der nur so AUSSIEHT', () => {
    // Ein Präfixvergleich ohne Grenze lässt `/api/sse/../settings` und
    // `/api/sseX/…` durch. Beides sind fremde Wege mit vertrautem Anfang.
    expect(darfMitKarteRein('GET', '/api/sseX/ledger')).toBe(false);
    expect(darfMitKarteRein('GET', '/api/sse/../settings')).toBe(false);
  });
});

describe('✅ Was weiterhin hineinkommt', () => {
  it('der Live-Strom selbst, als GET', () => {
    expect(darfMitKarteRein('GET', '/api/sse/ledger')).toBe(true);
  });

  it('auch mit angehängter Abfrage', () => {
    expect(darfMitKarteRein('GET', '/api/sse/ledger?ticket=abc&since=7')).toBe(true);
  });

  it('und ein künftiger zweiter Strom, ohne dass jemand eine Liste pflegt', () => {
    // Ein neuer Strom ist ein GET unter `/api/sse/`. Er soll ohne Zutun
    // funktionieren; nur das AUSSTELLEN bleibt ausgeschlossen.
    expect(darfMitKarteRein('GET', '/api/sse/kassenlade')).toBe(true);
  });

  it('die Methode wird gross wie klein geschrieben verstanden', () => {
    expect(darfMitKarteRein('get', '/api/sse/ledger')).toBe(true);
  });
});

describe('⛔ Die MARKE: eine eingelöste Sitzung löst keine zweite Karte', () => {
  it('die eingelöste Sitzung ist als „aus einer Karte" erkennbar', () => {
    const karte = stelleKarteAus({ actor: { id: 'u1', role: 'ADMIN' } });
    const sitzung = loeseKarteEin<{ ausKarte?: boolean }>(karte);
    expect(sitzung).not.toBeNull();
    expect(sitzung?.ausKarte, 'die Marke fehlt').toBe(true);
  });

  it('⚠️ die hinterlegte Sitzung selbst wird dabei NICHT verändert', () => {
    // Sonst trüge die Sitzung des ehrlichen Anmelders die Marke mit, sobald
    // sie einmal in einer Karte lag, und der Inhaber bekäme danach nie wieder
    // eine Karte. Ein Riegel, der den Alltag blockiert, wird abgeschaltet.
    const original: { actor: { id: string }; ausKarte?: boolean } = { actor: { id: 'u1' } };
    loeseKarteEin(stelleKarteAus(original));
    expect(original.ausKarte).toBeUndefined();
  });
});

describe('Die Karte bleibt, was sie war', () => {
  it('einmalig: das zweite Einlösen gibt nichts', () => {
    const karte = stelleKarteAus({ actor: { id: 'u1' } });
    expect(loeseKarteEin(karte)).not.toBeNull();
    expect(loeseKarteEin(karte)).toBeNull();
  });

  it('kurzlebig: nach 30 Sekunden ist sie tot', () => {
    const t0 = 1_000_000;
    const karte = stelleKarteAus({ actor: { id: 'u1' } }, t0);
    expect(loeseKarteEin(karte, t0 + 29_999)).not.toBeNull();

    const zweite = stelleKarteAus({ actor: { id: 'u1' } }, t0);
    expect(loeseKarteEin(zweite, t0 + 30_001)).toBeNull();
  });

  it('und sie räumt sich weg, statt sich anzusammeln', () => {
    const t0 = 2_000_000;
    stelleKarteAus({ actor: { id: 'u1' } }, t0);
    stelleKarteAus({ actor: { id: 'u2' } }, t0);
    expect(offeneKarten()).toBeGreaterThanOrEqual(2);
    // Ein Ausstellen nach Ablauf kehrt die alten weg.
    stelleKarteAus({ actor: { id: 'u3' } }, t0 + 60_000);
    expect(offeneKarten()).toBe(1);
  });
});

describe('⛔ Die Regel ist ANGESCHLOSSEN, nicht nur geschrieben', () => {
  it('der Anmeldeweg entscheidet über `darfMitKarteRein`, nicht über einen Präfixvergleich', () => {
    /**
     * Ohne diesen Satz wäre die Regel eine reine Funktion, die niemand ruft —
     * die Klasse „gebaut und nie angeschlossen". Der alte Vergleich
     * `req.url.startsWith('/api/sse/')` darf nicht zurückkehren.
     */
    const quelle = readFileSync(
      new URL('../../src/plugins/auth.ts', import.meta.url).pathname,
      'utf8',
    );
    expect(/(?<!as\s)\bdarfMitKarteRein\s*\(/.test(quelle), 'der Riegel wird nicht gerufen').toBe(
      true,
    );
    expect(
      quelle.includes("req.url.startsWith('/api/sse/')"),
      'der alte Präfixvergleich steht wieder da',
    ).toBe(false);
  });

  it('die ausstellende Route weist eine markierte Sitzung ab', () => {
    const quelle = readFileSync(
      new URL('../../src/routes/sse-ledger.ts', import.meta.url).pathname,
      'utf8',
    );
    expect(/ausKarte/.test(quelle), 'der zweite Riegel fehlt in der Route').toBe(true);
  });
});

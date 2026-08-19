/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EIN UNBEKANNTER STEUERSCHLÜSSEL DARF NICHT STILL AUF 19 % FALLEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Am 26.07.2026 gefunden, und zwar an ZWEI Stellen derselben Datei:
 *
 *     const m = ERLOES_JE_BEHANDLUNG[code] ?? {
 *       konto: 'erloeseStandard19', bu: '',
 *     };
 *
 * Ein Umsatz mit einem Schlüssel, den die Tabelle nicht kennt, wurde also auf
 * SKR03 8400 gebucht — Erlöse 19 Prozent — mit LEEREM Buchungsschlüssel.
 *
 * Das ist nicht „unvollständig", sondern **falsch und still**. Der
 * Steuerberater sieht einen 19-Prozent-Erlös, wo keiner war, und nichts im
 * Export deutet darauf hin. Es fällt Monate später auf, wenn der Monat längst
 * festgeschrieben ist.
 *
 * Auf der Produktion gemessen: **1 Vorgang über 464,00 EUR** trug `MIXED` und
 * wurde genau so gebucht. `REVERSE_CHARGE_13B` hatte 0 — der frisch gebaute
 * Riegel macht ihn jetzt aber möglich, und dann wäre es der zweite Fall.
 */

import { describe, expect, it } from 'vitest';

import { KONTO_IDS, VORLAGE } from '../../src/lib/kontenrahmen.js';

describe('die beiden fehlenden Konten', () => {
  it('§ 13b und § 19 haben jetzt ein eigenes Erloeskonto', () => {
    expect(KONTO_IDS).toContain('erloeseReverseCharge13b');
    expect(KONTO_IDS).toContain('erloeseKleinunternehmer19');
  });

  it('und zwar in BEIDEN Kontenrahmen', () => {
    // Ein Konto, das nur in SKR03 existiert, laesst jeden SKR04-Mandanten
    // auflaufen — und zwar erst beim Export, also spaet.
    for (const rahmen of ['SKR03', 'SKR04'] as const) {
      for (const id of ['erloeseReverseCharge13b', 'erloeseKleinunternehmer19'] as const) {
        expect(VORLAGE[rahmen][id], `${rahmen}.${id}`).toMatch(/^\d{4}$/);
      }
    }
  });

  it('⚠️ SKR03 und SKR04 tragen NICHT dieselbe Nummer', () => {
    // Beim Ergaenzen ist mir der SKR04-Text einmal in den SKR03-Block
    // gerutscht. Waere die Zahl mitgewandert, haette jeder SKR04-Mandant auf
    // SKR03-Konten gebucht — und das faellt beim Steuerberater auf, nicht hier.
    for (const id of ['erloeseReverseCharge13b', 'erloeseKleinunternehmer19'] as const) {
      expect(VORLAGE.SKR03[id], id).not.toBe(VORLAGE.SKR04[id]);
    }
  });

  it('jede Kontonummer ist in BEIDEN Rahmen eindeutig', () => {
    // Zwei Erloesarten auf derselben Nummer heben die Trennung auf, fuer die
    // sie angelegt wurden.
    for (const rahmen of ['SKR03', 'SKR04'] as const) {
      const zahlen = Object.values(VORLAGE[rahmen]);
      expect(new Set(zahlen).size, rahmen).toBe(zahlen.length);
    }
  });
});

/**
 * ⚠️ Der Wächter gegen die Rückkehr des stillen Rückfalls.
 */
describe('kein stiller Rueckfall mehr im Export', () => {
  const lies = async () =>
    (await import('node:fs')).readFileSync(
      new URL('../../src/routes/closing-export.ts', import.meta.url),
      'utf8',
    );

  it('⛔ nirgends faellt ein unbekannter Schluessel auf die 19-Prozent-Erloese', async () => {
    const q = await lies();
    const ohneKommentare = q
      .split('\n')
      .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z))
      .join('\n');
    expect(
      ohneKommentare.includes("'erloeseStandard19' as KontoId"),
      'der stille Rueckfall ist zurueck — ein unbekannter Schluessel wird wieder als 19 % gebucht',
    ).toBe(false);
  });

  it('stattdessen bricht der Export ab', async () => {
    const q = await lies();
    expect(q).toContain('UnbekannteSteuerbehandlungError');
    expect(/(?<!as\s)\berloesFuer\s*\(/.test(q), 'die Aufloesung laeuft nicht ueber erloesFuer').toBe(
      true,
    );
  });

  it('⚠️ MIXED steht ABSICHTLICH nicht in der Tabelle', async () => {
    // Ein gemischter Beleg hat keinen einzelnen Erloeskonto-Platz. Er muss je
    // ZEILE aufgeloest werden — und solange das nicht gebaut ist, darf er
    // nicht so tun, als sei er ein 19-Prozent-Umsatz.
    const q = await lies();
    const tabelle = q.slice(
      q.indexOf('const ERLOES_JE_BEHANDLUNG'),
      q.indexOf('UnbekannteSteuerbehandlungError'),
    );
    expect(tabelle).toContain('REVERSE_CHARGE_13B:');
    expect(tabelle).toContain('KLEINUNTERNEHMER_19:');
    expect(tabelle.includes('MIXED:'), 'MIXED bekaeme ein Konto, das es nicht geben darf').toBe(
      false,
    );
  });

  /**
   * ⚠️ 27.07.2026 geändert, und der Grund gehört hierher.
   *
   * Diese Prüfung verlangte, dass BEIDE Zahlen als „NICHT belegt" markiert
   * sind — auch 8337. Sie schrieb damit meine eigene Fehleinschätzung fest:
   * ich hatte 8337 am 26.07. als unbelegt eingetragen, OHNE die Hausrecherche
   * zu lesen, in der sie längst stand. `beraterpraxis.md` §3.2 zitiert ECOVIS
   * wörtlich: 8337 heisst „Erlöse aus Leistungen, für die der Leistungs-
   * empfänger die Umsatzsteuer nach § 13b UStG schuldet".
   *
   * Die ABSICHT der Prüfung war richtig und bleibt: eine ungesicherte Zahl
   * muss als solche erkennbar sein. Nur der Befund war falsch.
   */
  it('jede Kontonummer sagt, ob sie belegt ist — und 8195 ist es NICHT', async () => {
    const q = (await import('node:fs')).readFileSync(
      new URL('../../src/lib/kontenrahmen.ts', import.meta.url),
      'utf8',
    );
    const quelle = q.slice(q.indexOf('export const QUELLE'));

    // ── 19.08.2026: aus „ungesichert" wurde „unbrauchbar" ──────────────────
    //
    // Der amtliche SKR03 2026 führt 8195 nur noch als „R 8195-96" (reserviert,
    // erst nach Funktionszuteilung bebuchbar), und 4195 gibt es im SKR04 gar
    // nicht. Die QUELLE-Zeile muss also mehr sagen als „nicht belegt": sie
    // muss den Steuerberater ZWINGEND verlangen, bevor ein Kleinunternehmer
    // exportiert.
    const kl = quelle.indexOf('erloeseKleinunternehmer19');
    expect(kl, 'erloeseKleinunternehmer19 fehlt in QUELLE').toBeGreaterThan(0);
    const klText = quelle.slice(kl, kl + 700);
    expect(klText).toContain('unbrauchbar');
    expect(klText).toContain('Steuerberater');
    expect(klText).toContain('reserviert');

    // 8337 ist belegt und nennt die Quelle.
    const rc = quelle.indexOf('erloeseReverseCharge13b');
    expect(rc, 'erloeseReverseCharge13b fehlt in QUELLE').toBeGreaterThan(0);
    const rcText = quelle.slice(rc, rc + 500);
    expect(rcText).toContain('BELEGT');
    expect(rcText).toContain('beraterpraxis.md');
  });

  it('⚠️ und die zwei § 25a-Konten nennen ihre Quelle ebenfalls', async () => {
    // Sie tragen 5.393,19 EUR Umsatzsteuer, die vorher in keiner Zeile stand.
    // Eine Zahl dieses Gewichts ohne Herkunftsangabe wäre unvertretbar.
    const q = (await import('node:fs')).readFileSync(
      new URL('../../src/lib/kontenrahmen.ts', import.meta.url),
      'utf8',
    );
    const quelle = q.slice(q.indexOf('export const QUELLE'));
    for (const id of ['erloeseMargin25aEinkaufsanteil', 'erloeseMargin25aMarge']) {
      const i = quelle.indexOf(id);
      expect(i, `${id} fehlt in QUELLE`).toBeGreaterThan(0);
      const text = quelle.slice(i, i + 500);
      expect(text, id).toContain('BELEGT');
      expect(text, id).toContain('beraterpraxis.md');
    }
  });
});

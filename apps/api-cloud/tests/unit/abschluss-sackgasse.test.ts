/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EIN ANGEFANGENER KASSENSTURZ SPERRTE DEN TAG FÜR IMMER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `closings-finalize.ts:113` fragte:
 *
 *     SELECT id FROM daily_closings WHERE business_day = … LIMIT 1
 *     if (existing[0]) throw ClosingConflictError('besteht bereits')
 *
 * Also: „gibt es eine Zeile?" statt „ist der Tag FESTGESCHRIEBEN?".
 *
 * Ein Abschluss beginnt im Zustand COUNTING — der Kassensturz läuft. Bricht er
 * dort ab, bleibt die Zeile stehen, `finalized_at` ist NULL, und ihre blosse
 * EXISTENZ verhindert danach jeden weiteren Versuch. Eine Sackgasse ohne
 * Ausgang.
 *
 * ── An der Produktion gemessen ───────────────────────────────────────────
 *
 *     daily_closings:  GENAU EINE Zeile im ganzen System
 *     business_day     2026-06-08
 *     state            COUNTING
 *     counted_at       NULL      ← nie zu Ende gezählt
 *     finalized_at     NULL      ← nie festgeschrieben
 *
 * An diesem Tag hängen **33 Belege über 12.523,32 EUR**. Er ist der
 * umsatzstärkste Junitag, und er war dauerhaft unabschliessbar.
 *
 * § 146 Abs. 1 Satz 2 AO verlangt, Kasseneinnahmen TÄGLICH festzuhalten. Ein
 * Tag, den die Software nicht mehr abschliessen kann, ist kein Betriebsunfall,
 * sondern ein Aufzeichnungsmangel.
 */

import { describe, expect, it } from 'vitest';

const lies = async () =>
  (await import('node:fs')).readFileSync(
    new URL('../../src/routes/closings-finalize.ts', import.meta.url),
    'utf8',
  );

describe('⛔ die Sackgasse', () => {
  it('die Existenzpruefung fragt nach FESTGESCHRIEBEN, nicht nach der Zeile', async () => {
    const q = await lies();
    const i = q.indexOf('Not already finalized for this day');
    const block = q.slice(i, i + 2200);

    // Die Abfrage muss `finalized_at` lesen — sonst kann sie den Unterschied
    // gar nicht kennen.
    expect(block, 'die Abfrage liest finalized_at nicht').toContain('finalized_at IS NOT NULL');
    // Und die Ablehnung muss daran haengen, nicht an `existing[0]` allein.
    expect(block, 'abgelehnt wird bei blosser Existenz').toContain('existing[0]?.finalized');
  });

  it('⚠️ und die alte, sperrende Form ist WEG', async () => {
    const q = await lies();
    const i = q.indexOf('Not already finalized for this day');
    const block = q
      .slice(i, i + 2200)
      .split('\n')
      .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z))
      .join('\n');
    expect(
      /if \(existing\[0\]\) \{/.test(block),
      'die blosse Existenz sperrt wieder — der Tag waere erneut unabschliessbar',
    ).toBe(false);
  });

  it('ein liegengebliebener Satz wird ERSETZT, nicht ergaenzt', async () => {
    // Er traegt Zwischenstaende eines abgebrochenen Kassensturzes. Die duerfen
    // nicht in den festgeschriebenen Satz einfliessen — sonst stuende dort ein
    // halb gezaehlter Kassenbestand als Tatsache.
    const q = await lies();
    expect(q).toContain('DELETE FROM daily_closings');
    const i = q.indexOf('DELETE FROM daily_closings');
    expect(q.slice(i, i + 200), 'die Loeschung trifft auch festgeschriebene Saetze').toContain(
      'finalized_at IS NULL',
    );
  });

  it('⚠️ und sie wird PROTOKOLLIERT', async () => {
    // Ein Satz, der still verschwindet, ist bei einer Nachschau nicht
    // erklaerbar. Der Pruefer sieht eine Luecke im Zustandsverlauf.
    const q = await lies();
    expect(q).toContain('liegengebliebener COUNTING-Satz wird ersetzt');
  });
});

describe('was NICHT aufgeweicht wurde', () => {
  it('ein FESTGESCHRIEBENER Tag bleibt unantastbar', async () => {
    const q = await lies();
    const i = q.indexOf('existing[0]?.finalized');
    expect(q.slice(i, i + 160)).toContain('ClosingConflictError');
  });

  it('eine offene Schicht sperrt den Tag weiterhin', async () => {
    // Solange eine Kasse offen ist, ist der Bargeldbestand unbekannt.
    const q = await lies();
    expect(q).toContain("status = 'OPEN'");
    expect(q).toContain('Bitte zuerst die Schicht abschließen');
  });

  it('Belege ohne Kassensturz sperren weiterhin', async () => {
    // Sonst wuerde ein Bargeldbestand von 0 als Tatsache gebucht.
    const q = await lies();
    expect(q).toContain('txTotal > 0 && closedShifts === 0');
  });

  it('und ohne Hauptbuch-Anker wird nicht festgeschrieben', async () => {
    const q = await lies();
    expect(q).toContain('Kein Ledger-Anker vorhanden');
  });
});

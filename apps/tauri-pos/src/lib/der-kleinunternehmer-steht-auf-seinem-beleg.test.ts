/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Der Kleinunternehmer steht auf seinem Beleg (20.08.2026)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER FUND ───────────────────────────────────────────────────────────────
 *
 * § 19 UStG: wer die Kleinunternehmerregelung nutzt, weist KEINE Umsatzsteuer
 * aus, und sein Beleg muss den Hinweis darauf tragen. Der Server prüfte den
 * Status seit jeher (`lib/steuermodus.ts`), stellte den fertigen Pflichtsatz
 * her — und die Route warf ihn weg. Die Kasse fragte den Status nie ab.
 * Ergebnis: in JEDER Fassung dieser Kasse trug der Beleg eines
 * Kleinunternehmers den Pflichthinweis nicht.
 *
 * ── DIE ZWEITE HÄLFTE, DIE TEURER IST ──────────────────────────────────────
 *
 * Wer als Kleinunternehmer Steuer AUSWEIST, schuldet sie nach § 14c Abs. 2
 * UStG dem Finanzamt — auch wenn er sie nie eingenommen hat. Der Ausweis
 * muss also nicht nur „nicht gedruckt", sondern rechnerisch null sein.
 *
 * Beide Hälften stehen hier fest.
 */

import { describe, expect, it } from 'vitest';

import { HINWEIS_KLEINUNTERNEHMER, steuerausweisFuerBeleg } from './beleg-steuerausweis.js';

/** Eine gewöhnliche Zeile mit Regelsteuersatz. */
const ZEILE_19 = {
  taxTreatmentCode: 'STANDARD_19' as const,
  lineVatCents: 190n,
  appliedVatRate: '0.1900',
};

describe('Der Beleg eines Kleinunternehmers', () => {
  it('⛔ trägt den Pflichthinweis nach § 19 UStG', () => {
    const a = steuerausweisFuerBeleg([ZEILE_19], null, 'KLEINUNTERNEHMER_19');
    expect(a.hinweise).toContain(HINWEIS_KLEINUNTERNEHMER);
  });

  it('⛔ weist KEINE Umsatzsteuer aus (§ 14c Abs. 2 UStG)', () => {
    // Selbst wenn eine Zeile rechnerisch Steuer trägt: unter § 19 wird nichts
    // ausgewiesen. Ein ausgewiesener Betrag wäre geschuldete Steuer.
    const a = steuerausweisFuerBeleg([ZEILE_19], null, 'KLEINUNTERNEHMER_19');
    expect(a.ausweisbareVatCents).toBeNull();
  });

  it('lässt die Regelbesteuerung unverändert', () => {
    const a = steuerausweisFuerBeleg([ZEILE_19], null, 'REGELBESTEUERUNG');
    expect(a.hinweise).not.toContain(HINWEIS_KLEINUNTERNEHMER);
    expect(a.ausweisbareVatCents).toBe(190n);
  });

  it('verhält sich ohne Angabe wie bisher (der Server weist die Kasse ohnehin ab)', () => {
    const a = steuerausweisFuerBeleg([ZEILE_19]);
    expect(a.hinweise).not.toContain(HINWEIS_KLEINUNTERNEHMER);
    expect(a.ausweisbareVatCents).toBe(190n);
  });

  it('setzt den Hinweis NEBEN die Hinweise der Steuerarten, nicht statt ihrer', () => {
    // Ein Kleinunternehmer, der ein Stück nach § 25a verkauft: beide Sätze
    // gehören auf den Beleg.
    const a = steuerausweisFuerBeleg(
      [{ taxTreatmentCode: 'MARGIN_25A', lineVatCents: 0n, appliedVatRate: null }],
      null,
      'KLEINUNTERNEHMER_19',
    );
    expect(a.hinweise).toContain('Differenzbesteuerung nach § 25a UStG.');
    expect(a.hinweise).toContain(HINWEIS_KLEINUNTERNEHMER);
  });
});

describe('Der Wortlaut steht nur EINMAL im Haus', () => {
  it('⛔ die Kasse spricht denselben Satz wie der Motor', async () => {
    // Zwei Fassungen desselben Rechtssatzes sind eine zu viel: der Motor
    // (`lib/steuermodus.ts`) prüft gegen SEINEN Wortlaut, die Kasse druckt
    // ihren. Driften sie, weist der Motor den Beleg der Kasse ab — und
    // niemand versteht warum.
    const { readFileSync } = await import('node:fs');
    const { dirname, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const hier = dirname(fileURLToPath(import.meta.url));
    const motor = readFileSync(
      resolve(hier, '../../../api-cloud/src/lib/steuermodus.ts'),
      'utf8',
    );
    const treffer = /HINWEIS_19 = '([^']+)'/.exec(motor);
    expect(treffer, 'HINWEIS_19 ist im Motor nicht mehr auffindbar').not.toBeNull();
    expect(treffer![1]).toBe(HINWEIS_KLEINUNTERNEHMER);
  });
});

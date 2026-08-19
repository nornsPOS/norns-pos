/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REGELBESTEUERUNG ODER § 19? NIE RATEN.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Beim ersten Händler stellte sich am 26.07.2026 heraus: sein Impressum nennt
 * § 19 UStG („keine Umsatzsteuer"), während unser System ihm **5.982,63 EUR**
 * Umsatzsteuer berechnet hatte. Beides kann nicht stimmen.
 *
 * Ein Kleinunternehmer, der Umsatzsteuer ausweist, SCHULDET sie nach
 * § 14c Abs. 2 UStG — obwohl er sie nie einnehmen durfte.
 *
 * `KLEINUNTERNEHMER_19` gab es im Erzeugnis nur als Belegtext, mit dem
 * Kommentar „(future)". Ein Aufkleber ohne Maschine.
 */

import { describe, expect, it } from 'vitest';

import {
  HINWEIS_19,
  leseSteuerstand,
  pruefeSteuermodus,
  type Steuerstand,
} from '../../src/lib/steuermodus.js';

const AB = new Date('2026-01-01T00:00:00Z');
const regel: Steuerstand = { modus: 'REGELBESTEUERUNG', giltAb: AB };
const klein: Steuerstand = { modus: 'KLEINUNTERNEHMER_19', giltAb: AB };

describe('⛔ nicht beantwortet heisst NICHT „nimm das Uebliche"', () => {
  it('ohne hinterlegten Modus wird der Verkauf angehalten', () => {
    // Ein System, das bei fehlender Angabe „19 % ist schon ueblich" annimmt,
    // ist dieselbe Klasse wie der Versanddienst, der Sendungsnummern erfand:
    // eine fehlende Einstellung fuehrt nicht zu einer Luecke, sondern zu einer
    // Erfindung.
    const u = pruefeSteuermodus({
      stand: { modus: null, giltAb: null },
      taxTreatmentCode: 'STANDARD_19',
      vatCents: 1900n,
    });
    expect(u.erlaubt).toBe(false);
    expect(u.grund).toContain('nicht hinterlegt');
  });

  it('und der Satz sagt, WAS ZU TUN ist', () => {
    // Ein „nicht erlaubt" ohne naechsten Schritt fuehrt dazu, dass jemand den
    // Steuerschluessel von Hand umstellt.
    const u = pruefeSteuermodus({
      stand: { modus: null, giltAb: null },
      taxTreatmentCode: 'MARGIN_25A',
      vatCents: 0n,
    });
    expect(u.grund).toContain('Einstellungen');
  });
});

describe('§ 19: keine Steuer, und kein Schluessel, der eine voraussetzt', () => {
  it('⛔ ein ausgewiesener Betrag wird abgelehnt — § 14c Abs. 2', () => {
    const u = pruefeSteuermodus({ stand: klein, taxTreatmentCode: 'KEIN', vatCents: 1n });
    expect(u.erlaubt).toBe(false);
    expect(u.grund).toContain('§ 14c');
  });

  it('⛔ § 25a laeuft unter § 19 ins Leere', () => {
    // § 25a regelt, WORAUF die Steuer liegt. Wer keine ausweisen darf, hat
    // nichts zu verteilen.
    const u = pruefeSteuermodus({ stand: klein, taxTreatmentCode: 'MARGIN_25A', vatCents: 0n });
    expect(u.erlaubt).toBe(false);
    expect(u.grund).toContain('MARGIN_25A');
  });

  it('⛔ § 13b ebenso — es gibt keine Schuld, die uebergehen koennte', () => {
    expect(
      pruefeSteuermodus({ stand: klein, taxTreatmentCode: 'REVERSE_CHARGE_13B', vatCents: 0n })
        .erlaubt,
    ).toBe(false);
  });

  it('⛔ und die regulaeren Saetze erst recht', () => {
    for (const s of ['STANDARD_19', 'REDUCED_7', 'MIXED']) {
      expect(pruefeSteuermodus({ stand: klein, taxTreatmentCode: s, vatCents: 0n }).erlaubt, s).toBe(
        false,
      );
    }
  });

  it('✅ ein steuerfreier Verkauf geht durch UND traegt den Pflichthinweis', () => {
    // § 19 Abs. 1 Satz 4 UStG. Ohne den Hinweis sieht ein Beleg ohne
    // Steuerzeile aus wie ein vergessener Ausweis.
    const u = pruefeSteuermodus({ stand: klein, taxTreatmentCode: 'KEIN', vatCents: 0n });
    expect(u.erlaubt).toBe(true);
    expect(u.belegzusatz).toBe(HINWEIS_19);
    expect(u.belegzusatz).toContain('§ 19 UStG');
  });

  it('✅ Anlagegold bleibt moeglich — es ist ohnehin steuerfrei', () => {
    expect(
      pruefeSteuermodus({ stand: klein, taxTreatmentCode: 'INVESTMENT_GOLD_25C', vatCents: 0n })
        .erlaubt,
    ).toBe(true);
  });
});

describe('Regelbesteuerung laeuft wie bisher', () => {
  it('✅ und bekommt KEINEN Zusatz auf den Beleg', () => {
    const u = pruefeSteuermodus({ stand: regel, taxTreatmentCode: 'STANDARD_19', vatCents: 1900n });
    expect(u.erlaubt).toBe(true);
    expect(u.belegzusatz).toBeNull();
  });

  it('✅ § 25a und § 13b bleiben moeglich', () => {
    for (const s of ['MARGIN_25A', 'REVERSE_CHARGE_13B', 'MIXED']) {
      expect(pruefeSteuermodus({ stand: regel, taxTreatmentCode: s, vatCents: 0n }).erlaubt, s).toBe(
        true,
      );
    }
  });
});

describe('das Lesen der Einstellung ist streng', () => {
  it('beide Modi werden erkannt', () => {
    expect(leseSteuerstand('REGELBESTEUERUNG', '2026-01-01').modus).toBe('REGELBESTEUERUNG');
    expect(leseSteuerstand('KLEINUNTERNEHMER_19', '2026-01-01').modus).toBe('KLEINUNTERNEHMER_19');
  });

  it('⚠️ ein Tippfehler haelt den Verkauf AN, statt still 19 % zu nehmen', () => {
    for (const murks of ['regelbesteuerung', 'REGEL', '19', '', null, undefined, 'true']) {
      expect(leseSteuerstand(murks, '2026-01-01').modus, String(murks)).toBeNull();
    }
  });

  it('⚠️ ein Modus OHNE gueltiges Datum zaehlt als nicht beantwortet', () => {
    // Ohne die Grenze waere der DATEV-Export rueckwirkend falsch — und das
    // faellt erst beim Steuerberater auf, Monate spaeter.
    for (const d of [null, undefined, '', 'kein datum']) {
      expect(leseSteuerstand('KLEINUNTERNEHMER_19', d).modus, String(d)).toBeNull();
    }
  });

  it('das Datum kommt wirklich an', () => {
    const s = leseSteuerstand('KLEINUNTERNEHMER_19', '2026-01-01');
    expect(s.giltAb?.toISOString().slice(0, 10)).toBe('2026-01-01');
  });
});

/**
 * ⚠️ Der Wächter gegen die Rückkehr des geratenen Modus.
 */
describe('finalize prueft den Modus WIRKLICH', () => {
  const lies = async () =>
    (await import('node:fs')).readFileSync(
      new URL('../../src/routes/transactions-finalize.ts', import.meta.url),
      'utf8',
    );

  it('die Route ruft den Riegel an', async () => {
    const q = await lies();
    // Auf den AUFRUF pruefen, nicht auf den Namen — ein Waechter, der den
    // Import zaehlt, bewacht die Importliste.
    expect(/(?<!as\s)\bpruefeSteuermodus\s*\(/.test(q), 'finalize prueft den Steuermodus nicht').toBe(
      true,
    );
    expect(/(?<!as\s)\bleseSteuerstand\s*\(/.test(q)).toBe(true);
  });

  it('und zwar je ZEILE, nicht nur im Kopf', async () => {
    // Ein gemischter Rumpf darf sich nicht durch einen harmlosen Kopf
    // schmuggeln — dieselbe Luecke wie beim § 13b-Riegel.
    const q = await lies();
    const block = q.slice(q.indexOf('leseSteuerstand('), q.indexOf('leseSteuerstand(') + 900);
    expect(block).toContain('for (const it of body.items)');
  });

  it('⚠️ er steht VOR dem Schreiben', async () => {
    /*
     * 14.08.2026: der Anker hiess hier `app.db.transaction`. Diese WOERTLICHE
     * Folge stand aber nur im eBay-Sofort-Delist NACH dem Commit; der echte
     * fiskale Schreibbeginn ist `await app.db` mit `.transaction(` auf der
     * NAECHSTEN Zeile. Der Waechter mass also gegen die falsche Stelle und
     * haette eine Pruefung INNERHALB des fiskalen Blocks nicht bemerkt. Mit
     * der Trennung von warehouse14 fiel der eBay-Block, der Anker lief ins
     * Leere (indexOf -1), und der Fehler wurde sichtbar. Jetzt haengt er am
     * echten Beginn des fiskalen Blocks.
     */
    const q = await lies();
    expect(q.indexOf('pruefeSteuermodus(')).toBeLessThan(q.indexOf('.transaction(async (tx) => {'));
  });
});

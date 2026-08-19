/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Z_NR WAR EIN DATUM, KEINE FOLGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `dsfinvk-export.ts` trug wörtlich:
 *
 *     function zNr(businessDay: string): string {
 *       return businessDay; // surrogate; one closing per business day.
 *     }
 *
 * Der Kommentar nennt es ehrlich einen Platzhalter. Nur ist Z_NR in der
 * DSFinV-K kein freies Feld: es ist die FORTLAUFENDE Nummer des
 * Kassenabschlusses je Kasse, und alle acht erzeugten Dateien zeigen darauf.
 *
 * ── Warum eine Folge und nicht irgendein eindeutiger Schlüssel ───────────
 *
 * Der Zweck der Nummer ist die LÜCKE. Fehlt zwischen 41 und 43 die 42, fehlt
 * ein Abschluss, und genau das muss ein Prüfer sehen können. Bei einem
 * Datumsschlüssel sieht er nichts: ein nie abgeschlossener Tag hinterlässt
 * einfach keine Zeile, und nichts deutet darauf hin, dass es ihn gab.
 *
 * Am 27.07.2026 auf Romans Produktion gemessen:
 *
 *     daily_closings                                 1 Zeile, COUNTING
 *     davon festgeschrieben                          0
 *     Verkaufstage OHNE festgeschriebenen Abschluss  10
 *
 * Zehn Tage mit echten Umsätzen, und kein einziger davon wäre einem Prüfer
 * am Z-Schlüssel aufgefallen.
 *
 * § 146 Abs. 1 Satz 2 AO verlangt, Kasseneinnahmen täglich festzuhalten.
 */

import { describe, expect, it } from 'vitest';

import {
  buildDsfinvkBundle,
  ZNummerFehltError,
  type DsfinvkBundleInput,
} from '../../src/lib/dsfinvk-export.js';

const eingabe = (zNr: string | null): DsfinvkBundleInput => ({
  businessDay: '2026-06-08',
  closing: {
    zNr,
    finalizedAt: '2026-06-08T20:00:00.000Z',
    grossVerkaufEur: '1000.00',
    grossAnkaufEur: '0.00',
    netVerkaufEur: '840.34',
    netAnkaufEur: '0.00',
    vatByTreatment: { STANDARD_19: '159.66' },
    paymentsByMethod: { CASH: '1000.00' },
    cashCountedEur: '1000.00',
  },
  cashRegister: { id: 'KASSE-1', serialNumber: 'SN-1', brand: 'Norns', model: 'Tresen' },
  receipts: [],
});

/** `DsfinvkFile.content` darf seit 18.08.2026 auch Buffer sein (Prueferpaket); die Taxonomie-CSVs hier sind immer Text. */
const alsText = (inhalt: string | Buffer): string =>
  typeof inhalt === 'string' ? inhalt : inhalt.toString('utf8');

describe('⛔ der Befund: das Datum stand im Schlüsselfeld', () => {
  it('Z_NR trägt jetzt die Folgenummer, nicht den Geschäftstag', () => {
    const dateien = buildDsfinvkBundle(eingabe('42'));
    const kopf = dateien.find((d) => d.name.includes('cashpointclosing'));
    expect(kopf, 'die Abschlussdatei fehlt').toBeDefined();
    const zeile = alsText(kopf!.content).split('\r\n')[1] ?? '';
    const felder = zeile.split(';');
    // Z_KASSE_ID ; Z_NR ; Z_BUCHUNGSTAG ; …
    expect(felder[1]).toBe('42');
    // Der Geschäftstag steht weiterhin in SEINEM Feld — er ist nicht
    // verschwunden, er sass nur an der falschen Stelle.
    expect(felder[2]).toBe('2026-06-08');
  });

  it('⚠️ und ALLE Dateien des Pakets tragen dieselbe Nummer', () => {
    // Sie ist der Schlüssel, über den ein Prüfer die Dateien verknüpft.
    // Trägt eine davon etwas anderes, zerfällt das Paket.
    const dateien = buildDsfinvkBundle(eingabe('42'));
    expect(dateien.length).toBeGreaterThan(1);
    for (const d of dateien) {
      const zeilen = alsText(d.content).split('\r\n').filter((z) => z.trim() !== '');
      const kopfFelder = (zeilen[0] ?? '').split(';');
      const i = kopfFelder.indexOf('Z_NR');
      if (i < 0) continue; // Datei ohne Z_NR-Spalte
      for (const z of zeilen.slice(1)) {
        expect(z.split(';')[i], `${d.name} trägt eine fremde Z-Nummer`).toBe('42');
      }
    }
  });

  it('das Datum kommt als Nummer NICHT mehr vor', () => {
    const dateien = buildDsfinvkBundle(eingabe('42'));
    const kopf = dateien.find((d) => d.name.includes('cashpointclosing'))!;
    const felder = (alsText(kopf.content).split('\r\n')[1] ?? '').split(';');
    expect(felder[1]).not.toBe('2026-06-08');
  });
});

describe('⛔ ohne Nummer wird KEIN Paket gebaut', () => {
  it('es wird kein Ersatz erfunden', () => {
    // Ein Paket mit ausgedachtem Schlüssel ist schlimmer als gar keines:
    // es sieht vollständig aus. Genau die Fehlerklasse „Erfinden statt
    // Sperren", die dieses Haus schon mehrfach getroffen hat.
    expect(() => buildDsfinvkBundle(eingabe(null))).toThrow(ZNummerFehltError);
  });

  it('auch eine leere Zeichenkette gilt nicht als Nummer', () => {
    expect(() => buildDsfinvkBundle(eingabe(''))).toThrow(ZNummerFehltError);
    expect(() => buildDsfinvkBundle(eingabe('   '))).toThrow(ZNummerFehltError);
  });

  it('und die Meldung nennt den Tag, um den es geht', () => {
    try {
      buildDsfinvkBundle(eingabe(null));
      expect.unreachable('kein Abbruch');
    } catch (e) {
      expect((e as Error).message).toContain('2026-06-08');
      expect((e as Error).message).toContain('KEIN Paket');
    }
  });
});

/**
 * ⚠️ Die Wächter gegen die Rückkehr des Platzhalters.
 */
describe('die Nummer kommt WIRKLICH aus der Datenbank', () => {
  const lies = async (p: string) =>
    (await import('node:fs')).readFileSync(new URL(p, import.meta.url), 'utf8');

  it('⛔ `zNr` liest nicht mehr den Geschäftstag', async () => {
    const q = await lies('../../src/lib/dsfinvk-export.ts');
    const ohneKommentare = q
      .split('\n')
      .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z))
      .join('\n');
    expect(
      /return businessDay;/.test(ohneKommentare),
      'der Platzhalter ist zurück — Z_NR wäre wieder ein Datum',
    ).toBe(false);
    expect(ohneKommentare).toContain('input.closing.zNr');
  });

  it('die Exportroute holt die Spalte', async () => {
    // ⚠️ 18.08.2026: der DSFinV-K-Rumpf wohnt in lib/dsfinvk-tag.ts.
    const q =
      (await lies('../../src/lib/dsfinvk-tag.ts')) +
      '\n' +
      (await lies('../../src/routes/closing-export.ts'));
    // ⚠️ Auf die SPALTE prüfen, nicht auf den Alias. Ein `NULL::text AS z_nr`
    // enthielte den Namen ebenfalls — dieselbe Falle, in die der erste
    // Entwurf des § 25a-Wächters gelaufen ist.
    expect(/(?<![\w.])z_nr::text\s+AS\s+z_nr/.test(q), 'z_nr kommt nicht aus der SPALTE').toBe(
      true,
    );
    expect(q).toContain('zNr: closing.z_nr,');
  });

  it('⛔ und der Abschluss VERGIBT sie, aus dem Höchststand', async () => {
    const q = await lies('../../src/routes/closings-finalize.ts');
    expect(q).toContain('coalesce(max(z_nr), 0) + 1');
    expect(q).toContain('z_nr');
  });

  it('⚠️ KEINE Sequenz — die risse bei einem Rollback eine Lücke', async () => {
    // Und eine Lücke muss einen FEHLENDEN Abschluss bedeuten, sonst trägt die
    // Nummer keine Aussage mehr.
    const q = await lies('../../src/routes/closings-finalize.ts');
    expect(/nextval\s*\(/.test(q), 'eine Sequenz vergibt die Z-Nummer').toBe(false);
  });

  it('ein Wettlauf zweier Festschreibungen wird als Konflikt gemeldet', async () => {
    // Der eindeutige Index aus 0124 ist der eigentliche Riegel. Er darf aber
    // nicht als 500 beim Kassierer landen.
    const q = await lies('../../src/routes/closings-finalize.ts');
    expect(q).toContain('daily_closings_z_nr_null_shop_uq');
  });
});

describe('die Wanderung 0124 steht und prüft sich selbst', () => {
  const lies = async () =>
    (await import('node:fs')).readFileSync(
      new URL('../../../../packages/db/migrations/0124_z_nr_ist_eine_folge_kein_datum.sql', import.meta.url),
      'utf8',
    );

  it('sie legt die Spalte und den eindeutigen Index an', async () => {
    const q = await lies();
    expect(q).toContain('ADD COLUMN IF NOT EXISTS z_nr BIGINT');
    expect(q).toContain('daily_closings_z_nr_null_shop_uq');
  });

  it('⛔ ein festgeschriebener Abschluss OHNE Nummer ist verboten', async () => {
    const q = await lies();
    expect(q).toContain('CHECK (finalized_at IS NULL OR z_nr IS NOT NULL)');
  });

  it('⚠️ und sie gibt das Spaltenrecht mit — die Falle schlug hier dreimal zu', async () => {
    // UPDATE ist je Spalte vergeben. Eine neue Spalte ist per Vorgabe
    // GESPERRT, und der Abschluss schlüge LIVE fehl, während lokal alles
    // grün ist.
    const q = await lies();
    expect(q).toContain('GRANT INSERT (z_nr), UPDATE (z_nr)');
    expect(q, 'sie glaubt das Recht, statt es nachzumessen').toContain('has_column_privilege');
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════
 *  Der LEBENDE DSFinV-K-Weg nahm eine fehlende Z-Nummer stillschweigend an
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
 *
 *     dsfinvk-daten.ts:290   const zNr = (closing.zNr ?? '').trim();
 *
 * Kein Wurf, keine Meldung. Fehlt die Nummer, entstehen zwanzig Dateien mit
 * leerem Z-Feld — ein Paket, das vollständig AUSSIEHT und keinen Schlüssel
 * trägt, mit dem ein Prüfer die Abschlüsse verbinden könnte.
 *
 * ── ⚠️ UND DIE ROUTE BEHAUPTETE DAS GEGENTEIL ──────────────────────────
 *
 *     closing-export.ts:1728
 *     // ⚠️ Der echte Z-Schlüssel aus 0124. Fehlt er, wirft `zNr` — es wird
 *     // KEIN Paket mit erfundener Nummer gebaut.
 *
 * Der Satz stimmte einmal. Er beschreibt `zNr()` aus `dsfinvk-export.ts` —
 * dem ABGELÖSTEN Erzeuger, der seit dem 28.07. keinen Aufrufer mehr hat.
 * Der Riegel ist beim Umzug zurückgeblieben, der Kommentar mitgereist.
 *
 * Das ist die gefährlichste Sorte Kommentar: er beruhigt an genau der Stelle,
 * an der jemand nachsehen würde. Wer ihn liest, hört auf zu prüfen.
 *
 * ── DER CHECK IN DER DATENBANK HILFT NICHT ─────────────────────────────
 *
 * Er ist `NOT VALID`; Altbestände wurden nie geprüft. Eine Sicherung von vor
 * der Wanderung 0124 kann Tage tragen, für die nie wieder ein Paket entsteht.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { formeDaten, type MenschlicheAngaben } from '../../src/lib/dsfinvk-daten.js';
import { ZNummerFehltError, type DsfinvkBundleInput } from '../../src/lib/dsfinvk-export.js';
import { leseStammdaten } from '../../src/lib/haendler-stammdaten.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '../../../..');

const mensch = (): MenschlicheAngaben => ({
  gvTypAnkauf: 'Auszahlung',
  stammdaten: leseStammdaten({
    'shop.legal_name': 'Muster Edelmetallhandel e. K.',
    'shop.street': 'Musterstraße 1',
    'shop.postal_code': '73614',
    'shop.city': 'Schorndorf',
    'shop.country_code': 'DEU',
    'shop.tax_number': '12345/67890',
    'shop.vat_id': 'DE343451090',
  }),
  eigeneUstSchluessel: { MARGIN_25A: '1001' },
  kassenSeriennummer: 'KS-0001',
  taxonomieVersion: '2.4',
  softwareVersion: '1.0.0',
});

const eingabe = (zNr: string | null): DsfinvkBundleInput => ({
  businessDay: '2026-06-01',
  closing: {
    zNr,
    finalizedAt: '2026-06-01T20:00:00.000Z',
    grossVerkaufEur: '0.00',
    grossAnkaufEur: '0.00',
    netVerkaufEur: '0.00',
    netAnkaufEur: '0.00',
    vatByTreatment: {},
    paymentsByMethod: {},
    cashCountedEur: null,
  },
  cashRegister: { id: 'KASSE-1', serialNumber: 'SN-1', brand: 'Norns', model: 'Tresen' },
  receipts: [],
});

describe('⛔ Ein Paket ohne Z-Nummer entsteht gar nicht erst', () => {
  it('mit Nummer läuft der Weg durch', () => {
    expect(() => formeDaten(eingabe('42'), mensch())).not.toThrow();
  });

  it('⛔ NULL wirft, statt zwanzig leere Felder zu schreiben', () => {
    expect(() => formeDaten(eingabe(null), mensch())).toThrow(ZNummerFehltError);
  });

  it('⛔ und die leere Zeichenkette auch', () => {
    expect(() => formeDaten(eingabe(''), mensch())).toThrow(ZNummerFehltError);
  });

  it('⛔ und Leerzeichen sind keine Nummer', () => {
    /**
     * Der alte Code machte daraus mit `.trim()` eine leere Zeichenkette und
     * schrieb sie in zwanzig Dateien. Genau der Fall, in dem ein Paket
     * vollständig AUSSIEHT.
     */
    expect(() => formeDaten(eingabe('   '), mensch())).toThrow(ZNummerFehltError);
  });

  it('⚠️ der Fehler nennt den Geschäftstag, damit man den Abschluss findet', () => {
    try {
      formeDaten(eingabe(null), mensch());
      throw new Error('hätte werfen müssen');
    } catch (e) {
      const f = e as ZNummerFehltError & { details?: { geschaeftstag?: string } };
      expect(f.message).toContain('2026-06-01');
      expect(f.details?.geschaeftstag).toBe('2026-06-01');
    }
  });
});

describe('⚠️ Der Kommentar in der Route beschreibt nicht mehr den toten Weg', () => {
  it('⛔ er nennt den Riegel, den es WIRKLICH gibt', () => {
    /**
     * Der alte Satz („Fehlt er, wirft `zNr`") beschrieb `zNr()` aus dem
     * abgelösten Erzeuger. Er beruhigte an genau der Stelle, an der jemand
     * nachsehen würde.
     */
    /**
     * ⚠️ ZUM DRITTEN MAL HEUTE dieselbe Falle: die erste Fassung dieser
     * Prüfung verbot den Satz „wirft `zNr`" im Umfeld — und wurde rot an
     * meinem eigenen Kommentar, der den alten Satz ZITIERT, um zu erklären,
     * was falsch war.
     *
     * Ein Wächter, der eine Erklärung nicht von einer Behauptung
     * unterscheiden kann, misst die Prosa. Gemessen wird deshalb POSITIV:
     * steht der Name des lebenden Riegels daneben?
     */
    // ⚠️ 18.08.2026: der DSFinV-K-Rumpf wohnt in lib/dsfinvk-tag.ts.
    const q =
      readFileSync(join(REPO, 'apps/api-cloud/src/lib/dsfinvk-tag.ts'), 'utf8') +
      '\n' +
      readFileSync(join(REPO, 'apps/api-cloud/src/routes/closing-export.ts'), 'utf8');
    const i = q.indexOf('zNr: closing.z_nr');
    expect(i).toBeGreaterThan(-1);
    const davor = q.slice(Math.max(0, i - 900), i);
    expect(davor, 'der lebende Riegel wird nicht genannt').toMatch(/formeDaten|ZNummerFehltError/);

    // Und die Sache selbst: der Riegel steht wirklich im lebenden Weg.
    const daten = readFileSync(join(REPO, 'apps/api-cloud/src/lib/dsfinvk-daten.ts'), 'utf8');
    expect(daten).toMatch(/throw new ZNummerFehltError\(businessDay\)/);
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DIE ANGENOMMENE BEWERTUNG, ZUM ERSTEN MAL WIRKLICH GEFAHREN
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 14.08.2026 ──────────────────────────────────────────────
 *
 * `/api/appraisals/:id/accept` ist der DRITTE Weg, der in die fiskalische
 * Tabelle schreibt. Er erzeugt einen Ankauf samt Kindprodukten und ist damit
 * nach § 146a AO genauso aufzeichnungspflichtig wie ein Verkauf.
 *
 * Gemessen war: es gab fuer diesen Weg KEINE einzige Integrationsdatei. Nicht
 * etwa keine ohne Sicherungseinrichtung, sondern ueberhaupt keine. Er war nie
 * gefahren worden, in keinem Lauf, gegen kein Postgres.
 *
 * ⛔ UND ER TRUG NICHT. Beim allerersten Fahren fielen ZWEI Defekte heraus,
 * die den Weg vollstaendig lahmlegten. Der Haendler konnte eine Bewertung
 * anlegen, Posten erfassen und abschliessen; beim ANNEHMEN brach es ab.
 *
 *   A) `transaction_items` verletzte die Regel
 *      `transactions_margin_implies_acquisition`: der Schnappschuss der
 *      Anschaffungskosten war gesetzt, die Marge NULL. 409, nichts geschrieben.
 *      ⚠️ Derselbe Fehler stand in `transactions-ankauf.ts` und ist DORT
 *      behoben. Der Fix traf einen der zwei Ankaufwege.
 *
 *   B) Danach 500 mit `42P18 could not determine data type of parameter $6`.
 *      Die Ursache lag in der rohen Anweisung, die das Hauptbuchereignis
 *      schreibt: `jsonb_build_object` nimmt Argumente vom Typ „any", und ein
 *      blosser Parameter darin ist fuer Postgres nicht herleitbar. Zwei der
 *      vier Argumente trugen ihren Cast, zwei nicht.
 *
 * ── WAS EIN QUELLTEXT-WAECHTER HIER NICHT KANN ────────────────────────────
 *
 * Beides ist fuer die Typpruefung unsichtbar. Ein fehlender Cast in einer
 * SQL-Schablone sieht aus wie ein vorhandener, und eine CHECK-Regel der
 * Datenbank steht nicht im TypeScript. Nur ein echter Lauf gegen ein echtes
 * Postgres findet das. Genau den gab es hier nicht.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { baueFiskalBuehne } from '../helfer/fiskal-buehne.js';

describe('Die angenommene Bewertung über HTTP', () => {
  const buehne = baueFiskalBuehne();

  beforeAll(async () => {
    await buehne.starten();
  }, 180_000);

  afterAll(async () => {
    await buehne.stoppen();
  });

  beforeEach(async () => {
    await buehne.leeren();
  });

  /**
   * Eine Bewertung bis zum Zustand COMPLETED, also genau so weit, wie der
   * Inhaber sie annehmen kann. Drei echte Aufrufe, kein SQL von der Seite:
   * eine per SQL zusammengesetzte Bewertung waere die Klasse „Buehne
   * modelliert einen unmoeglichen Zustand" und bewiese nichts ueber den Weg.
   */
  async function bewertungBisAnnahmebereit(betrag: string): Promise<string> {
    const angelegt = await buehne.sende('/api/appraisals', {
      customerId: buehne.akteure.kundeId,
    });
    expect(angelegt.statusCode, angelegt.body).toBe(201);
    const id = (angelegt.json() as { id: string }).id;

    const posten = await buehne.sende(`/api/appraisals/${id}/items`, {
      name: 'Armband, geprüft',
      itemType: 'gold_jewelry',
      metal: 'gold',
      weightGrams: '18.5000',
      // ⚠️ ALLE freiwilligen Felder mitgeben. Die Probe ohne sie steht im
      // Satz „auch ohne die freiwilligen Angaben" weiter unten: genau die
      // Trennung zeigt, ob der Weg an einer fehlenden Angabe zerbricht.
      karatCode: '14K',
      finenessDecimal: '0.5850',
      condition: 'USED_GOOD',
      hallmarkStamps: ['585'],
      description: 'Ein Armband aus einem Nachlass.',
      individualAppraisedEur: betrag,
    });
    // ⚠️ 200, nicht 201: der Posten-Weg gibt die ganze Bewertung zurueck,
    // nicht eine neue Ressource. Gemessen, nicht angenommen.
    expect(posten.statusCode, posten.body).toBe(200);

    const fertig = await buehne.sende(`/api/appraisals/${id}/complete`, {
      totalOfferedEur: betrag,
    });
    expect(fertig.statusCode, fertig.body).toBe(200);
    return id;
  }

  /** Die Lade öffnen. Eine angenommene Bewertung zahlt BAR aus. */
  async function oeffneSchicht(): Promise<void> {
    const res = await buehne.sende('/api/shifts/open', { openingFloatEur: '200.00' });
    expect(res.statusCode, res.body).toBe(200);
  }

  it('der Weg trägt überhaupt: eine Bewertung wird angenommen und erzeugt einen Ankauf', async () => {
    /*
     * „null ist nicht grün": ohne diesen Satz koennten die zwei Saetze unten
     * gruen sein, weil der Weg IMMER scheitert, und niemand saehe es.
     */
    await oeffneSchicht();
    const id = await bewertungBisAnnahmebereit('380.00');
    const res = await buehne.sende(`/api/appraisals/${id}/accept`, {});
    expect(res.statusCode, res.body).toBe(200);

    const zeilen = await buehne.migratorSql<{ richtung: string }[]>`
      SELECT direction AS richtung FROM transactions`;
    expect(zeilen.length, 'die Annahme hat keinen Ankauf erzeugt').toBe(1);
    expect(zeilen[0]?.richtung).toBe('ANKAUF');
  });

  it('⛔ ohne Sicherungseinrichtung wird schon die ERSTE Annahme abgewiesen', async () => {
    /*
     * 15.08.2026: hier standen zwei Saetze fuer die Gnadenfrist von zehn
     * Belegen. Basel hat sie gestrichen; eine angenommene Bewertung schreibt
     * eine ANKAUF-Zeile und faellt damit unter denselben harten Riegel.
     */
    await buehne.migratorSql`DELETE FROM system_settings WHERE key = 'tse.tss_id'`;
    await oeffneSchicht();
    const bewertungId = await bewertungBisAnnahmebereit('380.00');

    const res = await buehne.sende(`/api/appraisals/${bewertungId}/accept`, {});
    expect(res.statusCode, res.body).toBe(409);
    expect(res.body).toContain('keine technische Sicherheitseinrichtung');

    const zeilen = await buehne.migratorSql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM transactions`;
    expect(zeilen[0]?.n, 'trotz Abweisung wurde gebucht').toBe(0);
  });
});

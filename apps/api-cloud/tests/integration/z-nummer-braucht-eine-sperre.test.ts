/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ ZWEI ABSCHLÜSSE, EINE Z-NUMMER — UND EINE UNWAHRE MELDUNG
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND (Tiefenjagd 11.08.2026) ────────────────────────────────────
 *
 * Der Abschluss nimmt eine Sperre auf den GESCHÄFTSTAG
 * (`pg_advisory_xact_lock(1146, <tag>)`). Zwei Abschlüsse für ZWEI
 * VERSCHIEDENE Tage nehmen damit zwei verschiedene Schlüssel und laufen
 * gleichzeitig. Beide lasen `max(z_nr) + 1` und bekamen dieselbe Zahl.
 *
 * Gemessen:
 *
 *     zwei Verbindungen, gleichzeitig gelesen: {"A":"1","B":"1"}
 *     finalize 2026-05-04 → 200
 *     finalize 2026-05-03 → 409 „Der Tagesabschluss für 2026-05-03
 *                                besteht bereits."
 *     daily_closings danach: nur der 04.05.
 *
 * ── WARUM DIE MELDUNG DAS EIGENTLICHE ÜBEL WAR ────────────────────────────
 *
 * Der Mensch am Abschluss liest, der andere Tag sei erledigt, und hakt ihn
 * ab. Tatsächlich hat dieser Tag KEINEN Z-Bon, und damit liefern DSFinV-K,
 * DATEV und Kassenbericht für ihn nichts. Eine Lücke in der fortlaufenden
 * Abschlussnummer ist genau das, woran ein Prüfer einen fehlenden Abschluss
 * erkennt (§ 146 Abs. 1 Satz 2 AO, DSFinV-K Feld `Z_NR`).
 *
 * ── WAS DIESER WÄCHTER MISST ──────────────────────────────────────────────
 *
 * Zwei Abschlüsse verschiedener Tage werden WIRKLICH gleichzeitig über HTTP
 * ausgelöst (`Promise.all`), gegen ein echtes Postgres. Danach müssen BEIDE
 * Tage eine Zeile haben und zwei VERSCHIEDENE, lückenlose Nummern tragen.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { baueFiskalBuehne } from '../helfer/fiskal-buehne.js';

describe('⛔ die Z-Nummer wird nicht zweimal vergeben', () => {
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

  async function zweiTage(): Promise<{ frueher: string; spaeter: string }> {
    const [z] = await buehne.migratorSql<{ frueher: string; spaeter: string }[]>`
      SELECT (berlin_business_day(now()) - 2)::text AS frueher,
             (berlin_business_day(now()) - 1)::text AS spaeter`;
    // Kein `!`: eine leere Antwort hier hiesse, dass `berlin_business_day`
    // fehlt — dann soll der Satz das SAGEN und nicht an einer Folgezeile
    // stolpern.
    if (!z) throw new Error('die Datenbank lieferte keine Geschaeftstage');
    return z;
  }

  it('zwei gleichzeitige Abschlüsse VERSCHIEDENER Tage bekommen zwei Nummern', async () => {
    const { frueher, spaeter } = await zweiTage();

    // Auf jedem Tag ein echter Beleg UND eine gezählte, geschlossene Schicht:
    // ohne sie hält der Abschluss den Tag an („keine geschlossene Schicht deckt
    // diesen Tag ab") — der Riegel vom 11.08., nicht sein Umgehen.
    const wer = buehne.akteure;
    for (const tag of [frueher, spaeter]) {
      const [schicht] = await buehne.migratorSql<{ id: string }[]>`
        INSERT INTO shifts (device_id, opened_by_user_id, opening_float_eur, opened_at,
                            status, blind_count_eur, system_expected_eur,
                            closed_by_user_id, closed_at)
        VALUES (${wer.geraetId}::uuid, ${wer.kassiererId}::uuid, '0.00',
                ${`${tag}T08:00:00+02:00`}::timestamptz, 'CLOSED', '119.00', '119.00',
                ${wer.kassiererId}::uuid, ${`${tag}T20:00:00+02:00`}::timestamptz)
        RETURNING id::text AS id`;
      if (!schicht) throw new Error(`die Schicht fuer ${tag} wurde nicht angelegt`);
      const produkt = await buehne.legeProduktAn({ behandlung: 'STANDARD_19' });
      await buehne.legeBelegAn({
        shiftId: schicht.id,
        direction: 'VERKAUF',
        treatment: 'STANDARD_19',
        subtotal: '100.00',
        vat: '19.00',
        total: '119.00',
        customerId: null,
        finalizedAt: `${tag}T10:00:00+02:00`,
        items: [
          {
            productId: produkt,
            treatment: 'STANDARD_19',
            vatRate: '0.1900',
            lineSubtotal: '100.00',
            lineVat: '19.00',
            lineTotal: '119.00',
            displayOrder: 1,
          },
        ],
        payment: { method: 'CASH', amount: '119.00' },
        tse: true,
      });
    }

    // ── DER AUGENBLICK: beide Abschlüsse zugleich ──────────────────────────
    const [a, b] = await Promise.all([
      buehne.sende('/api/closings/finalize', { businessDay: spaeter }),
      buehne.sende('/api/closings/finalize', { businessDay: frueher }),
    ]);

    expect(a.statusCode, `Abschluss ${spaeter}: ${a.body}`).toBe(200);
    expect(b.statusCode, `Abschluss ${frueher}: ${b.body}`).toBe(200);

    const zeilen = await buehne.migratorSql<{ tag: string; z: string }[]>`
      SELECT business_day::text AS tag, z_nr::text AS z
        FROM daily_closings
       WHERE finalized_at IS NOT NULL
       ORDER BY z_nr`;

    expect(
      zeilen.map((r) => r.tag).sort(),
      'ein Tag hat KEINEN Z-Bon bekommen — genau die Lücke, die ein Prüfer sucht',
    ).toEqual([frueher, spaeter].sort());
    expect(
      zeilen.map((r) => r.z),
      'die Abschlussnummern sind nicht 1 und 2',
    ).toEqual(['1', '2']);
  }, 120_000);

  it('⚠️ und wenn doch zwei nach derselben Nummer greifen, lügt die Meldung nicht', async () => {
    /*
     * Der Satz oben ist der Riegel. Dieser hier prüft die WORTE für den Fall,
     * dass der Riegel je fällt: die Meldung darf nicht behaupten, der Tag sei
     * abgeschlossen, wenn er es nicht ist.
     *
     * Gemessen wird am Quelltext der Route, weil der Zustand mit gesetzter
     * Sperre nicht mehr herstellbar ist — die Sperre IST der Fix. Der Satz
     * darüber beweist, dass sie greift; dieser hier, dass die Worte für den
     * Ausnahmefall stimmen.
     */
    const quelle = (await import('node:fs')).readFileSync(
      new URL('../../src/routes/closings-finalize.ts', import.meta.url),
      'utf8',
    );
    const zweig = quelle.slice(quelle.indexOf('zNummerKollision'));
    expect(zweig, 'der Z-Nummer-Zweig fehlt').toContain('daily_closings_z_nr_null_shop_uq');
    const meldung = zweig.slice(0, zweig.indexOf('if (\n'));
    expect(meldung, 'der Z-Zweig behauptet weiterhin, der Tag sei abgeschlossen').not.toContain(
      'besteht bereits',
    );
    expect(meldung).toContain('weiterhin');
  });
});

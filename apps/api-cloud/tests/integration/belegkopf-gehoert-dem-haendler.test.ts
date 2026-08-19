/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Der Belegkopf trägt den Händler, NICHT einen fremden Betrieb
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 11.08.2026 (P0) ─────────────────────────────────────────
 *
 * Ein Behälter im Zustand GENAU nach den Wanderungen, danach der
 * Einrichtungsassistent vollständig über die echten HTTP-Wege ausgefüllt.
 * Eingetragen hatte der Händler `shop.legal_name = Goldhaus Neustadt e. K.`,
 * `shop.street = Marktplatz 3`, `shop.postal_code = 90402`,
 * `shop.city = Nürnberg`. Gelesen wurde danach:
 *
 *     GET /api/shop-info -> 200
 *     {
 *      "name": "WAREHOUSE 14",
 *      "tagline": "Antiquitäten · Briefmarken · Münzen",
 *      "addressLine1": "Schornbacher Weg 66",
 *      "addressLine2": "73614 Schorndorf",
 *      "taxNumber": "241/123/45678"
 *     }
 *
 * Der erste Kunde bekommt einen Bon mit dem Namen und der Anschrift eines
 * ANDEREN Unternehmens, darunter die eigene Steuernummer. § 14 Abs. 4 Nr. 1
 * UStG verlangt Namen und Anschrift des LEISTENDEN Unternehmers. Derselbe
 * Wert wandert in den Kassenbericht und in den DSFinV-K-Kopf.
 *
 * Herkunft: Wanderung 0044 säte diese vier Werte als „Shop identity". Der
 * Rückfall in `beleg-identitaet.ts` greift deshalb NIE — er greift nur bei
 * LEEREM Belegfeld, und leer war keines davon.
 *
 * ── WARUM DER NAHELIEGENDE WEG FALSCH IST ──────────────────────────────────
 *
 * Naheliegend wäre, `belegIdentitaet` die vier Saatwerte als „nicht gesetzt"
 * behandeln zu lassen. Das trifft aber auch eine Kasse, auf der genau diese
 * Werte die WAHRHEIT sind, und nimmt ihr die Ortszeile vom Beleg. Gemessen in
 * Wanderung 0126 an Romans Produktion: `shop.address_line2` steht dort auf
 * „73614 Schorndorf", und `shop.postal_code`/`shop.city` sind leer — der
 * Rückfall hätte nichts, worauf er zurückfiele.
 *
 * Die Saat wird deshalb dort geräumt, wo sie entstanden ist: in einer
 * Wanderung, und nur dann, wenn der GANZE Belegkopf noch Byte für Byte die
 * Auslieferung ist. Ein Kopf, an dem ein Mensch etwas geändert hat, wird
 * nicht angefasst.
 *
 * ── WAS DIESER WÄCHTER MISST ───────────────────────────────────────────────
 *
 * Alles über die echten HTTP-Wege gegen den echten Server mit allen echten
 * Wanderungen, NICHT gegen die Datenbankzeile:
 *
 *   1. Nach den Wanderungen trägt kein Feld des Belegkopfs einen fremden Wert.
 *   2. Jedes Feld des Assistenten geht als PATCH durch (Befund: drei
 *      `betrieb.`-Schlüssel prallten mit HTTP 400 ab).
 *   3. Nach dem Assistenten nennt `GET /api/shop-info` den Händler — Name,
 *      Strasse und Ortszeile — und keinen Wert des fremden Betriebs.
 *   4. `GET /api/einrichtung` sagt dasselbe wie der Verkaufsriegel: ohne
 *      `steuer.modus_gilt_ab` KEIN `kannVerkaufen`.
 */

import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { baueFiskalBuehne } from '../helfer/fiskal-buehne.js';

/**
 * Die vier Werte, die Wanderung 0044 gesät hat — WÖRTLICH.
 *
 * Von Hand abgeschrieben und nicht importiert: verschwinden sie eines Tages
 * aus der Saat, soll dieser Wächter trotzdem weiter genau nach IHNEN suchen.
 */
const FREMDE_SAAT: Readonly<Record<string, string>> = {
  'shop.name': 'WAREHOUSE 14',
  'shop.tagline': 'Antiquitäten · Briefmarken · Münzen',
  'shop.address_line1': 'Schornbacher Weg 66',
  'shop.address_line2': '73614 Schorndorf',
};

/**
 * Was der Händler eingibt — genau die Schlüssel, die
 * `apps/tauri-pos/src/screens/einrichtung/einrichtungs-schritte.ts` schreibt.
 *
 * ⚠️ Von Hand abgeschrieben, nicht importiert: der Assistent liegt in einer
 * anderen Anwendung, und eine Änderung dort muss HIER auffallen, statt still
 * mitzuwandern.
 */
const ASSISTENT: ReadonlyArray<[string, string]> = [
  ['shop.legal_name', 'Goldhaus Neustadt e. K.'],
  ['shop.street', 'Marktplatz 3'],
  ['shop.postal_code', '90402'],
  ['shop.city', 'Nürnberg'],
  ['shop.country_code', 'DEU'],
  ['steuer.modus', 'REGELBESTEUERUNG'],
  ['steuer.modus_gilt_ab', '2026-01-01'],
  ['shop.tax_number', '241/123/45678'],
  ['shop.vat_id', ''],
  ['shop.phone', '0911 1234567'],
  ['betrieb.verantwortlich_aufzeichnungen', 'Anna Neustadt'],
  ['betrieb.geldwaeschebeauftragter', ''],
  ['betrieb.sicherungsort', 'Bankschliessfach'],
];

describe('⛔ Der Belegkopf gehört dem Händler', () => {
  const buehne = baueFiskalBuehne({});

  beforeAll(async () => {
    await buehne.starten();
    await buehne.leeren();
  }, 180_000);

  afterAll(async () => {
    await buehne.stoppen();
  });

  function schreibe(schluessel: string, wert: string): Promise<LightMyRequestResponse> {
    const wer = buehne.akteure;
    return buehne.app.inject({
      method: 'PATCH',
      url: `/api/settings/${schluessel}`,
      headers: {
        cookie: `warehouse14.session=${wer.inhaberSitzung}`,
        'x-dev-device-fingerprint': wer.geraetFingerabdruck,
        'content-type': 'application/json',
      },
      payload: { value: wert },
    });
  }

  function hole(url: string): Promise<LightMyRequestResponse> {
    const wer = buehne.akteure;
    return buehne.app.inject({
      method: 'GET',
      url,
      headers: {
        cookie: `warehouse14.session=${wer.inhaberSitzung}`,
        'x-dev-device-fingerprint': wer.geraetFingerabdruck,
      },
    });
  }

  it('⛔ nach den Wanderungen trägt der Belegkopf KEINEN fremden Betrieb', async () => {
    const zeilen = await buehne.sql<{ key: string; wert: string | null }[]>`
      SELECT key, value #>> '{}' AS wert
        FROM system_settings
       WHERE key IN ('shop.name','shop.tagline','shop.address_line1','shop.address_line2')`;
    expect(zeilen.length, 'die vier Fächer des Belegkopfs fehlen ganz').toBe(4);

    const fremd = zeilen
      .filter((z) => (z.wert ?? '') === FREMDE_SAAT[z.key])
      .map((z) => `${z.key} = "${z.wert ?? ''}"`);

    expect(
      fremd,
      'Diese Werte hat kein Händler eingetragen — sie stammen aus der Saat der ' +
        'Wanderung 0044 und gehören einem ANDEREN Unternehmen. Sie stehen auf jedem ' +
        'Kassenbon (§ 14 Abs. 4 Nr. 1 UStG), im Kassenbericht und im DSFinV-K-Kopf:\n  ' +
        fremd.join('\n  '),
    ).toEqual([]);
  });

  it('⛔ jedes Feld des Assistenten geht durch — keines prallt mit 400 ab', async () => {
    const abgewiesen: string[] = [];
    for (const [schluessel, wert] of ASSISTENT) {
      const antwort = await schreibe(schluessel, wert);
      if (antwort.statusCode !== 200) abgewiesen.push(`${schluessel} -> ${antwort.statusCode} ${antwort.body}`);
    }
    expect(
      abgewiesen,
      'Der Assistent bricht beim ersten Fehler ab; der Händler kommt nicht weiter und ' +
        `sieht nur „Eingabe ungültig":\n  ${abgewiesen.join('\n  ')}`,
    ).toEqual([]);
  });

  it('⛔ danach nennt der Beleg den HÄNDLER, nicht den fremden Betrieb', async () => {
    const antwort = await hole('/api/shop-info');
    expect(antwort.statusCode, antwort.body).toBe(200);
    const kopf = antwort.json() as Record<string, unknown>;

    // Was WIRKLICH auf dem Papier steht.
    expect(kopf['name'], 'der Beleg trägt einen fremden Firmennamen').toBe(
      'Goldhaus Neustadt e. K.',
    );
    expect(kopf['addressLine1'], 'der Beleg trägt eine fremde Strasse').toBe('Marktplatz 3');
    expect(kopf['addressLine2'], 'der Beleg trägt einen fremden Ort').toBe('90402 Nürnberg');
    expect(kopf['taxNumber']).toBe('241/123/45678');
    expect(kopf['phone']).toBe('0911 1234567');

    // Und die Gegenprobe: KEIN Feld trägt noch einen Wert der fremden Saat.
    const stehengeblieben = Object.entries(kopf)
      .filter(([, v]) => typeof v === 'string' && Object.values(FREMDE_SAAT).includes(v))
      .map(([k, v]) => `${k} = "${String(v)}"`);
    expect(
      stehengeblieben,
      `Ein Feld des Belegkopfs trägt weiter die fremde Saat:\n  ${stehengeblieben.join('\n  ')}`,
    ).toEqual([]);
  });

  it('⛔ die Startliste sagt dasselbe wie der Verkaufsriegel', async () => {
    // Ohne das Datum gilt der Umsatzsteuer-Status als nicht beantwortet, und
    // `pruefeSteuermodus` lehnt jeden Verkauf mit VAT_CHECK_REQUIRED ab.
    expect((await schreibe('steuer.modus_gilt_ab', '')).statusCode).toBe(200);

    // 14.08.2026: die Liste traegt seither ALLE Punkte samt Stand. Offen
    // heisst `erledigt = false`; der Punkt verschwindet nicht mehr, er wird
    // zum erledigten Eintrag. Gemessen wird deshalb der STAND, nicht die
    // blosse Anwesenheit des Titels.
    const ohne = await hole('/api/einrichtung');
    expect(ohne.statusCode, ohne.body).toBe(200);
    const a = ohne.json() as {
      kannVerkaufen: boolean;
      schritte: Array<{ titel: string; erledigt: boolean }>;
    };
    expect(
      a.kannVerkaufen,
      'Die Startliste meldet „bereit", während jeder Verkauf mit 403 abgelehnt wird. ' +
        'Der Händler erfährt es mit einem Kunden davor.',
    ).toBe(false);
    expect(a.schritte.some((s) => s.titel === 'Umsatzsteuer-Status' && !s.erledigt)).toBe(true);

    // Gegenprobe: mit Datum ist der Punkt ERLEDIGT. Ohne diesen Satz wäre
    // eine Liste, die IMMER aufhält, genauso grün.
    expect((await schreibe('steuer.modus_gilt_ab', '2026-01-01')).statusCode).toBe(200);
    const mit = await hole('/api/einrichtung');
    const b = mit.json() as { schritte: Array<{ titel: string; erledigt: boolean }> };
    expect(b.schritte.some((s) => s.titel === 'Umsatzsteuer-Status' && !s.erledigt)).toBe(false);
    expect(b.schritte.some((s) => s.titel === 'Umsatzsteuer-Status' && s.erledigt)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';

import { BELEG_PFLICHTANGABEN, RECEIPT_VAT_LOCK_REASON, SHOP_INFO, fehlendeBelegangaben, fehlendeBelegangabenAufNutzlast, isReceiptShopValid, receiptPayloadTaxIdentifier, receiptTaxIdentifier, resolveShopInfo, type ShopInfo, type ShopInfoApi } from './shop-info.js';

const api = (over: Partial<ShopInfoApi> = {}): ShopInfoApi => ({
  name: 'W14',
  tagline: 'Antiquitäten',
  addressLine1: 'Rosenstraße 40',
  addressLine2: '73614 Schorndorf',
  vatId: 'DE811234567', taxNumber: '',
  phone: '+49 7181 123',
  ...over,
});

describe('resolveShopInfo — no placeholder VAT id ever prints (Phase 7.2 / GoBD)', () => {
  it('the bundled fallback carries NO VAT id', () => {
    expect(SHOP_INFO.vatId).toBe('');
    expect(resolveShopInfo(undefined).vatId).toBe('');
  });

  it('an empty/blank server VAT resolves to empty, never DE123456789', () => {
    expect(resolveShopInfo(api({ vatId: '' })).vatId).toBe('');
    expect(resolveShopInfo(api({ vatId: '   ' })).vatId).toBe('');
  });

  it('takes the real server VAT id when configured', () => {
    expect(resolveShopInfo(api({ vatId: ' DE811234567 ' })).vatId).toBe('DE811234567');
  });

  it('drops an empty phone to null, keeps a real one (trimmed)', () => {
    expect(resolveShopInfo(api({ phone: '' })).phone).toBeNull();
    expect(resolveShopInfo(api({ phone: '   ' })).phone).toBeNull();
    expect(resolveShopInfo(api({ phone: ' +49 7181 123 ' })).phone).toBe('+49 7181 123');
  });

  it('address: server lines win, und eine leere Anschrift bleibt LEER', () => {
    // ── VERTRAGSÄNDERUNG (30.07.2026, Basels Befund) ────────────────────────
    // Hier stand: „Server carries neither line → fall back to the bundled
    // address". Das war der geprüfte Ausdruck einer Regel, die zwei Schäden
    // anrichtete. Erstens Mandantenneutralität: jeder fremde Laden mit noch
    // leeren Feldern trug sichtbar „Rosenstraße 40" auf Beleg und Briefkopf.
    // Zweitens wirkte jede Pflege wie verworfen: wer eine Zeile LEERTE, sah
    // die fremde zurückkommen. Leer ist ab jetzt leer.
    expect(resolveShopInfo(api()).address).toEqual(['Rosenstraße 40', '73614 Schorndorf']);
    expect(resolveShopInfo(api({ addressLine1: '', addressLine2: '' })).address).toEqual([]);
    expect(resolveShopInfo(api({ addressLine1: 'Nur eine Zeile', addressLine2: '' })).address).toEqual(
      ['Nur eine Zeile'],
    );
  });
});

describe('Mandantenneutralität: keine fremde Marke als stiller Rückfall', () => {
  // Der Riegel gegen die Fehlerklasse, die Basel am 30.07.2026 fand: die
  // Maske SAH gefüllt aus, war es aber nicht, und der Speichern-Lauf sprang
  // deshalb über die Identität hinweg. Wer diese Erwartungen wieder umdreht,
  // holt genau dieses Erlebnis zurück.
  it('ein leerer Ladenname bleibt leer, statt WAREHOUSE 14 zu werden', () => {
    expect(resolveShopInfo(api({ name: '' })).name).toBe('');
    // ⚠️ Gegen den LITERALEN Namen prüfen, nicht gegen die Konstante. Am
    // 30.07.2026 wurde `SHOP_INFO.name` selbst auf '' gesetzt (Norns POS wird
    // an fremde Läden verkauft), und damit verglich dieser Wächter '' mit ''
    // und war wertlos. Ein Wächter, der auf eine Veränderliche zeigt, wandert
    // mit ihr mit; dieser hier zeigt auf die Gefahr.
    expect(resolveShopInfo(api({ name: '' })).name).not.toBe('WAREHOUSE 14');
    expect(resolveShopInfo(api({ name: '' })).name).not.toBe('Warehouse14');
  });

  it('eine geleerte Zusatzzeile bleibt geleert', () => {
    expect(resolveShopInfo(api({ tagline: '' })).tagline).toBe('');
  });

  it('die gepflegten Werte eines fremden Ladens gehen unverändert durch', () => {
    const fremd = resolveShopInfo(
      api({ name: 'Stampscoins Schorndorf', addressLine1: 'Hauptstraße 1', addressLine2: '' }),
    );
    expect(fremd.name).toBe('Stampscoins Schorndorf');
    expect(fremd.address).toEqual(['Hauptstraße 1']);
  });
});

describe('isReceiptShopValid — the receipt-lock predicate', () => {
  it('locks (false) when the VAT id is missing or blank', () => {
    expect(isReceiptShopValid(resolveShopInfo(undefined))).toBe(false);
    expect(isReceiptShopValid(resolveShopInfo(api({ vatId: '' })))).toBe(false);
    expect(isReceiptShopValid(resolveShopInfo(api({ vatId: '  ' })))).toBe(false);
  });

  it('is valid (true) with a configured VAT id', () => {
    expect(isReceiptShopValid(resolveShopInfo(api({ vatId: 'DE811234567' })))).toBe(true);
  });
});

describe('RECEIPT_VAT_LOCK_REASON — one honest, dash-free lock message', () => {
  it('names the missing USt-IdNr. and points to the settings', () => {
    expect(RECEIPT_VAT_LOCK_REASON).toContain('USt-IdNr.');
    expect(RECEIPT_VAT_LOCK_REASON).toContain('Einstellungen');
  });

  it('carries no em/en dash (house style)', () => {
    expect(RECEIPT_VAT_LOCK_REASON).not.toMatch(/[—–]/);
  });
});

describe('Steuernummer ODER USt-IdNr., § 14 Abs. 4 Nr. 2 UStG', () => {
  const laden = (vatId: string, taxNumber: string) => ({
    name: 'Testgold', tagline: '', address: ['Weg 1', '73614 Schorndorf'],
    vatId, taxNumber, phone: null,
  });

  it('ein Betrieb mit NUR Steuernummer darf drucken', () => {
    // DAS war der Blocker: ein frisch gegruendeter Edelmetallhaendler hat in
    // aller Regel eine Steuernummer und noch keine USt-IdNr. Vorher blieb die
    // Kasse an Tag eins gesperrt, ohne dass der Grund zu erkennen war.
    expect(isReceiptShopValid(laden('', '93815/08152'))).toBe(true);
    expect(receiptTaxIdentifier(laden('', '93815/08152'))).toEqual({
      label: 'Steuernummer', value: '93815/08152',
    });
  });

  it('ein Betrieb mit NUR USt-IdNr. darf drucken', () => {
    expect(isReceiptShopValid(laden('DE123456789', ''))).toBe(true);
    expect(receiptTaxIdentifier(laden('DE123456789', ''))).toEqual({
      label: 'USt-IdNr.', value: 'DE123456789',
    });
  });

  it('mit BEIDEN hat die USt-IdNr. Vorrang', () => {
    expect(receiptTaxIdentifier(laden('DE123456789', '93815/08152'))?.label).toBe('USt-IdNr.');
  });

  it('OHNE beide bleibt der Beleg gesperrt', () => {
    // Die Sperre bleibt scharf. Sie darf nur nicht mehr zu frueh zuschlagen.
    expect(isReceiptShopValid(laden('', ''))).toBe(false);
    expect(receiptTaxIdentifier(laden('', ''))).toBeNull();
    expect(isReceiptShopValid(laden('   ', '  '))).toBe(false);
  });

  it('der NACHDRUCK folgt derselben Regel wie der Erstdruck', () => {
    // Hier lag der Fehler schon einmal: der Nachdruck verglich das Feld von
    // Hand und war damit von der Regel abgekoppelt.
    expect(receiptPayloadTaxIdentifier({ shopVatId: '', shopTaxNumber: '93815/08152' }))
      .toEqual({ label: 'Steuernummer', value: '93815/08152' });
    expect(receiptPayloadTaxIdentifier({ shopVatId: '', shopTaxNumber: '' })).toBeNull();
    // Ein alter Beleg ohne das neue Feld darf nicht abstuerzen.
    expect(receiptPayloadTaxIdentifier({ shopVatId: 'DE1' })?.label).toBe('USt-IdNr.');
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  § 14 Abs. 4 Nr. 1 UStG: KEIN BELEG OHNE ABSENDER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Gemessen am 05.08.2026: der Riegel verlangte NUR die Steuerkennung. Ein
 * Betrieb ohne Firmenname und ohne Anschrift konnte einen vollständigen
 * Verkauf abschliessen und ein Papier drucken, auf dem oben nichts steht.
 *
 * Diese Sätze werden ROT, sobald der Riegel wieder fällt. Sie prüfen die
 * EIGENSCHAFT jeder Pflichtangabe und laufen dabei über die echte Tabelle,
 * nicht über eine abgeschriebene Namensliste: wer eine vierte Pflichtangabe
 * einträgt und keinen Prüfsatz dazu schreibt, macht diesen Block laut, statt
 * eine ungeprüfte Angabe still mitlaufen zu lassen.
 */
describe('Belegkopf: Firmenname und Anschrift sind Pflicht, nicht Kosmetik', () => {
  const VOLLSTAENDIG: ShopInfo = {
    name: 'Testgold e. K.',
    tagline: '',
    address: ['Weg 1', '73614 Schorndorf'],
    vatId: '',
    taxNumber: '93815/08152',
    phone: null,
  };

  /**
   * Je Pflichtangabe: wie man GENAU sie leert, und sonst nichts.
   *
   * Der Schlüssel ist die Beschriftung aus der echten Tabelle. Fehlt zu einer
   * Tabellenzeile der Eintrag hier, wird der Satz unten rot und nennt sie
   * beim Namen. So kann keine Pflichtangabe ungeprüft dazukommen.
   */
  const LEERT_GENAU_DIESE: Readonly<Record<string, (s: ShopInfo) => ShopInfo>> = {
    // Leerraum, nicht die leere Zeichenkette: „ist gepflegt" darf nicht
    // heissen „hat irgendein Zeichen".
    'der Firmenname': (s) => ({ ...s, name: '   ' }),
    'die Anschrift': (s) => ({ ...s, address: ['  ', ''] }),
    'die Steuernummer oder die USt-IdNr.': (s) => ({ ...s, vatId: ' ', taxNumber: '' }),
  };

  it('ein vollständiger Kopf druckt', () => {
    expect(fehlendeBelegangaben(VOLLSTAENDIG)).toEqual([]);
    expect(isReceiptShopValid(VOLLSTAENDIG)).toBe(true);
  });

  it('jede einzelne Pflichtangabe sperrt für sich, und eine neue wird LAUT', () => {
    for (const angabe of BELEG_PFLICHTANGABEN) {
      const leeren = LEERT_GENAU_DIESE[angabe.label];
      expect(
        leeren,
        `Die Pflichtangabe „${angabe.label}" hat keinen Prüfsatz. Bitte in \`LEERT_GENAU_DIESE\` eintragen, wie man genau sie leert.`,
      ).toBeDefined();
      if (!leeren) continue;

      const laden = leeren(VOLLSTAENDIG);
      expect(fehlendeBelegangaben(laden), `„${angabe.label}" meldet sich nicht`).toEqual([
        angabe.label,
      ]);
      expect(isReceiptShopValid(laden), `„${angabe.label}" sperrt den Druck nicht`).toBe(false);
    }
  });

  it('DER SATZ: ein frischer Laden mit Steuernummer, aber ohne Kopf, druckt NICHT', () => {
    // Das war der gemessene Zustand. Genau er darf nie wiederkommen.
    const ohneAbsender: ShopInfo = { ...VOLLSTAENDIG, name: '', address: [] };
    expect(isReceiptShopValid(ohneAbsender)).toBe(false);
    expect(fehlendeBelegangaben(ohneAbsender)).toEqual(['der Firmenname', 'die Anschrift']);
  });

  it('eine leere Ladenidentität meldet JEDE Pflichtangabe, nicht nur die erste', () => {
    // Sonst entdeckt der Inhaber eine Sperre nach der anderen, jede mit einem
    // Kunden davor. Und der Satz fängt eine Tabellenzeile, die nie feuert.
    const leer = resolveShopInfo(undefined);
    expect(fehlendeBelegangaben(leer)).toHaveLength(BELEG_PFLICHTANGABEN.length);
  });

  it('der NACHDRUCK verlangt denselben Absender wie der Erstdruck', () => {
    // „Vordertür zu, Hintertür offen": ein gespeicherter Beleg ohne Absender
    // darf nicht beliebig oft nachgedruckt werden, nur weil er alt ist.
    expect(
      fehlendeBelegangabenAufNutzlast({
        shopName: 'Testgold e. K.',
        shopAddress: ['Weg 1', '73614 Schorndorf'],
        shopVatId: 'DE811234567',
      }),
    ).toEqual([]);
    expect(
      fehlendeBelegangabenAufNutzlast({
        shopName: '',
        shopAddress: [],
        shopVatId: '',
        shopTaxNumber: '93815/08152',
      }),
    ).toEqual(['der Firmenname', 'die Anschrift']);
  });

  it('GEMESSENE LÜCKE: die Nutzlast kann Zeile und Anschrift NICHT unterscheiden', () => {
    // Dieser Satz hält einen BEFUND fest, kein Wunschverhalten.
    //
    // Im Quelltext stand, der Nachdruck könne „nicht milder werden als der
    // Erstdruck, auch nicht versehentlich". Nachgemessen am 05.08.2026 ist das
    // falsch: `BezahlenDialog` und `buildAnkaufReceipt` schreiben beide
    // `[shop.tagline, ...shop.address]` in EIN Feld `shopAddress`, und
    // `ThermalReceiptData` hat kein eigenes Feld für die Zeile. Ein Betrieb mit
    // Zeile und ohne Anschrift sperrt beim Erstdruck und käme beim Nachdruck
    // durch.
    const mitZeileOhneAnschrift: ShopInfo = {
      name: 'Testgold e. K.',
      tagline: 'An- und Verkauf',
      address: [],
      vatId: 'DE811234567',
      taxNumber: '',
      phone: null,
    };
    expect(fehlendeBelegangaben(mitZeileOhneAnschrift)).toEqual(['die Anschrift']);

    // Genau so entsteht die gespeicherte Nutzlast, Zeile für Zeile abgeschrieben.
    const wieDieNutzlastEntsteht = [
      mitZeileOhneAnschrift.tagline,
      ...mitZeileOhneAnschrift.address,
    ].filter((l) => l.trim().length > 0);
    expect(
      fehlendeBelegangabenAufNutzlast({
        shopName: mitZeileOhneAnschrift.name,
        shopAddress: wieDieNutzlastEntsteht,
        shopVatId: mitZeileOhneAnschrift.vatId,
        shopTaxNumber: mitZeileOhneAnschrift.taxNumber,
      }),
      'Wird dieser Satz ROT, dann trennt die Nutzlast Zeile und Anschrift endlich. Dann diesen Satz löschen und im Quelltext die Warnung über `fehlendeBelegangabenAufNutzlast` mit entfernen.',
    ).toEqual([]);
  });

  it('die Sperrmeldung zeigt nicht auf das falsche Feld', () => {
    // Vorher nannte sie AUSSCHLIESSLICH die Steuerkennung. Ein Betrieb mit
    // gepflegter Steuernummer und leerem Namen hätte sie nachgetragen und
    // wäre trotzdem gesperrt geblieben, ohne zu erfahren warum.
    expect(RECEIPT_VAT_LOCK_REASON).toContain('Firmenname');
    expect(RECEIPT_VAT_LOCK_REASON).toContain('Anschrift');
    expect(RECEIPT_VAT_LOCK_REASON).toContain('USt-IdNr.');
    expect(RECEIPT_VAT_LOCK_REASON).toContain('Einstellungen');
  });
});

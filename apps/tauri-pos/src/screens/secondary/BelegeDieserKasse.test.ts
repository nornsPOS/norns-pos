/**
 * DIE BELEGLISTE WIRD WIRKLICH GERENDERT.
 *
 * ── WARUM ES DIESE DATEI GIBT (13.08.2026) ─────────────────────────────────
 *
 * Der Nachdruckvorrat hatte Prüfsätze, die Fläche hatte keine. Alle Sätze lagen
 * auf `lib/belegarchiv.ts` und `lib/belegsuche.ts`, also auf den Bibliotheken
 * UNTER dem Bildschirm. Beide waren grün, während der Bildschirm selbst drei
 * Fehler zeigte. Genau so sieht ein blinder Fleck aus: geprüft wurde, was
 * leicht zu prüfen war, nicht das, was der Mensch sieht.
 *
 * Diese Datei rendert deshalb die ECHTE Fläche und liest das erzeugte HTML.
 * Kein Nachbau, keine Textsuche im Quelltext. Was hier steht, stand so auf dem
 * Bildschirm.
 *
 * ── DIE DREI GEMESSENEN FEHLER, DIE HIER FESTGENAGELT SIND ─────────────────
 *
 *   1. JEDER Ankaufbeleg zeigte statt des Betrags einen Gedankenstrich.
 *   2. Die Zeitspalte zeigte an den Tagen 1 bis 12 den FALSCHEN Tag: ein Beleg
 *      vom 3. August stand als „08.03." in der Liste.
 *   3. Der Kopf behauptete „Die letzten 50 Belege, die diese Kasse GEDRUCKT
 *      hat" — bei drei Belegen, auf einer Kasse, die auch ohne Drucker füllt.
 *
 * ── WIE HIER GERENDERT WIRD, UND WARUM SO ──────────────────────────────────
 *
 * `vitest.config.ts` fährt diese Kasse in `environment: 'node'`, ohne DOM. Ein
 * echter Klickweg ist damit nicht zu haben. `renderToStaticMarkup` läuft aber
 * ohne DOM und rendert dieselben Komponenten mit denselben Daten, und das
 * genügt für alles, was hier geprüft wird: Text, Zahl, Datum, Satz.
 *
 * ⚠️ Der Belegspeicher wird NICHT von aussen gesetzt, sondern über die PLATTE
 * befüllt. Zwei Gründe:
 *   • Zustand liest beim Rendern ohne DOM `getInitialState()` (zustand/react.js,
 *     dritter Zeiger von `useSyncExternalStore`). Ein `setState` nach dem Import
 *     wäre unsichtbar — der erste Versuch dieser Datei rannte genau da hinein
 *     und rendert die leere Liste.
 *   • Über die Platte zu befüllen ist ohnehin der ehrlichere Weg: das ist genau
 *     der Weg, den ein Neustart der Kasse geht.
 * Deshalb je Fall: Platte setzen, `vi.resetModules()`, frisch importieren.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { BELEGARCHIV_SCHLUESSEL } from '../../lib/belegarchiv.js';
import { buildAnkaufReceipt } from '../../lib/ankauf-receipt.js';
import type { ThermalReceiptData } from '../../lib/hardware-client.js';

// ─────────────────────────────────────────────────────────────────────────
// Werkzeug
// ─────────────────────────────────────────────────────────────────────────

/** Ein Verkaufsbeleg, so wie ihn `BezahlenDialog` ablegt (Maschinenbetrag). */
function verkaufsbeleg(
  nummer: string,
  extra: Partial<ThermalReceiptData> = {},
): ThermalReceiptData {
  return {
    shopName: 'Goldhaus Basel',
    shopAddress: ['Marktplatz 1', '12345 Musterstadt'],
    shopVatId: 'DE123456789',
    shopTaxNumber: '',
    shopPhone: null,
    receiptLocator: nummer,
    // Genau das Format aus `BezahlenDialog.tsx:1189`: schon deutscher Text.
    printedAt: new Date('2026-08-03T07:15:00.000Z').toLocaleString('de-DE', {
      timeZone: 'Europe/Berlin',
    }),
    cashierName: 'Bediener',
    shiftId: null,
    items: [
      {
        name: 'Goldring 585',
        quantity: 1,
        unitPriceEur: '119.00',
        lineTotalEur: '119.00',
        vatLabel: '19%',
      },
    ],
    subtotalEur: '100.00',
    vatEur: '19.00',
    totalEur: '119.00',
    paymentMethodLabel: 'Bar',
    cashReceivedEur: '120.00',
    changeEur: '1.00',
    tseSignatureValue: 'sig',
    tseSignatureCounter: '7',
    tseTransactionNumber: '42',
    tseQrPayload: 'qr',
    footerLines: ['Vielen Dank für Ihren Besuch.'],
    ...extra,
  };
}

/**
 * Ein Ankaufbeleg vom ECHTEN Erbauer.
 *
 * ⚠️ Bewusst NICHT von Hand zusammengesetzt. Der Defekt steckte genau in der
 * Schreibweise, die `buildAnkaufReceipt` erzeugt (`formatEuro`, deutscher
 * Anzeigetext). Ein handgeschriebener Beleg hätte den Fehler nie gezeigt.
 */
function ankaufbeleg(nummer: string, totalEur: string): ThermalReceiptData {
  return buildAnkaufReceipt({
    shop: {
      name: 'Goldhaus Basel',
      tagline: 'Edelmetall seit 1998',
      address: ['Marktplatz 1', '12345 Musterstadt'],
      vatId: 'DE123456789',
      taxNumber: '',
      phone: null,
    },
    receiptLocator: nummer,
    finalizedAtIso: '2026-08-03T07:15:00.000Z',
    cashierName: 'Bediener',
    sellerName: 'Hans Mustermann',
    payoutMethod: 'CASH',
    items: [{ name: 'Altgold 585', negotiatedPriceEur: totalEur, seriennummer: null, gravur: null }],
    totalEur,
    tse: null,
  });
}

function platte(inhalt: readonly ThermalReceiptData[]): Storage {
  const daten = new Map<string, string>([[BELEGARCHIV_SCHLUESSEL, JSON.stringify(inhalt)]]);
  return {
    get length(): number {
      return daten.size;
    },
    clear: () => daten.clear(),
    getItem: (k: string) => daten.get(k) ?? null,
    key: (i: number) => Array.from(daten.keys())[i] ?? null,
    removeItem: (k: string) => void daten.delete(k),
    setItem: (k: string, v: string) => void daten.set(k, v),
  } as Storage;
}

/** Die Fläche mit diesem Vorrat auf der Platte rendern. */
async function rendere(inhalt: readonly ThermalReceiptData[]): Promise<string> {
  Object.defineProperty(globalThis, 'localStorage', {
    value: platte(inhalt),
    configurable: true,
    writable: true,
  });
  vi.resetModules();
  const { BelegeDieserKasse } = await import('./BelegeDieserKasse.js');
  return renderToStaticMarkup(createElement(BelegeDieserKasse));
}

/** Ohne jede Platte rendern — der Fall „Speicher abgeschaltet". */
async function rendereOhnePlatte(): Promise<string> {
  Reflect.deleteProperty(globalThis, 'localStorage');
  vi.resetModules();
  const { BelegeDieserKasse } = await import('./BelegeDieserKasse.js');
  return renderToStaticMarkup(createElement(BelegeDieserKasse));
}

/** Nur der lesbare Text, ohne Auszeichnung. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;| /g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

beforeEach(() => {
  vi.resetModules();
});

// ─────────────────────────────────────────────────────────────────────────
// MANGEL 1 — der Ankaufbeleg zeigte keinen Betrag
// ─────────────────────────────────────────────────────────────────────────

describe('Jede Zeile zeigt ihren Betrag, auch die Ankaufzeile', () => {
  it('der Ankaufbeleg zeigt sein Geld statt eines Gedankenstrichs', async () => {
    // Gemessen: `buildAnkaufReceipt` legt „1.234,50" ab (deutscher Anzeigetext,
    // ankauf-receipt.ts:112), `MoneyAmount` nimmt aber nur „1234.50" an
    // (MoneyAmount.tsx:48) und zeigte sonst „—". Der Verkaufsweg schreibt
    // `fromCents`, traf also nie auf: der Fehler betraf AUSSCHLIESSLICH Ankäufe,
    // und dort ausnahmslos jeden.
    const html = await rendere([ankaufbeleg('A-2026-0002', '1234.50')]);

    expect(text(html)).toContain('1.234,50');
  });

  it('auch ein kleiner Ankaufbetrag kommt an', async () => {
    // „119,00" hat keinen Tausenderpunkt und scheiterte trotzdem — am Komma.
    const html = await rendere([ankaufbeleg('A-2026-0003', '119.00')]);

    expect(text(html)).toContain('119,00');
  });

  it('keine Zeile zeigt den Platzhalter statt eines Betrags', async () => {
    const html = await rendere([
      ankaufbeleg('A-2026-0002', '1234.50'),
      verkaufsbeleg('B-2026-0001'),
    ]);

    // Der Platzhalter von `MoneyAmount` für „nicht lesbar".
    expect(html).not.toContain('>—</span>');
  });

  it('der Verkaufsbeleg zeigt seinen Betrag weiterhin', async () => {
    const html = await rendere([verkaufsbeleg('B-2026-0001')]);

    expect(text(html)).toContain('119,00');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// MANGEL 2 — die Zeitspalte zeigte den falschen Tag
// ─────────────────────────────────────────────────────────────────────────

describe('Die Zeitspalte nennt den Tag, an dem der Beleg entstand', () => {
  it('ein Beleg vom 3. August steht als 03.08. da, nicht als 08.03.', async () => {
    // ⚠️ DER EIGENTLICHE FUND. `printedAt` ist bei allen Schreibern schon
    // deutscher Text. `new Date("3.8.2026, 09:15:00")` ergibt in V8 nicht
    // „ungültig", sondern den 8. MÄRZ. Der alte Rückfallzweig prüfte auf
    // „ungültig" und griff deshalb nur an den Tagen 13 bis 31. An den Tagen 1
    // bis 12 log die Spalte mit voller Überzeugung, und niemand sah es, weil
    // ein plausibles Datum dastand.
    const html = await rendere([verkaufsbeleg('B-2026-0001')]);
    const t = text(html);

    expect(t).toContain('03.08.');
    expect(t).not.toContain('08.03.');
  });

  it('der Ankaufbeleg trägt denselben Tag', async () => {
    const html = await rendere([ankaufbeleg('A-2026-0002', '1234.50')]);
    const t = text(html);

    expect(t).toContain('03.08.');
    expect(t).not.toContain('08.03.');
  });

  it('ein Beleg am 13. eines Monats zeigt weiterhin seinen Tag', async () => {
    // Die Gegenprobe: an diesen Tagen fiel der alte Weg auf „ungültig" zurück
    // und zeigte den ganzen gespeicherten Text. Auch das ist jetzt eine kurze,
    // richtige Spalte.
    const html = await rendere([
      verkaufsbeleg('B-2026-0009', {
        printedAt: new Date('2026-08-13T07:15:00.000Z').toLocaleString('de-DE', {
          timeZone: 'Europe/Berlin',
        }),
      }),
    ]);

    expect(text(html)).toContain('13.08.');
  });

  it('ein unlesbarer Zeitstempel wird gezeigt, nicht erfunden', async () => {
    const html = await rendere([verkaufsbeleg('B-2026-0010', { printedAt: 'unbekannt' })]);

    expect(text(html)).toContain('unbekannt');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// MANGEL 3 — der Kopf übertrieb sich selbst
// ─────────────────────────────────────────────────────────────────────────

describe('Der Kopfsatz sagt die Wahrheit über diesen Vorrat', () => {
  it('er behauptet nicht mehr, die Belege seien GEDRUCKT worden', async () => {
    // In den Vorrat kommt ein Beleg beim ABSCHLUSS (BezahlenDialog.tsx:1259,
    // AnkaufBezahlenDialog.tsx:257), auch im Offline-Zweig ohne jeden Drucker.
    // Eine Kasse ganz ohne eingerichteten Drucker füllt diese Liste vollständig.
    const html = await rendere([verkaufsbeleg('B-2026-0001')]);
    const t = text(html);

    expect(t).not.toContain('gedruckt hat');
    expect(t).toContain('ausgestellt');
  });

  it('er nennt die wirkliche Zahl, nicht die Obergrenze als Bestand', async () => {
    // Vorher stand „Die letzten 50 Belege" da, auch wenn zwei dalagen.
    const html = await rendere([verkaufsbeleg('B-2026-0001'), ankaufbeleg('A-2026-0002', '99.00')]);
    const t = text(html);

    expect(t).toContain('2 Belege liegen hier bereit');
    expect(t).not.toContain('Die letzten 50 Belege');
  });

  it('er nennt die Obergrenze trotzdem, damit niemand ein Archiv erwartet', async () => {
    const html = await rendere([verkaufsbeleg('B-2026-0001')]);

    expect(text(html)).toContain('letzten 50');
  });

  it('bei genau einem Beleg steht die Einzahl', async () => {
    const html = await rendere([verkaufsbeleg('B-2026-0001')]);

    expect(text(html)).toContain('Ein Beleg liegt hier bereit');
  });

  it('ohne Speicher verspricht er KEINEN überlebten Neustart', async () => {
    // Ist der Speicher des Fensters abgeschaltet, überlebt nichts einen
    // Neustart. Der Satz behauptete das trotzdem, vom ersten Rendern an.
    const html = await rendereOhnePlatte();
    const t = text(html);

    expect(t).not.toContain('Sie überstehen einen Neustart.');
    expect(t).toContain('nimmt nichts mehr an');
  });

  it('mit Speicher steht die Zusage', async () => {
    const html = await rendere([verkaufsbeleg('B-2026-0001')]);

    expect(text(html)).toContain('Sie überstehen einen Neustart.');
  });

  it('die leere Fläche spricht ebenfalls von ausstellen, nicht von drucken', async () => {
    const html = await rendere([]);
    const t = text(html);

    expect(t).toContain('noch keinen Beleg ausgestellt');
    expect(t).not.toContain('noch keinen Beleg gedruckt');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Was die Fläche sonst noch halten muss
// ─────────────────────────────────────────────────────────────────────────

describe('Die Zeile bleibt vollständig', () => {
  it('Belegnummer, Art und Nachdruckknopf stehen je Zeile', async () => {
    const html = await rendere([
      ankaufbeleg('A-2026-0002', '1234.50'),
      verkaufsbeleg('B-2026-0001'),
    ]);
    const t = text(html);

    expect(t).toContain('A-2026-0002');
    expect(t).toContain('B-2026-0001');
    expect(t).toContain('Ankauf');
    expect(t).toContain('Verkauf');
    expect(html.match(/Nachdrucken/g) ?? []).toHaveLength(2);
  });

  it('ein beschädigter Eintrag nimmt die heile Zeile nicht mit', async () => {
    // Die Platte ist unvertraut (Muster P2.6). Der halbe Eintrag fällt weg,
    // der echte Beleg bleibt nachdruckbar.
    const html = await rendere([
      { receiptLocator: 'B-KAPUTT' } as unknown as ThermalReceiptData,
      verkaufsbeleg('B-2026-0001'),
    ]);
    const t = text(html);

    expect(t).toContain('B-2026-0001');
    expect(t).not.toContain('B-KAPUTT');
  });
});

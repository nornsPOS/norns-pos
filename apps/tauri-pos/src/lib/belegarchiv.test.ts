/**
 * Der Nachdruckvorrat — die Regeln, die den gemessenen Defekt festhalten.
 *
 * DER DEFEKT: `state/last-receipt-store.ts` hielt genau EINEN Beleg, nur im
 * Arbeitsspeicher, und überschrieb ihn bedingungslos. Nach dem nächsten
 * Verkauf war der vorige Beleg weg; ein Neustart löschte auch den letzten.
 * Der Ankaufdialog versprach derweil „auch später nachdruckbar".
 *
 * Die beiden ersten Prüfsätze sind genau diese zwei Sätze, umgedreht.
 */

import { describe, expect, it } from 'vitest';

import {
  BELEGARCHIV_HOECHSTZAHL,
  BELEGARCHIV_SCHLUESSEL,
  BELEGVORRAT_LEER,
  NACHDRUCK_NACH_DRUCKFEHLER,
  NACHDRUCK_ORT,
  NACHDRUCK_ZUSAGE,
  NACHDRUCK_ZUSAGE_GESPERRT,
  belegAnNummer,
  belegEinreihen,
  belegZeile,
  belegeLesen,
  belegeLoeschen,
  belegeSchreiben,
  belegvorratSatz,
  betragKanonisch,
  istBelegNutzlast,
  plattenVorhanden,
  zeitpunktKurz,
} from './belegarchiv.js';
import type { ThermalReceiptData } from './hardware-client.js';

// ─────────────────────────────────────────────────────────────────────────
// Werkzeug
// ─────────────────────────────────────────────────────────────────────────

function beleg(nummer: string, extra: Partial<ThermalReceiptData> = {}): ThermalReceiptData {
  return {
    shopName: 'Goldhaus Basel',
    shopAddress: ['Marktplatz 1', '12345 Musterstadt'],
    shopVatId: 'DE123456789',
    shopTaxNumber: '',
    shopPhone: null,
    receiptLocator: nummer,
    printedAt: '2026-08-13T09:15:00.000Z',
    cashierName: 'Hana',
    shiftId: 'schicht-1',
    items: [
      {
        name: 'Goldring 585',
        quantity: 1,
        unitPriceEur: '119.00',
        lineTotalEur: '119.00',
        vatLabel: 'A',
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

/** Ein Speicher, der sich wie `localStorage` verhält — inklusive Ausfall. */
function lager(voll = false): Storage {
  const daten = new Map<string, string>();
  return {
    get length(): number {
      return daten.size;
    },
    clear: () => daten.clear(),
    getItem: (k: string) => daten.get(k) ?? null,
    key: (i: number) => Array.from(daten.keys())[i] ?? null,
    removeItem: (k: string) => {
      daten.delete(k);
    },
    setItem: (k: string, v: string) => {
      if (voll) throw new Error('QuotaExceededError');
      daten.set(k, v);
    },
  } as Storage;
}

// ─────────────────────────────────────────────────────────────────────────
// Die zwei Sätze, die der Defekt gebrochen hat
// ─────────────────────────────────────────────────────────────────────────

describe('Der Nachdruckvorrat hält mehr als einen Beleg', () => {
  it('der vorige Beleg überlebt den nächsten Verkauf', () => {
    // Genau der Weg am Tresen: erst Kunde A, dann Kunde B. Vorher stand nach
    // dem zweiten Verkauf nur noch B im Speicher, und A war nicht mehr
    // nachdruckbar — obwohl er noch im Laden stand.
    let vorrat: ThermalReceiptData[] = [];
    vorrat = belegEinreihen(vorrat, beleg('B-2026-0001'));
    vorrat = belegEinreihen(vorrat, beleg('B-2026-0002'));

    expect(vorrat).toHaveLength(2);
    expect(belegAnNummer(vorrat, 'B-2026-0001')).not.toBeNull();
    expect(belegAnNummer(vorrat, 'B-2026-0002')).not.toBeNull();
  });

  it('der jüngste Beleg steht vorn', () => {
    let vorrat: ThermalReceiptData[] = [];
    vorrat = belegEinreihen(vorrat, beleg('B-2026-0001'));
    vorrat = belegEinreihen(vorrat, beleg('B-2026-0002'));

    expect(vorrat[0]?.receiptLocator).toBe('B-2026-0002');
  });

  it('derselbe Beleg zweimal eingereiht bleibt EIN Eintrag', () => {
    // Ein zweiter Druckversuch desselben Belegs darf den Vorrat nicht mit
    // Doppelgängern füllen und dadurch echte Belege hinausdrängen.
    let vorrat: ThermalReceiptData[] = [];
    vorrat = belegEinreihen(vorrat, beleg('B-2026-0001'));
    vorrat = belegEinreihen(vorrat, beleg('B-2026-0002'));
    vorrat = belegEinreihen(vorrat, beleg('B-2026-0001', { cashierName: 'Omar' }));

    expect(vorrat).toHaveLength(2);
    expect(vorrat[0]?.receiptLocator).toBe('B-2026-0001');
    expect(vorrat[0]?.cashierName).toBe('Omar');
  });

  it('über der Obergrenze fällt der ÄLTESTE heraus, nie der neue', () => {
    let vorrat: ThermalReceiptData[] = [];
    for (let i = 1; i <= BELEGARCHIV_HOECHSTZAHL + 3; i += 1) {
      vorrat = belegEinreihen(vorrat, beleg(`B-${String(i).padStart(4, '0')}`));
    }

    expect(vorrat).toHaveLength(BELEGARCHIV_HOECHSTZAHL);
    expect(
      belegAnNummer(vorrat, `B-${String(BELEGARCHIV_HOECHSTZAHL + 3).padStart(4, '0')}`),
    ).not.toBeNull();
    expect(belegAnNummer(vorrat, 'B-0001')).toBeNull();
  });
});

describe('Der Neustart der Kasse löscht den Beleg nicht', () => {
  it('was geschrieben wurde, wird wieder gelesen', () => {
    // „Neustart" heisst hier: derselbe Speicher, ein neuer Lesevorgang ohne
    // jeden Zustand im Arbeitsspeicher. Vorher gab es nichts zu lesen, weil
    // nichts geschrieben wurde.
    const platte = lager();
    const vorrat = belegEinreihen(belegEinreihen([], beleg('B-0001')), beleg('B-0002'));
    expect(belegeSchreiben(vorrat, platte)).toBe(true);

    const nachNeustart = belegeLesen(platte);

    expect(nachNeustart).toHaveLength(2);
    expect(belegAnNummer(nachNeustart, 'B-0001')?.totalEur).toBe('119.00');
  });

  it('ein voller Speicher meldet das und wirft nicht', () => {
    // Der Beleg ist in diesem Moment schon gedruckt und verbucht. Eine Ausnahme
    // hier würde den Verkauf abbrechen, nachdem das Geld schon geflossen ist.
    expect(() => belegeSchreiben([beleg('B-0001')], lager(true))).not.toThrow();
    expect(belegeSchreiben([beleg('B-0001')], lager(true))).toBe(false);
  });

  it('löschen räumt die Platte wirklich', () => {
    const platte = lager();
    belegeSchreiben([beleg('B-0001')], platte);
    belegeLoeschen(platte);

    expect(platte.getItem(BELEGARCHIV_SCHLUESSEL)).toBeNull();
    expect(belegeLesen(platte)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Die Grenze zum Speicher ist unvertraut
// ─────────────────────────────────────────────────────────────────────────

describe('Ein kaputter Eintrag nimmt die heilen nicht mit', () => {
  it('Müll im Speicher ergibt eine leere Liste, keine Ausnahme', () => {
    const platte = lager();
    platte.setItem(BELEGARCHIV_SCHLUESSEL, '{kein json');
    expect(belegeLesen(platte)).toEqual([]);

    platte.setItem(BELEGARCHIV_SCHLUESSEL, '"kein array"');
    expect(belegeLesen(platte)).toEqual([]);
  });

  it('eine beschädigte Zeile fällt einzeln weg, die übrigen bleiben', () => {
    const platte = lager();
    platte.setItem(
      BELEGARCHIV_SCHLUESSEL,
      JSON.stringify([beleg('B-0001'), { receiptLocator: 'B-0002' }, beleg('B-0003')]),
    );

    const gelesen = belegeLesen(platte);

    expect(gelesen.map((b) => b.receiptLocator)).toEqual(['B-0001', 'B-0003']);
  });

  it('ein Beleg ohne Nummer ist kein Beleg', () => {
    expect(istBelegNutzlast(beleg(''))).toBe(false);
    expect(istBelegNutzlast(null)).toBe(false);
    expect(istBelegNutzlast(beleg('B-0001'))).toBe(true);
  });

  it('eine Belegzeile ohne Betrag macht den ganzen Beleg ungültig', () => {
    const kaputt = beleg('B-0001');
    // biome-ignore lint/suspicious/noExplicitAny: absichtlich kaputte Nutzlast
    (kaputt.items[0] as any).lineTotalEur = undefined;
    expect(istBelegNutzlast(kaputt)).toBe(false);
  });

  it('wahlfreie Felder überleben die Prüfung unverändert', () => {
    // Eine Namensliste wird blind, sobald jemand ein Feld ergänzt. Die Prüfung
    // reicht deshalb weiter, statt neu zu bauen.
    const mitZusatz = beleg('B-0001', {
      documentKind: 'ANKAUF',
      counterpartyLabel: 'Verkäufer: Hans Mustermann',
      specialSchemeNotices: ['Gebrauchtgegenstände/Sonderregelung'],
    });
    const platte = lager();
    belegeSchreiben(belegEinreihen([], mitZusatz), platte);

    const gelesen = belegeLesen(platte)[0];

    expect(gelesen?.documentKind).toBe('ANKAUF');
    expect(gelesen?.counterpartyLabel).toBe('Verkäufer: Hans Mustermann');
    expect(gelesen?.specialSchemeNotices).toEqual(['Gebrauchtgegenstände/Sonderregelung']);
  });
});

describe('Das Logo geht nicht auf die Platte', () => {
  it('die Logofelder werden ENTFERNT, nicht auf nichts gesetzt', () => {
    // `thermalClient.print` hängt das Logo nur an, wenn das Feld `undefined`
    // ist. Ein gespeichertes `null` liesse jeden Nachdruck ohne Bild — und
    // fünfzig Belege mit Logo sprengen den Speicher des Fensters.
    const mitLogo = beleg('B-0001', {
      logoBytesBase64: 'AAAA',
      logoFormat: 'png',
      logoSize: 'mittel',
    });

    const eingereiht = belegEinreihen([], mitLogo)[0] as ThermalReceiptData;

    expect('logoBytesBase64' in eingereiht).toBe(false);
    expect('logoFormat' in eingereiht).toBe(false);
    expect('logoSize' in eingereiht).toBe(false);
    expect(eingereiht.logoBytesBase64).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Die Zusage darf nicht mehr lügen
// ─────────────────────────────────────────────────────────────────────────

describe('Die Nachdruckzusage nennt den Ort und verspricht nichts Unmögliches', () => {
  it('jede Zusage nennt die Fläche, auf der der Nachdruck wirklich liegt', () => {
    for (const satz of [NACHDRUCK_ZUSAGE, NACHDRUCK_ZUSAGE_GESPERRT, NACHDRUCK_NACH_DRUCKFEHLER]) {
      expect(satz).toContain(NACHDRUCK_ORT);
    }
  });

  it('keine Zusage zeigt mehr auf den Knopf, der nur EINEN Beleg druckt', () => {
    // Der alte Wortlaut lautete: Auch später über die Kasse nachdruckbar
    // („letzten Beleg drucken"). Dieser Knopf konnte immer nur den einen
    // Beleg im Arbeitsspeicher drucken.
    for (const satz of [NACHDRUCK_ZUSAGE, NACHDRUCK_ZUSAGE_GESPERRT, NACHDRUCK_NACH_DRUCKFEHLER]) {
      expect(satz).not.toContain('letzten Beleg drucken');
    }
  });

  it('die gesperrte Zusage behauptet KEINE sofortige Nachdruckbarkeit', () => {
    // Der Nachdruck prüft denselben Riegel wie der Erstdruck. Wer hier
    // „nachdruckbar" liest, während der Beleg gesperrt ist, wird belogen.
    expect(NACHDRUCK_ZUSAGE_GESPERRT).not.toContain('nachdruckbar');
    expect(NACHDRUCK_ZUSAGE_GESPERRT).toContain('ergänzt');
  });

  it('die Zusage nennt die Grenze des Vorrats', () => {
    // Ohne die Zahl verspräche der Satz ein Archiv, das diese Kasse nicht hat.
    expect(NACHDRUCK_ZUSAGE).toContain(String(BELEGARCHIV_HOECHSTZAHL));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Die Zeile, die der Mensch sieht
//
// Diese Regeln halten die zwei Defekte fest, die am 13.08.2026 am gerenderten
// Bildschirm gemessen wurden. Der Bildschirm selbst wird in
// `screens/secondary/BelegeDieserKasse.test.ts` gerendert; hier stehen die
// Regeln darunter, damit ein Fehlschlag sofort zeigt, WELCHE Regel brach.
// ─────────────────────────────────────────────────────────────────────────

describe('Der Betrag wird gelesen, egal welcher Weg ihn geschrieben hat', () => {
  it('der deutsche Anzeigebetrag des Ankaufwegs wird umgerechnet', () => {
    // `ankauf-receipt.ts:112` schreibt „1.234,50"; `MoneyAmount` nimmt nur
    // „1234.50". Genau diese Lücke zeigte auf jeder Ankaufzeile einen Strich.
    expect(betragKanonisch('1.234,50')).toBe('1234.50');
    expect(betragKanonisch('119,00')).toBe('119.00');
    expect(betragKanonisch('-8,00')).toBe('-8.00');
    expect(betragKanonisch('1.234.567,89')).toBe('1234567.89');
  });

  it('der Maschinenbetrag des Verkaufswegs bleibt unangetastet', () => {
    expect(betragKanonisch('1234.50')).toBe('1234.50');
    expect(betragKanonisch('119.00')).toBe('119.00');
    expect(betragKanonisch('-8.00')).toBe('-8.00');
  });

  it('was keine der beiden Schreibweisen ist, wird NICHT geraten', () => {
    expect(betragKanonisch('')).toBeNull();
    expect(betragKanonisch('kein Betrag')).toBeNull();
    expect(betragKanonisch('12,3')).toBeNull();
    expect(betragKanonisch('1.23,45')).toBeNull();
  });

  it('jedes Ergebnis wird von der Geldanzeige wirklich angenommen', () => {
    // Die EINE Regel: was hier herauskommt, muss durch den Filter von
    // `MoneyAmount.tsx:48` passen. Sonst wandert der Strich nur weiter.
    const wieMoneyAmount = /^-?\d+(?:\.\d+)?$/;
    for (const roh of ['1.234,50', '119,00', '-8,00', '1234.50', '0,00']) {
      expect(wieMoneyAmount.test(betragKanonisch(roh) as string)).toBe(true);
    }
  });
});

describe('Der Zeitstempel wird nie zu einem falschen Tag', () => {
  it('der 3. August bleibt der 3. August', () => {
    // ⚠️ DER FUND: `new Date("3.8.2026, 09:15:00")` ergibt in V8 den 8. MÄRZ,
    // nicht „ungültig". Der alte Rückfallzweig prüfte auf „ungültig" und griff
    // deshalb nur an den Tagen 13 bis 31.
    expect(zeitpunktKurz('3.8.2026, 09:15:00')).toBe('03.08., 09:15');
  });

  it('jeder Tag von 1 bis 12 bleibt sein eigener Tag', () => {
    // Die ganze stille Zone auf einmal: an genau diesen Tagen log die Spalte.
    for (let tag = 1; tag <= 12; tag += 1) {
      expect(zeitpunktKurz(`${tag}.8.2026, 09:15:00`)).toBe(
        `${String(tag).padStart(2, '0')}.08., 09:15`,
      );
    }
  });

  it('auch die Tage ab 13 kommen kurz und richtig heraus', () => {
    expect(zeitpunktKurz('13.8.2026, 09:15:00')).toBe('13.08., 09:15');
    expect(zeitpunktKurz('31.12.2026, 23:59:00')).toBe('31.12., 23:59');
  });

  it('eindeutiges ISO darf weiterhin gerechnet werden', () => {
    expect(zeitpunktKurz('2026-08-03T09:15:00.000Z')).toContain('03.08.');
  });

  it('was nicht sicher erkannt wird, kommt unverändert zurück', () => {
    // Lieber ein langer Text in der Spalte als ein erfundener Tag.
    expect(zeitpunktKurz('unbekannt')).toBe('unbekannt');
    expect(zeitpunktKurz('99.99.2026, 09:15:00')).toBe('99.99.2026, 09:15:00');
  });
});

describe('belegZeile reicht der Fläche alles fertig', () => {
  it('Ankauf und Verkauf werden benannt', () => {
    expect(belegZeile(beleg('B-0001')).art).toBe('Verkauf');
    expect(belegZeile(beleg('A-0002', { documentKind: 'ANKAUF' })).art).toBe('Ankauf');
  });

  it('der Rohbetrag bleibt erhalten, falls er nicht lesbar war', () => {
    const zeile = belegZeile(beleg('B-0001', { totalEur: 'kaputt' }));

    expect(zeile.betragEur).toBeNull();
    expect(zeile.rohbetrag).toBe('kaputt');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Der Kopfsatz der Belegliste
// ─────────────────────────────────────────────────────────────────────────

describe('Der Kopfsatz behauptet nur, was diese Kasse wirklich tut', () => {
  it('er sagt nicht „gedruckt", denn gespeichert wird beim ABSCHLUSS', () => {
    // Eine Kasse ohne eingerichteten Drucker füllt diese Liste vollständig:
    // `setLastReceipt` hängt am Abschluss, nicht am Druck, Offline-Zweig
    // eingeschlossen.
    const satz = belegvorratSatz(3, true);

    expect(satz).not.toContain('gedruckt');
    expect(satz).toContain('ausgestellt');
    expect(BELEGVORRAT_LEER).not.toContain('gedruckt');
    expect(BELEGVORRAT_LEER).toContain('ausgestellt');
  });

  it('er nennt den WIRKLICHEN Bestand, nicht die Obergrenze', () => {
    expect(belegvorratSatz(3, true)).toContain('3 Belege');
    expect(belegvorratSatz(3, true)).not.toContain(`Die letzten ${BELEGARCHIV_HOECHSTZAHL} Belege`);
    expect(belegvorratSatz(1, true)).toContain('Ein Beleg');
    expect(belegvorratSatz(0, true)).toContain('Noch kein Beleg');
  });

  it('er nennt die Obergrenze als Obergrenze', () => {
    expect(belegvorratSatz(3, true)).toContain(`letzten ${BELEGARCHIV_HOECHSTZAHL}`);
  });

  it('er verspricht den Neustart nur, wenn die Platte trägt', () => {
    expect(belegvorratSatz(3, true)).toContain('überstehen einen Neustart');
    expect(belegvorratSatz(3, false)).not.toContain('überstehen einen Neustart');
    expect(belegvorratSatz(3, false)).toContain('nimmt nichts mehr an');
  });

  it('er verspricht kein Nachholen älterer Belege vom Server', () => {
    // Zu Belegen existiert im Klienten nur Schreibverkehr; `recent` liefert
    // weder Warenkorb noch Signatur. „Noch nicht" wäre eine Zusage gewesen.
    expect(belegvorratSatz(3, true)).toContain('lassen sie sich nicht nachdrucken');
  });
});

describe('Ob es überhaupt eine Platte gibt, wird gemessen', () => {
  it('ohne Speicher ist die Antwort Nein', () => {
    expect(plattenVorhanden(null)).toBe(false);
  });

  it('mit Speicher ist die Antwort Ja', () => {
    expect(plattenVorhanden(lager())).toBe(true);
  });
});

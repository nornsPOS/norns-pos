/**
 * Der Prüfsatz zum gerechneten Tagespreis.
 *
 * Er hält den gemessenen Defekt fest: der Motor legt `kurspreisEur` und
 * `kurspreisGrund` bei jeder Lagerabfrage bei
 * (`apps/api-cloud/src/routes/products-list.ts:275` und `:279`), und die
 * Kasse las beide nicht. Diese Datei prüft, dass die Fläche sie jetzt liest,
 * richtig vergleicht und in KEINEM Fall etwas erfindet.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  KEIN_TAGESPREIS_SATZ,
  TAGESPREIS_HINWEIS_KASSE,
  TAGESPREIS_HINWEIS_LAGER,
  fasseTagespreiseZusammen,
  standSatz,
  tagespreisAnzeige,
} from './tagespreis-anzeige.js';

const HIER = dirname(fileURLToPath(import.meta.url));

/** Eine Lagerzeile, so wie sie über die Leitung kommt. */
function zeile(felder: Record<string, unknown>): unknown {
  return { id: 'p1', sku: 'AU-001', listPriceEur: '1000.00', ...felder };
}

describe('tagespreisAnzeige liest die zwei Felder des Motors', () => {
  it('erkennt den gerechneten Tagespreis, wenn er höher liegt', () => {
    const a = tagespreisAnzeige(zeile({ kurspreisEur: '1062.50', kurspreisGrund: null }));
    expect(a.art).toBe('tagespreis');
    if (a.art !== 'tagespreis') return;
    expect(a.tagespreisEur).toBe('1062.50');
    expect(a.gespeicherterPreisEur).toBe('1000.00');
    expect(a.richtung).toBe('hoeher');
    expect(a.unterschiedEur).toBe('62.50');
    expect(a.satz).toBe('Der Tagespreis liegt 62,50 € über dem gespeicherten Preis.');
  });

  it('erkennt den gerechneten Tagespreis, wenn er niedriger liegt', () => {
    const a = tagespreisAnzeige(zeile({ kurspreisEur: '940.00', kurspreisGrund: null }));
    expect(a.art).toBe('tagespreis');
    if (a.art !== 'tagespreis') return;
    expect(a.richtung).toBe('niedriger');
    expect(a.unterschiedEur).toBe('60.00');
    expect(a.satz).toBe('Der Tagespreis liegt 60,00 € unter dem gespeicherten Preis.');
  });

  it('nennt Gleichstand Gleichstand, nicht Abweichung', () => {
    const a = tagespreisAnzeige(zeile({ kurspreisEur: '1000.00', kurspreisGrund: null }));
    expect(a.art).toBe('tagespreis');
    if (a.art !== 'tagespreis') return;
    expect(a.richtung).toBe('gleich');
    expect(a.unterschiedEur).toBe('0.00');
  });

  it('rechnet auf ganze Cent, ohne Kommafehler', () => {
    // 0,1 + 0,2 wäre in Gleitkomma 0,30000000000000004. Der Unterschied muss
    // hier auf den Cent stimmen, sonst schreibt die Fläche Zentelcent hin.
    const a = tagespreisAnzeige(zeile({ listPriceEur: '0.10', kurspreisEur: '0.30' }));
    expect(a.art).toBe('tagespreis');
    if (a.art !== 'tagespreis') return;
    expect(a.unterschiedEur).toBe('0.20');
  });

  it('verliert keinen Cent an der Gleitkommakante', () => {
    // ⚠️ Diese Zeile hat eine echte Sabotage gefangen, die die obige nicht sah.
    // `Number('0.29') * 100` ist in Gleitkomma 28,999999999999996 und
    // `Number('1.15') * 100` ist 114,99999999999999. Wer hier abschneidet
    // statt zu runden, verliert je Stück einen Cent — bei Gold in beide
    // Richtungen und über den ganzen Bestand hinweg still.
    const a = tagespreisAnzeige({ listPriceEur: '0.29', kurspreisEur: '1.15' });
    expect(a.art).toBe('tagespreis');
    if (a.art !== 'tagespreis') return;
    expect(a.tagespreisEur).toBe('1.15');
    expect(a.gespeicherterPreisEur).toBe('0.29');
    expect(a.unterschiedEur).toBe('0.86');
  });

  it('führt den Grund als deutschen Satz, wenn kein Preis gerechnet wurde', () => {
    const a = tagespreisAnzeige(zeile({ kurspreisEur: null, kurspreisGrund: 'kein_gewicht' }));
    expect(a.art).toBe('kein_tagespreis');
    if (a.art !== 'kein_tagespreis') return;
    expect(a.grund).toBe('kein_gewicht');
    expect(a.satz).toBe(KEIN_TAGESPREIS_SATZ.kein_gewicht);
    expect(a.kurz).toBe('Gewicht fehlt');
  });

  it('schweigt bei „kein Edelmetall hinterlegt" in der engen Spalte', () => {
    const a = tagespreisAnzeige(zeile({ kurspreisEur: null, kurspreisGrund: 'kein_metall' }));
    expect(a.art).toBe('kein_tagespreis');
    if (a.art !== 'kein_tagespreis') return;
    expect(a.kurz).toBeNull();
  });

  it('behauptet nichts, wenn der Motor die Felder gar nicht schickt', () => {
    // Ein älterer Motor am anderen Ende. Die Fläche darf dann weder einen
    // Tagespreis erfinden noch behaupten, es gäbe keinen.
    expect(tagespreisAnzeige(zeile({})).art).toBe('nicht_geliefert');
    expect(tagespreisAnzeige(null).art).toBe('nicht_geliefert');
    expect(tagespreisAnzeige(undefined).art).toBe('nicht_geliefert');
  });

  it('nimmt keinen unbekannten Grund und keinen Unsinn als Preis', () => {
    expect(tagespreisAnzeige(zeile({ kurspreisGrund: 'irgendwas' })).art).toBe('nicht_geliefert');
    expect(tagespreisAnzeige(zeile({ kurspreisEur: 'viel' })).art).toBe('nicht_geliefert');
    expect(tagespreisAnzeige(zeile({ kurspreisEur: 1062.5 })).art).toBe('nicht_geliefert');
  });

  it('kommt ohne gespeicherten Preis nicht ins Rutschen', () => {
    const a = tagespreisAnzeige({ kurspreisEur: '500.00' });
    expect(a.art).toBe('tagespreis');
    if (a.art !== 'tagespreis') return;
    expect(a.richtung).toBe('gleich');
    expect(a.gespeicherterPreisEur).toBe('');
  });
});

describe('fasseTagespreiseZusammen zählt nur, was da ist', () => {
  /** Fünf Zeilen: zwei darüber, eine darunter, eine gleich, eine ohne Preis. */
  const FUENF = [
    zeile({ kurspreisEur: '1100.00' }),
    zeile({ kurspreisEur: '1200.00' }),
    zeile({ kurspreisEur: '900.00' }),
    zeile({ kurspreisEur: '1000.00' }),
    zeile({ kurspreisGrund: 'kein_metall' }),
  ];

  it('zählt höher und niedriger getrennt', () => {
    const bild = fasseTagespreiseZusammen(FUENF, { gesamt: 5 });
    expect(bild.betrachtet).toBe(5);
    expect(bild.mitTagespreis).toBe(4);
    expect(bild.hoeher).toBe(2);
    expect(bild.niedriger).toBe(1);
  });

  it('schweigt, wenn nichts abweicht', () => {
    const bild = fasseTagespreiseZusammen(
      [zeile({ kurspreisEur: '1000.00' }), zeile({ kurspreisGrund: 'fest_gepflegt' })],
      { gesamt: 2 },
    );
    expect(bild.mitTagespreis).toBe(1);
    expect(bild.satz).toBeNull();
    expect(bild.umfangSatz).toBeNull();
  });

  it('schweigt bei einer leeren Seite', () => {
    const bild = fasseTagespreiseZusammen([]);
    expect(bild.betrachtet).toBe(0);
    expect(bild.satz).toBeNull();
  });

  /**
   * ⚠️ DER GEMESSENE MANGEL DIESER RUNDE.
   *
   * `Lager.tsx` fragt fünfzig Zeilen ab (`PAGE_SIZE = 50`). Der Satz zählte
   * genau diese Seite und sagte es nicht: bei achthundert Stücken nannte er
   * eine Zahl, die der Händler für sein ganzes Lager hielt. Der Umfang gehört
   * deshalb IN den Satz, nicht daneben — und die nicht gezählten Stücke
   * bekommen einen eigenen, ebenso sichtbaren Satz.
   */
  describe('der Satz nennt den Umfang, über den er redet', () => {
    it('sagt bei einer Seite von vielen, wie viele gezählt wurden', () => {
      const bild = fasseTagespreiseZusammen(FUENF, { gesamt: 800, rest: 'geladen' });
      expect(bild.gesamt).toBe(800);
      expect(bild.nichtGezaehlt).toBe(795);
      expect(bild.satz).toBe(
        'Von den 5 geladenen Stücken liegen 2 über dem gespeicherten Preis, eines liegt darunter.',
      );
      expect(bild.umfangSatz).toBe(
        '795 weitere Stücke der Auswahl sind noch nicht geladen und hier nicht mitgezählt.',
      );
    });

    it('nennt keine Seite, wenn die Auswahl wirklich ganz geladen ist', () => {
      const bild = fasseTagespreiseZusammen(FUENF, { gesamt: 5, rest: 'geladen' });
      expect(bild.nichtGezaehlt).toBe(0);
      expect(bild.satz).toBe(
        'Von allen 5 Stücken der Auswahl liegen 2 über dem gespeicherten Preis, eines liegt darunter.',
      );
      expect(bild.umfangSatz).toBeNull();
    });

    it('spricht im Verkauf von gezeigten statt von geladenen Stücken', () => {
      const bild = fasseTagespreiseZusammen(FUENF, { gesamt: 60, rest: 'gezeigt' });
      expect(bild.satz).toBe(
        'Von den 5 gezeigten Stücken liegen 2 über dem gespeicherten Preis, eines liegt darunter.',
      );
      expect(bild.umfangSatz).toBe(
        '55 weitere Stücke der Auswahl werden hier nicht gezeigt und sind nicht mitgezählt.',
      );
    });

    it('gibt ohne Gesamtzahl zu, dass nur das Gezeigte zählt', () => {
      const bild = fasseTagespreiseZusammen(FUENF);
      expect(bild.gesamt).toBeNull();
      expect(bild.nichtGezaehlt).toBeNull();
      expect(bild.satz).toBe(
        'Von den 5 gezeigten Stücken liegen 2 über dem gespeicherten Preis, eines liegt darunter.',
      );
      expect(bild.umfangSatz).toBe('Gezählt ist nur, was gerade gezeigt wird.');
    });

    it('nimmt eine unsinnige Gesamtzahl NICHT und behauptet dann lieber weniger', () => {
      // Eine Gesamtzahl unter der Seitenlänge kann nicht stimmen. Daraus eine
      // negative Restzahl zu rechnen wäre schlimmer als zuzugeben, dass man
      // sie nicht kennt.
      const bild = fasseTagespreiseZusammen(FUENF, { gesamt: 2, rest: 'geladen' });
      expect(bild.gesamt).toBeNull();
      expect(bild.umfangSatz).toBe('Gezählt ist nur, was gerade gezeigt wird.');
      expect(bild.satz).not.toContain('-');
    });

    it('bleibt bei einem einzigen Stück grammatisch heil', () => {
      const eins = fasseTagespreiseZusammen([zeile({ kurspreisEur: '1100.00' })], {
        gesamt: 800,
        rest: 'geladen',
      });
      expect(eins.satz).toBe('Das eine geladene Stück liegt über dem gespeicherten Preis.');
      expect(eins.umfangSatz).toBe(
        '799 weitere Stücke der Auswahl sind noch nicht geladen und hier nicht mitgezählt.',
      );

      const alleinig = fasseTagespreiseZusammen([zeile({ kurspreisEur: '900.00' })], { gesamt: 1 });
      expect(alleinig.satz).toBe(
        'Das einzige Stück der Auswahl liegt unter dem gespeicherten Preis.',
      );
      expect(alleinig.umfangSatz).toBeNull();
    });

    it('nennt ein einzelnes weiteres Stück in der Einzahl', () => {
      const bild = fasseTagespreiseZusammen(FUENF, { gesamt: 6, rest: 'geladen' });
      expect(bild.umfangSatz).toBe(
        'Ein weiteres Stück der Auswahl ist noch nicht geladen und hier nicht mitgezählt.',
      );
    });

    it('beugt das Zeitwort nach der Zahl, in beide Richtungen', () => {
      const einsHoch = fasseTagespreiseZusammen(
        [
          zeile({ kurspreisEur: '1100.00' }),
          zeile({ kurspreisEur: '900.00' }),
          zeile({ kurspreisEur: '800.00' }),
        ],
        { gesamt: 3 },
      );
      expect(einsHoch.satz).toBe(
        'Von allen 3 Stücken der Auswahl liegt eines über dem gespeicherten Preis, 2 liegen darunter.',
      );

      const nurRunter = fasseTagespreiseZusammen(
        [zeile({ kurspreisEur: '900.00' }), zeile({ kurspreisEur: '800.00' })],
        { gesamt: 2 },
      );
      expect(nurRunter.satz).toBe(
        'Von allen 2 Stücken der Auswahl liegen 2 unter dem gespeicherten Preis.',
      );
    });
  });
});

/**
 * Der Stand — die Antwort auf „sofort".
 *
 * Die Lagerliste hält dreissig Sekunden, der Katalog zehn, und keine der
 * beiden holt bei Fensterwechsel nach. Eine Fläche, die „sofort" verspricht,
 * lügt; eine Fläche, die die Uhrzeit ihrer Messung nennt, nicht.
 */
describe('standSatz nennt die Uhrzeit der Messung, nie ein Alter', () => {
  it('schreibt eine absolute Uhrzeit', () => {
    const satz = standSatz(Date.parse('2026-08-12T09:05:00'));
    expect(satz).not.toBeNull();
    expect(satz).toMatch(/^Stand \d{2}:\d{2} Uhr$/);
  });

  it('sagt NIE „vor …" — ein Alter würde beim Stehenbleiben zur Lüge', () => {
    const satz = standSatz(Date.now() - 3_600_000) ?? '';
    expect(satz).not.toContain('vor ');
    expect(satz).not.toContain('Minute');
    expect(satz).not.toContain('gerade');
  });

  it('wandert mit dem Zeitpunkt mit', () => {
    const frueh = standSatz(Date.parse('2026-08-12T09:05:00'));
    const spaet = standSatz(Date.parse('2026-08-12T14:32:00'));
    expect(frueh).not.toBe(spaet);
  });

  it('erfindet keinen Stand, wenn keiner bekannt ist', () => {
    expect(standSatz(null)).toBeNull();
    expect(standSatz(undefined)).toBeNull();
    expect(standSatz(0)).toBeNull();
    expect(standSatz(Number.NaN)).toBeNull();
  });
});

/** Quelltext einer Fläche, ohne die Kommentare — nur was ein Mensch liest. */
function flaechenText(...teile: string[]): string {
  return readFileSync(join(HIER, ...teile), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Quelltext mit zusammengezogenen Leerräumen — für Aufrufe über mehrere Zeilen. */
function einzeilig(...teile: string[]): string {
  return readFileSync(join(HIER, ...teile), 'utf8').replace(/\s+/g, ' ');
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ⛔ DER WÄCHTER ÜBER DIE AUFSCHLAGSFLÄCHE — AM RICHTIGEN ORT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── ⚰️ 22.08.2026: ER STAND SECHS SÄTZE LANG ÜBER EINER TOTEN FLÄCHE ──────
 *
 * Bis heute las dieser Block `secondary/VerkaufsaufschlagSection.tsx`. Am
 * 21.08. zog der Verkaufsaufschlag auf Basels Anweisung in den Kursraum; die
 * alte Kachel blieb im Baum stehen und wurde von da an NIRGENDS mehr
 * gerendert (gemessen: kein `<VerkaufsaufschlagSection` im ganzen Haus).
 *
 * Sechs grüne Sätze über einer Fläche ohne Ausgang. Das ist nicht die
 * bekannte Falle „Wächter zeigt auf gelöschte Datei" — die Datei war da,
 * `readFileSync` gelang, jeder Satz stimmte. Nur schützte er nichts.
 *
 * ⚠️ UND EINER SEINER SÄTZE WAR INZWISCHEN UNWAHR. Er verlangte wörtlich
 * „Gebucht wird weiterhin der gespeicherte Preis." Seit der Korb über
 * `geltenderPreis` (`lib/korbpreis.ts:63`) den Kurspreis übernimmt, bucht die
 * Kasse genau das nicht mehr. Ein Wächter, der eine überholte Zusage
 * ERZWINGT, meldet den Rückbau zur Wahrheit als Fehler.
 *
 * ── WAS ER JETZT MISST ────────────────────────────────────────────────────
 *
 * Denselben Vertrag, am lebenden Ort: die Fläche darf keine Menge und keine
 * Geschwindigkeit versprechen, die der Motor nicht hält. Zwei Zusagen stehen
 * dort, beide werden geprüft — die Bedingung („nur Stücke mit Gewicht und
 * Feingehalt, feste Preise nicht") und das „sofort überall".
 *
 * ⚠️ „sofort" ist hier ERLAUBT, aber nur gegen Beweis. Die Fläche darf es
 * sagen, WEIL das Speichern jede Abfragefamilie anstösst, die einen
 * kursgebundenen Preis trägt. Fällt eine dieser Zeilen weg, fällt der Satz
 * hier — dann ist „sofort" wieder eine Zusage ohne Deckung.
 */
describe('das Margen-Fenster verspricht nichts, was der Motor nicht hält', () => {
  const KURSRAUM = ['..', 'secondary', 'Kurse.tsx'] as const;
  const text = flaechenText(...KURSRAUM);
  const roh = einzeilig(...KURSRAUM);

  it('nennt die Bedingung, unter der überhaupt gerechnet wird', () => {
    // `kurspreisFuerStueck` (packages/domain/src/pricing/metallpreis.ts) gibt
    // NICHTS zurück, wenn Metall, Gewicht, Feingehalt oder Tageskurs fehlen.
    // Ein Goldring ohne eingetragenes Gewicht ist im Bestand die Regel.
    expect(text).toContain('Gewicht und Feingehalt gepflegt');
  });

  it('sagt, dass fest gepflegte Stücke dem Kurs NICHT folgen', () => {
    expect(text).toContain('Stücke mit festem Preis rührt er nicht an.');
  });

  it('verspricht nicht, dass alle Stücke von selbst mitziehen', () => {
    // Die zwei Sätze, die auf der alten Fläche zweimal zu gross waren.
    expect(text).not.toContain('steigen alle Goldstücke mit');
    expect(text).not.toContain('bei jedem Goldstück');
    expect(text).not.toContain('Alle Stücke dieses Metalls ziehen mit');
  });

  /*
   * ── DIE DECKUNG FÜR „SOFORT" ────────────────────────────────────────────
   *
   * Gemessen am 22.08.: das Speichern stiess NUR ['metal-prices'] an. Darunter
   * liegen Ticker, Ankauf-Vorschlag und Kursraum — die Ankaufseite. Die
   * VERKAUFSseite liegt woanders, und sie blieb stehen:
   *
   *   ['kurspreise', …]         hooks/useKurspreise.ts:52    → der Korb
   *   ['products','list', …]    Lager.tsx:151, CatalogGrid.tsx:139
   *   ['products','detail',id]  lager/abfrage-schluessel.ts:16
   *
   * Der Kasten meldete „sofort überall … Lagerpreise", und der Korb rechnete
   * bis zu 30 Sekunden mit dem alten Aufschlag weiter (staleTime 30_000).
   */
  const FAMILIEN = [
    { key: "['kurspreise']", wer: 'der Korb im Verkauf' },
    { key: "['products', 'list']", wer: 'Lagerliste und Katalog' },
    { key: "['products', 'detail']", wer: 'das Produktblatt' },
  ] as const;

  it.each(FAMILIEN)('das Speichern frischt $wer auf', ({ key, wer }) => {
    expect(
      roh,
      `Nach dem Speichern wird ${key} nicht angestossen. Dann trägt ${wer} weiter den alten Aufschlag, und das „sofort überall" auf der Fläche ist eine Zusage ohne Deckung.`,
    ).toContain(`invalidateQueries({ queryKey: ${key} })`);
  });

  it('und die Bildabfrage wird dabei NICHT mitgerissen', () => {
    // ['products', <id>, 'photos'] hängt unter demselben Vorsatz. Ein
    // Margenwechsel darf nicht jedes Foto neu ziehen; auf der schwachen
    // Ladenmaschine ist das über die Theke spürbar.
    expect(roh).not.toContain("invalidateQueries({ queryKey: ['products'] })");
  });
});

/**
 * ⚠️ GEBAUT IST NICHT ANGESCHLOSSEN.
 *
 * Der Umfang und der Stand nützen nichts, solange die zwei Flächen sie nicht
 * übergeben und nicht zeichnen. Genau das war der tragende Mangel: die
 * Zusammenfassung zählte die geladene Seite und sagte es nicht.
 *
 * ⚠️ Diese Prüfungen lesen QUELLTEXT, sie klopfen nicht an. Dieses Paket
 * fährt seine Tests ohne Fensterumgebung (`vitest.config.ts`: `environment:
 * 'node'`), eine echte Zeichnung der Lagerfläche mit Abfrage, Sitzung und
 * Wegweiser ist hier nicht zu haben. Sie beweisen den ANSCHLUSS, nicht das
 * Bild auf dem Schirm.
 */
describe('beide Flächen übergeben ihren Umfang und zeichnen ihn', () => {
  const lager = einzeilig('Lager.tsx');
  const katalog = einzeilig('..', 'verkauf', 'CatalogGrid.tsx');

  it('das Lager gibt die Gesamtzahl der Auswahl mit, nicht nur die Seite', () => {
    expect(lager).toContain("fasseTagespreiseZusammen(rows, { gesamt: total, rest: 'geladen' })");
  });

  it('das Lager zeichnet den Umfangssatz und den Stand', () => {
    expect(lager).toContain('standSatz(q.cachedAt)');
    expect(lager).toContain('{tagespreisbild.umfangSatz}');
    expect(lager).toContain('{tagespreisStand}');
  });

  it('der Verkauf gibt die Gesamtzahl des Katalogs mit', () => {
    expect(katalog).toContain("{ gesamt: gesamtImKatalog, rest: 'gezeigt' }");
    expect(katalog).toContain('const gesamtImKatalog = q.data?.total');
  });

  it('der Verkauf zeichnet den Umfangssatz und den Stand', () => {
    expect(katalog).toContain('standSatz(q.dataUpdatedAt)');
    expect(katalog).toContain('{tagespreisbild.umfangSatz}');
    expect(katalog).toContain('{tagespreisStand}');
  });
});

/**
 * Die zwei Hinweissätze nennen den Weg, den es wirklich gibt.
 *
 * ⚠️ Der Weg „über anpassen" führte ins Produktblatt, und dort steht das
 * Preisfeld unter „Details" — nicht unter „Preis & Veröffentlichen", das den
 * Preis nur anzeigt (`ProductSheet.tsx:1531`). Wer dem alten Satz folgte,
 * suchte im falschen Abschnitt.
 */
describe('die Hinweise schicken den Händler an die richtige Stelle', () => {
  /*
   * ── 20.08.2026: BEIDE SÄTZE HABEN SICH UMGEDREHT ────────────────────────
   *
   * Bis heute schickten sie den Händler ins Lager, um den Tagespreis von
   * Hand ins Stück zu übertragen — und beschrieben damit korrekt einen
   * Defekt: die Kasse KANNTE den Preis und buchte den anderen. Seit der Korb
   * den Tageskurs selbst rechnet (`lib/korbpreis.ts`), wäre diese Anweisung
   * eine Aufforderung zu überflüssiger Arbeit.
   *
   * Der Wächter hält jetzt die neue Wahrheit fest UND verbietet die alte
   * ausdrücklich: stünde die Handarbeits-Anweisung je wieder da, wäre das
   * das sichere Zeichen, dass jemand den Kurspfad zurückgebaut hat.
   */
  it('der Lagerhinweis erklärt Kurs und Rückfall, nicht Handarbeit', () => {
    expect(TAGESPREIS_HINWEIS_LAGER).toContain('Tageskurs');
    expect(TAGESPREIS_HINWEIS_LAGER).toContain('Rückfall');
    expect(TAGESPREIS_HINWEIS_LAGER).toContain('Ladenleitung');
    expect(TAGESPREIS_HINWEIS_LAGER).not.toContain('Zeile anklicken');
  });

  it('⛔ der Kassenhinweis verspricht den Tageskurs, nicht den Weg ins Lager', () => {
    expect(TAGESPREIS_HINWEIS_KASSE).toContain('Tageskurs');
    expect(TAGESPREIS_HINWEIS_KASSE).not.toContain('im Lager');
    expect(TAGESPREIS_HINWEIS_KASSE).not.toContain('übernehmen');
  });

  it('die Aktionsspalte sagt, wohin „anpassen" führt', () => {
    const tabelle = einzeilig('LagerTable.tsx');
    expect(tabelle).toContain(
      'Öffnet das Produktblatt. Der Verkaufspreis steht dort im Abschnitt Details.',
    );
  });
});

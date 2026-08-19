/**
 * Die Etikettenwahl wird gerechnet, nicht am Drucker ausprobiert.
 *
 * ── WARUM DIESE PRÜFUNG SO GENAU IST ───────────────────────────────────────
 * Jede Zahl in `etikett-wahl.ts` entscheidet darüber, ob am Tresen ein Code
 * aus dem Drucker kommt, den ein Handscanner NICHT liest. Das merkt niemand
 * beim Drucken — es merkt jemand drei Wochen später an der Kasse, wenn der
 * Scanner stumm bleibt und der Kunde wartet. Deshalb hält diese Datei jede
 * einzelne Grenze fest:
 *
 *   • die Medienmasse gegen die Treiberdatei des angeschlossenen Druckers,
 *   • die Modulformel gegen den ECHTEN Kodierer aus `code128.ts`,
 *   • die Ganzzahligkeit jedes Moduls in Druckpunkten,
 *   • dass die Ruhezone im unbedruckbaren Weiss liegen DARF,
 *   • jede Vorschlagsregel und jede Sperre, mit ihrem Satz.
 */
import { describe, expect, it } from 'vitest';

import { code128BalkenBreiten } from './code128.js';
import {
  BREITESTE_LINIE_PUNKTE,
  DRUCKPUNKT_MM,
  ENDRAND_MM,
  ETIKETT_GROESSEN,
  ETIKETT_MEDIEN,
  type EtikettArtikel,
  type EtikettGroesse,
  RUHEZONE_MODULE,
  SCHMALSTE_LINIE_PUNKTE,
  code128Module,
  etikettWahl,
  maximaleZeichen,
  unterlaengeMm,
} from './etikett-wahl.js';

/** Eine Möglichkeit aus dem Ergebnis holen — kürzt jede Prüfung darunter ab. */
function bei(artikel: EtikettArtikel, groesse: EtikettGroesse) {
  const wahl = etikettWahl(artikel);
  const treffer = wahl.moeglichkeiten.find((m) => m.groesse === groesse);
  if (treffer === undefined) throw new Error(`Grösse ${groesse} fehlt im Ergebnis`);
  return treffer;
}

/** Eine Münze, wie sie wirklich im Lager steht. */
const MUENZE: EtikettArtikel = {
  sku: 'MZ-260726-A3F9',
  kurzcode: 'K7M4Q2',
  name: 'Silbergroschen 1871',
  warenart: 'silver_coin',
  gewichtGramm: '5.4500',
  preisEur: '890.00',
};

describe('Die Medien — gegen die Treiberdatei, nicht gegen ein Datenblatt', () => {
  it('nennt genau die zehn Medien, die die PPD kennt', () => {
    expect(ETIKETT_GROESSEN).toHaveLength(10);
    expect(new Set(ETIKETT_GROESSEN).size).toBe(10);
  });

  it('trägt in jedem Namen seine eigene Geometrie', () => {
    // `w54h144` HEISST 54 × 144 Punkt. Wäre die Tabelle einmal verrutscht,
    // stimmte der Name nicht mehr mit den Massen überein — und ein falsches
    // Medium im Druckauftrag ist ein Etikett, das schief aus dem Gerät kommt.
    const PT_MM = 25.4 / 72;
    for (const groesse of ETIKETT_GROESSEN) {
      const teile = /^w(\d+)h(\d+)$/.exec(groesse);
      expect(teile, `${groesse} folgt nicht dem Muster wQUERhLAUF`).not.toBeNull();
      const querPt = Number(teile?.[1]);
      const laufPt = Number(teile?.[2]);
      const medium = ETIKETT_MEDIEN[groesse];
      expect(medium.papierQuerMm).toBeCloseTo(querPt * PT_MM, 6);
      expect(medium.papierLaufMm).toBeCloseTo(laufPt * PT_MM, 6);
      // Die Randformel der PPD gilt für ALLE zehn: 2 pt seitlich, 14,9 pt an
      // beiden Enden der Laufrichtung.
      expect(medium.druckQuerMm).toBeCloseTo((querPt - 4) * PT_MM, 6);
      expect(medium.druckLaufMm).toBeCloseTo((laufPt - 29.8) * PT_MM, 6);
    }
  });

  it('bestätigt die vier Masse, die das Entwurfspanel benutzt hat', () => {
    const klein = ETIKETT_MEDIEN.w54h144;
    expect(klein.papierQuerMm).toBeCloseTo(19.05, 2);
    expect(klein.papierLaufMm).toBeCloseTo(50.8, 2);
    expect(klein.druckQuerMm).toBeCloseTo(17.639, 3);
    expect(klein.druckLaufMm).toBeCloseTo(40.287, 3);

    const adresse = ETIKETT_MEDIEN.w81h252;
    expect(adresse.druckQuerMm).toBeCloseTo(27.164, 3);
    // 222,2 pt = 78,387 mm. Die Aufgabenstellung nennt „78,4"; das ist dieselbe
    // Zahl auf eine Nachkommastelle gerundet, und hier steht sie genau.
    expect(adresse.druckLaufMm).toBeCloseTo(78.387, 3);

    const gross = ETIKETT_MEDIEN.w101h252;
    expect(gross.druckQuerMm).toBeCloseTo(34.219, 3);

    // Der Endrand ist der Wert, auf dem die ganze Erkenntnis 1 ruht.
    expect(ENDRAND_MM).toBeCloseTo(5.256, 3);
    expect(DRUCKPUNKT_MM).toBeCloseTo(0.08467, 5);
  });
});

describe('Der Strichcode — die Formel gegen den echten Kodierer', () => {
  it('rechnet dieselbe Modulzahl wie code128.ts', () => {
    // Eine Formel, die nur mit sich selbst übereinstimmt, ist wertlos. Hier
    // steht sie gegen den Kodierer, der die Balken wirklich erzeugt.
    for (const text of ['K7M4Q2', 'A', 'MZ-260726-A3F9', 'SCHMUCK-2026-000123', '0']) {
      const echt = code128BalkenBreiten(text).reduce((a, b) => a + b, 0);
      expect(code128Module(text.length), `${text} (${text.length} Zeichen)`).toBe(echt);
    }
  });

  it('bestätigt die 101 Module des sechsstelligen Kurzcodes', () => {
    expect(code128Module(6)).toBe(101);
  });

  it('setzt die schmalste Linie auf genau drei Druckpunkte', () => {
    // 3 × 0,0846667 = 0,254 mm. Dass die Lesbarkeitsgrenze auf einer ganzen
    // Punktzahl liegt, ist der Grund, warum überall in Punkten gerechnet wird.
    expect(SCHMALSTE_LINIE_PUNKTE * DRUCKPUNKT_MM).toBeCloseTo(0.254, 4);
  });
});

describe('Erkenntnis 1 — die Ruhezone darf im unbedruckbaren Weiss liegen', () => {
  it('lässt auf dem Kapselfähnchen elf Zeichen zu, nicht acht', () => {
    // DAS ist der Satz, der das kleine Etikett möglich macht. Nimmt man die
    // Ruhezone aus der Druckfläche statt aus dem Papier, fällt die Grenze auf
    // neun — und ein sechsstelliger Code bekäme nur noch 3 statt 4 Punkte.
    expect(maximaleZeichen('kapselfaehnchen', ETIKETT_MEDIEN.w54h144)).toBe(11);
  });

  it('gibt dem sechsstelligen Kurzcode vier Druckpunkte je Modul', () => {
    const klein = bei(MUENZE, 'w54h144');
    expect(klein.waehlbar).toBe(true);
    const code = klein.strichcode;
    expect(code).not.toBeNull();
    expect(code?.quelle).toBe('kurzcode');
    expect(code?.module).toBe(101);
    expect(code?.modulPunkte).toBe(4);
    expect(code?.modulbreiteMm).toBeCloseTo(0.33867, 4);
    // 101 × 0,33867 = 34,205 mm auf 40,287 mm bedruckbarer Länge.
    expect(code?.breiteMm).toBeCloseTo(34.205, 3);
  });

  it('weist die Ruhezone mit Faktor 2,45 nach', () => {
    // 3,041 mm bedruckbares Weiss je Seite PLUS 5,256 mm Papier gegen
    // geforderte 3,387 mm. Das ist keine knappe Erlaubnis, das ist Reserve.
    const code = bei(MUENZE, 'w54h144').strichcode;
    expect(code?.ruhezoneFaktor).toBeCloseTo(2.45, 2);
    expect(code?.ruhezoneFaktor).toBeGreaterThan(1);
  });

  it('rechnet auf dem Regaletikett MIT Ruhezone in der Druckfläche', () => {
    // Dort grenzt der Code nicht an Papier, sondern an den QR daneben. Die
    // Ruhezone muss also aus der Spalte kommen — und die Grenze liegt bei 18.
    expect(maximaleZeichen('regal', ETIKETT_MEDIEN.w81h252)).toBe(18);
  });
});

describe('Erkenntnis 2 — jedes Modul ist ein ganzes Vielfaches eines Druckpunkts', () => {
  it('liefert nie eine krumme Modulbreite', () => {
    const codes = ['K7M4Q2', 'A1', 'MZ-260726-A3F9', 'BR-01', 'SCHMUCK-000123456'];
    let geprueft = 0;
    for (const code of codes) {
      const wahl = etikettWahl({ sku: code, kurzcode: code, warenart: 'other' });
      for (const m of wahl.moeglichkeiten) {
        if (m.strichcode === null) continue;
        geprueft += 1;
        expect(Number.isInteger(m.strichcode.modulPunkte), `${code} auf ${m.groesse}`).toBe(true);
        expect(m.strichcode.modulPunkte).toBeGreaterThanOrEqual(SCHMALSTE_LINIE_PUNKTE);
        expect(m.strichcode.modulPunkte).toBeLessThanOrEqual(BREITESTE_LINIE_PUNKTE);
        expect(m.strichcode.modulbreiteMm).toBeCloseTo(m.strichcode.modulPunkte * DRUCKPUNKT_MM, 9);
      }
    }
    // Ohne diese Zusicherung wäre die Schleife über eine leere Menge grün.
    expect(geprueft).toBeGreaterThan(5);
  });

  it('hält jeden gedruckten Code samt Ruhezone in seiner Zone', () => {
    const wahl = etikettWahl(MUENZE);
    for (const m of wahl.moeglichkeiten) {
      if (m.strichcode === null) continue;
      const noetig =
        m.strichcode.breiteMm +
        (m.groesse === 'w54h144' ? 0 : 2 * RUHEZONE_MODULE * m.strichcode.modulbreiteMm);
      const zone = m.groesse === 'w54h144' ? m.medium.druckLaufMm : 66.4;
      expect(noetig, `${m.groesse} läuft über seine Zone`).toBeLessThanOrEqual(zone + 1e-9);
    }
  });
});

describe('Die Zuordnung Medium zu Bauplan ist geometrisch gedeckt', () => {
  it('gibt keinem Medium einen Bauplan, der dort nicht hinpasst', () => {
    // Die Tabelle in `etikett-wahl.ts` ist eine Behauptung. Hier wird sie
    // nachgerechnet: Höhe UND Strichcodelänge müssen wirklich reichen.
    const noetigeHoehe: Record<string, number> = {
      kapselfaehnchen: 207 * DRUCKPUNKT_MM,
      regal: 25.4 + unterlaengeMm(2.3),
      grossadresse: 25.4 + unterlaengeMm(2.3) + 3.4 + 1.4,
    };
    let geprueft = 0;
    for (const m of etikettWahl(MUENZE).moeglichkeiten) {
      if (m.bauart === null) continue;
      geprueft += 1;
      const noetig = noetigeHoehe[m.bauart] as number;
      expect(m.medium.druckQuerMm, `${m.groesse} ist zu schmal für ${m.bauart}`).toBeGreaterThanOrEqual(
        noetig,
      );
      // Sechs Zeichen muss jeder Bauplan tragen können, sonst ist er sinnlos.
      expect(m.maximaleZeichen ?? 0).toBeGreaterThanOrEqual(6);
    }
    expect(geprueft).toBe(3);
  });

  it('rechnet die Unterlänge nach Geviert, nicht nach Versalhöhe', () => {
    // 2,3 mm Versalhöhe → 3,208 mm Geviert → 0,738 mm Unterlänge.
    // Nach Versalhöhe gerechnet wären es 0,529 mm, also 30 Prozent zu wenig —
    // genau der Kommafehler, den das Entwurfspanel gefunden hat.
    expect(unterlaengeMm(2.3)).toBeCloseTo(0.738, 3);
    expect(unterlaengeMm(2.3)).toBeGreaterThan(2.3 * 0.23);
  });
});

describe('Der Vorschlag folgt aus echten Eigenschaften', () => {
  it('gibt einer Münze das Kapselfähnchen', () => {
    const wahl = etikettWahl(MUENZE);
    expect(wahl.vorschlag).toBe('w54h144');
    expect(wahl.begruendung).toContain('Kapsel');
  });

  it('gibt einem kleinen Barren das Kapselfähnchen', () => {
    const wahl = etikettWahl({
      sku: 'BR-50',
      kurzcode: 'B50X11',
      name: 'Goldbarren 50 g',
      warenart: 'gold_bar',
      gewichtGramm: '50.0000',
    });
    expect(wahl.vorschlag).toBe('w54h144');
  });

  it('gibt einem grossen Barren das Regaletikett', () => {
    // 500 g steckt in einer Verpackung, die das grössere Etikett bequem trägt.
    const wahl = etikettWahl({
      sku: 'BR-500',
      kurzcode: 'B500X1',
      name: 'Goldbarren 500 g',
      warenart: 'gold_bar',
      gewichtGramm: '500.0000',
    });
    expect(wahl.vorschlag).toBe('w81h252');
  });

  it('gibt einem leichten Ring das Kapselfähnchen, auch ohne Münze zu sein', () => {
    const wahl = etikettWahl({
      sku: 'SR-01',
      kurzcode: 'R1A2B3',
      name: 'Ring 585',
      warenart: 'gold_jewelry',
      gewichtGramm: '3.8000',
    });
    expect(wahl.vorschlag).toBe('w54h144');
    expect(wahl.begruendung).toContain('3,8 g');
  });

  it('gibt einem Armband mit langem Namen das Namensetikett', () => {
    const wahl = etikettWahl({
      sku: 'SB-2026-0007',
      name: 'Armband Gelbgold 585 mit Karabinerverschluss',
      warenart: 'gold_jewelry',
      gewichtGramm: '28.4000',
      preisEur: '1290.00',
    });
    expect(wahl.vorschlag).toBe('w101h252');
    expect(wahl.begruendung).toContain('Zeichen');
  });

  it('gibt dem Normalfall das Regaletikett', () => {
    const wahl = etikettWahl({
      sku: 'UH-2026-0002',
      name: 'Uhr Stahl',
      warenart: 'watch',
      gewichtGramm: '95.0000',
    });
    expect(wahl.vorschlag).toBe('w81h252');
  });

  it('schlägt NIEMALS eine Grösse vor, die gesperrt ist', () => {
    // Ein Vorschlag, der nicht gedruckt werden kann, wäre schlimmer als keiner.
    const faelle: EtikettArtikel[] = [
      MUENZE,
      { sku: 'MZ-260726-A3F9', warenart: 'gold_coin', gewichtGramm: '31.1000' },
      { sku: 'X', warenart: 'other' },
      { sku: 'SEHR-LANGE-NUMMER-2026-000001', kurzcode: 'KZ9911', warenart: 'antique' },
    ];
    for (const artikel of faelle) {
      const wahl = etikettWahl(artikel);
      if (wahl.vorschlag === null) continue;
      const m = wahl.moeglichkeiten.find((x) => x.groesse === wahl.vorschlag);
      expect(m?.waehlbar, `${artikel.sku}: Vorschlag ist gesperrt`).toBe(true);
      expect(m?.istVorschlag).toBe(true);
      expect(wahl.moeglichkeiten.filter((x) => x.istVorschlag)).toHaveLength(1);
    }
  });
});

describe('Die Sperren nennen ihren Grund', () => {
  it('sperrt das Kapselfähnchen, wenn kein Kurzcode vergeben ist', () => {
    const ohne: EtikettArtikel = { ...MUENZE, kurzcode: null };
    const klein = bei(ohne, 'w54h144');
    expect(klein.waehlbar).toBe(false);
    expect(klein.sperrgrund).toContain('Kurzcode');
    expect(klein.strichcode).toBeNull();
  });

  it('sagt beim Ausweichen, was eigentlich vorgesehen war', () => {
    // Kein heimliches Verkleinern und kein heimliches Vergrössern: der Satz
    // nennt den Wunsch, den Grund der Sperre und die Ersatzgrösse.
    const wahl = etikettWahl({ ...MUENZE, kurzcode: null });
    expect(wahl.vorschlag).toBe('w81h252');
    expect(wahl.begruendung).toContain('Kapselfähnchen');
    expect(wahl.begruendung).toContain('Kurzcode');
    expect(wahl.begruendung).toContain('Regaletikett');
  });

  it('sperrt jede Grösse, auf der die Artikelnummer unlesbar würde', () => {
    // 29 Zeichen: auf dem Regaletikett wären das 2 Punkte je Modul.
    const lang = 'SEHR-LANGE-NUMMER-2026-000001';
    expect(lang.length).toBeGreaterThan(18);
    const wahl = etikettWahl({ sku: lang, kurzcode: 'KZ9911', warenart: 'antique' });
    const regal = wahl.moeglichkeiten.find((m) => m.groesse === 'w81h252');
    expect(regal?.waehlbar).toBe(false);
    expect(regal?.sperrgrund).toContain('Zeichen');
    expect(regal?.sperrgrund).toContain('18');
    // Der kurze Code rettet das kleine Etikett — und wird dadurch der Vorschlag.
    expect(wahl.vorschlag).toBe('w54h144');
  });

  it('nennt das Zeichen, das ein Strichcode nicht darstellen kann', () => {
    // Heute fliegt an dieser Stelle eine Ausnahme mitten im Druckweg, und am
    // Tresen steht nur „Etikettendruck fehlgeschlagen" ohne Grund.
    const klein = bei({ sku: 'MÜ-01', kurzcode: 'MÜ0001', warenart: 'gold_coin' }, 'w54h144');
    expect(klein.waehlbar).toBe(false);
    expect(klein.sperrgrund).toContain('Ü');
  });

  it('unterscheidet „zu schmal" von „noch kein Bauplan"', () => {
    const haengemappe = bei(MUENZE, 'w41h144');
    expect(haengemappe.waehlbar).toBe(false);
    expect(haengemappe.sperrgrund).toContain('zu schmal');
    expect(haengemappe.sperrgrund).toContain('13,1');

    const porto = bei(MUENZE, 'w162h540');
    expect(porto.waehlbar).toBe(false);
    expect(porto.sperrgrund).toContain('noch kein Bauplan');
  });

  it('bietet alle zehn Medien an, auch die gesperrten', () => {
    // Sieben Grössen zu verschweigen wäre die alte Lüge in neuer Form: der
    // Drucker kann sie, und ein Mensch soll sehen, warum sie heute nicht gehen.
    const wahl = etikettWahl(MUENZE);
    expect(wahl.moeglichkeiten).toHaveLength(10);
    for (const m of wahl.moeglichkeiten) {
      if (m.waehlbar) expect(m.sperrgrund).toBeNull();
      else expect((m.sperrgrund ?? '').length).toBeGreaterThan(20);
    }
  });

  it('kommt ohne Artikelnummer und ohne Kurzcode zu keinem Vorschlag', () => {
    const wahl = etikettWahl({ sku: '   ', warenart: 'other' });
    expect(wahl.vorschlag).toBeNull();
    expect(wahl.begruendung).toContain('kein Etikett');
  });
});

describe('Die Sprache der Oberfläche', () => {
  it('lässt kein rohes Datenbankwort und keinen Unterstrich nach draussen', () => {
    // Der Unterstrich wird aus seinem Zeichencode gebaut, damit diese Datei
    // ihn nicht selbst enthält.
    const unterstrich = String.fromCharCode(95);
    const artikel: EtikettArtikel[] = [
      MUENZE,
      { ...MUENZE, kurzcode: null },
      { sku: 'X', warenart: 'platinum_jewelry', name: 'Sehr langer Name für ein Prüfstück' },
    ];
    for (const a of artikel) {
      const wahl = etikettWahl(a);
      const texte = [
        wahl.begruendung,
        ...wahl.moeglichkeiten.flatMap((m) => [m.sperrgrund ?? '', m.zweck ?? '', m.bauartName ?? '']),
      ];
      for (const text of texte) {
        expect(text.includes(unterstrich), `Unterstrich in: ${text}`).toBe(false);
        expect(/[a-z]+_[a-z]+/.test(text), `Rohwert in: ${text}`).toBe(false);
      }
    }
  });
});

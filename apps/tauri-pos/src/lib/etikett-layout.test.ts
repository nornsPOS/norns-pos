/**
 * Das Etikett wird in Zahlen geprüft, nicht am Drucker.
 *
 * ── WARUM ─────────────────────────────────────────────────────────────────
 * Am 25.07.2026 kam ein Etikett aus dem DYMO, auf dem KEIN Strichcode stand.
 * Der Fehler lag nicht am Papier und nicht am Gerät: die Kasse schickte einen
 * ZPL-Befehl, den ein DYMO nicht kennt, und noch dazu am Treiber vorbei. Auf
 * dem Bildschirm sah alles richtig aus; erst das leere Papier verriet es.
 *
 * Am 26.07.2026 kam das nächste: der Bauplan rechnete mit dem PAPIERMASS statt
 * mit der bedruckbaren Fläche, und der Strichcode lief bei langen
 * Artikelnummern schlicht über den Rand — auf dem Bildschirm unsichtbar, weil
 * dort nichts abgeschnitten wird.
 *
 * Ein Etikett ist deshalb eine Geometrie-Aufgabe. Ob der Code aufs Papier
 * passt, ob seine schmalste Linie noch lesbar ist und ob die Ruhezone steht,
 * lässt sich rechnen — und muss gerechnet werden, bevor Papier verbraucht wird.
 */
import { describe, expect, it } from 'vitest';

import { code128BalkenBreiten } from './code128.js';
import {
  DRUCKPUNKT_MM,
  ETIKETT_MEDIEN,
  type EtikettMedium,
  mediumFuer,
} from './etikett-groessen.js';
import {
  DYMO_99010,
  MODUL_MINDESTPUNKTE,
  OHNE_PREIS,
  type Primitiv,
  QR_MINDESTPUNKTE,
  RUHEZONE_MODULE,
  SCHMALSTE_LINIE_MM,
  etikettPlan,
  etikettPlanFuerMedium,
  etikettSperre,
  preisText,
  qrVerweis,
  textbreiteMm,
  unterlaengeMm,
} from './etikett-layout.js';

const KURZ = { sku: 'MZ-0042', name: 'Silbergroschen 1871' };
const LANG = {
  sku: 'GLD-2026-00817',
  name: 'Armband Gelbgold mit Verschluss und Sicherung',
  gewichtGramm: '14.5000',
  karat: '585',
  lagerort: 'Tresor-1 / Fach-3',
};

/** Ein Kasten in Millimetern, Unterlängen eingerechnet. */
interface Kasten {
  was: string;
  links: number;
  rechts: number;
  oben: number;
  unten: number;
}

function textkasten(t: Extract<Primitiv, { art: 'text' }>): Kasten {
  const b = textbreiteMm(t.text, t.hoeheMm, t.schrift, t.sperrung ?? 0);
  const links = t.anker === 'rechts' ? t.x - b : t.x;
  return {
    was: `„${t.text}"`,
    links,
    rechts: links + b,
    oben: t.y - t.hoeheMm,
    // Die Unterlänge wird mit 0,23 GEVIERT gerechnet, nicht mit 0,23
    // Versalhöhe. Bei der Festbreitenschrift ist das fast das Doppelte, und
    // genau dieser Unterschied hat in der alten Zonentabelle einen
    // Kommafehler versteckt.
    unten: t.y + unterlaengeMm(t.hoeheMm, t.schrift),
  };
}

function ueberlappt(a: Kasten, c: Kasten): boolean {
  const luft = 1e-9;
  return (
    a.links + luft < c.rechts &&
    c.links + luft < a.rechts &&
    a.oben + luft < c.unten &&
    c.oben + luft < a.unten
  );
}

function textkaesten(primitive: Primitiv[]): Kasten[] {
  return primitive
    .filter((q): q is Extract<Primitiv, { art: 'text' }> => q.art === 'text')
    .map(textkasten);
}

describe('der Bauplan kennt alle zehn Groessen', () => {
  it('rechnet mit der BEDRUCKBAREN Flaeche, nicht mit dem Papier', () => {
    // Der Fund vom 26.07.2026: hier stand einmal 88,9 x 28,6 — das Papier.
    // Der Kopf erreicht davon nur 78,4 x 27,2 mm. Der Bauplan auf dem
    // Papiermass musste eingepasst werden, und mit ihm schrumpfte der
    // Strichcode unter die Lesbarkeitsgrenze.
    expect(DYMO_99010.breiteMm).toBeCloseTo(78.4, 1);
    expect(DYMO_99010.hoeheMm).toBeCloseTo(27.2, 1);
  });

  const faelle = [
    KURZ,
    LANG,
    { ...KURZ, preisEur: '890.00' },
    { ...LANG, preisEur: '1290.50' },
    { sku: 'A1', name: 'Kurz', preisEur: '12.00' },
    { ...LANG, kurzcode: 'K74F2Q', preisEur: '99999.00' },
    // Der Fall OHNE Strichcode gehoert in dieselbe Pruefung: an seine Stelle
    // tritt ein Satz, und auch der darf nichts ueberdecken.
    { sku: 'SEHR-LANGE-NUMMER-0001', name: 'Konvolut Silber gemischt', preisEur: '450.00' },
  ];

  function planFuer(m: EtikettMedium, i: number) {
    return etikettPlanFuerMedium(faelle[i]!, m.cups);
  }

  it('liefert fuer jede Groesse und jeden Fall etwas Gezeichnetes', () => {
    for (const m of ETIKETT_MEDIEN) {
      for (let i = 0; i < faelle.length; i++) {
        const plan = planFuer(m, i);
        expect(plan.primitive.length, `${m.cups} / Fall ${i}`).toBeGreaterThan(0);
        expect(plan.familie).toBe(m.familie);
      }
    }
  });

  it('laesst NICHTS ueber die bedruckbare Flaeche ragen', () => {
    for (const m of ETIKETT_MEDIEN) {
      for (let i = 0; i < faelle.length; i++) {
        const plan = planFuer(m, i);
        const B = m.bedruckbar.breiteMm;
        const H = m.bedruckbar.hoeheMm;
        for (const q of plan.primitive) {
          const k =
            q.art === 'rechteck'
              ? { was: 'Rechteck', links: q.x, rechts: q.x + q.breite, oben: q.y, unten: q.y + q.hoehe }
              : textkasten(q);
          const wo = `${m.cups} / Fall ${i} / ${k.was}`;
          expect(k.links, `${wo} links`).toBeGreaterThanOrEqual(-1e-6);
          expect(k.oben, `${wo} oben`).toBeGreaterThanOrEqual(-1e-6);
          expect(k.rechts, `${wo} rechts`).toBeLessThanOrEqual(B + 1e-6);
          expect(k.unten, `${wo} unten`).toBeLessThanOrEqual(H + 1e-6);
        }
      }
    }
  });

  it('laesst keine zwei Textkaesten uebereinander liegen', () => {
    // Genau der Fehler des zweiten Musters: bei langer Artikelnummer wich der
    // Preis nach unten aus und landete AUF dem Namen. Der Kommentar behauptete,
    // der Name weiche — er wich nie. Diese Pruefung rechnet es nach, und zwar
    // mit den Unterlaengen.
    for (const m of ETIKETT_MEDIEN) {
      for (let i = 0; i < faelle.length; i++) {
        const kaesten = textkaesten(planFuer(m, i).primitive);
        for (let a = 0; a < kaesten.length; a++) {
          for (let b = a + 1; b < kaesten.length; b++) {
            expect(
              ueberlappt(kaesten[a]!, kaesten[b]!),
              `${m.cups} / Fall ${i}: ${kaesten[a]!.was} ueberlappt ${kaesten[b]!.was}`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it('laesst keinen Text auf Strichcode oder QR liegen', () => {
    // Der Strichcode ist der einzige Teil des Etiketts, den ein GERAET lesen
    // muss. Ein Buchstabe darin macht ihn unlesbar, und das faellt erst am
    // Scanner auf.
    for (const m of ETIKETT_MEDIEN) {
      for (let i = 0; i < faelle.length; i++) {
        const plan = planFuer(m, i);
        const kaesten = textkaesten(plan.primitive);
        for (const f of plan.flaechen) {
          const kasten: Kasten = {
            was: f.art,
            links: f.x,
            rechts: f.x + f.breite,
            oben: f.y,
            unten: f.y + f.hoehe,
          };
          for (const t of kaesten) {
            expect(
              ueberlappt(kasten, t),
              `${m.cups} / Fall ${i}: ${t.was} liegt auf dem ${f.art}`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it('rastet jede Modulbreite auf ganze Druckpunkte', () => {
    // Der Thermokopf rundet sonst jede Kante EINZELN, und aus gleich breiten
    // Balken werden abwechselnd drei und vier Punkte.
    for (const m of ETIKETT_MEDIEN) {
      for (let i = 0; i < faelle.length; i++) {
        const modul = planFuer(m, i).modulbreiteMm;
        if (modul === undefined) continue;
        const punkte = modul / DRUCKPUNKT_MM;
        expect(Math.abs(punkte - Math.round(punkte)), `${m.cups} / Fall ${i}`).toBeLessThan(1e-6);
        expect(Math.round(punkte), `${m.cups} / Fall ${i}`).toBeGreaterThanOrEqual(
          MODUL_MINDESTPUNKTE,
        );
        expect(modul, `${m.cups} / Fall ${i}`).toBeGreaterThanOrEqual(SCHMALSTE_LINIE_MM);
      }
    }
  });

  it('haelt die Ruhezone ein — auch im unbedruckbaren Weiss', () => {
    for (const m of ETIKETT_MEDIEN) {
      for (let i = 0; i < faelle.length; i++) {
        const plan = planFuer(m, i);
        const flaeche = plan.flaechen.find((f) => f.art === 'strichcode');
        if (!flaeche || plan.modulbreiteMm === undefined) continue;
        const noetig = RUHEZONE_MODULE * plan.modulbreiteMm;
        const weiss = m.bedruckbar.randLaengsMm ?? 0;
        // Links und rechts vom Code darf bis zur naechsten Tinte nur Weiss
        // stehen — der unbedruckbare Papierstreifen zaehlt mit, denn er IST
        // weiss.
        const tinte = plan.primitive.filter(
          (q): q is Extract<Primitiv, { art: 'rechteck' }> =>
            q.art === 'rechteck' &&
            q.ton === 'tinte' &&
            !(q.x >= flaeche.x - 1e-9 && q.x + q.breite <= flaeche.x + flaeche.breite + 1e-9 &&
              q.y >= flaeche.y - 1e-9),
        );
        let links = flaeche.x + weiss;
        let rechts = m.bedruckbar.breiteMm - (flaeche.x + flaeche.breite) + weiss;
        for (const q of tinte) {
          const trifft = q.y < flaeche.y + flaeche.hoehe && q.y + q.hoehe > flaeche.y;
          if (!trifft) continue;
          if (q.x + q.breite <= flaeche.x + 1e-9) {
            links = Math.min(links, flaeche.x - (q.x + q.breite));
          } else if (q.x >= flaeche.x + flaeche.breite - 1e-9) {
            rechts = Math.min(rechts, q.x - (flaeche.x + flaeche.breite));
          }
        }
        expect(links, `${m.cups} / Fall ${i} Ruhezone links`).toBeGreaterThanOrEqual(noetig - 1e-6);
        expect(rechts, `${m.cups} / Fall ${i} Ruhezone rechts`).toBeGreaterThanOrEqual(
          noetig - 1e-6,
        );
      }
    }
  });
});

describe('das Kapselfaehnchen (w54h144)', () => {
  const inhalt = { ...KURZ, kurzcode: 'K74F2Q', preisEur: '890.00' };

  it('teilt die 17,6 mm genau so auf, wie der Entwurf es rechnet', () => {
    const plan = etikettPlanFuerMedium(inhalt, 'w54h144');
    const qr = plan.flaechen.find((f) => f.art === 'qr');
    const code = plan.flaechen.find((f) => f.art === 'strichcode');
    expect(qr, 'der QR gehoert aufs Kapselfaehnchen').toBeDefined();
    expect(code, 'der Strichcode gehoert aufs Kapselfaehnchen').toBeDefined();

    // oben 8 Pt + QR 100 Pt + Ruhezone 16 Pt + Strichcode 79 Pt + unten 4 Pt
    expect(qr!.y / DRUCKPUNKT_MM).toBeCloseTo(8, 6);
    expect(qr!.hoehe / DRUCKPUNKT_MM).toBeCloseTo(100, 6);
    expect(code!.y / DRUCKPUNKT_MM).toBeCloseTo(124, 6);
    expect(code!.hoehe / DRUCKPUNKT_MM).toBeCloseTo(79, 6);
    expect((code!.y + code!.hoehe) / DRUCKPUNKT_MM).toBeCloseTo(203, 6);
  });

  it('gibt dem sechsstelligen Kurzcode VIER Druckpunkte je Modul', () => {
    const plan = etikettPlanFuerMedium(inhalt, 'w54h144');
    // Code 128 B: Start 11 + 6 x 11 + Pruefsumme 11 + Schluss 13 = 101 Module.
    expect(plan.strichcodeModule).toBe(101);
    expect(plan.modulbreiteMm! / DRUCKPUNKT_MM).toBeCloseTo(4, 6);
    expect(plan.modulbreiteMm).toBeCloseTo(0.33867, 4);
    // 133 Prozent der Lesbarkeitsgrenze statt der blanken 100.
    expect(plan.modulbreiteMm! / SCHMALSTE_LINIE_MM).toBeCloseTo(4 / 3, 3);
  });

  it('laesst dem Code je Seite mehr als das Doppelte der Ruhezone', () => {
    const plan = etikettPlanFuerMedium(inhalt, 'w54h144');
    const m = mediumFuer('w54h144')!;
    const code = plan.flaechen.find((f) => f.art === 'strichcode')!;
    const weissLinks = code.x + (m.bedruckbar.randLaengsMm ?? 0);
    const noetig = RUHEZONE_MODULE * plan.modulbreiteMm!;
    expect(code.x).toBeCloseTo(3.041, 2);
    expect(weissLinks).toBeCloseTo(8.297, 2);
    expect(weissLinks / noetig).toBeGreaterThan(2.4);
  });

  it('traegt den KURZCODE, nicht die lange Artikelnummer', () => {
    const plan = etikettPlanFuerMedium({ ...LANG, kurzcode: 'K74F2Q' }, 'w54h144');
    expect(plan.strichcodeText).toBe('K74F2Q');
    expect(plan.sperrgrund).toBeUndefined();
    expect(plan.qrInhalt).toBe(qrVerweis(LANG.sku));
  });

  it('erfindet KEINEN Kurzcode, sondern sperrt mit Begruendung', () => {
    // Ein selbst ausgedachter Code saehe echt aus und liesse sich in keiner
    // Datenbank aufloesen. Lieber kein Strichcode und ein Satz dazu.
    const plan = etikettPlanFuerMedium(LANG, 'w54h144');
    expect(plan.strichcodeModule).toBe(0);
    expect(plan.flaechen.some((f) => f.art === 'strichcode')).toBe(false);
    expect(plan.modulbreiteMm).toBeUndefined();
    expect(plan.sperrgrund).toContain(LANG.sku);
    expect(plan.sperrgrund).toMatch(/Etikett/);
  });

  it('nimmt bis zu elf Zeichen an und lehnt zwoelf ab', () => {
    // Die Ruhezone im unbedruckbaren Weiss hebt die Grenze von acht auf elf.
    const elf = etikettPlanFuerMedium({ ...KURZ, kurzcode: 'ABCDEFGHJKL' }, 'w54h144');
    expect(elf.sperrgrund, 'elf Zeichen muessen passen').toBeUndefined();
    expect(elf.modulbreiteMm! / DRUCKPUNKT_MM).toBeCloseTo(3, 6);

    const zwoelf = etikettPlanFuerMedium({ ...KURZ, kurzcode: 'ABCDEFGHJKLM' }, 'w54h144');
    expect(zwoelf.sperrgrund, 'zwoelf Zeichen duerfen NICHT passen').toBeDefined();
  });

  it('laesst den QR weg, wo er nicht mehr lesbar waere (Haengemappe)', () => {
    // 13,1 mm Bahnbreite lassen dem QR nur knapp zwei Druckpunkte je Modul.
    // Ein Code, den kein Telefon liest, gehoert nicht aufs Papier.
    const plan = etikettPlanFuerMedium({ ...KURZ, kurzcode: 'K74F2Q' }, 'w41h144');
    expect(plan.qrInhalt).toBe('');
    expect(plan.flaechen.some((f) => f.art === 'qr')).toBe(false);
    // Der Strichcode bleibt — er ist der Teil, auf den es am Tresen ankommt.
    expect(plan.flaechen.some((f) => f.art === 'strichcode')).toBe(true);
    expect(QR_MINDESTPUNKTE).toBe(4);
  });
});

describe('der Ueberstand-Waechter', () => {
  // ── DER FUND ────────────────────────────────────────────────────────────
  // Vorher wurde die Modulbreite nach UNTEN abgeklemmt statt den Code zu
  // verweigern. Nachgerechnet: linke Spalte 66,4 mm, 22 Zeichen, gezeichnet
  // 75,4 mm — 9,0 mm ueber dem Rand. Auf dem Bildschirm sah das richtig aus.
  const zuLang = { sku: 'SEHR-LANGE-NUMMER-0001', name: 'Konvolut' };

  it('verweigert den Code, statt ihn ueber den Rand laufen zu lassen', () => {
    for (const cups of ['w81h252', 'w54h144', 'w153h198']) {
      const plan = etikettPlanFuerMedium(zuLang, cups);
      expect(plan.sperrgrund, `${cups} muss sperren`).toBeDefined();
      expect(plan.modulbreiteMm, cups).toBeUndefined();
      expect(plan.flaechen.some((f) => f.art === 'strichcode'), cups).toBe(false);
      // Und an der gewohnten Stelle steht, warum dort nichts ist — sonst
      // sieht das Etikett am Regal aus wie ein Druckfehler.
      expect(
        plan.primitive.some((q) => q.art === 'text' && q.text === 'kein Strichcode'),
        cups,
      ).toBe(true);
    }
  });

  it('zeichnet NIE einen Strichcode breiter als seine Zone', () => {
    // Der eigentliche Waechter: was gezeichnet wird, passt — ausnahmslos.
    for (const m of ETIKETT_MEDIEN) {
      for (const inhalt of [KURZ, LANG, zuLang, { ...KURZ, sku: 'A1' }]) {
        const plan = etikettPlanFuerMedium(inhalt, m.cups);
        const code = plan.flaechen.find((f) => f.art === 'strichcode');
        if (!code) continue;
        expect(code.x + code.breite, `${m.cups} / ${inhalt.sku}`).toBeLessThanOrEqual(
          m.bedruckbar.breiteMm + 1e-6,
        );
        // Und die gezeichnete Breite ist genau Module mal Modulbreite.
        const module = code128BalkenBreiten(plan.strichcodeText).reduce((a, b) => a + b, 0);
        expect(code.breite).toBeCloseTo(module * plan.modulbreiteMm!, 9);
        expect(plan.strichcodeModule).toBe(module);
      }
    }
  });

  it('nennt den Grund so, dass ihn ein Mensch am Tresen versteht', () => {
    const grund = etikettSperre(zuLang, mediumFuer('w54h144')!.bedruckbar);
    expect(grund).toBeDefined();
    expect(grund).toContain(zuLang.sku);
    expect(grund).toMatch(/mm/);
    expect(grund).not.toMatch(/[a-z]_[a-z]/i);
  });

  it('sperrt eine unbekannte Groesse, statt sie zu erfinden', () => {
    expect(() => etikettPlanFuerMedium(KURZ, 'w99h999')).toThrow();
  });

  it('verweigert eine Artikelnummer, die Code128 nicht darstellen kann', () => {
    // Lieber ein ehrlicher Fehler als ein Etikett mit still verstuemmeltem Code.
    expect(() => etikettPlan({ sku: 'MZ‑0042', name: 'Gedankenstrich statt Bindestrich' })).toThrow();
    expect(etikettSperre({ sku: 'MZ‑0042', name: 'x' }, DYMO_99010)).toContain('Code 128');
  });
});

describe('das Haus-Etikett (w81h252)', () => {
  it('gibt einer KURZEN Nummer dickere Balken als einer langen', () => {
    // Der Code soll die Flaeche fuellen, nicht in einer Ecke kauern.
    const kurz = etikettPlan(KURZ).modulbreiteMm!;
    const lang = etikettPlan(LANG).modulbreiteMm!;
    expect(kurz).toBeGreaterThan(lang);
  });

  it('der Strichcode traegt die ARTIKELNUMMER und sonst nichts', () => {
    // Ein Handscanner gibt genau eine Zeile zurueck. Steht dort mehr als die
    // Nummer, findet die Kasse den Artikel nicht.
    const plan = etikettPlan(KURZ);
    expect(plan.strichcodeText).toBe(KURZ.sku);
    const balkenAnzahl = code128BalkenBreiten(KURZ.sku).filter((_, i) => i % 2 === 0).length;
    const code = plan.flaechen.find((f) => f.art === 'strichcode')!;
    const gezeichnet = plan.primitive.filter(
      (q) =>
        q.art === 'rechteck' &&
        q.ton === 'tinte' &&
        Math.abs(q.y - code.y) < 1e-9 &&
        Math.abs(q.hoehe - code.hoehe) < 1e-9,
    ).length;
    expect(gezeichnet).toBe(balkenAnzahl);
  });

  it('der QR verweist nach innen und traegt KEINEN Preis', () => {
    const plan = etikettPlan({ ...LANG, preisEur: '1290.00' });
    expect(plan.qrInhalt).toBe(qrVerweis(LANG.sku));
    expect(plan.qrInhalt).toContain(LANG.sku);
    // Ein Etikett klebt am Regal und ist fuer jeden im Laden sichtbar.
    expect(plan.qrInhalt).not.toMatch(/eur|preis|€|\d+[,.]\d\d/i);
  });

  it('schreibt die Nummer auch im Klartext, gross genug zum Abtippen', () => {
    const plan = etikettPlan(KURZ);
    const klartext = plan.primitive.find((q) => q.art === 'text' && q.text === KURZ.sku);
    expect(klartext).toBeDefined();
    expect(klartext?.art === 'text' && klartext.hoeheMm).toBeGreaterThanOrEqual(3);
    expect(klartext?.art === 'text' && klartext.schrift).toBe('mono');
  });

  it('macht aus der Datenbankzahl eine Zahl fuers Regal', () => {
    const plan = etikettPlan(LANG);
    // Nicht nach „g" suchen — das steckt auch in „Gelbgold". Die Gewichtszeile
    // ist die einzige mit dem Trennpunkt.
    const zeile = plan.primitive.find((q) => q.art === 'text' && q.text.includes(' · '));
    expect(zeile?.art === 'text' && zeile.text).toBe('14,50 g  ·  585');
  });

  it('kuerzt einen langen Namen nach BREITE, nicht nach Zeichenzahl', () => {
    const plan = etikettPlan(LANG);
    const name = plan.primitive.find(
      (q): q is Extract<Primitiv, { art: 'text' }> =>
        q.art === 'text' && q.text.startsWith('Armband'),
    );
    expect(name).toBeDefined();
    expect(textbreiteMm(name!.text, name!.hoeheMm, name!.schrift)).toBeLessThanOrEqual(40);
  });

  it('haelt Grundlinie und rechte Kante des Preises fest', () => {
    // Zwei Etiketten nebeneinander muessen den Preis an derselben Kante und
    // auf derselben Hoehe zeigen. Nur die Groesse gibt nach.
    const a = etikettPlan({ ...KURZ, preisEur: '12.00' });
    const b = etikettPlan({ ...LANG, preisEur: '123456.00' });
    const preisA = a.primitive.find(
      (q): q is Extract<Primitiv, { art: 'text' }> => q.art === 'text' && q.text.includes('€'),
    )!;
    const preisB = b.primitive.find(
      (q): q is Extract<Primitiv, { art: 'text' }> => q.art === 'text' && q.text.includes('€'),
    )!;
    expect(preisA.y).toBeCloseTo(preisB.y, 9);
    expect(preisA.x).toBeCloseTo(preisB.x, 9);
    expect(preisA.anker).toBe('rechts');
    expect(preisB.hoeheMm).toBeLessThan(preisA.hoeheMm);
  });
});

describe('das hohe Haus-Etikett und die grossen Formate', () => {
  it('gibt dem Namen auf w101h252 zwei Zeilen', () => {
    const eine = etikettPlanFuerMedium(LANG, 'w81h252').primitive.filter(
      (q) => q.art === 'text' && /Armband|Gelbgold|Verschluss|Sicherung/.test(q.text),
    ).length;
    const zwei = etikettPlanFuerMedium(LANG, 'w101h252').primitive.filter(
      (q) => q.art === 'text' && /Armband|Gelbgold|Verschluss|Sicherung/.test(q.text),
    ).length;
    expect(eine).toBe(1);
    expect(zwei).toBe(2);
  });

  it('traegt den vollen Namen ohne Auslassungszeichen auf den grossen Formaten', () => {
    for (const cups of ['w153h198', 'w162h225', 'w162h288']) {
      const plan = etikettPlanFuerMedium(LANG, cups);
      const zeilen = plan.primitive
        .filter((q): q is Extract<Primitiv, { art: 'text' }> => q.art === 'text')
        .filter((q) => /Armband|Gelbgold|Verschluss|Sicherung/.test(q.text));
      expect(zeilen.length, cups).toBeGreaterThanOrEqual(2);
      expect(zeilen.map((z) => z.text).join(' '), cups).toBe(LANG.name);
    }
  });
});

describe('der Preis am Regal', () => {
  it('laesst Cent weg, die null sind', () => {
    // Auf 17,6 mm ist das keine Kosmetik, das kauft messbar Versalhoehe.
    expect(preisText('890.00')).toBe('890 €');
    expect(preisText('12900.00')).toBe('12.900 €');
    expect(preisText('890.50')).toBe('890,50 €');
    expect(preisText('0.99')).toBe('0,99 €');
  });

  it('sagt „in Bewertung" statt eine leere Zone zu lassen', () => {
    for (const cups of ['w54h144', 'w81h252', 'w162h288']) {
      const plan = etikettPlanFuerMedium(KURZ, cups);
      const zeile = plan.primitive.find(
        (q): q is Extract<Primitiv, { art: 'text' }> =>
          q.art === 'text' && q.text === OHNE_PREIS,
      );
      expect(zeile, cups).toBeDefined();
      expect(zeile!.ton, cups).toBe('blass');
    }
  });
});

describe('kein Zeichen steht bündig auf der Kopfreichweite', () => {
  /**
   * ── DER FUND (26.07.2026) ────────────────────────────────────────────────
   * Der Preis auf dem Kapselfähnchen war rechtsbündig auf die bedruckbare
   * Breite gesetzt: er endete bei 40,29 mm auf 40,287 mm Fläche. Jenseits
   * dieser Kante markiert der Kopf nicht — was hinausragt, landet nicht in
   * einem Rand, es wird gar nicht gedruckt.
   *
   * Dass es trotzdem passte, lag nur daran, dass `textbreiteMm` grosszügig
   * schätzt (für „890 €" um 0,35 mm gegen die echten Schriftmasse). Ein
   * Entwurf, der davon lebt, bricht, sobald jemand den Schätzer genauer macht.
   *
   * Diese Prüfung verlangt echten Abstand — und misst ihn NICHT mit dem
   * Schätzer allein, sondern zusätzlich mit den amtlichen Helvetica-Massen.
   * Eine Prüfung, die mit demselben Lineal misst, das gezeichnet hat,
   * bestätigt sich selbst.
   */
  const MINDESTRAND_MM = 0.3;

  /**
   * Helvetica-Bold, AMTLICHE Zeichenbreiten je 1000 Geviert-Einheiten.
   *
   * Beim ersten Anlauf stand hier ein pauschales 556 für alles ausser
   * Grossbuchstaben. Das meldete „in Bewertung" als zu breit, obwohl es passt:
   * ein „i" ist 278 Einheiten breit, ein „m" 889. Ein zweites Lineal, das
   * gröber ist als das erste, findet keine Fehler — es erfindet welche.
   */
  const AFM: Record<string, number> = {
    ' ': 278, '.': 278, ',': 278, ':': 333, '·': 278, '…': 1000, '-': 333, '/': 278,
    '€': 556, '„': 500, '"': 500,
    '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
    '8': 556, '9': 556,
    A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556,
    K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
    U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
    a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278,
    k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333,
    u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
    'ä': 556, 'ö': 611, 'ü': 611, 'ß': 611, 'Ä': 722, 'Ö': 778, 'Ü': 722,
  };
  function echtBreiteMm(text: string, versalMm: number, schrift: 'mono' | 'sans'): number {
    if (schrift === 'mono') return text.length * 0.6 * (versalMm / 0.562);
    const geviert = versalMm / 0.717;
    let em = 0;
    for (const z of text) em += (AFM[z] ?? (/[A-ZÄÖÜ]/.test(z) ? 722 : 556)) / 1000;
    return em * geviert;
  }

  for (const medium of ETIKETT_MEDIEN) {
    it(`hält auf ${medium.cups} rechts Abstand, mit BEIDEN Linealen`, () => {
      const PROBEN = [
        KURZ,
        LANG,
        { ...KURZ, preisEur: '890.00', kurzcode: 'K7M4XQ' },
        { ...KURZ, preisEur: '12900.00', kurzcode: 'K7M4XQ' },
        { ...LANG, preisEur: '1290.50' },
        { sku: 'A1', name: 'Kurz', preisEur: '4.50' },
      ];
      for (const inhalt of PROBEN) {
        const plan = etikettPlanFuerMedium(inhalt, medium.cups);
        const B = plan.masse.breiteMm;
        for (const q of plan.primitive) {
          if (q.art !== 'text') continue;
          const geschaetzt = textbreiteMm(q.text, q.hoeheMm, q.schrift, q.sperrung ?? 0);
          const echt = echtBreiteMm(q.text, q.hoeheMm, q.schrift);
          const links = q.anker === 'rechts' ? q.x - geschaetzt : q.x;
          const rechtsGeschaetzt = links + geschaetzt;
          const rechtsEcht = links + echt;
          expect(
            Math.max(rechtsGeschaetzt, rechtsEcht),
            `„${q.text}" auf ${medium.cups}`,
          ).toBeLessThanOrEqual(B - MINDESTRAND_MM + 0.001);
        }
      }
    });
  }
});


describe('die grossen Formate wachsen MIT, statt nur auseinanderzurücken', () => {
  /**
   * ── DER BEFUND (26.07.2026, 1:1-Bogen mit allen zehn Grössen) ────────────
   * Auf `w153h198`, `w162h225` und `w162h288` standen Kopf und Fuss, und
   * dazwischen klaffte ein leeres Band. Die grosse Familie lief durch dieselbe
   * feste Zahlentabelle wie das Haus-Etikett: auf mehr Fläche rückte derselbe
   * Inhalt nur weiter auseinander. Nachgemessen war der Strichcode auf dem
   * grössten Warenetikett (2,25 × 4,00 Zoll) 6,97 mm hoch — NIEDRIGER als auf
   * dem halb so grossen Haus-Etikett (7,90 mm).
   *
   * Diese Prüfungen sind der Grund, warum das nicht zurückfallen kann.
   */
  const GROSS = ['w153h198', 'w162h225', 'w162h288', 'w162h504', 'w162h540'] as const;
  const HAUS = 'w81h252';

  function versalhoehe(cups: string, inhalt: Parameters<typeof etikettPlanFuerMedium>[0], text: string) {
    const t = etikettPlanFuerMedium(inhalt, cups).primitive.find(
      (q): q is Extract<Primitiv, { art: 'text' }> => q.art === 'text' && q.text === text,
    );
    expect(t, `${cups}: „${text}" fehlt`).toBeDefined();
    return t!.hoeheMm;
  }

  it('setzt die Artikelnummer GRÖSSER als auf dem Haus-Etikett', () => {
    // Basels Satz: auf 52 × 59 mm darf die Nummer grösser sein als auf
    // 27 × 78 mm. Geprüft mit einer kurzen UND einer langen Nummer — bei der
    // langen deckelt auf der Diskette die Zeilenlänge, nicht der Wunsch, und
    // genau dort wäre ein Rückfall am leichtesten zu übersehen.
    for (const inhalt of [KURZ, LANG]) {
      const haus = versalhoehe(HAUS, inhalt, inhalt.sku);
      for (const cups of GROSS) {
        expect(versalhoehe(cups, inhalt, inhalt.sku), `${cups} / ${inhalt.sku}`).toBeGreaterThan(haus);
      }
    }
  });

  it('setzt den Strichcode HÖHER als auf dem Haus-Etikett', () => {
    for (const inhalt of [KURZ, LANG]) {
      const haus = etikettPlanFuerMedium(inhalt, HAUS).flaechen.find((f) => f.art === 'strichcode')!;
      for (const cups of GROSS) {
        const code = etikettPlanFuerMedium(inhalt, cups).flaechen.find((f) => f.art === 'strichcode');
        expect(code, `${cups}: kein Strichcode`).toBeDefined();
        expect(code!.hoehe, `${cups} / ${inhalt.sku}`).toBeGreaterThan(haus.hoehe);
      }
    }
  });

  it('gibt jedem Strichcode mindestens 15 Prozent seiner eigenen Breite', () => {
    // Ein flacher Code wandert beim Ziehen über das Glas aus dem Lesestrahl.
    // Der Deckel bei 10 mm ist gemessen: der 128 mm lange Code auf dem
    // Portoetikett bräuchte nach der reinen Regel 19 mm, und die fehlten dann
    // dem Namen, ohne dass ein Scanner davon etwas hätte.
    for (const cups of GROSS) {
      for (const inhalt of [KURZ, LANG, { ...LANG, kurzcode: 'K74F2Q' }]) {
        const code = etikettPlanFuerMedium(inhalt, cups).flaechen.find((f) => f.art === 'strichcode')!;
        expect(code.hoehe, `${cups} / ${inhalt.sku}`).toBeGreaterThanOrEqual(
          Math.min(0.15 * code.breite, 10.0) - 1e-9,
        );
      }
    }
  });

  it('kürzt den Lagerort NICHT, solange irgendwo Platz ist', () => {
    // Der Fund am Bogen: auf der Farbdose stand „Tresor-1 / F…", während zwei
    // Zentimeter darunter nichts stand. Der Lagerort hat jetzt zwei Plätze —
    // die Kopfzeile, für die die Wortmarke zurücktritt, und die Bandzeile
    // neben Gewicht und Feinheit.
    for (const cups of GROSS) {
      for (const ort of ['Tresor-1 / Fach-3', 'Vitrine-2', 'Lager Nord / Regal 7']) {
        const plan = etikettPlanFuerMedium({ sku: LANG.sku, name: LANG.name, lagerort: ort, preisEur: '1290.50' }, cups);
        const zeile = plan.primitive.find(
          (q): q is Extract<Primitiv, { art: 'text' }> =>
            q.art === 'text' && q.text.startsWith(ort.slice(0, 5)),
        );
        expect(zeile?.text, `${cups} / ${ort}`).toBe(ort);
      }
    }
  });

  it('gibt ihm den ZWEITEN Platz, wenn der erste ihn nicht ganz trägt', () => {
    // Ohne Gewicht und Feinheit ist die Bandzeile neben dem QR die breiteste
    // Zeile des Etiketts — breiter als der Rest der Kopfzeile neben der
    // Wortmarke. Ein langer Lagerort gehört dann dorthin und nicht oben
    // abgeschnitten. Ein Stück ohne Metallangabe ist der Normalfall bei
    // Sammlerware, nicht die Ausnahme.
    const ort = 'Aussenlager Halle B / Regal 12 / Fach 4';
    const ohneMetall = { sku: LANG.sku, name: LANG.name, lagerort: ort, preisEur: '1290.50' };
    for (const cups of ['w162h225', 'w162h288']) {
      const zeile = etikettPlanFuerMedium(ohneMetall, cups).primitive.find(
        (q): q is Extract<Primitiv, { art: 'text' }> =>
          q.art === 'text' && q.text.startsWith('Aussen'),
      );
      expect(zeile?.text, cups).toBe(ort);
    }
  });

  it('kürzt, wenn es kürzen MUSS, mit dem Lineal der gesetzten Höhe', () => {
    // ── DER FUND ──────────────────────────────────────────────────────────
    // Gekürzt wurde auf die WUNSCHhöhe und dann in der kleineren eingepassten
    // Höhe gesetzt. Hinter dem Auslassungszeichen blieb damit Platz stehen,
    // der weitere Zeichen getragen hätte. Die Zahlen unten sind gemessen: mit
    // dem falschen Lineal waren es 18 Zeichen (Haus-Etikett) und 8 (Diskette).
    const ort = 'Tresor-1 / Fach-3 / Schublade links unten';
    const sichtbar = (cups: string) => {
      const zeile = etikettPlanFuerMedium({ ...LANG, lagerort: ort, preisEur: '1290.50' }, cups)
        .primitive.find(
          (q): q is Extract<Primitiv, { art: 'text' }> =>
            q.art === 'text' && q.text.startsWith('Tresor'),
        );
      return zeile?.text ?? '';
    };
    expect(sichtbar('w81h252').length, 'Haus-Etikett').toBeGreaterThanOrEqual(24);
    // Auf der Diskette gewinnt zusätzlich der Platz, der MEHR zeigt: oben
    // trüge die Zeile acht Zeichen, unten neben Gewicht und Feinheit siebzehn.
    expect(sichtbar('w153h198').length, 'Diskette').toBeGreaterThanOrEqual(17);
    expect(sichtbar('w162h288').length, '2,25 × 4,00 Zoll').toBeGreaterThanOrEqual(38);
  });

  it('lässt kein leeres Band quer über dem Etikett stehen', () => {
    /**
     * Genau Basels Klage, in Zahlen: alle Kästen auf die Hochachse geworfen,
     * zusammengelegt, und die grösste Lücke dazwischen gemessen. Vorher waren
     * das auf drei der fünf grossen Formate 13,53 mm — ein Loch, in das eine
     * ganze Zeile gepasst hätte. Auf Kapselfähnchen und Haus-Etikett waren es
     * schon immer unter 0,9 mm; die Prüfung deckt sie mit ab.
     *
     * Ausgenommen ist der Fall OHNE Strichcode: dort bleibt sein Band
     * reserviert und leer, und diese Grösse wird dem Inhaber ohnehin gesperrt
     * angeboten (`sperrgrund`).
     */
    const PROBEN = [
      KURZ,
      LANG,
      { ...KURZ, preisEur: '890.00' },
      { ...LANG, preisEur: '1290.50' },
      { ...LANG, kurzcode: 'K74F2Q', preisEur: '99999.00' },
      { sku: 'A1', name: 'Kurz', preisEur: '12.00' },
    ];
    for (const m of ETIKETT_MEDIEN) {
      for (const inhalt of PROBEN) {
        const plan = etikettPlanFuerMedium(inhalt, m.cups);
        if (plan.sperrgrund !== undefined) continue;
        const spuren = plan.primitive
          .map((q) =>
            q.art === 'rechteck'
              ? { oben: q.y, unten: q.y + q.hoehe }
              : { oben: textkasten(q).oben, unten: textkasten(q).unten },
          )
          .sort((x, y) => x.oben - y.oben);
        let groesste = 0;
        let unten = spuren[0]!.unten;
        for (const s of spuren) {
          if (s.oben > unten) groesste = Math.max(groesste, s.oben - unten);
          unten = Math.max(unten, s.unten);
        }
        expect(groesste, `${m.cups} / ${inhalt.sku}: leeres Band`).toBeLessThan(2.0);
      }
    }
  });
});


/**
 * DIE OBERFLÄCHEN-WACHE — die Sperrklinke gegen den Rückfall.
 *
 * ── WARUM ES DIESE DATEI GIBT ───────────────────────────────────────────────
 * Basel, über die Kasse: „zu viele Dinge, chaotisch, nicht einfach und elegant,
 * das Design überlagert sich."
 *
 * Diese Klage ist nicht EIN Fehler. Sie ist das, was übrig bleibt, wenn über
 * Monate jede Fläche für sich entschieden hat, wie gross ihre Schrift ist,
 * welche Farbe sie mischt und wie hoch sie liegt. Jede einzelne Entscheidung
 * war für sich plausibel. Zusammen ergeben sie Rauschen.
 *
 * Man kann dieses Rauschen einmal aufräumen. Das haben andere Pakete dieser
 * Etappe getan. Aber Aufräumen allein ist Kosmetik: in drei Monaten ist die
 * nächste eilige Fläche geschrieben, wieder mit einer von Hand getippten
 * Ebenenzahl und einer von Hand gemischten Farbe, weil beides SOFORT
 * funktioniert und nichts widerspricht. Genau so ist der heutige Zustand
 * entstanden.
 *
 * Diese Datei widerspricht.
 *
 * ── WARUM HIER KEIN EINZIGES BEISPIEL AUSGESCHRIEBEN STEHT ──────────────────
 * Diese Datei nennt absichtlich NIRGENDS eine Ebenenzahl in ihrer echten
 * Schreibweise. Der Grund ist ein Fehler, den sie sich selbst zugefügt hat:
 *
 * Im Baukasten wacht `components/ToastContainer.test.tsx` darüber, dass die
 * Meldungsstufe über jeder nackten Zahl der Kasse liegt — sonst erschiene eine
 * Warnung hinter dem Fenster, das sie erklärt, und niemand sähe sie. Dieser
 * Wächter liest den ROHEN Quelltext ALLER Dateien und überspringt Prüfdateien
 * NICHT. Als hier weiter unten die Rot-Grün-Probe mit ihrer Zahl im Klartext
 * dokumentiert wurde, las er diese Zahl als echte Ebene der Kasse und fiel:
 *
 *     „Höchste gemessene fremde Ebene in der Kasse: 9999"
 *
 * Ein PROSA-ABSATZ hat also eine fremde Prüfung rot gemacht. Nichts am Bau der
 * Kasse hatte sich geändert. Wer das nicht weiss, sucht den Fehler dort, wo er
 * nicht ist. Deshalb: über Ebenen wird hier geredet, nie eine ausgeschrieben.
 *
 * ── DIE BAUART: SPERRKLINKE, NICHT NULL ─────────────────────────────────────
 * Ein Wächter, der auf null prüft, wäre heute rot und würde binnen einer Woche
 * abgeschaltet — dann hätten wir nichts. Also arbeitet jede Regel hier mit
 * einer SCHWELLE, die auf dem gemessenen Stand vom 26.07.2026 steht. Neue
 * Verstösse machen die Prüfung sofort rot; das Aufräumen der alten darf in Ruhe
 * geschehen.
 *
 * ⚠ WARNUNG AN DEN NÄCHSTEN MENSCHEN, DER DIESE DATEI ROT SIEHT:
 *
 *     Eine Prüfung, die man durch ANHEBEN der Schwelle grün macht, ist
 *     wertlos. Sie ist dann keine Wache mehr, sondern eine Zahl, die der
 *     Wirklichkeit hinterherläuft. Die Schwelle darf NUR fallen.
 *
 * Wenn eine Zahl hier zu hoch ist, weil jemand aufgeräumt hat: Zahl senken,
 * Datum daneben schreiben. Das ist der einzige erlaubte Weg nach oben in der
 * Qualität und nach unten in der Zahl.
 *
 * ── WAS DIESE WACHE NICHT KANN ──────────────────────────────────────────────
 * Sie liest Text, sie rendert nichts. Sie findet die Muster, die am Tresen
 * schon einmal weh getan haben, und sie findet sie zuverlässig. Sie ersetzt
 * keinen Menschen, der hinsieht. Wo eine Regel gröber misst als sie möchte,
 * steht das ausdrücklich bei der Regel.
 *
 * ── DASS SIE WIRKLICH ROT WIRD, IST GEPRÜFT (26.07.2026) ────────────────────
 * Fünf Mal einzeln: je ein Verstoss in eine Probedatei gelegt, gelaufen, die
 * Probedatei entfernt. Jedes Mal fiel GENAU EINE Prüfung — die zuständige —
 * und die übrigen siebzehn blieben grün:
 *
 *     eine nackte Ebenenzahl weit über der Leiter   → Regel 1 fällt
 *     eine rohe Farbe als Hexwert                   → Regel 2 fällt
 *     ein aria-modal ohne jeden Rückweg             → Regel 3 fällt
 *     eine Schaltung von 20 auf 20 Pixel            → Regel 4 fällt
 *     ein Rohwert mit Unterstrich in einem span     → Regel 5 fällt
 *
 * Ohne diesen Nachweis wäre jede der Zahlen unten nur eine Behauptung. Eine
 * Prüfung, von der niemand gesehen hat, wie sie fällt, ist keine Prüfung.
 *
 * ── EIN HINWEIS ZUM DATUM DER MESSUNG ───────────────────────────────────────
 * Gemessen wurde am 26.07.2026, WÄHREND an denselben Flächen noch gearbeitet
 * wurde: die Zielkarte, der Leitstand und die Fenster der Kasse waren im Umbau.
 * Die Zahlen unten sind daher eher zu hoch als zu niedrig. Wer sie das nächste
 * Mal anfasst, misst neu und schreibt die kleinere Zahl hin — nie die grössere.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = fileURLToPath(new URL('.', import.meta.url));
const KASSE = join(HIER, '..');
const KIT = join(HIER, '../../../../packages/ui-kit/src');

/* ────────────────────────────────────────────────────────────────────────────
 * Werkzeug
 * ──────────────────────────────────────────────────────────────────────────── */

/** Alle Dateien unter einem Verzeichnis, deren Endung zählt. */
function dateien(wurzel: string, endungen: readonly string[]): string[] {
  const gefunden: string[] = [];
  const gehe = (ort: string): void => {
    let eintraege: string[];
    try {
      eintraege = readdirSync(ort);
    } catch {
      return;
    }
    for (const name of eintraege) {
      if (name === 'node_modules' || name === 'dist' || name === 'src-tauri') continue;
      const voll = join(ort, name);
      if (statSync(voll).isDirectory()) gehe(voll);
      else if (endungen.some((e) => name.endsWith(e))) gefunden.push(voll);
    }
  };
  gehe(wurzel);
  return gefunden;
}

/** Ein Pfad, so kurz wie ein Mensch ihn vorliest. */
function kurz(datei: string): string {
  return datei.replace(KASSE, 'apps/tauri-pos/src').replace(KIT, 'packages/ui-kit/src');
}

/**
 * Kommentare durch Leerzeichen ersetzen, Zeilenumbrüche behalten.
 *
 * WARUM NICHT EINFACH DEN ROHTEXT LESEN: `lib/ankauf-kyc-gate.ts` erklärt in
 * einem Fliesstext den Paragraphen „#101". Für eine Farbregel sieht `#101`
 * genau aus wie ein Kurz-Hexwert und wäre ein Fehlalarm — und ein Wächter, der
 * Fehlalarme gibt, wird abgeschaltet. Kommentare sind ausserdem per Definition
 * nichts, was ein Mensch am Tresen sieht.
 *
 * Die Umsetzung ersetzt Zeichen statt sie zu löschen, damit Zeilennummern in
 * der Fehlermeldung weiterhin auf die echte Zeile zeigen.
 *
 * GRENZE, EHRLICH BENANNT: ein Schrägstrich in einem regulären Ausdruck kann
 * hier fälschlich als Kommentarbeginn gelesen werden. Der Effekt ist immer,
 * dass WENIGER Text geprüft wird, nie dass etwas Falsches gemeldet wird. Ein
 * Wächter, der im Zweifel schweigt, ist einer, dem man glaubt.
 */
function ohneKommentare(text: string): string {
  const aus: string[] = [];
  let i = 0;
  let modus: 'code' | 'zeile' | 'block' | "'" | '"' | '`' = 'code';
  while (i < text.length) {
    const z = text[i] as string;
    const naechst = text[i + 1];
    if (modus === 'code') {
      if (z === '/' && naechst === '/') {
        modus = 'zeile';
        aus.push('  ');
        i += 2;
        continue;
      }
      if (z === '/' && naechst === '*') {
        modus = 'block';
        aus.push('  ');
        i += 2;
        continue;
      }
      if (z === "'" || z === '"' || z === '`') modus = z;
      aus.push(z);
      i += 1;
      continue;
    }
    if (modus === 'zeile') {
      if (z === '\n') {
        modus = 'code';
        aus.push('\n');
      } else aus.push(' ');
      i += 1;
      continue;
    }
    if (modus === 'block') {
      if (z === '*' && naechst === '/') {
        modus = 'code';
        aus.push('  ');
        i += 2;
        continue;
      }
      aus.push(z === '\n' ? '\n' : ' ');
      i += 1;
      continue;
    }
    // In einer Zeichenkette: der Inhalt bleibt, denn genau dort stehen die
    // Farben und die Oberflächentexte.
    if (z === '\\') {
      aus.push(z, text[i + 1] ?? '');
      i += 2;
      continue;
    }
    if (z === modus) modus = 'code';
    aus.push(z);
    i += 1;
  }
  return aus.join('');
}

interface Quelle {
  datei: string;
  kurz: string;
  roh: string;
  rein: string;
}

/**
 * Prüfdateien werden NICHT gelesen. Sie zeichnen nichts auf einen Bildschirm,
 * sie reden ÜBER Oberfläche — diese Datei selbst ist das beste Beispiel: sie
 * müsste Ebenen und Farben zitieren, um sie zu erklären, und wäre damit ihr
 * eigener erster Verstoss. Derselbe Fehlalarm hat am 26.07.2026 schon einmal
 * den Marken-Wächter getroffen.
 */
const istPruefdatei = (datei: string): boolean => /\.(test|stories)\.tsx?$/.test(datei);

function laden(endungen: readonly string[]): Quelle[] {
  return [...dateien(KASSE, endungen), ...dateien(KIT, endungen)]
    .filter((d) => !istPruefdatei(d))
    .map((datei) => {
      const roh = readFileSync(datei, 'utf8');
      return { datei, kurz: kurz(datei), roh, rein: ohneKommentare(roh) };
    });
}

const QUELLEN = laden(['.ts', '.tsx']);
const STILDATEIEN = laden(['.css']);

/** Zeilennummer zu einem Zeichenversatz — für „Datei:Zeile" in der Meldung. */
function zeileVon(text: string, versatz: number): number {
  let n = 1;
  for (let i = 0; i < versatz && i < text.length; i += 1) if (text[i] === '\n') n += 1;
  return n;
}

interface Fund {
  ort: string;
  was: string;
}

/**
 * Die gemeinsame Meldung jeder Regel.
 *
 * Sie nennt die zehn schlimmsten Fundstellen mit Datei und Zeile. Eine Meldung,
 * die nur zählt („62 Verstösse"), zwingt den nächsten Menschen, die Suche noch
 * einmal von Hand zu bauen — und genau da hört er auf.
 */
function bericht(regel: string, funde: readonly Fund[], schwelle: number, gemessen: string): string {
  // Die zehn Fundstellen werden nach der SCHWERE IHRER DATEI sortiert und je
  // Datei auf zwei begrenzt.
  //
  // WARUM NICHT einfach die ersten zehn: eine einzige verwahrloste Datei füllt
  // sonst die ganze Liste, und der nächste Mensch sieht zehnmal denselben Ort.
  // Beim ersten Lauf am 26.07.2026 war genau das der Fall — zehn Zeilen aus
  // der (längst ausgezogenen) Hülle des Sprachassistenten, während 377 Funde
  // in Dateien lagen, die niemand zu sehen bekam. So zeigt die Liste die BREITE des Problems und die Kopfzeile
  // darunter seine TIEFE.
  const proDatei = new Map<string, number>();
  for (const f of funde) {
    const datei = f.ort.split(':')[0] as string;
    proDatei.set(datei, (proDatei.get(datei) ?? 0) + 1);
  }
  const schwere = (f: Fund): number => proDatei.get(f.ort.split(':')[0] as string) ?? 0;
  const sortiert = [...funde].sort((a, b) => schwere(b) - schwere(a));
  const gezeigt: Fund[] = [];
  const proDateiGezeigt = new Map<string, number>();
  for (const f of sortiert) {
    if (gezeigt.length >= 10) break;
    const datei = f.ort.split(':')[0] as string;
    const bisher = proDateiGezeigt.get(datei) ?? 0;
    if (bisher >= 2) continue;
    proDateiGezeigt.set(datei, bisher + 1);
    gezeigt.push(f);
  }
  const schlimmste = [...proDatei.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([datei, n]) => `  ${n} × ${datei}`);
  const rest = funde.length > gezeigt.length ? `\n  … und ${funde.length - gezeigt.length} weitere.` : '';
  return [
    '',
    `${regel}`,
    `Gefunden: ${funde.length}. Erlaubte Altlast: ${schwelle} (gemessen ${gemessen}).`,
    '',
    'Die Dateien mit den meisten Funden:',
    ...schlimmste,
    '',
    'Fundstellen zum Anfangen (höchstens zwei je Datei):',
    ...gezeigt.map((f) => `  ${f.ort}\n      ${f.was}`),
    rest,
    '',
    'DIESE PRÜFUNG WIRD NICHT DURCH ANHEBEN DER SCHWELLE BEHOBEN.',
    'Die Schwelle ist eine Sperrklinke und darf nur fallen.',
    '',
  ].join('\n');
}

/* ────────────────────────────────────────────────────────────────────────────
 * Grundlage: liest die Wache überhaupt etwas?
 * ──────────────────────────────────────────────────────────────────────────── */

describe('die Wache liest wirklich Quelltext', () => {
  it('findet die Dateien der Kasse und des Baukastens', () => {
    // Ein falscher Pfad macht JEDE Regel darunter grün über einer leeren Menge.
    // Das ist die gefährlichste Art von grün, und sie ist lautlos.
    expect(QUELLEN.length, 'Quelltextdateien gefunden').toBeGreaterThan(200);
    expect(STILDATEIEN.length, 'Stildateien gefunden').toBeGreaterThan(2);
    expect(QUELLEN.some((q) => q.kurz.startsWith('apps/tauri-pos/src/'))).toBe(true);
    expect(QUELLEN.some((q) => q.kurz.startsWith('packages/ui-kit/src/'))).toBe(true);
  });

  it('schneidet Kommentare heraus, ohne Zeilen zu verschieben', () => {
    const probe = "const a = 1; // #101 ist kein Farbwert\nconst b = '#ffffff';\n";
    const rein = ohneKommentare(probe);
    expect(rein.split('\n').length).toBe(probe.split('\n').length);
    expect(rein).not.toContain('#101');
    expect(rein).toContain('#ffffff');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * REGEL 1 — keine nackte Ebenenzahl
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Stand 26.07.2026: 34 nackte Ebenenzahlen. Nur senken.
 *
 * Die schwersten Orte: `screens/zielkarte/instruments.tsx` (10),
 * die Hülle des ausgezogenen Sprachassistenten (4). Der Rest verteilt sich einzeln.
 * `tokens.css` trägt eine: `z-index: -1` unter der Papierkörnung — die Leiter
 * hat für „hinter allem" bisher keine Stufe, das wäre die erste Ergänzung.
 */
const SCHWELLE_EBENE = 34;

/**
 * WAS EIN MENSCH AM TRESEN DAVON SIEHT
 *
 * Nichts — bis zu dem einen Abend, an dem er es sieht. Dann liegt der
 * Bezahldialog unter dem Kartenleser-Warter, weil beide ihre Ebene selbst
 * gewählt haben und der Warter zufällig die höhere Zahl erwischt hat, oder die
 * Fehlermeldung verschwindet hinter dem Fenster, das sie erklärt. Der Fehler
 * ist zufällig, er hängt davon ab, welche zwei Flächen gerade offen sind, und
 * er ist am Tresen nicht reproduzierbar — die schlimmste Sorte.
 *
 * Die Ebenenleiter in `tokens.css` beantwortet die Frage „liegt A über B?" EIN
 * Mal, an einer Stelle, mit Namen statt Zahlen: basis, klebend, schleier,
 * fenster, anker, stufe, meldung, hinweis. Eine handgetippte 1050 beantwortet
 * sie erneut, im Stillen, ohne die anderen zu kennen.
 */
describe('Regel 1 — jede Ebene kommt aus der Leiter', () => {
  const ausLeiter = (wert: string): boolean => /var\(\s*--w14-z-/.test(wert);

  function nackteEbenen(): Fund[] {
    const funde: Fund[] = [];
    for (const q of QUELLEN) {
      for (const treffer of q.rein.matchAll(/\bzIndex\s*:\s*([^,\n}]+)/g)) {
        const wert = (treffer[1] as string).trim();
        if (ausLeiter(wert)) continue;
        funde.push({
          ort: `${q.kurz}:${zeileVon(q.rein, treffer.index)}`,
          was: `zIndex: ${wert}`,
        });
      }
    }
    for (const s of STILDATEIEN) {
      for (const treffer of s.rein.matchAll(/(?<!-)\bz-index\s*:\s*([^;\n}]+)/g)) {
        const wert = (treffer[1] as string).trim();
        if (ausLeiter(wert)) continue;
        funde.push({
          ort: `${s.kurz}:${zeileVon(s.rein, treffer.index)}`,
          was: `z-index: ${wert}`,
        });
      }
    }
    return funde;
  }

  it('findet die Ebenenleiter selbst — sonst prüft die Regel Luft', () => {
    const leiter = STILDATEIEN.flatMap((s) => [...s.roh.matchAll(/--w14-z-[a-z]+\s*:/g)]);
    expect(leiter.length, 'benannte Stufen der Ebenenleiter').toBeGreaterThanOrEqual(8);
  });

  it('trägt keine NEUE nackte Ebenenzahl', () => {
    const funde = nackteEbenen();
    expect(
      funde.length,
      bericht(
        'Regel 1 — eine Ebene wurde als Zahl getippt statt aus der Leiter genommen.\n' +
          'Richtig ist: zIndex: var(--w14-z-fenster) und die Geschwister davon.',
        funde,
        SCHWELLE_EBENE,
        '26.07.2026',
      ),
    ).toBeLessThanOrEqual(SCHWELLE_EBENE);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * REGEL 2 — keine rohe Farbe im sichtbaren Stil
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * WAS EIN MENSCH AM TRESEN DAVON SIEHT
 *
 * Eine rohe Farbe kennt den Tag-Nacht-Umschalter nicht. `color: '#fff'` auf
 * einer Fläche, die im hellen Aufzug hell wird, ist weiss auf weiss: der Text
 * ist WEG. Genau diese Klasse steckt hinter Basels „Farben durchsichtig, nicht
 * klar" — und sie ist am 25.07.2026 in derselben Kasse schon einmal
 * aufgeschlagen, damals über eine Marke, die es gar nicht gab.
 *
 * Der zweite Schaden ist der leisere: zwölf handgemischte Grüntöne für
 * „in Ordnung" sind zwölf Mal fast dasselbe. Das Auge liest daraus keine
 * Ordnung, sondern Unruhe. Das ist wörtlich die Klage.
 *
 * ── DIE ZWEI AUSNAHMEN, UND WARUM SIE ES SIND ───────────────────────────────
 *
 * 1. DRUCKAUSGABE. Der Bondrucker hat kein Farbsystem und keinen Nachtmodus.
 *    Er hat schwarze Farbe und weisses Papier. Eine Marke, die im Nachtmodus
 *    hell wird, würde auf Papier zu weisser Schrift auf weissem Grund — also
 *    zu einem leeren Beleg, und der Beleg ist Pflicht. Der Papiersimulator
 *    (`ReceiptPreview`, `Belegdesigner`) gehört ausdrücklich dazu: sein Zweck
 *    ist, das PAPIER zu zeigen, nicht die App. Er muss beim Umschalten auf
 *    Nacht gleich bleiben, sonst lügt er.
 *
 * 2. BILDDATEN. Ein Strichcode und ein QR-Code sind keine Gestaltung, sie sind
 *    Messtechnik: der Scanner erwartet reines Schwarz auf reinem Weiss, und
 *    jede Marke dazwischen kostet Kontrast und damit Lesungen. Ebenso das
 *    Google-Zeichen auf der Anmeldetür — seine vier Farben sind von Google
 *    vorgeschrieben; sie nachzumischen wäre ein fremdes Zeichen. Deshalb sind
 *    hier nur diese VIER Werte frei, nicht die ganze Datei.
 */
const DRUCKAUSGABE = [
  // 14.08.2026: rechnung.ts (Abhol-Bestellung) und versandmarke.ts (DHL)
  // standen hier; beide fielen mit dem Kundenshop bei der Trennung.
  'apps/tauri-pos/src/screens/verkauf/ReceiptPreview.tsx',
  'apps/tauri-pos/src/screens/secondary/Belegdesigner.tsx',
  'apps/tauri-pos/src/screens/secondary/Schreiben.tsx',
  // Die Byte-Vorschau des Bons (26.07.2026, Logo-Werk): zeigt PAPIER, nicht
  // die App — Papier-Creme und Tinte muessen beim Nachtmodus gleich bleiben,
  // sonst luegt die Vorschau. Exakt der Fall, den diese Ausnahme beschreibt.
  'apps/tauri-pos/src/components/BonPapierVorschau.tsx',
];

const BILDDATEN = [
  'apps/tauri-pos/src/lib/code128.ts',
  'apps/tauri-pos/src/components/QrBild.tsx',
];

/** Die vier vorgeschriebenen Farben des Google-Zeichens. Nur diese, überall. */
const GOOGLE_ZEICHEN = new Set(['#ea4335', '#4285f4', '#fbbc05', '#34a853']);

/**
 * Stand 26.07.2026: 386 rohe Farben ausserhalb der Ausnahmen. Nur senken.
 *
 * Diese Zahl sieht schlimmer aus, als sie ist, und das ist die wichtigste
 * Auskunft an den, der sie senken will: ZWEI DRITTEL stehen in EINER Datei.
 *
 *     260 × screens/zielkarte/instruments.tsx   (die antike Messtafel)
 *      45 × zwei Flaechen des Sprachassistenten (inzwischen ausgezogen)
 *      21 × app/chrome/ProfileMenu.tsx
 *   (12 × screens/secondary/Fotos.tsx — 19.08.2026 GELOESCHT, tote Flaeche;
 *    die Schwelle ist um genau diese zwoelf gesenkt, keine Gnadenfrist.)
 *
 * Die Messtafel ist gezeichnete Fläche mit eigener Farbwelt. Sie ist deshalb
 * NICHT als Bilddaten freigestellt: ein Strichcode muss schwarz auf weiss sein,
 * damit ein Scanner ihn liest — eine Zierkarte muss gar nichts. Sie ist
 * genau das, was Basel mit „das Design überlagert sich" meint, und sie gehört
 * auf die Marken des Systems geholt wie alles andere.
 */
const SCHWELLE_FARBE = 374;

describe('Regel 2 — keine rohe Farbe im sichtbaren Stil', () => {
  // `(?<!&)` hält HTML-Entitäten heraus: `&#8209;` (der geschützte
  // Bindestrich) steht mehrfach in den Anmeldetexten und sähe sonst wie
  // `#8209` aus, also wie ein Vierstellen-Hexwert. Ein Fehlalarm auf einem
  // Bindestrich hätte diesen Wächter am ersten Tag unglaubwürdig gemacht.
  const HEX = /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
  const FUNKTION = /\b(?:rgba?|hsla?)\s*\(/g;

  function roheFarben(): Fund[] {
    const funde: Fund[] = [];
    const pruefbar = QUELLEN.filter(
      (q) => !DRUCKAUSGABE.includes(q.kurz) && !BILDDATEN.includes(q.kurz),
    );
    for (const q of pruefbar) {
      for (const treffer of q.rein.matchAll(HEX)) {
        const wert = (treffer[0] as string).toLowerCase();
        if (GOOGLE_ZEICHEN.has(wert)) continue;
        funde.push({ ort: `${q.kurz}:${zeileVon(q.rein, treffer.index)}`, was: treffer[0] as string });
      }
      for (const treffer of q.rein.matchAll(FUNKTION)) {
        funde.push({
          ort: `${q.kurz}:${zeileVon(q.rein, treffer.index)}`,
          was: `${treffer[0]}…)`,
        });
      }
    }
    return funde;
  }

  it('die Ausnahmedateien gibt es wirklich', () => {
    // Eine Ausnahme auf einen Pfad, den es nicht mehr gibt, ist ein Loch, das
    // niemand bemerkt: sie schützt dann nichts und niemand räumt sie weg.
    for (const pfad of [...DRUCKAUSGABE, ...BILDDATEN]) {
      expect(
        QUELLEN.some((q) => q.kurz === pfad),
        `Ausnahme zeigt ins Leere: ${pfad}`,
      ).toBe(true);
    }
  });

  it('trägt keine NEUE rohe Farbe', () => {
    const funde = roheFarben();
    expect(
      funde.length,
      bericht(
        'Regel 2 — eine Farbe wurde von Hand gemischt statt aus dem System genommen.\n' +
          'Richtig ist eine Marke: var(--w14-…). Rohe Farben kennen den Nachtmodus nicht.',
        funde,
        SCHWELLE_FARBE,
        '26.07.2026',
      ),
    ).toBeLessThanOrEqual(SCHWELLE_FARBE);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * REGEL 3 — jedes Fenster, das sich Fenster nennt, lässt sich schliessen
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Stand 26.07.2026: 7 Dateien, in denen weniger Rückwege stehen als
 * `aria-modal`-Fenster. Nur senken.
 *
 * Die sieben, vollständig — die Liste ist kurz genug, um sie ganz zu nennen:
 *   components/hardware/CropStudio.tsx
 *   screens/bewertung/AppraisalItemsList.tsx
 *   screens/secondary/Ebay.tsx
 *   screens/secondary/Finanzen.tsx
 *   screens/secondary/Kurse.tsx          (zwei Fenster, nur ein Rückweg)
 *   screens/secondary/WhatsApp.tsx
 *   screens/verkauf/ReceiptPreview.tsx
 *
 * Der kürzeste Weg auf null ist NICHT, siebenmal einen Tastenlauscher zu
 * schreiben, sondern siebenmal `useFensterRahmen` aus `lib/fenster-rahmen.ts`
 * zu benutzen. Der bringt Anfangsfokus, Fokusfang und die Rückgabe des Fokus
 * gleich mit — alles Dinge, die diesen sieben ebenfalls fehlen.
 */
const SCHWELLE_FENSTER = 7;

/**
 * WAS EIN MENSCH AM TRESEN DAVON SIEHT
 *
 * `aria-modal="true"` ist ein VERSPRECHEN an den Browser und an den
 * Vorleser: „ab hier gibt es nur noch mich". Der Browser hält sich daran und
 * sperrt den Rest aus. Wer das Versprechen gibt, muss auch den Rückweg geben —
 * sonst steht der Verkäufer vor einem Fenster, das die ganze Kasse blockiert,
 * und die Taste, die auf JEDEM anderen Rechner der Welt schliesst, tut nichts.
 * Am Tresen, mit einem Kunden davor, ist das der Moment, in dem die App neu
 * gestartet wird.
 *
 * ── GRENZE DIESER MESSUNG, EHRLICH ──────────────────────────────────────────
 * Gezählt wird je DATEI: so viele Escape-Wege wie `aria-modal`-Fenster. Das ist
 * gröber als „jedes Fenster einzeln", und es ist mit Absicht so: eine Datei mit
 * zwei Fenstern und nur einem Escape ist genau der Fall, der in `Kurse.tsx`
 * wirklich steht — das eine Fenster kann man schliessen, das andere nicht.
 * Diese Zählung findet das. Sie kann NICHT finden, ob der eine vorhandene
 * Escape-Weg auch am richtigen Fenster hängt. Dafür braucht es Augen.
 */
describe('Regel 3 — jedes aria-modal hat einen Escape-Weg', () => {
  /**
   * `(?<!\[)` schliesst den SUCHAUSDRUCK aus, nicht das Fenster.
   *
   * `app/chrome/digit-nav.ts` fragt den Browser mit
   * `querySelector('[role="dialog"][aria-modal="true"]')`, ob gerade
   * irgendein Fenster offen ist — das ist die Stelle, die Fenster ZÄHLT, nicht
   * eine, die eines aufmacht. Beim ersten Lauf am 26.07.2026 stand sie als
   * Verstoss in der Liste. Ein Wächter, der die Wache selbst anzeigt, verliert
   * seinen Ruf beim ersten Blick.
   */
  const FENSTER = /(?<!\[)["']?aria-modal["']?\s*[:=]\s*["'{]?\s*true/g;

  /**
   * Ein Rückweg ist NICHT nur ein eigener Tastenlauscher.
   *
   * ── DIE ANNAHME, DIE BEIM MESSEN GEKIPPT IST (26.07.2026) ──────────────────
   * Der erste Entwurf dieser Regel zählte ausschliesslich `'Escape'` im
   * Quelltext der Datei. Beim zweiten Durchlauf, eine halbe Stunde später,
   * sprang die Zahl von 10 auf 15 — und die fünf neuen waren `ZBonDialog`,
   * `AcceptanceDialog`, `CustomerCreateDialog`, `CustomerEditDialog` und
   * `KycCaptureModal`, also ausgerechnet fünf Fenster, die gerade VERBESSERT
   * worden waren. Sie hatten ihren handgebauten Lauscher gegen
   * `useFensterRahmen` getauscht, den gemeinsamen Rahmen aus
   * `lib/fenster-rahmen.ts`, der Escape, Anfangsfokus, Fokusfang und die
   * Rückgabe des Fokus an EINER Stelle löst — und dabei sogar prüft, ob ein
   * obenaufliegendes Fenster die Taste schon behandelt hat.
   *
   * Eine Wache, die den richtigen Weg als Verstoss meldet, erzieht zum
   * falschen. Das ist die schlimmste Art, eine Regel zu verlieren: sie wird
   * nicht abgeschaltet, sie wird befolgt.
   *
   * Gültige Rückwege sind deshalb beide: die Taste selbst lesen, oder den
   * gemeinsamen Rahmen benutzen.
   */
  const AUSGANG = /["']Escape["']|\buseFensterRahmen\s*\(/g;

  function fensterOhneAusgang(): Fund[] {
    const funde: Fund[] = [];
    for (const q of QUELLEN) {
      const fenster = [...q.rein.matchAll(FENSTER)];
      if (fenster.length === 0) continue;
      const ausgaenge = [...q.rein.matchAll(AUSGANG)];
      if (ausgaenge.length >= fenster.length) continue;
      funde.push({
        ort: `${q.kurz}:${zeileVon(q.rein, (fenster[0] as RegExpExecArray).index)}`,
        was: `${fenster.length} × aria-modal, aber nur ${ausgaenge.length} × Rückweg (Escape oder useFensterRahmen)`,
      });
    }
    return funde;
  }

  it('findet überhaupt Fenster — sonst prüft die Regel Luft', () => {
    const mitFenster = QUELLEN.filter((q) => {
      FENSTER.lastIndex = 0;
      return FENSTER.test(q.rein);
    });
    expect(mitFenster.length, 'Dateien mit aria-modal').toBeGreaterThan(15);
  });

  it('hält den Suchausdruck für offene Fenster heraus', () => {
    // Rot-Grün im Kleinen für die Ausnahme oben: der Selektor darf NICHT als
    // Fenster gelten, das echte Merkmal am Element schon.
    const selektor = `doc.querySelector('[role="dialog"][aria-modal="true"]')`;
    expect([...selektor.matchAll(FENSTER)]).toHaveLength(0);
    expect([...'<div role="dialog" aria-modal="true">'.matchAll(FENSTER)]).toHaveLength(1);
  });

  it('lässt kein NEUES Fenster ohne Rückweg zu', () => {
    const funde = fensterOhneAusgang();
    expect(
      funde.length,
      bericht(
        'Regel 3 — ein Fenster sperrt die Kasse aus und gibt keine Taste zurück.\n' +
          'Richtig ist: die Escape-Taste schliesst, oder es benutzt den Dialog des Baukastens.',
        funde,
        SCHWELLE_FENSTER,
        '26.07.2026',
      ),
    ).toBeLessThanOrEqual(SCHWELLE_FENSTER);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * REGEL 4 — keine Zielfläche unter 44 Pixel
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Stand 26.07.2026: 39 festgesetzte Zielflächen unter 44 Pixel. Nur senken.
 *
 * Es sind weniger Stellen als 39: eine Schaltung mit `width: 36, height: 36`
 * zählt zweimal, weil beide Kanten zu klein sind. Das ist Absicht — wer nur
 * eine der beiden Kanten repariert, hat die Fläche nicht repariert.
 *
 * Die dichteste Gruppe steht in der Kopfzeile, die auf JEDEM Bildschirm
 * mitläuft: `ThemeToggle`, `SupportButton`, `UpdateButton` und zwei Schaltungen
 * in `AppShellHeader` sind alle 36 × 36. Fünf Ziele, die den ganzen Tag da sind
 * und alle acht Pixel zu klein — das ist der lohnendste erste Griff.
 */
const SCHWELLE_ZIEL = 39;

/** Ab hier ist eine Fläche mit dem Finger sicher zu treffen. */
const MINDESTKANTE = 44;

/**
 * WAS EIN MENSCH AM TRESEN DAVON SIEHT
 *
 * Diese Kasse ist ein 21-Zoll-Berührungsbildschirm, keine Maus. Eine Schaltung
 * von 28 Pixel Kantenlänge ist mit einem Zeiger ein Klick und mit einem Daumen
 * ein Glücksspiel — besonders für den, der nebenher mit einem Kunden spricht.
 * Der Verkäufer merkt nicht „das Ziel ist zu klein", er merkt „die Kasse
 * reagiert manchmal nicht" und drückt fester. 44 Pixel ist die Kante, unter der
 * das anfängt.
 *
 * ── WIE GEMESSEN WIRD ───────────────────────────────────────────────────────
 * Gelesen wird nur die ÖFFNENDE Marke eines bedienbaren Elements, also von
 * `<button` bis zu ihrem eigenen `>`. Alles darin Verschachtelte gehört einem
 * anderen Element: ein 16-Pixel-Zeichen INNERHALB einer 48-Pixel-Schaltung ist
 * völlig richtig und darf kein Fehlalarm sein. Deshalb zählen Zeichenflächen
 * (svg, path, Icon…) hier nie als Ziel, auch nicht mit einem Klickgriff.
 *
 * Gemeldet wird nur, wo eine Zahl WIRKLICH FESTSTEHT. `width: '100%'` oder eine
 * gerechnete Höhe sagen nichts über das Ergebnis aus und werden übergangen —
 * lieber schweigen als raten.
 */
describe('Regel 4 — keine Zielfläche unter 44 Pixel', () => {
  const ZEICHENFLAECHE = /^(svg|path|rect|circle|line|polyline|polygon|g|defs|image|Icon)/;
  const KLICKGRIFF = /\bon(?:Click|PointerDown|MouseDown|TouchStart)\s*=/;
  const BEDIENBAR = /^(button|a|input|select|textarea|summary|label)$/;
  const MASS = /\b(minHeight|minWidth|height|width)\s*:\s*'?(\d+(?:\.\d+)?)(?:px)?'?\s*[,}]/g;

  /**
   * Der einzige Grund, warum eine bedienbare Marke ABSICHTLICH ein Pixel gross
   * ist: sie soll für das Auge verschwinden und nur für den Vorleser da sein.
   *
   * `components/SuchFeld.tsx` macht genau das richtig — der Name des Suchfelds
   * steht in einem `<label>` mit `position: absolute, width: 1, height: 1,
   * clip: rect(0 0 0 0)`. Sichtbar ist er nicht, vorgelesen wird er, und
   * angetippt wird er nie. Beim ersten Lauf am 26.07.2026 war das der
   * meistgemeldete Verstoss dieser Regel, obwohl es das Gegenteil eines
   * Verstosses ist.
   *
   * `clip` ist das verlässliche Erkennungszeichen: die Eigenschaft ist sonst
   * überall abgekündigt und lebt nur noch in genau diesem Kunstgriff weiter.
   */
  const NUR_FUER_DEN_VORLESER = /\bclip(?:Path)?\s*:/;

  /**
   * Die öffnende Marke ab einem `<`: bis zum ersten `>`, das WEDER in einer
   * Zeichenkette noch in einer geschweiften Klammer steht. Ohne diese Zählung
   * würde `onClick={() => tu()}` die Marke beim Pfeil abschneiden.
   */
  function markeAb(text: string, start: number): string | null {
    let tiefe = 0;
    let anfuehrung: string | null = null;
    for (let i = start; i < text.length && i - start < 4000; i += 1) {
      const z = text[i] as string;
      if (anfuehrung) {
        if (z === '\\') i += 1;
        else if (z === anfuehrung) anfuehrung = null;
        continue;
      }
      if (z === "'" || z === '"' || z === '`') anfuehrung = z;
      else if (z === '{') tiefe += 1;
      else if (z === '}') tiefe -= 1;
      else if (z === '>' && tiefe <= 0) return text.slice(start, i + 1);
    }
    return null;
  }

  function zuKleineZiele(): Fund[] {
    const funde: Fund[] = [];
    for (const q of QUELLEN) {
      if (!q.datei.endsWith('.tsx')) continue;
      for (const auf of q.rein.matchAll(/<([A-Za-z][A-Za-z0-9.]*)/g)) {
        const name = auf[1] as string;
        if (ZEICHENFLAECHE.test(name)) continue;
        const marke = markeAb(q.rein, auf.index);
        if (!marke) continue;
        const istZiel =
          BEDIENBAR.test(name) || KLICKGRIFF.test(marke) || /role\s*=\s*["']button["']/.test(marke);
        if (!istZiel) continue;
        if (NUR_FUER_DEN_VORLESER.test(marke)) continue;
        for (const mass of marke.matchAll(MASS)) {
          const kante = Number(mass[2]);
          if (!Number.isFinite(kante) || kante >= MINDESTKANTE) continue;
          // Null ist keine Grösse, sondern eine ERLAUBNIS: `minWidth: 0` und
          // `minHeight: 0` heben in einem Flex-Kasten die eingebaute
          // Mindestgrösse auf, damit lange Namen abgeschnitten werden statt die
          // Zeile aufzublähen. Das sagt über die Zielfläche gar nichts aus —
          // die ergibt sich dann aus dem Inhalt. Beim ersten Lauf am
          // 26.07.2026 waren das vier der zehn gezeigten Funde, darunter die
          // Karte des Bezahlfensters, die niemand antippt.
          if (kante === 0) continue;
          funde.push({
            ort: `${q.kurz}:${zeileVon(q.rein, auf.index)}`,
            was: `<${name} … ${mass[1]}: ${mass[2]} — unter ${MINDESTKANTE}`,
          });
        }
      }
    }
    return funde;
  }

  it('erkennt bedienbare Marken überhaupt', () => {
    // Kippt der Marken-Leser, wäre die Regel still grün. Also erst beweisen,
    // dass er in der lebenden Kasse Tausende Schaltungen findet.
    const schaltungen = QUELLEN.filter((q) => q.datei.endsWith('.tsx')).reduce(
      (n, q) => n + [...q.rein.matchAll(/<button\b/g)].length,
      0,
    );
    expect(schaltungen, 'gefundene <button> in der Kasse').toBeGreaterThan(100);
  });

  it('erkennt eine zu kleine Schaltung an einer bekannten Probe', () => {
    // Rot-Grün im Kleinen: der Leser muss an einem Beispiel, dessen Antwort
    // feststeht, das Richtige tun — sonst sagt eine grüne Zählung nichts.
    const probe = "<button style={{ height: 30, width: '100%' }} onClick={() => f()}>Ja</button>";
    const marke = markeAb(probe, 0);
    expect(marke).toContain('height: 30');
    expect(marke).not.toContain('Ja');
    const treffer = [...(marke as string).matchAll(MASS)].map((m) => Number(m[2]));
    expect(treffer).toEqual([30]);
  });

  it('lässt die Marke in Ruhe, die nur der Vorleser sieht', () => {
    // Rot-Grün im Kleinen für die Ausnahme oben.
    const versteckt =
      "<label style={{ position: 'absolute', width: 1, height: 1, clip: 'rect(0 0 0 0)' }}>";
    expect(NUR_FUER_DEN_VORLESER.test(versteckt)).toBe(true);
    expect(NUR_FUER_DEN_VORLESER.test('<button style={{ width: 36, height: 36 }}>')).toBe(false);
  });

  it('setzt keine NEUE Zielfläche unter 44 Pixel', () => {
    const funde = zuKleineZiele();
    expect(
      funde.length,
      bericht(
        `Regel 4 — eine bedienbare Fläche ist fest auf weniger als ${MINDESTKANTE} Pixel gesetzt.\n` +
          'Am Berührungsbildschirm heisst das: sie wird manchmal nicht getroffen.',
        funde,
        SCHWELLE_ZIEL,
        '26.07.2026',
      ),
    ).toBeLessThanOrEqual(SCHWELLE_ZIEL);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * REGEL 5 — kein Unterstrich in deutschem Oberflächentext
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Stand 26.07.2026: NULL. Diese Regel ist die einzige, die heute schon dort
 * steht, wo alle hin sollen — jeder neue Unterstrich macht sie sofort rot.
 *
 * Sie kam nicht von selbst dorthin: die Kasse hat mehrere Durchgänge hinter
 * sich, in denen Rohwerte einzeln in deutsche Sätze übersetzt wurden. Ohne
 * diese Wache wäre der nächste Rückfall wieder unbemerkt geblieben, denn ein
 * durchgereichter Fehlercode sieht im Quelltext völlig harmlos aus.
 */
const SCHWELLE_UNTERSTRICH = 0;

/**
 * WAS EIN MENSCH AM TRESEN DAVON SIEHT
 *
 * Ein Unterstrich in sichtbarem Text ist fast immer ein Rohwert, der durchs
 * Netz gerutscht ist: `PAYMENT_FAILED` statt „Die Zahlung wurde abgelehnt",
 * `NOT_FOUND` statt „Nicht gefunden". Der Verkäufer liest dann die Sprache der
 * Datenbank, mitten im Verkauf, und weiss nicht, ob das ein Fehler oder ein
 * Zustand ist. Genau diese Klasse wurde in dieser Kasse schon mehrfach
 * einzeln beseitigt; hier wird sie festgehalten.
 *
 * Für Basel ist der Unterstrich zusätzlich eine harte Regel in JEDEM sichtbaren
 * Text, unabhängig davon, ob er aus einem Rohwert stammt.
 *
 * ── WAS GELESEN WIRD ────────────────────────────────────────────────────────
 * Zwei Orte, an denen Text WIRKLICH auf dem Bildschirm landet:
 *   • der Text zwischen zwei Marken (`>Guten Morgen<`), und
 *   • die Eigenschaften, die sichtbaren Text tragen: label, title,
 *     placeholder, aria-label.
 * Nicht gelesen werden Namen von Dingen — Schlüssel, Pfade, Datenbankfelder,
 * Ereignisnamen. Solche Namen tragen ihre Unterstriche zu Recht, sie stehen auf
 * keinem Bildschirm, und sie zu melden hiesse, die Regel mit Lärm zu ertränken,
 * bis niemand mehr hinsieht.
 *
 * ── DIE EINE AUSNAHME ───────────────────────────────────────────────────────
 * Basels Regel lässt genau einen Fall zu: einen unvermeidbaren Bezeichner, der
 * seine Schreibweise behalten MUSS, und dann ausdrücklich als Code ausgezeichnet,
 * damit er nicht als Prosa gelesen wird.
 *
 * In der Kasse gibt es diesen Fall wirklich, im leeren WhatsApp-Fach: dort
 * stehen die zwei Namen, die Basel bei Meta eintragen muss. Sie ohne
 * Unterstrich zu schreiben hiesse, ihm einen Namen zu nennen, den es nicht
 * gibt — das wäre nicht höflicher, sondern falsch. Sie stehen deshalb in einer
 * Code-Auszeichnung.
 *
 * Die Ausnahme ist bewusst eng: nur wenn der Text VOLLSTÄNDIG ein
 * Grossbuchstaben-Bezeichner ist UND unmittelbar in `<em> <code> <kbd> <samp>`
 * steht. Ein durchgerutschtes `PAYMENT_FAILED` in einem gewöhnlichen `<span>`
 * fällt weiterhin durch, und ein deutscher Satz mit einem Unterstrich darin
 * ebenfalls.
 */
describe('Regel 5 — kein Unterstrich in deutschem Oberflächentext', () => {
  const TEXTPROP = /\b(label|title|placeholder|aria-label)\s*=\s*"([^"]{2,200})"/g;
  // Text zwischen zwei Marken. Er muss mindestens einen Buchstaben tragen,
  // sonst ist es Einrückung, ein Trennstrich oder eine Zahl. Zeilenumbrüche
  // sind erlaubt, weil der Formatierer lange Sätze umbricht — beim ersten Lauf
  // am 26.07.2026 hat die zeilengebundene Fassung nur 261 statt 1000 Knoten
  // gefunden, also den grössten Teil der Oberfläche gar nicht gelesen.
  const TEXTKNOTEN = />([^<>{}]*[A-Za-zÄÖÜäöüß][^<>{}]*)</g;
  const ALS_CODE_AUSGEZEICHNET = /<(?:em|code|kbd|samp)\s*>$/;
  const BEZEICHNER = /^[A-Z][A-Z0-9_]*$/;

  /**
   * Was aussieht wie Text zwischen zwei Marken, aber keiner ist.
   *
   * ── DER FEHLALARM, DER DIESE ZEILE ERZWUNGEN HAT (26.07.2026) ─────────────
   * TypeScript schreibt eine Typangabe in dieselben spitzen Klammern wie JSX
   * eine Marke. In
   *
   *     const [art, setArt] = useState<ItemType>('gold_jewelry');
   *     const [zustand, setZustand] = useState<Condition>('USED_GOOD');
   *
   * schliesst das `>` von `useState<ItemType>` scheinbar eine Marke, das `<`
   * der nächsten Zeile öffnet scheinbar die nächste — und dazwischen liegt
   * gewöhnlicher Quelltext, der Unterstriche trägt. Die Zahl sprang dadurch von
   * 2 auf 28, und alle 26 neuen waren erfunden. Ein Wächter mit 26 erfundenen
   * Funden ist schlimmer als keiner: er verbrennt die Aufmerksamkeit, die die
   * zwei echten gebraucht hätten.
   *
   * Echter Oberflächentext trägt niemals `;`, `=`, `(` oder `)`. Wo diese
   * Zeichen stehen, liest die Wache Quelltext und schweigt.
   *
   * PREIS, EHRLICH: damit entgeht ihr auch echter Text mit Klammern, etwa
   * „Preis (brutto)". Das ist der richtige Tausch — die Wache soll lieber eine
   * Stelle übersehen als eine erfinden.
   */
  const IST_QUELLTEXT = /[;=()[\]`]/;

  function unterstricheImText(): Fund[] {
    const funde: Fund[] = [];
    for (const q of QUELLEN) {
      if (!q.datei.endsWith('.tsx')) continue;
      const melde = (versatz: number, text: string, alsCode: boolean): void => {
        if (!text.includes('_')) return;
        if (IST_QUELLTEXT.test(text)) return;
        if (alsCode && BEZEICHNER.test(text.trim())) return;
        funde.push({ ort: `${q.kurz}:${zeileVon(q.rein, versatz)}`, was: text.trim() });
      };
      for (const t of q.rein.matchAll(TEXTPROP)) melde(t.index, t[2] as string, false);
      for (const t of q.rein.matchAll(TEXTKNOTEN)) {
        // Die öffnende Marke steht unmittelbar vor dem `>`, an dem der Textknoten
        // beginnt — acht Zeichen reichen für `<samp>` und seine Geschwister.
        const davor = q.rein.slice(Math.max(0, t.index - 7), t.index + 1);
        melde(t.index, t[1] as string, ALS_CODE_AUSGEZEICHNET.test(davor));
      }
    }
    return funde;
  }

  it('liest überhaupt Oberflächentext', () => {
    // Ohne diese Zusicherung wäre ein kaputter Ausdruck eine grüne Null.
    const menge = QUELLEN.filter((q) => q.datei.endsWith('.tsx')).reduce(
      (n, q) => n + [...q.rein.matchAll(TEXTKNOTEN)].filter((t) => !IST_QUELLTEXT.test(t[1] as string)).length,
      0,
    );
    expect(menge, 'gelesene Textknoten').toBeGreaterThan(500);
  });

  it('erkennt einen Unterstrich an einer bekannten Probe', () => {
    const probe = '<span>Zahlung PAYMENT_FAILED</span>';
    const treffer = [...probe.matchAll(TEXTKNOTEN)].map((m) => m[1]);
    expect(treffer).toEqual(['Zahlung PAYMENT_FAILED']);
  });

  it('unterscheidet den ausgezeichneten Bezeichner vom durchgerutschten Rohwert', () => {
    // Rot-Grün im Kleinen für die Ausnahme: sie darf GENAU den einen Fall
    // durchlassen und keinen Schritt weiter.
    expect(ALS_CODE_AUSGEZEICHNET.test('und <em>')).toBe(true);
    expect(ALS_CODE_AUSGEZEICHNET.test('<span>')).toBe(false);
    expect(BEZEICHNER.test('WHATSAPP_VERIFY_TOKEN')).toBe(true);
    expect(BEZEICHNER.test('Fehler: PAYMENT_FAILED')).toBe(false);
  });

  it('hält eine Typangabe für Quelltext, nicht für Oberflächentext', () => {
    // Rot-Grün im Kleinen für die Falle mit den spitzen Klammern.
    const quelltext = "('gold_jewelry');\n  const [art, setArt] = useState";
    expect(IST_QUELLTEXT.test(quelltext)).toBe(true);
    expect(IST_QUELLTEXT.test('Zahlung PAYMENT_FAILED')).toBe(false);
  });

  it('zeigt keinen Unterstrich auf dem Bildschirm', () => {
    const funde = unterstricheImText();
    expect(
      funde.length,
      bericht(
        'Regel 5 — ein Unterstrich steht in sichtbarem Text.\n' +
          'Fast immer ist das ein Rohwert aus der Datenbank statt eines deutschen Satzes.',
        funde,
        SCHWELLE_UNTERSTRICH,
        '26.07.2026',
      ),
    ).toBeLessThanOrEqual(SCHWELLE_UNTERSTRICH);
  });
});

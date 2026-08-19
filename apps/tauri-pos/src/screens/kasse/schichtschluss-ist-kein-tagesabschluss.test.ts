/**
 * ⛔ WÄCHTER: Der Schichtschluss darf sich NIE wieder Tagesabschluss nennen.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER GEMESSENE BEFUND VOM 13.08.2026
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `closingsApi.finalize` — der Abschluss des Kassentags, der die Zeile in
 * `daily_closings` schreibt — hatte in der ganzen Kasse NULL Aufrufer. Einziger
 * Aufrufer im Baum war die Inhaber-App (`apps/mobile/src/warehouse14/api.ts`).
 *
 * Was die Kasse „Tagesabschluss" nannte, war `shiftsApi.close`, der
 * SCHICHTSCHLUSS:
 *   • `ZBonDialog.tsx:224`         Überschrift „Tagesabschluss · Blindsturz"
 *   • `ZBonDialog.tsx:304`         Knopf „Schließen und Z-Bon ausgeben"
 *   • `ZBonDialog.tsx:91`          Meldung „Z-Bon ausgegeben"
 *   • `KassenbuchPanel.tsx:230`    Überschrift „Tagesabschluss"
 *   • `KassenbuchPanel.tsx:245`    „Der Z-Bon ist der gesetzliche
 *                                   Tagesabschluss nach KassenSichV."
 *   • `KassenbuchPanel.tsx:259`    Knopf „Tag abschließen"
 *   • `KassePurposeBanner.tsx:74`  „den Z-Bon ausgeben, den gesetzlichen
 *                                   Tagesabschluss"
 *
 * Folge am Tresen: der Händler schloss abends die Schicht, las die
 * Erfolgsmeldung und ging nach Hause. Es entstand KEINE Zeile in
 * `daily_closings` — also kein DSFinV-K, kein DATEV, kein Kassenbericht für
 * diesen Tag. § 146 Abs. 1 Satz 2 AO verlangt den Abschluss; die Fläche
 * behauptete, er sei bereits erledigt.
 *
 * ── WAS DIESER WÄCHTER PRÜFT UND WAS BEWUSST NICHT ────────────────────────
 *
 * Er verbietet NICHT das Wort „Tagesabschluss" auf einer Schichtfläche. Der
 * Satz „Der Tagesabschluss folgt noch" ist genau die Wahrheit, die vorher
 * fehlte — ein Wächter, der eine Verbesserung rot macht, erzieht zum
 * Rückbau. Geprüft werden deshalb zwei Dinge, die die Lüge tragen:
 *
 *   1. BEHAUPTUNGEN — die Datei, die `shiftsApi.close` ruft, darf sich nicht
 *      auf Gesetz, Z-Bon oder Kassensicherungsverordnung berufen.
 *   2. BESCHRIFTUNGEN — was auf einem Knopf steht, muss dem entsprechen, was
 *      der Knopf tut.
 *
 * Und zwei Dinge, die „gebaut ist nicht angeschlossen" verhindern:
 *
 *   3. Der echte Tagesabschluss wird aus dem Erzeugniscode WIRKLICH gerufen.
 *   4. Er ist von einer Fläche aus erreichbar — und zwar von der Fläche OHNE
 *      offene Schicht, denn genau das verlangt der Server
 *      (`closings-finalize.ts:289`, 409 solange eine Kasse offen ist).
 *
 * ── ⚠️ ZWEI LÖCHER, NACHGEMESSEN AM 13.08.2026 ────────────────────────────
 *
 * Die erste Fassung dieses Wächters hatte zwei blinde Flecken, und in beiden
 * lebte die Lüge weiter:
 *
 *   A. `KassePurposeBanner.tsx` — vom Bericht selbst als dritte Lügenstelle
 *      genannt — ruft weder `shiftsApi.close` noch zeichnet sie das
 *      Schichtschlussfenster. Sie fiel durch beide Filter und wurde NICHT
 *      gelesen. Jetzt zählt auch als Schichtfläche, wer den Kassentag hinter
 *      dem Fragezeichen ERKLÄRT (`ERKLAEREN_DEN_KASSENTAG`).
 *
 *   B. Gelesen wurde nur der Ordner `kasse/`. `werkstatt/DayControl.tsx:86`
 *      zeigte bei offener Schicht weiter „Tag abschließen" — den Knopf, der
 *      zum SCHICHTSCHLUSS führt. Jetzt werden alle Bildschirme rekursiv
 *      eingesammelt (`ALLE_FLAECHEN`), ohne Namensliste.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
/** Alle Bildschirme der Kasse — nicht nur die Tageskasse. */
const ALLE_BILDSCHIRME = dirname(HIER);

/** Quelltext ohne Kommentare — Erklärungen sind keine Bildschirmtexte. */
function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

interface Quelle {
  datei: string;
  rein: string;
}

const QUELLEN: Quelle[] = readdirSync(HIER)
  .filter((n) => n.endsWith('.tsx') && !n.includes('.test.'))
  .sort()
  .map((datei) => ({ datei, rein: ohneKommentare(readFileSync(join(HIER, datei), 'utf8')) }));

/**
 * Jede Fläche der ganzen Kasse, rekursiv eingesammelt.
 *
 * ⚠️ KEINE Namensliste. Der nachgemessene Befund vom 13.08.2026: der Wächter
 * las nur den Ordner `kasse/`, während die Werkstatt (`werkstatt/DayControl.tsx`)
 * bei offener Schicht weiter den Knopf „Tag abschließen" zeigte — der nach
 * `/kasse` führt, wo der SCHICHTSCHLUSS wartet. Ein Wächter mit Namensliste
 * wird blind, sobald jemand eine neue Fläche baut; deshalb wird gelesen, was
 * wirklich im Baum liegt.
 */
function sammleFlaechen(ordner: string): Quelle[] {
  const gefunden: Quelle[] = [];
  for (const eintrag of readdirSync(ordner).sort()) {
    const pfad = join(ordner, eintrag);
    if (statSync(pfad).isDirectory()) {
      gefunden.push(...sammleFlaechen(pfad));
      continue;
    }
    if (!eintrag.endsWith('.tsx') || eintrag.includes('.test.')) continue;
    gefunden.push({ datei: eintrag, rein: ohneKommentare(readFileSync(pfad, 'utf8')) });
  }
  return gefunden;
}

const ALLE_FLAECHEN: Quelle[] = sammleFlaechen(ALLE_BILDSCHIRME);

/**
 * Die Schichtflächen: die Datei, die den Schichtschluss wirklich bucht, UND
 * jede Fläche, die dieses Fenster öffnet.
 *
 * ⚠️ Die zweite Hälfte ist nicht Beiwerk. Der schlimmste Satz des Befundes
 * stand NICHT im Fenster, sondern auf der Fläche daneben
 * (`KassenbuchPanel.tsx:245`: „Der Z-Bon ist der gesetzliche Tagesabschluss
 * nach KassenSichV"). Ein Wächter, der nur den Buchenden liest, hätte genau
 * ihn durchgelassen.
 */
const SCHICHT_SCHLIESSER = QUELLEN.filter(
  (q) => /shiftsApi\.close\s*\(/.test(q.rein) || q.rein.includes('<SchichtschlussDialog'),
);

/** Bucht diese Fläche den Kassentag wirklich? */
function buchtDenKassentag(q: Quelle): boolean {
  return /closingsApi\.finalize\s*\(/.test(q.rein);
}

/** Die `<InfoPunkt … />`-Blöcke — der Text hinter dem Fragezeichen. */
function infoPunkte(rein: string): string[] {
  return rein.match(/<InfoPunkt\b[\s\S]*?\/>/g) ?? [];
}

/**
 * DIE ERKLÄRFLÄCHEN — das dritte Loch des ursprünglichen Wächters.
 *
 * ── DER NACHGEMESSENE BEFUND VOM 13.08.2026 ────────────────────────────────
 *
 * Der Bericht nannte `KassePurposeBanner.tsx:74` selbst als dritte Lügenstelle:
 * „Am Abend bar zählen und den Z-Bon ausgeben, den gesetzlichen
 * Tagesabschluss." Diese Datei ruft weder `shiftsApi.close` noch zeichnet sie
 * das Schichtschlussfenster — sie fiel also durch BEIDE Filter und wurde vom
 * Wächter überhaupt nicht gelesen. Ausgerechnet die Fläche, die dem Händler
 * den Kassentag ERKLÄRT, war ungeschützt.
 *
 * Erklärt wird hinter dem Fragezeichen. Gesucht wird deshalb nach dem
 * Fragezeichen selbst, nicht nach Dateinamen.
 *
 * ⚠️ Diese Flächen kommen bewusst NUR zur Behauptungs-Prüfung dazu, nicht zur
 * Beschriftungs-Prüfung. Im Erklärtext MUSS der Tagesabschluss vorkommen
 * dürfen — „Zuletzt den Tagesabschluss buchen" ist genau die Wahrheit, die
 * vorher fehlte. Ein Wächter, der sie rot macht, erzieht zum Rückbau.
 */
const ERKLAEREN_DEN_KASSENTAG = QUELLEN.filter((q) =>
  infoPunkte(q.rein).some((block) => /Kassentag|Tageskasse/.test(block)),
);

/** Alles, was neben dem Schichtschluss steht oder ihn erklärt. */
const SCHICHT_FLAECHEN = [...new Set([...SCHICHT_SCHLIESSER, ...ERKLAEREN_DEN_KASSENTAG])].filter(
  (q) => !buchtDenKassentag(q),
);

/**
 * Alles, was als Beschriftung auf dem Bildschirm landet: Knopfaufschriften,
 * Überschriften, Schmuckleisten mit Titel, zugängliche Namen, der Text hinter
 * dem Fragezeichen (`InfoPunkt text=…`) und die Titel der Hinweismeldungen.
 */
function beschriftungen(rein: string): string[] {
  const gefunden: string[] = [];
  const muster: RegExp[] = [
    /<Button\b[\s\S]*?<\/Button>/g,
    /<h[1-3]\b[\s\S]*?<\/h[1-3]>/g,
    /\b(?:aria-label|ariaLabel|label|title|text)\s*=\s*(?:"[^"]*"|'[^']*'|\{\s*['"][^'"]*['"]\s*\})/g,
    /\btitle:\s*(?:'[^']*'|"[^"]*"|`[^`]*`)/g,
  ];
  for (const m of muster) gefunden.push(...(rein.match(m) ?? []));
  return gefunden;
}

/** Der `<Button …>…</Button>`-Block, der diesen Umschalter setzt. */
function knopfMit(rein: string, aufruf: string): string | null {
  for (const block of rein.match(/<Button\b[\s\S]*?<\/Button>/g) ?? []) {
    if (block.includes(aufruf)) return block;
  }
  return null;
}

describe('⛔ Schichtschluss ist kein Tagesabschluss', () => {
  it('findet die Kassenflächen überhaupt (sonst prüft der Wächter Luft)', () => {
    expect(QUELLEN.length, 'Kassenflächen gefunden').toBeGreaterThanOrEqual(6);
    expect(
      SCHICHT_SCHLIESSER.map((q) => q.datei),
      'Keine Fläche ruft `shiftsApi.close` — dann prüfen die Sätze unten nichts.',
    ).not.toEqual([]);
  });

  it('⛔ auch die ERKLÄRFLÄCHE der Tageskasse wird wirklich mitgelesen', () => {
    // Der Bericht nannte `KassePurposeBanner.tsx:74` als dritte Lügenstelle,
    // und genau sie fiel durch beide Filter des ersten Wächters.
    expect(
      ERKLAEREN_DEN_KASSENTAG.map((q) => q.datei),
      'Keine Fläche erklärt den Kassentag hinter einem Fragezeichen. Entweder ' +
        'ist die Erklärung verschwunden, oder sie steht nicht mehr in einem ' +
        '`InfoPunkt` — in beiden Fällen misst dieser Wächter Luft.',
    ).toContain('KassePurposeBanner.tsx');
  });

  it('die Schichtfläche beruft sich auf kein Gesetz und keinen Z-Bon', () => {
    const verboten = /Z-Bon|KassenSichV|gesetzlich/;
    const funde = SCHICHT_FLAECHEN.filter((q) => verboten.test(q.rein)).map((q) => q.datei);
    expect(
      funde,
      'Diese Fläche schliesst die Schicht oder erklärt den Kassentag, bucht ihn ' +
        'aber nicht. Der Z-Bon und jeder Gesetzesbezug gehören dem Tagesabschluss ' +
        '(`closingsApi.finalize`). Genau diese Verwechslung liess den Händler mit ' +
        'einem NICHT abgeschlossenen Kassentag nach Hause gehen.',
    ).toEqual([]);
  });

  it('⛔ und die Erklärung hört nicht beim Schichtschluss auf', () => {
    const funde: string[] = [];
    for (const q of ERKLAEREN_DEN_KASSENTAG) {
      for (const block of infoPunkte(q.rein)) {
        if (!/Kassentag|Tageskasse/.test(block)) continue;
        if (!/Tagesabschluss|Abschluss des Kassentags/.test(block)) funde.push(q.datei);
      }
    }
    expect(
      funde,
      'Diese Erklärung führt durch den Kassentag, nennt aber seinen Abschluss ' +
        'nicht. Genau so sah sie vor dem 13.08.2026 aus: der letzte Schritt war ' +
        'das Zählen und Schliessen der Schicht, und der Händler ging nach Hause. ' +
        'Ohne Zeile in `daily_closings` gibt es für den Tag kein DSFinV-K, kein ' +
        'DATEV und keinen Kassenbericht (§ 146 Abs. 1 Satz 2 AO).',
    ).toEqual([]);
  });

  it('keine Beschriftung der Schichtfläche nennt den Tagesabschluss', () => {
    const funde: string[] = [];
    for (const q of SCHICHT_SCHLIESSER) {
      for (const text of beschriftungen(q.rein)) {
        if (/Tagesabschluss|Z-Bon/.test(text)) funde.push(`${q.datei}: ${text.trim()}`);
      }
    }
    expect(
      funde,
      'Eine Überschrift oder ein Knopf der Schichtfläche trägt den Namen des ' +
        'Tagesabschlusses. Im Fliesstext darf er stehen („der Tagesabschluss folgt ' +
        'noch") — auf einer Beschriftung ist er eine Zusage, die dieser Knopf ' +
        'nicht einlöst.',
    ).toEqual([]);
  });

  it('jeder Knopf sagt, was er wirklich tut', () => {
    const schicht = QUELLEN.map((q) => knopfMit(q.rein, 'setSchichtschlussOffen(true)')).find(
      (b) => b !== null,
    );
    expect(schicht, 'Kein Knopf öffnet den Schichtschluss.').toBeTruthy();
    expect(schicht, 'Der Knopf zum Schichtschluss nennt den Tagesabschluss.').not.toMatch(
      /Tagesabschluss|Z-Bon|Tag abschließen/,
    );
    expect(schicht, 'Der Knopf zum Schichtschluss sagt nicht, dass es um die Schicht geht.').toMatch(
      /Schicht/,
    );

    const tag = QUELLEN.map((q) => knopfMit(q.rein, 'setTagesabschlussOffen(true)')).find(
      (b) => b !== null,
    );
    expect(tag, 'Kein Knopf öffnet den Tagesabschluss.').toBeTruthy();
    expect(tag, 'Der Knopf zum Tagesabschluss nennt ihn nicht beim Namen.').toMatch(
      /Tagesabschluss|Kassentag/,
    );
    expect(tag, 'Der Knopf zum Tagesabschluss spricht von der Schicht.').not.toMatch(/Schicht/);
  });

  it('⛔ KEINE Fläche im Baum verspricht den Tagesabschluss, ohne ihn zu buchen', () => {
    // ── DER NACHGEMESSENE BEFUND VOM 13.08.2026 ────────────────────────────
    // `werkstatt/DayControl.tsx:86` zeigte bei OFFENER Schicht den Knopf
    // „Tag abschließen". Er führt nach `/kasse`, und dort wartet der
    // SCHICHTSCHLUSS. Die Kasse war gerichtet, die Werkstatt log weiter —
    // eine verschobene Lüge ist keine behobene Lüge.
    const versprechen = /Tag abschließen|Tag abschliessen|Tagesabschluss/;
    const funde: string[] = [];
    for (const q of ALLE_FLAECHEN) {
      const darf = buchtDenKassentag(q) || /<TagesabschlussDialog/.test(q.rein);
      if (darf) continue;
      for (const knopf of q.rein.match(/<Button\b[\s\S]*?<\/Button>/g) ?? []) {
        if (versprechen.test(knopf)) funde.push(`${q.datei}: ${knopf.trim()}`);
      }
    }
    expect(
      funde,
      'Dieser Knopf trägt den Namen des Tagesabschlusses, aber seine Fläche ' +
        'bucht ihn nicht und öffnet auch nicht das Fenster, das ihn bucht. Wer ' +
        'ihn drückt, landet beim Schichtschluss und hält den Kassentag danach ' +
        'für erledigt.',
    ).toEqual([]);
  });

  it('findet dabei überhaupt Flächen ausserhalb der Tageskasse', () => {
    expect(ALLE_FLAECHEN.length, 'Bildschirme im Baum').toBeGreaterThan(QUELLEN.length);
    expect(
      ALLE_FLAECHEN.map((q) => q.datei),
      'Die Leiste der Werkstatt wird nicht mitgelesen. Genau dort stand die ' +
        'Lüge, nachdem die Kasse gerichtet war.',
    ).toContain('DayControl.tsx');
  });

  it('⛔ der ECHTE Tagesabschluss wird aus der Kasse wirklich gerufen', () => {
    const rufer = QUELLEN.filter((q) => /closingsApi\.finalize\s*\(/.test(q.rein)).map(
      (q) => q.datei,
    );
    expect(
      rufer,
      'Keine Kassenfläche ruft `closingsApi.finalize`. Dann entsteht keine Zeile ' +
        'in `daily_closings` — und ohne die gibt es für den Tag kein DSFinV-K, ' +
        'kein DATEV und keinen Kassenbericht (§ 146 Abs. 1 Satz 2 AO). Genau das ' +
        'war der Zustand vor dem 13.08.2026.',
    ).not.toEqual([]);
  });

  it('⛔ und er ist von der Fläche OHNE offene Schicht erreichbar', () => {
    const oeffner = QUELLEN.filter(
      (q) => q.datei !== 'TagesabschlussDialog.tsx' && q.rein.includes('<TagesabschlussDialog'),
    ).map((q) => q.datei);
    expect(
      oeffner,
      'Das Tagesabschluss-Fenster wird von keiner Fläche gezeichnet. Gebaut ist ' +
        'nicht angeschlossen: niemand kann es öffnen.',
    ).toContain('ShiftOpenPanel.tsx');
    expect(
      oeffner,
      'Das Kassenbuch zeichnet den Tagesabschluss, obwohl dort IMMER eine Schicht ' +
        'offen ist. Der Server lehnt ihn dann ab (`closings-finalize.ts:289`), und ' +
        'ein Knopf, der sicher in einen Fehler läuft, ist keine Hilfe.',
    ).not.toContain('KassenbuchPanel.tsx');
  });
});

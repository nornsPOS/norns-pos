/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ KEIN TSE-ZWEIG DES BEZAHLWEGS ENDET OHNE EINREIHUNG
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 13.08.2026 ──────────────────────────────────────────────
 *
 * Im TSE-Abschnitt von `BezahlenDialog.tsx` standen drei Ausgaenge, die dem
 * Kassierer etwas sagten. NUR EINER davon hatte vorher gemessen, ob wirklich
 * etwas gesichert wurde:
 *
 *   · Melden gescheitert   → `enqueueSignatureRecordOnly`, Satz danach ✔
 *   · Abschluss gescheitert→ Satz „Signatur wird später nachgereicht", ohne
 *     jede Messung. `closeTseSession` faengt einen Fehlschlag seines eigenen
 *     Korbschreibers ab (`lib/tse-service.ts:135`) und meldet trotzdem
 *     Erfolg — der Satz konnte also luegen.
 *   · Eroeffnung gescheitert→ Satz „Die Signatur wird nachgeholt, sobald die
 *     Sicherungseinrichtung wieder antwortet", und NIRGENDS entstand eine
 *     Zeile. Bei einem Netzausfall ist das der ERSTE Schritt, der scheitert.
 *
 * ── WAS DIESER WAECHTER MISST ─────────────────────────────────────────────
 *
 * Jeden `addToast(`-Aufruf im TSE-Abschnitt. Zu jedem muss in SEINEM Zweig —
 * also zwischen der naechsten Zweiggrenze darueber und dem Ende der Anweisung
 * selbst — eine der drei Rechtfertigungen stehen:
 *
 *   1. `ausfallSichern(`             die Zeile wird hier geschrieben
 *   2. `enqueueSignatureRecordOnly(` die Zeile wird hier geschrieben
 *   3. `hinweisOhneSignatur('keine_tse_hinterlegt'` — der EINE Fall, in dem
 *      es nichts einzureihen gibt und der Satz auch nichts verspricht.
 *
 * ⚠️ Punkt 3 gilt nur mit dem AUSGESCHRIEBENEN Grund. Vor dem Befund stand
 * dort `hinweisOhneSignatur(grundOhneSignatur(hardwareCfg.tse.tssId), …)` —
 * dieselbe Zeile deckte damit auch „nicht erreichbar" ab, und genau dort war
 * das Versprechen ohne Deckung. Ein Waechter, der die Erwaehnung des Namens
 * genuegen liesse, waere beim urspruenglichen Defekt gruen gewesen.
 *
 * Keine Namensliste von Zweigen: ein vierter Ausgang, den jemand morgen baut,
 * wird ohne Zutun mitgeprueft.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const DIALOG = resolve(HIER, 'BezahlenDialog.tsx');

/** Der Anfang des TSE-Abschnitts — die Verzweigung auf die Eroeffnung. */
const ABSCHNITT_ANFANG = "if ('intention' in intentionRes) {";
/** Sein Ende — der Rueckgabewert des Abschlusses. */
const ABSCHNITT_ENDE = 'return result;';

/**
 * Eine Zweiggrenze. Oberhalb davon zaehlt nichts mehr zum selben Zweig:
 * `} else`, ein neues `if (`, ein `try {`, ein `} catch`.
 */
const ZWEIGGRENZE = /\}\s*else|^\s*if\s*\(|^\s*try\s*\{|^\s*\}\s*catch/;


/**
 * ── DIE FREISTELLUNG MIT GRUND (20.08.2026) ────────────────────────────────
 *
 * Nicht jeder Satz in diesem Abschnitt meldet einen AUSFALL. Der
 * Uhrenabgleich zum Beispiel meldet sich NACH einer erfolgreichen, bereits
 * gemeldeten Signatur: es gibt dort nichts einzureihen, gewarnt wird vor
 * etwas anderem (die Geräteuhr weicht von der Uhr der Sicherheitseinrichtung
 * ab, und damit stehen Bon und Tageszuordnung schief).
 *
 * Für solche Fälle gibt es diese Marke — auf DERSELBEN Zeile wie der Satz,
 * mit einem Grund dahinter. Ohne Grund gilt sie nicht: eine wortlose
 * Freistellung ist ein Abschalten mit besserem Namen.
 */
const FREI = 'tse-zweig-frei:';
const FREI_GRUND_MINDESTLAENGE = 12;

/** Was einen Satz an den Kassierer rechtfertigt. */
const RECHTFERTIGUNGEN = [
  'ausfallSichern(',
  'enqueueSignatureRecordOnly(',
  "hinweisOhneSignatur('keine_tse_hinterlegt'",
];

/** Kommentarzeilen zaehlen NICHT — gemessen wird der Gebrauch, nicht das Wort. */
function istKommentar(zeile: string): boolean {
  const t = zeile.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function tseAbschnitt(): { zeilen: string[]; versatz: number } {
  const alle = readFileSync(DIALOG, 'utf8').split('\n');
  const von = alle.findIndex((z) => z.includes(ABSCHNITT_ANFANG));
  if (von < 0) {
    throw new Error(
      `Anker "${ABSCHNITT_ANFANG}" nicht gefunden — misst dieser Waechter noch den Bezahlweg?`,
    );
  }
  const bis = alle.findIndex((z, i) => i > von && z.includes(ABSCHNITT_ENDE));
  if (bis < 0) {
    throw new Error(`Anker "${ABSCHNITT_ENDE}" nicht gefunden — der Abschnitt hat kein Ende mehr.`);
  }
  return { zeilen: alle.slice(von, bis + 1), versatz: von + 1 };
}

describe('⛔ kein TSE-Zweig ohne Einreihung', () => {
  it('zu JEDEM Satz an den Kassierer gehoert eine Messung in seinem Zweig', () => {
    const { zeilen, versatz } = tseAbschnitt();
    const ungedeckt: string[] = [];
    let gefunden = 0;

    for (const [i, zeile] of zeilen.entries()) {
      if (istKommentar(zeile) || !zeile.includes('addToast(')) continue;
      gefunden += 1;

      // Rueckwaerts bis zur naechsten Zweiggrenze.
      const davor: string[] = [];
      for (let j = i - 1; j >= 0; j -= 1) {
        const z = zeilen[j] ?? '';
        if (ZWEIGGRENZE.test(z)) break;
        if (!istKommentar(z)) davor.push(z);
      }

      // Und die Anweisung selbst, bis sie geschlossen ist — die
      // Rechtfertigung darf im Rumpf des Aufrufs stehen.
      const anweisung: string[] = [];
      for (let j = i; j < zeilen.length; j += 1) {
        const z = zeilen[j] ?? '';
        if (!istKommentar(z)) anweisung.push(z);
        if (j > i && /^\s*\}?\)?;?\s*$|\)\s*;\s*$/.test(z)) break;
      }

      const zweig = [...davor, ...anweisung].join('\n');

      // Ausdrueckliche Freistellung, aber nur MIT Grund auf derselben Zeile.
      const freigestellt = zeile.includes(FREI);
      if (freigestellt) {
        const grund = zeile.split(FREI)[1]?.trim() ?? '';
        if (grund.length < FREI_GRUND_MINDESTLAENGE) {
          ungedeckt.push(`Zeile ${versatz + i}: Freistellung ohne Grund`);
        }
        continue;
      }

      if (!RECHTFERTIGUNGEN.some((r) => zweig.includes(r))) {
        ungedeckt.push(`Zeile ${versatz + i}: ${zeile.trim()}`);
      }
    }

    expect(
      gefunden,
      'kein einziger Ausgang im TSE-Abschnitt gefunden — misst dieser Waechter noch etwas?',
    ).toBeGreaterThanOrEqual(3);

    expect(
      ungedeckt,
      'Diese Saetze gehen an den Kassierer, ohne dass der Zweig etwas eingereiht haette:\n' +
        ungedeckt.join('\n'),
    ).toEqual([]);
  });

  it('der Eroeffnungs-Ausfall schreibt eine Zeile OHNE erfundene Vorgangsnummer', () => {
    const { zeilen } = tseAbschnitt();
    const text = zeilen.filter((z) => !istKommentar(z)).join('\n');

    // Die Eroeffnung ist der Schritt, der bei Netzausfall zuerst faellt.
    expect(text, 'der Eroeffnungs-Ausfall reiht nichts ein').toContain(
      "meldungNachAusfall('eroeffnung'",
    );
    // Und er erfindet keine Vorgangsnummer: es gibt keine.
    expect(text, 'die Zeile ohne Eroeffnung braucht die ausdrueckliche Leermarke').toContain(
      'fiskalyTransactionId: OHNE_EROEFFNUNG',
    );
  });

  it('kein Ausgang behauptet eine Sicherung ohne Messung', () => {
    const { zeilen, versatz } = tseAbschnitt();
    const erfunden: string[] = [];
    for (const [i, zeile] of zeilen.entries()) {
      if (istKommentar(zeile)) continue;
      // Der zweite Wert von `meldungNachAusfall` IST die Messung. Eine feste
      // Wahrheit dort waere dieselbe Luege in neuer Schreibweise.
      if (/meldungNachAusfall\(\s*'[a-z]+'\s*,\s*(true|false)\b/.test(zeile)) {
        erfunden.push(`Zeile ${versatz + i}: ${zeile.trim()}`);
      }
    }
    expect(erfunden, `Feste Wahrheit statt Messung:\n${erfunden.join('\n')}`).toEqual([]);
  });
});

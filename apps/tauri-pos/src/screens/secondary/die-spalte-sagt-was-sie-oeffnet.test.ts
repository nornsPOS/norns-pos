/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Die Einstellungs-Spalte sagt, was sie öffnet
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 20.08.2026 (in der laufenden Kasse gelesen) ─────────────
 *
 * Die Einstellungs-Spalte trug dreiundzwanzig Einträge untereinander: erst
 * die Bereiche der Einstellungen selbst, darunter fünf Gruppen mit den Türen
 * zu den sekundären Flächen. Zwei Einträge hiessen dabei DASSELBE:
 *
 *     Steuer-Export & Compliance     ← ein Bereich der Einstellungen
 *     …
 *     Steuer-Export                  ← eine eigene Fläche
 *
 * Zwei Zeilen, ein Name, zwei verschiedene Ziele, in derselben Spalte
 * sichtbar. Genau das meinte Basel mit „graphisch überlappend, unklar".
 *
 * Und die Symbole halfen nicht: `Scale` stand vor ZWEI Bereichen,
 * `HandCoins` vor zwei weiteren. Ein Symbol, das zweimal vorkommt,
 * unterscheidet nichts mehr — es ist dann Zierat. Basel: „unnötige Symbole
 * weg, die nötigen an die richtige Stelle."
 *
 * ── WAS DIESER WÄCHTER HÄLT ────────────────────────────────────────────────
 *
 *   1. Kein Bereich der Einstellungen trägt den Namen einer Fläche.
 *   2. Kein Name kommt in der Spalte zweimal vor.
 *   3. Jeder Bereich hat sein EIGENES Symbol.
 *   4. Jeder Bereich sagt in einem Satz, was er einstellt.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SURFACES } from '../../app/chrome/surface-registry.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const QUELLE = readFileSync(join(HIER, 'Einstellungen.tsx'), 'utf8');

/** Ein Bereich der Spalte, aus der Quelle gelesen. */
interface Bereich {
  id: string;
  label: string;
  symbol: string;
  desc: string;
}

/**
 * Die Bereiche aus `SECTIONS`.
 *
 * Gelesen statt eingeführt: die Liste steht in einer `.tsx` mit JSX darin und
 * lässt sich nicht ohne den ganzen React-Baum laden. Gemessen wird die
 * QUELLE — und wenn sich ihre Gestalt ändert, fällt der erste Satz unten um,
 * statt dass der Wächter still nichts mehr prüft.
 */
function bereiche(): Bereich[] {
  const block = QUELLE.slice(QUELLE.indexOf('const SECTIONS: SectionDef[] = ['));
  const gefunden: Bereich[] = [];
  const re =
    /id:\s*'([^']+)',\s*(?:\/\/[^\n]*\n\s*)*label:\s*'([^']+)',\s*(?:\/\/[^\n]*\n\s*)*icon:\s*<Icon(?:Server)?\s*(?:icon=\{(\w+)\})?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const nach = block.slice(m.index, m.index + 700);
    const d = /desc:\s*'([^']*)'/.exec(nach);
    gefunden.push({
      id: m[1]!,
      label: m[2]!,
      symbol: m[3] ?? 'IconServer',
      desc: d?.[1] ?? '',
    });
  }
  return gefunden;
}

describe('⛔ Die Einstellungs-Spalte sagt, was sie öffnet', () => {
  const gelesen = bereiche();

  it('die Bereiche sind überhaupt lesbar — sonst prüft der Wächter Luft', () => {
    expect(
      gelesen.length,
      'Die Gestalt von `SECTIONS` hat sich geändert; dieser Wächter liest sie nicht mehr.',
    ).toBeGreaterThan(8);
    expect(gelesen.map((b) => b.id)).toContain('steuer');
  });

  it('⛔ kein Bereich trägt den Namen einer FLÄCHE', () => {
    const flaechen = new Set(SURFACES.map((s) => s.label.toLowerCase()));
    const doppelt = gelesen.filter((b) => flaechen.has(b.label.toLowerCase()));
    expect(
      doppelt.map((b) => b.label),
      'Zwei Zeilen derselben Spalte heissen gleich und führen woandershin.',
    ).toEqual([]);
  });

  it('⛔ kein Name kommt zweimal vor', () => {
    const namen = gelesen.map((b) => b.label);
    expect(namen).toEqual([...new Set(namen)]);
  });

  it('⛔ jeder Bereich hat sein EIGENES Symbol', () => {
    const jeSymbol = new Map<string, string[]>();
    for (const b of gelesen) {
      jeSymbol.set(b.symbol, [...(jeSymbol.get(b.symbol) ?? []), b.label]);
    }
    const geteilt = [...jeSymbol.entries()].filter(([, wer]) => wer.length > 1);
    expect(
      geteilt.map(([sym, wer]) => `${sym}: ${wer.join(' + ')}`),
      'Ein Symbol vor zwei Bereichen unterscheidet nichts mehr.',
    ).toEqual([]);
  });

  it('jeder Bereich sagt in einem Satz, was er einstellt', () => {
    for (const b of gelesen) {
      expect(b.desc.length, `„${b.label}" sagt nicht, was darin steht`).toBeGreaterThan(6);
    }
  });

  it('⛔ die Überschrift eines Bereichs heisst wie der Eintrag, der ihn öffnet', () => {
    /*
     * 20.08.2026, in der laufenden Kasse gelesen: der Eintrag hiess „Geräte
     * & Kasse", die Überschrift darüber „Hardware & Kasse". Wer den ersten
     * Namen im Kopf hat und den zweiten liest, glaubt, woanders gelandet zu
     * sein — und geht zurück.
     *
     * Gemessen wird gegen den ganzen Bereichsordner: jede Überschrift, die
     * einem Eintrag ÄHNELT (gleiche zweite Hälfte), muss ihm GLEICHEN.
     */
    const dateien = readdirSync(HIER).filter((n) => n.endsWith('.tsx'));
    const abweichungen: string[] = [];
    for (const b of gelesen) {
      const kern = b.label.split(/\s*[&·]\s*/).pop()!.trim();
      if (kern.length < 5) continue;
      for (const datei of dateien) {
        // ZEILENWEISE. Ein Ausdruck über die ganze Datei scheitert an JSX:
        // dort steht die Überschrift eingerückt auf einer eigenen Zeile,
        // zwischen `>` und `<` mit Zeilenumbrüchen dazwischen. Eine erste
        // Fassung dieses Satzes suchte über `>…<` und fand deshalb NICHTS —
        // sie war grün, ohne je etwas gemessen zu haben.
        for (const zeile of readFileSync(join(HIER, datei), 'utf8').split('\n')) {
          // Erst den Beiwerk-Kopf weg (`label: '`, `aria-label="`, `>`),
          // dann die Anführung. Sonst vergleicht der Satz „label: 'Geräte
          // & Kasse" mit „Geräte & Kasse" und meldet jeden Eintrag als
          // Abweichung von sich selbst.
          const roh = zeile
            .trim()
            .replace(/^[a-zA-Z-]+[:=]\s*/, '')
            .replace(/^[>"'{]+|[<"'},]+$/g, '')
            .trim();
          if (!roh.endsWith(kern) || roh === b.label) continue;
          if (!/[&·]\s*$/.test(roh.slice(0, roh.length - kern.length))) continue;
          if (roh.length > 30) continue;
          abweichungen.push(`${datei}: „${roh}" statt „${b.label}"`);
        }
      }
    }
    expect([...new Set(abweichungen)]).toEqual([]);
  });

  it('⛔ und kein Satz verspricht einen Web-Shop, den diese Kasse nicht hat', () => {
    // 20.08.2026: „Web-Shop-Kategorien" stand vor den Sammlungen — es sind
    // die Warengruppen, die das LAGER an jedes Stück hängt.
    for (const b of gelesen) {
      expect(`${b.label} ${b.desc}`.toLowerCase()).not.toContain('shop');
    }
  });
});

/**
 * Der Wächter gegen die Fläche, die Leere behauptet, wo sie schweigt.
 *
 * ── WAS AM 26.07.2026 GEFUNDEN WURDE ────────────────────────────────────────
 * Neun Flächen der Kasse hatten einen Ladezustand und KEINEN Fehlerzweig. Der
 * Fehler ist überall derselbe Zweizeiler:
 *
 *     const items = query.data?.items ?? []
 *     … items.length === 0 ? <p>Noch keine Mitarbeiter.</p> : …
 *
 * Fällt der Abruf aus, ist die Liste leer — und die Fläche sagt nicht „ich
 * konnte nicht nachsehen", sondern „es gibt nichts". Das sind zwei völlig
 * verschiedene Aussagen, und die falsche ist die beruhigende:
 *
 *   • Das Konfliktpostfach meldete „Keine Konflikte. Die Synchronisierung
 *     läuft.", während die Warteschlange hinter einem ungelesenen Konflikt
 *     stand. Genau diese Fläche existiert NUR für diesen Fall.
 *   • Die letzten Verkäufe meldeten „keine Verkäufe in 24 Stunden", während der
 *     Kunde mit seinem Bon vor dem Tresen stand.
 *   • Der Kursraum blieb auf „live" stehen und schrieb „Noch kein Kurs
 *     erfasst." — ein Edelmetallhändler darf beim Metallkurs nicht raten.
 *   • Risikoanalyse warf `!d` und `!d.configured` in EINE
 *     Bedingung: ein Ausfall las sich als „Cloudflare nie eingerichtet".
 *
 * Nichts hat gewarnt. Der Typprüfer sieht an `?? []` nichts Falsches, kein Test
 * rendert diese Flächen, und im Alltag ist der Server erreichbar — der Fehler
 * zeigt sich nur an dem Tag, an dem er zählt.
 *
 * ── WAS DIESER TEST TUT ─────────────────────────────────────────────────────
 * Er liest den Quelltext dieser acht Dateien und verlangt zweierlei:
 *   1. die Fläche LIEST ein Fehlersignal (`isError` oder `.error`), und
 *   2. sie ZEIGT es über das gemeinsame Bauteil `<ZustandFehler …>`.
 *
 * Beides zusammen, denn eines allein genügt nicht: wer nur liest und nichts
 * zeigt, hat den Fehler verschluckt; wer nur zeigt, ohne zu lesen, zeigt ihn
 * nie. Ein eigener Nachbau des Bauteils zählt bewusst NICHT — eine zweite
 * Wahrheit über den Fehlerzustand wäre wieder derselbe Fehler in neu.
 *
 * Der Wächter ist absichtlich ein Textwächter. Diese acht Flächen sind lange
 * Bildschirme mit Abfragen, Zeitgebern und Tauri-Brücken; eine reine Funktion
 * je Fläche zu schnitzen, nur damit etwas prüfbar ist, wäre mehr Gerüst als
 * Haus. Was hier zählt, ist eine Struktureigenschaft des Quelltextes, und
 * genau die prüft er.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = fileURLToPath(new URL('.', import.meta.url));
const QUELLE = join(HIER, '..');

/**
 * Die acht Flächen. Sie stehen hier namentlich und nicht als Suchmuster: eine
 * Liste, die sich selbst zusammensucht, schrumpft still mit, wenn jemand eine
 * Datei verschiebt, und der Wächter wäre grün über nichts.
 *
 * 01.08.2026 von neun auf acht: `screens/schaufenster/Schaufenster.tsx` ist
 * ausgezogen. Die Fläche zeigte den Webshop, den Norns POS nicht hat. Die
 * Zeile hier stehen zu lassen wäre bequemer gewesen, hätte den Wächter aber
 * dauerhaft rot gehalten und damit wertlos gemacht.
 */
const FLAECHEN: readonly string[] = [
  'screens/secondary/Kurse.tsx',
  'screens/leitstand/Leitstand.tsx',
  'screens/risiko/Risikoanalyse.tsx',
  'screens/team/Team.tsx',
  'screens/zielkarte/Zielkarte.tsx',
  'screens/kasse/RecentSalesPanel.tsx',
  'screens/kasse/NextHourPanel.tsx',
  'screens/secondary/Konfliktpostfach.tsx',
];

function lies(fläche: string): string {
  return readFileSync(join(QUELLE, fläche), 'utf8');
}

/** Liest die Fläche überhaupt ein Fehlersignal aus ihrer Datenquelle? */
function liestFehler(text: string): boolean {
  return /\bisError\b/.test(text) || /\.error\b/.test(text) || /\berror != null/.test(text);
}

/** Zeigt sie ihn über das gemeinsame Bauteil? */
function zeigtFehler(text: string): boolean {
  return /<ZustandFehler[\s/>]/.test(text);
}

describe('Fehlerzweig auf jeder Fläche mit Ladezustand', () => {
  it('findet alle acht Dateien, sonst prüft dieser Test nichts', () => {
    // Ohne diese Zusicherung wäre ein verschobener Pfad ein grüner Test über
    // eine leere Menge: die schlimmste Art von grün.
    for (const fläche of FLAECHEN) {
      expect(lies(fläche).length, `${fläche} ist leer oder fehlt`).toBeGreaterThan(200);
    }
    expect(FLAECHEN.length).toBe(8);
  });

  it('liest auf JEDER Fläche ein Fehlersignal aus der Datenquelle', () => {
    const stumm = FLAECHEN.filter((f) => !liestFehler(lies(f)));
    expect(
      stumm,
      `Diese Flächen fragen nie, ob der Abruf fehlschlug — eine leere Liste liest sich dort als „nichts vorhanden":\n${stumm.map((f) => `  ${f}`).join('\n')}`,
    ).toEqual([]);
  });

  it('zeigt den Fehler auf JEDER Fläche über <ZustandFehler>', () => {
    const ohne = FLAECHEN.filter((f) => !zeigtFehler(lies(f)));
    expect(
      ohne,
      `Diese Flächen haben keinen sichtbaren Fehlerzweig:\n${ohne.map((f) => `  ${f}`).join('\n')}`,
    ).toEqual([]);
  });

  it('baut das Bauteil nirgends selbst nach', () => {
    // Eine eigene Kopie von ZustandFehler wäre eine zweite Wahrheit über den
    // Fehlerzustand — und damit die nächste Fläche, die etwas anderes sagt als
    // der Rest des Hauses.
    const nachbau = FLAECHEN.filter((f) =>
      /function\s+ZustandFehler\b|const\s+ZustandFehler\s*[:=]/.test(lies(f)),
    );
    expect(
      nachbau,
      `Eigener Nachbau statt des gemeinsamen Bauteils:\n${nachbau.map((f) => `  ${f}`).join('\n')}`,
    ).toEqual([]);
  });
});

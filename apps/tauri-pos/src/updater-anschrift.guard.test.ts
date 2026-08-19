// @vitest-environment node
/**
 * ════════════════════════════════════════════════════════════════════════
 *  Die Luft-Aktualisierung muss eine ECHTE Adresse haben
 * ════════════════════════════════════════════════════════════════════════
 *
 * Basel, 05.08.2026: „حل مشكلة التحديث عن بعد او التحديثات الهوائية".
 *
 * ── ⚠️ WAS GEMESSEN WURDE ───────────────────────────────────────────────
 *
 * In seiner installierten Fassung 0.0.4 stand als Aktualisierungsadresse
 * woertlich:
 *
 *     https://github.com/__GITHUB_OWNER__/__GITHUB_REPO__/releases/…
 *
 * Ausgelesen aus dem Programm in `/Applications`, nicht vermutet. Die
 * Platzhalter wurden NUR im Fliessband ersetzt; diese Fassung war oertlich
 * gebaut. Die App fragte also fuer immer eine Adresse, die es nicht gibt.
 * Kein Schluessel, keine Freigabe, keine Signatur haette daran etwas
 * geaendert — es kam schlicht nie etwas an.
 *
 * Dieser Waechter macht genau diesen Zustand rot.
 *
 * ── ⚠️ UND DEN SCHLUESSEL DAZU ──────────────────────────────────────────
 *
 * Am selben Tag standen DREI Schluessel im Spiel:
 *
 *     im Quelltext        44DA51A8314FA264
 *     in Basels 0.0.4     367788A5A583002C
 *     im v0.0.1-Release   367788A5A583002C
 *
 * Ein Wechsel des Schluessels ist kein Tippfehler, sondern eine
 * Entscheidung mit Preis: JEDE bereits ausgelieferte App weist die naechste
 * Lieferung als gefaelscht zurueck und muss EINMAL von Hand neu installiert
 * werden. Deshalb steht die erwartete Kennung hier fest im Lager. Wer sie
 * aendert, muss diese Datei anfassen — und liest dabei, was es kostet.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const KONFIG = new URL('../src-tauri/tauri.conf.json', import.meta.url).pathname;

/**
 * Die Kennung des Schluessels, mit dem ausgeliefert wird.
 *
 * ⚠️ Wird sie geaendert, muss ZWEIERLEI geschehen, sonst ist die
 * Luft-Aktualisierung fuer alle bestehenden Installationen tot:
 *
 *   1. Das GitHub-Geheimnis `TAURI_SIGNING_PRIVATE_KEY` muss den passenden
 *      privaten Schluessel tragen. Es ist von aussen NICHT lesbar; niemand
 *      kann nachtraeglich pruefen, welcher darin liegt.
 *   2. Jede bereits installierte Kasse braucht EINE Installation von Hand.
 *      Danach laeuft es wieder ueber die Luft.
 */
// 20.08.2026, Umzug auf das Konto nornsPOS (das Vorkonto stiess an sein
// Monatskontingent; Basels Anweisung: neues Konto, neues oeffentliches
// Lager, gleiche Fassung). Das SCHLUESSELPAAR des Aktualisierers bleibt
// DASSELBE — nur die Adresse wandert; eine installierte Kasse prueft die
// Signatur, nicht den Kontonamen.
// 14.08.2026, Umzug auf das Norns-Konto 096s: NEUES Schluesselpaar. Der
// private Schluessel + Passwort liegen als Geheimnisse auf dem Quell-Lager
// und als einzige lesbare Kopie in Desktop/evn/Norns-Updater-Schluessel.md.
// Der alte Schluessel (44DA51A8314FA264) lebte nur als unlesbares Geheimnis
// auf dem alten Konto und ist tot; v0.4.0 war die Schnitt-Fassung, die jede
// Kasse einmal von Hand installiert.
const ERWARTETE_SCHLUESSELKENNUNG = 'F5FA96D8294B95A4';

interface Konfig {
  version?: string;
  tauri?: { updater?: { active?: boolean; pubkey?: string; endpoints?: string[] } };
  plugins?: { updater?: { active?: boolean; pubkey?: string; endpoints?: string[] } };
}

function updaterAbschnitt(): { active?: boolean; pubkey?: string; endpoints?: string[] } {
  const roh = JSON.parse(readFileSync(KONFIG, 'utf8')) as Konfig;
  // Tauri 1 legt ihn unter `tauri`, Tauri 2 unter `plugins`. Beide lesen,
  // damit der Waechter eine Umstellung ueberlebt statt still leer zu laufen.
  const a = roh.tauri?.updater ?? roh.plugins?.updater;
  if (a === undefined) {
    throw new Error(
      'Kein updater-Abschnitt in tauri.conf.json gefunden — weder unter `tauri` noch unter `plugins`. ' +
        'Ohne ihn prueft dieser Waechter NICHTS und waere gruen aus dem falschen Grund.',
    );
  }
  return a;
}

describe('Die Aktualisierungsadresse der Kasse', () => {
  const updater = updaterAbschnitt();
  const anschriften = updater.endpoints ?? [];

  it('ist ueberhaupt eingeschaltet', () => {
    expect(updater.active).toBe(true);
  });

  it('hat mindestens eine Adresse', () => {
    expect(anschriften.length).toBeGreaterThan(0);
  });

  it('⛔ enthaelt KEINEN Platzhalter — genau der Fehler vom 05.08.2026', () => {
    const mitPlatzhalter = anschriften.filter((a) => /__[A-Z0-9_]+__/.test(a));
    expect(
      mitPlatzhalter,
      'Eine Adresse mit Platzhalter wird nur im Fliessband ersetzt. Ein oertlich ' +
        'gebautes Programm traegt sie woertlich und fragt fuer immer ins Leere — ' +
        'genau das stand in Basels installierter 0.0.4.',
    ).toEqual([]);
  });

  it('zeigt auf eine vollstaendige, verschluesselte Adresse mit Lagerangabe', () => {
    for (const a of anschriften) {
      expect(a.startsWith('https://'), `Unverschluesselt: ${a}`).toBe(true);
      // owner/repo müssen echte Namen sein, keine leeren Segmente.
      const treffer = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\//.exec(a);
      expect(treffer, `Keine erkennbare GitHub-Freigabeadresse: ${a}`).not.toBeNull();
      expect(treffer?.[1]?.length ?? 0).toBeGreaterThan(0);
      expect(treffer?.[2]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('⛔ zeigt auf das OEFFENTLICHE Lieferlager, nie auf den privaten Quelltext', () => {
    // Gemessen am 14.08.2026, Lauf 31766228380: beide Plattformen gebaut und
    // signiert, und KEINE Kasse haette das Update bekommen — die Adresse zeigte
    // auf das private Quelltext-Lager, und der Updater fragt ohne Rechteausweis:
    // HTTP 404, fuenfmal. Die Auslieferung wohnt seitdem im getrennten
    // OEFFENTLICHEN Lager norns-releases (nur Pakete + Verzeichnis, kein
    // Quelltext). Wer diese Adresse „vereinfacht" und zurueck auf norns-pos
    // stellt, schneidet jeder installierten Kasse den Updateweg ab.
    for (const a of anschriften) {
      const treffer = /^https:\/\/github\.com\/[^/]+\/([^/]+)\/releases\//.exec(a);
      expect(treffer?.[1], `Adresse ohne Lagernamen: ${a}`).toBe('norns-releases');
    }
  });

  it('endet auf das Manifest, das der Updater wirklich liest', () => {
    for (const a of anschriften) {
      expect(a.endsWith('/latest.json'), `Kein Manifest am Ende: ${a}`).toBe(true);
    }
  });
});

describe('Der Schluessel, dem die Kasse vertraut', () => {
  const updater = updaterAbschnitt();

  it('ist gesetzt und ein lesbarer minisign-Schluessel', () => {
    const roh = updater.pubkey ?? '';
    expect(roh.length).toBeGreaterThan(0);
    const text = Buffer.from(roh, 'base64').toString('utf8');
    expect(text).toContain('minisign public key');
    // Zwei Zeilen: Kommentar und Schluessel. Eine einzelne Zeile waere ein
    // abgeschnittener Datensatz, den Tauri erst beim Pruefen ablehnt.
    expect(text.trim().split('\n').length).toBe(2);
  });

  it('traegt die Kennung, mit der das Fliessband signiert', () => {
    const text = Buffer.from(updater.pubkey ?? '', 'base64').toString('utf8');
    const kennung = /minisign public key:\s*([0-9A-F]+)/i.exec(text)?.[1] ?? '';
    expect(
      kennung,
      `Der Schluessel in tauri.conf.json wurde gewechselt (${kennung} statt ` +
        `${ERWARTETE_SCHLUESSELKENNUNG}). Das ist erlaubt, aber es kostet: ` +
        'das GitHub-Geheimnis TAURI_SIGNING_PRIVATE_KEY muss den passenden ' +
        'privaten Schluessel tragen, und JEDE bereits installierte Kasse ' +
        'braucht danach EINE Installation von Hand. Wenn das bewusst ist, ' +
        'ERWARTETE_SCHLUESSELKENNUNG in dieser Datei mitziehen.',
    ).toBe(ERWARTETE_SCHLUESSELKENNUNG);
  });
});

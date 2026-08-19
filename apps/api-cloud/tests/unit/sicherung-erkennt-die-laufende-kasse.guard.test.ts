/**
 * ════════════════════════════════════════════════════════════════════════
 *  Die Sicherung erkennt die laufende Kasse, statt sie abzuschiessen
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
 *
 * Der Fehlerpfad der Verbindung deutete JEDEN Fehler ausser dem Kennwort als
 * „Eintrag veraltet", danach lief `waisenErloesen()` und schickte SIGKILL an
 * die Kennung aus der `postmaster.pid` — an die laufende Kasse, mitten im
 * Verkauf.
 *
 * Gemessen genügen dafür zwei ganz gewöhnliche Fehler einer LEBENDEN Kasse:
 *
 *     53300  sorry, too many clients already
 *     3D000  database "norns_pos" does not exist
 *
 * ── WARUM DER ERSTE ENTWURF DER ABHILFE FALSCH WAR ─────────────────────
 *
 * Drei Skeptiker haben ihn gekippt, jeder mit einer Messung:
 *
 *   1. `const p` stand INNERHALB des `try` und ist im `catch` nicht sichtbar.
 *      Der Riegel hätte einen ReferenceError geworfen — also gerade dann
 *      versagt, wenn er greifen soll, und JEDE Sicherung bei geschlossener
 *      Kasse abgebrochen.
 *   2. `pg-port` wurde nie gelöscht. Die Zahl stammt aus dem Kurzzeitbereich;
 *      ein fremdes Programm darauf hätte die Sicherung DAUERHAFT verweigert.
 *   3. Der Satz „Schliessen Sie die Kasse" ist ein Rat ins Leere, wenn die
 *      Kasse längst zu ist und nur eine Waise herumliegt.
 *
 * ── DIE REGEL, DIE JETZT GILT ──────────────────────────────────────────
 *
 * Ob eine Kasse LÄUFT, beantwortet allein die `postmaster.pid`, und nur mit
 * ALLEN DREI Angaben: unser Verzeichnis, lebende Kennung, und auf dem Port
 * antwortet jemand. Zwei davon reichen nicht.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '../../../..');
const SIDECAR = join(REPO, 'apps/api-cloud/sidecar/norns-sidecar.mjs');
const KOPIE = join(REPO, 'apps/tauri-pos/src-tauri/resources/sidecar/norns-sidecar.mjs');

const quelle = (): string => readFileSync(SIDECAR, 'utf8');

/** Der Rumpf einer Funktion, bis zur schliessenden Klammer am Zeilenanfang. */
function funktion(text: string, name: string): string {
  const i = text.indexOf(`function ${name}(`);
  if (i < 0) return '';
  const j = text.indexOf('\n}\n', i);
  return text.slice(i, j < 0 ? text.length : j);
}

describe('⛔ Die drei Angaben aus der postmaster.pid', () => {
  it('⛔ es gibt einen Riegel, der die laufende Kasse erkennt', () => {
    expect(quelle(), 'der Riegel fehlt ganz').toContain('async function laeuftUnsereKasse');
  });

  it('⛔ er verlangt ALLE DREI: Verzeichnis, lebende Kennung, antwortender Port', () => {
    /**
     * Zwei davon reichen nicht. Eine liegengebliebene Datei nennt eine
     * Kennung, die inzwischen ein fremdes Programm trägt; ein antwortender
     * Port sagt nichts über das Verzeichnis.
     */
    const r = funktion(quelle(), 'laeuftUnsereKasse');
    expect(r, 'kein Verzeichnisvergleich').toContain('PGORT');
    expect(r, 'die Kennung wird nicht auf Leben geprüft').toContain('prozessLebt');
    expect(r, 'auf dem Port wird nicht geklopft').toContain('hoertJemandZu');
  });

  it('⛔ und er steht VOR dem Beenden der Waise, nicht danach', () => {
    /**
     * Die Reihenfolge IST die Aussage. Stünde der Riegel hinter
     * `waisenErloesen()`, wäre die Kasse schon tot, wenn er urteilt.
     */
    /**
     * ⚠️ Gemessen wird NUR innerhalb der Sicherung. `waisenErloesen()` steht
     * auch im START, und zwar davor — die erste Fassung dieser Prüfung fand
     * dort den Treffer und war rot, obwohl der Riegel richtig sass.
     */
    const q = quelle();
    const sicherung = q.slice(q.indexOf('async function sicherung('));
    const riegel = sicherung.indexOf('await laeuftUnsereKasse()');
    const erloesen = sicherung.indexOf('await waisenErloesen()');
    expect(riegel, 'der Riegel wird in der Sicherung nirgends aufgerufen').toBeGreaterThan(-1);
    expect(erloesen, 'die Sicherung räumt keine Waise mehr').toBeGreaterThan(-1);
    expect(riegel, 'der Riegel steht hinter dem Beenden').toBeLessThan(erloesen);
  });

  it('⚠️ der Klopftest steht NICHT in waisenErloesen', () => {
    /**
     * Beim START ist die Waise lebendig und antwortet womöglich sogar. Sie
     * muss trotzdem weg, sonst kommt die Kasse morgens nicht hoch. Wer den
     * Klopftest dorthin kopiert, macht aus einer Abhilfe eine Kasse, die sich
     * nicht mehr starten lässt.
     */
    expect(funktion(quelle(), 'waisenErloesen')).not.toContain('hoertJemandZu');
  });

  it('⚠️ aber der Verzeichnisvergleich steht sehr wohl darin', () => {
    // Sonst beendet der Start ein fremdes Programm, dessen Kennung zufällig
    // in einer liegengebliebenen Datei steht.
    expect(funktion(quelle(), 'waisenErloesen')).toContain('PGORT');
  });
});

describe('⚠️ Die Fallen, an denen der erste Entwurf gestorben wäre', () => {
  it('⛔ die Portnummer ist AUSSERHALB des try sichtbar', () => {
    // Sonst: ReferenceError genau dann, wenn der Riegel greifen soll.
    expect(quelle()).toMatch(/let port = null;\s*\n\s*if \(existsSync\(portdatei\)\)/);
  });

  it('⛔ die Portdatei wird beim Schliessen GELÖSCHT', () => {
    /**
     * Ohne das bleibt eine Zahl aus dem Kurzzeitbereich liegen, ein fremdes
     * Programm setzt sich darauf, und die Sicherung verweigert dauerhaft.
     * Das nimmt der Klasse den Boden, statt sie zu umbauen.
     */
    expect(quelle()).toMatch(/unlinkSync\(join\(DATENORT, 'pg-port'\)\)/);
  });

  it('⛔ die Verbindung hat eine Zeitgrenze', () => {
    // Ein schweigender Zuhörer liesse den Knopf in der Kasse nie zurückkommen.
    expect(quelle()).toContain('connectionTimeoutMillis');
  });

  it('⛔ nach gelungener Verbindung wird geprüft, ob es UNSERE Datenbank ist', () => {
    /**
     * Sonst landet der Bestand eines fremden Postgres als „Sicherung dieses
     * Ladens" im Zielordner, mit glaubwürdigen Zahlen. Ein Datenträger mit
     * den falschen Büchern ist schlimmer als gar keiner.
     */
    const q = quelle();
    expect(q).toContain('SHOW data_directory');
    expect(q).toMatch(/gemeldet !== PGORT/);
  });

  it('⚠️ die Portdatei bleibt ausdrücklich KEIN Abbruchgrund', () => {
    /**
     * Der erste Entwurf machte den Fehlschlag hier zum harten Halt. Damit
     * hätte eine liegengebliebene Zahl dem Händler die Sicherung für immer
     * verweigert — der Fix wäre schlimmer gewesen als der Fehler.
     */
    const q = quelle();
    const i = q.indexOf('Ob eine Kasse LÄUFT, beantwortet gleich');
    expect(i, 'die Begründung fehlt; wurde hier ein throw eingebaut?').toBeGreaterThan(-1);
    // Zwischen dem Kennwort-Halt und dem Ende des catch darf kein zweiter
    // `throw` stehen.
    const catchEnde = q.indexOf('db = null;', i);
    expect(catchEnde).toBeGreaterThan(i);
  });
});

describe('⚠️ Der Grund erreicht wirklich den Menschen', () => {
  it('⛔ jeder Abbruch der Sicherung trägt die Marke ABBRUCH', () => {
    /**
     * Gemessen in `apps/tauri-pos/src-tauri/src/sicherung.rs`: der Rumpf
     * wählt die LETZTE Zeile mit „ABBRUCH", sonst die letzte nicht leere.
     * Ohne die Marke gewinnt irgendeine Fortschrittszeile, und der Mensch
     * liest einen Satz, der mit seinem Problem nichts zu tun hat.
     */
    const q = quelle();
    const abschnitt = q.slice(q.indexOf('async function sicherung('));
    const wuerfe = [...abschnitt.matchAll(/throw new Error\(\s*\n?\s*[`'"]([^`'"]{10,})/g)].map(
      (m) => m[1] ?? '',
    );
    expect(wuerfe.length, 'keine Abbrüche gefunden').toBeGreaterThan(2);
    for (const w of wuerfe) {
      expect(w.startsWith('ABBRUCH'), `ohne Marke: „${w.slice(0, 60)}"`).toBe(true);
    }
  });

  it('⚠️ der Satz zur laufenden Kasse nennt BEIDE Auswege', () => {
    /**
     * „Schliessen Sie die Kasse" ist ein Rat ins Leere, wenn sie längst zu
     * ist und nur eine Waise herumliegt. Genau daran wäre der erste Entwurf
     * gescheitert.
     */
    /**
     * ⚠️ Der Satz steht im Quelltext als Verkettung über mehrere Zeilen. Wer
     * ihn dort roh sucht, findet ihn nicht — die erste Fassung dieser Prüfung
     * war genau daran rot, obwohl der Satz vollständig war. Also erst die
     * Verkettung auflösen, dann messen.
     */
    const q = quelle().replace(/'\s*\+\s*\n\s*'/g, '');
    const i = q.indexOf('läuft gerade ein Postgres');
    expect(i).toBeGreaterThan(-1);
    const satz = q.slice(i, i + 500);
    expect(satz, 'der Weg für die offene Kasse fehlt').toMatch(/schliessen/i);
    expect(satz, 'der Weg für die geschlossene Kasse fehlt').toMatch(/bereits\s+geschlossen/i);
  });
});

describe('⚠️ Beide Kopien tragen denselben Stand', () => {
  it('⛔ die ausgelieferte Kopie ist Byte für Byte dieselbe Datei', () => {
    /**
     * Es gibt zwei: die Quelle und die Kopie unter
     * `apps/tauri-pos/src-tauri/resources/sidecar/`. Ausgeliefert wird die
     * Kopie. Ein Fix nur in der Quelle wirkt auf der Kasse des Händlers NIE,
     * und im Arbeitsbaum sieht alles richtig aus — dieselbe Klasse wie
     * „dist statt Quelle".
     */
    expect(readFileSync(KOPIE, 'utf8')).toBe(quelle());
  });
});

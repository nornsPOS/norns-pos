/**
 * Die Kasse trägt EINE Fassungsnummer, nicht drei.
 *
 * ── DER FUND VOM 04.08.2026 ────────────────────────────────────────────────
 *
 * ⚠️ Gemessen, kurz bevor der Stand hochgeladen werden sollte:
 *
 *     tauri.conf.json   0.0.2      ← die massgebliche
 *     package.json      0.0.1
 *     Cargo.toml        0.0.1
 *
 * Drei Zahlen für dasselbe Ding.
 *
 * ── WARUM DAS GEFÄHRLICH IST, UND NICHT NUR UNSAUBER ───────────────────────
 *
 * Die Aktualisierung vergleicht die Zahl aus `tauri.conf.json` mit der Zahl im
 * Aktualisierungsverzeichnis. Das gebaute Paket trägt aber seine eigene. Passen
 * die nicht zusammen, hält die installierte Kasse das gerade geholte Update
 * für noch nicht installiert und holt es erneut. Und wieder. Der Händler sieht
 * eine Kasse, die dauernd lädt und nie fertig wird.
 *
 * ── WARUM ES NIEMAND GEMERKT HAT ───────────────────────────────────────────
 *
 * Das Werkzeug dagegen gab es längst: `scripts/set-version.mjs` kann `--sync`
 * und `--check`. Beim Messen aufgefallen: es wurde an KEINER Stelle gerufen.
 * Kein Prüfsatz, kein Ablauf bei GitHub, kein Freigabeschritt.
 *
 * Gebaut und nie angeschlossen. Dieses Haus kennt die Klasse, und das ist der
 * Grund, warum dieser Satz existiert: er ist der Anschluss.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '../../../../..');

const lies = (p: string): string => readFileSync(resolve(WURZEL, p), 'utf8');

describe('Die Fassung der Kasse', () => {
  it('⛔ package.json, Cargo.toml und tauri.conf.json sagen dasselbe', () => {
    // ⚠️ Der Satz ruft das HAUSEIGENE Werkzeug, statt die Prüfung ein zweites
    // Mal nachzubauen. Zwei Rechnungen für dieselbe Sache driften; genau das
    // ist hier schon einmal passiert.
    let ausgabe = '';
    let gescheitert = false;
    try {
      ausgabe = execFileSync('node', ['scripts/set-version.mjs', '--check'], {
        cwd: WURZEL,
        encoding: 'utf8',
      });
    } catch (fehler) {
      gescheitert = true;
      const f = fehler as { stdout?: string; stderr?: string };
      ausgabe = `${f.stdout ?? ''}${f.stderr ?? ''}`;
    }
    expect(
      gescheitert,
      `Die Fassungsnummern laufen auseinander. Heilung: ` +
        `\`node scripts/set-version.mjs --sync\`\n${ausgabe}`,
    ).toBe(false);
  });

  it('die massgebliche Fassung steht in tauri.conf.json und ist eine echte Zahl', () => {
    // Sie entscheidet, ob eine installierte Kasse ein Update sieht.
    const conf = JSON.parse(lies('apps/tauri-pos/src-tauri/tauri.conf.json')) as {
      version?: string;
    };
    expect(conf.version, 'in tauri.conf.json steht keine Fassung').toBeTruthy();
    expect(conf.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });

  it('⛔ das Werkzeug dagegen ist wirklich angeschlossen', () => {
    // Der eigentliche Sinn dieser Datei. Ohne einen Rufer ist ein Wächter
    // eine Notiz. Dieser Prüfsatz IST der Rufer, also muss er das Werkzeug
    // auch wirklich nennen.
    const selbst = lies('apps/tauri-pos/src/app/chrome/eine-fassung-nicht-drei.test.ts');
    const rumpf = selbst.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rumpf).toContain('set-version.mjs');
    expect(rumpf).toContain("'--check'");
  });

  /**
   * ⛔ UND DER FREIGABEWEG PRÜFT DEN TAG GEGEN DIE FASSUNG
   *
   * ── DER BEFUND VOM 12.08.2026 ────────────────────────────────────────────
   *
   * Der Satz darüber schliesst nur die ÖRTLICHE Hälfte an: stimmen die drei
   * Dateien untereinander. Das ist zu wenig.
   *
   * `set-version.mjs` verspricht in seinem eigenen Kopf: „Phase 8.5 wires
   * `--check "$TAG"` as a required status check on the release workflow so a
   * mismatched tag can never publish." Gemessen: `grep set-version .github`
   * fand NICHTS. Der Riegel war nie verdrahtet.
   *
   * Und die Lücke ist genau die, vor der der Kopf dieser Datei warnt: bei
   * `git tag v0.3.0` auf einem Baum mit 0.2.0 sind die drei Dateien
   * untereinander einig, der Satz oben bleibt GRÜN — und trotzdem bekommt
   * jede Kasse ein Verzeichnis mit einer Fassung, die das installierte
   * Programm nie melden wird. Dauerschleife aus Herunterladen und
   * Installieren, auf jedem Gerät im Laden.
   *
   * Dieser Satz misst deshalb den ANSCHLUSS im Freigabeweg, nicht die
   * Erwähnung: Kommentarzeilen werden vorher entfernt.
   */
  it('⛔ der Freigabeweg ruft den Tag-Abgleich WIRKLICH auf', () => {
    const roh = lies('.github/workflows/release.yml');
    // Kommentarzeilen raus — sonst genügte ein Satz ÜBER den Riegel, und
    // genau das war der Zustand bis zum 12.08.2026.
    const code = roh
      .split('\n')
      .filter((z) => !z.trim().startsWith('#'))
      .join('\n');

    expect(
      code,
      'Der Freigabeweg ruft `set-version.mjs` nicht auf. Ein Tag, der nicht zur ' +
        'Fassung passt, erzeugt dann ein Verzeichnis, das jede installierte Kasse ' +
        'in eine Aktualisierungsschleife schickt.',
    ).toContain('set-version.mjs');
    expect(
      code,
      'Der Aufruf übergibt den TAG nicht. Ohne ihn prüft `--check` nur, ob die drei ' +
        'Dateien EINANDER gleichen — und das tun sie beim Tag-Versatz.',
    ).toMatch(/set-version\.mjs --check "\$\{?GITHUB_REF_NAME/);
  });
});

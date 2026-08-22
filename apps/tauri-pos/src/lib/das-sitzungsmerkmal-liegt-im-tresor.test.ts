/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ⛔ DAS SITZUNGSMERKMAL LIEGT IM TRESOR, NICHT IM BROWSERSPEICHER
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── BASELS ANWEISUNG VOM 22.08.2026 ───────────────────────────────────────
 *
 * Wörtlich: „انقله ضروري لـ OS Keychain. نبي هنا أقصى درجات الأمان وبمستوى
 * البنوك." — das Merkmal gehört in die Schlüsselverwaltung des
 * Betriebssystems, auf der höchsten Stufe.
 *
 * Bis dahin stand es in `localStorage` unter `w14.session-token`, und die
 * Datei trug den Vermerk selbst: „SECURITY (go-live TODO)".
 *
 * ── WAS DIESE PROBE FESTHÄLT, UND WARUM JEDER SATZ ────────────────────────
 *
 *   1. KEIN `localStorage` mehr in dieser Datei. Der Rückweg ist bequem und
 *      sähe harmlos aus; ohne diesen Satz käme er beim nächsten Umbau zurück.
 *   2. Der Wert wird beim Start GELESEN, und zwar von einer Fläche, die vor
 *      dem ersten Bild läuft. Fehlte das, hielte sich die Kasse nach jedem
 *      Neustart für abgemeldet.
 *   3. ⛔ DIE SCHREIBZÜGE HÄNGEN AN EINER KETTE. Anmelden und Abmelden sind
 *      beide asynchron. Zwei lose Züge können in JEDER Reihenfolge ankommen,
 *      und landet das Abmelden vor dem Anmelden, bleibt ein GÜLTIGES Merkmal
 *      im Tresor liegen — auf einem Gerät, das der Händler für abgemeldet
 *      hält. Das ist der gefährlichste Fehler dieses Umbaus, und er wäre
 *      niemandem aufgefallen.
 *   4. Der Abmeldeweg WARTET darauf. Ohne das Warten stünde „abgemeldet" auf
 *      dem Schirm, während das Löschen noch unterwegs ist.
 *   5. Und die Ablehnung des Rumpfes wird nicht roh gezeigt — dafür gibt es
 *      im Haus einen eigenen Wächter, und der hat diesen Umbau bereits
 *      einmal rot gemeldet.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const MERKMAL = resolve(HIER, 'session-token.ts');
const ABMELDEN = resolve(HIER, 'sign-out.ts');
const START = resolve(HIER, '../app/Motorstart.tsx');
const TRESOR = resolve(HIER, '../../src-tauri/src/tresor.rs');

/** Kommentare weg: ein `localStorage` in einer Erklärung ist kein Zugriff. */
function ohneKommentare(quelle: string): string {
  const nurUmbrueche = (s: string): string => s.replace(/[^\n]/g, ' ');
  return quelle
    .replace(/\/\*[\s\S]*?\*\//g, nurUmbrueche)
    .replace(/(^|[^:])\/\/.*$/gm, (_t, davor: string) => `${davor} `);
}

describe('⛔ Das Sitzungsmerkmal liegt im Tresor', () => {
  const merkmal = ohneKommentare(readFileSync(MERKMAL, 'utf8'));

  it('die Datei ist überhaupt lesbar', () => {
    // „null ist nicht grün": über einer leeren Datei wäre alles darunter
    // trivial erfüllt.
    expect(merkmal.length, 'session-token.ts ist leer oder fehlt').toBeGreaterThan(400);
  });

  it('⛔ rührt keinen Browserspeicher mehr an', () => {
    expect(
      merkmal,
      'Das Merkmal liegt wieder im Browserspeicher. Der ist eine gewöhnliche, ' +
        'unverschlüsselte Datei im Benutzerprofil: wer das Gerät in die Hand ' +
        'bekommt oder eine Sicherung des Profils liest, hat die Sitzung — ohne ' +
        'die Kasse je zu starten und ohne den Kassencode zu kennen.',
    ).not.toMatch(/localStorage|sessionStorage/);
  });

  it('⛔ liest und schreibt über die Schlüsselverwaltung', () => {
    expect(merkmal).toContain("invoke<string | null>('sitzung_lesen')");
    expect(merkmal).toContain("invoke('sitzung_schreiben'");
  });

  it('⛔ und die Schreibzüge hängen an EINER Kette', () => {
    expect(
      merkmal,
      'Die Schreibzüge in den Tresor laufen wieder lose nebeneinander. Landet ' +
        'ein Abmelden vor einem Anmelden, bleibt ein GÜLTIGES Merkmal im ' +
        'Tresor liegen, auf einem Gerät, das der Händler für abgemeldet hält.',
    ).toMatch(/kette\s*=\s*kette\s*\n?\s*\.then\(/);
  });
});

describe('⛔ Und die Kasse holt es zur rechten Zeit', () => {
  it('der Start lädt es, bevor die Kasse erscheint', () => {
    const start = ohneKommentare(readFileSync(START, 'utf8'));
    expect(
      start,
      'Ohne diesen Zug hielte sich die Kasse nach jedem Neustart für ' +
        'abgemeldet und schickte den Händler grundlos an den Kassencode.',
    ).toContain('await ladeSitzungAusTresor()');
  });

  it('⛔ der Abmeldeweg wartet, bis der Tresor es wirklich los ist', () => {
    const abmelden = ohneKommentare(readFileSync(ABMELDEN, 'utf8'));
    expect(
      abmelden,
      'Ohne dieses Warten meldet die Fläche „abgemeldet", während das Löschen ' +
        'noch unterwegs ist. Ein Ausschalten in dieser Sekunde liesse ein ' +
        'gültiges Merkmal im Tresor zurück.',
    ).toContain('await tresorIstGeschrieben()');
  });

  it('⛔ und der Rumpf hat ein EIGENES Fach dafür', () => {
    const tresor = readFileSync(TRESOR, 'utf8');
    expect(tresor).toContain('const SITZUNGSFACH');
    expect(tresor).toContain('pub fn sitzung_lesen');
    expect(tresor).toContain('pub fn sitzung_schreiben');
    // ⚠️ Und NICHT im Bündel der vier unersetzlichen Geheimnisse: die sind
    // für immer, das Merkmal wird bei jeder Anmeldung neu geschrieben.
    expect(
      tresor,
      'Das Sitzungsfach steht in der Liste der unersetzlichen Geheimnisse. ' +
        'Geht der Kundenschlüssel verloren, sind die Kundendaten unlesbar — ' +
        'dieses Fach darf nicht bei jeder Anmeldung daneben angefasst werden.',
    ).not.toMatch(/GEHEIMNISSE[^;]*NORNS_SITZUNG/s);
  });
});

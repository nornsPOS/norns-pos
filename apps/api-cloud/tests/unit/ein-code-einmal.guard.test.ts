/**
 * ════════════════════════════════════════════════════════════════════════
 *  Ein Code, einmal — aber NIEMALS null Codes
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── BASELS ANORDNUNG VOM 05.08.2026 ─────────────────────────────────────
 *
 * Wörtlich: „مرا وحدة كاملة متكاملة ماتنطلب مرا ثانية" — einmal,
 * vollständig, und nicht wieder.
 *
 * ── DER BEFUND VOM 09.08.2026 ───────────────────────────────────────────
 *
 * Es gab ZWEI Ziffernschlösser mit ZWEI Geheimnissen:
 *
 *   Kassencode    genau 6 Ziffern (18.08.2026; davor 6 bis 12), argon2 im
 *                 Motor, benennt den MENSCHEN,
 *                 der nach § 146a AO auf jedem Beleg steht
 *   Gerätecode    genau 6 Ziffern, PBKDF2 im Fensterspeicher, benennt
 *                 NIEMANDEN
 *
 * Jeden Morgen nach Ablauf der Achtstundensitzung: zwei Masken vor dem
 * ersten Kunden. Beim Einrichten drei Eingaben.
 *
 * ── ⚠️ WARUM DIESER WÄCHTER GEFÄHRLICHER IST ALS DER UMBAU ─────────────
 *
 * Der Sitzungsschlüssel liegt im Speicher der Fensterschale und ÜBERLEBT
 * einen Kaltstart. Hätte man nur das zweite Schloss entfernt, öffnete sich
 * die Kasse nach einem Neustart GANZ OHNE Code — die Sitzung gilt ja noch
 * acht Stunden.
 *
 * Aus zwei Schlössern wären damit null geworden, und auf dem Bildschirm
 * sähe es aus wie ein Erfolg. Ein Tresen mit Gold in der Lade darf nicht
 * offen sein, nur weil gestern jemand angemeldet war.
 *
 * Hier wird gemessen, dass GENAU EIN Schloss steht.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const KASSE = join(HIER, '../../../tauri-pos/src');

const lies = (p: string): string => readFileSync(join(KASSE, p), 'utf8');

describe('⛔ Genau ein Ziffernschloss, nicht zwei und nicht null', () => {
  it('⛔ das zweite Schloss ist weg', () => {
    const app = lies('app/App.tsx');
    /**
     * ⚠️ Gemessen wird der GEBRAUCH, nicht die Erwähnung: nur die Zeilen
     * ohne Kommentar zählen, damit die Erklärung oben den Wächter nicht rot
     * färbt. Diese Falle hat im Haus schon dreimal zugeschlagen.
     */
    const code = app
      .split('\n')
      .filter((z) => {
        const t = z.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');
    expect(code, 'das zweite Ziffernschloss steht wieder in der Schale').not.toContain(
      '<LocalLockGate',
    );
  });

  it('⛔ und der Kaltstart verlangt WEITERHIN einen Code', () => {
    /**
     * DER KERN. Ohne `posEntsperrt` wäre `status === "authenticated"` allein
     * die Eintrittskarte — und die überlebt den Neustart.
     */
    const app = lies('app/App.tsx');
    expect(app, 'der Kaltstart oeffnet die Kasse ohne Code').toMatch(
      /status === 'authenticated' && posEntsperrt/,
    );
    expect(app, 'die gesperrte Lage zeigt keine Maske').toMatch(/body = <PinLogin \/>;/);
  });

  it('⛔ und die Sperre faellt NUR durch eine echte Codeeingabe', () => {
    const speicher = lies('state/session-store.ts');

    // Beim Programmstart gesperrt.
    expect(speicher, 'die Kasse startet entsperrt').toMatch(/posEntsperrt: false,/);

    /**
     * ⚠️ Und die Sitzungsprüfung darf sie NICHT setzen. Sonst wäre der
     * Kaltstart wieder codefrei, und zwar auf genau dem Weg, den niemand
     * ansieht.
     */
    const probe = /setFromProbe: \(payload\) => \{[\s\S]*?\n {2}\},/.exec(speicher);
    expect(probe, 'setFromProbe wurde nicht gefunden').not.toBeNull();
    expect(probe![0], 'die Sitzungspruefung entsperrt die Kasse').not.toContain('posEntsperrt');

    // Aber die Codeeingabe muss es tun, sonst käme man nie hinein.
    const login = /setFromLogin: \(payload\) => \{[\s\S]*?\n {2}\},/.exec(speicher);
    expect(login, 'setFromLogin wurde nicht gefunden').not.toBeNull();
    expect(login![0], 'die Codeeingabe entsperrt nicht').toContain('posEntsperrt: true');
  });

  it('⚠️ und Abmelden sperrt wieder', () => {
    const speicher = lies('state/session-store.ts');
    const ab = /setUnauthenticated: \(\) => \{[\s\S]*?\n {2}\},/.exec(speicher);
    expect(ab, 'setUnauthenticated wurde nicht gefunden').not.toBeNull();
    expect(ab![0], 'nach dem Abmelden bliebe die Kasse entsperrt').toContain(
      'posEntsperrt: false',
    );
  });
});

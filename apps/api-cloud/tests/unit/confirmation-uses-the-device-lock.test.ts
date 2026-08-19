/**
 * Jede Nachbestätigung verlangt den KASSENCODE, geprüft auf dem SERVER.
 *
 * ── DIE GESCHICHTE DIESES WÄCHTERS, WEIL SIE SEINE LEHRE IST ───────────────
 *
 * 23.07.2026 (W14-Zeit): Anmeldung war Google, jedes Gerät trug einen eigenen
 * Sperrcode. Dieser Wächter VERBOT damals `authPin.stepUp` und VERLANGTE die
 * lokale Prüfung (`verifyLocalPin` + `stepUpDevice`). Für jene Welt war das
 * richtig.
 *
 * 05.08.2026, Basels Ein-Code-Anordnung: die Anmeldung IST der Kassencode,
 * der lokale Gerätecode wurde abgeschafft. App.tsx wurde umgestellt — der
 * Nachbestätigungs-Dialog nicht, und DIESER Wächter pinnte den Rückstand
 * fest: er wurde grün, solange der Dialog nach einem Code fragte, den seit
 * dem Umbau NIEMAND mehr setzen konnte.
 *
 * 14.08.2026, Begehung 0.6.0: auf der frischen Kasse war deshalb Storno,
 * Z-Bon und Export UNMÖGLICH („Falscher Gerätecode. Noch 9 Versuche." gegen
 * einen Datensatz, den es nie gab). Die Klasse heisst „Wächter, der den
 * Defekt festpinnt". Seitdem hält dieser Wächter das GEGENTEIL fest:
 *
 *   • Die Nachbestätigung fragt den Kassencode ab und lässt ihn vom SERVER
 *     prüfen (`POST /api/auth/step-up`): ein Code, ein Fehlversuchszähler,
 *     eine Sperre, ein Tagebuch — und die Zwangs-PIN wird dort erkannt.
 *   • Es gibt genau EINE Tür dafür (StepUpModal). Keine zweite Fläche darf
 *     eine eigene PIN-Abfrage nachbauen.
 *   • Die lokale Gerätecode-Welt bleibt GELÖSCHT. Ihre Wiederkehr in
 *     irgendeiner Fläche ist ein Verstoss.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = fileURLToPath(new URL('.', import.meta.url));
const WURZEL = join(HIER, '..', '..', '..', '..');

/** Die EINE Tür, die den Kassencode abfragt und zum Server trägt. */
const DIE_TUER = 'apps/tauri-pos/src/app/chrome/StepUpModal.tsx';

/**
 * Wer den Server-Weg ausser der Tür noch NENNEN darf:
 *   • der Bausatz definiert ihn (auth-pin.ts),
 *   • die Warteschlange führt ihn in ihrer SPERRLISTE der Wege, die niemals
 *     offline nachgespielt werden dürfen — Erwähnung, kein Aufruf.
 */
const AUSGENOMMEN = new Set([
  'packages/api-client/src/domains/auth-pin.ts',
  'packages/api-client/src/middleware/offline-queue.ts',
]);

const NUR_AUFRUF = /authPin\.stepUp\s*\(/;

const FLAECHEN = ['apps/tauri-pos/src', 'packages/api-client/src'];

/**
 * Kommentare überlesen, bevor gemessen wird: die Tür ERZÄHLT ihre Geschichte
 * („prüfte weiter mit verifyLocalPin …"), und eine Erzählung ist kein
 * Gebrauch (Hausregel „die Erwähnung ist nicht der Gebrauch").
 */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function dateienUnter(verzeichnis: string): string[] {
  const voll = join(WURZEL, verzeichnis);
  let eintraege: string[];
  try {
    eintraege = readdirSync(voll);
  } catch {
    return [];
  }
  const gefunden: string[] = [];
  for (const name of eintraege) {
    if (name === 'node_modules' || name === 'dist') continue;
    const pfad = join(voll, name);
    if (statSync(pfad).isDirectory()) gefunden.push(...dateienUnter(join(verzeichnis, name)));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) gefunden.push(pfad);
  }
  return gefunden;
}

describe('die Nachbestätigung verlangt den Kassencode über den Server', () => {
  it('die Tür ruft den Server-Weg und nichts Lokales', () => {
    const inhalt = ohneKommentare(readFileSync(join(WURZEL, DIE_TUER), 'utf8'));
    expect(inhalt, `${DIE_TUER} muss den Kassencode vom SERVER prüfen lassen`).toMatch(NUR_AUFRUF);
    // `stepUpDevice` stempelte NUR — eine Bestätigung ohne Frage. Und die
    // lokale Prüfsippe ist mit dem Gerätecode gestorben.
    expect(inhalt, `${DIE_TUER} darf nicht stempeln, ohne dass der Server prüft`).not.toMatch(
      /stepUpDevice|deviceStepUp/,
    );
    expect(inhalt, `${DIE_TUER} darf die tote lokale Prüfung nicht wiederbeleben`).not.toMatch(
      /verifyLocalPin|recordFailedAttempt|hasLocalPin|from ['"].*local-lock/,
    );
  });

  it('keine ZWEITE Fläche baut eine eigene Kassencode-Abfrage', () => {
    const verstoesse: string[] = [];
    for (const wurzel of FLAECHEN) {
      for (const datei of dateienUnter(wurzel)) {
        const rel = relative(WURZEL, datei).split('\\').join('/');
        if (rel === DIE_TUER || AUSGENOMMEN.has(rel)) continue;
        if (NUR_AUFRUF.test(readFileSync(datei, 'utf8'))) verstoesse.push(rel);
      }
    }
    expect(
      verstoesse,
      'Diese Dateien rufen die Server-Nachbestätigung an der EINEN Tür vorbei. ' +
        'Empfindliche Handlungen laufen über den StepUpModal, sonst entstehen ' +
        'zwei Abfragen mit zwei Wahrheiten.',
    ).toEqual([]);
  });

  it('die Gerätecode-Welt bleibt gelöscht', () => {
    // Am 14.08.2026 entfernt; ein Wiederauftauchen wäre der halbe Rückbau
    // des P0 („der halbe Fix an derselben Ampel", nur rückwärts).
    for (const tote of [
      'apps/tauri-pos/src/lib/local-lock.ts',
      'apps/tauri-pos/src/screens/LocalLock.tsx',
      'apps/tauri-pos/src/components/LocalLockGate.tsx',
    ]) {
      expect(existsSync(join(WURZEL, tote)), `${tote} ist zurückgekehrt`).toBe(false);
    }
  });

  it('der Server hält den Alt-Weg für draussen laufende Kassen bereit', () => {
    // `/api/auth/step-up/device` ruft im Baum niemand mehr. Er bleibt am
    // Server, damit eine noch nicht aktualisierte Kasse draussen nicht
    // stehen bleibt, und sein Tagebucheintrag nennt den Faktor.
    const route = readFileSync(join(WURZEL, 'apps/api-cloud/src/routes/auth-pin.ts'), 'utf8');
    expect(route).toContain("'/api/auth/step-up/device'");
    expect(route).toContain("'auth.step_up_device'");
    expect(route).toContain("factor: 'device_lock'");
  });
});

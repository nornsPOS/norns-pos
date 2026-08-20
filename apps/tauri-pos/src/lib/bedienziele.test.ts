/**
 * Der Wächter über die zwei gemessenen Bedienziele.
 *
 * ── DIE MESSUNG (26.07.2026) ────────────────────────────────────────────────
 * • Der Zahlart-Wähler im Bezahldialog (Barzahlung/Kartenzahlung) war 24
 *   Punkte hoch — die WICHTIGSTE Entscheidung des Bezahlens war das kleinste
 *   Ziel im Dialog, während die Schein-Chips daneben längst 52 Punkte tragen.
 * • Die Kopfleiste war 56 Punkte hoch und trug sechs Bedienelemente mit je
 *   36 Punkten. Das kommende Kassengerät ist ein Touchbildschirm; die
 *   WCAG-Untergrenze für Touchziele ist 44.
 *
 * Die Masse stehen jetzt EINMAL in `bedienziele.ts`, statt in fünf Dateien
 * hartkodiert. Dieser Test hält beides fest: die Werte selbst und dass die
 * fünf Flächen wirklich aus der gemeinsamen Quelle schöpfen — sonst hebt die
 * nächste Änderung eine Datei an und vergisst die anderen vier.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { KOPFLEISTE_HOEHE, KOPF_ZIEL, ZAHLART_ZIEL } from './bedienziele.js';

const HIER = fileURLToPath(new URL('.', import.meta.url));
const KASSE = join(HIER, '..');

describe('Bedienziele', () => {
  it('Touchziele mindestens 44, die Leiste lässt Luft', () => {
    expect(ZAHLART_ZIEL).toBeGreaterThanOrEqual(44);
    expect(KOPF_ZIEL).toBeGreaterThanOrEqual(44);
    // Die Leiste braucht mehr als das Ziel selbst, sonst kleben die Knöpfe
    // an beiden Rändern und wirken gequetscht.
    expect(KOPFLEISTE_HOEHE).toBeGreaterThanOrEqual(KOPF_ZIEL + 16);
  });

  it('die fünf Flächen schöpfen aus der gemeinsamen Quelle', () => {
    const erwartungen: ReadonlyArray<readonly [string, string]> = [
      /*
       * ⚠️ 20.08.2026: zeigte auf `BezahlenDialog.tsx`. Die Zahlfläche trug
       * 4018 Zeilen und ist in ihre Bauteile ausgezogen (Basels „nicht die
       * Welt ineinanderstopfen"). Was dieser Satz misst, wohnt jetzt in
       * `PaymentInput.tsx` — dem Bauteil, das die Zahlwege wirklich zeigt.
       */
      ['screens/verkauf/PaymentInput.tsx', 'ZAHLART_ZIEL'],
      ['app/chrome/AppShellHeader.tsx', 'KOPFLEISTE_HOEHE'],
      ['app/chrome/AppShellHeader.tsx', 'KOPF_ZIEL'],
      ['app/chrome/ThemeToggle.tsx', 'KOPF_ZIEL'],
      ['app/chrome/HealthDot.tsx', 'KOPF_ZIEL'],
      ['app/chrome/UpdateButton.tsx', 'KOPF_ZIEL'],
      ['app/chrome/SupportButton.tsx', 'KOPF_ZIEL'],
    ];
    for (const [datei, konstante] of erwartungen) {
      const quelle = readFileSync(join(KASSE, datei), 'utf8');
      expect(quelle.includes(konstante), `${datei} benutzt ${konstante} nicht`).toBe(true);
    }
  });
});

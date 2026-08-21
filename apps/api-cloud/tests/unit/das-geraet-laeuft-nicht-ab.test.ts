// @vitest-environment node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Das Gerätezertifikat läuft nicht nach zehn Jahren ab
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER ZEITZÜNDER, GEFUNDEN AM 21.08.2026 ────────────────────────────────
 *
 * Der Erststart legte die Gerätezeile so an:
 *
 *     cert_expires_at = now() + interval '10 years'
 *     ON CONFLICT (cert_serial) DO UPDATE SET status = 'active'
 *
 * Beim ERSTEN Start wurde das Datum gesetzt, danach NIE wieder angefasst —
 * die Auflösung des Konflikts frischte allein den Zustand auf.
 *
 * Der mTLS-Riegel (`plugins/mtls.ts`) lässt ein Gerät aber nur durch, solange
 *
 *     gt(devices.certExpiresAt, sql-now())
 *
 * Zehn Jahre nach der Einrichtung hätte die Kasse also JEDE Anfrage
 * abgewiesen — auf einer Maschine, die die ganze Zeit täglich gestartet
 * wurde. Kein Warnhinweis, kein Erneuerungsweg, und ein Ausfall, den niemand
 * mehr einem Datum zuordnet.
 *
 * ⚠️ ZEHN JAHRE SIND NICHT WEIT WEG. § 147 AO verlangt genau so lange
 * Aufbewahrung; eine Kasse, die man dafür stehenlässt, ist der Regelfall.
 *
 * ── WARUM AUFFRISCHEN KEINE SICHERHEIT WEGNIMMT ───────────────────────────
 *
 * Die Kennung selbst (`cert_serial`) kommt aus dem Schlüsselbund des
 * Betriebssystems und bleibt der Beweis; das Datum sagt nur, ob dieses Gerät
 * noch läuft. Ein Gerät, das seit zehn Jahren nicht mehr gestartet ist, fällt
 * weiterhin heraus — es kommt ja nie hierher.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const BEILAEUFER = [
  '../../sidecar/norns-sidecar.mjs',
  '../../../tauri-pos/src-tauri/resources/sidecar/norns-sidecar.mjs',
] as const;

/** Ohne Kommentare: der Kopf oben ZITIERT die alte Zeile. */
function nurCode(pfad: string): string {
  return readFileSync(fileURLToPath(new URL(pfad, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((z) => !z.trim().startsWith('//') && !z.trim().startsWith('--'))
    .join('\n');
}

describe('⛔ Das Gerät läuft nicht ab', () => {
  it.each(BEILAEUFER)('⛔ %s frischt das Ablaufdatum bei JEDEM Start auf', (pfad) => {
    const code = nurCode(pfad);
    const i = code.indexOf('ON CONFLICT (cert_serial) DO UPDATE');
    expect(i, 'die Geräte-Saat fehlt ganz').toBeGreaterThan(-1);
    // Der Rumpf der Konfliktauflösung, bis zum Ende der Abfrage.
    const rumpf = code.slice(i, code.indexOf('[KENNUNG]', i));
    expect(
      rumpf,
      'Die Konfliktauflösung frischt das Ablaufdatum NICHT auf. Zehn Jahre nach ' +
        'der Einrichtung weist der mTLS-Riegel dann jede Anfrage ab, auf einer ' +
        'Kasse, die täglich gestartet wurde.',
    ).toMatch(/cert_expires_at\s*=\s*now\(\)/);
  });

  it('⚠️ und der Riegel, der das erzwingt, steht weiterhin', () => {
    // Ohne ihn waere das Auffrischen sinnlos — und ein abgelaufenes Geraet
    // kaeme durch. Beides muss zusammen bestehen.
    const mtls = readFileSync(
      fileURLToPath(new URL('../../src/plugins/mtls.ts', import.meta.url)),
      'utf8',
    );
    expect(mtls).toMatch(/gt\(\s*devices\.certExpiresAt/);
  });
});

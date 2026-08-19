/**
 * Ein DYMO bleibt auch nach dem Neustart ein DYMO.
 *
 * ── DER FUND VOM 02.08.2026 ─────────────────────────────────────────────────
 *
 * Die Erkennung weiss aus der Geräteadresse `usb://DYMO/LabelWriter%20450`,
 * dass da ein Rasterdrucker hängt. Sie legt die Warteschlange richtig an, mit
 * dem Herstellertreiber. Der Rumpf kann den Rasterweg vollständig: er setzt
 * eine Seite (`label.rs:257`, `Auftrag::Seite`) und weigert sich sogar ehrlich,
 * wenn jemand ihn über Anschluss 9100 ansprechen will.
 *
 * Und dann stand in `DruckerErkennen.tsx`:
 *
 *     const SPEICHERBAR = ['ZPL', 'ESCPOS'];
 *
 * Die erkannte Sprache wurde also NICHT gespeichert. Der Händler bekam eine
 * höfliche Meldung („bitte melden, dann wird sie freigeschaltet"), die
 * Warteschlange stand richtig, die Kasse meldete Erfolg — und der Drucker
 * blieb auf ZPL stehen. Ein DYMO versteht kein ZPL. Er versteht ÜBERHAUPT
 * keine Steuerbytes. Also kam kein Papier.
 *
 * ── WARUM DIE WEICHE DAMALS RICHTIG WAR ────────────────────────────────────
 *
 * Sie war keine Nachlässigkeit, sondern ein Schutz vor etwas Schlimmerem.
 * `hardware-store.ts` prüft beim Start jede gespeicherte Einstellung gegen ein
 * Schema. Ein Wert, den das Schema nicht kennt, wirft die GANZE
 * Etiketten-Einstellung auf die Vorgabe zurück (Zeile 42, ausdrücklich so
 * gewollt gegen manipulierten Speicher). Ein gespeichertes „RASTER" hätte
 * geheissen: nach dem nächsten Neustart ist der Drucker spurlos vergessen.
 *
 * Deshalb ist die REIHENFOLGE dieses Wächters wichtig, und deshalb prüft er
 * das Schema ZUERST. Wer nur die Weiche entfernt, ohne das Schema zu
 * erweitern, baut aus einem stummen Drucker einen verschwindenden.
 */

import { describe, expect, it } from 'vitest';

import { LABEL_SCHEMA_FUER_PRUEFUNG, type LabelPrinterConfig } from './hardware-store.js';
import { Value } from '@sinclair/typebox/value';

/** Eine gültige Einstellung, wie die Übernahme sie schreibt. */
function einstellung(sprache: string): Record<string, unknown> {
  return {
    mode: 'system',
    ip: '',
    port: 9100,
    printerName: 'NRN-DYMO-LabelWriter-450',
    printerType: sprache,
    lastReachable: null,
    lastCheckedAt: null,
  };
}

describe('Die Rastersprache überlebt den Neustart', () => {
  it('das Schema kennt alle DREI Sprachen', () => {
    for (const s of ['ZPL', 'ESCPOS', 'RASTER']) {
      expect(
        Value.Check(LABEL_SCHEMA_FUER_PRUEFUNG, einstellung(s)),
        `„${s}" wird beim Start verworfen — der Drucker wäre nach einem Neustart vergessen`,
      ).toBe(true);
    }
  });

  it('und verwirft weiterhin, was es NICHT gibt', () => {
    // Der Schutz bleibt. Ohne diesen Satz wäre die Erweiterung ein Loch:
    // irgendein Wort aus manipuliertem Speicher käme bis zum Drucker durch.
    for (const s of ['TSPL', 'EPL', 'zpl', '', 'RASTER ']) {
      expect(
        Value.Check(LABEL_SCHEMA_FUER_PRUEFUNG, einstellung(s)),
        `„${s}" darf das Schema NICHT passieren`,
      ).toBe(false);
    }
  });

  it('der Typ lässt RASTER zu, ohne Umweg über eine Behauptung', () => {
    // Wäre der Typ nicht erweitert, müsste jede Zuweisung mit `as` arbeiten,
    // und genau solche Behauptungen verstecken den nächsten Fehler.
    const cfg: LabelPrinterConfig['printerType'] = 'RASTER';
    expect(cfg).toBe('RASTER');
  });

  it('die Vorgabe bleibt ZPL', () => {
    // Ein stiller Wechsel der Vorgabe wäre schlimmer als die Vermutung, die
    // dabeisteht: bestehende Kassen ohne gespeicherte Sprache druckten
    // plötzlich anders.
    expect(Value.Check(LABEL_SCHEMA_FUER_PRUEFUNG, einstellung('ZPL'))).toBe(true);
  });
});

/**
 * Prüfungen für die Scanner-Erkennung.
 *
 * Geprüft wird die reine Entscheidungslogik (`createScanDetector`), nicht der
 * React-Haken: die Kasse fährt ihre Prüfungen in einer Umgebung ohne DOM, und
 * die Frage „ist das ein Scan?" hängt ausschliesslich an Zeichen und Zeit.
 * Die Uhr wird eingespeist statt gestellt — jeder Anschlag trägt seinen
 * Zeitpunkt selbst, dadurch sind die Abstände hier auf die Millisekunde genau
 * dieselben wie am Tresen.
 */

import { describe, expect, it } from 'vitest';

import {
  createScanDetector,
  maxTotalMsForLength,
  type ScanVerdict,
} from './useBarcodeScanner.js';

/**
 * Tippt eine Zeichenfolge mit festem Abstand und schliesst mit Enter ab.
 * Der erste Anschlag liegt bewusst nicht bei 0, damit ein versehentlicher
 * Ersatzwert 0 in der Logik nicht unbemerkt durchginge.
 */
function tippe(code: string, abstandMs: number, startAt = 5_000): ScanVerdict {
  const detector = createScanDetector();
  let at = startAt;
  for (const zeichen of code) {
    detector.feed({ key: zeichen, at });
    at += abstandMs;
  }
  // Enter folgt im selben Takt wie die Zeichen davor.
  return detector.feed({ key: 'Enter', at });
}

describe('createScanDetector — echte Etiketten am Tresen', () => {
  it('erkennt eine EAN-13 bei 16 ms Abstand', () => {
    // 13 Zeichen, 12 Abstände à 16 ms = 192 ms.
    const verdict = tippe('4006381333931', 16);
    expect(verdict).toEqual({ kind: 'scan', code: '4006381333931' });
  });

  it('erkennt eine EAN-13 auch bei 20 ms Abstand (Funkgerät)', () => {
    // 12 Abstände à 20 ms = 240 ms. GENAU dieser Fall fiel unter der alten
    // festen Grenze von 200 ms lautlos durch: der Mensch scannte, nichts
    // geschah, er scannte nochmal.
    const verdict = tippe('4006381333931', 20);
    expect(verdict).toEqual({ kind: 'scan', code: '4006381333931' });
  });

  it('erkennt eine 22-stellige Artikelnummer bei 20 ms Abstand', () => {
    // 22 Zeichen, 21 Abstände à 20 ms = 420 ms. Unter der alten Grenze war
    // eine so lange Nummer NIE einlesbar — selbst bei 10 ms je Zeichen
    // hätte sie 210 ms gebraucht.
    const code = 'W14-0000123456789ABCDE';
    expect(code).toHaveLength(22);
    expect(tippe(code, 20)).toEqual({ kind: 'scan', code });
  });

  it('erkennt einen trägen Scanner bei 30 ms Abstand', () => {
    const verdict = tippe('4006381333931', 30);
    expect(verdict).toEqual({ kind: 'scan', code: '4006381333931' });
  });
});

describe('createScanDetector — was kein Scan ist', () => {
  it('lehnt einen Menschen ab, der 123456 mit 150 ms Abstand tippt', () => {
    expect(tippe('123456', 150)).toEqual({ kind: 'reject' });
  });

  it('lehnt auch einen sehr schnellen Menschen bei 45 ms Abstand ab', () => {
    // Jeder EINZELNE Abstand bliebe unter der 50-ms-Regel. Erst die an die
    // Länge gekoppelte Gesamtgrenze fängt diesen Fall: 12 × 45 = 540 ms
    // gegen erlaubte 480 ms. Deshalb ist die Gesamtgrenze weiterhin nötig
    // und nicht bloss Zierde.
    expect(tippe('4006381333931', 45)).toEqual({ kind: 'reject' });
  });

  it('lehnt einen Lauf mit 300 ms Pause in der Mitte ab', () => {
    const detector = createScanDetector();
    let at = 5_000;
    for (const zeichen of '4006381') {
      detector.feed({ key: zeichen, at });
      at += 16;
    }
    at += 300; // Der Mensch stockt.
    for (const zeichen of '333931') {
      detector.feed({ key: zeichen, at });
      at += 16;
    }
    // Nach der Pause beginnt der Puffer neu; die verbliebenen sechs Zeichen
    // sind nicht der Code auf dem Etikett, also darf nichts gemeldet werden,
    // das den falschen Artikel treffen könnte.
    const verdict = detector.feed({ key: 'Enter', at });
    expect(verdict).not.toEqual({ kind: 'scan', code: '4006381333931' });
  });

  it('lehnt zu kurze Läufe ab', () => {
    expect(tippe('12345', 16)).toEqual({ kind: 'reject' });
  });

  it('lehnt einen Lauf von 400 Zeichen ab', () => {
    // Kein Etikett, sondern eine klemmende Taste oder eingefügter Text.
    expect(tippe('7'.repeat(400), 16)).toEqual({ kind: 'reject' });
  });

  it('meldet aus einem überlangen Lauf keinen abgeschnittenen Rest', () => {
    // Diese Prüfung hat einen echten Fehler in der Obergrenze gefunden:
    // beim Überlauf wurde der Puffer nur geleert, der Lauf begann danach
    // stillschweigend von vorn, und die letzten zehn Zeichen meldeten sich
    // als gültiger Scan. Am Tresen wäre so ein abgeschnittener Code auf den
    // falschen Artikel gelaufen.
    for (const laenge of [400, 130, 131, 66, 70, 129]) {
      const verdict = tippe('7'.repeat(laenge), 16);
      expect(verdict, `Lauf mit ${laenge} Zeichen`).toEqual({ kind: 'reject' });
    }
  });

  it('nimmt nach einer echten Pause wieder normal an', () => {
    // Die Sperre eines überlangen Laufs darf den Scanner nicht dauerhaft
    // taub machen — sobald der Mensch absetzt, zählt der nächste Scan.
    const detector = createScanDetector();
    let at = 5_000;
    for (let i = 0; i < 200; i += 1) {
      detector.feed({ key: '7', at });
      at += 16;
    }
    at += 400; // Der Mensch setzt ab.
    for (const zeichen of '4006381333931') {
      detector.feed({ key: zeichen, at });
      at += 16;
    }
    expect(detector.feed({ key: 'Enter', at })).toEqual({
      kind: 'scan',
      code: '4006381333931',
    });
  });

  it('bricht bei einer Sondertaste mitten im Lauf ab', () => {
    const detector = createScanDetector();
    let at = 5_000;
    for (const zeichen of '40063813339') {
      detector.feed({ key: zeichen, at });
      at += 16;
    }
    detector.feed({ key: 'ArrowLeft', at });
    at += 16;
    for (const zeichen of '31') {
      detector.feed({ key: zeichen, at });
      at += 16;
    }
    // Die Sondertaste verwirft den angefangenen Lauf. Danach bleiben zwei
    // Zeichen übrig, und die sind kein Etikett.
    expect(detector.feed({ key: 'Enter', at })).toEqual({ kind: 'reject' });
  });

  it('meldet nach einer Sondertaste NIE den zusammengeklebten Code', () => {
    const detector = createScanDetector();
    let at = 5_000;
    for (const zeichen of '400638') {
      detector.feed({ key: zeichen, at });
      at += 16;
    }
    detector.feed({ key: 'ArrowLeft', at });
    at += 16;
    for (const zeichen of '1333931') {
      detector.feed({ key: zeichen, at });
      at += 16;
    }
    // Der Rest hinter der Sondertaste ist selbst lang und schnell genug, um
    // als EIGENER Scan zu gelten — das ist gewollt. Verboten ist nur, dass
    // die beiden Hälften zu einem Code verschmelzen, der nie gescannt wurde.
    expect(detector.feed({ key: 'Enter', at })).not.toEqual({
      kind: 'scan',
      code: '4006381333931',
    });
  });

  it('bricht bei Strg-Anschlägen ab (eingefügter Text ist kein Scan)', () => {
    const detector = createScanDetector();
    let at = 5_000;
    detector.feed({ key: 'v', at, ctrlKey: true });
    at += 16;
    for (const zeichen of '4006381333931') {
      detector.feed({ key: zeichen, at, ctrlKey: true });
      at += 16;
    }
    expect(detector.feed({ key: 'Enter', at })).toEqual({ kind: 'reject' });
  });
});

describe('maxTotalMsForLength — das Budget wächst mit der Länge', () => {
  it('gibt einer EAN-13 mehr Zeit als der alten festen Grenze von 200 ms', () => {
    expect(maxTotalMsForLength(13)).toBeGreaterThan(200);
  });

  it('gibt einer längeren Nummer mehr Zeit als einer kürzeren', () => {
    expect(maxTotalMsForLength(22)).toBeGreaterThan(maxTotalMsForLength(13));
  });

  it('bleibt im Schnitt unter der Abstandsgrenze von 50 ms je Zeichen', () => {
    // Sonst wäre die Gesamtgrenze wirkungslos, weil die Abstandsregel sie
    // ohnehin schon einhielte.
    for (const len of [6, 13, 22, 48, 64]) {
      expect(maxTotalMsForLength(len)).toBeLessThan((len - 1) * 50);
    }
  });
});

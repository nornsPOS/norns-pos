/**
 * DER WÄCHTER ÜBER DIE LÜCKE ZWISCHEN FELDPRÜFUNG UND SERVERPRÜFUNG.
 *
 * Die Kasse prüft Berater- und Mandantennummer schon im Feld, damit der
 * Händler einen Vertipper VOR der Gerätecode-Abfrage bemerkt. Damit laufen
 * zwei Regelwerke nebeneinander: dieses hier und `pruefeDatevEinstellung` in
 * `apps/api-cloud/src/lib/kontenrahmen.ts`.
 *
 * Zwei nebeneinander laufende Regelwerke driften. Driften sie auseinander,
 * gibt es genau zwei Ausgänge, und beide sind schlecht:
 *   • die Kasse ist STRENGER als der Server → sie weist eine Nummer ab, die
 *     der Steuerberater wirklich vergeben hat, und der Export bleibt zu;
 *   • die Kasse ist LOCKERER als der Server → sie lässt durch, was der Server
 *     dann abweist — nach der Gerätecode-Abfrage, also genau dort, wo der
 *     Händler es am wenigsten erwartet.
 *
 * Darum liest dieser Wächter den ECHTEN Serverquelltext und holt die zwei
 * Regeln daraus, statt sie hier abzuschreiben. Eine abgeschriebene Liste wäre
 * genau dann nicht rot, wenn der Server sich ändert — der einzige Moment, auf
 * den es ankommt.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  pruefeBeraternummer,
  pruefeMandantennummer,
  pruefeSachkontenlaenge,
  pruefeWirtschaftsjahrBeginn,
} from './datev-mandant-pruefung.js';

const HIER = dirname(fileURLToPath(import.meta.url));
/** apps/tauri-pos/src/lib → Wurzel → apps/api-cloud/src/lib/kontenrahmen.ts */
const SERVER_QUELLE = join(
  HIER,
  '..',
  '..',
  '..',
  '..',
  'apps',
  'api-cloud',
  'src',
  'lib',
  'kontenrahmen.ts',
);

/**
 * Der Server ist ein Nachbarpaket derselben Arbeitskopie. Fehlt er, ist der
 * Wächter blind — darum sagt er das laut, statt sich still zu überspringen.
 * Ein Wächter, der stumm aussetzt, meldet grün, wo niemand hingesehen hat.
 */
function serverQuelltext(): string {
  return readFileSync(SERVER_QUELLE, 'utf8');
}

describe('die Serverregeln stehen dort, wo dieser Wächter sie sucht', () => {
  it('findet den Zweig der Beraternummer samt seiner Ziffernregel', () => {
    const text = serverQuelltext();
    expect(text).toContain("case 'datev.beraternummer':");
    // Die Regel des Servers, wörtlich. Ändert er sie, fällt diese Zeile.
    expect(text).toContain('/^\\d{4,7}$/');
  });

  it('findet den Zweig der Mandantennummer samt Ziffernregel und Untergrenze', () => {
    const text = serverQuelltext();
    expect(text).toContain("case 'datev.mandantennummer':");
    expect(text).toContain('/^\\d{1,5}$/');
    expect(text).toContain('Number(roh) < 1');
  });
});

describe('Beraternummer — vier bis sieben Ziffern', () => {
  it('nimmt die Ränder an: vier und sieben Ziffern', () => {
    expect(pruefeBeraternummer('1234')).toBeNull();
    expect(pruefeBeraternummer('1234567')).toBeNull();
    // Eine echte Beraternummer aus dem Bestand, fünfstellig.
    expect(pruefeBeraternummer('29098')).toBeNull();
  });

  it('weist eine Ziffer zu wenig und eine zu viel ab', () => {
    expect(pruefeBeraternummer('123')).toContain('vier bis sieben Ziffern');
    expect(pruefeBeraternummer('12345678')).toContain('vier bis sieben Ziffern');
  });

  it('weist Leeres und Nicht-Ziffern ab, jeweils mit dem eigenen Satz', () => {
    expect(pruefeBeraternummer('')).toBe('Bitte die Beraternummer eintragen.');
    expect(pruefeBeraternummer('   ')).toBe('Bitte die Beraternummer eintragen.');
    expect(pruefeBeraternummer('12a45')).toBe('Die Beraternummer besteht nur aus Ziffern.');
    // Ein Punkt oder Komma ist keine Ziffer — sonst ginge „1.234" durch und
    // der Server bekäme etwas, das er nicht kennt.
    expect(pruefeBeraternummer('1.234')).toBe('Die Beraternummer besteht nur aus Ziffern.');
  });

  it('lässt umschliessende Leerzeichen zu — abgetippt wird oft mit Rand', () => {
    expect(pruefeBeraternummer('  29098  ')).toBeNull();
  });
});

describe('Mandantennummer — eine bis fünf Ziffern, mindestens 1', () => {
  it('nimmt die Ränder an: eine und fünf Ziffern', () => {
    expect(pruefeMandantennummer('1')).toBeNull();
    expect(pruefeMandantennummer('99999')).toBeNull();
  });

  it('weist sechs Ziffern ab', () => {
    expect(pruefeMandantennummer('123456')).toContain('eine bis fünf Ziffern');
  });

  it('weist die Null ab — sie ist keine Mandantennummer', () => {
    expect(pruefeMandantennummer('0')).toBe('Die Mandantennummer ist mindestens 1.');
    expect(pruefeMandantennummer('000')).toBe('Die Mandantennummer ist mindestens 1.');
  });

  it('weist Leeres und Nicht-Ziffern ab', () => {
    expect(pruefeMandantennummer('')).toBe('Bitte die Mandantennummer eintragen.');
    expect(pruefeMandantennummer('-1')).toBe('Die Mandantennummer besteht nur aus Ziffern.');
  });
});

describe('kein Satz dieser Fläche verrät einen rohen Schlüsselnamen', () => {
  /**
   * Am Tresen steht ein Mensch, kein Entwickler. `datev.beraternummer` ist ein
   * Datenbankschlüssel und hat in einer Fehlerzeile nichts verloren — dieselbe
   * Regel, nach der die Serverfläche ihre Klartexte führt.
   */
  it('nennt weder Punkt-Schlüssel noch Grossbuchstaben-Kennungen', () => {
    const saetze = [
      pruefeBeraternummer(''),
      pruefeBeraternummer('123'),
      pruefeBeraternummer('x'),
      pruefeMandantennummer(''),
      pruefeMandantennummer('0'),
      pruefeMandantennummer('123456'),
      pruefeMandantennummer('x'),
    ].filter((s): s is string => s !== null);

    expect(saetze.length).toBe(7);
    for (const s of saetze) {
      expect(s).not.toContain('datev.');
      expect(s).not.toMatch(/[A-Z]{2,}_[A-Z]/);
    }
  });
});

describe('Wirtschaftsjahr-Beginn — JJJJ-MM-TT, wie der Server ihn verlangt', () => {
  it('nimmt den Regelfall an', () => {
    expect(pruefeWirtschaftsjahrBeginn('2026-01-01')).toBeNull();
    expect(pruefeWirtschaftsjahrBeginn(' 2026-07-01 ')).toBeNull();
  });
  it('weist die Kurzform MM-TT ab, die früher sogar die Meldung empfahl', () => {
    // ⚠️ KLARTEXT in `datev-mandant.ts` sagte bis zum 12.08.2026 „als MM-TT" —
    // der Server lehnte genau diese Form ab. Wer der Meldung folgte, scheiterte.
    expect(pruefeWirtschaftsjahrBeginn('01-01')).not.toBeNull();
  });
  it('weist Unmögliches ab', () => {
    expect(pruefeWirtschaftsjahrBeginn('2026-13-01')).not.toBeNull();
    expect(pruefeWirtschaftsjahrBeginn('2026-00-10')).not.toBeNull();
    expect(pruefeWirtschaftsjahrBeginn('')).not.toBeNull();
  });
});

describe('Sachkontenlänge — vier bis acht', () => {
  it('nimmt die Ränder an', () => {
    expect(pruefeSachkontenlaenge('4')).toBeNull();
    expect(pruefeSachkontenlaenge('8')).toBeNull();
  });
  it('weist ausserhalb und Nicht-Zahlen ab', () => {
    expect(pruefeSachkontenlaenge('3')).not.toBeNull();
    expect(pruefeSachkontenlaenge('9')).not.toBeNull();
    expect(pruefeSachkontenlaenge('vier')).not.toBeNull();
    expect(pruefeSachkontenlaenge('')).not.toBeNull();
  });
});

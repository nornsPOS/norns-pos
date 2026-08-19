/**
 * ════════════════════════════════════════════════════════════════════════
 *  ⚠️ Der Lizenzriegel darf NIEMALS einen fiskalischen Weg schliessen
 * ════════════════════════════════════════════════════════════════════════
 *
 * Das ist der teuerste Fehler, den dieses System machen könnte, und er wäre
 * leicht zu machen: „Wer nicht zahlt, kann nichts mehr" klingt vernünftig,
 * bis man zu Ende denkt.
 *
 * Eine abgelaufene Lizenz, die den TAGESABSCHLUSS verhindert, zwingt den
 * Händler in die Ordnungswidrigkeit nach § 146a AO. Eine, die die
 * DSFinV-K- oder DATEV-AUSFUHR verhindert, nimmt ihm die Vorlagefähigkeit
 * nach § 147 AO — zehn Jahre lang, und ausgerechnet in dem Moment, in dem
 * der Prüfer im Laden steht. Eine, die den STORNO verhindert, lässt ihn auf
 * einem falschen Beleg sitzen, den er nicht mehr berichtigen kann.
 *
 * Wir würden einen Schalter bauen, der unseren zahlenden Kunden ins Unrecht
 * setzt. Kein Umsatz der Welt ist das wert.
 *
 * ── WAS DIESER WÄCHTER MISST ────────────────────────────────────────────
 *
 * Den GEBRAUCH, nicht die Erwähnung: er liest die Routen des Servers,
 * entfernt Kommentare und verlangt, dass `verkaufIstFreigegeben` in GENAU
 * den Dateien aufgerufen wird, die einen NEUEN Vorgang anlegen — und in
 * keiner einzigen anderen.
 *
 * Er wird also rot, sobald jemand den Riegel „der Vollständigkeit halber"
 * auch an den Abschluss oder an eine Ausfuhr hängt.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { LIZENZ_FEHLT_SATZ, verkaufIstFreigegeben } from '../../src/lib/lizenz-riegel.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const ROUTEN = join(HIER, '../../src/routes');

/** Die EINZIGEN Routen, die den Riegel tragen dürfen. */
const DARF_SPERREN = ['transactions-finalize.ts', 'transactions-ankauf.ts'];

function ohneKommentare(quelle: string): string {
  return quelle
    .split('\n')
    .filter((z) => {
      const t = z.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

/** Welche Routendateien rufen den Riegel wirklich auf? */
function routenMitRiegel(): string[] {
  return readdirSync(ROUTEN)
    .filter((n) => n.endsWith('.ts'))
    .filter((n) =>
      /verkaufIstFreigegeben\s*\(/.test(ohneKommentare(readFileSync(join(ROUTEN, n), 'utf8'))),
    );
}

describe('⛔ Der Lizenzriegel und die fiskalischen Wege', () => {
  it('sperrt GENAU den Verkauf und den Ankauf, sonst nichts', () => {
    expect(routenMitRiegel().sort()).toEqual([...DARF_SPERREN].sort());
  });

  it('⛔ und rührt Abschluss, Storno und die Ausfuhren NICHT an', () => {
    // Namentlich, damit der Fehlgriff einen Namen bekommt statt einer Zahl.
    const heilig = readdirSync(ROUTEN).filter(
      (n) =>
        n.startsWith('closing') ||
        n.startsWith('transactions-storno') ||
        n.includes('export') ||
        n.includes('datev') ||
        n.includes('dsfinv'),
    );
    expect(heilig.length, 'keine fiskalischen Routen gefunden — Pfad falsch?').toBeGreaterThan(2);

    for (const datei of heilig) {
      const quelle = ohneKommentare(readFileSync(join(ROUTEN, datei), 'utf8'));
      expect(
        quelle,
        `${datei} fragt nach der Lizenz. Eine abgelaufene Lizenz darf einen ` +
          'Haendler nicht daran hindern, seinen Tag abzuschliessen, einen ' +
          'falschen Beleg zu stornieren oder dem Finanzamt seine Daten ' +
          'vorzulegen (§ 146a, § 147 AO).',
      ).not.toMatch(/verkaufIstFreigegeben|LIZENZ_FEHLT/);
    }
  });
});

describe('Der Riegel selbst', () => {
  it('ist offen, wenn der Rumpf nichts sagt', () => {
    // Entwicklung, Tests, ein Server ohne Rumpf: ein Riegel, der bei
    // fehlender Angabe zuschlaegt, legt jede fremde Umgebung still.
    expect(verkaufIstFreigegeben({})).toBe(true);
    expect(verkaufIstFreigegeben({ NORNS_VERKAUF_FREI: '1' })).toBe(true);
  });

  it('schliesst NUR bei der ausdruecklichen Null', () => {
    expect(verkaufIstFreigegeben({ NORNS_VERKAUF_FREI: '0' })).toBe(false);
    expect(verkaufIstFreigegeben({ NORNS_VERKAUF_FREI: ' 0 ' })).toBe(false);
  });

  it('sagt dem Kassierer, was NOCH geht', () => {
    expect(LIZENZ_FEHLT_SATZ).toContain('Tagesabschluss');
    expect(LIZENZ_FEHLT_SATZ).toContain('Finanzamt');
    expect(LIZENZ_FEHLT_SATZ).toContain('Storno');
    // Kein Code, keine Kennung — der Kassierer ist kein Entwickler.
    expect(LIZENZ_FEHLT_SATZ).not.toContain('_');
  });
});

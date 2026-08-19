/**
 * Ein Tag mit unsignierten Belegen schliesst nicht AUS VERSEHEN.
 *
 * ── DER FUND VOM 01.08.2026 ─────────────────────────────────────────────────
 *
 * `closings-finalize.ts` ermittelt die fehlenden Signaturen seit jeher
 * sorgfältig: ein echter Anti-Join, an die TRANSAKTIONEN des Tages gebunden
 * und nicht an die Aufzeichnungszeit der Signatur, mit einem Kommentar, der
 * genau erklärt warum (ein Verkauf kurz vor Mitternacht wird sonst dem
 * falschen Tag zugeschlagen). Die Zahl wandert in `tse_pending_count`.
 *
 * Und sie bewirkte NICHTS. Ein Tag mit null Signaturen wurde normal
 * abgeschlossen. Die Zeile sagte danach FINALIZED, als wäre der Tag
 * vollständig.
 *
 * Das ist die stillste Art des Fehlers: nicht eine fehlende Messung, sondern
 * eine gemessene Zahl ohne Folge.
 *
 * ── WARUM KEIN VERBOT ──────────────────────────────────────────────────────
 *
 * Ein harter Riegel wäre hier falsch, und das ist keine Bequemlichkeit:
 *
 *   • Der Z-Bon ist SELBST eine fiskale Aufzeichnung. Ein Tag, der nie
 *     geschlossen werden kann, reisst eine grössere Lücke als einer mit
 *     nachzuholenden Signaturen.
 *   • Die Wolken-TSE kann stundenlang weg sein, und auf einer Kasse ohne Netz
 *     ist genau das der Regelfall (siehe
 *     `kein-verkauf-ohne-sicherungseinrichtung.test.ts`).
 *
 * Deshalb: nicht verboten, sondern nicht aus Versehen. Ohne Bestätigung hält
 * der Abschluss an und NENNT DIE ZAHL. Mit ihr läuft er, und die Bestätigung
 * steht danach in der Notiz der Abschlusszeile, wo ein Prüfer sie findet.
 *
 * Dieser Wächter prüft beide Hälften UND den Vermerk. Ein Riegel, der anhält,
 * aber nichts aufschreibt, verlegt das Problem nur vom Abschluss in die
 * Erinnerung des Menschen.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const ABSCHLUSS = join(HIER, '../../src/routes/closings-finalize.ts');

function quelle(): string {
  return readFileSync(ABSCHLUSS, 'utf8');
}

/** Kommentare weg: eine Erklärung ist kein Riegel. */
function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('Der Tagesabschluss verschweigt keine fehlende Signatur', () => {
  it('findet die Datei — sonst prüft dieser Test nichts', () => {
    expect(quelle().length).toBeGreaterThan(5000);
  });

  it('zählt die fehlenden Signaturen weiterhin über einen echten Anti-Join', () => {
    // Die Messung war nie das Problem. Sie darf beim Nachrüsten des Riegels
    // nicht versehentlich vereinfacht werden.
    const rumpf = ohneKommentare(quelle());
    expect(rumpf).toMatch(/LEFT JOIN tse_signatures/);
    expect(rumpf).toMatch(/FILTER \(WHERE s\.transaction_id IS NULL\)/);
  });

  it('die Zahl hat eine FOLGE, nicht nur eine Spalte', () => {
    // Der eigentliche Fund: bis heute wurde `pending` nur gespeichert.
    const rumpf = ohneKommentare(quelle());
    expect(rumpf).toMatch(/pending > 0/);
  });

  it('hält ohne Bestätigung an und NENNT die Zahl', () => {
    const rumpf = ohneKommentare(quelle());
    const stelle = /pending > 0[\s\S]{0,900}/.exec(rumpf)?.[0] ?? '';
    expect(stelle).toMatch(/throw new ClosingConflictError/);
    // Die Zahl muss im Satz stehen. „Es fehlen Signaturen" ohne Anzahl lässt
    // den Menschen raten, ob es einer ist oder vierzig.
    expect(stelle).toMatch(/\$\{pending\}/);
  });

  it('VERBIETET den Abschluss nicht — mit Bestätigung läuft er', () => {
    // Die zweite Hälfte. Ein Tag, der nie geschlossen werden kann, ist
    // schlimmer als einer mit nachzuholenden Signaturen.
    const rumpf = ohneKommentare(quelle());
    expect(rumpf).toMatch(/unsignierteBelegeBestaetigt/);
    expect(rumpf).toMatch(/pending > 0 && !bestaetigt/);
  });

  it('schreibt die Lücke in die Abschlusszeile, nicht nur in den Augenblick', () => {
    // Ein Riegel, der anhält aber nichts aufschreibt, verlegt das Problem in
    // die Erinnerung des Menschen. Der Prüfer liest die Zeile, nicht ihn.
    const rumpf = ohneKommentare(quelle());
    expect(rumpf).toMatch(/tseVermerk/);
    expect(quelle()).toMatch(/ohne TSE-Signatur zum/);
    // Und der Vermerk muss WIRKLICH in der eingefügten Notiz landen.
    expect(rumpf).toMatch(/notiz\b/);
    expect(rumpf).toMatch(/\$\{notiz\}/);
  });

  it('der Vermerk erscheint nur, wenn wirklich etwas fehlt', () => {
    // Sonst trüge jede saubere Abschlusszeile einen Mangelvermerk, und der
    // Vermerk wäre nach drei Tagen Rauschen.
    const rumpf = ohneKommentare(quelle());
    const stelle = /const tseVermerk[\s\S]{0,400}/.exec(rumpf)?.[0] ?? '';
    expect(stelle).toMatch(/pending > 0[\s\S]{0,40}\?/);
    expect(stelle).toMatch(/:\s*null/);
  });
});

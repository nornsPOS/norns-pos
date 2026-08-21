// @vitest-environment node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Kein fiskaler Tisch bekommt tabellenweites Schreibrecht
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DIE DISZIPLIN, DIE ALLES ANDERE TRÄGT ─────────────────────────────────
 *
 * Die Kassenrolle `warehouse14_app` darf auf fiskalen Tischen NIE frei
 * schreiben. Wo sie überhaupt ändern darf, geschieht das SPALTENWEISE — und
 * jede Spalte ist eine einzelne, begründete Entscheidung in einer Wanderung.
 *
 * Gemessen am 21.08.2026 über alle Wanderungen: 118 Rechte an die Kassenrolle,
 * davon 74 spaltenweise. Kein einziger fiskaler Tisch stand tabellenweit
 * schreibend offen.
 *
 * ── WARUM DAS EINEN WÄCHTER VERDIENT ──────────────────────────────────────
 *
 * Es ist eine Zusage, die man nur durch UNTERLASSEN hält: niemand baut sie
 * ein, jeder kann sie mit einer bequemen Zeile brechen —
 *
 *     GRANT UPDATE ON transactions TO warehouse14_app;
 *
 * — und nichts fiele auf. Die Kasse liefe weiter, alle Proben blieben grün,
 * und die Unveränderlichkeit nach § 146 Abs. 4 AO wäre still aufgehoben.
 *
 * ⚠️ WORAN ICH SELBST GEMERKT HABE, DASS ES TRÄGT: beim Notfallschlüssel
 * (20.08.) liefen zwölf Proben rot mit „permission denied for table users",
 * weil ich die fünf neuen Spalten nicht einzeln freigegeben hatte. Der Riegel
 * ist kein Zierat — er greift wirklich, und er greift zuerst am ECHTEN
 * Postgres.
 *
 * ── DIE LISTE ─────────────────────────────────────────────────────────────
 *
 * Was ein Prüfer unverändert vorfinden muss: die Belege selbst, ihre
 * Positionen, das Hauptbuch, das Tagebuch, die Abschlüsse und alles, was die
 * Sicherungseinrichtung geschrieben hat.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const WANDERUNGEN = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../../packages/db/migrations',
);

/** Die Tische, die ein Prüfer unverändert vorfinden muss. */
const FISKAL = [
  'transactions',
  'transaction_items',
  'transaction_payments',
  'ledger_events',
  'audit_log',
  'daily_closings',
  'tse_transactions',
  'tse_signatures',
  'tse_clients',
] as const;

/** Rechte, die einen Tisch veränderbar machen. */
const SCHREIBEND = /\b(UPDATE|DELETE|TRUNCATE)\b/;

interface Fund {
  datei: string;
  tabelle: string;
  rechte: string;
}

/** Jedes GRANT an die Kassenrolle, aus allen Wanderungen. */
function grants(): Fund[] {
  const raus: Fund[] = [];
  for (const datei of readdirSync(WANDERUNGEN).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(WANDERUNGEN, datei), 'utf8');
    for (const m of sql.matchAll(
      /GRANT\s+([A-Z, ()a-z_\n]+?)\s+ON\s+(?:TABLE\s+)?([a-z_]+)\s+TO\s+warehouse14_app/g,
    )) {
      raus.push({
        datei,
        rechte: (m[1] ?? '').replace(/\s+/g, ' ').trim(),
        tabelle: m[2] ?? '',
      });
    }
  }
  return raus;
}

describe('⛔ Kein fiskaler Tisch steht offen', () => {
  const alle = grants();

  it('findet die Rechte überhaupt — sonst misst dieser Wächter nichts', () => {
    expect(alle.length, 'keine GRANTs gefunden; das Muster passt nicht mehr').toBeGreaterThan(50);
  });

  it('⛔ kein fiskaler Tisch bekommt TABELLENWEITES Schreibrecht', () => {
    // Spaltenweise Rechte tragen eine Klammer: `UPDATE (spalte, …)`.
    const offen = alle
      .filter((g) => (FISKAL as readonly string[]).includes(g.tabelle))
      .filter((g) => SCHREIBEND.test(g.rechte) && !g.rechte.includes('('))
      .map((g) => `${g.tabelle}: ${g.rechte}  (${g.datei})`);

    expect(
      offen,
      'Ein fiskaler Tisch wurde tabellenweit zum Schreiben freigegeben. Damit ist ' +
        'die Unveränderlichkeit nach § 146 Abs. 4 AO still aufgehoben — die Kasse ' +
        'läuft weiter, alle Proben bleiben grün, und ein Prüfer findet einen ' +
        'Bestand vor, der sich ändern liess. Wenn eine Spalte wirklich beweglich ' +
        'sein MUSS, dann spaltenweise: GRANT UPDATE (spalte) ON …',
    ).toEqual([]);
  });

  it('⚠️ und wo ein fiskaler Tisch überhaupt änderbar ist, dann spaltenweise', () => {
    const fiskaleAenderungen = alle
      .filter((g) => (FISKAL as readonly string[]).includes(g.tabelle))
      .filter((g) => SCHREIBEND.test(g.rechte));
    // Es gibt solche Rechte (Abschlusszustand, Rückgabe-Zähler …) — sie sind
    // begründet und eng. Faende der Waechter GAR keine, waere der Satz oben
    // trivial erfuellt und niemand merkte, wenn das Muster nicht mehr passt.
    expect(
      fiskaleAenderungen.length,
      'keine fiskalen Aenderungsrechte gefunden — passt das GRANT-Muster noch?',
    ).toBeGreaterThan(0);
    for (const g of fiskaleAenderungen) {
      expect(g.rechte, `${g.tabelle} in ${g.datei}`).toContain('(');
    }
  });
});

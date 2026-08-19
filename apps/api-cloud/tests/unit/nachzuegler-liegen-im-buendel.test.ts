/**
 * ════════════════════════════════════════════════════════════════════════
 *  Jeder Nachzügler, den der Sidecar VERLANGT, muss auch mitreisen
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 07.08.2026 ───────────────────────────────────────────
 *
 * `norns-sidecar.mjs` führt eine Namensliste, `NACHZUEGLER`. Beim Start holt
 * er jeden Namen daraus und spielt ihn ein:
 *
 *     const imBuendel = join(HIER, 'erststart', 'nachzuegler', n);
 *     const imBaum    = join(HIER, '..','..','..','packages','db','migrations', n);
 *     await saat.query(readFileSync(existsSync(imBuendel) ? imBuendel : imBaum, 'utf8'));
 *
 * Am 06.08.2026 kam `0133_eine_ausgabe_weiss_womit_sie_bezahlt_wurde.sql` in
 * die Liste. Die Datei selbst wurde in KEINES der beiden Bündel gelegt.
 *
 * Auf dieser Maschine fiel das nicht auf: der zweite Pfad, der Arbeitsbaum,
 * existiert hier. Auf einer AUSGELIEFERTEN Kasse existiert er nicht. Dort
 * schlägt `readFileSync` fehl, der Sidecar stirbt beim Start, und die Kasse
 * öffnet nicht mehr. Nicht „eine Spalte fehlt" — die Kasse öffnet NICHT.
 *
 * ── WARUM DIESER WÄCHTER DIE LISTE LIEST STATT SIE ZU WIEDERHOLEN ───────
 *
 * Eine zweite, abgeschriebene Namensliste im Test wäre genau derselbe Fehler
 * noch einmal: sie driftet, und der grüne Lauf misst dann eine Liste, die
 * niemand mehr benutzt. Deshalb wird `NACHZUEGLER` aus dem echten Quelltext
 * des Sidecars gelesen. Kommt morgen ein Name dazu, prüft dieser Test ihn,
 * ohne dass jemand daran denken muss.
 *
 * ── WELCHE ZWEI BÜNDEL ES GIBT ─────────────────────────────────────────
 *
 *   apps/api-cloud/sidecar/erststart/nachzuegler/           ← die QUELLE
 *   apps/tauri-pos/src-tauri/resources/…/nachzuegler/       ← die BEIPACKKOPIE
 *
 * `release.yml:233` kopiert die Quelle beim Freigabebau in die Beipackkopie,
 * und `.gitignore:90` hält die Kopie aus der Versionsverwaltung heraus. Auf
 * einem frischen Klon gibt es sie also nicht, und das ist kein Fehler. Liegt
 * sie da, wird sie geprüft: ein örtliches `tauri build` packt genau sie ein,
 * unverändert. Das ist die Klasse „dist statt Quelle".
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '../../../..');

const SIDECAR = join(WURZEL, 'apps/api-cloud/sidecar/norns-sidecar.mjs');
const QUELLE = join(WURZEL, 'apps/api-cloud/sidecar/erststart/nachzuegler');
const BEIPACK = join(WURZEL, 'apps/tauri-pos/src-tauri/resources/sidecar/erststart/nachzuegler');
const WANDERUNGEN = join(WURZEL, 'packages/db/migrations');

/** Die Namensliste aus dem echten Quelltext des Sidecars. */
function verlangteNamen(): string[] {
  const text = readFileSync(SIDECAR, 'utf8');
  const block = /const NACHZUEGLER\s*=\s*\[([\s\S]*?)\];/.exec(text);
  if (block === null) {
    throw new Error(
      `NACHZUEGLER nicht gefunden in ${SIDECAR}. ` +
        'Wurde die Liste umbenannt, prüft dieser Wächter nichts mehr.',
    );
  }
  return [...(block[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
}

const BUENDEL: ReadonlyArray<{ rolle: string; pfad: string }> = [
  { rolle: 'QUELLE', pfad: QUELLE },
  ...(existsSync(BEIPACK) ? [{ rolle: 'BEIPACKKOPIE', pfad: BEIPACK }] : []),
];

describe('Nachzügler-Wanderungen reisen mit ins Erzeugnis', () => {
  it('findet die Liste im Sidecar — sonst misst dieser Test nichts', () => {
    const namen = verlangteNamen();
    expect(namen.length, 'leere Namensliste gelesen').toBeGreaterThan(0);
    for (const n of namen) {
      expect(n, `kein Wanderungsname: ${n}`).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
    }
  });

  it('⛔ JEDER verlangte Name liegt als Datei im Bündel', () => {
    // Der Befund vom 07.08.2026. Ohne diesen Satz stirbt eine ausgelieferte
    // Kasse beim Start, und zwar erst bei der ersten, die die Datei noch
    // nicht kennt — also beim Kunden, nicht hier.
    const fehlend: string[] = [];
    for (const { rolle, pfad } of BUENDEL) {
      for (const n of verlangteNamen()) {
        if (!existsSync(join(pfad, n))) fehlend.push(`${rolle}: ${n}`);
      }
    }
    expect(
      fehlend,
      'Diese Wanderungen werden beim Start VERLANGT, liegen aber in keinem ' +
        `Bündel. Auf einer ausgelieferten Kasse stirbt der Sidecar dabei:\n  ${fehlend.join('\n  ')}`,
    ).toEqual([]);
  });

  it('⚠️ und keine Datei liegt dort, die NIEMAND verlangt', () => {
    // Eine Datei ohne Eintrag wird nie eingespielt. Sie sieht im Ordner aus
    // wie erledigte Arbeit und ist keine — dieselbe Blindheit wie oben, nur
    // andersherum.
    const namen = verlangteNamen();
    const waisen: string[] = [];
    for (const { rolle, pfad } of BUENDEL) {
      for (const f of readdirSync(pfad).filter((x) => x.endsWith('.sql'))) {
        if (!namen.includes(f)) waisen.push(`${rolle}: ${f}`);
      }
    }
    expect(
      waisen,
      `Diese Dateien liegen im Bündel, werden aber nie eingespielt:\n  ${waisen.join('\n  ')}`,
    ).toEqual([]);
  });

  it('⛔ die gebündelte Fassung ist Zeichen für Zeichen die Wanderung selbst', () => {
    // Der Sidecar nimmt das Bündel, WENN es da ist, und sonst den Arbeitsbaum.
    // Driften die beiden, spielt die ausgelieferte Kasse anderes SQL ein als
    // jede Messung hier — und keine Prüfung sieht den Unterschied.
    const drift: string[] = [];
    for (const { rolle, pfad } of BUENDEL) {
      for (const n of verlangteNamen()) {
        const gebuendelt = join(pfad, n);
        const original = join(WANDERUNGEN, n);
        if (!existsSync(gebuendelt)) continue;
        if (!existsSync(original)) {
          drift.push(`${rolle}: ${n} hat keine Entsprechung in packages/db/migrations`);
          continue;
        }
        if (readFileSync(gebuendelt, 'utf8') !== readFileSync(original, 'utf8')) {
          drift.push(`${rolle}: ${n} weicht von packages/db/migrations ab`);
        }
      }
    }
    expect(drift, `Gebündelte Wanderung und Original driften:\n  ${drift.join('\n  ')}`).toEqual([]);
  });

  it('⛔ jede Wanderung, deren Objekte der Schema-Auszug NICHT kennt, steht in der Liste', () => {
    /**
     * Der zweite Weg, auf dem dieselbe Wunde entsteht, und der leisere:
     * jemand schreibt eine Wanderung, spielt sie hier von Hand ein, und trägt
     * sie NICHT in `NACHZUEGLER`. Auf dieser Maschine läuft danach alles. Eine
     * frische Kasse bekommt den Schema-Auszug und danach nichts mehr — ihr
     * fehlt die Spalte für immer, still, bis der erste Abruf sie sucht.
     *
     * ── WARUM NICHT „alles über Nummer N" ──────────────────────────────────
     *
     * Weil es diese Grenze nicht gibt. Am 07.08.2026 nachgemessen: der Auszug
     * kennt 0127 und 0128, aber NICHT 0125. Er ist ein pg_dump eines echten
     * Bestandes, keine saubere Reihe. Eine Nummerngrenze wäre eine erfundene
     * Ordnung, und sie würde 0125 fälschlich für gedeckt halten.
     *
     * Gemessen wird deshalb die SACHE: welche Tabelle, welchen Typ, welche
     * Spalte legt die Wanderung an, und steht der Name im Auszug? Fehlt er,
     * MUSS die Wanderung nachgezogen werden.
     *
     * ── WAS DIESER SATZ NICHT SIEHT ───────────────────────────────────────
     *
     * Wanderungen, die nichts Benennbares anlegen: eine Regel schärfen, einen
     * Auslöser tauschen, ein Recht vergeben. Drei Einträge der heutigen Liste
     * sind genau das (0128, 0130, 0131) — sie stehen zu Recht darin und sind
     * hier unsichtbar. Der Wächter ist also eine Untergrenze, kein Beweis.
     * Er fängt die häufige Hälfte: die neue Spalte, die niemand nachzieht.
     */
    const schema = readFileSync(join(WURZEL, 'apps/api-cloud/sidecar/erststart/schema.sql'), 'utf8');
    expect(schema.length, 'Schema-Auszug leer gelesen').toBeGreaterThan(100_000);

    /**
     * ── AUSGEZOGENE NAMEN (19.08.2026, Wanderung 0149) ─────────────────────
     *
     * Bis heute galt: fehlt ein angelegter Name im Auszug, MUSS die Wanderung
     * in NACHZUEGLER. Seit 0149 gibt es den zweiten ehrlichen Grund fuer ein
     * Fehlen: der Name ist AUSGEZOGEN — eine spaetere Wanderung, die selbst
     * in NACHZUEGLER steht, zieht ihn ueberall wieder aus. Eine frische Kasse
     * soll ihn dann gerade NICHT bekommen.
     *
     * Die Ausnahme ist KEINE Handliste: sie wird aus den DROP-Saetzen der
     * NACHZUEGLER-Wanderungen selbst gelesen. Faellt ein Drop-Satz dort weg,
     * faellt die Ausnahme mit — zwei Wahrheiten kann es so nicht geben.
     * Spalten, die eine alte Wanderung auf eine inzwischen ausgezogene
     * Tabelle setzte, sind ueber den Tabellennamen mit ausgenommen.
     */
    const ausgezogeneTabellen = new Set<string>();
    for (const nz of verlangteNamen()) {
      const pfad = join(WANDERUNGEN, nz);
      if (!existsSync(pfad)) continue;
      const sql = readFileSync(pfad, 'utf8');
      for (const t of sql.matchAll(/DROP\s+TABLE\s+IF\s+EXISTS\s+(?:public\.)?"?(\w+)"?/gi)) {
        ausgezogeneTabellen.add((t[1] as string).toLowerCase());
      }
      // Auch AUFZAEHLTYPEN koennen ausziehen (0149: die verwaisten Typen der
      // ausgezogenen Tabellen). Dieselbe Regel, dieselbe Quelle.
      for (const t of sql.matchAll(/DROP\s+TYPE\s+IF\s+EXISTS\s+(?:public\.)?"?(\w+)"?/gi)) {
        ausgezogeneTabellen.add((t[1] as string).toLowerCase());
      }
    }

    /** Die Dinge, die eine Wanderung neu ins Schema stellt und die einen Namen tragen. */
    const angelegteNamen = (sql: string): string[] => {
      const namen: string[] = [];
      const muster = [
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi,
        /CREATE\s+TYPE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi,
      ];
      for (const m of muster) for (const t of sql.matchAll(m)) namen.push(t[1] as string);
      // ADD COLUMN traegt seinen TABELLENNAMEN mit, damit eine Spalte auf
      // einer ausgezogenen Tabelle als ausgezogen erkannt wird.
      for (const t of sql.matchAll(
        /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?(\w+)"?[^;]*?ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi,
      )) {
        if (!ausgezogeneTabellen.has((t[1] as string).toLowerCase())) {
          namen.push(t[2] as string);
        }
      }
      // `IF`/`NOT` fallen an, wenn eine Schreibweise aus dem Muster fällt.
      return namen.filter(
        (n) =>
          !['if', 'not', 'exists'].includes(n.toLowerCase()) &&
          !ausgezogeneTabellen.has(n.toLowerCase()),
      );
    };

    const namen = verlangteNamen();
    const ungedeckt: string[] = [];
    for (const f of readdirSync(WANDERUNGEN).filter((x) => x.endsWith('.sql')).sort()) {
      if (namen.includes(f)) continue;
      const fehlt = angelegteNamen(readFileSync(join(WANDERUNGEN, f), 'utf8')).filter(
        (n) => !new RegExp(`\\b${n}\\b`).test(schema),
      );
      if (fehlt.length > 0) ungedeckt.push(`${f} → ${[...new Set(fehlt)].join(', ')}`);
    }

    expect(
      ungedeckt,
      'Diese Wanderungen legen etwas an, das der Schema-Auszug nicht kennt, und ' +
        'stehen nicht in NACHZUEGLER. Eine frische Kasse bekommt sie NIE:\n  ' +
        ungedeckt.join('\n  '),
    ).toEqual([]);
  });
});

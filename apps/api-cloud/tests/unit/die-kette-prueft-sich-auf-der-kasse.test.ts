// @vitest-environment node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Die Fiskalkette prüft sich auf der AUSGELIEFERTEN Kasse
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 21.08.2026 ──────────────────────────────────────────────
 *
 * `starteKettenpruefung` steht in `server.ts`. Der Beiläufer bootet aber
 * `buildApp` DIREKT und sagt es im eigenen Kopf: „`server.ts` bleibt
 * unberührt". Auf einer ausgelieferten Kasse lief die Selbstprüfung der
 * Prüfsummenkette damit NIE.
 *
 * Geprüft wurde die Kette nur beim Ziehen des Prüferpakets — und das kann
 * Monate auseinanderliegen. Ein Bruch fiele dann bei der Kassennachschau auf,
 * nicht am Tag danach.
 *
 * ── WARUM ES DIESE PROBE BRAUCHT ──────────────────────────────────────────
 *
 * Die Lücke war unsichtbar: der Aufruf STAND im Werk, nur eben in einer
 * Datei, die dieses Produkt nie ausführt. Am 08.08. wurde deshalb die ANZEIGE
 * ehrlich gemacht („nie geprüft" ist nicht grün) — die Lücke selbst blieb.
 *
 * Diese Probe misst den ausgelieferten Bootweg, nicht den, den es auch noch
 * gibt.
 *
 * ── UND WARUM DIE KOSTEN VERTRETBAR SIND ──────────────────────────────────
 *
 * GEMESSEN an echten Zeilen: `verify_ledger_chain()` läuft über 20 000 Zeilen
 * in 84 ms (0,0042 ms je Zeile). Ein Jahrzehnt einer belebten Kasse
 * (500 000 Zeilen) kostet 2,1 Sekunden — einmal beim Anlauf, danach täglich,
 * und NACH der Bereitmeldung.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { assertAppRoleInDatabaseUrl } from '../../src/config/env.js';
import type { Env } from '../../src/config/env.js';

/** Beide Abschriften des Beiläufers — die Kasse liefert ihre eigene aus. */
const BEILAEUFER = [
  '../../sidecar/norns-sidecar.mjs',
  '../../../tauri-pos/src-tauri/resources/sidecar/norns-sidecar.mjs',
] as const;

/** Ohne Kommentare: der Kopf oben ZITIERT den Befund. */
function nurCode(pfad: string): string {
  return readFileSync(fileURLToPath(new URL(pfad, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((z) => !z.trim().startsWith('//'))
    .join('\n');
}

describe('⛔ Die Fiskalkette prüft sich auf der ausgelieferten Kasse', () => {
  it.each(BEILAEUFER)('⛔ %s startet die Selbstprüfung', (pfad) => {
    const code = nurCode(pfad);
    expect(
      code,
      'Ohne diesen Aufruf prüft die ausgelieferte Kasse ihre Prüfsummenkette ' +
        'NIE — nur das Prüferpaket täte es, und das kann Monate auseinanderliegen.',
    ).toMatch(/starteKettenpruefung\(app\)/);
  });

  it.each(BEILAEUFER)('⚠️ %s startet sie NACH der Bereitmeldung', (pfad) => {
    const code = nurCode(pfad);
    const bereit = code.indexOf('NORNS_BEREIT');
    const kette = code.indexOf('starteKettenpruefung(app)');
    expect(bereit, 'die Bereitmeldung fehlt ganz').toBeGreaterThan(-1);
    expect(
      kette,
      'Die Selbstprüfung darf die Bereitmeldung nicht aufhalten: der Rumpf ' +
        'wartet darauf, und eine Kasse, die wegen ihrer eigenen Prüfung später ' +
        'öffnet, wäre die schlechtere Störung.',
    ).toBeGreaterThan(bereit);
  });

  it.each(BEILAEUFER)('⛔ %s prüft AUCH die Datenbankrolle', (pfad) => {
    /*
     * ── DER ZWEITE RIEGEL AUS `server.ts` (21.08.2026) ────────────────────
     *
     * `assertAppRoleInDatabaseUrl` verlangt, dass der Motor mit der AM
     * WENIGSTEN privilegierten Rolle an die Datenbank geht — nie als
     * Migrator, Arbeiter oder Eigentümer. Auch er stand allein in
     * `server.ts` und lief auf der Kasse nie.
     *
     * ⚠️ Heute geht das gut, am laufenden Motor NACHGEMESSEN: die Kasse
     * verbindet als `warehouse14_app`, ohne Superuser-, Rollen- oder
     * RLS-Recht. Aber „der Beiläufer baut die Adresse selbst" ist eine
     * ANNAHME. Die spaltenweisen Schreibrechte auf `users` (Wanderungen
     * 0004, 0014, 0042, 0151) hängen daran: mit einer privilegierten Rolle
     * wären sie wirkungslos, ohne dass irgendetwas auffiele.
     */
    expect(nurCode(pfad)).toMatch(/assertAppRoleInDatabaseUrl\(/);
  });

  it('⛔ und der Riegel lässt genau die Anwendungsrolle durch', () => {
    // Die Adresse, die der Beiläufer WIRKLICH baut (Zeile `const url = …`).
    const mit = (rolle: string): Env =>
      ({ DATABASE_URL: `postgresql://${rolle}:geheim@127.0.0.1:5432/norns_pos` }) as Env;

    expect(() => assertAppRoleInDatabaseUrl(mit('warehouse14_app'))).not.toThrow();
    // Und jede privilegiertere Rolle bricht den Start ab.
    for (const rolle of ['norns', 'warehouse14_migrator', 'warehouse14_worker', 'postgres']) {
      expect(() => assertAppRoleInDatabaseUrl(mit(rolle)), rolle).toThrow(/least-privileged/);
    }
  });

  it('⚠️ und beide Abschriften sind sich einig', () => {
    const [a, b] = BEILAEUFER.map((p) => nurCode(p).includes('starteKettenpruefung(app)'));
    expect(a, 'nur eine der beiden Abschriften startet sie').toBe(b);
  });
});

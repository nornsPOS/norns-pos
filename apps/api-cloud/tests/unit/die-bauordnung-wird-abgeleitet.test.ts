/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Die Bauordnung wird ABGELEITET, nicht von Hand gepflegt
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── ZWEIMAL DERSELBE FEHLER ────────────────────────────────────────────────
 *
 * Die Arbeitsläufe bauten die hauseigenen Pakete über eine Liste, die
 * jemand von Hand pflegen musste — mit der richtigen REIHENFOLGE darin.
 * Diese Art Liste ist zweimal gebrochen:
 *
 *   23.07.2026  `i18n-de` stand vor `api-client`, das es importiert. Der
 *               Auftrag war über eine Woche ROT, ohne dass es jemandem
 *               auffiel. Der Kommentar im Arbeitslauf hielt das fest:
 *               „CI grün war in der Zeit kein Signal."
 *
 *   20.08.2026  Die Kasse bekam `@norns/domain` als neue Abhängigkeit (die
 *               Umsatzsteuersätze mit Gültigkeitsdatum). Das Paket stand in
 *               KEINEM der vier Blöcke, und der Bau brach mit
 *               „Failed to resolve entry for package @norns/domain".
 *
 * Zweimal derselbe Fehler heisst: nicht die Liste war falsch, sondern dass es
 * eine Liste GIBT. `pnpm` kennt den Abhängigkeitsbaum aus den
 * `package.json`-Dateien und baut ihn topologisch — `^...` heisst „alles, was
 * dieses Paket braucht, es selbst ausgenommen".
 *
 * ── WAS DIESER WÄCHTER HÄLT ────────────────────────────────────────────────
 *
 * Dass keine Handliste zurückkommt. Wer eines Tages wieder einzelne Pakete
 * namentlich baut, bekommt hier eine rote Probe statt in einer Woche einen
 * roten Auftrag, den niemand liest.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const LAEUFE = join(HIER, '../../../../.github/workflows');

/** Die Arbeitsläufe, die überhaupt hauseigene Pakete bauen. */
function laeufe(): Array<{ name: string; text: string }> {
  return readdirSync(LAEUFE)
    .filter((n) => n.endsWith('.yml'))
    .map((n) => ({ name: n, text: readFileSync(join(LAEUFE, n), 'utf8') }))
    .filter((l) => l.text.includes('@norns/'));
}

describe('⛔ Die Bauordnung wird abgeleitet', () => {
  const alle = laeufe();

  it('findet die Arbeitsläufe überhaupt — sonst prüft der Wächter Luft', () => {
    expect(alle.length).toBeGreaterThan(2);
    expect(alle.map((l) => l.name)).toContain('ci.yml');
  });

  it('⛔ kein Arbeitslauf baut ein hauseigenes Paket NAMENTLICH', () => {
    /*
     * Erlaubt ist nur der abgeleitete Bau (`--filter "@norns/…^..." build`).
     * Ein `--filter @norns/ui-kit build` ist genau die Handliste, die
     * zweimal gebrochen ist.
     */
    /*
     * ⚠️ Eine ANWENDUNG zu bauen ist keine Handliste — `tauri-pos build`
     * erzeugt das Fenster, `api-cloud build` den Motor. Gemeint sind die
     * hauseigenen PAKETE darunter.
     */
    const ANWENDUNGEN = new Set(['tauri-pos', 'api-cloud']);
    const funde: string[] = [];
    for (const l of alle) {
      for (const zeile of l.text.split('\n')) {
        const m = /--filter\s+"?@norns\/([a-z0-9-]+)"?\s+build\b/.exec(zeile);
        if (m && !ANWENDUNGEN.has(m[1] as string)) funde.push(`${l.name}: ${m[0].trim()}`);
      }
    }
    expect(
      funde,
      'Ein Arbeitslauf baut wieder einzelne Pakete namentlich. Diese Liste ' +
        'ist zweimal gebrochen (23.07. und 20.08.2026). Benutze den ' +
        'abgeleiteten Bau: --filter "@norns/<app>^..." build',
    ).toEqual([]);
  });

  it('⛔ und wer hauseigene Pakete baut, leitet sie aus einer ANWENDUNG ab', () => {
    /*
     * ⚠️ `pnpm --filter "…^..."` allein reicht in DIESEM Werk nicht: pnpm
     * sortiert hier nicht topologisch, weil `node-linker=hoisted` (nötig für
     * die Expo-App im Nachbarwerk) den Abhängigkeitsbaum einebnet. Gemessen
     * am 20.08.2026 lief `audit` vor `db`, und der Bau brach.
     *
     * Menge UND Reihenfolge kommen deshalb aus `scripts/baue-pakete.mjs`.
     */
    const bauende = alle.filter((l) => l.text.includes('baue-pakete.mjs'));
    expect(bauende.length, 'kein einziger Lauf leitet ab').toBeGreaterThan(2);
    for (const l of bauende) {
      expect(
        /baue-pakete\.mjs\s+@norns\/(tauri-pos|api-cloud)/.test(l.text),
        `${l.name} nennt keine Anwendung, aus der abgeleitet wird`,
      ).toBe(true);
    }
  });

  it('⛔ die abgeleitete Ordnung baut, was etwas BRAUCHT, vorher', async () => {
    /*
     * Der eigentliche Beweis: nicht dass ein Skript aufgerufen wird, sondern
     * dass seine Ordnung stimmt. `audit` importiert `db` — also muss `db`
     * davor stehen. Genau das hatte pnpm falsch.
     */
    const { reihenfolge } = await import('../../../../scripts/baue-pakete.mjs');
    const werk = new Map<string, { abhaengig: string[] }>();
    for (const bereich of ['packages', 'apps']) {
      const ordner = join(HIER, '../../../..', bereich);
      for (const name of readdirSync(ordner)) {
        const pfad = join(ordner, name, 'package.json');
        try {
          const j = JSON.parse(readFileSync(pfad, 'utf8')) as {
            name?: string;
            dependencies?: Record<string, string>;
            peerDependencies?: Record<string, string>;
          };
          if (typeof j.name !== 'string') continue;
          werk.set(j.name, {
            abhaengig: Object.keys({ ...j.dependencies, ...j.peerDependencies }).filter((d) =>
              d.startsWith('@norns/'),
            ),
          });
        } catch {
          /* kein Paket */
        }
      }
    }

    const folge = reihenfolge(werk, ['@norns/tauri-pos', '@norns/api-cloud']);
    const platz = new Map(folge.map((n, i) => [n, i]));

    for (const [name, w] of werk) {
      if (!platz.has(name)) continue;
      for (const d of w.abhaengig) {
        if (!platz.has(d)) continue;
        expect(
          platz.get(d)!,
          `${d} wird NACH ${name} gebaut, obwohl ${name} es braucht`,
        ).toBeLessThan(platz.get(name)!);
      }
    }
  });

  it('⛔ die Kasse hängt wirklich an @norns/domain — sonst wäre der Anlass weg', () => {
    /*
     * Der Auslöser vom 20.08.2026. Fiele diese Abhängigkeit eines Tages weg,
     * darf dieser Wächter umgeschrieben werden — aber NICHT, ohne dass
     * jemand hier nachgesehen hat.
     */
    const kasse = JSON.parse(
      readFileSync(join(HIER, '../../../tauri-pos/package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(kasse.dependencies?.['@norns/domain']).toBeDefined();
  });
});

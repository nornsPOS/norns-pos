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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { HAUSNAME } from '../../../../scripts/baue-pakete.mjs';

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

describe('⛔ Der Aufruf unter Windows', () => {
  /*
   * ── DREIMAL DIESELBE STELLE, DREIMAL EIN ANDERER FEHLER ─────────────────
   *
   *   23.07.2026  Die Handliste stand in der falschen Reihenfolge.
   *   20.08.2026  `spawnSync pnpm ENOENT` — unter Windows ist `pnpm` eine
   *               `.cmd`, und `execFileSync` fand sie nicht.
   *   21.08.2026  `spawnSync pnpm.cmd EINVAL` — der richtige NAME genuegt
   *               seit Node 18.20/20.12 nicht mehr: nach CVE-2024-27980
   *               weigert sich Node, eine `.cmd` OHNE Huelle zu starten.
   *               Der Auslieferungsbau von 0.7.2 ist daran gescheitert,
   *               NACHDEM macOS schon gruen war.
   *
   * Windows laeuft NUR im Auftrag. Kein Mensch hier sieht diesen Weg je,
   * bevor eine Auslieferung daran zerbricht. Deshalb liest diese Probe den
   * Quelltext: sie kann nicht spawnen, aber sie kann festhalten, dass die
   * drei Zusagen dastehen.
   */
  /*
   * ⚠️ OHNE KOMMENTARE. Der Kopf der Datei ERZAEHLT die Geschichte von
   * `shell: true` -- warum es 20.08. abgelehnt und 21.08. unvermeidlich
   * wurde. Wer roh sucht, schlaegt auf der Erzaehlung an statt auf dem Code.
   * Dieselbe Falle wie beim Filter-Waechter am 20.08. und beim
   * Fenster-Waechter heute; sie kommt so oft, dass sie zur Regel gehoert.
   */
  const QUELLE = readFileSync(resolve(HIER, '../../../../scripts/baue-pakete.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((z) => !z.trim().startsWith('//'))
    .join('\n');

  it('⛔ startet die `.cmd` MIT Huelle — sonst wirft Node EINVAL', () => {
    expect(
      QUELLE,
      'Ohne `shell` weigert sich Node seit CVE-2024-27980, eine .cmd zu starten.',
    ).toMatch(/shell:\s*WINDOWS/);
  });

  it('⚠️ und NUR unter Windows — Linux und macOS bleiben ohne Huelle', () => {
    expect(QUELLE).toMatch(/const WINDOWS = process\.platform === 'win32'/);
    expect(QUELLE, 'shell darf nirgends fest auf true stehen').not.toMatch(/shell:\s*true/);
  });

  it('⛔ und kein Name geht durch die Huelle, der kein Hauspaket ist', () => {
    // Mit einer Huelle werden Argumente aneinandergehaengt statt maskiert.
    // Hier kommt keines von aussen -- der Riegel macht daraus eine GEPRUEFTE
    // Zusage statt einer Annahme.
    expect(QUELLE).toMatch(/HAUSNAME\.test\(name\)/);
    expect(HAUSNAME.test('@norns/api-client')).toBe(true);
    expect(HAUSNAME.test('@norns/x; rm -rf /')).toBe(false);
    expect(HAUSNAME.test('pnpm && evil')).toBe(false);
    expect(HAUSNAME.test('../../etc/passwd')).toBe(false);
  });
});

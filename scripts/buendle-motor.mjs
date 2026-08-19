#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════════
 *  DER MOTOR ALS EINE DATEI, an EINER Stelle beschrieben
 * ════════════════════════════════════════════════════════════════════════
 *
 * Buendelt `apps/api-cloud/sidecar/norns-sidecar.mjs` zu
 * `apps/tauri-pos/src-tauri/resources/sidecar/start.mjs`, dem Motor, den die
 * Kasse mitnimmt.
 *
 * ── WARUM DAS HIER LIEGT UND NICHT IM FLIESSBAND ───────────────────────────
 *
 * Bis zum 13.08.2026 stand der Befehl nur in `release.yml`. Die Folge war ein
 * Waechter, der auf dem Laeufer NIE gruen werden konnte: `fehlerkennung.test.ts`
 * misst die Klassennamen im AUSGELIEFERTEN Buendel (voellig richtig, dazu
 * unten), aber das Buendel ist `.gitignore`-Beute und wurde im Pruefauftrag nie
 * erzeugt. Er starb mit einem nackten `ENOENT`, das ueber die Ursache kein Wort
 * verlor. Dieselbe Klasse wie der fehlende Beipack am selben Tag: ein Auftrag,
 * der etwas VERLANGT, das nur ein anderes Fliessband erzeugt.
 *
 * Gemessen kostet das Buendeln 172 Millisekunden. Es gibt also keinen Grund,
 * es dem Pruefstand vorzuenthalten.
 *
 * ── DIE FAHNEN SIND TRAGEND, KEIN BEIWERK ──────────────────────────────────
 *
 * Alle am 30.07.2026 in einem LEEREN Ordner gemessen:
 *
 * 1. `--banner:js` ist tragend. Unter `--format=esm` ersetzt esbuild jedes
 *    nicht aufloesbare `require()` der gebuendelten Abhaengigkeiten durch einen
 *    Ersatz, der IMMER wirft. Ohne die Fahne stirbt der Dienst beim ersten
 *    Baustein mit „Dynamic require of node:crypto is not supported": der
 *    Haendler haette Postgres anlegen sehen und danach nie verkauft.
 *    `--format=cjs` loest es NICHT, dann verstuemmelt esbuild `import.meta.url`,
 *    aus dem der Dienst seine Pfade rechnet.
 *
 * 2. VIER externals, nicht drei. `@node-rs/argon2` und `sharp` sind nativ
 *    („No loader is configured for .node files"), `sharp` liegt dabei auf dem
 *    BOOTWEG (photo-store), nicht in einer Nebenflaeche. Jedes external MUSS in
 *    `apps/api-cloud/sidecar/package.json` stehen, sonst wird es aus dem
 *    Buendel herausgehalten und trotzdem nirgends danebengelegt. Genau das war
 *    einmal der Fall, und der Haendler las als ganzen Grund „Node.js v22.14.0".
 *
 * ── WER MICH RUFT ──────────────────────────────────────────────────────────
 *
 *   .github/workflows/ci.yml       vor `pnpm test`, damit der Waechter etwas
 *                                  zu messen hat
 *   .github/workflows/release.yml  vor dem Bauen des Programms
 */

import { mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSync, version as esbuildFassung } from 'esbuild';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠️ WELCHE FASSUNG DEN AUSGELIEFERTEN MOTOR BAUT, WIRD HIER ENTSCHIEDEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Befund vom 13.08.2026, gefunden beim Beheben des Windows-Fehlers darunter.
 *
 * Bis heute stand esbuild in KEINER package.json dieses Baumes. Gemessen:
 *
 *     Wurzel-package.json          →  biome, turbo, typescript. Kein esbuild.
 *     pnpm why esbuild -r          →  nur mittelbar, ueber vite, vitest, tsx
 *     Fassungen in der Sperrdatei  →  0.18.20, 0.19.12, 0.21.5, 0.23.1, 0.28.1
 *     im Wurzel-node_modules       →  0.19.12
 *
 * Die `.npmrc` sagt `node-linker=hoisted`. Damit gibt es EIN flaches
 * `node_modules`, und welche der fuenf Fassungen dort oben landet, entscheidet
 * der Hebungs-Algorithmus, nicht ein Mensch. Es wurde die zweitaelteste.
 *
 * Das Buendel, das daraus faellt, ist der ganze Fiskalserver, der auf der
 * Kasse des Haendlers laeuft. Ein Werkzeugwechsel, den niemand beschlossen
 * hat, aendert dieses Erzeugnis still: es reicht, dass irgendwo im Baum eine
 * Abhaengigkeit umzieht und die Hebung anders ausgeht.
 *
 * Zwei Riegel, nicht einer:
 *   1. `esbuild` steht jetzt als direkte Entwicklungsabhaengigkeit in der
 *      Wurzel-package.json. Eine direkte Abhaengigkeit gewinnt die Hebung
 *      immer, also ist die Wahl ab sofort getroffen und nicht geerbt.
 *   2. Der Satz hier drunter misst zur Bauzeit nach. Ein Wunsch in einer
 *      package.json ist eine Absicht; welche Fassung wirklich laedt, ist eine
 *      Messung.
 *
 * ⚠️ Diese Zahl darf sich aendern. Sie darf sich nur nicht UNBEMERKT aendern.
 * Wer esbuild hebt, aendert beide Stellen und vergleicht das Buendel vorher
 * und nachher mit `cmp`.
 */
const ERWARTETE_ESBUILD_FASSUNG = '0.19.12';

if (esbuildFassung !== ERWARTETE_ESBUILD_FASSUNG) {
  console.error(
    [
      `⛔ esbuild ${esbuildFassung} statt ${ERWARTETE_ESBUILD_FASSUNG}.`,
      '',
      'Dieses Werkzeug baut den Fiskalserver, der auf der Kasse laeuft. Eine',
      'andere Fassung erzeugt ein anderes Erzeugnis. Wenn der Wechsel gewollt',
      'ist: die Zahl in scripts/buendle-motor.mjs UND die Angabe in der',
      'Wurzel-package.json auf dieselbe Fassung setzen, neu bauen und das',
      'Buendel mit cmp gegen das vorherige halten.',
      '',
      'Ist der Wechsel NICHT gewollt, dann hat die Hebung entschieden statt',
      'eines Menschen. Genau deswegen steht dieser Satz hier.',
    ].join('\n'),
  );
  process.exit(1);
}

export const EINGANG = 'apps/api-cloud/sidecar/norns-sidecar.mjs';
export const ZIEL = 'apps/tauri-pos/src-tauri/resources/sidecar/start.mjs';

/**
 * ⚠️ DIE JS-SCHNITTSTELLE, NICHT `npx`. MEINE EIGENE REGRESSION VOM 13.08.2026.
 *
 * Beim Herausloesen dieses Befehls aus `release.yml` stand hier zuerst
 * `execFileSync('npx', ['esbuild', …])`. Auf macOS und Linux lief das. Der
 * Freigabelauf zu `v0.3.0` starb auf Windows mit:
 *
 *     Error: spawnSync npx ENOENT
 *
 * Auf Windows heisst der Befehl `npx.cmd`, und `execFileSync` startet ohne
 * Schale keine `.cmd`-Datei. Der eingebaute Befehl davor lief unter
 * `shell: bash` und merkte davon nichts. Genau die Hausklasse, an der ich den
 * ganzen Tag gearbeitet habe: etwas laeuft auf DIESER Maschine und nicht auf
 * der, an die AUSGELIEFERT wird.
 *
 * `shell: true` haette es geflickt. Die Schnittstelle direkt zu rufen loest es:
 * kein Kindprozess, keine Schale, kein PATH, kein Unterschied zwischen den
 * Systemen.
 */
const FAHNEN = {
  entryPoints: [EINGANG],
  // ⚠️ Tragend fuer die Byte-Gleichheit: esbuild schreibt Pfade RELATIV zum
  // Arbeitsverzeichnis in die Ausgabe. Der eingebaute Befehl lief mit
  // `cwd: WURZEL`; steht das hier nicht, aendert sich das Buendel je nachdem,
  // aus welchem Ordner jemand das Werkzeug ruft.
  absWorkingDir: WURZEL,
  bundle: true,
  platform: /** @type {const} */ ('node'),
  format: /** @type {const} */ ('esm'),
  outfile: ZIEL,
  // ⚠️ VIER externals, und jedes MUSS in `apps/api-cloud/sidecar/package.json`
  // stehen, sonst wird es herausgehalten und nirgends danebengelegt.
  external: ['embedded-postgres', 'pg', '@node-rs/argon2', 'sharp'],
  // ⚠️ Tragend, siehe Kopf: ohne diesen Vorspann stirbt der Dienst beim ersten
  // Baustein mit „Dynamic require of node:crypto is not supported".
  banner: {
    js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);",
  },
};

mkdirSync(join(WURZEL, dirname(ZIEL)), { recursive: true });
buildSync(FAHNEN);

const groesse = statSync(join(WURZEL, ZIEL)).size;
console.log(`${ZIEL}  ${(groesse / 1024 / 1024).toFixed(1)} MB`);

// Ein leeres oder winziges Buendel waere ein stiller Fehlschlag: esbuild kann
// mit Ausgangsstand 0 enden und trotzdem fast nichts geschrieben haben, wenn
// der Eingang leer ist. Gemessen sind es rund 10,5 MB.
if (groesse < 1_000_000) {
  console.error(`⛔ Das Buendel ist nur ${groesse} Byte gross. Das kann nicht der ganze Motor sein.`);
  process.exit(1);
}

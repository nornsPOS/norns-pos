#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Die hauseigenen Pakete bauen — in der Reihenfolge, die sie selbst nennen
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── ZWEIMAL DERSELBE FEHLER ────────────────────────────────────────────────
 *
 * Die Arbeitsläufe bauten die Pakete über eine Liste, die jemand von Hand
 * pflegen musste — samt der richtigen REIHENFOLGE. Diese Art Liste ist
 * zweimal gebrochen:
 *
 *   23.07.2026  `i18n-de` stand vor `api-client`, das es importiert. Der
 *               Auftrag war über eine Woche ROT, ohne dass es jemandem
 *               auffiel. „CI grün" war in der Zeit kein Signal.
 *
 *   20.08.2026  Die Kasse bekam `@norns/domain` als neue Abhängigkeit. Das
 *               Paket stand in KEINEM der vier Blöcke, und der Bau brach mit
 *               „Failed to resolve entry for package @norns/domain".
 *
 * ── WARUM NICHT EINFACH `pnpm --filter "…^..." build` ──────────────────────
 *
 * Weil pnpm in DIESEM Werk nicht topologisch sortiert. Gemessen am
 * 20.08.2026, sogar mit `--workspace-concurrency=1`:
 *
 *     appointments → auth-pin → domain → email → audit → db
 *
 * `audit` importiert `db` und lief VOR ihm; der Bau brach mit „Cannot find
 * module '@norns/db'". Der Grund liegt in `.npmrc`: `node-linker=hoisted`
 * (nötig für die Expo-App im Nachbarwerk) flacht die Verknüpfungen ein, und
 * damit sieht pnpm den Abhängigkeitsbaum nicht mehr, nach dem es sortieren
 * würde.
 *
 * ── WAS DIESES STÜCK TUT ───────────────────────────────────────────────────
 *
 * Es liest die `package.json` jedes Pakets, baut daraus den Abhängigkeitsbaum
 * und arbeitet ihn von unten nach oben ab. Weder die Menge noch die
 * Reihenfolge steht irgendwo als Liste — beides kommt aus den Paketen selbst.
 *
 * Aufruf:
 *
 *     node scripts/baue-pakete.mjs @norns/tauri-pos @norns/api-cloud
 *
 * Gebaut werden die ABHÄNGIGKEITEN der genannten Anwendungen, nicht sie
 * selbst.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Wie das Werkzeug auf DIESEM Betriebssystem heisst.
 *
 * ⚠️ Unter Windows ist `pnpm` eine `.cmd`-Datei, und `execFileSync` sucht ohne
 * Hülle nur nach der EXAKTEN Datei. Der Windows-Auftrag brach deshalb mit
 * „spawnSync pnpm ENOENT", während Linux und macOS durchliefen — der
 * klassische Fall, den man auf dem eigenen Rechner nie sieht.
 *
 * Der naheliegende Griff wäre `shell: true` gewesen. Node warnt davor zu
 * Recht: mit einer Hülle werden die Argumente nur aneinandergehängt, nicht
 * maskiert. Den richtigen NAMEN zu wählen ist einfacher und sicherer.
 */
const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

/** Jedes Werkstück des Werks: Name → { ort, abhaengig, hatBau }. */
function werkstuecke() {
  const alle = new Map();
  for (const bereich of ['packages', 'apps']) {
    const ordner = join(WURZEL, bereich);
    if (!existsSync(ordner)) continue;
    for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
      if (!eintrag.isDirectory()) continue;
      const pfad = join(ordner, eintrag.name, 'package.json');
      if (!existsSync(pfad)) continue;
      const j = JSON.parse(readFileSync(pfad, 'utf8'));
      if (typeof j.name !== 'string') continue;
      /*
       * ⚠️ NUR `dependencies` und `peerDependencies` bestimmen die BAUORDNUNG.
       *
       * Eine Entwicklungsabhängigkeit braucht ein Paket, um seine PROBEN zu
       * fahren — nicht, um sein eigenes Erzeugnis zu bauen. Zählte man sie
       * mit, entstünden Ringe, die es gar nicht gibt: `db` fährt Proben gegen
       * `@norns/audit`, und `audit` baut gegen `@norns/db`. Beides zusammen
       * sähe wie ein Ring aus, ist aber keiner — nur die BAU-Richtung zählt.
       */
      const abhaengig = Object.keys({
        ...(j.dependencies ?? {}),
        ...(j.peerDependencies ?? {}),
      }).filter((d) => d.startsWith('@norns/'));
      alle.set(j.name, {
        ort: join(bereich, eintrag.name),
        abhaengig,
        hatBau: typeof j.scripts?.build === 'string',
      });
    }
  }
  return alle;
}

/**
 * Die Abhängigkeiten der genannten Anwendungen, von unten nach oben.
 *
 * ⚠️ Eine RINGABHÄNGIGKEIT bricht ab, statt eine willkürliche Reihenfolge zu
 * wählen: zwei Pakete, die einander brauchen, lassen sich nicht nacheinander
 * bauen, und ein stillschweigend gewähltes „irgendwie" wäre der nächste
 * Fehler, den in einer Woche niemand findet.
 */
export function reihenfolge(alle, anwendungen) {
  const fertig = [];
  const gesehen = new Set();
  const imGang = new Set();

  const gehe = (name, pfad) => {
    if (gesehen.has(name)) return;
    if (imGang.has(name)) {
      throw new Error(`Ringabhängigkeit: ${[...pfad, name].join(' → ')}`);
    }
    const w = alle.get(name);
    if (!w) return; // kein hauseigenes Paket
    imGang.add(name);
    for (const d of w.abhaengig) gehe(d, [...pfad, name]);
    imGang.delete(name);
    gesehen.add(name);
    fertig.push(name);
  };

  for (const app of anwendungen) {
    const w = alle.get(app);
    if (!w) throw new Error(`Unbekannte Anwendung: ${app}`);
    for (const d of w.abhaengig) gehe(d, [app]);
  }
  return fertig;
}

function main() {
  const anwendungen = process.argv.slice(2);
  if (anwendungen.length === 0) {
    console.error('Aufruf: node scripts/baue-pakete.mjs @norns/<anwendung> …');
    process.exit(2);
  }

  const alle = werkstuecke();
  const folge = reihenfolge(alle, anwendungen).filter((n) => alle.get(n).hatBau);

  console.log(`Bauordnung (${folge.length} Pakete, abgeleitet):`);
  for (const [i, n] of folge.entries()) console.log(`  ${i + 1}. ${n}`);

  for (const name of folge) {
    const { ort } = alle.get(name);
    console.log(`\n── ${name} (${ort}) ──`);
    execFileSync(PNPM, ['--fail-if-no-match', '--filter', name, 'build'], {
      cwd: WURZEL,
      stdio: 'inherit',
    });
  }
  console.log(`\nAlle ${folge.length} Pakete gebaut.`);
}

// Nur laufen, wenn direkt aufgerufen — die Proben führen `reihenfolge` ein.
if (process.argv[1] && process.argv[1].endsWith('baue-pakete.mjs')) main();

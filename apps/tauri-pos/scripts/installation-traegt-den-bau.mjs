#!/usr/bin/env node
/**
 * Prüft, ob die INSTALLIERTE Kasse wirklich den Bau trägt, der danebenliegt.
 *
 * ⚠️ Warum es diesen Wächter gibt, am 01.08.2026 um Mitternacht gemessen:
 *
 * Ich hatte die Oberfläche korrigiert, gebaut, `/Applications` ersetzt, den
 * Zeitstempel des Ordners gelesen ("installiert: 23:58") und Vollzug gemeldet.
 * Auf dem Schirm des Händlers stand danach die alte Oberfläche. Der Bau war
 * beim Ersetzen nicht mitgekommen, und mein Beweis war eine Uhrzeit.
 *
 * Eine Uhrzeit beweist nichts:
 *   - `cp -R` kann Zeiten übernehmen oder neu setzen, je nach System,
 *   - der Bündler kopiert den Rumpf und behält dabei dessen Alter,
 *   - und ein Ordner gilt schon als "geändert", wenn nur eine Datei darin neu ist.
 *
 * Deshalb prüft dieser Wächter den INHALT: Vite gibt jedem Bündel einen Namen
 * mit seinem eigenen Fingerabdruck (`index-CfCtJBum.js`). Steht dieser Name
 * nicht im installierten Rumpf, dann trägt die Kasse eine andere Oberfläche —
 * ganz gleich, was die Zeitstempel behaupten.
 *
 * Aufruf:
 *   node scripts/installation-traegt-den-bau.mjs [pfad-zur-installierten-app]
 *
 * Rückgabe: 0 wenn die Installation den Bau trägt, sonst 1 mit Begründung.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const APP = process.argv[2] ?? '/Applications/Norns POS.app';
const DIST = join(HIER, '../dist/assets');
/**
 * Der Rumpf heisst seit dem 01.08.2026 `norns-pos`. Eine Kasse, die VOR diesem
 * Tag gebaut wurde, trägt noch den alten Namen — und genau die will dieser
 * Wächter ja prüfen können, solange niemand neu gebaut hat. Deshalb beide
 * Namen, und der Fehlersatz nennt beide, damit ein Fehlschlag nicht nach
 * einem Tippfehler aussieht.
 */
const RUMPF_NAMEN = ['norns-pos', 'warehouse14-tauri-pos'];
const RUMPF =
  RUMPF_NAMEN.map((n) => join(APP, 'Contents/MacOS', n)).find((p) => existsSync(p)) ??
  join(APP, 'Contents/MacOS', RUMPF_NAMEN[0]);

function raus(zeile) {
  console.error(`ROT: ${zeile}`);
  process.exit(1);
}

if (!existsSync(DIST)) raus(`keine gebaute Oberfläche unter ${DIST} — erst 'pnpm build'`);
if (!existsSync(RUMPF))
  raus(`keine installierte Kasse unter ${APP} (gesucht: ${RUMPF_NAMEN.join(' oder ')})`);

/**
 * Der Fingerabdruck der Oberfläche: die Namen der Einstiegsbündel. Vite hängt
 * an jeden den Hash seines Inhalts, sie ändern sich also bei JEDER Änderung.
 */
const buendel = readdirSync(DIST).filter((n) => /^index-[\w-]+\.js$/.test(n));
if (buendel.length === 0) raus(`kein Einstiegsbündel in ${DIST} gefunden`);

// `strings` liest auch aus einem grossen Rumpf zuverlässig; die Bündelnamen
// stehen dort als Klartext im Verzeichnis der eingebetteten Dateien, auch wenn
// ihr INHALT komprimiert daneben liegt.
const text = execFileSync('strings', ['-a', RUMPF], {
  encoding: 'utf8',
  maxBuffer: 512 * 1024 * 1024,
});

const fehlend = buendel.filter((n) => !text.includes(n));

console.log(`Installierte Kasse : ${APP}`);
console.log(`Gebaute Bündel     : ${buendel.join(', ')}`);

if (fehlend.length > 0) {
  raus(
    `die installierte Kasse trägt diese Bündel NICHT: ${fehlend.join(', ')}\n` +
      `     Der Händler sieht eine andere Oberfläche als die, die hier gebaut wurde.\n` +
      `     Neu bauen und ERSETZEN, dann diesen Wächter erneut laufen lassen.`,
  );
}

console.log('GRUEN: die installierte Kasse trägt genau diesen Bau.');

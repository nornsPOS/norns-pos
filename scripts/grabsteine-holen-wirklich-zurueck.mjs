#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Jeder Rückholbefehl im Grabstein holt die Datei WIRKLICH zurück
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `docs/AUSGEZOGEN-NICHTS-IST-VERLOREN.md` verspricht in seiner eigenen Regel:
 * „Jede Zeile ist geprüft: der Befehl daneben holt die Datei wirklich zurück."
 * Bis zum 21.08.2026 hat das niemand nachgemessen.
 *
 * ── DER BEFUND, DER DIESE WACHE AUSLÖSTE ───────────────────────────────────
 *
 * Der Eintrag zur ausgezogenen Google-Tür nannte den Abdruck `8c5bb32`. Eine
 * Stunde später wurde genau dieser Einbau umgeschrieben (die KI-Zeile musste
 * aus den Botschaften, bevor sie in die öffentliche Historie geht), und der
 * Abdruck hiess danach `56440e6`. Auf DIESEM Rechner löste `8c5bb32` weiter
 * auf — `refs/original` hielt ihn am Leben. Für jeden, der das Werk frisch
 * klont, wäre der Befehl TOT gewesen, und niemand hätte es gemerkt.
 *
 * Dasselbe passiert bei jedem Rebase, jedem Amend, jedem Squash.
 *
 * ── WAS SIE MISST ─────────────────────────────────────────────────────────
 *
 * Für jede Tabellenzeile mit einem Abdruck: existiert der Einbau, und trägt
 * er die genannte Datei mit der genannten Zeilenzahl? Alle drei Angaben,
 * denn eine stimmende Zahl neben einem toten Abdruck ist wertlos.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOKU = join(WURZEL, 'docs/AUSGEZOGEN-NICHTS-IST-VERLOREN.md');

/** `| \`pfad\` | 773 | \`abdruck\` |` — nur Zeilen mit allen drei Angaben. */
/*
 * ⚠️ Das `^` GEHOERT ZUM ABDRUCK. Die Tabelle schreibt `dcc1972^` — den
 * VORGAENGER jenes Einbaus, denn dort liegt die Datei noch. Wer es
 * wegschneidet, fragt den Einbau, der sie geloescht hat, und bekommt nichts.
 * Genau das ist mir im ersten Anlauf passiert: sechs falsche Anzeigen.
 */
const ZEILE = /^\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|\s*`([0-9a-f]{7,40}\^?)`\s*\|/;

/**
 * Der Vorsatz, unter dem die Datei lag. Jeder Abschnitt schreibt ihn EINMAL
 * unter seine Tabelle („Also `git show <vorgänger>:apps/…/<pfad>`").
 */
const VORSATZ = /git show [^:]+:([a-z0-9/._-]*?)<pfad>/;

const zeilen = readFileSync(DOKU, 'utf8').split('\n');
const funde = [];
let vorsatz = null;

for (const [i, zeile] of zeilen.entries()) {
  const v = VORSATZ.exec(zeile);
  if (v) vorsatz = v[1];
  const m = ZEILE.exec(zeile);
  if (!m) continue;
  const [, pfad, zahl, abdruck] = m;
  // Der Vorsatz steht UNTER der Tabelle; erst nachladen, wenn er kommt.
  const kandidaten = vorsatz ? [vorsatz + pfad] : [];
  for (let j = i; j < Math.min(i + 12, zeilen.length); j++) {
    const w = VORSATZ.exec(zeilen[j]);
    if (w) {
      kandidaten.push(w[1] + pfad);
      break;
    }
  }
  if (kandidaten.length === 0) {
    funde.push(`Z${i + 1}: kein Vorsatz für \`${pfad}\``);
    continue;
  }

  let gelungen = null;
  for (const k of new Set(kandidaten)) {
    try {
      const inhalt = execFileSync('git', ['show', `${abdruck}:${k}`], {
        cwd: WURZEL,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      gelungen = { k, zeilen: inhalt.split('\n').length - (inhalt.endsWith('\n') ? 1 : 0) };
      break;
    } catch {
      /* nächster Kandidat */
    }
  }
  if (!gelungen) {
    funde.push(`Z${i + 1}: \`git show ${abdruck}:…${pfad}\` liefert NICHTS`);
    continue;
  }
  // Die Zahl darf um wenige Zeilen abweichen (Zählweise), nicht um Größenordnungen.
  if (Math.abs(gelungen.zeilen - Number(zahl)) > 2) {
    funde.push(`Z${i + 1}: ${pfad} steht mit ${zahl}, der Einbau trägt ${gelungen.zeilen}`);
  }
}

if (funde.length > 0) {
  console.error('⛔ Tote oder falsche Rückholbefehle im Grabstein:\n');
  for (const f of funde) console.error(`   ${f}`);
  console.error('\n   Der Abdruck ändert sich bei JEDEM Rebase, Amend oder Squash.');
  console.error('   Ein Grabstein mit totem Befehl ist schlimmer als keiner: er');
  console.error('   verspricht, dass nichts verloren ist.\n');
  process.exit(1);
}
console.log('OK — jeder Rückholbefehl im Grabstein liefert seine Datei.');

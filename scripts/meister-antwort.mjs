#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Die Hersteller-Antwort — Basels Seite des Herstellercodes
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ein Händler ist ausgesperrt und hat weder Notfallschlüssel noch
 * Rettungsstick. Seine Kasse zeigt eine AUFGABE (NORNS-M1-…). Dieses
 * Werkzeug unterschreibt sie mit dem privaten Schlüssel aus Basels Tresor:
 *
 *     node scripts/meister-antwort.mjs NORNS-M1-XXXXXXXX-YYYYYYYY-1234567890
 *
 * Die ausgegebene ANTWORT (eine Zeile) bekommt der Händler; er fügt sie an
 * der Kasse ein. Sie gilt nur für diese Aufgabe, an dieser Kasse, im
 * 30-Minuten-Fenster, genau einmal.
 *
 * ⚠️ Der private Schlüssel liegt AUSSCHLIESSLICH in
 * ~/Desktop/evn/Norns-Meisterschluessel.md und wird hier nur GELESEN. Er
 * gehört in kein Repository, keinen Chat, keinen Screenshot.
 */

import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TRESOR = join(homedir(), 'Desktop/evn/Norns-Meisterschluessel.md');

function fehl(satz) {
  console.error(`\n⛔ ${satz}\n`);
  process.exit(1);
}

const roh = process.argv[2];
if (!roh) fehl('Aufruf: node scripts/meister-antwort.mjs NORNS-M1-<gerät>-<zufall>-<frist>');

// Dieselbe Zerlegung wie die Kasse (packages/auth-pin/src/meisterschluessel.ts).
const t = roh.trim().toUpperCase().replace(/\s+/g, '');
const m = /^NORNS-M1-([A-Z2-9]{8})-([A-Z2-9]{8})-(\d{10,16})$/.exec(t);
if (!m) fehl(`Das ist keine Aufgabe dieser Kasse: ${JSON.stringify(roh)}`);
const [, geraet, zufall, frist] = m;

const rest = Number(frist) - Date.now();
if (rest < 0) {
  fehl(
    `Diese Aufgabe ist seit ${Math.round(-rest / 60000)} Minuten abgelaufen. ` +
      'Der Händler muss an der Kasse eine neue anfordern.',
  );
}

let tresor;
try {
  tresor = readFileSync(TRESOR, 'utf8');
} catch {
  fehl(`Der Tresor fehlt: ${TRESOR} — ohne ihn kann keine Antwort ausgestellt werden.`);
}
const schluesselB64 = tresor.match(/^\s{4}([A-Za-z0-9+/=]{40,})\s*$/m)?.[1];
if (!schluesselB64) fehl('Im Tresor steht kein lesbarer privater Schlüssel.');

const key = createPrivateKey({
  key: Buffer.from(schluesselB64, 'base64'),
  format: 'der',
  type: 'pkcs8',
});
const nachricht = `norns-meister-v1|${geraet}|${zufall}|${frist}`;
const antwort = sign(null, Buffer.from(nachricht, 'utf8'), key).toString('base64');

console.log('\nAufgabe geprüft. Antwort (dem Händler schicken, EINE Zeile):\n');
console.log(`  ${antwort}\n`);
console.log(`Gültig noch ${Math.round(rest / 60000)} Minuten, genau einmal, nur an dieser Kasse.`);

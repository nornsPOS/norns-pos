#!/usr/bin/env node
/**
 * lizenz.mjs — Lizenzschlüssel erzeugen und Lizenzen ausstellen.
 *
 * ── WARUM DIESES WERKZEUG ───────────────────────────────────────────────────
 *
 * Norns POS wird verkauft, also braucht es eine Freischaltung. Die Kasse prüft
 * sie mit `minisign-verify`, das über den Aktualisierer ohnehin schon im Baum
 * liegt: keine neue Abhängigkeit, und es ist dasselbe Verfahren, mit dem die
 * Freigaben signiert werden.
 *
 * Das `minisign`-Programm selbst ist auf dieser Maschine nicht installiert und
 * wird dafür auch nicht installiert. Node kann Ed25519 von Haus aus, und das
 * Format von minisign ist klein genug, um es hier genau zu schreiben:
 *
 *   Zeile 1: untrusted comment: …            (nicht signiert, nur Beschriftung)
 *   Zeile 2: base64( "ED" ‖ Schlüsselkennung(8) ‖ Signatur(64) )
 *   Zeile 3: trusted comment: …              (SIGNIERT, hier steht die Lizenz)
 *   Zeile 4: base64( Gesamtsignatur(64) )    über Signatur(64) ‖ Kommentartext
 *
 * Der springende Punkt ist Zeile 3: minisign signiert den „trusted comment"
 * mit. Deshalb steht die ganze Lizenz dort, und deshalb ist der Schlüssel, den
 * der Händler einfügt, nur vier kurze Zeilen und keine Textwand.
 *
 * "ED" heisst vorgehasht (BLAKE2b-512 über die Nachricht). Bewusst nicht das
 * alte "Ed": dann müsste die Kasse den Altlastweg erlauben, und ein Prüfer,
 * der Altlasten erlaubt, prüft weniger als einer, der es nicht tut.
 *
 * ── GEBRAUCH ────────────────────────────────────────────────────────────────
 *
 *   node werkzeug/lizenz.mjs schluessel
 *       Erzeugt ein neues Paar. Der geheime Teil gehört an EINEN sicheren Ort
 *       und niemals in dieses Verzeichnis.
 *
 *   node werkzeug/lizenz.mjs ausstellen --geheim <datei> \
 *        --haendler "Stampscoins Schorndorf" [--bis 2027-12-31] [--geraet <kennung>]
 *       Schreibt die vier Zeilen auf die Ausgabe. Das ist der Schlüssel, den
 *       der Händler bekommt.
 */

import { createHash, generateKeyPairSync, sign, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Die Nachricht, die unter jeder Lizenz signiert wird. Sie ist bei allen
 * gleich; die Lizenz selbst steht im signierten Kommentar. Ein fester Text
 * genügt, weil minisign BEIDE Signaturen prüft, die über die Nachricht und
 * die über den Kommentar.
 */
const NACHRICHT = Buffer.from('norns-pos-lizenz-v1');

/** Rohe 32 Bytes aus einem Node-Schlüsselobjekt holen (DER endet damit). */
function roherSchluessel(schluessel, art) {
  const der = schluessel.export({ format: 'der', type: art });
  return der.subarray(der.length - 32);
}

function schluesselErzeugen() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const oeffentlich = roherSchluessel(publicKey, 'spki');
  const geheim = roherSchluessel(privateKey, 'pkcs8');
  // Die Kennung verbindet Signatur und Schlüssel. Zufällig, acht Bytes, wie
  // bei minisign.
  const kennung = createHash('sha256').update(oeffentlich).digest().subarray(0, 8);

  const oeffentlichZeile = Buffer.concat([Buffer.from('Ed'), kennung, oeffentlich]).toString(
    'base64',
  );
  const geheimZeile = Buffer.concat([kennung, geheim]).toString('base64');

  process.stdout.write(
    [
      '# Norns POS — Lizenzschlüssel.',
      '#',
      '# OEFFENTLICH gehört in src-tauri/src/lizenz.rs. Er darf überall stehen.',
      '# GEHEIM schaltet jede Kasse frei. Er gehört an genau einen sicheren Ort',
      '# und niemals in ein Verzeichnis, das jemand einchecken kann.',
      '',
      `OEFFENTLICH=${oeffentlichZeile}`,
      `GEHEIM=${geheimZeile}`,
      '',
    ].join('\n'),
  );
}

function ausstellen(argumente) {
  const wert = (name) => {
    const i = argumente.indexOf(`--${name}`);
    return i >= 0 ? argumente[i + 1] : undefined;
  };
  const geheimDatei = wert('geheim');
  const haendler = wert('haendler');
  if (!geheimDatei || !haendler) {
    process.stderr.write('Es fehlt --geheim <datei> oder --haendler "<Name>".\n');
    process.exit(2);
  }

  const zeile = readFileSync(geheimDatei, 'utf8')
    .split('\n')
    .find((z) => z.startsWith('GEHEIM='));
  if (!zeile) {
    process.stderr.write(`In ${geheimDatei} steht keine Zeile GEHEIM=.\n`);
    process.exit(2);
  }
  const roh = Buffer.from(zeile.slice('GEHEIM='.length).trim(), 'base64');
  const kennung = roh.subarray(0, 8);
  const geheim = roh.subarray(8);

  // Node will den Schlüssel als PKCS8. Der Rumpf davor ist für Ed25519 fest.
  const pkcs8 = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    geheim,
  ]);
  const schluessel = createPublicKey; // nur damit der Import benutzt wird
  void schluessel;
  const privat = { key: pkcs8, format: 'der', type: 'pkcs8' };

  // Der signierte Kommentar IST die Lizenz. Semikolons, weil ein Zeilenumbruch
  // hier das Format zerbräche.
  const felder = [`haendler=${haendler}`, `ab=${wert('ab') ?? heute()}`];
  if (wert('bis')) felder.push(`bis=${wert('bis')}`);
  if (wert('geraet')) felder.push(`geraet=${wert('geraet')}`);
  const kommentar = felder.join(';');

  // "ED" ist vorgehasht: signiert wird BLAKE2b-512 über die Nachricht.
  const vorgehasht = createHash('blake2b512').update(NACHRICHT).digest();
  const signatur = sign(null, vorgehasht, privat);

  // Die Gesamtsignatur deckt Signatur UND Kommentar ab. Ohne sie könnte
  // jemand den Kommentar austauschen und sich selbst eine Lizenz schreiben.
  const gesamt = sign(null, Buffer.concat([signatur, Buffer.from(kommentar)]), privat);

  process.stdout.write(
    [
      `untrusted comment: Norns POS Lizenz fuer ${haendler}`,
      Buffer.concat([Buffer.from('ED'), kennung, signatur]).toString('base64'),
      `trusted comment: ${kommentar}`,
      gesamt.toString('base64'),
      '',
    ].join('\n'),
  );
}

function heute() {
  const d = new Date();
  const zwei = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`;
}

const befehl = process.argv[2];
if (befehl === 'schluessel') schluesselErzeugen();
else if (befehl === 'ausstellen') ausstellen(process.argv.slice(3));
else {
  process.stderr.write(
    'Gebrauch:\n' +
      '  node werkzeug/lizenz.mjs schluessel\n' +
      '  node werkzeug/lizenz.mjs ausstellen --geheim <datei> --haendler "<Name>" [--bis JJJJ-MM-TT] [--geraet <kennung>]\n',
  );
  process.exit(2);
}

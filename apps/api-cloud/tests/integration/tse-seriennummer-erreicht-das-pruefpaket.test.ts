/**
 * ════════════════════════════════════════════════════════════════════════
 *  ⛔ ROT MIT ABSICHT — meldet die Kasse eine Seriennummer, muss sie im
 *     Prüferpaket stehen
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── WAS HIER WIRKLICH LÄUFT ────────────────────────────────────────────
 *
 * Der GANZE lebende Weg, ohne eine einzige Attrappe dazwischen:
 *
 *     echter Beleg
 *       → POST /api/transactions/:id/tse-signature   (die echte Route,
 *         genau der Aufruf, den die Kasse nach jedem FINISH macht)
 *       → echtes Postgres
 *       → GET /api/closings/:id/export/dsfinvk       (das echte Prüferpaket)
 *       → das ZIP wirklich ausgepackt
 *       → `tse.csv`, Spalte `TSE_SERIAL`
 *
 * ── WARUM ES DIESEN WÄCHTER GIBT (13.08.2026) ──────────────────────────
 *
 * Die Sicherungseinrichtung legt jeder fertigen Signatur ihre Seriennummer
 * und ihren öffentlichen Schlüssel bei; die Brücke der Kasse liest beide
 * ausdrücklich aus der Antwort heraus
 * (`apps/tauri-pos/src-tauri/src/commands/tse.rs:338` und `:339`).
 *
 * Im Export gibt es seit dem 12.08.2026 auch Felder dafür, und der Erzeuger
 * trägt sie nach `TSE_SERIAL` und `TSE_PUBLIC_KEY`. Bewiesen hat das ein
 * Wächter, der die Werte SELBST mitlieferte — grün war er deshalb unabhängig
 * davon, ob im Betrieb je ein Wert ankommt.
 *
 * ⛔ Er kommt nicht an. Die Kette ist an vier Stellen offen, aufgezählt an
 * `DsfinvkTseInput` in `src/lib/dsfinvk-export.ts`. Dieser Wächter ist
 * deshalb heute ROT, MIT ABSICHT, und er ist der einzige, der nicht grün
 * werden kann, solange auch nur eine der vier Stellen offen ist: er misst das
 * ENDE der Kette, nicht ihre einzelnen Glieder.
 *
 * ⚠️ Er ist kein kaputter Test und kein Rest einer anderen Sitzung. Er wird
 * von selbst grün, sobald ein gemeldeter Wert wirklich im Paket ankommt.
 *
 * ⚠️ GEMESSEN AM 13.08.2026, erster Lauf dieser Datei: der POST antwortet
 * 200, und beide Werte sind danach spurlos verschwunden — `TSE_SERIAL` und
 * `TSE_PUBLIC_KEY` kommen als LEERE Zeichenkette aus dem ZIP. Es gibt also
 * keine Fehlermeldung, an der jemand es merken könnte. Genau so verliert man
 * eine Pflichtangabe eines Steuerauszugs, ohne es je zu erfahren.
 *
 * ── DIE GEGENPROBE IM SELBEN LAUF ──────────────────────────────────────
 *
 * Der Signaturalgorithmus geht genau denselben Weg und kommt heute an: er hat
 * ein Feld im Rumpf, eine Spalte in der Tabelle, eine Zeile in der Abfrage
 * und eine Zuordnung im Erzeuger. Sein Satz unten ist grün. Damit steht fest,
 * dass diese Bühne, dieses ZIP und dieser Spaltengriff funktionieren — das
 * Rot daneben ist der Weg, nicht der Prüfstand.
 */

import { inflateRawSync } from 'node:zlib';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { baueFiskalBuehne } from '../helfer/fiskal-buehne.js';

const TAG = '2026-05-18';

const buehne = baueFiskalBuehne({ geschaeftstag: TAG });

/** Was die Sicherungseinrichtung dieser Kasse zu jeder Signatur meldet. */
const SERIENNUMMER = '5E4B1C9A00000042';
const OEFFENTLICHER_SCHLUESSEL = 'BGxQ0e7Vd2ZmYWtlUHVibGljS2V5';
const ALGORITHMUS = 'ecdsa-plain-SHA256';

beforeAll(async () => {
  await buehne.starten();
}, 180_000);

afterAll(async () => {
  await buehne.stoppen();
});

beforeEach(async () => {
  await buehne.leeren();
  await buehne.saeeFiskalischeVoraussetzungen();
});

/**
 * Das ZIP wirklich auspacken, nicht nur „sieht aus wie ein ZIP" prüfen.
 * Der Erzeuger schreibt STORE (0) oder rohes DEFLATE (8). Gleiche Bauart wie
 * in `szenario-kreuzprobe.test.ts`.
 */
function leseZip(buf: Buffer): Map<string, string> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('leseZip: kein Ende-Verzeichnis gefunden — das ist kein ZIP.');

  const anzahl = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16);
  const raus = new Map<string, string>();
  for (let n = 0; n < anzahl; n++) {
    if (buf.readUInt32LE(cd) !== 0x02014b50) {
      throw new Error('leseZip: falsche Kennung im Zentralverzeichnis.');
    }
    const verfahren = buf.readUInt16LE(cd + 10);
    const packGroesse = buf.readUInt32LE(cd + 20);
    const namenLaenge = buf.readUInt16LE(cd + 28);
    const extraLaenge = buf.readUInt16LE(cd + 30);
    const kommentarLaenge = buf.readUInt16LE(cd + 32);
    const lokal = buf.readUInt32LE(cd + 42);
    const name = buf.toString('utf8', cd + 46, cd + 46 + namenLaenge);

    const lNamen = buf.readUInt16LE(lokal + 26);
    const lExtra = buf.readUInt16LE(lokal + 28);
    const start = lokal + 30 + lNamen + lExtra;
    const gepackt = buf.subarray(start, start + packGroesse);
    const roh = verfahren === 8 ? inflateRawSync(gepackt) : Buffer.from(gepackt);
    raus.set(name, roh.toString('utf8'));

    cd += 46 + namenLaenge + extraLaenge + kommentarLaenge;
  }
  return raus;
}

/**
 * Ein Verkauf, seine Signatur auf dem ECHTEN Weg der Kasse, der Abschluss —
 * und das gezogene Prüferpaket. Gibt die einzige Zeile von `tse.csv` zurück,
 * als Zuordnung Spaltenname → Wert.
 */
async function stammsatzAusDemPruefpaket(): Promise<Record<string, string>> {
  const produktId = await buehne.legeProduktAn();
  const beleg = await buehne.legeBelegAn({
    direction: 'VERKAUF',
    treatment: 'STANDARD_19',
    subtotal: '84.03',
    vat: '15.97',
    total: '100.00',
    customerId: null,
    finalizedAt: buehne.ts(10, 0, TAG),
    items: [
      {
        productId: produktId,
        treatment: 'STANDARD_19',
        vatRate: '0.1900',
        lineSubtotal: '84.03',
        lineVat: '15.97',
        lineTotal: '100.00',
        displayOrder: 1,
      },
    ],
    payment: { method: 'CASH', amount: '100.00' },
  });

  /**
   * ⚠️ ÜBER HTTP, nicht per SQL in die Tabelle. Genau das ist der Punkt: die
   * Kasse schickt, was sie vom Gerät bekommen hat, und dieser Wächter misst,
   * wie viel davon ankommt. Ein SQL-Einwurf würde die beiden Wände (Rumpf und
   * Tabelle) überspringen und damit den Fehler verstecken, den es zu messen
   * gilt.
   */
  const signatur = await buehne.sende(`/api/transactions/${beleg.id}/tse-signature`, {
    fiskalyTssId: '11111111-2222-3333-4444-555555555555',
    fiskalyClientId: '66666666-7777-8888-9999-000000000000',
    fiskalyTransactionNumber: '1',
    signatureValue: 'MEUCIE8Q',
    signatureCounter: '1',
    signatureAlgorithm: ALGORITHMUS,
    processType: 'Kassenbeleg-V1',
    tssSerialNumber: SERIENNUMMER,
    signaturePublicKey: OEFFENTLICHER_SCHLUESSEL,
  });
  expect(signatur.statusCode, signatur.body.slice(0, 400)).toBe(200);

  const abschlussId = await buehne.legeAbschlussAn({
    geschaeftstag: TAG,
    verkaufAnzahl: 1,
    bruttoVerkauf: '100.00',
    nettoVerkauf: '84.03',
    ustJeBehandlung: { STANDARD_19: '15.97' },
    zahlungenJeArt: { CASH: '100.00' },
    kasseErwartet: '100.00',
    kasseGezaehlt: '100.00',
    tseFertig: 1,
  });

  const antwort = await buehne.hol(`/api/closings/${abschlussId}/export/dsfinvk`);
  expect(antwort.statusCode, antwort.body.slice(0, 400)).toBe(200);

  const paket = leseZip(Buffer.from(antwort.rawPayload));
  const inhalt = paket.get('tse.csv');
  if (inhalt === undefined) throw new Error('Im Prüferpaket fehlt `tse.csv`.');

  const zeilen = inhalt.split(/\r\n|\n/).filter((z) => z.length > 0);
  const spalten = (zeilen[0] ?? '').split(';').map((s) => s.replace(/^"|"$/g, ''));
  const werte = (zeilen[1] ?? '').split(';').map((s) => s.replace(/^"|"$/g, ''));
  if (zeilen.length < 2) {
    throw new Error('`tse.csv` hat keine Zeile — die Signatur ist gar nicht angekommen.');
  }
  return Object.fromEntries(spalten.map((s, i) => [s, werte[i] ?? '']));
}

const WEG =
  'Der Wert wurde über die echte Route gemeldet und ist auf dem Weg ins ' +
  'Prüferpaket verloren gegangen. Die vier offenen Stellen stehen an ' +
  '`DsfinvkTseInput` in src/lib/dsfinvk-export.ts; welche Wand noch steht, ' +
  'sagt tests/unit/tse-stammdaten-lebender-weg.test.ts.';

describe('⛔ Was die Kasse zur Signatur meldet, muss im Prüferpaket stehen', () => {
  it('Gegenprobe: der Signaturalgorithmus geht diesen Weg schon heute', async () => {
    /**
     * Ohne diesen Satz wäre das Rot unten mehrdeutig: es könnte auch an der
     * Bühne, am ZIP oder am Spaltengriff liegen. Der Algorithmus nimmt
     * dieselbe Route, dieselbe Tabelle, dieselbe Abfrage und denselben
     * Erzeuger — nur hat er überall sein Feld.
     */
    const stamm = await stammsatzAusDemPruefpaket();
    expect(stamm.TSE_SIG_ALGO).toBe(ALGORITHMUS);
  }, 120_000);

  it('⛔ die gemeldete Seriennummer steht in TSE_SERIAL', async () => {
    const stamm = await stammsatzAusDemPruefpaket();
    expect(stamm.TSE_SERIAL, WEG).toBe(SERIENNUMMER);
  }, 120_000);

  it('⛔ der gemeldete öffentliche Schlüssel steht in TSE_PUBLIC_KEY', async () => {
    /**
     * Ohne ihn ist die Signatur für einen Prüfer eine Zeichenkette ohne
     * Beweiswert: er kann sie nicht nachrechnen.
     */
    const stamm = await stammsatzAusDemPruefpaket();
    expect(stamm.TSE_PUBLIC_KEY, WEG).toBe(OEFFENTLICHER_SCHLUESSEL);
  }, 120_000);
});

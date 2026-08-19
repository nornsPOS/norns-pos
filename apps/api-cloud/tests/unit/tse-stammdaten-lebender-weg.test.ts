/**
 * ════════════════════════════════════════════════════════════════════════
 *  ⛔ ROT MIT ABSICHT — die Seriennummer der TSE erreicht den Auszug NICHT
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── WARUM ES DIESEN WÄCHTER GIBT (13.08.2026) ───────────────────────────
 *
 * Am 12.08.2026 bekam `DsfinvkTseInput` zwei neue Felder, `tssSerialNumber`
 * und `signaturePublicKey`, und der Erzeuger trägt sie sauber nach
 * `TSE_SERIAL` und `TSE_PUBLIC_KEY`. Ein Wächter belegte das auch — nur
 * lieferte er die beiden Werte SELBST. Er wäre grün geblieben, ganz gleich ob
 * im Betrieb je ein Wert ankommt.
 *
 * Er kommt nicht an. Über den ganzen Baum gemessen setzt KEINE
 * Produktionsstelle eines der beiden Felder. Das ist die Fehlerklasse „der
 * Prüfstand macht denselben Fehler": bestätigt wurde die Absicht, nicht die
 * Wirklichkeit.
 *
 * ⚠️ DIESER WÄCHTER IST DESHALB HEUTE ROT, UND ZWAR MIT ABSICHT. Er ist kein
 * kaputter Test und kein Rückstand einer anderen Sitzung. Er wird von selbst
 * grün, sobald die Kette geschlossen ist — vorher zu Recht nicht.
 *
 * ── DIE VIER OFFENEN STELLEN, IN DER REIHENFOLGE DES WERTES ─────────────
 *
 *   1. `packages/api-client/src/domains/transactions.ts:248`
 *      `TseSignatureBody` kennt beide Felder nicht — die Kasse kann sie gar
 *      nicht erst mitschicken.
 *   2. `apps/api-cloud/src/schemas/tse-signature.ts:56`
 *      dasselbe auf der Serverseite. Fastify ENTFERNT still, was das Schema
 *      nicht kennt; ein trotzdem mitgeschickter Wert käme nie in der Route an.
 *   3. `apps/api-cloud/src/routes/transactions-tse-signature.ts:158`
 *      das INSERT schreibt beide nicht — und `tse_signatures` hat gar keine
 *      Spalte dafür. Ohne Wanderung gibt es keinen Ort, an dem der Wert bliebe.
 *   4. `apps/api-cloud/src/routes/closing-export.ts:1595` (die Abfrage) und
 *      `:1682` (die Zuordnung) holen und übergeben sie nicht.
 *
 * ── WAS DIESE DATEI ANKLOPFT, UND WAS NICHT ────────────────────────────
 *
 * Angeklopft wird an den ECHTEN Gegenständen des lebenden Weges, nicht an
 * ihrem Quelltext: an dem Schema, das die Route wirklich prüft, und an der
 * Tabellenbeschreibung, durch die die Route wirklich schreibt. Eine Textsuche
 * bliebe blind gegenüber einem Feld, das zwar dasteht, aber woanders wieder
 * abgeräumt wird.
 *
 * ⚠️ GRENZE DIESER DATEI: sie misst die Stellen 2 und 3, also die beiden
 * WÄNDE. Werden die eingerissen, sagt Grün hier „ein Wert KÖNNTE jetzt
 * ankommen" — nicht „er kommt an". Dass er wirklich bis in die `tse.csv` des
 * Prüferpakets läuft, misst nur der Weg über echtes Postgres und echtes HTTP:
 *
 *     tests/integration/tse-seriennummer-erreicht-das-pruefpaket.test.ts
 *
 * ⚠️ `@norns/db/schema` wird als GEBAUTES Paket gelesen — genauso, wie
 * der Server es liest. Wer die Spalte in der Quelle ergänzt und nicht baut,
 * bleibt hier zu Recht rot: der laufende Server hätte sie auch nicht.
 */

import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { tseSignatures } from '@norns/db/schema';

import { TseSignatureBody } from '../../src/schemas/tse-signature.js';

/** Die Feldnamen, die das Schema der Route wirklich annimmt. */
const angenommeneFelder = (): string[] =>
  Object.keys((TseSignatureBody as { properties: Record<string, unknown> }).properties);

/** Die Spaltennamen, durch die die Route wirklich schreibt. */
const vorhandeneSpalten = (): string[] =>
  Object.values(getTableColumns(tseSignatures)).map((s) => s.name);

const WEG =
  'Solange das fehlt, bleiben `TSE_SERIAL` und `TSE_PUBLIC_KEY` in JEDEM gezogenen ' +
  'Prüferpaket leer, und ein Prüfer kann keine Signatur einer ' +
  'Sicherungseinrichtung zuordnen und keine einzige nachrechnen. ' +
  'Die vier offenen Stellen stehen im Kopf dieser Datei.';

describe('⛔ Die Wand 1: die Schnittstelle der Kasse nimmt die Stammangaben an', () => {
  /**
   * Die Gegenprobe zuerst. Sie beweist, dass dieses Anklopfen überhaupt
   * etwas findet — sonst wäre das Rot unten nur ein kaputter Griff.
   */
  it('Gegenprobe: den Signaturalgorithmus nimmt sie schon heute an', () => {
    expect(angenommeneFelder()).toContain('signatureAlgorithm');
  });

  it('⛔ die Seriennummer der Sicherungseinrichtung wird angenommen', () => {
    expect(
      angenommeneFelder(),
      `Das Schema der Route kennt \`tssSerialNumber\` nicht, und Fastify entfernt ` +
        `still, was es nicht kennt. Die Kasse HAT den Wert ` +
        `(apps/tauri-pos/src-tauri/src/commands/tse.rs:339), er kommt hier nur ` +
        `nie an. ${WEG}`,
    ).toContain('tssSerialNumber');
  });

  it('⛔ der öffentliche Schlüssel wird angenommen', () => {
    expect(
      angenommeneFelder(),
      `Das Schema der Route kennt \`signaturePublicKey\` nicht. Ohne diesen ` +
        `Schlüssel ist jede Signatur für einen Prüfer eine Zeichenkette ohne ` +
        `Beweiswert. ${WEG}`,
    ).toContain('signaturePublicKey');
  });
});

describe('⛔ Die Wand 2: die Aufzeichnung hat einen Ort für die Stammangaben', () => {
  it('Gegenprobe: für den Signaturalgorithmus gibt es eine Spalte', () => {
    expect(vorhandeneSpalten()).toContain('signature_algorithm');
  });

  it('⛔ es gibt eine Spalte für die Seriennummer', () => {
    expect(
      vorhandeneSpalten(),
      `\`tse_signatures\` hat keine Spalte für die Seriennummer. Das ist die ` +
        `Stelle, die eine WANDERUNG braucht; ohne sie gibt es keinen Ort, an ` +
        `dem der Wert bliebe. ${WEG}`,
    ).toContain('tss_serial_number');
  });

  it('⛔ es gibt eine Spalte für den öffentlichen Schlüssel', () => {
    expect(
      vorhandeneSpalten(),
      `\`tse_signatures\` hat keine Spalte für den öffentlichen Schlüssel. ${WEG}`,
    ).toContain('signature_public_key');
  });
});

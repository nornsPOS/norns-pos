/**
 * Eine Hardware-TSE muss signieren dürfen.
 *
 * ── BASELS ANWEISUNG VOM 02.08.2026 ────────────────────────────────────────
 *
 * Die Produktionsfassung läuft sehr wahrscheinlich auf einer HARDWARE-TSE,
 * dem bekannten Swissbit-Stecker, damit der vollständig offline arbeitende
 * Betrieb gesichert und nachweisbar ist.
 *
 * ── DIE WAND, DIE GEMESSEN WURDE ───────────────────────────────────────────
 *
 * ⚠️ `fiskaly_tss_id` war UUID NOT NULL, und die Route prüfte `format: 'uuid'`.
 * Ein Swissbit-Stecker trägt eine SERIENNUMMER wie `5E4B1C9A00000042`. Eine
 * Kasse mit Hardware-TSE hätte KEINEN EINZIGEN Beleg schreiben können: jede
 * Signatur prallte mit 400 ab, und ohne Signatur bleibt jeder Verkauf
 * unsigniert.
 *
 * ── DIE HALBHEIT, DIE DIESER WÄCHTER VERHINDERT ────────────────────────────
 *
 * ⚠️ Nur die LEITUNG zu weiten wäre schlimmer als gar nichts: die ehrliche
 * 400 („so sieht eine UUID nicht aus") würde zu einer 500 aus der Tiefe der
 * Datenbank, also derselben Ablehnung ohne Satz, der sagt warum. Deshalb
 * prüft dieser Wächter BEIDE Seiten und die mitgelieferte Schemadatei, die
 * jede frische Kasse aufsetzt.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import { TseSignatureBody } from '../../src/schemas/tse-signature.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const lies = (p: string): string => readFileSync(resolve(HIER, p), 'utf8');

const WANDERUNG = lies('../../../../packages/db/migrations/0131_die_tse_darf_ein_geraet_sein.sql');
const ERSTSTART = lies('../../sidecar/erststart/schema.sql');
const DIENST = lies('../../sidecar/norns-sidecar.mjs');
const SIGNATUREN = lies('../../../../packages/db/src/schema/tse/tseSignatures.ts');
const VORGAENGE = lies('../../../../packages/db/src/schema/tse/tseTransactions.ts');

/** Eine echte Swissbit-Seriennummer in ihrer Form: Hex, keine Bindestriche. */
const SWISSBIT = '5E4B1C9A00000042';
/** Und eine Wolken-Kennung, die weiterhin durchgehen MUSS. */
const WOLKE = 'b4e3f0a2-1c5d-4a7e-9f10-2b3c4d5e6f70';

function rumpf(kennung: string): Record<string, unknown> {
  return {
    fiskalyTssId: kennung,
    fiskalyClientId: kennung,
    fiskalyTransactionNumber: '42',
    signatureValue: 'MEUCIQD…',
    signatureCounter: '7',
    processType: 'Kassenbeleg-V1',
  };
}

describe('Die Sicherungseinrichtung darf ein Gerät sein', () => {
  it('⛔ die LEITUNG nimmt eine Swissbit-Seriennummer an', () => {
    // Das ist der Kern: vorher prallte genau dieser Rumpf mit 400 ab.
    expect(Value.Check(TseSignatureBody, rumpf(SWISSBIT))).toBe(true);
  });

  it('⛔ und die Wolke funktioniert unverändert weiter', () => {
    // Eine Weitung, die den bestehenden Weg zerbricht, ist keine Weitung.
    expect(Value.Check(TseSignatureBody, rumpf(WOLKE))).toBe(true);
  });

  it('⛔ leer bleibt VERBOTEN, in der Leitung wie in der Datenbank', () => {
    // Ein leeres Feld wäre schlimmer als eine falsche UUID: es sähe aus wie
    // „signiert", ohne dass ein Gerät je etwas signiert hätte.
    expect(Value.Check(TseSignatureBody, rumpf(''))).toBe(false);
    expect(Value.Check(TseSignatureBody, rumpf('   '))).toBe(false);
    expect(WANDERUNG).toContain('length(btrim(fiskaly_tss_id)) > 0');
    expect(WANDERUNG).toContain('length(btrim(fiskaly_client_id)) > 0');
  });

  it('unsinnige Kennungen prallen weiterhin ab', () => {
    // Zeilenumbrüche und Steuerzeichen haben in einer Gerätekennung nichts
    // verloren; sie stünden sonst im Prüferpaket und im QR-Code des Belegs.
    expect(Value.Check(TseSignatureBody, rumpf('5E4B\n1C9A'))).toBe(false);
    expect(Value.Check(TseSignatureBody, rumpf('A'.repeat(129)))).toBe(false);
  });

  it('⛔ die DATENBANK fällt mit, sonst wird aus 400 eine 500', () => {
    for (const tabelle of ['tse_signatures', 'tse_transactions']) {
      const teil = WANDERUNG.slice(WANDERUNG.indexOf(`ALTER TABLE ${tabelle}`));
      expect(teil, `${tabelle} bleibt ungeweitet`).toContain(
        'ALTER COLUMN fiskaly_tss_id         TYPE TEXT',
      );
      expect(teil).toContain('ALTER COLUMN fiskaly_client_id      TYPE TEXT');
    }
  });

  it('⛔ das Drizzle-Schema sagt dasselbe wie die Datenbank', () => {
    // Sonst schriebe die Anwendung weiter gegen eine Spalte, die es so nicht
    // mehr gibt. Das ist die Klasse „Schema und Wirklichkeit driften".
    for (const [name, datei] of [
      ['tseSignatures', SIGNATUREN],
      ['tseTransactions', VORGAENGE],
    ] as const) {
      expect(datei, `${name}: die Kennung ist noch uuid`).toContain(
        "fiskalyTssId: text('fiskaly_tss_id').notNull()",
      );
      expect(datei).toContain("fiskalyClientId: text('fiskaly_client_id').notNull()");
      expect(datei).toContain("fiskalyTransactionId: text('fiskaly_transaction_id')");
    }
  });

  it('⛔ JEDE Kasse bekommt die Weitung, die frische wie die stehende', () => {
    // Die mitgelieferte Schemadatei ist eine Momentaufnahme und trägt die alte
    // UUID-Spalte. Das ist in Ordnung, SOLANGE der Nachzügler-Lauf sie danach
    // weitet: er läuft bei jedem Start, auf einer frisch aufgesetzten Kasse
    // ebenso wie auf einer, die seit Wochen im Laden steht.
    //
    // ⚠️ Ohne diesen Satz wäre die Wanderung im Baum und in KEINER Kasse. Das
    // ist die Klasse „gebaut und nie angeschlossen", und sie hat dieses Haus
    // oft genug getroffen.
    const stelle = ERSTSTART.indexOf('CREATE TABLE public.tse_signatures');
    expect(stelle).toBeGreaterThan(-1);
    const tabelle = ERSTSTART.slice(stelle, stelle + 1200);
    const schonImSchema = tabelle.includes('fiskaly_tss_id text NOT NULL');
    const alsNachzuegler =
      DIENST.includes("'0131_die_tse_darf_ein_geraet_sein.sql'") &&
      existsSync(
        resolve(HIER, '../../sidecar/erststart/nachzuegler/0131_die_tse_darf_ein_geraet_sein.sql'),
      );
    expect(
      schonImSchema || alsNachzuegler,
      'weder im Schema noch als Nachzügler: keine Kasse bekäme die Weitung',
    ).toBe(true);
  });

  it('die Wanderung erklärt, warum der Spaltenname bleibt', () => {
    // `fiskaly_…` ist bei einem Swissbit-Stecker der falsche Name. Eine
    // Wunde, die benannt gehört, sonst hält sie ein Nachfolger für Absicht.
    expect(WANDERUNG).toContain('WARUM DER SPALTENNAME BLEIBT');
    expect(WANDERUNG).toMatch(/COMMENT ON COLUMN tse_signatures\.fiskaly_tss_id/);
  });
});

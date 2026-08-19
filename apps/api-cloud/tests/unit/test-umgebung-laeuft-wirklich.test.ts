/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DIE TESTVORLAGE WIRD AUSGEFÜHRT, NICHT NUR TYPGEPRÜFT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 13.08.2026, UND ER WAR MEINER ──────────────────────────
 *
 * `tests/helfer/test-umgebung.ts` entstand, um 35 Integrationsdateien unter
 * die Typprüfung zu bekommen. Sie war typgeprüft, sie war eingebaut, und sie
 * war NIE GELAUFEN: kein Satz dieses Hauses ruft sie ausserhalb der
 * Integrationsmappen, und die brauchen ein echtes Postgres.
 *
 * Der erste Lauf war deshalb das Fiskaltor selbst, mit FÜNFZEHN gescheiterten
 * Mappen und immer derselben Zeile:
 *
 *     /AUTH_SECRET — Expected required property
 *     /KYC_IMAGE_ENCRYPTION_KEY — Expected required property
 *
 * `tsc` kann das nicht sehen. Ein Schema prüft zur LAUFZEIT, und die Vorlage
 * gab nur zwei der vier Pflichtwerte mit.
 *
 * ── DIE REGEL ─────────────────────────────────────────────────────────────
 *
 * Ein Helfer, den nur schwere Läufe benutzen, braucht einen leichten Satz, der
 * ihn ausführt. Sonst ist der erste echte Aufruf immer das Tor, und der Preis
 * dafür ist ein roter Hauptzweig statt einer roten Zeile auf dem eigenen
 * Rechner.
 *
 * Dieser Satz läuft im gewöhnlichen `pnpm test`, ohne Datenbank, in
 * Millisekunden.
 */

import { describe, expect, it } from 'vitest';

import { EnvSchema, assertKycImageKeyValid } from '../../src/config/env.js';
import { testUmgebung } from '../helfer/test-umgebung.js';

describe('⛔ die Testvorlage baut wirklich eine gültige Umgebung', () => {
  it('sie läuft ohne Angaben durch', () => {
    // Das IST die Messung: `loadEnv` wirft, sobald ein Pflichtwert fehlt.
    // Genau daran ist das Fiskaltor am 13.08.2026 gescheitert.
    expect(() => testUmgebung()).not.toThrow();
  });

  it('und liefert eine VOLLE Umgebung, nicht eine Teilmenge', () => {
    const env = testUmgebung();
    // „null ist nicht grün": eine leere oder winzige Umgebung würde jede
    // Prüfung unten trivial erfüllen. Bis zum 14.08.2026 stand hier eine von
    // Hand gepflegte Untergrenze (">60"); die veraltete beim Rueckbau der
    // Trennung sofort. Gemessen wird jetzt gegen das SCHEMA selbst: die
    // Vorlage muss jeden einzelnen Schluessel tragen, den das Schema kennt.
    expect(Object.keys(env).sort()).toEqual(Object.keys(EnvSchema.properties).sort());
  });

  it('⛔ die vier Pflichtwerte ohne Schema-Vorgabe sind gesetzt', () => {
    const env = testUmgebung();
    const fehlend = (
      ['DATABASE_URL', 'NORNS_PII_KEY', 'AUTH_SECRET', 'KYC_IMAGE_ENCRYPTION_KEY'] as const
    ).filter((k) => typeof env[k] !== 'string' || env[k] === '');
    expect(
      fehlend,
      'Diese Werte haben im Schema BEWUSST keine Vorgabe, also muss die ' +
        'Testvorlage sie mitgeben. Fehlt einer, scheitert jede Integrationsmappe ' +
        'beim Bauen der Umgebung, und zwar erst auf dem Fliessband.',
    ).toEqual([]);
  });

  it('⛔ der Ausweis-Schlüssel geht auf genau 32 Byte auf', () => {
    // Derselbe Riegel, den der echte Start benutzt.
    expect(() => assertKycImageKeyValid(testUmgebung())).not.toThrow();
  });

  it('⛔ ein eigener Wert gewinnt gegen die Vorgabe des Schemas', () => {
    // Das ist die Zusage, auf der die Verhaltensneutralität ruht: was eine
    // Integrationsdatei ausdrücklich setzt, gilt weiterhin genau so.
    const env = testUmgebung({ TRANSACTION_STEP_UP_THRESHOLD_EUR: '77.00', PORT: 4711 });
    expect(env.TRANSACTION_STEP_UP_THRESHOLD_EUR).toBe('77.00');
    expect(env.PORT).toBe(4711);
  });

  it('⛔ und ein eigener, KAPUTTER Ausweis-Schlüssel wird auch erkannt', () => {
    // Die Prüfung läuft auf dem fertigen Wert, nicht auf der Vorgabe. Sonst
    // könnte eine Datei den Riegel umgehen, indem sie ihn überschreibt.
    expect(() => testUmgebung({ KYC_IMAGE_ENCRYPTION_KEY: 'zu-kurz' })).toThrow(
      /32 bytes|32 Byte/i,
    );
  });
});

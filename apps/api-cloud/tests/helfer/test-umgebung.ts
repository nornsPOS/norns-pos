/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EINE UMGEBUNG FÜR DIE TESTS, AUS DEM SCHEMA STATT AUS ABSCHRIFTEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 13.08.2026 ─────────────────────────────────────────────
 *
 * `tsconfig.json` schliesst `tests` aus, `tsconfig.tests.json` nimmt nur
 * `tests/unit`, und `tsconfig.fiskal.json` zählt VIERZEHN Integrationsdateien
 * namentlich auf. Gemessen gibt es 49. Fünfunddreissig davon wurden von
 * KEINER Typprüfung gelesen.
 *
 * Das ist in diesem Haus schon einmal teuer geworden: `pushCashPointClosing`
 * bekam einen Pflichtwert dazu, die Tests riefen weiter mit der alten Anzahl
 * auf, der Nachbau rutschte in den Nutzlast-Platz, und aus dem Testlauf ging
 * ein ECHTER Netzaufruf gegen fiskaly hinaus.
 *
 * ── WARUM DIE 35 NICHT EINFACH AUFGENOMMEN WURDEN ─────────────────────────
 *
 * Weil die Prüfung dann sofort rot gewesen wäre. Nachgemessen sind es aber
 * viel weniger Fehler als der alte Kommentar vermuten liess:
 *
 *     Dateien mit Typfehlern   18 von 49
 *     Fehler insgesamt         33
 *     davon EINE Ursache       14  (genau diese hier)
 *
 * Die vierzehn bauen jeweils ihr EIGENES Umgebungsobjekt aus etwa zwanzig
 * Werten und reichen es dort hinein, wo ein vollständiges `Env` erwartet
 * wird. Das Schema kennt inzwischen rund 85. Jede dieser Abschriften ist eine
 * Kopie, die driftet, und sie driften alle in dieselbe Richtung.
 *
 * ── WAS DIESE DATEI TUT, UND WAS SIE BEWUSST NICHT TUT ────────────────────
 *
 * Sie fragt das Schema selbst nach seinen Vorgaben (`loadEnv` verlangt
 * gemessen nur `DATABASE_URL` und `NORNS_PII_KEY`, alles Übrige trägt
 * es nach) und legt die eigenen Werte der Testdatei DARÜBER.
 *
 * ⚠️ Damit ist der Eingriff verhaltensneutral: was eine Datei ausdrücklich
 * setzt, gilt weiterhin genau so. Es kommt nur hinzu, was ohnehin die Vorgabe
 * des Schemas ist.
 *
 * ⚠️ Und es ist KEINE Zusicherung. Die fiskale Bühne behilft sich mit
 * `umgebung as Env`, und ihr eigener Kommentar nennt das „schlicht falsch".
 * Eine Zusicherung sagt dem Übersetzer, er solle wegsehen; genau dann ist der
 * nächste fehlende Pflichtwert wieder unsichtbar. Hier entsteht ein echtes
 * `Env`, und ein neuer Pflichtwert im Schema fällt sofort auf.
 */

import { type Env, assertKycImageKeyValid, loadEnv } from '../../src/config/env.js';

/** Derselbe Schlüssel wie in der fiskalen Bühne. Nur für Tests. */
const PII_SCHLUESSEL_FUER_TESTS = 'test-pii-key-do-not-use-in-production-32b';

/**
 * ⚠️ VIER PFLICHTWERTE, NICHT ZWEI. BEFUND VOM 13.08.2026, TEUER BEZAHLT.
 *
 * Der erste Entwurf gab nur `DATABASE_URL` und `NORNS_PII_KEY` mit.
 * Grund: eine Sonde von mir, deren Ausgabe ich mit `grep -A2` gelesen habe.
 * Die Meldung von `loadEnv` ist 386 Zeichen lang und nennt VIER fehlende
 * Werte; zwei Zeilen davon zeigten zwei. Das Fiskaltor stand daraufhin mit
 * FÜNFZEHN gescheiterten Mappen da, alle mit derselben Zeile:
 *
 *     /AUTH_SECRET — Expected required property
 *     /KYC_IMAGE_ENCRYPTION_KEY — Expected required property
 *
 * Dieselbe Klasse, die ich denselben Tag an sechs Wächtern behoben habe, nur
 * diesmal in meinem eigenen Messwerkzeug: ein Fenster über der Ausgabe.
 *
 * Beide haben im Schema BEWUSST keine Vorgabe (`env.ts:173`: „NO default ON
 * PURPOSE — boot MUST fail if absent"). Das ist richtig so und darf nicht
 * aufgeweicht werden; die Vorgabe gehört hierher, in die Testvorlage.
 */
const AUTH_GEHEIMNIS_FUER_TESTS = 'norns-test-auth-secret-do-not-use-in-production';

/**
 * Muss base64 auf GENAU 32 Byte aufgehen (AES-256), siehe
 * `assertKycImageKeyValid`. Der Klartext dahinter ist
 * `norns-test-key-do-not-use-in-pro`, also 32 Zeichen, damit jeder sofort
 * sieht, dass es kein echter Schlüssel ist.
 */
const KYC_SCHLUESSEL_FUER_TESTS = 'bm9ybnMtdGVzdC1rZXktZG8tbm90LXVzZS1pbi1wcm8=';

/**
 * Ein vollständiges `Env` für einen Test.
 *
 * @param eigene Die Werte, auf die es diesem Test wirklich ankommt. Sie
 *   gewinnen gegen jede Vorgabe des Schemas.
 */
export function testUmgebung(eigene: Partial<Env> = {}): Env {
  const vomSchema = loadEnv({
    NODE_ENV: 'test',
    // Alle VIER sind Pflicht und haben im Schema bewusst keine Vorgabe. Die
    // meisten Tests überschreiben die Datenbank ohnehin über `dbOverride`.
    DATABASE_URL: 'postgres://ungenutzt-wegen-dbOverride',
    NORNS_PII_KEY: PII_SCHLUESSEL_FUER_TESTS,
    AUTH_SECRET: AUTH_GEHEIMNIS_FUER_TESTS,
    KYC_IMAGE_ENCRYPTION_KEY: KYC_SCHLUESSEL_FUER_TESTS,
  } as NodeJS.ProcessEnv);

  const fertig = { ...vomSchema, ...eigene };

  /**
   * ⚠️ DER SCHLÜSSEL WIRD NACHGEMESSEN, NICHT GEGLAUBT.
   *
   * `assertKycImageKeyValid` ist der Riegel, den der ECHTE Start benutzt: der
   * Schlüssel muss base64 auf genau 32 Byte aufgehen. Ein vertippter
   * Testschlüssel wäre sonst erst dort aufgefallen, wo ein Test wirklich ein
   * Ausweisbild verschlüsselt, also weit weg von der Ursache.
   *
   * Er läuft ausdrücklich auf dem FERTIGEN Wert, also nach `eigene`: setzt ein
   * Test einen eigenen Schlüssel, wird auch der geprüft.
   */
  assertKycImageKeyValid(fertig);

  return fertig;
}

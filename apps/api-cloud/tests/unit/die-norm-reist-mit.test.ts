/**
 * Die amtliche Norm muss beim Händler auf der Platte liegen.
 *
 * ── DER FUND VOM 02.08.2026 ────────────────────────────────────────────────
 *
 * `dsfinvk-amtlich.ts` las die amtliche `index.xml` mit
 *
 *     readFileSync(new URL('../fiskal/dsfinvk-2.4/index.xml', import.meta.url))
 *
 * Im Baum stimmt das. Im AUSGELIEFERTEN Paket nicht: der Motor reist als ein
 * einziges gebündeltes `start.mjs`, dort zeigt `import.meta.url` auf
 * `resources/sidecar/start.mjs`, und `../fiskal/…` landet daneben im Leeren.
 *
 * Gemessen am gebauten Mac-Paket: es enthielt KEINE einzige `index.xml`.
 *
 * Am Tresen: der Prüfer steht im Laden, der Händler drückt den Knopf für die
 * Kassennachschau nach § 146b AO, und der Export bricht ab. Das ist der Fall,
 * der Bussgeld kostet. Ein DSFinV-K-Datenträger ohne `index.xml` ist für das
 * Prüfwerkzeug ausserdem nicht einlesbar: die Datei beschreibt ihm die
 * zwanzig CSV-Dateien.
 *
 * ── WAS DIESER WÄCHTER SCHÜTZT ────────────────────────────────────────────
 *
 * Nicht den Pfad, sondern die Eigenschaft: die Norm liegt DA, wo die
 * ausgelieferte Kasse sie sucht. Und der Lesevorgang findet sie an jedem der
 * drei möglichen Orte.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { amtlicheBeschreibung, amtlicheTaxonomie } from '../../src/lib/dsfinvk-amtlich.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const IM_BAUM = resolve(HIER, '../../src/fiskal/dsfinvk-2.4');
const IM_PAKET = resolve(
  HIER,
  '../../../tauri-pos/src-tauri/resources/sidecar/fiskal/dsfinvk-2.4',
);

/** Was ein Prüfer zwingend braucht. */
const PFLICHTDATEIEN = ['index.xml', 'gdpdu-01-09-2004.dtd'] as const;

describe('Die amtliche Norm reist mit', () => {
  it('sie liegt im Baum', () => {
    for (const datei of PFLICHTDATEIEN) {
      expect(existsSync(resolve(IM_BAUM, datei)), `${datei} fehlt im Baum`).toBe(true);
    }
  });

  it('⛔ und sie liegt im AUSGELIEFERTEN Paket der Kasse', () => {
    // Das ist der eigentliche Satz. Der Baum hilft dem Händler nicht.
    for (const datei of PFLICHTDATEIEN) {
      expect(
        existsSync(resolve(IM_PAKET, datei)),
        `${datei} fehlt in resources/sidecar/fiskal/dsfinvk-2.4. Der Prüferknopf ` +
          'bricht dann beim Händler ab. Kopieren mit: ' +
          'node apps/api-cloud/scripts/kopiere-fiskaldateien.mjs',
      ).toBe(true);
    }
  });

  it('die ausgelieferte Fassung ist Byte für Byte die des Baums', () => {
    // Eine abweichende Kopie wäre schlimmer als keine: der Prüfer bekäme eine
    // Beschreibung, die nicht zu den Dateien passt.
    for (const datei of PFLICHTDATEIEN) {
      const baum = readFileSync(resolve(IM_BAUM, datei));
      const paket = readFileSync(resolve(IM_PAKET, datei));
      expect(paket.equals(baum), `${datei} weicht ab`).toBe(true);
    }
  });

  it('der Lesevorgang findet sie WIRKLICH und liefert die Norm', () => {
    // Nicht nur „die Datei liegt da", sondern: die Funktion, die der
    // Prüferknopf ruft, kommt an sie heran.
    const xml = amtlicheTaxonomie();
    expect(xml.length).toBeGreaterThan(1000);
    expect(xml).toContain('<DataSet>');
    expect(xml).toContain('DecimalSymbol');
  });

  it('das Prüferpaket trägt beide Beschreibungsdateien', () => {
    const dateien = amtlicheBeschreibung({ name: 'Muster Edelmetall e. K.' });
    expect(dateien.map((d) => d.name).sort()).toEqual([...PFLICHTDATEIEN].sort());
    // Und der Absender steht drin: ein Datenträger ohne Absender zeigt dem
    // Prüfer Zahlen, aber nicht, wessen Zahlen.
    const index = dateien.find((d) => d.name === 'index.xml');
    expect(index?.content).toContain('Muster Edelmetall e. K.');
  });

  it('fehlt die Datei, kommt ein SATZ und kein roher Systemfehler', () => {
    // Der Händler steht mit dem Prüfer da. Ein Dateipfad als Fehlermeldung
    // wäre die schlechteste aller Antworten.
    const quelle = readFileSync(resolve(HIER, '../../src/lib/dsfinvk-amtlich.ts'), 'utf8');
    expect(quelle).toMatch(/Die amtliche Beschreibungsdatei/);
    expect(quelle).toMatch(/Fehler der Auslieferung/);
    // Und es wird an MEHREREN Orten gesucht, nicht an genau einem.
    expect(quelle).toMatch(/\.\/fiskal\/dsfinvk-2\.4/);
    expect(quelle).toMatch(/\.\.\/fiskal\/dsfinvk-2\.4/);
  });
});

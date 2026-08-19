/**
 * JEDER echte Druckversuch bewegt die grüne Marke.
 *
 * ── DER FUND (26.07.2026) ──────────────────────────────────────────────────
 * Ein gescheiterter Druck am Tresen fasste die Marke nie an. Alle Stellen
 * fingen den Fehler, zeigten einen Hinweis und schrieben nichts. Der Punkt war
 * also nicht nur vor dem ersten Fehlschlag grün — er blieb es nach dem zehnten.
 *
 * Am Tresen: morgens alles grün, um 11 Uhr rutscht das Kabel raus, bis zum
 * Feierabend bleibt der Punkt grün. Der erste Beleg, der nicht kommt, ist die
 * Entdeckung — und der Belegdruck ist Pflicht, also steht der Verkauf.
 *
 * ── WARUM DIESE PRÜFUNG UND KEIN ZENTRALER AUFRUF ──────────────────────────
 * Die Messung gehörte eigentlich EINMAL in `thermalClient.print`, so wie es die
 * Papierbreite vormacht. Das geht hier nicht: `hardware-reprobe` liest bereits
 * `hardware-client` (wegen `isHardwareError`), der zentrale Aufruf würde also
 * einen Importring schliessen. Ein Ring, der heute funktioniert und beim
 * nächsten Bündler-Umbau kippt, ist schlechter als fünf sichtbare Zeilen.
 *
 * Also fünf Zeilen — und dieser Wächter, damit die sechste nicht vergessen
 * wird. Genau das ist beim ersten Anlauf passiert: zwei von fünf Stellen wurden
 * behoben, drei blieben stumm, und die Marke log weiter für den Ankaufbeleg,
 * den Nachdruck und den Testdruck.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const WURZEL = new URL('..', import.meta.url).pathname;

/**
 * Die Handgriffe, die WIRKLICH Daten an ein Gerät geben.
 *
 * `check` und `detectReceiptPrinter` stehen bewusst NICHT hier: die eine
 * öffnet eine Verbindung ohne ein einziges Byte (damit sie nie den Schneider
 * weckt), die andere fragt nur das Betriebssystem. Keine von beiden ist ein
 * Druckversuch.
 */
const DRUCKAUFRUFE = [/\bthermalClient\.print\s*\(/, /\blabelClient\.print\s*\(/];

function alleQuellen(verzeichnis: string, gesammelt: string[] = []): string[] {
  for (const eintrag of readdirSync(verzeichnis)) {
    const pfad = join(verzeichnis, eintrag);
    if (statSync(pfad).isDirectory()) alleQuellen(pfad, gesammelt);
    else if (/\.(ts|tsx)$/.test(eintrag) && !/\.test\.tsx?$/.test(eintrag)) gesammelt.push(pfad);
  }
  return gesammelt;
}

/**
 * Zwei Dateien reden ÜBER diese Handgriffe, statt sie zu benutzen: die Brücke
 * definiert `print`, und der Melder definiert `notePrintOutcome`. Beide dürfen
 * den Namen nennen, ohne dass daraus eine Druckstelle wird.
 */
const NUR_DEFINITIONEN = ['lib/hardware-client.ts', 'lib/hardware-reprobe.ts'];

describe('die grüne Marke folgt dem echten Druck', () => {
  const dateien = alleQuellen(WURZEL)
    .map((p) => ({ kurz: p.slice(WURZEL.length), text: readFileSync(p, 'utf8') }))
    .filter((d) => !NUR_DEFINITIONEN.includes(d.kurz));

  it('liest ueberhaupt Quelltext', () => {
    // Ein Waechter, der versehentlich nichts liest, ist immer gruen und damit
    // schlimmer als keiner.
    expect(dateien.length).toBeGreaterThan(100);
  });

  it('findet die Druckstellen, die es wirklich gibt', () => {
    // Faellt diese Zahl, wurde eine Druckstelle entfernt oder umbenannt — dann
    // gehoert die Liste unten geprueft, nicht die Zahl angepasst.
    const mit = dateien.filter((d) => DRUCKAUFRUFE.some((r) => r.test(d.text)));
    expect(mit.length).toBeGreaterThanOrEqual(4);
  });

  it('JEDE Datei, die druckt, meldet auch das Ergebnis', () => {
    const stumm = dateien
      .filter((d) => DRUCKAUFRUFE.some((r) => r.test(d.text)))
      .filter((d) => !/\bnotePrintOutcome\s*\(/.test(d.text))
      .map((d) => d.kurz);
    expect(stumm).toEqual([]);
  });

  it('meldet BEIDE Ausgaenge, nicht nur den Erfolg', () => {
    // Nur den Erfolg zu melden waere der halbe Fehler: die Marke wuerde nie
    // rot. Genau darum ging es.
    const halb = dateien
      .filter((d) => /\bnotePrintOutcome\s*\(/.test(d.text))
      .filter((d) => {
        const erfolg = /notePrintOutcome\(\s*'[a-z]+'\s*,\s*null\s*\)/.test(d.text);
        const fehler = /notePrintOutcome\(\s*'[a-z]+'\s*,\s*(err|error|e)\s*\)/.test(d.text);
        return !(erfolg && fehler);
      })
      .map((d) => d.kurz);
    expect(halb).toEqual([]);
  });
});

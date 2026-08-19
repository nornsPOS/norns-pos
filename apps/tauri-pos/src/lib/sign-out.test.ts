/**
 * Es gibt GENAU EINE Abmeldung.
 *
 * ── WARUM DIESER WÄCHTER ───────────────────────────────────────────────────
 * Am 25.07.2026 hatte die Kasse drei Abmelde-Knöpfe und nur einer räumte auf.
 * Die beiden anderen sahen im Quelltext völlig harmlos aus — vier Zeilen,
 * Sitzung weg, fertig. Nichts warnte: keine Typprüfung, kein Test, kein
 * Übersetzer. Der Schaden zeigte sich erst am Tresen, als der nächste Mensch
 * den Korb seines Vorgängers vorfand und die Ware im Netz gesperrt blieb.
 *
 * Diese Prüfung ist deshalb absichtlich grob: sie liest den Quelltext und
 * verlangt, dass NIEMAND ausser der Kaskade selbst beim Server abmeldet oder
 * die Sitzungsmarke von Hand wegwirft. Wer einen vierten Knopf baut, wird hier
 * rot — und muss `fuehreAbmeldungAus` benutzen.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PER_OPERATOR_STORAGE_KEYS } from './sign-out.js';

const WURZEL = new URL('..', import.meta.url).pathname;

/** Die eine Datei, die abmelden darf. */
const DIE_KASKADE = 'lib/sign-out.ts';

/**
 * Und die eine Datei, die den Handgriff DEFINIERT — sie ruft ihn nicht auf,
 * sie erklaert nur, was er tut.
 */
const DIE_DEFINITION = 'lib/session-token.ts';

function alleQuellen(verzeichnis: string, gesammelt: string[] = []): string[] {
  for (const eintrag of readdirSync(verzeichnis)) {
    const pfad = join(verzeichnis, eintrag);
    if (statSync(pfad).isDirectory()) {
      alleQuellen(pfad, gesammelt);
    } else if (/\.(ts|tsx)$/.test(eintrag) && !/\.test\.tsx?$/.test(eintrag)) {
      gesammelt.push(pfad);
    }
  }
  return gesammelt;
}

describe('die Abmeldung ist EINE', () => {
  const dateien = alleQuellen(WURZEL).map((p) => ({
    kurz: p.slice(WURZEL.length),
    text: readFileSync(p, 'utf8'),
  }));

  it('findet ueberhaupt Quelltext (sonst prueft der Waechter nichts)', () => {
    // Ein Waechter, der versehentlich nichts liest, ist immer gruen und damit
    // schlimmer als keiner.
    expect(dateien.length).toBeGreaterThan(100);
  });

  it('niemand ausser der Kaskade meldet beim Server ab', () => {
    const suender = dateien
      .filter((d) => d.kurz !== DIE_KASKADE && /authPin\.signOut\s*\(/.test(d.text))
      .map((d) => d.kurz);
    expect(suender).toEqual([]);
  });

  it('niemand ausser der Kaskade wirft die Sitzungsmarke von Hand weg', () => {
    // `clearSessionToken` allein ist die Abkuerzung, um die es ging: sie sieht
    // aus wie eine Abmeldung, laesst aber Korb, Reservierungen und
    // Zwischenspeicher stehen.
    const suender = dateien
      .filter(
        (d) =>
          d.kurz !== DIE_KASKADE &&
          d.kurz !== DIE_DEFINITION &&
          /\bclearSessionToken\s*\(\s*\)/.test(d.text),
      )
      .map((d) => d.kurz);
    expect(suender).toEqual([]);
  });

  it('die personengebundenen Schluessel stehen an EINER Stelle', () => {
    // Die Liste darf nicht in einem Bildschirm zweitgepflegt werden — sonst
    // vergisst eine der beiden Kopien den naechsten neuen Schluessel.
    for (const key of PER_OPERATOR_STORAGE_KEYS) {
      const orte = dateien.filter((d) => d.kurz !== DIE_KASKADE && d.text.includes(`'${key}'`));
      // Der Speicher selbst darf seinen eigenen Schluessel natuerlich nennen.
      const fremde = orte.filter((d) => !d.kurz.startsWith('state/'));
      expect(fremde.map((d) => d.kurz), `Schluessel ${key}`).toEqual([]);
    }
  });

  it('nennt die TSE-Warteschlange NICHT — sie ist fiskalisch, nicht persoenlich', () => {
    // §146a KassenSichV: offene Signaturen gehoeren dem Haus, nicht der Sitzung.
    // Ein Abmelden darf sie niemals loeschen.
    for (const key of PER_OPERATOR_STORAGE_KEYS) {
      expect(key.toLowerCase()).not.toContain('tse');
    }
  });
});

/**
 * typografie-waechter — kein Gedankenstrich, kein Unterstrich im sichtbaren Text.
 *
 * ── BASELS HARTE REGEL (29.07.2026, wörtlich eingefordert) ───────────────────
 * Im sichtbaren Text der Kasse gibt es KEINE Gedankenstriche (— oder –) und
 * KEINE Unterstriche. Ein Gedanke wird mit Komma, Punkt oder „bis" gefügt.
 * Am 29.07. standen wieder zehn Gedankenstriche in neun Dateien — jede Hand
 * schreibt sie aus Gewohnheit nach. Eine Regel, die nur in einer Erinnerung
 * wohnt, verliert gegen die Gewohnheit; darum wohnt sie jetzt hier, als Rot.
 *
 * ── WAS ALS SICHTBAR GILT (dieselbe Messlatte wie die Zählung) ──────────────
 * Einfach-quotierte Literale, die ein Leerzeichen UND einen Großbuchstaben
 * tragen — also deutsche Sätze und Beschriftungen, keine Pfade, keine Schlüssel,
 * keine CSS-Werte. Kommentare prüft der Wächter nicht: sie erreichen kein Auge
 * am Tresen. Template-Literale mit Interpolation bleiben außen vor (sie tragen
 * hier keine Fließtexte); wer eines mit Gedankenstrich anlegt, hebe es in ein
 * Literal und der Wächter greift.
 *
 * AUSNAHMEN sind einzeln zu begründen. Amtliche Dateinamen (cash_per_currency.csv)
 * sind unvermeidbare Literale im Sinne der Regel und über das Dateinamen-Muster
 * ausgenommen, nicht über eine Freiliste.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WURZEL = join(__dirname);

function alleQuellen(verz: string): string[] {
  const ergebnis: string[] = [];
  for (const name of readdirSync(verz)) {
    const voll = join(verz, name);
    if (statSync(voll).isDirectory()) {
      ergebnis.push(...alleQuellen(voll));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name) || /\.test\./.test(name)) continue;
    ergebnis.push(voll);
  }
  return ergebnis;
}

/** Kommentare grob entfernen, damit Erklärtexte im Code nicht mitzählen. */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Sichtbar = trägt ein Leerzeichen und irgendeinen Buchstaben. Die erste
 * Fassung verlangte einen GROSSBUCHSTABEN und liess „— noch nicht gewählt —"
 * durch (komplett kleingeschrieben, stand sichtbar in der Land-Auswahl).
 * CSS-Werte wie '1px solid …' tragen zwar Leerzeichen, aber nie einen
 * Gedankenstrich oder ein deutsches Wort mit Unterstrich — die weichere
 * Schwelle kostet also nichts. Amtliche Dateinamen sind erlaubt.
 */
function istSichtbar(s: string): boolean {
  if (!s.includes(' ') || !/[a-zA-ZäöüÄÖÜß]/.test(s)) return false;
  if (/\w+_\w+\.(csv|json|xml|dtaus|zip)/.test(s)) return false;
  return true;
}

/**
 * ALLE drei Schreibweisen einer Zeichenkette, nicht nur eine.
 *
 * ── DER BEFUND VOM 13.08.2026 ──────────────────────────────────────────────
 *
 * Dieser Waechter war gruen und sah trotzdem nur `'einfache'`
 * Anfuehrungszeichen. In `LocalLock.tsx` stand in einer SCHABLONE ein Satz mit
 * einem Gedankenstrich, den der Kassierer liest, wenn sich die Laenge seines
 * Codes aendert. Der Strich stand also mitten auf dem Schirm, und der Waechter,
 * den es genau dagegen gibt, konnte ihn nicht sehen.
 *
 * Der Kopf dieser Datei behauptete sogar, Schablonen truegen hier keine
 * Fliesstexte. Das war einmal wahr und ist es nicht mehr: deutsche Saetze mit
 * eingesetzten Werten werden in React fast immer als Schablone geschrieben,
 * also gerade dort, wo der Waechter blind war.
 *
 * Dieselbe Lehre wie bei seiner ersten Luecke (JSX-Fliesstext zwischen Tags):
 * eine Regel, die nur EINE Schreibweise misst, ist keine Regel, sondern eine
 * Stichprobe.
 */
function textstellen(quelle: string): Array<{ art: string; text: string }> {
  const gefunden: Array<{ art: string; text: string }> = [];
  for (const m of quelle.matchAll(/'([^'\\\n]{2,200})'/g)) {
    gefunden.push({ art: '', text: m[1] as string });
  }
  for (const m of quelle.matchAll(/"([^"\\\n]{2,200})"/g)) {
    gefunden.push({ art: 'doppelt', text: m[1] as string });
  }
  // Schablonen duerfen ueber Zeilen gehen und Einsetzungen tragen. Die
  // Einsetzungen werden durch ein Leerzeichen ersetzt, damit ein Ausdruck
  // darin nicht als Text zaehlt, die Wortgrenze aber erhalten bleibt.
  for (const m of quelle.matchAll(/`([^`\\]{2,400})`/g)) {
    gefunden.push({ art: 'Schablone', text: (m[1] as string).replace(/\$\{[^}]*\}/g, ' ') });
  }
  return gefunden;
}

describe('typografie-waechter: sichtbarer Text bleibt frei von Strich-Unarten', () => {
  const dateien = alleQuellen(WURZEL);

  it('findet überhaupt Quelldateien (sonst prüft er ins Leere)', () => {
    expect(dateien.length).toBeGreaterThan(100);
  });

  it('kein Gedankenstrich (— oder –) in sichtbarem Text', () => {
    const verstoesse: string[] = [];
    for (const datei of dateien) {
      const quelle = ohneKommentare(readFileSync(datei, 'utf8'));
      for (const stelle of textstellen(quelle)) {
        const s = stelle.text;
        if (!istSichtbar(s)) continue;
        if (s.includes('—') || s.includes('–')) {
          verstoesse.push(`${datei.replace(WURZEL, 'src')}: ${stelle.art} '${s.slice(0, 60)}'`);
        }
      }
      // JSX-Fließtext zwischen Tags: „<option>— noch nicht gewählt —</option>"
      // stand SICHTBAR in der Land-Auswahl und war kein Literal — die erste
      // Fassung sah nur Literale und blieb grün. Text zwischen > und < zählt.
      for (const m of quelle.matchAll(/>([^<>{}\n]*[—–][^<>{}\n]*)</g)) {
        verstoesse.push(`${datei.replace(WURZEL, 'src')}: JSX '${(m[1] as string).trim().slice(0, 60)}'`);
      }
    }
    expect(
      verstoesse,
      `Gedankenstrich im sichtbaren Text — Komma, Punkt oder „bis" verwenden:\n  ${verstoesse.join('\n  ')}`,
    ).toEqual([]);
  });

  it('kein Unterstrich in sichtbarem Text (rohe Schlüssel gehören übersetzt)', () => {
    /**
     * ⚠️ ABSICHTLICH NUR EINFACHE ANFUEHRUNGSZEICHEN, anders als die Regel
     * darueber. Gemessen am 13.08.2026: laese diese Regel auch Schablonen,
     * gaebe es 31 Treffer, davon 29 SQL (`outbox_mutations`, `customer_kyc`,
     * `tse_signature_queue`), dazu der amtliche DATEV-Dateiname
     * `EXTF_Buchungsstapel_` und zwei Kennungs-Vorsaetze der Vorschau.
     *
     * Ein Waechter, der ueber Tabellennamen schimpft, wird weggeschaut, und
     * dann sieht auch niemand mehr den echten Fund darin. Ihn mit einer
     * Freiliste zu retten verbietet diese Datei sich selbst (siehe Kopf).
     * Ein Gedankenstrich dagegen hat in SQL nichts zu suchen, deshalb darf die
     * Regel darueber alle drei Schreibweisen lesen.
     */
    const verstoesse: string[] = [];
    for (const datei of dateien) {
      const quelle = ohneKommentare(readFileSync(datei, 'utf8'));
      for (const m of quelle.matchAll(/'([^'\\\n]{2,200})'/g)) {
        const s = m[1] as string;
        if (!istSichtbar(s)) continue;
        if (/\w_\w/.test(s)) {
          verstoesse.push(`${datei.replace(WURZEL, 'src')}: '${s.slice(0, 60)}'`);
        }
      }
    }
    expect(
      verstoesse,
      `Unterstrich im sichtbaren Text — deutsches Wort statt rohem Schlüssel:\n  ${verstoesse.join('\n  ')}`,
    ).toEqual([]);
  });
});

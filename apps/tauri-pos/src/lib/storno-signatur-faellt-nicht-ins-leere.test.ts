/**
 * ════════════════════════════════════════════════════════════════════════
 *  DIE STORNO-SIGNATUR DARF NICHT IN EIN LEERES `catch` FALLEN
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND ──────────────────────────────────────────────────────────
 *
 * $ sed -n 286,296p apps/tauri-pos/src/screens/verkauf/StornoDialog.tsx
 *             });
 *           }
 *         } catch {
 *           // Der Storno steht. Die Signatur holt die Warteschlange nach.
 *         }
 *
 * $ grep -c "enqueueSignatureRecordOnly" .../StornoDialog.tsx
 * 0
 *
 * Der Kommentar behauptet das Gegenteil dessen, was der Code tut: es gibt
 * keine Warteschlange, die hier etwas nachholt. Verkauf und Ankauf rufen an
 * genau dieser Stelle `enqueueSignatureRecordOnly` und melden dem Kassierer
 * zusätzlich, ob die Sicherung geklappt hat. Der Storno tut beides nicht.
 *
 * Der FINISH war erfolgreich, die Signatur liegt also im Fenster — und
 * verschwindet beim nächsten Klick, wenn die Server-Aufzeichnung abgelehnt
 * wird. Kein Hinweis, keine Zeile in `tse_signature_queue`, kein Zähler im
 * Gerätemanager. Und dieser Dialog druckt NICHTS, es gibt also nicht einmal
 * eine Papierkopie.
 *
 * ── DER ZWEITE BEFUND IN DERSELBEN MASKE ────────────────────────────────
 *
 * Der Storno-POST ging ohne eigenen Idempotenzschlüssel hinaus. Ohne Netz
 * erzeugt jeder Versuch deshalb eine EIGENE Zeile im Ausgangskorb, jede mit
 * einem frisch erfundenen Schlüssel. Beim Abspielen geht die erste durch, die
 * zweite fällt in den Riegel „höchstens ein Storno je Beleg" — und ein
 * Konflikt HÄLT den ganzen Ausgangskorb an (`drainOutbox` → `markConflict`).
 * Zwei Klicks der Kassiererin legen damit jeden fiskalischen Vorgang dahinter
 * still, bis ein Mensch ihn auflöst.
 *
 * ── WAS DIESER WÄCHTER MISST ────────────────────────────────────────────
 *
 * Teil A misst den QUELLTEXT der Maske, aber mit weggeschnittenen Kommentaren
 * und Zeichenketten: ein blosses Erwähnen des Namens in einem Kommentar zählt
 * nicht, nur der wirkliche Aufruf.
 *
 * Teil B fährt die Entscheidung selbst, mit eingesetzten Nahtstellen: nach
 * einer abgelehnten Aufzeichnung MUSS eingereiht werden, und der Mensch MUSS
 * einen Satz bekommen, der die Lage trifft.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  stornoSignaturHinweis,
  stornoSignaturSichern,
} from './storno-signatur-sichern.js';

const DIALOG = fileURLToPath(
  new URL('../screens/verkauf/StornoDialog.tsx', import.meta.url),
);

/**
 * Kommentare und Zeichenketten wegschneiden.
 *
 * ⚠️ Ohne das misst dieser Wächter eine ERWÄHNUNG statt einen GEBRAUCH: der
 * Kopf dieser Maske nennt `enqueueSignatureRecordOnly` künftig im Fliesstext,
 * und ein blosses `grep` wäre danach für immer grün, auch wenn der Aufruf
 * wieder verschwände.
 */
function nurCode(quelle: string): string {
  let aus = '';
  let i = 0;
  type Lage = 'code' | 'zeile' | 'block' | "'" | '"' | '`';
  let lage: Lage = 'code';
  while (i < quelle.length) {
    const z = quelle[i]!;
    const zwei = quelle.slice(i, i + 2);
    if (lage === 'code') {
      if (zwei === '//') {
        lage = 'zeile';
        i += 2;
        continue;
      }
      if (zwei === '/*') {
        lage = 'block';
        i += 2;
        continue;
      }
      if (z === "'" || z === '"' || z === '`') {
        lage = z;
        i += 1;
        continue;
      }
      aus += z;
      i += 1;
      continue;
    }
    if (lage === 'zeile') {
      if (z === '\n') {
        lage = 'code';
        aus += '\n';
      }
      i += 1;
      continue;
    }
    if (lage === 'block') {
      if (zwei === '*/') {
        lage = 'code';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    // in einer Zeichenkette
    if (z === '\\') {
      i += 2;
      continue;
    }
    if (z === lage) lage = 'code';
    i += 1;
  }
  return aus;
}

describe('⛔ Teil A: die Maske selbst', () => {
  const code = nurCode(readFileSync(DIALOG, 'utf8'));

  it('⚠️ DER KERN: eine abgelehnte Aufzeichnung wird eingereiht, nicht geschluckt', () => {
    expect(code, 'kein Aufruf, nur Prosa').toContain('stornoSignaturSichern(');
  });

  it('es gibt kein leeres Fangwerk mehr in dieser Maske', () => {
    // `catch {}` bzw. `catch (x) {}` ohne einen einzigen Befehl darin. Genau
    // das war der Befund: der Kommentar trug die Behauptung, der Rumpf war leer.
    expect(code).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*\}/);
  });

  it('⚠️ der Storno-POST trägt einen eingefrorenen Idempotenzschlüssel', () => {
    // Ohne ihn erfindet das Mittelstück je Versuch einen neuen, und zwei
    // Klicks ohne Netz legen den ganzen Ausgangskorb still.
    expect(code).toMatch(/stornoSchluesselRef\.current/);
    expect(code).toMatch(/custom:\s*\{[^}]*idempotencyKey/);
  });
});

describe('⛔ Teil B: die Entscheidung selbst', () => {
  it('gelingt die Aufzeichnung, wird nichts eingereiht und nichts gemeldet', async () => {
    const einreihen = vi.fn(async () => true);
    const ausgang = await stornoSignaturSichern({
      aufzeichnen: async () => {},
      einreihen,
    });
    expect(ausgang).toEqual({ art: 'aufgezeichnet' });
    expect(einreihen).not.toHaveBeenCalled();
    expect(stornoSignaturHinweis(ausgang)).toBeNull();
  });

  it('⚠️ wird die Aufzeichnung abgelehnt, wandert die Signatur in den Korb', async () => {
    const fehler = Object.assign(new Error('Server 500'), { httpStatus: 500 });
    const einreihen = vi.fn(async () => true);
    const ausgang = await stornoSignaturSichern({
      aufzeichnen: async () => {
        throw fehler;
      },
      einreihen,
    });
    expect(ausgang).toEqual({ art: 'eingereiht', fehler });
    expect(einreihen).toHaveBeenCalledTimes(1);
    expect(einreihen).toHaveBeenCalledWith(fehler);

    const hinweis = stornoSignaturHinweis(ausgang);
    expect(hinweis).not.toBeNull();
    expect(hinweis?.body).toContain('nachgereicht');
  });

  it('⚠️ scheitert AUCH das Einreihen, sagt der Satz die Wahrheit', async () => {
    const fehler = new Error('Ablage gesperrt');
    const ausgang = await stornoSignaturSichern({
      aufzeichnen: async () => {
        throw fehler;
      },
      einreihen: async () => false,
    });
    expect(ausgang).toEqual({ art: 'nur_auf_papier', fehler });

    const hinweis = stornoSignaturHinweis(ausgang);
    expect(hinweis?.title).toBeTruthy();
    // ⚠️ Dieser Dialog DRUCKT NICHTS. Ein Satz „bitte den gedruckten Beleg
    // aufbewahren" wäre hier eine Lüge — es gibt kein Papier.
    expect(hinweis?.body ?? '').not.toMatch(/gedruckten Beleg/);
    // Er muss stattdessen benennen, was wirklich noch da ist und was zu tun ist.
    expect(hinweis?.body).toContain('Sicherungseinrichtung');
  });

  it('ein Fehlschlag des Einreihens wirft NIE in den gebuchten Storno hinein', async () => {
    const ausgang = await stornoSignaturSichern({
      aufzeichnen: async () => {
        throw new Error('403');
      },
      einreihen: async () => {
        throw new Error('die Ablage explodiert');
      },
    });
    // Der Storno IST gebucht. Ein Fehler beim Sichern darf ihn nicht umwerfen.
    expect(ausgang.art).toBe('nur_auf_papier');
  });
});

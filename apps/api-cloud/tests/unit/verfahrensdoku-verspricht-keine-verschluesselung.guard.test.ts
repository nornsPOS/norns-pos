/**
 * ⚠️ WÄCHTER: Die Verfahrensdokumentation darf dem Prüfer nichts versprechen,
 * was der ausliefernde Code nicht tut.
 *
 * ── DER BEFUND, 13.08.2026 ───────────────────────────────────────────────
 *
 * Abschnitt 10 sagte dem Finanzamt woertlich:
 *
 *     „Die Sicherung wird verschlüsselt abgelegt; der Schlüssel liegt im
 *      Schlüsselspeicher des Betriebssystems und verlässt das Gerät nicht."
 *
 * Gemessen im ausliefernden Code (`sidecar/norns-sidecar.mjs`, Funktion
 * `sicherung`): eine LESBARE `.sql`-Datei mit `INSERT`-Zeilen über jede
 * Tabelle, dazu eine wörtliche Kopie der Ordner `fotos` und `kyc` — also
 * Name, Anschrift und Ausweiskopien jedes Kunden im Klartext, auf dem
 * Datenträger, den der Händler mit nach Hause nimmt.
 *
 * Rz. 154 GoBD verlangt, dass die Verfahrensdokumentation dem TATSÄCHLICH
 * eingesetzten Verfahren voll entspricht. Ein Dokument, das ein Verfahren
 * beschreibt, das es nicht gibt, ist selbst der Mangel.
 *
 * ── WAS DIESER WÄCHTER MISST ─────────────────────────────────────────────
 *
 * Nicht einen festen Satz — den koennte man umformulieren und der Wächter
 * bliebe grün. Er misst die BEZIEHUNG zwischen zwei Dateien:
 *
 *     Behauptet `SICHERUNG_IST_VERSCHLUESSELT`, es werde verschlüsselt?
 *     Dann MUSS im Sicherungsweg ein echter Chiffrierschritt stehen.
 *     Und umgekehrt: chiffriert der Code, darf das Dokument nicht mehr
 *     das Gegenteil behaupten.
 *
 * Er wird also an dem Tag rot, an dem jemand die Grösse umstellt, ohne zu
 * verschlüsseln — UND an dem Tag, an dem jemand verschlüsselt und vergisst,
 * es dem Prüfer zu sagen.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  SICHERUNG_IST_VERSCHLUESSELT,
  baueVerfahrensdoku,
} from '../../src/lib/verfahrensdokumentation.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const SICHERUNGSWEG = join(HIER, '../../sidecar/norns-sidecar.mjs');

/** Ruft der Sicherungsweg wirklich eine Chiffre auf? */
function derCodeVerschluesselt(): boolean {
  const quelle = readFileSync(SICHERUNGSWEG, 'utf8');
  // Der Gebrauch, nicht die Erwähnung: Kommentarzeilen fliegen raus.
  const ohneKommentare = quelle
    .split('\n')
    .filter((z) => !z.trim().startsWith('//') && !z.trim().startsWith('*'))
    .join('\n');
  return /createCipheriv|createCipher\b|subtle\.encrypt/.test(ohneKommentare);
}

describe('Verfahrensdokumentation: kein Versprechen ohne Deckung', () => {
  it('die Aussage zur Verschlüsselung deckt sich mit dem ausliefernden Code', () => {
    expect(SICHERUNG_IST_VERSCHLUESSELT).toBe(derCodeVerschluesselt());
  });

  it('solange nicht verschlüsselt wird, sagt Abschnitt 10 das AUSDRÜCKLICH', () => {
    // Ein Dokument, das die Verschlüsselung nur verschweigt, reicht nicht:
    // der Händler muss erfahren, dass er die Datei selbst wegschliessen muss,
    // sonst liegen Ausweiskopien ungeschützt in einer Schublade.
    if (SICHERUNG_IST_VERSCHLUESSELT) return;

    const doku = baueVerfahrensdoku(eingabe());
    const zehn = doku.abschnitte.find((a) => a.nummer === '10');
    expect(zehn, 'Abschnitt 10 (Datensicherung) fehlt').toBeDefined();

    const text = (zehn?.absaetze ?? []).join(' ');
    expect(text).toContain('NICHT verschlüsselt');
    expect(text).toMatch(/Ausweiskopien/);
    // Und keine Restbehauptung aus der alten Fassung.
    expect(text).not.toContain('wird verschlüsselt abgelegt');
    expect(text).not.toContain('verlässt das Gerät nicht');
  });
});

/**
 * Die kleinste Eingabe, mit der sich das Dokument bauen lässt.
 *
 * Bewusst leere Händlerangaben: der Wächter prüft den Satz des ERZEUGNISSES,
 * und der darf nicht davon abhängen, ob ein Betrieb schon eingetragen ist.
 */
function eingabe(): Parameters<typeof baueVerfahrensdoku>[0] {
  return {
    einstellungen: {},
    fassung: '0.2.0',
    jetzt: new Date('2026-08-13T09:00:00Z'),
    schema: {
      tabellen: 89,
      ausloeser: 75,
      pruefbedingungen: 284,
      funktionen: 321,
      wanderungsstand: '0134',
    },
    tse: { tssId: '', clientId: '', eingerichtetAm: '', seriennummer: '' },
  };
}

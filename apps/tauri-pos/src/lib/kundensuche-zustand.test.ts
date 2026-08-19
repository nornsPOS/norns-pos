import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  type KundensucheEingabe,
  anlegenErlaubt,
  kundensucheZustand,
} from './kundensuche-zustand.js';

/** Bequemer Aufbau: alles ruhig, dann einzeln verstellen. */
const eingabe = (teil: Partial<KundensucheEingabe> = {}): KundensucheEingabe => ({
  suchtext: 'Müller',
  isFetching: false,
  isError: false,
  trefferzahl: 0,
  ...teil,
});

describe('kundensucheZustand — die fünf Zustände', () => {
  it('leeres Suchfeld → tippen', () => {
    expect(kundensucheZustand(eingabe({ suchtext: '' }))).toBe('tippen');
  });

  it('nur Leerzeichen im Suchfeld → tippen (es wurde nichts gefragt)', () => {
    expect(kundensucheZustand(eingabe({ suchtext: '   ' }))).toBe('tippen');
  });

  it('Anfrage unterwegs, noch nichts da → sucht', () => {
    expect(kundensucheZustand(eingabe({ isFetching: true }))).toBe('sucht');
  });

  it('Server antwortet mit Fehler → nicht erreichbar', () => {
    expect(kundensucheZustand(eingabe({ isError: true }))).toBe('nicht_erreichbar');
  });

  it('Antwort da, keine Zeilen → leer', () => {
    expect(kundensucheZustand(eingabe())).toBe('leer');
  });

  it('Zeilen vorhanden → treffer', () => {
    expect(kundensucheZustand(eingabe({ trefferzahl: 3 }))).toBe('treffer');
  });
});

describe('kundensucheZustand — der teure Fund: Fehler ist NIEMALS leer', () => {
  // Genau diese Verwechslung stand am Tresen: bei einem Serverfehler ist die
  // Trefferliste leer und es wird nicht mehr geladen. Die Kasse hat daraus
  // „Kein Treffer" gemacht und zum Anlegen eingeladen — an einem gesperrten
  // Verkäufer vorbei.
  it('Fehler mit leerer Trefferliste ergibt NIEMALS leer', () => {
    const z = kundensucheZustand(eingabe({ isError: true, trefferzahl: 0, isFetching: false }));
    expect(z).toBe('nicht_erreichbar');
    expect(z).not.toBe('leer');
  });

  it('Fehler schlägt auch eine laufende Wiederholung — der Anlegen-Knopf darf nicht kurz scharf werden', () => {
    expect(kundensucheZustand(eingabe({ isError: true, isFetching: true }))).toBe(
      'nicht_erreichbar',
    );
  });

  it('Fehler schlägt auch veraltete Zeilen im Speicher', () => {
    expect(kundensucheZustand(eingabe({ isError: true, trefferzahl: 5 }))).toBe('nicht_erreichbar');
  });

  it('Zeilen schlagen eine laufende Wiederholung — die Liste soll nicht flackern', () => {
    expect(kundensucheZustand(eingabe({ isFetching: true, trefferzahl: 2 }))).toBe('treffer');
  });

  it('ohne Suchtext bleibt es tippen, auch wenn ein alter Fehler anliegt', () => {
    expect(kundensucheZustand(eingabe({ suchtext: '', isError: true }))).toBe('tippen');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Wächter: die drei Masken müssen den Fehler WIRKLICH weiterreichen.
//
// Die reine Funktion oben kann noch so richtig sein — der Fehler von damals war
// ein WIRING-Fehler, und der Typprüfer sieht ihn nicht: `isError` einfach nicht
// zu übergeben oder das alte Muster stehen zu lassen übersetzt sauber. Deshalb
// liest dieser Wächter den Quelltext der drei Masken.
// ──────────────────────────────────────────────────────────────────────────

const hier = dirname(fileURLToPath(import.meta.url));

/**
 * NACHGEFÜHRT, als die vier Masken auf das gemeinsame Bauteil kamen.
 *
 * Vorher verlangte dieser Wächter von JEDER Maske den Aufruf `kundensucheZustand`
 * — richtig, solange jede Maske ihre eigene Suche mitbrachte. Seit
 * `screens/kunden/KundenSucher.tsx` die Suche für alle führt, wäre genau diese
 * Forderung ein Rückschritt: sie verlangte die Verdopplung, die den Fund erst
 * möglich gemacht hat.
 *
 * Der Wächter prüft deshalb jetzt die KETTE statt der Wiederholung:
 *   1. jede Maske hängt an der geteilten Entscheidung,
 *   2. das gemeinsame Bauteil reicht den ECHTEN Fehler der Abfrage hinein,
 *   3. keine Maske trägt das alte, blinde Muster noch.
 * Die Kundenakte steht jetzt mit in der Liste — sie fehlte, und genau dort war
 * der Anlegen-Knopf bei Serverfehler noch scharf.
 */
const BAUTEIL = '../screens/kunden/KundenSucher.tsx';

const masken: ReadonlyArray<{ name: string; pfad: string }> = [
  { name: 'Ankauf', pfad: '../screens/ankauf/CustomerPanel.tsx' },
  { name: 'Verkauf', pfad: '../screens/verkauf/KaeuferPicker.tsx' },
  { name: 'Bewertung', pfad: '../screens/bewertung/BewertungCustomerStep.tsx' },
  { name: 'Kundenakte', pfad: '../screens/kunden/CustomerListPanel.tsx' },
];

/**
 * Kommentare heraus, bevor geprüft wird. Der Fund IST in allen drei Masken als
 * Absatz dokumentiert und zitiert dabei die alte, blinde Zeile wörtlich — der
 * Wächter soll den lebenden Quelltext beurteilen, nicht die Beschreibung des
 * Fehlers. Ohne diesen Schritt würde ausgerechnet die ehrliche Dokumentation
 * den Test rot machen.
 */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/[^\n]*/g, ' ');
}

describe('Wächter — jede Kundensuche fragt den Fehler ab', () => {
  const bauteil = ohneKommentare(readFileSync(resolve(hier, BAUTEIL), 'utf8'));

  // Ausdrücklich `q.isError` und nicht bloss „irgendein isError": ein
  // hartverdrahtetes `isError: false` übersetzt sauber, lässt den Fehlerzweig
  // für immer tot liegen und bringt den Fund vollständig zurück.
  it('das gemeinsame Bauteil reicht den ECHTEN Fehler der Abfrage hinein', () => {
    expect(bauteil).toMatch(/kundensucheZustand\(\{[\s\S]{0,400}?isError:\s*q\.isError/);
  });

  it('das gemeinsame Bauteil meldet den Fehler auch an die Fläche weiter', () => {
    expect(bauteil).toMatch(/istFehler:\s*q\.isError/);
  });

  it('das gemeinsame Bauteil fragt die Anlege-Sperre bei der geprüften Regel ab', () => {
    expect(bauteil).toContain('anlegenErlaubt(');
  });

  for (const maske of masken) {
    const quelle = ohneKommentare(readFileSync(resolve(hier, maske.pfad), 'utf8'));

    it(`${maske.name}: hängt an der geteilten Entscheidung`, () => {
      const haengtDran =
        quelle.includes('kundensucheZustand') ||
        quelle.includes('useKundenSuche') ||
        quelle.includes('kundenSucherAnsicht');
      expect(haengtDran, `${maske.name} entscheidet wieder auf eigene Faust`).toBe(true);
    });

    it(`${maske.name}: trägt das alte, blinde Muster nicht mehr`, () => {
      // Genau diese Zeile hat den Serverfehler als „Kein Treffer" ausgegeben.
      expect(quelle).not.toMatch(/items\.length === 0 && !q\.isFetching/);
    });
  }
});

describe('anlegenErlaubt — der Schutz der bestehenden Kundenakte', () => {
  it('gesperrt, sobald die Suche nicht erreichbar ist', () => {
    expect(anlegenErlaubt('nicht_erreichbar')).toBe(false);
  });

  it('erlaubt in allen anderen Zuständen', () => {
    for (const z of ['tippen', 'sucht', 'leer', 'treffer'] as const) {
      expect(anlegenErlaubt(z)).toBe(true);
    }
  });
});

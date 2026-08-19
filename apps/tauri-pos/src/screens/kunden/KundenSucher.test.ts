/**
 * Prüfungen für den gemeinsamen KundenSucher.
 *
 * Die wichtigste Prüfung ist die erste Gruppe: BEI SERVERFEHLER KEIN
 * ANLEGEN-KNOPF. Dahinter steht der teuerste Fund der Bestandsaufnahme — eine
 * leere Trefferliste bedeutet bei einem Netzfehler dasselbe wie bei einer
 * wirklich unbekannten Person, und die Kasse hat daraus „Kein Treffer" gemacht
 * und zum Anlegen eingeladen. Eine zweite, blanke Akte umgeht Sperrvermerk,
 * Sanktionstreffer und PEP-Fahne der bestehenden.
 *
 * Die zweite Gruppe bewacht die Abfrage-Flaggen. `excludeBlocked: false` ist
 * die Flagge, DAMIT ein gesperrter Mensch überhaupt sichtbar wird; ein
 * Wahrheitstest statt eines Vorhandenseinstests (`if (o.excludeBlocked)`) würde
 * sie lautlos verschlucken und die Warnung wieder abschalten.
 *
 * Die dritte Gruppe ist ein Wächter gegen Rückfall: die drei umgestellten
 * Auswahlmasken dürfen keine eigene Suche, keine eigene Entprellung und keine
 * eigene Trefferzeile mehr mitbringen.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { KundensucheZustand } from '../../lib/kundensuche-zustand.js';
import {
  KUNDENSUCHE_ENTPRELLUNG_MS,
  type KundenRolle,
  kundenRolleTexte,
  kundenSuchAbfrage,
  kundenSucherAnsicht,
} from './KundenSucher.js';

const ALLE_ZUSTAENDE: readonly KundensucheZustand[] = [
  'tippen',
  'sucht',
  'nicht_erreichbar',
  'leer',
  'treffer',
];

describe('bei Serverfehler kein Anlegen-Knopf', () => {
  it('sperrt das Anlegen, wenn die Suche mit Suchtext scheitert', () => {
    const ansicht = kundenSucherAnsicht({
      zustand: 'nicht_erreichbar',
      istFehler: true,
      anlegenMoeglich: true,
    });
    expect(ansicht.anlegenSichtbar).toBe(false);
    expect(ansicht.tafel).toBe('fehler');
  });

  it('sperrt das Anlegen AUCH bei leerem Suchfeld — die Kundenakte blättert ohne Text', () => {
    // `anlegenErlaubt('tippen')` allein gibt hier true zurück, weil bei leerem
    // Feld nichts gefragt wurde. Die Kundenliste fragt aber trotzdem. Genau
    // diese Lücke schliesst der zusätzliche Fehler-Riegel.
    const ansicht = kundenSucherAnsicht({
      zustand: 'tippen',
      istFehler: true,
      anlegenMoeglich: true,
    });
    expect(ansicht.anlegenSichtbar).toBe(false);
    expect(ansicht.tafel).toBe('fehler');
  });

  it('sperrt das Anlegen in JEDEM Zustand, sobald die Suche schweigt', () => {
    for (const zustand of ALLE_ZUSTAENDE) {
      const ansicht = kundenSucherAnsicht({ zustand, istFehler: true, anlegenMoeglich: true });
      expect(
        ansicht.anlegenSichtbar,
        `Zustand ${zustand} liess das Anlegen trotz Serverfehler zu`,
      ).toBe(false);
      expect(ansicht.tafel, `Zustand ${zustand} verbarg den Fehler`).toBe('fehler');
    }
  });

  it('gibt das Anlegen frei, sobald die Suche wirklich geantwortet hat', () => {
    expect(
      kundenSucherAnsicht({ zustand: 'leer', istFehler: false, anlegenMoeglich: true }),
    ).toEqual({ tafel: 'leer', anlegenSichtbar: true });
    expect(
      kundenSucherAnsicht({ zustand: 'treffer', istFehler: false, anlegenMoeglich: true }),
    ).toEqual({ tafel: 'liste', anlegenSichtbar: true });
    expect(
      kundenSucherAnsicht({ zustand: 'tippen', istFehler: false, anlegenMoeglich: true }),
    ).toEqual({ tafel: 'hinweis', anlegenSichtbar: true });
  });

  it('zeigt während der ersten laufenden Suche die Liste, nicht „Kein Treffer"', () => {
    expect(
      kundenSucherAnsicht({ zustand: 'sucht', istFehler: false, anlegenMoeglich: true }).tafel,
    ).toBe('liste');
  });

  it('zeigt nie einen Anlegen-Weg auf einem Bildschirm, der keinen hat', () => {
    for (const zustand of ALLE_ZUSTAENDE) {
      for (const istFehler of [true, false]) {
        expect(
          kundenSucherAnsicht({ zustand, istFehler, anlegenMoeglich: false }).anlegenSichtbar,
        ).toBe(false);
      }
    }
  });
});

describe('die Abfrage an den Server', () => {
  it('fragt ohne Suchtext ohne `q`', () => {
    expect(kundenSuchAbfrage({ limit: 20 }, '')).toEqual({ limit: 20 });
    expect(kundenSuchAbfrage({ limit: 20 }, '   ')).toEqual({ limit: 20 });
  });

  it('beschneidet den Suchtext', () => {
    expect(kundenSuchAbfrage({ limit: 20 }, '  Meier  ').q).toBe('Meier');
  });

  it('setzt `excludeBlocked: false` WIRKLICH — die Flagge, die den Gesperrten zeigt', () => {
    const abfrage = kundenSuchAbfrage({ limit: 20, excludeBlocked: false }, 'Meier');
    expect(Object.hasOwn(abfrage, 'excludeBlocked')).toBe(true);
    expect(abfrage.excludeBlocked).toBe(false);
  });

  it('setzt `excludeBlocked: true`, wo gesperrte Akten gar nicht angeboten werden dürfen', () => {
    expect(kundenSuchAbfrage({ limit: 20, excludeBlocked: true }, 'Meier').excludeBlocked).toBe(
      true,
    );
  });

  it('lässt die Server-Vorgabe stehen, wenn die Maske sich nicht festlegt', () => {
    expect(Object.hasOwn(kundenSuchAbfrage({ limit: 30 }, 'Meier'), 'excludeBlocked')).toBe(false);
  });

  it('reicht Grenze, gelöschte Konten und KYC-Filter durch', () => {
    expect(
      kundenSuchAbfrage({ limit: 30, includeErased: true, kycVerifiedOnly: true }, 'Meier'),
    ).toEqual({ limit: 30, q: 'Meier', includeErased: true, kycVerifiedOnly: true });
    const schlicht = kundenSuchAbfrage({ limit: 30, includeErased: false }, 'Meier');
    expect(Object.hasOwn(schlicht, 'includeErased')).toBe(false);
    expect(Object.hasOwn(schlicht, 'kycVerifiedOnly')).toBe(false);
  });

  it('wartet überall gleich lang', () => {
    expect(KUNDENSUCHE_ENTPRELLUNG_MS).toBe(240);
  });
});

describe('die Anrede je Fläche', () => {
  it('beugt Kunde, Käufer und Verkäufer richtig', () => {
    expect(kundenRolleTexte('Kunde')).toEqual({ dieser: 'dieser Kunde', den: 'den Kunden' });
    expect(kundenRolleTexte('Käufer')).toEqual({ dieser: 'dieser Käufer', den: 'den Käufer' });
    expect(kundenRolleTexte('Verkäufer')).toEqual({
      dieser: 'dieser Verkäufer',
      den: 'den Verkäufer',
    });
  });

  it('bringt keinen Unterstrich in sichtbaren Text', () => {
    const rollen: readonly KundenRolle[] = ['Kunde', 'Käufer', 'Verkäufer'];
    for (const rolle of rollen) {
      const texte = kundenRolleTexte(rolle);
      expect(texte.dieser).not.toMatch(/_/);
      expect(texte.den).not.toMatch(/_/);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Wächter gegen Rückfall
// ────────────────────────────────────────────────────────────────────────

const HIER = dirname(fileURLToPath(import.meta.url));
const SCREENS = join(HIER, '..');

/** Die drei Masken, die vollständig auf dem gemeinsamen Bauteil sitzen. */
const UMGESTELLT: ReadonlyArray<{ name: string; pfad: string }> = [
  { name: 'Verkauf · Käuferpicker', pfad: join(SCREENS, 'verkauf/KaeuferPicker.tsx') },
  { name: 'Bewertung · Verkäuferwahl', pfad: join(SCREENS, 'bewertung/BewertungCustomerStep.tsx') },
  { name: 'Ankauf · Verkäuferspalte', pfad: join(SCREENS, 'ankauf/CustomerPanel.tsx') },
];

describe('keine zweite Kundensuche mehr', () => {
  it('keine der umgestellten Masken fragt selbst nach der Kundenliste', () => {
    for (const maske of UMGESTELLT) {
      const quelle = readFileSync(maske.pfad, 'utf8');
      expect(quelle, `${maske.name} baut wieder eine eigene Suche`).not.toContain(
        'customersApi.list(',
      );
    }
  });

  it('keine der umgestellten Masken bringt eine eigene Entprellung mit', () => {
    for (const maske of UMGESTELLT) {
      const quelle = readFileSync(maske.pfad, 'utf8');
      expect(quelle, `${maske.name} entprellt wieder selbst`).not.toContain('window.setTimeout');
    }
  });

  it('auch die Kundenakte entprellt nicht mehr selbst', () => {
    const quelle = readFileSync(join(HIER, 'CustomerListPanel.tsx'), 'utf8');
    expect(quelle).not.toContain('window.setTimeout');
    expect(quelle).toContain('useEntprelltesSuchfeld');
  });

  it('alle vier Masken beziehen ihre Bausteine aus dem gemeinsamen Bauteil', () => {
    const alle = [...UMGESTELLT, { name: 'Kundenakte', pfad: join(HIER, 'CustomerListPanel.tsx') }];
    for (const maske of alle) {
      const quelle = readFileSync(maske.pfad, 'utf8');
      expect(quelle, `${maske.name} hängt nicht am gemeinsamen Bauteil`).toMatch(
        /KundenSucher\.js/,
      );
    }
  });
});

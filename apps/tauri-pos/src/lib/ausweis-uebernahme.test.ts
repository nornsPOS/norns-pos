/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Was vom Ausweis ins Formular darf
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Befund steht in `ausweis-uebernahme.ts`: der Ausweisleser war gebaut und
 * an keiner Fläche eingebaut. Diese Proben halten die Übersetzung fest — vor
 * allem die zwei Stellen, an denen ein zweistelliges Jahr in die Irre führt.
 */

import { describe, expect, it } from 'vitest';

import {
  ablaufjahrVierstellig,
  geburtsjahrVierstellig,
  uebernimmAusweis,
} from './ausweis-uebernahme.js';
import type { MrzPerson } from './mrz-parse.js';

const HEUTE = new Date('2026-08-20T12:00:00Z');

const ausweis = (teil: Partial<MrzPerson> = {}): MrzPerson => ({
  surname: 'MUSTERMANN',
  givenNames: 'ERIKA',
  nationality: 'D',
  dateOfBirth: '900615',
  documentNumber: 'L01X00T47',
  expiryDate: '310615',
  valid: true,
  beanstandet: [],
  format: 'TD3',
  ...teil,
});

describe('Die Jahrhundertregel', () => {
  it('⛔ ein Geburtsjahr liegt in der VERGANGENHEIT', () => {
    // 90 → 2090 läge in der Zukunft → 1990.
    expect(geburtsjahrVierstellig(90, HEUTE)).toBe(1990);
    expect(geburtsjahrVierstellig(75, HEUTE)).toBe(1975);
    // 26 → 2026 liegt nicht in der Zukunft → ein Säugling, kommt vor.
    expect(geburtsjahrVierstellig(26, HEUTE)).toBe(2026);
    expect(geburtsjahrVierstellig(0, HEUTE)).toBe(2000);
  });

  it('⛔ ein Ablaufjahr liegt meist in der ZUKUNFT — aber nicht mehr als zehn Jahre', () => {
    // Ein Ausweis gilt höchstens zehn Jahre.
    expect(ablaufjahrVierstellig(31, HEUTE)).toBe(2031);
    expect(ablaufjahrVierstellig(36, HEUTE)).toBe(2036);
    // 40 → 2040 wären vierzehn Jahre; das kann kein gültiger Ausweis sein.
    expect(ablaufjahrVierstellig(40, HEUTE)).toBe(1940);
    // Ein abgelaufener Ausweis von 2020 bleibt 2020.
    expect(ablaufjahrVierstellig(20, HEUTE)).toBe(2020);
  });
});

describe('Die Übernahme ins Formular', () => {
  it('dreht den Namen: der Ausweis druckt den Nachnamen zuerst', () => {
    const u = uebernimmAusweis(ausweis(), HEUTE);
    expect(u.fullName).toBe('ERIKA MUSTERMANN');
  });

  it('⛔ macht aus 900615 ein deutsches Datum', () => {
    expect(uebernimmAusweis(ausweis(), HEUTE).geburtsdatum).toBe('15.06.1990');
  });

  it('nimmt Dokumentennummer und Staat mit — § 10 GwG verlangt sie', () => {
    const u = uebernimmAusweis(ausweis(), HEUTE);
    expect(u.dokumentennummer).toBe('L01X00T47');
    expect(u.staat).toBe('D');
  });

  it('⛔ eine Beanstandung wird WEITERGEREICHT, nicht verschluckt', () => {
    // Abgetippt, zerkratzt oder gefälscht — die Kasse entscheidet das nicht,
    // aber sie darf es auch nicht verschweigen.
    expect(uebernimmAusweis(ausweis({ valid: false }), HEUTE).geprueft).toBe(false);
    expect(uebernimmAusweis(ausweis({ valid: true }), HEUTE).geprueft).toBe(true);
  });

  it('⛔ und sie NENNT, was nicht aufging — nicht irgendeine Ursache', () => {
    /*
     * Der Fehler, den das Gegenprüfen gefunden hat: die erste Fassung sagte
     * bei JEDER Beanstandung „Prüfziffern stimmen nicht". Beim Muster
     * stimmten alle vier Prüfziffern; unbekannt war der STAATENCODE („UTO").
     * Bei einer Identifizierung nach § 10 GwG schickt eine falsch benannte
     * Ursache den Händler an die falsche Stelle.
     */
    const u = uebernimmAusweis(
      ausweis({ valid: false, beanstandet: ['issuingState', 'nationality'] }),
      HEUTE,
    );
    expect(u.beanstandet).toEqual(['Ausstellender Staat', 'Staatsangehörigkeit']);

    const p = uebernimmAusweis(
      ausweis({ valid: false, beanstandet: ['documentNumber'] }),
      HEUTE,
    );
    expect(p.beanstandet).toEqual(['Dokumentennummer']);
  });

  it('ein sauberer Ausweis beanstandet nichts', () => {
    expect(uebernimmAusweis(ausweis(), HEUTE).beanstandet).toEqual([]);
  });

  it('⛔ ein ABGELAUFENER Ausweis wird als solcher gemeldet', () => {
    expect(uebernimmAusweis(ausweis({ expiryDate: '200615' }), HEUTE).abgelaufen).toBe(true);
    expect(uebernimmAusweis(ausweis({ expiryDate: '310615' }), HEUTE).abgelaufen).toBe(false);
  });

  it('der Ablauftag selbst gilt noch', () => {
    // Ein Ausweis, der heute abläuft, ist heute noch gültig.
    expect(uebernimmAusweis(ausweis({ expiryDate: '260820' }), HEUTE).abgelaufen).toBe(false);
    expect(uebernimmAusweis(ausweis({ expiryDate: '260819' }), HEUTE).abgelaufen).toBe(true);
  });

  it('ein unlesbares Datum wird NICHT geraten', () => {
    expect(uebernimmAusweis(ausweis({ dateOfBirth: '9006' }), HEUTE).geburtsdatum).toBeNull();
    expect(uebernimmAusweis(ausweis({ dateOfBirth: '901315' }), HEUTE).geburtsdatum).toBeNull();
  });

  it('kommt auch ohne Vornamen zurecht', () => {
    const u = uebernimmAusweis(ausweis({ givenNames: '' }), HEUTE);
    expect(u.fullName).toBe('MUSTERMANN');
  });
});

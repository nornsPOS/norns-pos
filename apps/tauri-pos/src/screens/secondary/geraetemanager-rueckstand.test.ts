/**
 * ════════════════════════════════════════════════════════════════════════
 *  Der TSE-Rückstand im Gerätemanager: zwei Zahlen, zwei Wahrheiten
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DIE ZWEI BEFUNDE VOM 13.08.2026 ─────────────────────────────────────
 *
 * 1. Bei jedem endgültigen Ausfall stand auf der Fläche:
 *
 *        „Einige Signaturen konnten nicht übertragen werden.
 *         Bitte TSE-Verbindung prüfen."
 *
 *    Ohne hinterlegte Kennung sind beide Hälften falsch. Es ist nie eine
 *    Signatur entstanden (`grundOhneSignatur`, `lib/ohne-signatur-hinweis.ts:55`),
 *    und der genannte Knopf ist in genau diesem Zustand ausgegraut:
 *    `disabled={busy || !cfg.tssId || !cfg.credentialsStored}` im
 *    TSE-Abschnitt von `GeraeteManager.tsx`.
 *
 * 2. Das Abzeichen hiess „Ausstehende TSE-Signaturen: N" und zählte die
 *    dauerhaft vermerkten Ausfälle mit. „Ausstehend" verspricht etwas, das
 *    nie mehr kommt: eine `failed_terminal`-Zeile wird vom Nachreicher nie
 *    wieder angefasst (`lib/tse-queue-store.ts`).
 *
 * ── WAS DIESER PRÜFSATZ MISST ───────────────────────────────────────────
 *
 * Nicht den Wortlaut der Fläche, sondern das Verhalten: `tseRueckstand`
 * bekommt die drei gemessenen Zahlen des Korbs und die gemessene Einrichtung
 * dieser Kasse und muss daraus zwei getrennte Zeilen machen, deren Text Wort
 * für Wort aus `lib/fiskalzustand-satz.ts` stammt und die in keinem Zustand
 * auf ein gesperrtes Bedienelement zeigen.
 */

import { describe, expect, it } from 'vitest';

import {
  type Fiskalzustand,
  type KassenEinrichtung,
  einrichtungAusZustand,
  fiskalzustandSatz,
  giltAlsEndgueltig,
  giltAlsWartend,
  knopfVerbindungPruefenBedienbar,
  zustandAusKorbzeile,
} from '../../lib/fiskalzustand-satz.js';
import type { TseQueueStats } from '../../lib/tse-queue-store.js';
import { type TseRueckstandZeile, tseRueckstand } from './GeraeteManager.js';

/** Die vier Einrichtungen, die eine Kasse wirklich haben kann. */
const EINRICHTUNGEN: Array<{ name: string; kasse: KassenEinrichtung }> = [
  { name: 'ohne Kennung, ohne Zugang', kasse: { tssIdHinterlegt: false, zugangHinterlegt: false } },
  { name: 'ohne Kennung, mit Zugang', kasse: { tssIdHinterlegt: false, zugangHinterlegt: true } },
  { name: 'mit Kennung, ohne Zugang', kasse: { tssIdHinterlegt: true, zugangHinterlegt: false } },
  { name: 'mit Kennung, mit Zugang', kasse: { tssIdHinterlegt: true, zugangHinterlegt: true } },
];

const KORB = (
  pending: number,
  inFlight: number,
  failedTerminal: number,
): TseQueueStats => ({ pending, inFlight, failedTerminal });

/** Alles, was ein Mensch aus einer Zeile zu lesen bekommt. */
const gelesen = (zeile: TseRueckstandZeile): string => `${zeile.abzeichen} ${zeile.text}`;

// ════════════════════════════════════════════════════════════════════════
//  ⚠️ BEFUND 2 — WAS NIE MEHR KOMMT, STEHT NICHT AUS
// ════════════════════════════════════════════════════════════════════════

describe('⛔ Wartend und dauerhaft vermerkt werden getrennt gezählt', () => {
  it('drei wartende und fünf endgültige ergeben nie eine Zahl acht', () => {
    const stand = tseRueckstand(KORB(2, 1, 5), EINRICHTUNGEN[3]!.kasse);

    expect(stand.wartend?.anzahl).toBe(3);
    expect(stand.endgueltig?.anzahl).toBe(5);
    // Genau diese Summe stand vorher auf einem einzigen Abzeichen.
    expect(stand.wartend?.abzeichen).toContain('3');
    expect(stand.wartend?.abzeichen).not.toContain('8');
    expect(stand.endgueltig?.abzeichen).toContain('5');
    expect(stand.endgueltig?.abzeichen).not.toContain('8');
  });

  it('kein Abzeichen nennt die endgültigen Ausfälle noch „ausstehend"', () => {
    const stand = tseRueckstand(KORB(1, 0, 1), EINRICHTUNGEN[3]!.kasse);
    for (const zeile of [stand.wartend, stand.endgueltig]) {
      expect(zeile).not.toBeNull();
      expect(gelesen(zeile!)).not.toMatch(/ausstehend/i);
    }
  });

  it('die beiden Abzeichen heissen verschieden — sonst sind es auf dem Schirm zwei gleiche', () => {
    const stand = tseRueckstand(KORB(1, 0, 1), EINRICHTUNGEN[3]!.kasse);
    expect(stand.wartend?.abzeichen).not.toBe(stand.endgueltig?.abzeichen);
  });

  it('eine endgültig gescheiterte Zeile zählt NIE als wartend', () => {
    const stand = tseRueckstand(KORB(0, 0, 4), EINRICHTUNGEN[3]!.kasse);
    expect(stand.wartend).toBeNull();
    expect(stand.endgueltig?.anzahl).toBe(4);
  });

  it('die Einteilung kommt aus der Quelle, nicht aus dieser Fläche', () => {
    // Verschiebt die Quelle einen Status, wandert die Fläche mit.
    expect(giltAlsWartend(zustandAusKorbzeile('pending', false))).toBe(true);
    expect(giltAlsWartend(zustandAusKorbzeile('in_flight', false))).toBe(true);
    expect(giltAlsEndgueltig(zustandAusKorbzeile('failed_terminal', false))).toBe(true);
  });

  it('⚠️ beide Wege einer offenen Zeile warten — sonst zählte die Fläche falsch', () => {
    // Der Korb meldet nur Zahlen je Status, nicht ob eine Zeile schon eine
    // Signatur trägt. Für die Zählweise darf das keinen Unterschied machen.
    expect(giltAlsWartend(zustandAusKorbzeile('pending', true))).toBe(true);
    expect(giltAlsWartend(zustandAusKorbzeile('in_flight', true))).toBe(true);
  });
});

describe('Ohne Rückstand steht keine Zeile da', () => {
  it('ein leerer Korb zeigt nichts', () => {
    const stand = tseRueckstand(KORB(0, 0, 0), EINRICHTUNGEN[0]!.kasse);
    expect(stand.wartend).toBeNull();
    expect(stand.endgueltig).toBeNull();
  });

  it('ohne örtliche Aufzeichnungen wird keine Null erfunden', () => {
    // Ausserhalb der Kasse lehnt `Db.load` ab; der Korb meldet dann `null`.
    const stand = tseRueckstand(null, EINRICHTUNGEN[0]!.kasse);
    expect(stand.wartend).toBeNull();
    expect(stand.endgueltig).toBeNull();
  });

  it('jede Gruppe erscheint nur, wenn sie wirklich Zeilen hat', () => {
    const nurWartend = tseRueckstand(KORB(2, 0, 0), EINRICHTUNGEN[3]!.kasse);
    expect(nurWartend.wartend?.anzahl).toBe(2);
    expect(nurWartend.endgueltig).toBeNull();

    const nurEndgueltig = tseRueckstand(KORB(0, 0, 2), EINRICHTUNGEN[3]!.kasse);
    expect(nurEndgueltig.wartend).toBeNull();
    expect(nurEndgueltig.endgueltig?.anzahl).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  ⚠️ BEFUND 1 — KEIN SATZ ZEIGT AUF EINEN AUSGEGRAUTEN KNOPF
// ════════════════════════════════════════════════════════════════════════

describe('⛔ Kein Text schickt den Kassierer auf den gesperrten Prüfknopf', () => {
  it('bei gesperrtem Knopf nennt keine Zeile das Prüfen der Verbindung', () => {
    let gemessen = 0;
    for (const { name, kasse } of EINRICHTUNGEN) {
      if (knopfVerbindungPruefenBedienbar(kasse)) continue;
      gemessen += 1;
      const stand = tseRueckstand(KORB(2, 1, 3), kasse);
      for (const zeile of [stand.wartend, stand.endgueltig]) {
        expect(zeile, name).not.toBeNull();
        expect(zeile!.ziel, name).not.toBe('verbindungPruefen');
        expect(gelesen(zeile!), name).not.toMatch(/Verbindung[^.]*prüfen/i);
      }
    }
    // Ohne diese Zeile wäre die Schleife leer erfüllbar.
    expect(gemessen).toBe(3);
  });

  it('⛔ ohne hinterlegte Kennung führt der Weg nach Einstellungen, Geräte', () => {
    const stand = tseRueckstand(KORB(0, 0, 2), {
      tssIdHinterlegt: false,
      zugangHinterlegt: false,
    });
    expect(stand.endgueltig?.zustand).toBe<Fiskalzustand>('ohneSicherungseinrichtung');
    expect(stand.endgueltig?.ziel).toBe('geraeteEinrichten');
    expect(stand.endgueltig?.text).toContain('Einstellungen, Geräte');
  });

  it('⛔ und der Text behauptet dort keine Signatur, die es nie gab', () => {
    const stand = tseRueckstand(KORB(0, 0, 2), {
      tssIdHinterlegt: false,
      zugangHinterlegt: false,
    });
    expect(stand.endgueltig?.text).toMatch(/KEINE Signatur/);
    expect(stand.endgueltig?.text).not.toMatch(/übertragen/i);
  });

  it('mit vollständiger Einrichtung geht es um den Beleg und den Inhaber', () => {
    const stand = tseRueckstand(KORB(0, 0, 1), {
      tssIdHinterlegt: true,
      zugangHinterlegt: true,
    });
    expect(stand.endgueltig?.zustand).toBe<Fiskalzustand>('dauerhaftVermerkt');
    expect(stand.endgueltig?.ziel).toBe('inhaberVerstaendigen');
  });

  it('der gewählte Zustand widerspricht der gemessenen Kasse nicht', () => {
    for (const { name, kasse } of EINRICHTUNGEN) {
      const zustand = tseRueckstand(KORB(0, 0, 1), kasse).endgueltig?.zustand ?? null;
      expect(zustand, name).not.toBeNull();
      const aussage = einrichtungAusZustand(zustand!);
      if (aussage === null) continue;
      // Sagt der Zustand etwas über die Einrichtung, muss es zu dem passen,
      // was diese Kasse über ihren Prüfknopf weiss.
      expect(knopfVerbindungPruefenBedienbar(aussage), name).toBe(
        knopfVerbindungPruefenBedienbar(kasse),
      );
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
//  DIE SÄTZE KOMMEN AUS DER EINEN QUELLE
// ════════════════════════════════════════════════════════════════════════

describe('⛔ Jeder Text stammt wortgleich aus fiskalzustand-satz.ts', () => {
  it('die endgültige Zeile ist Satz plus nächster Schritt der Quelle', () => {
    for (const { name, kasse } of EINRICHTUNGEN) {
      const zeile = tseRueckstand(KORB(0, 0, 1), kasse).endgueltig;
      expect(zeile, name).not.toBeNull();
      const quelle = fiskalzustandSatz(zeile!.zustand!);
      expect(zeile!.text, name).toBe(`${quelle.satz} ${quelle.naechsterSchritt.text}`);
      expect(zeile!.ziel, name).toBe(quelle.naechsterSchritt.ziel);
    }
  });

  it('die wartende Zeile ist der nächste Schritt der Quelle', () => {
    const zeile = tseRueckstand(KORB(1, 0, 0), EINRICHTUNGEN[3]!.kasse).wartend;
    expect(zeile?.text).toBe(fiskalzustandSatz('wartetAufAbschluss').naechsterSchritt.text);
  });

  it('⚠️ beide wartenden Zustände enden im selben Schritt — sonst darf EIN Satz nicht für beide stehen', () => {
    // Der Korb kann „wartet auf Abschluss" und „wartet auf Meldung" nicht
    // auseinanderhalten. Sobald die Quelle die beiden Schritte trennt, ist
    // dieser Prüfsatz rot, und die Fläche muss die Zahlen trennen, statt eine
    // Wahrheit über die andere zu legen.
    expect(fiskalzustandSatz('wartetAufAbschluss').naechsterSchritt).toEqual(
      fiskalzustandSatz('wartetAufMeldung').naechsterSchritt,
    );
  });

  it('die wartende Zeile verspricht die Nachreichung, die endgültige nicht', () => {
    const stand = tseRueckstand(KORB(1, 0, 1), EINRICHTUNGEN[3]!.kasse);
    expect(stand.wartend?.text).toMatch(/holt es von allein nach/);
    expect(stand.endgueltig?.text).not.toMatch(/nachreich|nachgereich|nachhol|sobald|später/i);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  TON UND SPRACHE DER ABZEICHEN
// ════════════════════════════════════════════════════════════════════════

describe('Der Ton passt zur Lage, die Sprache ist deutsch', () => {
  it('wartend ist keine Störung, endgültig sehr wohl', () => {
    const stand = tseRueckstand(KORB(1, 0, 1), EINRICHTUNGEN[3]!.kasse);
    expect(stand.wartend?.ton).toBe('pending');
    expect(stand.endgueltig?.ton).toBe('error');
  });

  it('auch ohne Kennung bleibt der endgültige Ton eine Störung', () => {
    const stand = tseRueckstand(KORB(0, 0, 1), EINRICHTUNGEN[0]!.kasse);
    expect(stand.endgueltig?.ton).toBe('error');
  });

  it('kein Unterstrich, kein englisches Wort, keine Ersatzschreibung', () => {
    const stand = tseRueckstand(KORB(1, 1, 1), EINRICHTUNGEN[0]!.kasse);
    for (const zeile of [stand.wartend, stand.endgueltig]) {
      const text = gelesen(zeile!);
      expect(text).not.toContain('_');
      for (const wort of ['pending', 'error', 'failed', 'queue', 'signature', 'terminal']) {
        expect(text.toLowerCase(), wort).not.toMatch(new RegExp(`\\b${wort}\\b`));
      }
      for (const ersatz of ['ausfaelle', 'geraete', 'pruef', 'verstaend']) {
        expect(text.toLowerCase(), ersatz).not.toContain(ersatz);
      }
    }
    // Gegenprobe: die Umlaute stehen wirklich da.
    expect(stand.endgueltig?.abzeichen).toContain('Ausfälle');
  });

  it('jedes Abzeichen nennt seine eigene Zahl', () => {
    const stand = tseRueckstand(KORB(7, 0, 2), EINRICHTUNGEN[3]!.kasse);
    expect(stand.wartend?.abzeichen).toMatch(/\b7\b/);
    expect(stand.endgueltig?.abzeichen).toMatch(/\b2\b/);
  });
});

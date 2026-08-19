/**
 * ════════════════════════════════════════════════════════════════════════
 *  Ein Satz, der fünfmal getippt ist, sind fünf Wahrheiten
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 13.08.2026 ───────────────────────────────────────────
 *
 * „Die Signatur wird nachgereicht" stand unabhängig an fünf Stellen:
 *
 *     screens/secondary/GeraeteManager.tsx:1330   + Abzeichen :1336
 *     screens/verkauf/ReceiptPreview.tsx:452
 *     screens/kasse/TagesabschlussDialog.tsx:264
 *     lib/ohne-signatur-hinweis.ts:90
 *     lib/tse-queue-store.ts:518 und :523
 *
 * Drei Reparaturrunden haben die Lüge jedes Mal nur verschoben.
 *
 * ── DER SCHWERSTE EINZELFUND ────────────────────────────────────────────
 *
 *     GeraeteManager.tsx:1300  disabled={busy || !cfg.tssId || !cfg.credentialsStored}
 *     GeraeteManager.tsx:1330  '… Bitte TSE-Verbindung prüfen.'
 *
 * Ohne hinterlegte Kennung schickte der Schirm den Kassierer auf einen Knopf,
 * den er in genau diesem Zustand nicht drücken kann. Deshalb misst der
 * Prüfsatz „Kein Satz zeigt auf einen ausgegrauten Knopf" weiter unten nicht
 * den Wortlaut, sondern die Sperrbedingung selbst.
 */

import { describe, expect, it } from 'vitest';

import {
  ALLE_FISKALZUSTAENDE,
  type Fiskalzustand,
  TONLAGE_ALS_MELDUNGSTON,
  einrichtungAusZustand,
  fiskalzustandSatz,
  giltAlsEndgueltig,
  giltAlsWartend,
  istInBetriebGenommen,
  knopfVerbindungPruefenBedienbar,
  zustandAusAusfall,
  zustandAusKorbzeile,
} from './fiskalzustand-satz.js';

/** Alles, was ein Mensch von diesem Zustand zu lesen bekommt. */
const sichtbarerText = (zustand: Fiskalzustand): string => {
  const s = fiskalzustandSatz(zustand);
  return `${s.titel} ${s.satz} ${s.naechsterSchritt.text}`;
};

describe('Jeder Zustand trägt einen vollständigen Satz', () => {
  it('Titel, Satz, Tonlage, nächster Schritt und Zählweise sind gesetzt', () => {
    expect(ALLE_FISKALZUSTAENDE.length).toBe(7);
    for (const zustand of ALLE_FISKALZUSTAENDE) {
      const s = fiskalzustandSatz(zustand);
      expect(s.titel.length, zustand).toBeGreaterThan(10);
      expect(s.satz.length, zustand).toBeGreaterThan(30);
      expect(s.naechsterSchritt.text.length, zustand).toBeGreaterThan(15);
      expect(s.satz.trim().endsWith('.'), zustand).toBe(true);
      expect(s.naechsterSchritt.text.trim().endsWith('.'), zustand).toBe(true);
    }
  });

  it('die Überschriften sind alle verschieden', () => {
    // Zwei Zustände mit derselben Überschrift sind auf dem Schirm ein Zustand.
    const titel = ALLE_FISKALZUSTAENDE.map((z) => fiskalzustandSatz(z).titel);
    expect(new Set(titel).size).toBe(titel.length);
  });

  it('jede Tonlage hat einen Ton für die Meldungsleiste', () => {
    for (const zustand of ALLE_FISKALZUSTAENDE) {
      const ton = TONLAGE_ALS_MELDUNGSTON[fiskalzustandSatz(zustand).tonlage];
      expect(['info', 'success', 'warn', 'alert'], zustand).toContain(ton);
    }
  });

  it('nur der Fall echten Verlusts bleibt stehen, bis jemand ihn wegtippt', () => {
    // `alert` ist der einzige Ton ohne Selbstabbau (toast-store.ts:108).
    expect(TONLAGE_ALS_MELDUNGSTON[fiskalzustandSatz('nichtGesichert').tonlage]).toBe('alert');
    expect(TONLAGE_ALS_MELDUNGSTON[fiskalzustandSatz('signiert').tonlage]).toBe('success');
  });
});

// ════════════════════════════════════════════════════════════════════════
//  ⚠️ DER SCHWERSTE MANGEL: EIN SATZ ZEIGT AUF EINEN AUSGEGRAUTEN KNOPF
// ════════════════════════════════════════════════════════════════════════

describe('⛔ Kein Satz zeigt auf einen Knopf, der im selben Zustand gesperrt ist', () => {
  it('die gemessene Sperre: ohne Kennung ODER ohne Zugang ist der Prüfknopf tot', () => {
    // Wortgleich zu GeraeteManager.tsx:1300.
    expect(
      knopfVerbindungPruefenBedienbar({
        tssIdHinterlegt: false,
        zugangHinterlegt: false,
      }),
    ).toBe(false);
    expect(
      knopfVerbindungPruefenBedienbar({
        tssIdHinterlegt: false,
        zugangHinterlegt: true,
      }),
    ).toBe(false);
    expect(
      knopfVerbindungPruefenBedienbar({
        tssIdHinterlegt: true,
        zugangHinterlegt: false,
      }),
    ).toBe(false);
    expect(
      knopfVerbindungPruefenBedienbar({
        tssIdHinterlegt: true,
        zugangHinterlegt: true,
      }),
    ).toBe(true);
  });

  it('⛔ kein Zustand mit gesperrtem Knopf schickt den Kassierer dorthin', () => {
    let gemessen = 0;
    for (const zustand of ALLE_FISKALZUSTAENDE) {
      const einrichtung = einrichtungAusZustand(zustand);
      if (einrichtung === null) continue;
      if (knopfVerbindungPruefenBedienbar(einrichtung)) continue;
      gemessen += 1;
      expect(fiskalzustandSatz(zustand).naechsterSchritt.ziel, zustand).not.toBe(
        'verbindungPruefen',
      );
    }
    // Ohne diese Zeile wäre die Schleife leer erfüllbar: verschwände der
    // gefährliche Zustand aus der Liste, bliebe der Prüfsatz grün und hätte
    // nichts mehr gemessen.
    expect(gemessen).toBeGreaterThanOrEqual(1);
  });

  it('⛔ „keine Sicherungseinrichtung hinterlegt" führt zu Einstellungen, Geräte', () => {
    const s = fiskalzustandSatz('ohneSicherungseinrichtung');
    expect(s.naechsterSchritt.ziel).toBe('geraeteEinrichten');
    expect(s.naechsterSchritt.text).toContain('Einstellungen, Geräte');
  });

  it('⛔ und der Satz fordert in diesem Zustand kein Prüfen der Verbindung', () => {
    // Genau dieser Wortlaut stand im Gerätemanager und zeigte ins Leere.
    expect(sichtbarerText('ohneSicherungseinrichtung')).not.toMatch(/Verbindung[^.]*prüfen/i);
  });

  it('bei nicht in Betrieb genommener Einrichtung ist der Knopf zwar drückbar, hilft aber nicht', () => {
    const einrichtung = einrichtungAusZustand('nichtInBetrieb');
    expect(einrichtung).not.toBeNull();
    expect(einrichtung !== null && knopfVerbindungPruefenBedienbar(einrichtung)).toBe(true);
    const s = fiskalzustandSatz('nichtInBetrieb');
    // Der Handgriff ist die Inbetriebnahme, nicht das erneute Prüfen — und der
    // Satz sagt das ausdrücklich, sonst drückt der Kassierer ewig weiter.
    expect(s.naechsterSchritt.ziel).toBe('geraeteEinrichten');
    expect(s.naechsterSchritt.text).toContain('in Betrieb nehmen');
    expect(s.naechsterSchritt.text).toMatch(/ändert daran nichts/);
  });

  it('kein Zustand behauptet eine Einrichtung, über die er nichts weiss', () => {
    // Nur die beiden gemessenen Fälle sagen etwas über die Kasse aus.
    expect(einrichtungAusZustand('signiert')).toBeNull();
    expect(einrichtungAusZustand('wartetAufAbschluss')).toBeNull();
    expect(einrichtungAusZustand('wartetAufMeldung')).toBeNull();
    expect(einrichtungAusZustand('dauerhaftVermerkt')).toBeNull();
    expect(einrichtungAusZustand('nichtGesichert')).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════
//  ⚠️ KEIN VERSPRECHEN AUF EINE NACHREICHUNG, DIE NIE KOMMT
// ════════════════════════════════════════════════════════════════════════

/** Jede Form, in der ein Satz eine spätere Signatur in Aussicht stellt. */
const VERSPRICHT_NACHREICHUNG =
  /nachreich|nachgereich|nachhol|nachgehol|nachmeld|nachgemeld|(holt|meldet)[^.]*nach\b|sobald|später/i;

describe('⛔ Ein endgültiger Zustand verspricht keine Nachreichung', () => {
  it('kein einziger endgültiger Zustand stellt eine spätere Signatur in Aussicht', () => {
    let gemessen = 0;
    for (const zustand of ALLE_FISKALZUSTAENDE) {
      if (!giltAlsEndgueltig(zustand)) continue;
      gemessen += 1;
      expect(sichtbarerText(zustand), zustand).not.toMatch(VERSPRICHT_NACHREICHUNG);
    }
    expect(gemessen).toBe(4);
  });

  it('die endgültigen Zustände sagen ausdrücklich, dass die Signatur FEHLT', () => {
    for (const zustand of ALLE_FISKALZUSTAENDE) {
      if (!giltAlsEndgueltig(zustand)) continue;
      expect(sichtbarerText(zustand), zustand).toMatch(/KEINE Signatur|keine mehr/);
    }
  });

  it('⚠️ die wartenden Zustände versprechen sie sehr wohl, sonst misst der Prüfsatz oben nichts', () => {
    let gemessen = 0;
    for (const zustand of ALLE_FISKALZUSTAENDE) {
      if (!giltAlsWartend(zustand)) continue;
      gemessen += 1;
      expect(sichtbarerText(zustand), zustand).toMatch(VERSPRICHT_NACHREICHUNG);
      // Und sie verlangen vom Kassierer nichts, weil die Kasse es selbst tut.
      expect(fiskalzustandSatz(zustand).naechsterSchritt.ziel, zustand).toBe('keiner');
    }
    expect(gemessen).toBe(2);
  });

  it('die Zählweise trennt wartend von endgültig', () => {
    expect(fiskalzustandSatz('signiert').zaehlung).toBe('erledigt');
    expect(fiskalzustandSatz('wartetAufAbschluss').zaehlung).toBe('wartend');
    expect(fiskalzustandSatz('wartetAufMeldung').zaehlung).toBe('wartend');
    expect(fiskalzustandSatz('dauerhaftVermerkt').zaehlung).toBe('endgueltig');
    expect(fiskalzustandSatz('ohneSicherungseinrichtung').zaehlung).toBe('endgueltig');
    expect(fiskalzustandSatz('nichtInBetrieb').zaehlung).toBe('endgueltig');
    expect(fiskalzustandSatz('nichtGesichert').zaehlung).toBe('endgueltig');
    // Kein Zustand ist beides.
    for (const zustand of ALLE_FISKALZUSTAENDE) {
      expect(giltAlsWartend(zustand) && giltAlsEndgueltig(zustand), zustand).toBe(false);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
//  DIE SPRACHE
// ════════════════════════════════════════════════════════════════════════

describe('⛔ Deutsche Sätze, keine Fehlercodes, keine Fremdwörter', () => {
  it('kein Unterstrich, nirgends', () => {
    for (const zustand of ALLE_FISKALZUSTAENDE) {
      expect(sichtbarerText(zustand), zustand).not.toContain('_');
    }
  });

  it('keine Ziffer — eine Ziffer im Satz ist der Anfang eines Fehlercodes', () => {
    for (const zustand of ALLE_FISKALZUSTAENDE) {
      expect(sichtbarerText(zustand), zustand).not.toMatch(/\d/);
    }
  });

  it('kein englisches Wort', () => {
    const FREMD = [
      'error',
      'failed',
      'pending',
      'queue',
      'offline',
      'online',
      'timeout',
      'retry',
      'status',
      'check',
      'device',
      'settings',
      'server',
      'signature',
      'receipt',
      'transaction',
      'terminal',
      'connection',
      'unavailable',
      'please',
      'warning',
      'success',
      'alert',
    ];
    for (const zustand of ALLE_FISKALZUSTAENDE) {
      const text = sichtbarerText(zustand).toLowerCase();
      for (const wort of FREMD) {
        expect(text, `${zustand}/${wort}`).not.toMatch(new RegExp(`\\b${wort}\\b`));
      }
    }
  });

  it('Umlaute stehen, wo sie hingehören — keine Ersatzschreibung', () => {
    const ERSATZ = [
      'fuer',
      'ueber',
      'koenn',
      'muess',
      'naechst',
      'pruef',
      'verstaend',
      'zurueck',
      'spaeter',
      'moegl',
      'geraet',
      'stoer',
      'gueltig',
      'waehr',
      'aendert',
      'oertlich',
    ];
    for (const zustand of ALLE_FISKALZUSTAENDE) {
      const text = sichtbarerText(zustand).toLowerCase();
      for (const ersatz of ERSATZ) {
        expect(text, `${zustand}/${ersatz}`).not.toContain(ersatz);
      }
    }
    // Und die Gegenprobe: die Wörter stehen wirklich da, mit Umlaut.
    expect(fiskalzustandSatz('ohneSicherungseinrichtung').naechsterSchritt.text).toContain(
      'Geräte',
    );
    expect(fiskalzustandSatz('dauerhaftVermerkt').naechsterSchritt.text).toContain('verständigen');
    expect(fiskalzustandSatz('nichtInBetrieb').naechsterSchritt.text).toContain('prüfen');
    expect(fiskalzustandSatz('nichtGesichert').satz).toContain('örtlich');
  });

  it('jeder Satz beginnt gross und nennt den Beleg oder die Kasse beim Namen', () => {
    for (const zustand of ALLE_FISKALZUSTAENDE) {
      const satz = fiskalzustandSatz(zustand).satz;
      expect(satz[0], zustand).toBe(satz[0]?.toUpperCase());
      expect(satz, zustand).toMatch(/Beleg|Kasse|Sicherungseinrichtung/);
    }
  });
});

describe('Der Vorgang steht vorn, wenn er bekannt ist', () => {
  it('mit Vorgang beginnt der Satz mit dem Vorgang', () => {
    for (const vorgang of ['Verkauf', 'Ankauf', 'Storno'] as const) {
      for (const zustand of ALLE_FISKALZUSTAENDE) {
        const satz = fiskalzustandSatz(zustand, vorgang).satz;
        expect(satz.startsWith(`${vorgang} gebucht. `), `${zustand}/${vorgang}`).toBe(true);
      }
    }
  });

  it('ohne Vorgang bleibt der Satz allgemein und nennt keinen', () => {
    for (const zustand of ALLE_FISKALZUSTAENDE) {
      expect(fiskalzustandSatz(zustand).satz, zustand).not.toMatch(/Verkauf|Ankauf|Storno/);
    }
  });

  it('der Vorspann ändert nur den Satz, nicht die Beurteilung', () => {
    for (const zustand of ALLE_FISKALZUSTAENDE) {
      const ohne = fiskalzustandSatz(zustand);
      const mit = fiskalzustandSatz(zustand, 'Ankauf');
      expect(mit.titel).toBe(ohne.titel);
      expect(mit.tonlage).toBe(ohne.tonlage);
      expect(mit.zaehlung).toBe(ohne.zaehlung);
      expect(mit.naechsterSchritt).toEqual(ohne.naechsterSchritt);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
//  DIE BRÜCKEN AUS DEM BESTEHENDEN VOKABULAR
// ════════════════════════════════════════════════════════════════════════

describe('Aus einem gescheiterten Schritt wird der richtige Zustand', () => {
  it('⛔ ging nicht einmal das örtliche Vermerken, schlägt das jede andere Aussage', () => {
    // `ausfallSichern` gab `false` zurück: es gibt ausser dem Papier nichts.
    for (const schritt of ['keine_tse', 'eroeffnung', 'abschluss', 'melden'] as const) {
      expect(zustandAusAusfall(schritt, false), schritt).toBe('nichtGesichert');
    }
  });

  it('nur Abschluss und Melden sind nachreichbar', () => {
    // Dieselbe Trennlinie wie `istNachreichbar` (tse-queue-store.ts:466).
    expect(giltAlsWartend(zustandAusAusfall('abschluss', true))).toBe(true);
    expect(giltAlsWartend(zustandAusAusfall('melden', true))).toBe(true);
    expect(giltAlsEndgueltig(zustandAusAusfall('keine_tse', true))).toBe(true);
    expect(giltAlsEndgueltig(zustandAusAusfall('eroeffnung', true))).toBe(true);
  });

  it('die fehlende Einrichtung und der gescheiterte Beginn sind zwei Sätze, nicht einer', () => {
    // Beide sind endgültig, verlangen aber verschiedene Handgriffe.
    const ohne = fiskalzustandSatz(zustandAusAusfall('keine_tse', true));
    const beginn = fiskalzustandSatz(zustandAusAusfall('eroeffnung', true));
    expect(ohne.titel).not.toBe(beginn.titel);
    expect(ohne.naechsterSchritt.ziel).toBe('geraeteEinrichten');
    expect(beginn.naechsterSchritt.ziel).toBe('inhaberVerstaendigen');
  });
});

describe('Aus einer Korbzeile wird der richtige Zustand', () => {
  it('eine wartende Zeile ohne Signatur wartet auf den Abschluss', () => {
    expect(zustandAusKorbzeile('pending', false)).toBe('wartetAufAbschluss');
    expect(zustandAusKorbzeile('in_flight', false)).toBe('wartetAufAbschluss');
  });

  it('⚠️ eine wartende Zeile MIT Signatur wartet nur noch auf die Meldung', () => {
    // Diese Zeile darf nie neu abgeschlossen werden (tse-queue-store.ts:24).
    expect(zustandAusKorbzeile('pending', true)).toBe('wartetAufMeldung');
    expect(zustandAusKorbzeile('in_flight', true)).toBe('wartetAufMeldung');
  });

  it('⛔ eine endgültig gescheiterte Zeile verspricht nichts mehr', () => {
    const zustand = zustandAusKorbzeile('failed_terminal', false);
    expect(zustand).toBe('dauerhaftVermerkt');
    expect(sichtbarerText(zustand)).not.toMatch(VERSPRICHT_NACHREICHUNG);
    // Auch eine Zeile, die schon eine Signatur trägt, wird davon nicht wartend.
    expect(zustandAusKorbzeile('failed_terminal', true)).toBe('dauerhaftVermerkt');
  });

  it('eine erledigte Zeile ist signiert', () => {
    expect(zustandAusKorbzeile('succeeded', true)).toBe('signiert');
  });
});

describe('In Betrieb genommen heisst genau ein Zustand', () => {
  it('nur die in Betrieb genommene Einrichtung signiert', () => {
    // Gemessen an `tse_status` (src-tauri/src/commands/tse.rs:451).
    expect(istInBetriebGenommen('INITIALIZED')).toBe(true);
    expect(istInBetriebGenommen('initialized')).toBe(true);
    expect(istInBetriebGenommen(' INITIALIZED ')).toBe(true);
  });

  it('angelegt, noch nicht eingerichtet oder wieder abgeschaltet: keine Signatur', () => {
    expect(istInBetriebGenommen('CREATED')).toBe(false);
    expect(istInBetriebGenommen('UNINITIALIZED')).toBe(false);
    expect(istInBetriebGenommen('DISABLED')).toBe(false);
    expect(istInBetriebGenommen(null)).toBe(false);
    expect(istInBetriebGenommen(undefined)).toBe(false);
    expect(istInBetriebGenommen('')).toBe(false);
  });
});

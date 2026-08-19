/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EINE QUELLE FÜR DEN FISKALISCHEN SATZ EINES BELEGS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 13.08.2026 ──────────────────────────────────────────────
 *
 * Der Satz „die Signatur wird nachgereicht" stand an FÜNF Stellen unabhängig
 * voneinander, und keine wusste von den anderen:
 *
 *     screens/secondary/GeraeteManager.tsx:1330   + Abzeichen :1336
 *     screens/verkauf/ReceiptPreview.tsx:452
 *     screens/kasse/TagesabschlussDialog.tsx:264
 *     lib/ohne-signatur-hinweis.ts:90             (Ankaufweg)
 *     lib/tse-queue-store.ts:518 und :523
 *
 * Drei Reparaturrunden haben die Lüge jedes Mal nur VERSCHOBEN. Ein Satz, der
 * fünfmal getippt ist, sind fünf Wahrheiten, die auseinanderlaufen: die eine
 * Fläche wurde richtiggestellt, die vier anderen versprachen weiter eine
 * Nachreichung, die es für diesen Beleg nie geben wird.
 *
 * ── DER SCHWERSTE EINZELFUND, DEN DIESE DATEI MITLÖST ─────────────────────
 *
 * Gemessen im Gerätemanager:
 *
 *     :1300   disabled={busy || !cfg.tssId || !cfg.credentialsStored}
 *     :1302   {busy ? 'Prüft…' : 'TSE-Verbindung prüfen'}
 *     :1330   'Einige Signaturen konnten nicht übertragen werden.
 *              Bitte TSE-Verbindung prüfen.'
 *
 * Bei einer Kasse OHNE hinterlegte Sicherungseinrichtung zeigt der Satz auf
 * genau den Knopf, der in diesem Zustand ausgegraut ist — denn die fehlende
 * Kennung ist die Bedingung, die die Meldung ausgelöst hat. Der Schirm
 * schickte den Kassierer auf einen Knopf, den er nicht drücken kann.
 *
 * Deshalb trägt hier JEDER Zustand nicht nur einen Satz, sondern einen
 * NÄCHSTEN SCHRITT, der in genau diesem Zustand wirklich begehbar ist. Ob er
 * das ist, wird nicht behauptet, sondern an der gemessenen Sperrbedingung des
 * Knopfes geprüft (`knopfVerbindungPruefenBedienbar`, Prüfsatz dazu in
 * `fiskalzustand-satz.test.ts`).
 *
 * ── WAS DIESE DATEI IST UND WAS NICHT ─────────────────────────────────────
 *
 * Rein: kein React, kein Tauri, kein Netz, keine Uhr. Nur die Abbildung
 * „fiskalischer Zustand eines Belegs → deutscher Satz, Tonlage, nächster
 * Schritt, Zählweise". Die Flächen bringen den Zustand mit, die Sätze kommen
 * von hier.
 *
 * Die beiden Brücken (`zustandAusAusfall`, `zustandAusKorbzeile`) nehmen das
 * BESTEHENDE Vokabular des Korbs entgegen. Sie sind absichtlich als
 * Typ-Einfuhr an `tse-queue-store.ts` gebunden: wächst dort eine Möglichkeit
 * nach, wird die Vollständigkeitsprüfung der Verzweigung hier rot, statt dass
 * eine sechste Wahrheit entsteht.
 */

import type { TseAusfallSchritt, TseQueueStatus } from './tse-queue-store.js';

// ═══════════════════════════════════════════════════════════════════════════
//  DIE ZUSTÄNDE — GEMESSEN, NICHT AUSGEDACHT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Der fiskalische Zustand EINES Belegs.
 *
 * Woher jeder Zustand stammt:
 *
 *   signiert                  Der Abschluss kam durch und die Signatur wurde
 *                             gemeldet (`BezahlenDialog.tsx:990` folgende).
 *   wartetAufAbschluss        Eröffnung gelang, Abschluss nicht. Zeile mit
 *                             Signatur NULL, Weg a des Nachreichers
 *                             (`tse-queue-store.ts:74`). Nachreichbar.
 *   wartetAufMeldung          Signatur liegt vor, das Melden scheiterte.
 *                             Zeile MIT Signatur, Weg b, nie neu abschliessen
 *                             (`tse-queue-store.ts:24` folgende). Nachreichbar.
 *   dauerhaftVermerkt         `failed_terminal`: der Ausfall ist festgehalten,
 *                             eine Signatur kommt NIE mehr
 *                             (`vermerkeDauerhaftenAusfall`, dort begründet).
 *   ohneSicherungseinrichtung Diese Kasse hat gar keine Kennung hinterlegt, es
 *                             ist nie eine Signatur entstanden
 *                             (`grundOhneSignatur` in `ohne-signatur-hinweis.ts`).
 *   nichtInBetrieb            Kennung und Zugang stehen, die Sicherungs-
 *                             einrichtung ist aber nicht in Betrieb genommen
 *                             (`tse_status` liest `state`, `commands/tse.rs:451`).
 *   nichtGesichert            Nicht einmal das örtliche Vermerken gelang
 *                             (`ausfallSichern` gab `false` zurück). Der einzige
 *                             Fall echten Verlusts.
 */
export type Fiskalzustand =
  | 'signiert'
  | 'wartetAufAbschluss'
  | 'wartetAufMeldung'
  | 'dauerhaftVermerkt'
  | 'ohneSicherungseinrichtung'
  | 'nichtInBetrieb'
  | 'nichtGesichert';

/** Alle Zustände, für die Prüfsätze über den ganzen Bereich. */
export const ALLE_FISKALZUSTAENDE: readonly Fiskalzustand[] = [
  'signiert',
  'wartetAufAbschluss',
  'wartetAufMeldung',
  'dauerhaftVermerkt',
  'ohneSicherungseinrichtung',
  'nichtInBetrieb',
  'nichtGesichert',
];

/** Wie laut die Fläche werden darf. */
export type Tonlage = 'gut' | 'wartend' | 'warnend' | 'ernst';

/**
 * Zählt dieser Beleg für eine Zählung als wartend oder als endgültig?
 *
 * ⚠️ Das Abzeichen im Gerätemanager warf beides zusammen und nannte alles
 * „Ausstehende TSE-Signaturen" (`GeraeteManager.tsx:1335`). Was nie mehr
 * kommt, steht dort aber nicht aus, es fehlt endgültig.
 */
export type Zaehlweise = 'erledigt' | 'wartend' | 'endgueltig';

/**
 * Wohin der nächste Schritt führt. Jedes Ziel ist eine Fläche, die es wirklich
 * gibt, und die im jeweiligen Zustand auch bedienbar ist.
 */
export type Schrittziel =
  /** Nichts zu tun, die Kasse erledigt es selbst. */
  | 'keiner'
  /** Einstellungen, Geräte — Kennung, Zugang, Inbetriebnahme. */
  | 'geraeteEinrichten'
  /** Der Knopf „TSE-Verbindung prüfen". NUR bei hinterlegter Kennung UND Zugang. */
  | 'verbindungPruefen'
  /** Beleg aufbewahren und den Inhaber verständigen. */
  | 'inhaberVerstaendigen';

export interface NaechsterSchritt {
  /** Der Satz, der den Handgriff nennt. */
  text: string;
  ziel: Schrittziel;
}

export interface FiskalzustandSatz {
  /** Kurze Überschrift, für Meldung und Abzeichen. */
  titel: string;
  /** Der ehrliche Satz für den Kassierer. */
  satz: string;
  tonlage: Tonlage;
  naechsterSchritt: NaechsterSchritt;
  zaehlung: Zaehlweise;
}

/** Welcher Vorgang den Beleg erzeugt hat. Ohne Angabe bleibt der Satz allgemein. */
export type Vorgang = 'Verkauf' | 'Ankauf' | 'Storno';

// ═══════════════════════════════════════════════════════════════════════════
//  DER KNOPF, AUF DEN EIN SATZ NICHT ZEIGEN DARF
// ═══════════════════════════════════════════════════════════════════════════

/** Was auf dieser Kasse hinterlegt ist. Nur das entscheidet über den Knopf. */
export interface KassenEinrichtung {
  tssIdHinterlegt: boolean;
  zugangHinterlegt: boolean;
}

/**
 * Ist der Knopf „TSE-Verbindung prüfen" überhaupt drückbar?
 *
 * ⚠️ Wortgleich zur gemessenen Sperre in `GeraeteManager.tsx:1300`:
 * `disabled={busy || !cfg.tssId || !cfg.credentialsStored}`. Das `busy` fehlt
 * hier bewusst — es ist ein flüchtiger Augenblick während der Prüfung, kein
 * Zustand eines Belegs.
 */
export function knopfVerbindungPruefenBedienbar(kasse: KassenEinrichtung): boolean {
  return kasse.tssIdHinterlegt && kasse.zugangHinterlegt;
}

/**
 * Was ein Zustand über die Einrichtung dieser Kasse mit SICHERHEIT aussagt.
 * `null` heisst ehrlich: dieser Zustand sagt darüber nichts.
 *
 * Nur zwei Zustände sagen etwas:
 *   · `ohneSicherungseinrichtung` entsteht ausschliesslich bei leerer Kennung
 *     (`grundOhneSignatur`, `ohne-signatur-hinweis.ts:55`) — der Knopf ist
 *     also ausgegraut, und kein Satz darf auf ihn zeigen.
 *   · `nichtInBetrieb` kann nur entstehen, wenn Kennung und Zugang stehen,
 *     denn ohne beides kommt gar keine Auskunft über den Zustand zurück
 *     (`commands/tse.rs:418` bricht ohne Kennung vorher ab, `:436` ohne
 *     gültige Anmeldung).
 */
export function einrichtungAusZustand(zustand: Fiskalzustand): KassenEinrichtung | null {
  if (zustand === 'ohneSicherungseinrichtung') {
    return { tssIdHinterlegt: false, zugangHinterlegt: false };
  }
  if (zustand === 'nichtInBetrieb') {
    return { tssIdHinterlegt: true, zugangHinterlegt: true };
  }
  return null;
}

/**
 * Ist die Sicherungseinrichtung in Betrieb genommen?
 *
 * Gemessen: `tse_status` gibt den rohen Zustand der Sicherungseinrichtung
 * zurück (`src-tauri/src/commands/tse.rs:451`), und nur `INITIALIZED` heisst
 * „in Betrieb genommen und signierfähig". Eine erst angelegte oder wieder
 * ausser Betrieb genommene Einrichtung antwortet zwar, signiert aber nicht.
 */
export function istInBetriebGenommen(tssZustand: string | null | undefined): boolean {
  return (tssZustand ?? '').trim().toUpperCase() === 'INITIALIZED';
}

// ═══════════════════════════════════════════════════════════════════════════
//  DIE EINE ABBILDUNG
// ═══════════════════════════════════════════════════════════════════════════

interface Bausatz {
  titel: string;
  /** Der Kern des Satzes, ohne den Vorgangs-Vorspann. */
  kern: string;
  tonlage: Tonlage;
  naechsterSchritt: NaechsterSchritt;
  zaehlung: Zaehlweise;
}

const NICHTS_ZU_TUN_SELBST: NaechsterSchritt = {
  text: 'Nichts zu tun. Die Kasse holt es von allein nach, auch nach einem Neustart.',
  ziel: 'keiner',
};

const GERAETE_EINRICHTEN: NaechsterSchritt = {
  text: 'Die Sicherungseinrichtung unter Einstellungen, Geräte hinterlegen und den Inhaber verständigen.',
  ziel: 'geraeteEinrichten',
};

const GERAETE_IN_BETRIEB_NEHMEN: NaechsterSchritt = {
  // ⚠️ Der zweite Satz ist der wichtige: hier IST der Prüfknopf drückbar, er
  // hilft aber nicht. Ohne diesen Hinweis drückt der Kassierer ihn immer
  // wieder und hält die Kasse für gestört statt für unfertig.
  text: 'Die Sicherungseinrichtung unter Einstellungen, Geräte in Betrieb nehmen. Die Verbindung erneut zu prüfen ändert daran nichts.',
  ziel: 'geraeteEinrichten',
};

const BELEG_UND_INHABER: NaechsterSchritt = {
  text: 'Den gedruckten Beleg aufbewahren und den Inhaber verständigen.',
  ziel: 'inhaberVerstaendigen',
};

const BELEG_UND_INHABER_SOFORT: NaechsterSchritt = {
  text: 'Den gedruckten Beleg aufbewahren und den Inhaber sofort verständigen.',
  ziel: 'inhaberVerstaendigen',
};

function bausatz(zustand: Fiskalzustand): Bausatz {
  switch (zustand) {
    case 'signiert':
      return {
        titel: 'Beleg ist signiert',
        kern: 'Der Beleg trägt die Signatur der Sicherungseinrichtung.',
        tonlage: 'gut',
        naechsterSchritt: {
          text: 'Nichts zu tun. Der Beleg ist vollständig.',
          ziel: 'keiner',
        },
        zaehlung: 'erledigt',
      };

    case 'wartetAufAbschluss':
      return {
        titel: 'Signatur wird nachgereicht',
        kern:
          'Die Sicherungseinrichtung hat den Vorgang angenommen, ihn aber nicht abgeschlossen. ' +
          'Die Kasse holt die Signatur selbst nach, sobald die Sicherungseinrichtung wieder antwortet.',
        tonlage: 'wartend',
        naechsterSchritt: NICHTS_ZU_TUN_SELBST,
        zaehlung: 'wartend',
      };

    case 'wartetAufMeldung':
      return {
        titel: 'Signatur wird nachgemeldet',
        kern:
          'Der Beleg ist signiert. Die Signatur ist aber noch nicht in der zentralen Aufzeichnung ' +
          'angekommen; die Kasse meldet sie selbst nach.',
        tonlage: 'wartend',
        naechsterSchritt: NICHTS_ZU_TUN_SELBST,
        zaehlung: 'wartend',
      };

    case 'dauerhaftVermerkt':
      return {
        titel: 'Beleg bleibt ohne Signatur',
        // ⚠️ „und er bekommt auch keine mehr" ist der ganze Zweck dieses
        // Zustands. Genau hier stand vorher „wird automatisch nachgereicht".
        kern:
          'Der Beleg trägt KEINE Signatur, und er bekommt auch keine mehr. ' +
          'Der Ausfall ist dauerhaft vermerkt und bleibt zehn Jahre erhalten.',
        tonlage: 'warnend',
        naechsterSchritt: BELEG_UND_INHABER,
        zaehlung: 'endgueltig',
      };

    case 'ohneSicherungseinrichtung':
      return {
        titel: 'Keine Sicherungseinrichtung hinterlegt',
        kern:
          'Diese Kasse hat keine Sicherungseinrichtung hinterlegt. Der Beleg trägt KEINE Signatur, ' +
          'und es ist auch nie eine entstanden. Der Ausfall ist dauerhaft vermerkt.',
        tonlage: 'warnend',
        // ⚠️ NICHT der Prüfknopf: er ist in genau diesem Zustand ausgegraut.
        naechsterSchritt: GERAETE_EINRICHTEN,
        zaehlung: 'endgueltig',
      };

    case 'nichtInBetrieb':
      return {
        titel: 'Sicherungseinrichtung nicht in Betrieb genommen',
        kern:
          'Kennung und Zugang sind hinterlegt, die Sicherungseinrichtung wurde aber nie in Betrieb genommen. ' +
          'In diesem Zustand signiert sie nicht, der Beleg trägt KEINE Signatur.',
        tonlage: 'warnend',
        naechsterSchritt: GERAETE_IN_BETRIEB_NEHMEN,
        zaehlung: 'endgueltig',
      };

    case 'nichtGesichert':
      return {
        titel: 'Ausfall NICHT vermerkt',
        kern:
          'Der Beleg trägt KEINE Signatur, und die Kasse konnte den Ausfall nicht einmal örtlich vermerken. ' +
          'Ausser dem gedruckten Beleg gibt es dafür keinen Nachweis.',
        tonlage: 'ernst',
        naechsterSchritt: BELEG_UND_INHABER_SOFORT,
        zaehlung: 'endgueltig',
      };

    default: {
      // Vollständigkeit: ein neuer Zustand macht die Übersetzung rot, statt
      // still einen leeren Satz auszugeben.
      const nie: never = zustand;
      throw new Error(`Unbekannter Zustand: ${String(nie)}`);
    }
  }
}

/**
 * Der eine Satz für einen fiskalischen Zustand.
 *
 * Mit `vorgang` bekommt der Satz den Vorspann „Verkauf gebucht." und passt so
 * in die Meldung direkt nach dem Buchen; ohne ihn bleibt er allgemein und
 * passt auf Belegvorschau, Abschluss und Gerätemanager.
 */
export function fiskalzustandSatz(zustand: Fiskalzustand, vorgang?: Vorgang): FiskalzustandSatz {
  const b = bausatz(zustand);
  return {
    titel: b.titel,
    satz: vorgang ? `${vorgang} gebucht. ${b.kern}` : b.kern,
    tonlage: b.tonlage,
    naechsterSchritt: b.naechsterSchritt,
    zaehlung: b.zaehlung,
  };
}

/** Wartet dieser Beleg wirklich noch auf etwas? */
export function giltAlsWartend(zustand: Fiskalzustand): boolean {
  return bausatz(zustand).zaehlung === 'wartend';
}

/** Ist für diesen Beleg endgültig entschieden, dass keine Signatur mehr kommt? */
export function giltAlsEndgueltig(zustand: Fiskalzustand): boolean {
  return bausatz(zustand).zaehlung === 'endgueltig';
}

/**
 * Die Tonlage als Ton der Meldungsleiste.
 *
 * Gemessen an `state/toast-store.ts:47` und `packages/ui-kit` Toast: die
 * Leiste kennt `info`, `success`, `warn`, `alert`, und `alert` bleibt stehen,
 * bis der Kassierer sie wegtippt (`toast-store.ts:108`). Deshalb bekommt der
 * einzige Fall echten Verlusts genau diesen Ton.
 */
export const TONLAGE_ALS_MELDUNGSTON: Record<Tonlage, 'info' | 'success' | 'warn' | 'alert'> = {
  gut: 'success',
  wartend: 'info',
  warnend: 'warn',
  ernst: 'alert',
};

// ═══════════════════════════════════════════════════════════════════════════
//  BRÜCKEN AUS DEM BESTEHENDEN VOKABULAR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Der Zustand nach einem gescheiterten TSE-Schritt im Bezahlweg.
 *
 * `eingereiht` ist die MESSUNG aus `ausfallSichern` — nicht die Annahme, dass
 * es schon geklappt haben wird. Ist sie falsch, gibt es für diesen Beleg
 * ausser dem Papier keinen Nachweis, und das schlägt jede andere Aussage.
 *
 * Die Trennlinie ist dieselbe wie in `istNachreichbar`
 * (`tse-queue-store.ts:466`): nur was die Sicherungseinrichtung schon gesehen
 * hat, kann nachgereicht werden.
 */
export function zustandAusAusfall(schritt: TseAusfallSchritt, eingereiht: boolean): Fiskalzustand {
  if (!eingereiht) return 'nichtGesichert';
  switch (schritt) {
    case 'keine_tse':
      return 'ohneSicherungseinrichtung';
    case 'eroeffnung':
      return 'dauerhaftVermerkt';
    case 'abschluss':
      return 'wartetAufAbschluss';
    case 'melden':
      return 'wartetAufMeldung';
    default: {
      const nie: never = schritt;
      throw new Error(`Unbekannter Schritt: ${String(nie)}`);
    }
  }
}

/**
 * Der Zustand einer Zeile aus dem Korb.
 *
 * `hatSignatur` ist die gemessene Unterscheidung der beiden Nachreiche-Wege
 * (`tse-queue-store.ts:74`): Signatur leer heisst „Abschluss fehlt", Signatur
 * vorhanden heisst „nur noch melden, niemals neu abschliessen".
 */
export function zustandAusKorbzeile(status: TseQueueStatus, hatSignatur: boolean): Fiskalzustand {
  switch (status) {
    case 'succeeded':
      return 'signiert';
    case 'failed_terminal':
      return 'dauerhaftVermerkt';
    case 'pending':
    case 'in_flight':
      return hatSignatur ? 'wartetAufMeldung' : 'wartetAufAbschluss';
    default: {
      const nie: never = status;
      throw new Error(`Unbekannter Korbzustand: ${String(nie)}`);
    }
  }
}

/**
 * KundenSucher — die EINE Kundensuche der Kasse.
 *
 * DER FUND, der dieses Bauteil erzwungen hat:
 * Fünf Bildschirme haben dieselbe Serverfunktion (`customersApi.list`) auf fünf
 * verschiedene Arten bedient. Nachgemessen unterschieden sie sich in fast allem,
 * was ein Mensch am Tresen merkt:
 *
 *   Entprellung   240 ms in vier Masken, GAR KEINE in WhatsApp (dort löst jede
 *                 Taste eine eigene Abfrage aus).
 *   Fehler        drei Masken zeigten den ehrlichen Fehlerzustand, die
 *                 Kundenakte einen flachen roten Streifen ohne Wiederholung,
 *                 WhatsApp gab einen Serverfehler als „Keine Treffer" aus.
 *   Anlegen       im Fehlerfall gesperrt (Ankauf, Verkauf), in der Kundenakte
 *                 blieb der Knopf „+ Neuer Kunde" scharf.
 *   Zeile         vier verschiedene Zeilen: mal mit PEP-Fahne, mal ohne, mal mit
 *                 Ankaufsumme, mal nur mit KYC-Zeichen.
 *   Wort          derselbe Sachverhalt hiess einmal „Sanktion" und einmal
 *                 „Sanktioniert".
 *   Grenze        30 / 20 / 20 / 20 / 8 Zeilen.
 *
 * WAS DAS AM TRESEN BEDEUTET: Die Kasse antwortet auf dieselbe Frage — „kennen
 * wir diesen Menschen?" — je nach Bildschirm anders. Genau das ist „mal so, mal
 * so". Ein Verkäufer, der im Ankauf mit rotem Rahmen als gesperrt erscheint,
 * sieht in der Bewertung nur „ohne KYC".
 *
 * DIE ENTSCHEIDUNG BLEIBT, WO SIE GEPRÜFT IST: dieses Bauteil erfindet die
 * Zustandsregel NICHT neu, es benutzt `lib/kundensuche-zustand.ts`. Dort steht
 * die teuerste Erkenntnis der Bestandsaufnahme: „Kein Treffer" ist eine Aussage
 * über die Kundendatei, „der Server schweigt" eine über das Netz, und nur die
 * erste darf zum Anlegen führen. `kundenSucherAnsicht()` hier setzt EINEN Schritt
 * darauf: solange die Suche nicht erreichbar ist, wird KEIN Weg zum Anlegen
 * gezeigt — auch nicht bei leerem Suchfeld. Die Kundenakte blättert nämlich auch
 * ohne Suchtext, und dort stand der Anlegen-Knopf bisher selbst dann noch scharf,
 * wenn die Liste gar nicht geladen werden konnte.
 *
 * ZU DEN ABSTÄNDEN IN DIESER DATEI: die Zahlen sind die Werte, die die fünf
 * Masken heute tatsächlich zeichnen (`var(--space-2)` ist 8px, `var(--space-3)`
 * ist 12px). Die offizielle Leiter `--w14-space-*` beginnt bei 8 und springt auf
 * 16 — sie kennt die 12 nicht. Wer hier auf die Leiter umbiegt, macht jeden
 * Zeilenabstand dieser Masken um die Hälfte grösser. Deshalb stehen hier die
 * gemessenen Pixel und keine erfundene Marke.
 */

import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';

import {
  type CustomerListQuery,
  type CustomerListRow,
  customersApi,
} from '@norns/api-client';
import { Button, MagnifierIcon, MoneyAmount, ParchmentCard } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import {
  type KundensucheZustand,
  anlegenErlaubt,
  kundensucheZustand,
} from '../../lib/kundensuche-zustand.js';

/** Alle vier Masken warteten 240 ms. Eine Zahl, eine Stelle. */
export const KUNDENSUCHE_ENTPRELLUNG_MS = 240;

/** Die gemessenen Abstände der heutigen Masken. Siehe Kopfkommentar. */
const ABSTAND_ENG = 8;
const ABSTAND = 12;
const ABSTAND_WEIT = 16;

/**
 * Wonach an dieser Stelle gefragt wird. Steuert ausschliesslich die Anrede in
 * den Sätzen — im Ankauf ist derselbe Mensch der Verkäufer, im Verkauf der
 * Käufer, in der Kundenakte schlicht der Kunde.
 */
export type KundenRolle = 'Kunde' | 'Käufer' | 'Verkäufer';

export interface KundenRolleTexte {
  /** „dieser Verkäufer" — für den Fehlersatz. */
  dieser: string;
  /** „den Verkäufer" — für den Einstiegssatz. */
  den: string;
}

/**
 * Die Beugung an einer Stelle. Vorher trug jede Maske ihre eigenen Sätze, und
 * genau darin gingen sie auseinander: der Ankauf sprach vom Verkäufer, der
 * Verkauf vom Käufer, die Bewertung wieder vom Verkäufer — dreimal derselbe
 * Satz, dreimal abgeschrieben.
 */
export function kundenRolleTexte(rolle: KundenRolle): KundenRolleTexte {
  switch (rolle) {
    case 'Käufer':
      return { dieser: 'dieser Käufer', den: 'den Käufer' };
    case 'Verkäufer':
      return { dieser: 'dieser Verkäufer', den: 'den Verkäufer' };
    default:
      return { dieser: 'dieser Kunde', den: 'den Kunden' };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Reine Entscheidungen — ohne React, ohne Netz, damit prüfbar
// ────────────────────────────────────────────────────────────────────────

export interface KundenSuchAbfrageOptionen {
  /** Wie viele Zeilen höchstens. */
  limit: number;
  /**
   * Gesperrte Akten ausblenden? `undefined` lässt die Vorgabe des Servers
   * stehen. Die Auswahlmasken setzen ausdrücklich `false`, DAMIT die Warnung
   * erscheint, statt den gesperrten Menschen lautlos verschwinden zu lassen.
   */
  excludeBlocked?: boolean;
  /** Gelöschte Konten mitliefern (nur die Kundenakte zeigt sie durchgestrichen). */
  includeErased?: boolean;
  /** Nur Akten mit geprüftem Ausweis. */
  kycVerifiedOnly?: boolean;
}

/** Baut die Abfrage. Rein, damit die Flaggen einzeln prüfbar sind. */
export function kundenSuchAbfrage(
  optionen: KundenSuchAbfrageOptionen,
  suchtext: string,
): CustomerListQuery {
  const abfrage: CustomerListQuery = { limit: optionen.limit };
  const text = suchtext.trim();
  if (text.length > 0) abfrage.q = text;
  if (optionen.excludeBlocked !== undefined) abfrage.excludeBlocked = optionen.excludeBlocked;
  if (optionen.includeErased === true) abfrage.includeErased = true;
  if (optionen.kycVerifiedOnly === true) abfrage.kycVerifiedOnly = true;
  return abfrage;
}

/** Welche Tafel im Ergebnisbereich steht. */
export type KundenSucherTafel =
  /** Es wurde noch nichts gefragt. */
  | 'hinweis'
  /** Die Suche schweigt. Über die Kundendatei wissen wir nichts. */
  | 'fehler'
  /** Die Suche hat geantwortet: diesen Menschen gibt es nicht. */
  | 'leer'
  /** Zeilen anzeigen (auch die noch leere Liste einer laufenden ersten Suche). */
  | 'liste';

export interface KundenSucherAnsicht {
  tafel: KundenSucherTafel;
  /** Darf an dieser Stelle überhaupt ein Weg zum Anlegen sichtbar sein? */
  anlegenSichtbar: boolean;
}

/**
 * Setzt die geprüfte Zustandsregel in die Oberfläche um.
 *
 * `!istFehler` steht hier ZUSÄTZLICH zu `anlegenErlaubt(zustand)`, und das ist
 * kein Doppel: `anlegenErlaubt` gibt bei leerem Suchfeld `true` zurück, weil dann
 * gar nichts gefragt wurde. Die Kundenakte fragt aber AUCH mit leerem Feld — sie
 * blättert die ganze Datei. Schlägt genau diese Abfrage fehl, wusste die Kasse
 * bisher nichts und lud trotzdem zum Anlegen ein. Solange die Suche schweigt,
 * gibt es hier keinen Anlegen-Weg, mit oder ohne Suchtext.
 */
export function kundenSucherAnsicht(eingabe: {
  zustand: KundensucheZustand;
  istFehler: boolean;
  /** Hat dieser Bildschirm überhaupt einen Weg zum Anlegen? */
  anlegenMoeglich: boolean;
}): KundenSucherAnsicht {
  const tafel: KundenSucherTafel = eingabe.istFehler
    ? 'fehler'
    : eingabe.zustand === 'tippen'
      ? 'hinweis'
      : eingabe.zustand === 'leer'
        ? 'leer'
        : 'liste';
  return {
    tafel,
    anlegenSichtbar:
      eingabe.anlegenMoeglich && !eingabe.istFehler && anlegenErlaubt(eingabe.zustand),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Mechanik
// ────────────────────────────────────────────────────────────────────────

export interface EntprelltesSuchfeld {
  /** Was im Feld steht. */
  eingabe: string;
  setEingabe: (wert: string) => void;
  /** Der entprellte, beschnittene Text, mit dem tatsächlich gefragt wird. */
  suchtext: string;
}

/**
 * Die 240-ms-Entprellung, viermal Zeile für Zeile abgeschrieben, jetzt einmal.
 * Der Zeitgeber wird beim Abräumen gelöscht — sonst schriebe eine geschlossene
 * Maske noch in den Zustand.
 */
export function useEntprelltesSuchfeld(): EntprelltesSuchfeld {
  const [eingabe, setEingabe] = useState<string>('');
  const [suchtext, setSuchtext] = useState<string>('');
  const zeitgeber = useRef<number | null>(null);

  useEffect(() => {
    if (zeitgeber.current !== null) window.clearTimeout(zeitgeber.current);
    zeitgeber.current = window.setTimeout(
      () => setSuchtext(eingabe.trim()),
      KUNDENSUCHE_ENTPRELLUNG_MS,
    );
    return () => {
      if (zeitgeber.current !== null) window.clearTimeout(zeitgeber.current);
    };
  }, [eingabe]);

  return { eingabe, setEingabe, suchtext };
}

export interface KundenSuche extends EntprelltesSuchfeld {
  treffer: readonly CustomerListRow[];
  zustand: KundensucheZustand;
  /** Die letzte Antwort war ein Fehler. */
  istFehler: boolean;
  /** Eine Abfrage ist unterwegs. */
  laeuft: boolean;
  erneutVersuchen: () => void;
}

/**
 * Feld, Abfrage und Zustand in einem. Die Kundenakte benutzt diesen Haken
 * bewusst NICHT: sie liest über `useCachedQuery`, damit sie beim Netzausfall
 * den letzten guten Stand mit Altersstempel zeigen kann. Sie teilt sich
 * stattdessen `useEntprelltesSuchfeld`, `kundenSuchAbfrage` und
 * `kundenSucherAnsicht` — die Entscheidungen, nicht das Netz.
 */
export function useKundenSuche(optionen: {
  limit: number;
  excludeBlocked: boolean;
}): KundenSuche {
  const { limit, excludeBlocked } = optionen;
  const api = useApiClient();
  const feld = useEntprelltesSuchfeld();

  const abfrage = useMemo(
    () => kundenSuchAbfrage({ limit, excludeBlocked }, feld.suchtext),
    [limit, excludeBlocked, feld.suchtext],
  );

  const q = useQuery({
    queryKey: ['customers', 'list', abfrage],
    queryFn: () => customersApi.list(api, abfrage),
    staleTime: 10_000,
    enabled: feld.suchtext.length > 0,
  });

  const treffer = useMemo(() => q.data?.items ?? [], [q.data]);

  const zustand = kundensucheZustand({
    suchtext: feld.suchtext,
    isFetching: q.isFetching,
    isError: q.isError,
    trefferzahl: treffer.length,
  });

  return {
    ...feld,
    treffer,
    zustand,
    istFehler: q.isError,
    laeuft: q.isFetching,
    erneutVersuchen: () => void q.refetch(),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Bausteine
// ────────────────────────────────────────────────────────────────────────

export interface KundenSuchfeldProps {
  suche: EntprelltesSuchfeld;
  /** Zeigt „sucht…" rechts im Feld, solange eine Abfrage unterwegs ist. */
  laeuft: boolean;
  platzhalter?: string;
  autoFokus?: boolean;
}

/** Das Suchfeld: Lupe, Eingabe, und rechts das ehrliche „sucht…". */
export function KundenSuchfeld({
  suche,
  laeuft,
  platzhalter = 'Name · E-Mail · Telefon',
  autoFokus = true,
}: KundenSuchfeldProps): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: ABSTAND,
        padding: `${ABSTAND_ENG}px ${ABSTAND}px`,
        backgroundColor: 'var(--w14-parchment-2)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-card)',
      }}
    >
      <MagnifierIcon size={20} tone="ink" />
      <input
        type="text"
        value={suche.eingabe}
        onChange={(ev) => suche.setEingabe(ev.target.value)}
        placeholder={platzhalter}
        spellCheck={false}
        autoFocus={autoFokus}
        style={{
          flex: 1,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontFamily: 'var(--w14-font-mono)',
          fontSize: 'var(--w14-schrift-betont)',
          color: 'var(--w14-ink)',
        }}
      />
      {laeuft && (
        <span
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: 'var(--w14-schrift-zeile)',
            color: 'var(--w14-ink-faded)',
          }}
        >
          sucht…
        </span>
      )}
    </div>
  );
}

/**
 * Der ehrliche Fehlerzustand: die Kasse sagt, dass sie NICHTS weiss.
 *
 * Warum hier kein Anlegen angeboten wird: eine zweite Akte für einen Menschen,
 * der bereits eine hat, hebt dessen Sperre auf. Vertrauensstufe, KYC-Datum,
 * Sanktionstreffer und PEP-Fahne hängen an der bestehenden Akte; die neue ist
 * blank und das Geschäft liefe durch. Solange die Suche schweigt, ist nicht
 * feststellbar, ob es die bestehende Akte gibt.
 */
export function SucheNichtErreichbar({
  rolle,
  onErneutVersuchen,
  laeuft,
}: {
  rolle: KundenRolle;
  onErneutVersuchen: () => void;
  laeuft: boolean;
}): JSX.Element {
  return (
    <ParchmentCard
      padding="md"
      style={{ textAlign: 'center', border: '1px solid var(--w14-wax-red)' }}
    >
      <p
        role="alert"
        style={{
          margin: 0,
          color: 'var(--w14-wax-red)',
          fontFamily: 'var(--w14-font-display)',
          fontWeight: 500,
        }}
      >
        Die Suche ist gerade nicht erreichbar.
      </p>
      <p
        style={{
          margin: '6px 0 10px',
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: 'var(--w14-schrift-text)',
        }}
      >
        Ob {kundenRolleTexte(rolle).dieser} bereits bekannt oder gesperrt ist, lässt sich jetzt
        nicht sagen. Bitte keinen neuen Kunden anlegen, bevor die Suche wieder antwortet.
      </p>
      <Button variant="primary" size="sm" onClick={onErneutVersuchen} disabled={laeuft}>
        {laeuft ? 'Versucht…' : 'Erneut versuchen'}
      </Button>
    </ParchmentCard>
  );
}

/** Der Satz, der an der Stelle des Anlegen-Knopfes steht, solange er gesperrt ist. */
export function AnlegenGesperrtHinweis(): JSX.Element {
  return (
    <p
      style={{
        margin: 0,
        textAlign: 'center',
        color: 'var(--w14-ink-faded)',
        fontFamily: 'var(--w14-font-display)',
        fontStyle: 'italic',
        fontSize: 'var(--w14-schrift-text)',
      }}
    >
      Anlegen ist gesperrt, solange die Suche schweigt.
    </p>
  );
}

/**
 * Das Vertrauenszeichen einer Zeile — vier verschiedene Fassungen wurden zu
 * dieser einen. Zwei Angleichungen sind dabei bewusst:
 *
 *  • Der Sanktionstreffer heisst überall „Sanktion". Im Ankauf und im Verkauf
 *    stand „Sanktioniert", in der Kundenakte „Sanktion". Ein Sachverhalt, ein
 *    Wort.
 *  • Die VIP-Stufe wird überall gezeigt. Ankauf und Verkauf kannten den Zweig
 *    nicht und zeigten für einen VIP schlicht „KYC ✓" — nicht falsch, aber die
 *    Auskunft war ärmer als in der Kundenakte.
 *
 * Die PEP-Fahne steht VOR dem Zeichen, nicht statt seiner: §15 GwG ist eine
 * zusätzliche Sorgfaltspflicht, kein Ersatzurteil. Ein PEP darf geprüft sein.
 */
export function VertrauensZeichen({
  kycGeprueft,
  stufe,
  sanktion,
  pep = false,
}: {
  kycGeprueft: boolean;
  stufe: CustomerListRow['trustLevel'];
  sanktion: boolean;
  pep?: boolean;
}): JSX.Element {
  const zeichen = ((): { text: string; farbe: string } => {
    if (sanktion) return { text: 'Sanktion', farbe: 'var(--w14-wax-red)' };
    if (stufe === 'BANNED') return { text: 'gesperrt', farbe: 'var(--w14-wax-red)' };
    if (stufe === 'SUSPICIOUS') return { text: 'beobachten', farbe: 'var(--w14-wax-red)' };
    // 19.08.2026: „◆◆ VIP" verlor die Rauten — Basels Anweisung verbannt
    // die Raute aus dem ganzen Programm. Der Rang spricht als Wort.
    if (stufe === 'VIP') return { text: 'VIP', farbe: 'var(--w14-gold)' };
    if (kycGeprueft) return { text: 'KYC ✓', farbe: 'var(--w14-gold)' };
    return { text: 'ohne KYC', farbe: 'var(--w14-ink-faded)' };
  })();

  const haupt = (
    <span
      className="w14-smallcaps"
      style={{ fontSize: 'var(--w14-schrift-zeile)', color: zeichen.farbe, letterSpacing: '0.08em' }}
    >
      {zeichen.text}
    </span>
  );
  if (!pep) return haupt;
  return (
    <span style={{ display: 'inline-flex', gap: 'var(--w14-abstand-6)', alignItems: 'center' }}>
      <span
        className="w14-smallcaps"
        title="Politisch exponierte Person (§15 GwG)"
        style={{
          fontSize: 'var(--w14-schrift-zeile)',
          letterSpacing: '0.08em',
          color: 'var(--w14-gold)',
          border: '1px solid var(--w14-gold)',
          borderRadius: 'var(--w14-radius-button)',
          padding: 'var(--w14-abstand-2) var(--w14-abstand-6)',
        }}
      >
        {/* 27.07.2026: „PEP" allein war ein Kürzel, dessen Auflösung nur im
            title= stand — dem Finger unsichtbar. Das ganze Wort ist die
            Auskunft. */}
        Politisch exponiert
      </span>
      {haupt}
    </span>
  );
}

export interface KundenTrefferZeileProps {
  row: CustomerListRow;
  onSelect: (id: string) => void;
  /** Die bisherige Ankaufsumme rechts unter dem Zeichen (Ankauf). */
  zeigeAnkaufSumme?: boolean;
}

/**
 * Die Trefferzeile der drei Auswahlmasken.
 *
 * Eine gesperrte Zeile bleibt SICHTBAR und wird nicht anklickbar. Das ist der
 * Sinn von `excludeBlocked: false`: wer gesperrt ist, soll dem Menschen am
 * Tresen begegnen, statt lautlos zu fehlen — sonst hält er ihn für unbekannt
 * und legt ihn neu an.
 */
export function KundenTrefferZeile({
  row,
  onSelect,
  zeigeAnkaufSumme = false,
}: KundenTrefferZeileProps): JSX.Element {
  const gesperrt = row.sanctionsMatch || row.trustLevel === 'BANNED';
  return (
    <ParchmentCard
      padding="sm"
      style={{
        cursor: gesperrt ? 'not-allowed' : 'pointer',
        opacity: gesperrt ? 0.55 : 1,
        border: gesperrt ? '1px solid var(--w14-wax-red)' : '1px solid transparent',
      }}
      onClick={() => {
        if (!gesperrt) onSelect(row.id);
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 'var(--w14-abstand-10)',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              fontSize: 'var(--w14-schrift-grund)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.fullName}
          </div>
          <div
            className="w14-tabular"
            style={{
              fontFamily: 'var(--w14-font-mono)',
              fontSize: 'var(--w14-schrift-zeile)',
              color: 'var(--w14-ink-faded)',
            }}
          >
            {row.customerNumber}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--w14-abstand-4)' }}>
          <VertrauensZeichen
            kycGeprueft={row.kycVerifiedAt !== null}
            stufe={row.trustLevel}
            sanktion={row.sanctionsMatch}
            pep={row.pepMatch}
          />
          {zeigeAnkaufSumme && (
            <span
              className="w14-tabular"
              style={{
                fontFamily: 'var(--w14-font-mono)',
                fontSize: 'var(--w14-schrift-zeile)',
                color: 'var(--w14-ink-faded)',
              }}
            >
              Ank. <MoneyAmount valueEur={row.cumulativeAnkaufEur} />
            </span>
          )}
        </div>
      </div>
    </ParchmentCard>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Die ganze Maske
// ────────────────────────────────────────────────────────────────────────

export interface KundenSucherProps {
  rolle: KundenRolle;
  suche: KundenSuche;
  onSelect: (id: string) => void;
  /**
   * Der Weg zum Anlegen. `null` bedeutet: dieser Bildschirm legt keine Kunden
   * an (die Bewertung tut das nicht). Ob der Weg im Augenblick GEZEIGT werden
   * darf, entscheidet allein `kundenSucherAnsicht`.
   */
  onAnlegen?: (() => void) | null;
  /** Satz unter „Kein Treffer", wenn es hier keinen Anlegen-Weg gibt. */
  leerNachsatz?: string;
  /** Der Einstiegssatz, solange nichts getippt wurde. Vorgabe: zeigen. */
  einstiegshinweis?: boolean;
  /** Die Ankaufsumme in der Zeile (nur der Ankauf zeigt sie). */
  zeigeAnkaufSumme?: boolean;
  /** Stil des Ergebnisbereichs — die Masken tragen ihn verschieden hoch. */
  ergebnisStil?: CSSProperties;
  platzhalter?: string;
}

export function KundenSucher({
  rolle,
  suche,
  onSelect,
  onAnlegen = null,
  leerNachsatz,
  einstiegshinweis = true,
  zeigeAnkaufSumme = false,
  ergebnisStil,
  platzhalter,
}: KundenSucherProps): JSX.Element {
  const ansicht = kundenSucherAnsicht({
    zustand: suche.zustand,
    istFehler: suche.istFehler,
    anlegenMoeglich: onAnlegen !== null,
  });

  return (
    <>
      <KundenSuchfeld
        suche={suche}
        laeuft={suche.laeuft}
        {...(platzhalter !== undefined ? { platzhalter } : {})}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: ABSTAND_ENG,
          ...ergebnisStil,
        }}
      >
        {ansicht.tafel === 'fehler' ? (
          <SucheNichtErreichbar
            rolle={rolle}
            onErneutVersuchen={suche.erneutVersuchen}
            laeuft={suche.laeuft}
          />
        ) : ansicht.tafel === 'hinweis' ? (
          einstiegshinweis ? (
            <p
              style={{
                margin: 0,
                padding: ABSTAND_WEIT,
                textAlign: 'center',
                color: 'var(--w14-ink-faded)',
                fontFamily: 'var(--w14-font-display)',
                fontStyle: 'italic',
                fontSize: 'var(--w14-schrift-betont)',
              }}
            >
              Geben Sie Name oder Kontakt ein, um {kundenRolleTexte(rolle).den} zu finden.
            </p>
          ) : null
        ) : ansicht.tafel === 'leer' ? (
          ansicht.anlegenSichtbar && onAnlegen !== null ? (
            <ParchmentCard padding="md" style={{ textAlign: 'center' }}>
              <p
                style={{
                  margin: '0 0 10px',
                  color: 'var(--w14-ink-faded)',
                  fontFamily: 'var(--w14-font-display)',
                  fontStyle: 'italic',
                }}
              >
                Kein Treffer.
              </p>
              <Button variant="primary" size="sm" onClick={onAnlegen}>
                + Als neuen Kunden anlegen
              </Button>
            </ParchmentCard>
          ) : (
            <p
              style={{
                margin: 0,
                textAlign: 'center',
                color: 'var(--w14-ink-faded)',
                fontFamily: 'var(--w14-font-display)',
                fontStyle: 'italic',
              }}
            >
              Kein Treffer.{leerNachsatz ? ` ${leerNachsatz}` : ''}
            </p>
          )
        ) : (
          suche.treffer.map((row) => (
            <KundenTrefferZeile
              key={row.id}
              row={row}
              onSelect={onSelect}
              zeigeAnkaufSumme={zeigeAnkaufSumme}
            />
          ))
        )}
      </div>

      {onAnlegen !== null &&
        (ansicht.anlegenSichtbar ? (
          <Button variant="ghost" size="md" onClick={onAnlegen}>
            + Neuer Kunde anlegen
          </Button>
        ) : (
          <AnlegenGesperrtHinweis />
        ))}
    </>
  );
}

/**
 * Welches Konto die Zahlung berührt — und warum die Kasse meistens NICHT.
 *
 * ── DER FUND (26.07.2026) ──────────────────────────────────────────────────
 * Der DATEV-Weg las `transaction_payments` überhaupt nicht: gemessen kam die
 * Tabelle in der ganzen Exportroute null mal vor. Jeder Verkauf wurde gegen
 * Konto 1000 Kasse gebucht, auch die Kartenzahlung.
 *
 * Die Folge ist nicht kosmetisch. Konto 1000 wächst um Geld, das nie in der
 * Schublade lag, und kann rechnerisch negativ werden — das ist der erste
 * Punkt, den ein Prüfer nachrechnet, und ein rechnerisch negativer Kassen-
 * bestand begründet für sich genommen eine Schätzung.
 *
 * Rechtlich dahinter: BMF vom 16.08.2017 hält unbare Vorgänge im Kassenbuch
 * für einen formellen Mangel; BMF vom 29.06.2018 entschärft das, WENN die
 * Kartenumsätze gesondert gekennzeichnet oder auf ein eigenes Konto umgetragen
 * werden. Genau das tut diese Datei.
 *
 * ── DER GELDTRANSIT, in einem Satz ─────────────────────────────────────────
 * Eine Kartenzahlung ist am Verkaufstag noch kein Bankeingang. Sie liegt beim
 * Akzeptanzweg und kommt Tage später, gekürzt um die Gebühr, auf dem Konto an.
 * Deshalb bekommt jeder Akzeptanzweg ein eigenes Durchgangskonto: der Saldo
 * darauf ist genau das Geld, das unterwegs ist, und der Berater gleicht ihn
 * mit dem Bankauszug ab.
 */

import {
  type Kontenplan,
  type KontoId,
  konto as kontoNummer,
  vorlagenplan,
} from './kontenrahmen.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

export class ZahlartNichtKontiertError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

/**
 * Zahlart → LOGISCHES Konto.
 *
 * NICHT vollständig, und das ist Absicht. Zugeordnet sind nur die Wege, für
 * die es eine belegte Zuordnung gibt: Bargeld, Bank, je Akzeptanzweg ein
 * eigenes Durchgangskonto und seit dem 12.08.2026 der Gutschein (amtlich
 * geprüft, siehe `kontenrahmen.ts`). Für Kundenkonto und Inzahlungnahme gibt
 * es weiterhin keine — dort wird der Export ABGEBROCHEN, statt sie still auf
 * die Kasse zu buchen.
 *
 * Ein stiller Rückfall auf die Kasse ist genau der Fehler, den diese Datei
 * behebt.
 *
 * ── DIE ÄNDERUNG VOM 26.07.2026 ────────────────────────────────────────────
 * Hier standen bis heute die NUMMERN aus SKR03. Damit war der Laden auf einen
 * Kontenrahmen festgenagelt. Jetzt steht hier der ZWECK, und die Nummer kommt
 * aus dem Kontenplan — Vorlage SKR03 oder SKR04, je Konto überschreibbar.
 */
export const KONTO_JE_ZAHLART: Readonly<Record<string, KontoId>> = {
  CASH: 'kasse', // das EINZIGE Konto, das echtes Bargeld sieht
  ZVT_CARD: 'geldtransitKarte',
  SUMUP: 'geldtransitSumUp',
  MOLLIE: 'geldtransitMollie',
  STRIPE: 'geldtransitStripe',
  // 26.07.2026 (Koordination §9): der Leser am Ladentisch. EIGENES
  // Durchgangskonto, obwohl derselbe Anbieter auszahlt — Terminal- und
  // Shop-Auszahlungen sind zwei Stroeme, die der Berater einzeln gegen den
  // Bankauszug abstimmt.
  STRIPE_TERMINAL: 'geldtransitStripeTerminal',
  EBAY: 'geldtransitEbay',
  BANK_TRANSFER: 'bank',
  // 12.08.2026: die Einlösung eines Mehrzweck-Gutscheins mindert die
  // Verbindlichkeit aus seiner Ausgabe. Vorher brach ein einziger
  // Gutschein-Beleg die DATEV-Datei des ganzen Tages ab.
  VOUCHER: 'gutscheinMehrzweck',
};

/**
 * Der Vorgabeplan, wenn kein Rahmen mitgegeben wird: SKR03 aus der Vorlage.
 *
 * Er hält genau die Nummern, die vor dem 26.07.2026 fest im Quelltext
 * standen. Ein Aufrufer ohne Plan bekommt also wörtlich das alte Verhalten.
 */
const VORGABEPLAN: Kontenplan = vorlagenplan('SKR03');

/**
 * Zahlart → Sollkonto in SKR03, wie es bis zum 26.07.2026 fest im Quelltext
 * stand. Bleibt erhalten, damit Aufrufer ohne Kontenplan unverändert laufen.
 */
export const SOLLKONTO_JE_ZAHLART: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(KONTO_JE_ZAHLART).map(([zahlart, id]) => [
      zahlart,
      kontoNummer(VORGABEPLAN, id),
    ]),
  ),
);

/**
 * Kurzname der Zahlart für den Buchungstext.
 *
 * Er erscheint NUR, wenn ein Beleg mit mehreren Zahlarten beglichen wurde —
 * sonst stünden zwei Zeilen mit demselben Text untereinander und der Berater
 * müsste raten, welche welche ist. Feld 14 fasst 60 Zeichen, deshalb kurz.
 */
export const ZAHLART_KURZ: Readonly<Record<string, string>> = {
  CASH: 'bar',
  ZVT_CARD: 'Karte',
  SUMUP: 'SumUp',
  MOLLIE: 'Mollie',
  STRIPE: 'Stripe',
  STRIPE_TERMINAL: 'Stripe Terminal',
  EBAY: 'eBay',
  BANK_TRANSFER: 'Überweisung',
  VOUCHER: 'Gutschein',
};

/** Was der Inhaber liest, wenn eine Zahlart nicht kontiert ist. */
const KLARTEXT_ZAHLART: Readonly<Record<string, string>> = {
  DEBT: 'Kundenkonto',
  TRADE_IN: 'Inzahlungnahme',
};

export function sollkontoFuerZahlart(zahlart: string, plan: Kontenplan = VORGABEPLAN): string {
  const id = KONTO_JE_ZAHLART[zahlart];
  if (id !== undefined) return kontoNummer(plan, id);
  const name = KLARTEXT_ZAHLART[zahlart] ?? zahlart;
  throw new ZahlartNichtKontiertError(
    `Für die Zahlart „${name}" ist kein Buchungskonto hinterlegt, deshalb wurde ` +
      'KEINE DATEV-Datei erzeugt. Sie still auf die Kasse zu buchen wäre falsch: ' +
      'das Konto Kasse darf nur echtes Bargeld tragen. Bitte lassen Sie sich von ' +
      'Ihrem Steuerberater das passende Konto nennen.',
  );
}

export interface Zahlung {
  readonly zahlart: string;
  /** NUMERIC(18,2) als Zeichenkette, wie in der Datenbank. */
  readonly betragEur: string;
}

export interface Behandlungsanteil {
  readonly code: string;
  /** Betrag dieser Steuerbehandlung am Beleg, in ganzen Cent. */
  readonly cents: bigint;
}

export interface Buchungsanteil {
  readonly zahlart: string;
  readonly sollkonto: string;
  readonly behandlungscode: string;
  readonly cents: bigint;
}

function zuCents(eur: string): bigint {
  const t = eur.trim();
  const neg = t.startsWith('-');
  const [w, f = ''] = (neg ? t.slice(1) : t).split('.');
  const v = BigInt(w || '0') * 100n + BigInt((f + '00').slice(0, 2));
  return neg ? -v : v;
}

function betragOhneVorzeichen(c: bigint): bigint {
  return c < 0n ? -c : c;
}

/**
 * Eine Summe nach Gewichten in ganze Cent teilen, mit dem Verfahren der
 * grössten Reste.
 *
 * Erst der abgeschnittene Anteil, dann geht jeder noch fehlende Cent an das
 * Gewicht mit dem grössten Divisionsrest. Bei Gleichstand gewinnt der frühere
 * Eintrag — die Aufrufer geben absteigend sortiert hinein, also die GRÖSSTE
 * Behandlung. Ergebnis: die Summe der Anteile ist exakt `ziel`, und kein
 * Anteil weicht um mehr als einen Cent vom ideellen Bruchteil ab.
 */
function verteileNachGroesstenResten(
  gewichte: readonly bigint[],
  gewichtSumme: bigint,
  ziel: bigint,
): bigint[] {
  const anteile = gewichte.map((g) => (ziel * g) / gewichtSumme);
  const reste = gewichte.map((g, i) => ziel * g - (anteile[i] as bigint) * gewichtSumme);
  let offen = ziel - anteile.reduce((s, x) => s + x, 0n);
  while (offen > 0n) {
    let best = 0;
    for (let i = 1; i < reste.length; i++) {
      if ((reste[i] as bigint) > (reste[best] as bigint)) best = i;
    }
    anteile[best] = (anteile[best] as bigint) + 1n;
    // Der nächste Cent an dieselbe Stelle wäre der ZWEITE — er rutscht damit
    // ans Ende der Rangfolge, statt denselben Eintrag noch einmal zu gewinnen.
    reste[best] = (reste[best] as bigint) - gewichtSumme;
    offen -= 1n;
  }
  return anteile;
}

/**
 * Zahlungen und Steuerbehandlungen zu Buchungszeilen kreuzen.
 *
 * ── WARUM ES HIER ÜBERHAUPT ETWAS ZU ENTSCHEIDEN GIBT ──────────────────────
 * Ein Beleg kann mehrere Steuerbehandlungen tragen (ein Ring zu 19 Prozent
 * und eine Münze nach § 25a) UND mit mehreren Zahlarten beglichen sein
 * (50 Euro bar, Rest mit Karte). Gemessen auf der Produktion: einer von 64
 * Belegen hat mehr als eine Zahlart. Selten, aber nicht null — und genau
 * solche Fälle brechen später einzeln auf.
 *
 * Welcher Euro der Karte welchen Gegenstand bezahlt hat, ist nicht bekannt
 * und auch nicht bekannt zu machen: der Kunde legt einen Betrag hin, keine
 * Zuordnung. Wir teilen deshalb anteilig auf, in ganzen Cent.
 *
 * Das ist eine Annahme, und sie wird hier ausgesprochen statt versteckt. Was
 * dabei NICHT angenommen wird, ist das, worauf es steuerlich ankommt: die
 * Summe je Zahlart bleibt auf den Cent genau die gezahlte, UND die Summe je
 * Behandlung bleibt auf den Cent genau die des Belegs. Nur die Kreuzung
 * dazwischen ist verteilt.
 *
 * ── DER FUND (26.07.2026): ein Cent im falschen Steuertopf ─────────────────
 * Bis heute verteilte diese Stelle JEDE Zahlung für sich und gab den
 * Divisionsrest jedes Mal in dieselbe Richtung. Bei mehreren Zahlungen häufte
 * sich das auf, und die zweite Zusage brach. Gemessen an einem Beleg über
 * 1,00 Euro mit den Behandlungen 0,50 und 0,50, bezahlt mit 0,51 bar und
 * 0,49 Karte:
 *   bar   51 * 50 / 100 = 25,5 -> abgeschnitten 25, Rest an die zweite 26
 *   Karte 49 * 50 / 100 = 24,5 -> abgeschnitten 24, Rest an die zweite 25
 *   Summe je Behandlung 49 und 51 — richtig wären 50 und 50.
 * Ein Prüfer stellt genau das gegenüber: DATEV je Erlöskonto gegen DSFinV-K
 * je Steuerbehandlung. Eine Abweichung dort ist keine Kosmetik.
 *
 * ── DIE BEHEBUNG: grösste Reste über die GANZE Kreuztabelle ────────────────
 * Beide Zusagen zugleich zu halten ist ein Transportproblem: die Zeilensummen
 * sind die Zahlbeträge, die Spaltensummen die Behandlungsbeträge. Deshalb
 * wird nicht mehr je Zahlung, sondern EINMAL über die ganze Tabelle verteilt:
 * jede Zelle bekommt ihren abgeschnittenen Anteil, und die fehlenden Cent
 * gehen nach grösstem Rest an Zellen, deren Zeile UND deren Spalte noch etwas
 * zu bekommen haben. Damit stimmen beide Ränder exakt.
 *
 * Für den Fall oben ergibt das von Hand: Spaltenziele 50 und 50; Bodenwerte
 * 25/25 (bar) und 24/24 (Karte); Fehlbetrag 1 je Zeile und 1 je Spalte, alle
 * Reste gleich gross. Der erste Cent geht an bar/grösste Behandlung, der
 * zweite zwangsläufig an Karte/andere Behandlung:
 *   bar   26 + 25 = 51,   Karte 24 + 25 = 49   (Zahlarten exakt)
 *   erste 26 + 24 = 50,   zweite 25 + 25 = 50  (Behandlungen exakt)
 *
 * Der Gleichstand geht an die GRÖSSTE Behandlung, weil `sortiert` absteigend
 * läuft und die Suche den ersten Treffer nimmt. Bis heute sagte der Kommentar
 * an dieser Stelle „die grösste", der Code traf aber `sortiert.length - 1`,
 * also die KLEINSTE. Kommentar und Code sagten das Gegenteil voneinander.
 *
 * Deckt sich die Zahlsumme nicht mit der Belegsumme (Teilzahlung, Datenschaden),
 * so gilt weiter der Zahlbetrag als das Ganze: die Spaltenziele werden auf die
 * Zahlsumme skaliert. Erfundenes Geld entsteht dabei nicht.
 */
export function kreuzeZahlungenMitBehandlungen(
  zahlungen: readonly Zahlung[],
  behandlungen: readonly Behandlungsanteil[],
  plan: Kontenplan = VORGABEPLAN,
): Buchungsanteil[] {
  if (behandlungen.length === 0) return [];

  const gesamtBehandlung = behandlungen.reduce((s, b) => s + betragOhneVorzeichen(b.cents), 0n);
  if (gesamtBehandlung === 0n) return [];

  // Nach Betrag absteigend: bei gleich grossem Rest gewinnt die grösste
  // Behandlung den zusätzlichen Cent.
  const sortiert = [...behandlungen].sort((a, b) => {
    const ab = betragOhneVorzeichen(a.cents);
    const bb = betragOhneVorzeichen(b.cents);
    return bb > ab ? 1 : bb < ab ? -1 : 0;
  });

  // Die Zahlarten werden ZUERST aufgelöst, alle. Eine nicht kontierte Zahlart
  // muss die ganze Datei abbrechen, auch wenn ihr Betrag null ist.
  const reihen: { zahlart: string; sollkonto: string; betrag: bigint }[] = [];
  for (const z of zahlungen) {
    const sollkonto = sollkontoFuerZahlart(z.zahlart, plan);
    const betrag = betragOhneVorzeichen(zuCents(z.betragEur));
    if (betrag === 0n) continue; // DATEV weist eine Buchung über 0,00 zurück
    reihen.push({ zahlart: z.zahlart, sollkonto, betrag });
  }
  const gesamtZahlung = reihen.reduce((s, r) => s + r.betrag, 0n);
  if (gesamtZahlung === 0n) return [];

  // Die Spaltensummen: was JEDE Behandlung am Ende tragen muss. Bei
  // vollständiger Zahlung ist das exakt ihr Belegbetrag.
  const spaltenZiel = verteileNachGroesstenResten(
    sortiert.map((b) => betragOhneVorzeichen(b.cents)),
    gesamtBehandlung,
    gesamtZahlung,
  );

  // Bodenwerte der Kreuztabelle plus die Reste, nach denen gleich vergeben wird.
  const tabelle = reihen.map(() => sortiert.map(() => 0n));
  const reste = reihen.map(() => sortiert.map(() => 0n));
  const zeileFehlt = reihen.map(() => 0n);
  const spalteFehlt = sortiert.map(() => 0n);
  for (let i = 0; i < reihen.length; i++) {
    const zeile = tabelle[i] as bigint[];
    const zeilenReste = reste[i] as bigint[];
    const betrag = (reihen[i] as { betrag: bigint }).betrag;
    let inZeile = 0n;
    for (let j = 0; j < sortiert.length; j++) {
      const roh = betrag * (spaltenZiel[j] as bigint);
      const boden = roh / gesamtZahlung;
      zeile[j] = boden;
      zeilenReste[j] = roh - boden * gesamtZahlung;
      inZeile += boden;
      spalteFehlt[j] = (spalteFehlt[j] as bigint) - boden;
    }
    zeileFehlt[i] = betrag - inZeile;
  }
  for (let j = 0; j < sortiert.length; j++) {
    spalteFehlt[j] = (spalteFehlt[j] as bigint) + (spaltenZiel[j] as bigint);
  }

  // Die fehlenden Cent vergeben. Solange etwas offen ist, gibt es mindestens
  // eine offene Zeile und mindestens eine offene Spalte — die Summe der
  // Zeilenfehlbeträge ist gleich der Summe der Spaltenfehlbeträge. Die Schleife
  // kann also nicht hängen und läuft höchstens Zeilen mal Spalten oft.
  let offen = zeileFehlt.reduce((s, x) => s + x, 0n);
  while (offen > 0n) {
    let bi = -1;
    let bj = -1;
    let besterRest = 0n;
    for (let i = 0; i < reihen.length; i++) {
      if ((zeileFehlt[i] as bigint) <= 0n) continue;
      const zeilenReste = reste[i] as bigint[];
      for (let j = 0; j < sortiert.length; j++) {
        if ((spalteFehlt[j] as bigint) <= 0n) continue;
        const r = zeilenReste[j] as bigint;
        if (bi === -1 || r > besterRest) {
          bi = i;
          bj = j;
          besterRest = r;
        }
      }
    }
    if (bi === -1) break; // kann nach der Überlegung oben nicht eintreten
    const zeile = tabelle[bi] as bigint[];
    zeile[bj] = (zeile[bj] as bigint) + 1n;
    (reste[bi] as bigint[])[bj] = besterRest - gesamtZahlung;
    zeileFehlt[bi] = (zeileFehlt[bi] as bigint) - 1n;
    spalteFehlt[bj] = (spalteFehlt[bj] as bigint) - 1n;
    offen -= 1n;
  }

  // Reihenfolge unverändert: je Zahlung, Behandlungen absteigend. Der
  // Buchungstext im Export nummeriert die Zeilen, deshalb darf sie nicht
  // wandern.
  const raus: Buchungsanteil[] = [];
  for (let i = 0; i < reihen.length; i++) {
    const r = reihen[i] as { zahlart: string; sollkonto: string; betrag: bigint };
    const zeile = tabelle[i] as bigint[];
    for (let j = 0; j < sortiert.length; j++) {
      const cents = zeile[j] as bigint;
      if (cents <= 0n) continue;
      raus.push({
        zahlart: r.zahlart,
        sollkonto: r.sollkonto,
        behandlungscode: (sortiert[j] as Behandlungsanteil).code,
        cents,
      });
    }
  }
  return raus;
}

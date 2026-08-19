/**
 * Die Vermittlungsgebühr, und warum sie NICHT bei Stripe wohnt.
 *
 * ═══════════════════════════════════════════════════════════════════════
 *  DER ANBIETER IST AUSTAUSCHBAR. DAS PROVISIONSMODELL IST ES NICHT.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Bis 0109 stand die Gebühr als eine einzige Zahl auf dem Stripe-Konto des
 * Händlers (`stripe_connected_accounts.application_fee_bps`). Das hatte zwei
 * Folgen, die beide erst wehtun, wenn es teuer ist, sie zu ändern:
 *
 *   1. Ein Verkauf über den Marktplatz von Norns konnte KEINE andere Gebühr
 *      tragen als ein Verkauf im eigenen Shop desselben Händlers. Damit wäre
 *      der Marktplatz kein eigenes Geschäft, sondern eine Werbefläche.
 *   2. Der Wechsel des Zahlungsanbieters hätte die Gebührenregel mitgerissen,
 *      obwohl sie mit dem Anbieter nichts zu tun hat. Die Gebühr ist eine
 *      Abmachung zwischen Norns und dem Händler, kein Merkmal von Stripe.
 *
 * Dieses Modul kennt deshalb weder Stripe noch eine Kontokennung im Sinne
 * eines bestimmten Anbieters. Es kennt: WER (Anbieter plus Kontobezug), WO
 * (Kanal), WIEVIEL (Basispunkte). Ein Anbieterwechsel schreibt Zeilen um, er
 * schreibt keinen Code um.
 *
 * ── Die Reihenfolge, und warum genau diese ──────────────────────────────
 *
 * Vier Stufen, von der genauesten zur allgemeinsten. Die erste, die passt,
 * gewinnt; danach wird nicht weitergesucht.
 *
 *   1. dieses Konto, dieser Kanal    ← die Einzelabrede, sie schlägt alles
 *   2. dieses Konto, alle Kanäle     ← was mit diesem Händler vereinbart ist
 *   3. alle Konten, dieser Kanal     ← der Listenpreis des Kanals
 *   4. alle Konten, alle Kanäle      ← der Hauspreis
 *   5. keine Zeile passt             ← die Vorgabe aus der Umgebung
 *
 * Sie ist bewusst so herum: die Abmachung mit EINEM Händler muss den
 * Listenpreis eines Kanals schlagen können, sonst ist sie keine Abmachung.
 *
 * ── Warum das Ergebnis sagt, WOHER es kommt ─────────────────────────────
 *
 * `source` ist kein Beiwerk. Wenn ein Händler fragt, warum auf seinem Beleg
 * 1,5 % stehen und nicht 1 %, ist genau das die Antwort, und sie muss ohne
 * Nachrechnen aus dem Protokoll ablesbar sein. Eine Gebühr, deren Herkunft
 * niemand benennen kann, ist ein Streit mit offenem Ausgang.
 */

/** Spiegelt `payment_provider` in der Datenbank. */
export type CommissionProvider = 'STRIPE' | 'PAYPAL' | 'MOLLIE';

/**
 * Wo das Geschäft zustande kam. Bewusst NICHT `sales_channel` oder
 * `reservation_channel`: die beiden beschreiben den Warenweg, dieser hier
 * beschreibt den Geldweg, und sie fallen nicht zusammen. Eine Abholung im
 * Laden, die im Netz bezahlt wurde, ist hier WEB und dort POS.
 *
 * MARKETPLACE steht schon hier, obwohl der Marktplatz noch nicht gebaut ist.
 * Ein Wert, der von Anfang an vorgesehen ist, kostet heute nichts und erspart
 * später eine Wanderung an einer Stelle, an der bereits Geld fliesst.
 */
export type CommissionChannel = 'POS' | 'WEB' | 'MARKETPLACE' | 'EBAY';

export const COMMISSION_CHANNELS: readonly CommissionChannel[] = [
  'POS',
  'WEB',
  'MARKETPLACE',
  'EBAY',
];

/** Eine Zeile aus `payment_commission_rates`. NULL heisst überall "gilt für alle". */
export interface CommissionRate {
  provider: CommissionProvider;
  /** Der Kontobezug beim Anbieter, bei Stripe `acct_…`. NULL = jedes Konto. */
  accountRef: string | null;
  /**
   * NULL = jeder Kanal.
   *
   * Bewusst `string` und nicht `CommissionChannel`: die Spalte in der
   * Datenbank ist `text`, also kommt hier herein, was dort steht. Ein enger
   * Typ an dieser Stelle wäre nur mit einer Typzusicherung zu haben, und eine
   * Typzusicherung ist an einer Geldstelle eine Behauptung ohne Deckung.
   *
   * Ein unbekannter Wert ist damit kein Fehler, sondern harmlos: verglichen
   * wird gegen den Kanal der Anfrage, und was keiner ist, passt zu keinem.
   * Trüge die Tabelle je ein 'SUBSCRIPTION', das dieser Code nicht kennt,
   * würde die Zeile schlicht übersprungen und die nächste Stufe gälte. Das
   * ist die sichere Richtung: eine unverstandene Zeile darf nie zufällig
   * gelten, sie darf nur nicht gelten.
   */
  channel: string | null;
  feeBps: number;
}

export type CommissionSource =
  /** Einzelabrede: dieses Konto, dieser Kanal. */
  | 'ACCOUNT_CHANNEL'
  /** Was mit diesem Händler generell vereinbart ist. */
  | 'ACCOUNT_DEFAULT'
  /** Der Listenpreis dieses Kanals. */
  | 'CHANNEL_DEFAULT'
  /** Der Hauspreis. */
  | 'PLATFORM_DEFAULT'
  /** Keine Zeile passt, es gilt die Vorgabe aus der Umgebung. */
  | 'ENV_FALLBACK';

export interface CommissionDecision {
  feeBps: number;
  source: CommissionSource;
}

/** Dieselbe Schranke wie in 0108 und im Register: die Gebühr ist ein Entgelt, kein Anteil. */
export const MAX_FEE_BPS = 1000;

/**
 * Findet die gültige Gebühr. Rein, ohne Datenbank, ohne Netz, ohne Uhr.
 *
 * Der Aufrufer holt ALLE Zeilen des Anbieters, die für dieses Konto in Frage
 * kommen, und übergibt sie hier. Die Auswahl darf nicht in SQL passieren:
 * eine Rangfolge über vier Stufen mit NULL-Bedeutung lässt sich in einer
 * Abfrage zwar schreiben, aber nicht ohne Datenbank prüfen, und genau das ist
 * die Fehlerklasse, die in diesem Muster schon mehrfach live aufgeschlagen
 * ist: rohes SQL, das kein Typprüfer und kein Test je ansieht.
 */
export function resolveCommission(
  rates: readonly CommissionRate[],
  query: {
    provider: CommissionProvider;
    accountRef: string | null;
    channel: CommissionChannel;
    /** Die Vorgabe aus der Umgebung, wenn keine Zeile passt. */
    fallbackBps: number;
  },
): CommissionDecision {
  const passend = rates.filter(
    (r) => r.provider === query.provider && istBrauchbar(r.feeBps),
  );

  const suche = (
    kontoBezug: 'DIESES' | 'ALLE',
    kanalBezug: 'DIESER' | 'ALLE',
  ): CommissionRate | undefined =>
    passend.find((r) => {
      const kontoPasst =
        kontoBezug === 'DIESES'
          ? r.accountRef !== null &&
            query.accountRef !== null &&
            r.accountRef === query.accountRef
          : r.accountRef === null;
      const kanalPasst = kanalBezug === 'DIESER' ? r.channel === query.channel : r.channel === null;
      return kontoPasst && kanalPasst;
    });

  const stufen: readonly [CommissionRate | undefined, CommissionSource][] = [
    [suche('DIESES', 'DIESER'), 'ACCOUNT_CHANNEL'],
    [suche('DIESES', 'ALLE'), 'ACCOUNT_DEFAULT'],
    [suche('ALLE', 'DIESER'), 'CHANNEL_DEFAULT'],
    [suche('ALLE', 'ALLE'), 'PLATFORM_DEFAULT'],
  ];

  for (const [zeile, quelle] of stufen) {
    if (zeile) return { feeBps: deckeln(zeile.feeBps), source: quelle };
  }

  return {
    feeBps: istBrauchbar(query.fallbackBps) ? deckeln(query.fallbackBps) : 0,
    source: 'ENV_FALLBACK',
  };
}

/**
 * Der Betrag in ganzen Cent, den Norns entnimmt.
 *
 * Abgerundet, nie negativ, nie grösser als der Kaufpreis. Die letzte Schranke
 * ist keine Zierde: eine Gebühr über dem Betrag würde der Anbieter ablehnen,
 * und zwar vor dem Kunden, nicht in einem Protokoll.
 *
 * Diese Rechnung ist bewusst hier und nicht bei einem Anbieter zuhause.
 * `stripe-connect.ts` ruft sie auf, statt sie zu besitzen.
 */
export function computeCommissionCents(amountCents: number, feeBps: number): number {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return 0;
  if (!istBrauchbar(feeBps)) return 0;
  const gebuehr = Math.floor((amountCents * deckeln(feeBps)) / 10_000);
  return Math.max(0, Math.min(gebuehr, amountCents));
}

function istBrauchbar(bps: number): boolean {
  return Number.isFinite(bps) && bps > 0;
}

function deckeln(bps: number): number {
  return Math.min(Math.floor(bps), MAX_FEE_BPS);
}

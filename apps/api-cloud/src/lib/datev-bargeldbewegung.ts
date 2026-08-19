/**
 * ════════════════════════════════════════════════════════════════════════
 *  Jede Bewegung der Lade bekommt eine DATEV-Zeile
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 05.08.2026 ───────────────────────────────────────────
 *
 * Gemessener Lauf 2026-06-01: eine Barausgabe über 50,00 EUR, Wechselgeld
 * 500,00, gezählt 350,00. Die DATEV-Datei hatte FÜNF Buchungszeilen, alle aus
 * Belegen, KEINE für die Bargeldbewegung. Konto 1000 bewegte sich um
 * −100,00 EUR, die Schublade um −150,00. Ein Prüfer, der die
 * Kassensturzfähigkeit rechnet, findet eine unerklärte Lücke von 50,00 EUR.
 *
 * ── WAS DIESE DATEI TUT, UND WAS SIE AUSDRÜCKLICH NICHT TUT ─────────────
 *
 * Sie bucht die Wege, deren Gegenkonto FESTSTEHT:
 *
 *   Entnahme zur Bank    Geldtransit an Kasse
 *   Entnahme zum Tresor  Geldtransit an Kasse
 *   Einlage              Kasse an Geldtransit
 *
 * „Geldtransit" ist für diese drei kein Auslegungsfall: das Geld hat die Lade
 * verlassen und ist noch nicht auf dem Bankauszug, genau dafür gibt es das
 * Konto. SKR03 1360, SKR04 1460, beide über den Kontenplan überschreibbar.
 *
 * ── ⚠️ WARUM BETRIEBSAUSGABEN HIER ABGEWIESEN WERDEN ────────────────────
 *
 * Eine Betriebsausgabe hat eine KATEGORIE (Miete, Werbung, Versand …), und
 * welches Aufwandskonto dazugehört, ist eine Entscheidung des Steuerberaters.
 * Für `SONSTIGES` gibt es überhaupt keine richtige Vorgabe.
 *
 * Diese Datei rät deshalb NICHT. Sie folgt der Regel, die `datev-kontierung.ts`
 * für unbekannte Zahlarten längst hat: lieber KEINE Datei als eine Zeile auf
 * einem falschen Konto. Ein falsches Aufwandskonto fällt beim Berater vielleicht
 * auf, vielleicht auch erst bei der Betriebsprüfung — und dann steht es seit
 * Monaten so da.
 *
 * Sobald der Händler je Kategorie ein Konto hinterlegt hat, bucht diese Datei
 * auch die Barausgaben. Bis dahin sagt sie, WELCHE Kategorie fehlt.
 */

import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import { type KontoId, type Kontenplan, konto } from './kontenrahmen.js';

export class BargeldbewegungNichtKontiertError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

/** Klartext je Bewegungsart, für den Buchungstext und für Fehlermeldungen. */
export const KLARTEXT_BEWEGUNG: Readonly<Record<string, string>> = {
  OPENING_FLOAT: 'Anfangsbestand',
  INJECTION: 'Einlage in die Kasse',
  BANK_DROP: 'Entnahme zur Bank',
  SAFE_TRANSIT: 'Entnahme in den Tresor',
  CLOSING_RECONCILIATION: 'Zählung beim Schichtschluss',
};

/**
 * Was eine Bewegungsart für DATEV bedeutet.
 *
 * `null` heisst AUSDRÜCKLICH: keine Buchung. Eine Art, die hier gar nicht
 * vorkommt, ist NICHT entschieden, und der Export bricht ab — dieselbe Regel
 * wie bei `kassenrechnung.ts`, aus demselben Grund.
 */
const BUCHUNG_JE_ART: Readonly<
  Record<string, { gegenkonto: 'geldtransit'; richtung: 'ausZahlung' | 'einZahlung' } | null>
> = {
  // Der Anfangsbestand ist der Endbestand des Vortages. Er wechselt kein
  // Konto, er steht nur schon da; eine Buchung wäre eine Verdoppelung.
  OPENING_FLOAT: null,
  INJECTION: { gegenkonto: 'geldtransit', richtung: 'einZahlung' },
  BANK_DROP: { gegenkonto: 'geldtransit', richtung: 'ausZahlung' },
  SAFE_TRANSIT: { gegenkonto: 'geldtransit', richtung: 'ausZahlung' },
  // Eine Aufzeichnung des gezählten Bestands, keine Bewegung.
  CLOSING_RECONCILIATION: null,
};

/** Nur für den Wächter: welche Arten hier entschieden sind. */
export const ENTSCHIEDENE_BEWEGUNGSARTEN: readonly string[] = Object.keys(BUCHUNG_JE_ART);

export interface BewegungFuerDatev {
  readonly direction: string;
  /** NUMERIC(18,2) als Zeichenkette, immer POSITIV gespeichert. */
  readonly amountEur: string;
  readonly reason: string;
  /** Kennung für Belegfeld 1, damit der Berater die Zeile wiederfindet. */
  readonly belegfeld: string;
}

export interface DatevBewegungszeile {
  /** Immer positiv; die Richtung steckt in Soll und Haben. */
  readonly betragEur: string;
  readonly sollkonto: string;
  readonly gegenkonto: string;
  readonly belegfeld1: string;
  readonly buchungstext: string;
}

/**
 * Baut die Buchungszeilen für die Bargeldbewegungen eines Tages.
 *
 * Wirft `BargeldbewegungNichtKontiertError`, wenn eine Art auftaucht, für die
 * hier keine Entscheidung steht. Das ist gewollt: der Export bricht ab, statt
 * still ein Konto zu erfinden.
 */
export function baueBewegungszeilen(
  bewegungen: readonly BewegungFuerDatev[],
  plan: Kontenplan,
): DatevBewegungszeile[] {
  const zeilen: DatevBewegungszeile[] = [];
  const kasse = konto(plan, 'kasse');
  const transit = konto(plan, 'geldtransit');

  for (const b of bewegungen) {
    if (!(b.direction in BUCHUNG_JE_ART)) {
      const name = KLARTEXT_BEWEGUNG[b.direction] ?? b.direction;
      throw new BargeldbewegungNichtKontiertError(
        `Für die Bargeldbewegung „${name}" ist keine Buchung hinterlegt, deshalb wurde ` +
          'KEINE DATEV-Datei erzeugt. Sie zu übergehen wäre falsch: das Konto Kasse ' +
          'bewegt sich dann in der Buchhaltung anders als die Schublade im Laden. ' +
          'Bitte lassen Sie sich von Ihrem Steuerberater die Buchung nennen.',
      );
    }
    const regel = BUCHUNG_JE_ART[b.direction];
    if (regel === null || regel === undefined) continue;

    // ⚠️ Soll und Haben, nicht ein Vorzeichen. DATEV führt die Richtung über
    // die beiden Konten; ein negativer Betrag mit vertauschten Konten wäre
    // dieselbe Buchung zweimal falsch geschrieben.
    const [soll, gegen] =
      regel.richtung === 'ausZahlung' ? [transit, kasse] : [kasse, transit];

    zeilen.push({
      betragEur: b.amountEur,
      sollkonto: soll,
      gegenkonto: gegen,
      belegfeld1: b.belegfeld,
      // Feld 14 fasst 60 Zeichen. Der Grund des Kassierers steht mit drin,
      // denn „Geldtransit" allein sagt dem Berater nicht, welcher.
      buchungstext: `${KLARTEXT_BEWEGUNG[b.direction] ?? b.direction}: ${b.reason}`.slice(0, 60),
    });
  }
  return zeilen;
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  Ausgabenart → Aufwandskonto
 * ════════════════════════════════════════════════════════════════════════
 *
 * Basel am 06.08.2026, wörtlich: „استخدم الارقام الافتراضية من الداتيف نفسه
 * والنموذج الصحيح الكامل ابحث بل انترنت وتاكد ان كل شي سليم" — nimm DATEVs
 * eigene Vorgabezahlen, such im Netz und stelle sicher, dass alles stimmt.
 *
 * Jede Zahl ist bei ECOVIS RTS belegt, derselben Quelle, aus der Kasse, Bank
 * und Geldtransit im Haus stammen. Die Herkunft jeder einzelnen steht in
 * `QUELLE` in `kontenrahmen.ts`, damit ein Berater sie nachprüfen kann.
 *
 * ⚠️ `WARENEINKAUF` bekommt KEIN eigenes Aufwandskonto. Dafür gibt es
 * `wareneingang` (SKR03 3200, SKR04 5200) seit jeher, und über das läuft
 * bereits der Ankauf. Zwei Konten für dieselbe Sache wären genau die
 * Hauskrankheit „zwei Listen driften".
 *
 * ⚠️ Eine Art, die hier FEHLT, bricht den Export ab. Wächst die Aufzählung
 * `expense_category` in der Datenbank, ohne dass jemand hier ein Konto
 * nachträgt, ist das ein lautes Nein statt einer stillen Fehlbuchung.
 */
const KONTO_JE_AUSGABENART: Readonly<Record<string, KontoId | undefined>> = {
  WARENEINKAUF: 'wareneingang',
  MIETE: 'aufwandMiete',
  MARKETING: 'aufwandWerbung',
  VERSAND: 'aufwandPorto',
  BUEROMATERIAL: 'aufwandBuerobedarf',
  REPARATUR: 'aufwandReparatur',
  GEBUEHREN: 'aufwandGebuehren',
  REISEKOSTEN: 'aufwandReise',
  SONSTIGES: 'aufwandSonstiges',
};

/**
 * Das Aufwandskonto einer Ausgabenart im gewaehlten Plan, oder null wenn die
 * Art kein Konto traegt. 18.08.2026 exportiert: der Fremdbeleg-Export (unbare
 * Ausgaben, routes/expenses.ts) bucht auf DIESELBEN Konten wie die
 * Barausgaben hier; zwei Zuordnungen drifteten sonst auseinander.
 */
export function aufwandskontoFuer(kategorie: string, plan: Kontenplan): string | null {
  const id = KONTO_JE_AUSGABENART[kategorie];
  return id === undefined ? null : konto(plan, id);
}

/** Nur für den Wächter: welche Ausgabenarten hier ein Konto haben. */
export const KONTIERTE_AUSGABENARTEN: readonly string[] = Object.keys(KONTO_JE_AUSGABENART);

/** Klartext je Ausgabenart, für den Buchungstext und für Fehlermeldungen. */
export const KLARTEXT_AUSGABENART: Readonly<Record<string, string>> = {
  WARENEINKAUF: 'Wareneinkauf',
  MIETE: 'Miete',
  MARKETING: 'Werbung',
  VERSAND: 'Porto und Versand',
  BUEROMATERIAL: 'Bürobedarf',
  REPARATUR: 'Reparatur',
  GEBUEHREN: 'Gebühren',
  REISEKOSTEN: 'Reisekosten',
  SONSTIGES: 'Sonstiges',
};

export interface BarausgabeFuerDatev {
  readonly kategorie: string;
  /** GANZE Cent, wie `operating_expenses.amount_cents` sie führt. */
  readonly betragCent: number;
  readonly notiz: string | null;
  readonly belegfeld: string;
}

/**
 * Baut die Buchungszeilen der BAR bezahlten Betriebsausgaben.
 *
 * Aufwandskonto an Kasse. Kein Buchungsschlüssel: die Vorsteuer einer
 * Barausgabe hängt am Beleg des Lieferanten, nicht an dieser Zeile, und ein
 * geratener Schlüssel wäre eine erfundene Vorsteuer.
 */
export function baueAusgabenzeilen(
  ausgaben: readonly BarausgabeFuerDatev[],
  plan: Kontenplan,
): DatevBewegungszeile[] {
  const offen = [
    ...new Set(ausgaben.map((a) => a.kategorie).filter((k) => KONTO_JE_AUSGABENART[k] === undefined)),
  ];
  if (offen.length > 0) {
    throw new BargeldbewegungNichtKontiertError(
      `Für ${offen.length === 1 ? 'die Ausgabenart' : 'die Ausgabenarten'} ` +
        `${offen.map((k) => `„${KLARTEXT_AUSGABENART[k] ?? k}"`).join(', ')} ist kein ` +
        'Aufwandskonto hinterlegt, deshalb wurde KEINE DATEV-Datei erzeugt. Ein ' +
        'geratenes Konto fällt beim Berater vielleicht auf, vielleicht auch erst bei ' +
        'der Betriebsprüfung — und dann steht es seit Monaten so da.',
    );
  }

  const kasse = konto(plan, 'kasse');
  return ausgaben.map((a) => {
    const id = KONTO_JE_AUSGABENART[a.kategorie] as KontoId;
    const name = KLARTEXT_AUSGABENART[a.kategorie] ?? a.kategorie;
    // ⚠️ Ganze Cent zu Euro OHNE Gleitkomma.
    const c = BigInt(Math.trunc(a.betragCent));
    const betrag = `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
    return {
      betragEur: betrag,
      sollkonto: konto(plan, id),
      gegenkonto: kasse,
      belegfeld1: a.belegfeld,
      buchungstext: `${name}${a.notiz ? `: ${a.notiz}` : ''}`.slice(0, 60),
    };
  });
}

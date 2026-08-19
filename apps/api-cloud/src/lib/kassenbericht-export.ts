/**
 * Kassenbericht CSV export — the daily cash report (KassenSichV) the owner /
 * Steuerberater / Finanzamt can download per closing.
 *
 * PURE + NO FACADE: this only RE-EXPRESSES a real `daily_closings` row as a
 * labelled, semicolon-delimited German CSV. It never recomputes a fiscal figure
 * and never invents one — a missing cash count says so in words, it does not
 * render as "0,00". Money stays a NUMERIC(18,2) string from the DB; we only
 * swap the decimal point for a German comma. CRLF line endings, like the DATEV
 * export.
 *
 * WHO READS THIS. A Betriebsprüfer, in German, on paper. That is why the tax
 * treatments and payment methods are spelled out here rather than shipped as
 * the raw enum: a report that says `MARGIN_25A` and `ZVT_CARD` is a machine
 * dump, and the reader has to be told what it means. It said exactly that
 * until 2026-07-22.
 *
 * ── DER ABSCHNITT „KASSE" SEIT 07.08.2026 ────────────────────────────────
 *
 * Er trug drei Zeilen (erwartet, gezählt, Differenz), ohne dass ein Prüfer sie
 * nachrechnen konnte (siehe Kopfkommentar von `kassenrechnung.ts`). Jetzt
 * kommt der Abschnitt aus `baueKassenrechnung`: Anfangsbestand, Bareinnahmen,
 * Barauszahlung Ankauf, Einlagen/Entnahmen, erwarteter und gezählter
 * Endbestand, Differenz — und, weicht die Rechnung vom festgeschriebenen
 * Abschluss ab, beide Zahlen nebeneinander.
 *
 * ⚠️ GEMESSENER BEFUND: `OPENING_FLOAT` landet HEUTE bei keiner Schicht als
 * `cash_movements`-Zeile — `POST /api/shifts/open` schreibt den Anfangsbestand
 * ausschliesslich auf `shifts.opening_float_eur`, nie in die Bewegungstabelle
 * (geprüft: kein Schreibpfad im ganzen Haus fügt je eine `OPENING_FLOAT`-Zeile
 * ein). Der Abschnitt „Kasse" zeigt deshalb für JEDEN Tag mit einem
 * Anfangsbestand einen Anfangsbestand von 0,00 EUR und eine „Abweichung zur
 * Rechnung oben", die genau diesem Anfangsbestand entspricht — nicht, weil in
 * der Lade wirklich Geld fehlt, sondern weil ihm die Rechnung nicht folgen
 * kann. Die BEIM ABSCHLUSS FESTGESCHRIEBENE Zahl (`cashExpectedEur`,
 * schicht-genau berechnet in `shifts.ts` MIT dem Anfangsbestand) steht
 * daneben und bleibt richtig. Behoben wäre die Lücke erst, wenn
 * `POST /api/shifts/open` selbst eine `OPENING_FLOAT`-Bewegung schriebe; das
 * ist hier NICHT geschehen, siehe den Bericht zu dieser Änderung.
 */

import { stringify } from 'csv-stringify/sync';

import { type Bargeldbewegung, type Kassenzeile, baueKassenrechnung } from './kassenrechnung.js';

/** The real closing figures, straight from the `daily_closings` row. */
export interface KassenberichtInput {
  businessDay: string; // YYYY-MM-DD
  state: 'COUNTING' | 'FINALIZED';
  verkaufCount: number;
  ankaufCount: number;
  stornoCount: number;
  grossVerkaufEur: string;
  grossAnkaufEur: string;
  netVerkaufEur: string;
  netAnkaufEur: string;
  /**
   * Stornierte Beträge, als POSITIVE Grösse (Wanderung 0112).
   *
   * `grossVerkaufEur` ist seither der Umsatz VOR Stornierung. Der Bericht
   * zeigt beide Zahlen und die Differenz, weil eine einzige Zahl nicht sagen
   * kann, ob storniert wurde.
   */
  stornoVerkaufEur: string;
  stornoAnkaufEur: string;
  /** 0148: Warenruecknahmen (Tz. 4.2.5), NEGATIV. Ausweisen, nicht verstecken. */
  rueckgabeVerkaufEur: string;
  rueckgabeCount: number;
  /** `{ tax_treatment_code: amount-string }`. */
  vatByTreatment: Record<string, string>;
  /** `{ payment_method: amount-string }`. */
  paymentsByMethod: Record<string, string>;
  /**
   * Alle `cash_movements` der Schichten, die an diesem Geschäftstag
   * geschlossen wurden — roh, ungefiltert. `baueKassenrechnung`
   * (`lib/kassenrechnung.ts`) entscheidet, welche Richtung die Lade bewegt;
   * diese Datei ordnet hier nichts mehr selbst ein.
   */
  bargeldbewegungen: readonly Bargeldbewegung[];
  /**
   * Barzahlungen von ANKAUF-Belegen dieses Tages, als POSITIVE Grösse. Die
   * Lade gibt sie ab; das Minuszeichen setzt `baueKassenrechnung` selbst.
   */
  /** Anfangsbestand der Lade, aus `shifts.opening_float_eur`. */
  anfangsbestandEur: string;
  /** BAR bezahlte Betriebsausgaben des Tages, positiv. */
  barausgabenEur: string;
  /** Wie viele Ausgaben des Tages keinen Zahlweg tragen. */
  ausgabenOhneZahlweg: number;
  barauszahlungAnkaufEur: string;
  cashExpectedEur: string | null;
  cashCountedEur: string | null;
  /**
   * Die beim Schichtschluss festgeschriebene Differenz (`blind_count_eur −
   * system_expected_eur`, siehe `shifts.ts`). Der Abschnitt „Kasse" zeigt
   * seit dem 07.08.2026 die EIGENE Differenz der Rechnung unten
   * (`baueKassenrechnung`), die den Anfangsbestand aus `cash_movements`
   * herleitet statt aus `shifts.opening_float_eur` — dort landet er heute
   * NIRGENDS als Bewegung (siehe der Befund im Kopfkommentar dieser Datei).
   * Dieses Feld bleibt erhalten, weil es die einzige Stelle ist, an der die
   * schicht-genaue, den wahren Anfangsbestand einschliessende Differenz
   * überhaupt noch steht.
   */
  cashVarianceEur: string | null;
  tseFinishedCount: number;
  tsePendingCount: number;
  tseFailedCount: number;
  finalizedAt: string | null; // ISO
}

/**
 * German names for the tax treatments.
 *
 * DELIBERATELY PINNED HERE, not imported from the app's UI vocabulary. This is
 * a fiscal document: if somebody rewords a label in the cashier interface for
 * readability, the wording on a tax report must not silently move with it. The
 * strings match `TAX_TREATMENT_LABEL` in `@norns/i18n-de` today; that is
 * a deliberate copy of about a dozen frozen legal terms, not an oversight.
 */
const TREATMENT_LABEL: Record<string, string> = {
  STANDARD_19: 'Regelsteuersatz 19 %',
  REDUCED_7: 'Ermäßigter Steuersatz 7 %',
  MARGIN_25A: 'Differenzbesteuerung § 25a UStG',
  INVESTMENT_GOLD_25C: 'Anlagegold, steuerfrei § 25c UStG',
  EXEMPT: 'Steuerfrei',
};

const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'Bar',
  ZVT_CARD: 'Kartenzahlung Terminal',
  SUMUP: 'SumUp',
  MOLLIE: 'Mollie',
  STRIPE: 'Stripe',
  // 26.07.2026: der Leser am Ladentisch — eigener unbarer Weg NEBEN dem
  // ZVT-Terminal, deshalb ein eigener, unterscheidbarer Klartext.
  STRIPE_TERMINAL: 'Kartenzahlung Stripe Terminal',
  EBAY: 'eBay',
  BANK_TRANSFER: 'Überweisung',
  VOUCHER: 'Gutschein',
};

/**
 * Name an enum for a human, and NEVER hide one we do not know: an unmapped code
 * is printed as-is with a marker, because a silently dropped or prettified tax
 * bucket is how a report starts lying.
 */
function label(map: Record<string, string>, code: string): string {
  return map[code] ?? `${code} (unbekannter Schlüssel)`;
}

/** "1234.50" → "1234,50 EUR"; null/empty → a word, never a fabricated 0. */
function eur(amount: string | null | undefined): string {
  if (amount == null || amount.trim().length === 0) return 'nicht gezählt';
  return `${amount.trim().replace('.', ',')} EUR`;
}

/** Eine NUMERIC(18,2)-Zeichenkette in ganze Cent, ohne Fliesskomma. */
function zuCents(raw: string): bigint {
  const t = raw.trim();
  if (t.length === 0) return 0n;
  const neg = t.startsWith('-');
  const [w, f = ''] = (neg ? t.slice(1) : t).split('.');
  const v = BigInt(w || '0') * 100n + BigInt((f + '00').slice(0, 2));
  return neg ? -v : v;
}

/** Ganze Cent zurück in die NUMERIC(18,2)-Schreibweise. */
function ausCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/** Sum a NUMERIC(18,2) map in integer cents, so the reader can check the total. */
function sumEur(m: Record<string, string>): string {
  let cents = 0n;
  for (const raw of Object.values(m)) cents += zuCents(raw);
  return ausCents(cents);
}

/**
 * Zwei Beträge in Cent voneinander abziehen.
 *
 * Kein Fliesskomma: 1234,30 minus 0,10 ergibt in `number` 1234,1999999…, und
 * ein Kassenbericht, der einen Cent daneben liegt, ist ein Kassenbericht, den
 * ein Prüfer nachrechnet und verwirft.
 */
function minusEur(a: string, b: string): string {
  return ausCents(zuCents(a) - zuCents(b));
}

/** Cent-genaue Addition — die Ruecknahme steht NEGATIV, plus ist richtig. */
function plusEur(a: string, b: string): string {
  return ausCents(zuCents(a) + zuCents(b));
}

/**
 * An ISO instant → German date and time in Europe/Berlin.
 *
 * The raw ISO string carried a `Z`, so a report finalised at 22:14 Berlin time
 * printed `20:14` UTC and looked like it belonged to the wrong day. A fiscal
 * document states local time.
 */
function berlinStamp(iso: string | null): string {
  if (iso == null || iso.trim().length === 0) return 'nicht abgeschlossen';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'nicht abgeschlossen';
  const f = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
  return `${f} Uhr (Ortszeit Berlin)`;
}

/** YYYY-MM-DD → DD.MM.YYYY, the way a German report writes a date. */
function germanDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

const STATE_LABEL: Record<KassenberichtInput['state'], string> = {
  FINALIZED: 'abgeschlossen',
  COUNTING: 'in Zählung',
};

export interface KassenberichtRow {
  label: string;
  value: string;
  /** A sum line: the printed page rules it off, the CSV does not care. */
  emphasis?: boolean;
}

export interface KassenberichtSection {
  title: string;
  rows: KassenberichtRow[];
}

/**
 * Eine Zeile aus `baueKassenrechnung` in die Sprache dieses Berichts
 * übersetzen: Komma statt Punkt, „EUR" dahinter — GENAU das, was `eur()` für
 * jede andere Zeile hier tut. Die Rechnung selbst liefert reines
 * NUMERIC(18,2) in Punktschreibweise, wie jede Geldsumme in dieser Datei vor
 * der Anzeige.
 *
 * ⚠️ Eine Ausnahme: „Gezählter Endbestand" ohne Zählung trägt in
 * `kassenrechnung.ts` mit Absicht ein „—" — diese Datei kennt die Hausschrift
 * nicht, die den Gedankenstrich in jedem gedruckten Text verbietet
 * (`kassenbericht-export.test.ts`, „the long dash is forbidden in any text
 * this shop prints"). Er wird hier durch dieselbe Formulierung ersetzt, die
 * `eur()` für eine fehlende Zählung ohnehin schon verwendet.
 */
function kassenzeile(z: Kassenzeile): KassenberichtRow {
  return {
    label: z.label,
    value: z.value === '—' ? 'nicht gezählt' : eur(z.value),
    ...(z.emphasis ? { emphasis: true } : {}),
  };
}

/**
 * The report as STRUCTURE, before it is a file.
 *
 * Both renderings read this: the CSV a Steuerberater imports and the A4 page a
 * Prüfer is handed at the counter. One source, so the printed sheet and the
 * imported file can never disagree about a figure or a label.
 */
export function buildKassenberichtRows(c: KassenberichtInput): KassenberichtSection[] {
  return [
    {
      title: 'Belege',
      rows: [
        { label: 'Verkäufe', value: String(c.verkaufCount) },
        { label: 'Ankäufe', value: String(c.ankaufCount) },
        { label: 'Stornos', value: String(c.stornoCount) },
        { label: 'Warenrücknahmen', value: String(c.rueckgabeCount) },
      ],
    },
    {
      title: 'Umsatz',
      rows: [
        { label: 'Verkauf brutto vor Storno', value: eur(c.grossVerkaufEur) },
        // ── Der Storno MIT Betrag, nicht nur als Anzahl ────────────────────
        // BFH, Urteil vom 29.07.2025, X R 23-24/21, Leitsatz 1: ein
        // Kassensystem, das Stornierungen zulässt und sie in den
        // Tagesabschlüssen nicht ausweist, begründet eine Schätzungsbefugnis.
        // Bis zum 26.07.2026 stand hier oben nur die Stückzahl, und der
        // Betrag steckte unsichtbar im Brutto.
        { label: 'davon storniert', value: eur(c.stornoVerkaufEur) },
        // 0148: die Ruecknahme steht NEGATIV in ihrer Spalte; als eigene
        // Zeile ausgewiesen (BFH X R 23-24/21 gilt fuer jede Minderung),
        // und die Schlusszeile rechnet sie mit ein — sonst ginge der Block
        // wieder nicht auf, die Falle von 26.07.
        { label: 'Warenrücknahmen', value: eur(c.rueckgabeVerkaufEur) },
        { label: 'Verkauf brutto nach Storno und Rücknahme',
          value: eur(plusEur(minusEur(c.grossVerkaufEur, c.stornoVerkaufEur), c.rueckgabeVerkaufEur)) },
        // ── DIE ZEILE, DIE DEN BLOCK AUFGEHEN LÄSST (26.07.2026) ───────────
        // Bis heute stand hier EINE Zeile „Verkauf netto" — die einzige des
        // Umsatzblocks ohne die Angabe vor oder nach Storno, während Brutto
        // beide Zahlen zeigt. Wer den Bericht las, konnte nicht nachrechnen:
        //
        //     Verkauf netto           366 906,1  ← vor Storno
        //     Umsatzsteuer Summe        95,64    ← NACH Storno (§ 17 UStG)
        //     Verkauf brutto nach Storno 3 758,24
        //
        // Netto plus Steuer ergab nicht das Brutto darunter, und die Differenz
        // war unerklärt. Beide Zahlen waren für sich richtig, sie standen nur
        // auf verschiedenen Grundlagen und sagten es nicht.
        //
        // Am Kreuzprobetag gemessen: 366260 + 9564 = 375824 Cent. Die Zeile
        // geht jetzt auf, und zwar auf derselben Grundlage wie DATEV, wie
        // `bon_kopf.csv` und wie der Kopf des DSFinV-K-Bündels.
        //
        // Gerechnet, NICHT gespeichert: Wanderung 0112 gab dem Storno nur
        // Bruttospalten. Das Netto nach Storno ist Brutto nach Storno minus
        // Umsatzsteuer, und diese Steuer ist bereits die nach Storno.
        { label: 'Verkauf netto vor Storno', value: eur(c.netVerkaufEur) },
        {
          label: 'Verkauf netto nach Storno',
          value: eur(
            minusEur(minusEur(c.grossVerkaufEur, c.stornoVerkaufEur), sumEur(c.vatByTreatment)),
          ),
        },
        { label: 'Ankauf brutto vor Storno', value: eur(c.grossAnkaufEur) },
        { label: 'davon storniert', value: eur(c.stornoAnkaufEur) },
        { label: 'Ankauf brutto nach Storno', value: eur(minusEur(c.grossAnkaufEur, c.stornoAnkaufEur)) },
        // Der Ankauf trägt keine Ausgangsumsatzsteuer, deshalb ist sein Netto
        // gleich seinem Brutto — die Zeile bleibt einzeln und heisst so.
        { label: 'Ankauf netto vor Storno', value: eur(c.netAnkaufEur) },
      ],
    },
    {
      title: 'Umsatzsteuer',
      rows: [
        ...Object.entries(c.vatByTreatment).map(([code, amt]) => ({
          label: label(TREATMENT_LABEL, code),
          value: eur(amt),
        })),
        // The check total: a reader adds the rows above and must land here.
        { label: 'Summe', value: eur(sumEur(c.vatByTreatment)), emphasis: true },
      ],
    },
    {
      title: 'Zahlungsart',
      rows: [
        ...Object.entries(c.paymentsByMethod).map(([method, amt]) => ({
          label: label(PAYMENT_LABEL, method),
          value: eur(amt),
        })),
        { label: 'Summe', value: eur(sumEur(c.paymentsByMethod)), emphasis: true },
      ],
    },
    {
      title: 'Kasse',
      // ── Die Rechnung, die ein Prüfer nachrechnen kann (07.08.2026) ────────
      // Bis heute standen hier drei Zeilen — erwartet, gezählt, Differenz —,
      // ohne dass Anfangsbestand, Barankauf, Einlagen oder Entnahmen je
      // auftauchten. `baueKassenrechnung` (`lib/kassenrechnung.ts`) ersetzt
      // das durch die fortschreibende Form aus AEAO zu § 146 Nr. 3.3; siehe
      // den Kopfkommentar dieser Datei für den gemessenen Befund zum
      // Anfangsbestand.
      rows: baueKassenrechnung({
        // `paymentsByMethod['CASH']` ist NUR die Verkaufsseite — siehe
        // `closings-finalize.ts` (`WHERE ... AND t.direction = 'VERKAUF'`).
        // Fehlt der Schlüssel (kein Barverkauf an diesem Tag), ist 0,00 EUR
        // der WAHRE Wert, keine Lücke.
        bareinnahmenEur: c.paymentsByMethod['CASH'] ?? '0.00',
        anfangsbestandEur: c.anfangsbestandEur,
      barausgabenEur: c.barausgabenEur,
      ausgabenOhneZahlweg: c.ausgabenOhneZahlweg,
      barauszahlungAnkaufEur: c.barauszahlungAnkaufEur,
        bewegungen: c.bargeldbewegungen,
        gebuchtErwartetEur: c.cashExpectedEur,
        gezaehltEur: c.cashCountedEur,
      }).zeilen.map(kassenzeile),
    },
    {
      title: 'TSE',
      rows: [
        { label: 'Signiert', value: String(c.tseFinishedCount) },
        { label: 'Ausstehend', value: String(c.tsePendingCount) },
        { label: 'Fehlgeschlagen', value: String(c.tseFailedCount) },
      ],
    },
    {
      title: 'Abschluss',
      rows: [
        { label: 'Status', value: STATE_LABEL[c.state] },
        { label: 'Finalisiert am', value: berlinStamp(c.finalizedAt) },
      ],
    },
  ];
}

/**
 * Build the Kassenbericht CSV. Line 1 is the title + business day; the rest are
 * `Abschnitt;Feld;Wert` rows. Unquoted unless a value needs it (csv-stringify
 * quotes-as-needed), so the output stays human-readable.
 */
export function buildKassenberichtCsv(c: KassenberichtInput): string {
  const rows: string[][] = [
    ['Kassenbericht', germanDay(c.businessDay)],
    ['Status', STATE_LABEL[c.state]],
  ];
  for (const section of buildKassenberichtRows(c)) {
    rows.push([]);
    for (const r of section.rows) rows.push([section.title, r.label, r.value]);
  }

  return stringify(rows, { delimiter: ';', record_delimiter: '\r\n' });
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER BETRAG MUSS ZUM STEUERSCHLÜSSEL PASSEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der § 13b-Riegel prüft ein WORT. Er feuert auf die Zeichenkette
 * `REVERSE_CHARGE_13B` und sonst auf nichts.
 *
 * Am 26.07.2026 nachgesehen: es gab weder ein CHECK noch einen Trigger noch
 * eine Zeile in `validateTransactionMath`, die `vat_eur` an den Steuerschlüssel
 * oder an `applied_vat_rate` bindet. Der Anfragerumpf erklärt die Beträge
 * selbst, und geprüft wurde nur, dass Kopf und Zeilen zueinander passen.
 *
 * **Wer 19 Prozent sparen wollte, sendete also nicht § 13b, sondern:**
 *
 *     taxTreatmentCode: "STANDARD_19",  appliedVatRate: "0.1900",
 *     lineSubtotalEur: "100.00",        lineVatEur: "0.00",
 *     lineTotalEur: "100.00"
 *
 * Kopf und Zeilen stimmen überein, die Summe geht auf, der neue Riegel feuert
 * nie. Der Riegel schloss eine von mindestens drei Türen zum selben Raum, und
 * ausgerechnet die einzige, die einen Kunden verlangt.
 *
 * ── An der Produktion gemessen, bevor die Regel geschrieben wurde ────────
 *
 * Eine Regel, die man sich ausdenkt, bricht an echten Daten. Also erst zählen:
 *
 *     MARGIN_25A           Satz NULL   63 Zeilen   wirksam 0,0000 bis 0,1908
 *     STANDARD_19          Satz 0,19   26 Zeilen   wirksam 0,1899 bis 0,1901
 *     INVESTMENT_GOLD_25C  Satz NULL    3 Zeilen   wirksam 0,0000
 *
 * Drei Erkenntnisse daraus, und jede formt die Regel:
 *
 *   1. Bei `MARGIN_25A` liegt die Steuer auf der MARGE, nicht auf dem Entgelt.
 *      Das Verhältnis zum Zwischenbetrag schwankt deshalb über die ganze
 *      Spanne. Eine Regel „Steuer = Entgelt × Satz" wäre hier sofort falsch,
 *      und zwar bei 63 von 92 Zeilen.
 *   2. Bei `STANDARD_19` schwankt der wirksame Satz um ±0,0001 — Rundung je
 *      Zeile. Ohne Toleranz stünde ein legitimer Verkauf still.
 *   3. Zwei `STANDARD_19`-Zeilen tragen NULL Steuer. Nachgesehen: beide haben
 *      einen Zwischenbetrag von 0,00 EUR. **Die Tür war offen, aber niemand
 *      ist hindurchgegangen.** Ohne diese Messung hätte die Regel entweder
 *      zwei echte Belege für ungültig erklärt oder aus Vorsicht eine Ausnahme
 *      bekommen, die die Tür offen gelassen hätte.
 */

import { Money, type Steuersatzart, satzAm } from '@norns/domain';

/** Was zu welchem Schlüssel gehört. `null` heisst: kein Satz auf dem Entgelt. */
/**
 * Welcher Satz zu welchem Schlüssel gehört — als ART, nicht als Zahl.
 *
 * ── DER BEFUND VOM 20.08.2026 (Basels Prüfbericht) ────────────────────────
 *
 * Hier standen die Zahlen `'0.1900'` und `'0.0700'` fest im Quelltext. Am Tag
 * einer Gesetzesänderung wäre das ein Betriebsstillstand mit zwei Ausgängen,
 * und beide falsch:
 *
 *   • Zieht man die Zahl auf den neuen Satz, weist diese Prüfung ab sofort
 *     jeden Beleg ab, der noch mit dem alten gebucht wird.
 *   • Lässt man sie stehen, kann die Kasse den neuen Satz nicht buchen.
 *
 * Die Zuordnung Schlüssel → ART bleibt für immer richtig (`STANDARD_19` ist
 * der Regelsatz des § 12 Abs. 1 UStG, egal welche Zahl der gerade trägt).
 * Welche ZAHL das an einem Tag bedeutet, sagt `@norns/domain`.
 *
 * ⚠️ Die Zahl im NAMEN bleibt, obwohl sie irreführen kann. Der Name steht in
 * jeder gebuchten Zeile, in der DSFinV-K-Ausfuhr und im DATEV-Stapel; ihn zu
 * ändern hiesse, die Bücher umzuschreiben.
 */
const ART_JE_SCHLUESSEL: Record<string, Steuersatzart | 'OHNE' | null> = {
  STANDARD_19: 'REGEL',
  REDUCED_7: 'ERMAESSIGT',
  // Die Steuerschuld geht auf den Leistungsempfänger über. Der Verkäufer weist
  // nichts aus, also muss der Betrag null sein.
  REVERSE_CHARGE_13B: 'OHNE',
  // Sonderregelungen: die Steuer liegt nicht auf dem Entgelt. Der Satz gehört
  // deshalb auf `null`, und der Betrag wird hier nicht gegen das Entgelt
  // gerechnet — bei § 25a liegt er auf der Marge.
  MARGIN_25A: null,
  INVESTMENT_GOLD_25C: null,
  // Ein gemischter Beleg wird je ZEILE aufgelöst; auf Zeilenebene darf er nicht
  // stehen. Der Kopf darf ihn tragen.
  MIXED: null,
};

export interface Steuerbefund {
  field: string;
  message: string;
  expected: string;
  actual: string;
}

export interface Steuerzeile {
  appliedTaxTreatmentCode?: string | null;
  appliedVatRate?: string | null;
  lineSubtotalEur: string;
  lineVatEur: string;
}

/**
 * Zwei Cent Spielraum je Zeile — und ein enger Riegel je BELEG darunter.
 *
 * ── WARUM ES ERST EINER WAR, UND WARUM DAS EINEN VERKAUF STILLSTELLTE ─────
 *
 * Die Kasse rundet die Umsatzsteuer EINMAL je Beleg und Satz und verteilt sie
 * danach nach grössten Resten auf die Zeilen. Das ist keine Bequemlichkeit,
 * sondern § 14 Abs. 4 Nr. 8 UStG: der Steuerbetrag gehört zur RECHNUNG, je
 * Steuersatz. Die Zeilenaufteilung ist eine Aufgliederung davon.
 *
 * Die Verteilung verschiebt dabei eine einzelne Zeile. Am 07.08.2026 über
 * 571.897 Zwei-Zeilen-Belege von 1,00 bis 500,00 EUR gemessen: **1.793
 * abgewiesen, 0,314 %** — etwa jeder 320. Beleg. Der erste Fall:
 *
 *     1,28 EUR + 38,84 EUR, beide 19 %
 *     → Zeile 2: Entgelt 32,63  Steuer 6,21  ·  32,63 × 0,19 = 6,1997
 *
 * Der Kassierer bekam „passt nicht zu STANDARD_19", die Meldung nannte
 * „erwartet 6,20", und hatte keinen Weg daran vorbei.
 *
 * ── DIE GRENZE STAMMT AUS DER MESSUNG ────────────────────────────────────
 *
 * Über 2 bis 40 Zeilen, Beträge von 0,01 bis 500,00 EUR, für 19 % und 7 %:
 * die Verteilung verschiebt eine Zeile NIEMALS um mehr als einen ganzen Cent
 * gegen `round(Entgelt × Satz)`. Zwei Cent sind also die gemessene Grenze mit
 * einem Cent Luft.
 *
 * ⚠️ Und weil zwei Cent je Zeile, über zwanzig Zeilen verteilt, 0,40 EUR
 * verschwundene Steuer wären, gibt es dafür `pruefeSteuerJeBeleg`. Der misst
 * die Zahl, die im Gesetz steht, und lässt genau einen Cent Rundung.
 */
const TOLERANZ_CENT = Money.of('0.02');

/** Ein Cent Rundung je Beleg und Satz — mehr entsteht beim Runden nicht. */
const TOLERANZ_BELEG = Money.of('0.01');

/**
 * Der Satz, den ein Schlüssel AN DIESEM TAG verlangt.
 *
 * `undefined` = unbekannter Schlüssel (das Schema fängt ihn).
 * `null`      = Sonderregelung, die Steuer liegt nicht auf dem Entgelt.
 */
function satzFuerSchluessel(schluessel: string, tag: string): string | null | undefined {
  const art = ART_JE_SCHLUESSEL[schluessel];
  if (art === undefined) return undefined;
  if (art === null) return null;
  if (art === 'OHNE') return '0.0000';
  return satzAm(art, tag);
}

/**
 * Passt der ausgewiesene Betrag zum Schlüssel und zum Satz?
 *
 * `null` heisst: in Ordnung. Rein, ohne Uhr, Netz oder Datenbank.
 */
export function pruefeSteuerbetrag(
  zeile: Steuerzeile,
  index: number,
  tag: string,
): Steuerbefund | null {
  const schluessel = zeile.appliedTaxTreatmentCode ?? null;
  if (schluessel == null) return null; // ältere Aufrufer ohne Zeilenschlüssel

  const erwarteterSatz = satzFuerSchluessel(schluessel, tag);
  if (erwarteterSatz === undefined) return null; // unbekannter Schlüssel: das Schema fängt ihn

  const satz = zeile.appliedVatRate ?? null;

  // ── 1. Der Satz muss zum Schlüssel gehören ──────────────────────────────
  if (erwarteterSatz === null) {
    if (satz !== null && !Money.of(satz).equals(Money.of('0'))) {
      return {
        field: `items[${index}].appliedVatRate`,
        message: `${schluessel} traegt keinen Steuersatz auf das Entgelt`,
        expected: 'null',
        actual: satz,
      };
    }
    // ── 1b. Kein Satz heisst NICHT: kein Betrag (19.08.2026) ──────────────
    //
    // Bis heute endete die Prüfung hier. „Der Satz liegt nicht auf dem
    // Entgelt" wurde behandelt als „über den Betrag lässt sich nichts sagen".
    // Für § 25a stimmt das — dort rechnet `marge-nachrechnen.ts` nach.
    //
    // Für die beiden anderen Schlüssel stimmt es nicht:
    //
    //   INVESTMENT_GOLD_25C  Anlagegold ist nach § 25c Abs. 1 UStG STEUERFREI.
    //                        Da gibt es keine Marge, auf der eine Steuer
    //                        liegen könnte — der Betrag MUSS null sein. Wird
    //                        auf einer steuerfreien Lieferung trotzdem Steuer
    //                        ausgewiesen, schuldet der Händler sie nach
    //                        § 14c Abs. 1 UStG, ohne sie je kassiert zu haben.
    //
    //   MIXED                Gehört nach dem Kommentar oben ausdrücklich NICHT
    //                        auf eine Zeile, nur auf den Kopf. Nur stand das
    //                        bis heute allein im Kommentar: das Schema liess
    //                        ihn auf der Zeile zu, und dort war er der einzige
    //                        Schlüssel ohne jede Betragsprüfung. Eine Zeile
    //                        über 1.000,00 EUR mit 0,00 Steuer ging glatt
    //                        durch — 159,66 EUR, die niemand je bemerkt.
    //
    // ⚠️ Erwähnung ist nicht Gebrauch. Eine Regel, die nur als Satz im
    // Kommentar steht, ist keine Regel.
    if (schluessel === 'MIXED') {
      return {
        field: `items[${index}].appliedTaxTreatmentCode`,
        message:
          'MIXED beschreibt einen Beleg mit mehreren Steuerarten und gehört auf den Kopf. ' +
          'Jede Zeile trägt ihren eigenen Schlüssel.',
        expected: 'ein Zeilenschlüssel (z. B. STANDARD_19, MARGIN_25A)',
        actual: 'MIXED',
      };
    }

    if (schluessel === 'INVESTMENT_GOLD_25C') {
      const betrag = Money.of(zeile.lineVatEur);
      if (!betrag.equals(Money.of('0'))) {
        return {
          field: `items[${index}].lineVatEur`,
          message:
            'Anlagegold ist nach § 25c Abs. 1 UStG steuerfrei; auf dieser Zeile darf keine ' +
            'Steuer stehen. Ausgewiesene Steuer wird nach § 14c Abs. 1 UStG geschuldet.',
          expected: '0.00',
          actual: zeile.lineVatEur,
        };
      }
    }

    // § 25a bleibt: die Steuer liegt auf der Marge, nicht auf dem Entgelt.
    // Ob sie stimmt, rechnet `marge-nachrechnen.ts` aus dem hinterlegten
    // Einkaufspreis nach — hier fehlt dafür die Bestandszeile.
    return null;
  }

  if (satz === null || !Money.of(satz).equals(Money.of(erwarteterSatz))) {
    return {
      field: `items[${index}].appliedVatRate`,
      message: `${schluessel} verlangt den Satz ${erwarteterSatz}`,
      expected: erwarteterSatz,
      actual: satz ?? 'null',
    };
  }

  // ── 2. ⚠️ DER EIGENTLICHE RIEGEL: der BETRAG muss zum Satz passen ───────
  //
  // Ohne diese Zeilen konnte man `STANDARD_19` mit Satz 0,19 und Steuer 0,00
  // senden. Alles stimmte formal überein, und der § 13b-Riegel feuerte nie.
  //
  // ⚠️ `.round()` ist kein Schönheitsgriff. Ohne ihn stand in der Meldung
  // „erwartet 6,20" und verglichen wurde gegen 6,1997 — die genannte Zahl war
  // nicht die gemessene. Ein Kassierer sah einen Cent Unterschied und eine
  // Abweisung. Jetzt ist die genannte Zahl die gemessene.
  const entgelt = Money.of(zeile.lineSubtotalEur);
  const erwartet = entgelt.multiply(erwarteterSatz).round();
  const tatsaechlich = Money.of(zeile.lineVatEur);
  const abweichung = tatsaechlich.subtract(erwartet).abs();

  if (abweichung.greaterThan(TOLERANZ_CENT)) {
    return {
      field: `items[${index}].lineVatEur`,
      message: `Der ausgewiesene Steuerbetrag passt nicht zu ${schluessel} (${erwarteterSatz})`,
      expected: erwartet.toString(),
      actual: tatsaechlich.toString(),
    };
  }

  return null;
}

/**
 * ⚠️ DER MASSGEBLICHE RIEGEL: die Steuer des ganzen BELEGS, je Steuersatz.
 *
 * § 14 Abs. 4 Nr. 8 UStG verlangt den Steuerbetrag für die RECHNUNG, je
 * Steuersatz — nicht je Position. Die Zeilenaufteilung ist eine Aufgliederung
 * davon, und genau deshalb rundet die Kasse einmal je Beleg und verteilt.
 *
 * Hier wird deshalb dieselbe Zahl gemessen, die das Gesetz meint, und nur ein
 * Cent Rundung gelassen. Das schliesst die Tür, die der weichere Zeilenriegel
 * offenlässt: zwei Cent je Zeile, über zwanzig Zeilen verteilt, wären 0,40 EUR
 * verschwundene Steuer je Beleg.
 *
 * Sonderregelungen (§ 25a, § 25c) bleiben aussen vor: dort liegt die Steuer
 * auf der MARGE, nicht auf dem Entgelt. Eine Rechnung gegen das Entgelt wäre
 * dort immer falsch — auf Romans Produktion gemessen bei 63 von 92 Zeilen.
 * Ihre Richtigkeit prüft `validateTransactionMath` über `marginEur`.
 *
 * `null` heisst: in Ordnung. Rein, ohne Uhr, Netz oder Datenbank.
 */
export function pruefeSteuerJeBeleg(
  zeilen: readonly Steuerzeile[],
  tag: string,
): Steuerbefund | null {
  /** Je Steuerschlüssel: Summe der Entgelte und Summe der ausgewiesenen Steuer. */
  const gruppen = new Map<string, { entgelt: Money; steuer: Money }>();

  for (const zeile of zeilen) {
    const schluessel = zeile.appliedTaxTreatmentCode ?? null;
    if (schluessel == null) continue; // ältere Aufrufer ohne Zeilenschlüssel
    const satz = satzFuerSchluessel(schluessel, tag);
    // `undefined` = unbekannter Schlüssel (das Schema fängt ihn).
    // `null` = die Steuer liegt nicht auf dem Entgelt.
    if (satz === undefined || satz === null) continue;

    const bisher = gruppen.get(schluessel) ?? { entgelt: Money.of('0'), steuer: Money.of('0') };
    gruppen.set(schluessel, {
      entgelt: bisher.entgelt.add(Money.of(zeile.lineSubtotalEur)),
      steuer: bisher.steuer.add(Money.of(zeile.lineVatEur)),
    });
  }

  // Deterministische Reihenfolge: sonst hinge bei zwei fehlerhaften Sätzen die
  // gemeldete Zeile an der Reihenfolge der Eingabe.
  for (const schluessel of [...gruppen.keys()].sort()) {
    const { entgelt, steuer } = gruppen.get(schluessel) as { entgelt: Money; steuer: Money };
    const satz = satzFuerSchluessel(schluessel, tag) as string;
    const erwartet = entgelt.multiply(satz).round();
    if (steuer.subtract(erwartet).abs().greaterThan(TOLERANZ_BELEG)) {
      return {
        field: 'vatEur',
        message:
          `Die Umsatzsteuer des Belegs passt nicht zu ${schluessel} (${satz}). ` +
          `Entgelt ${entgelt.toString()} EUR verlangt ${erwartet.toString()} EUR Steuer.`,
        expected: erwartet.toString(),
        actual: steuer.toString(),
      };
    }
  }

  return null;
}

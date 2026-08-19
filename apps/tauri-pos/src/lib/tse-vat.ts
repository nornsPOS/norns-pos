/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  tse-vat — der Steuersatz-NAME, den die TSE signiert
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ──────────────────────────────────────────────
 *
 * Diese Datei hiess bis heute `computeAmountsPerVatId` und lieferte den
 * DSFinV-K-Schlüssel ID_UST als ZAHL (1, 2, 5, 7). Gegen die LIVE-Spezifikation
 * gemessen (`GET https://kassensichv.fiskaly.com/api/v2/_spec.json`, HTTP 200,
 * 251 KB) kommt die Zeichenkette `vat_id` darin **null Mal** vor.
 *
 * Das Feld heisst `amounts_per_vat_rate`, es ist ein PFLICHTFELD, und sein
 * Inhalt ist laut Spezifikation das DSFinV-K-Feld `UST_SATZ` — also der SATZ,
 * nicht der Schlüssel. Erlaubt sind genau fünf Namen:
 *
 *     NORMAL          19,00 %
 *     REDUCED_1        7,00 %
 *     SPECIAL_RATE_1  10,70 %   (§ 24 Abs. 1 Nr. 3 UStG)
 *     SPECIAL_RATE_2   5,50 %   (§ 24 Abs. 1 Nr. 1 UStG)
 *     NULL             0,00 %
 *
 * ── ⚠️ § 25a IN DIESER LISTE: BEANTWORTET AM 19.08.2026 ────────────────────
 *
 * Für die Differenzbesteuerung nach § 25a UStG gibt es keinen EIGENEN dieser
 * Namen — die Spezifikation kennt „25a", „Differenz" und „margin" an keiner
 * Stelle. Bis zum 19.08.2026 lieferte `vatRateName` deshalb `null` („nicht
 * raten"), und der Aufrufer liess die Zeilen still weg: signiert wurde
 * `0.00 ... ^ 1000.00:Bar` — null Umsatz gegen volle Zahlung, auf ~87 % der
 * Belege dieses Ladens.
 *
 * Das war die falsche Vorsicht, denn die Frage war im Haus längst
 * beantwortet: Anlage 2 zur DSFinV-K (zitiert in `dsfinvk-schluessel.ts`)
 * definiert für den SIGNATURcontainer Container 5 = „0 %", ausdrücklich fuer
 * nicht steuerbare UND steuerfreie Umsätze — und bei § 25a liegt auf dem
 * ENTGELT kein offener Satz (§ 14a Abs. 6 Satz 2 UStG verbietet den Ausweis
 * sogar). Anhang I S. 116 verlangt Summengleichheit von Umsätzen und
 * Zahlungen; das Weglassen war die einzige klar verbotene Gestalt.
 *
 * GETRENNT davon bleibt der DSFinV-K-`UST_SCHLUESSEL` (Nummer ab 1000) eine
 * Entscheidung des Steuerberaters — die Ausfuhr lässt `UST_SATZ` dort weiter
 * bewusst LEER („LEER statt falsch", `dsfinvk-daten.ts`). Zwei Felder, zwei
 * Fragen; nur die Signaturfrage ist hier entschieden.
 */
import type { TaxTreatmentCode } from '@norns/api-client';

/** Die fünf Namen, die die Spezifikation am 08.08.2026 zulässt. */
export const ERLAUBTE_SATZNAMEN = [
  'NORMAL',
  'REDUCED_1',
  'SPECIAL_RATE_1',
  'SPECIAL_RATE_2',
  'NULL',
] as const;

export type VatRateName = (typeof ERLAUBTE_SATZNAMEN)[number];

/**
 * Steuerbehandlung → `vat_rate`, oder `null`, wenn der Name nicht entschieden
 * ist. `null` ist ausdrücklich NICHT `'NULL'`.
 */
const SATZNAME: Readonly<Record<TaxTreatmentCode, VatRateName | null>> = {
  STANDARD_19: 'NORMAL',
  REDUCED_7: 'REDUCED_1',
  // § 25c UStG: Anlagegold ist steuerfrei, der Satz auf das Entgelt ist 0.
  INVESTMENT_GOLD_25C: 'NULL',
  /*
   * ── 19.08.2026: die offene Frage IST beantwortet, und zwar im Haus ──────
   *
   * Hier stand `null` („nicht raten"), und das hatte eine messbare Folge:
   * bei einem reinen Margenverkauf über 1.000 EUR bar signierte die TSE
   * `Beleg^0.00_0.00_0.00_0.00_0.00^1000.00:Bar` — NULL erklärter Umsatz
   * gegen 1.000 EUR Zahlung, unauslöschlich, auf rund 87 Prozent aller
   * Belege dieses Hauses (gemessen in beleg-steuerausweis.ts). Anhang I
   * der DSFinV-K 2.4, S. 116: „Grundsätzlich müssen die Summen der Umsätze
   * mit denen der Zahlungen übereinstimmen." Das WEGLASSEN ist die einzige
   * klar verbotene Gestalt — genau die, die hier stand.
   *
   * Die Antwort stand längst in der eigenen Recherche
   * (`dsfinvk-schluessel.ts`, Anlage 2 zur DSFinV-K, Stand 05.12.2024):
   * für den SIGNATURcontainer der TSE („Kassenbeleg-V1", Anhang I) gilt
   * Container 5 = „0 % (umfasst nicht steuerbare UND umsatzsteuerfreie
   * Umsätze)". Bei § 25a liegt die Steuer auf der MARGE, nicht auf dem
   * Entgelt — auf dem Entgelt ist der offene Satz 0, und § 14a Abs. 6
   * Satz 2 UStG VERBIETET sogar den offenen Ausweis. Das Brutto gehört
   * also in den 0-Prozent-Container; fiskaly nennt ihn `NULL`.
   *
   * ⚠️ Verwechslungsgefahr, die das Haus schon einmal dokumentiert hat:
   * das hier ist der SIGNATURcontainer. Der DSFinV-K-`UST_SCHLUESSEL`
   * (Nummer ab 1000, vom Steuerberater zu vergeben) bleibt davon
   * unberührt und bleibt offen, bis die Kanzlei ihn nennt.
   */
  MARGIN_25A: 'NULL',
  // Die Steuerschuld geht über, der Verkäufer weist nichts aus.
  REVERSE_CHARGE_13B: 'NULL',
  // Ein gemischter Beleg wird je ZEILE aufgelöst; auf Zeilenebene steht MIXED
  // nie. Käme er doch, wäre jeder Satz geraten.
  MIXED: null,
};

/** Der `vat_rate`-Name für eine Steuerbehandlung, oder `null` wenn offen. */
export function vatRateName(code: TaxTreatmentCode): VatRateName | null {
  return SATZNAME[code] ?? null;
}

export interface VatAmount {
  /** fiskaly `vat_rate` (DSFinV-K `UST_SATZ`). */
  vatRate: VatRateName;
  /** BRUTTO-Betrag für diesen Satz, in ganzen Cent. Vorzeichenbehaftet. */
  amountCents: number;
}

export interface VatBreakdownLine {
  appliedTaxTreatmentCode: TaxTreatmentCode;
  /** BRUTTO-Zeilensumme in ganzen Cent. Beim Storno negativ. */
  lineTotalCents: number;
}

export interface VatBreakdown {
  /** Die Eimer, die signiert werden können. */
  buckets: VatAmount[];
  /**
   * Behandlungen, für die kein `vat_rate` entschieden ist. Ist diese Liste
   * nicht leer, fehlt dem signierten Rumpf ein Teil des Umsatzes — der
   * Aufrufer muss das MELDEN und darf es nicht überdecken.
   */
  ohneSatznamen: TaxTreatmentCode[];
}

/**
 * Die Zeilen eines Belegs je Steuersatz gruppieren und den Bruttobetrag
 * summieren — das `amounts_per_vat_rate`, das die TSE signiert.
 *
 * Rein: keine Uhr, kein Netz. Nach Namen sortiert, damit der signierte Rumpf
 * bei gleicher Eingabe Byte für Byte gleich bleibt.
 */
export function computeAmountsPerVatRate(
  lines: ReadonlyArray<VatBreakdownLine>,
): VatBreakdown {
  const proSatz = new Map<VatRateName, number>();
  const offen = new Set<TaxTreatmentCode>();

  for (const line of lines) {
    const name = vatRateName(line.appliedTaxTreatmentCode);
    if (name === null) {
      offen.add(line.appliedTaxTreatmentCode);
      continue;
    }
    proSatz.set(name, (proSatz.get(name) ?? 0) + line.lineTotalCents);
  }

  return {
    buckets: [...proSatz.entries()]
      .map(([vatRate, amountCents]) => ({ vatRate, amountCents }))
      .sort((a, b) => ERLAUBTE_SATZNAMEN.indexOf(a.vatRate) - ERLAUBTE_SATZNAMEN.indexOf(b.vatRate)),
    ohneSatznamen: [...offen].sort(),
  };
}

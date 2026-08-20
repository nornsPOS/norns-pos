/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Die Rechtshinweise, die auf den Beleg gedruckt werden
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── ZWEI GRÜNDE, WARUM SIE HIER STEHEN ─────────────────────────────────────
 *
 * 1. Basel, mehrfach: „nicht die Welt ineinanderstopfen." Sie wohnten in
 *    `BezahlenDialog.tsx` — einer Datei mit 4018 Zeilen.
 *
 * 2. ⛔ DER BEFUND BEIM AUSBAUEN (20.08.2026): sie nannten den Steuersatz als
 *    FESTEN TEXT.
 *
 *        'Im Preis ist die gesetzliche Umsatzsteuer von 19 % … enthalten.'
 *
 *    Am selben Tag habe ich die Sätze selbst datumsabhängig gemacht
 *    (`@norns/domain`, `satzAm`) — die RECHNUNG stimmte danach, aber der
 *    Satz DARUNTER auf dem Papier hätte weiter 19 behauptet.
 *
 *    Bei einem Beleg aus dem Corona-Halbjahr 2020 (16 statt 19) stünde damit
 *    auf demselben Zettel eine Steuer von 16 Prozent und ein Rechtshinweis,
 *    der 19 nennt. § 14 Abs. 4 UStG verlangt den zutreffenden Steuersatz; ein
 *    Beleg, der sich selbst widerspricht, ist bei einer Kassennachschau kein
 *    Schönheitsfehler.
 *
 * ⚠️ Die Prozentzahl wird deshalb aus dem TAG gerechnet, nicht getippt.
 */

import { type Steuersatzart, satzAm } from '@norns/domain';

/**
 * `'0.1900'` → `'19'`, `'0.0500'` → `'5'` — wie man es auf einem Bon liest.
 *
 * ⚠️ In GANZEN Zahlen gerechnet, nicht über `Number(satz) * 100`. Der
 * naheliegende Weg ergibt für `'0.0700'` die Zahl 7.000000000000001, und auf
 * dem Beleg stünde „7,0 %" statt „7 %". Meine eigene Probe hat das gefangen —
 * dieselbe Falle, vor der `bruttoBruch` in `@norns/domain` warnt.
 */
function alsProzent(satz: string): string {
  // Ein Satz hat vier Nachkommastellen: '0.1900' → 1900 Zehntausendstel.
  const zehntausendstel = Number(satz.replace('.', ''));
  const ganze = Math.trunc(zehntausendstel / 100);
  const rest = zehntausendstel % 100;
  if (rest === 0) return String(ganze);
  // Krumme Sätze mit so vielen Stellen wie nötig, mit deutschem Komma.
  return `${ganze},${String(rest).padStart(2, '0').replace(/0$/, '')}`;
}

/** Der Hinweis eines Steuerschlüssels, für einen bestimmten Geschäftstag. */
function hinweis(code: string, tag: string): string | undefined {
  const mitSatz = (art: Steuersatzart, paragraf: string): string =>
    `Im Preis ist die gesetzliche Umsatzsteuer von ${alsProzent(satzAm(art, tag))} % ` +
    `gemäß ${paragraf} UStG enthalten.`;

  switch (code) {
    case 'STANDARD_19':
      return mitSatz('REGEL', '§ 12 Abs. 1');
    case 'REDUCED_7':
      return mitSatz('ERMAESSIGT', '§ 12 Abs. 2');
    // Die Sonderregelungen nennen keinen Satz — sie hängen an keinem.
    case 'MARGIN_25A':
      return 'Differenzbesteuerung gemäß § 25a UStG. Vorsteuerabzug ist ausgeschlossen.';
    case 'INVESTMENT_GOLD_25C':
      return 'Steuerfreie Lieferung von Anlagegold gemäß § 25c UStG.';
    case 'REVERSE_CHARGE_13B':
      return 'Steuerschuldnerschaft des Leistungsempfängers nach §13b Abs. 2 Nr. 9 UStG.';
    default:
      return undefined;
  }
}

/**
 * Die Hinweise für die Steuerschlüssel eines Belegs.
 *
 * @param codes Die Schlüssel, die auf diesem Beleg wirklich vorkommen.
 * @param tag   Der Geschäftstag (`JJJJ-MM-TT`), von dem der Satz gilt.
 */
export function steuerhinweiseFuerBeleg(codes: readonly string[], tag: string): string[] {
  const raus: string[] = [];
  for (const c of codes) {
    const h = hinweis(c, tag);
    if (h !== undefined && !raus.includes(h)) raus.push(h);
  }
  return raus;
}

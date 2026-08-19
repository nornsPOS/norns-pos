/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REGELBESTEUERUNG ODER § 19? DAS DARF NIE GERATEN WERDEN.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Am 26.07.2026 stellte sich beim ersten Händler heraus: sein Impressum nennt
 * „Gemäß § 19 UStG wird keine Umsatzsteuer berechnet", während unser System ihm
 * **5.982,63 EUR** Umsatzsteuer berechnet hatte — 5.376,43 nach § 25a, 577,70
 * nach 19 %, 27,78 gemischt.
 *
 * Beides kann nicht stimmen. Und die falsche Richtung ist teuer:
 *
 *   • Ein Kleinunternehmer, der Umsatzsteuer AUSWEIST, schuldet sie dem
 *     Finanzamt nach **§ 14c Abs. 1 UStG** — obwohl er sie nie einnehmen
 *     durfte. Er zahlt sie aus eigener Tasche und bekommt sie nicht zurück.
 *
 *     (19.08.2026 berichtigt: hier stand Abs. 2. Seit 01.01.2025 ist der
 *     Kleinunternehmer-Umsatz STEUERFREI statt „nicht erhoben", darum fällt
 *     der Ausweis unter Abs. 1 „unrichtiger Steuerausweis" — BMF-Schreiben
 *     vom 18.03.2025, Rn. 5. Der Unterschied ist praktisch: Abs. 1 lässt die
 *     Berichtigung nach § 17 Abs. 1 zu, Abs. 2 verlangt einen eigenen
 *     schriftlichen Antrag beim Finanzamt.)
 *   • Umgekehrt: wer regelbesteuert ist und keine ausweist, hinterzieht.
 *
 * ── Warum es im Erzeugnis bisher gar nicht vorkam ────────────────────────
 *
 * `KLEINUNTERNEHMER_19` existiert als BELEGTEXT (Wanderung 0024, mit dem
 * Kommentar „(future)") — aber nicht als Steuerschlüssel. Die sechs echten
 * Schlüssel sind MARGIN_25A, INVESTMENT_GOLD_25C, STANDARD_19, REDUCED_7,
 * MIXED, REVERSE_CHARGE_13B. Es gab also einen Aufkleber, aber keine Maschine.
 *
 * ── Die Entscheidung, die diese Datei trifft ─────────────────────────────
 *
 * **Der Modus wird nicht geraten, sondern eingestellt** — je Händler, mit
 * Datum. Und `null` bedeutet ausdrücklich „noch nicht beantwortet": dann
 * verweigert der Verkauf, statt still das eine oder andere anzunehmen.
 *
 * Das ist unbequem und genau richtig. Ein System, das bei fehlender Angabe
 * „19 % ist schon üblich" annimmt, ist dieselbe Klasse wie der Versanddienst,
 * der Sendungsnummern erfand: eine fehlende Einstellung führt nicht zu einer
 * Lücke, sondern zu einer Erfindung.
 *
 * ── Warum ein DATUM dazugehört ───────────────────────────────────────────
 *
 * Ein Händler wechselt. Wer zum 01.01. in die Regelbesteuerung geht, hat für
 * Dezember andere Belege als für Januar — und der DATEV-Export braucht die
 * Grenze. Ein Modus ohne Datum wäre rückwirkend falsch.
 */

/** Was auf dem Beleg steht, hängt hieran. Keine dritte Möglichkeit. */
export type Steuermodus = 'REGELBESTEUERUNG' | 'KLEINUNTERNEHMER_19';

/**
 * Der Wortlaut auf dem Beleg.
 *
 * 14.08.2026, Rechtsstand geprüft: seit dem 01.01.2025 sind die Umsätze
 * des Kleinunternehmers STEUERFREI (Neufassung des § 19 UStG, BMF-Schreiben
 * vom 18.03.2025), und § 34a Satz 1 Nr. 6 UStDV verlangt auf der Rechnung
 * den Hinweis auf diese STEUERBEFREIUNG. Hier stand der Satz des alten
 * Rechtsrahmens („wird keine Umsatzsteuer berechnet", Nichterhebung) — der
 * beschrieb seit der Reform das falsche Konstrukt.
 *
 * Er ist keine Höflichkeit: fehlt der Hinweis, ist die Rechnung formell
 * unvollständig, und ein Beleg ohne Steuerzeile sieht aus wie ein
 * vergessener Ausweis.
 */
export const HINWEIS_19 = 'Steuerfrei als Kleinunternehmer gemäß § 19 UStG.';

export interface Steuerstand {
  /** `null` heisst: NIE beantwortet. Nicht „vermutlich Regelbesteuerung". */
  modus: Steuermodus | null;
  /** Ab wann dieser Modus gilt. `null`, solange kein Modus feststeht. */
  giltAb: Date | null;
}

export interface Urteil {
  erlaubt: boolean;
  /** Der Satz für den Menschen an der Kasse — er muss sagen, was zu TUN ist. */
  grund?: string;
  /** Zwingender Zusatz auf dem Beleg. `null`, wenn keiner nötig ist. */
  belegzusatz: string | null;
}

/**
 * Steuerschlüssel, die unter § 19 KEINEN Sinn ergeben.
 *
 * ⚠️ Das ist der Punkt, den man leicht übersieht: § 25a regelt, WORAUF die
 * Steuer liegt (auf der Marge statt auf dem Entgelt). Wer gar keine Steuer
 * ausweisen darf, hat nichts zu verteilen — die Differenzbesteuerung läuft
 * ins Leere. Dasselbe gilt für § 13b, wo die Schuld auf den Empfänger
 * übergeht: ein Kleinunternehmer hat keine, die übergehen könnte.
 */
const UNTER_19_UNMOEGLICH = new Set([
  'MARGIN_25A',
  'REVERSE_CHARGE_13B',
  'STANDARD_19',
  'REDUCED_7',
  'MIXED',
]);

/**
 * Darf dieser Verkauf mit diesem Steuerschlüssel gebucht werden?
 *
 * Rein: keine Uhr, kein Netz, keine Datenbank. Genau deshalb prüfbar.
 */
export function pruefeSteuermodus(input: {
  stand: Steuerstand;
  taxTreatmentCode: string;
  /** Der ausgewiesene Steuerbetrag in Cent. Unter § 19 muss er null sein. */
  vatCents: bigint;
}): Urteil {
  const { stand, taxTreatmentCode, vatCents } = input;

  // ── 1. Nicht beantwortet heisst NICHT „nimm das Übliche" ────────────────
  if (stand.modus === null) {
    return {
      erlaubt: false,
      grund:
        'Der Umsatzsteuer-Status dieses Betriebs ist nicht hinterlegt. Vor dem ersten ' +
        'Verkauf muss feststehen, ob Regelbesteuerung oder § 19 UStG gilt, sonst steht ' +
        'auf jedem Beleg entweder zu viel oder zu wenig Steuer. Bitte in den ' +
        'Einstellungen eintragen.',
      belegzusatz: null,
    };
  }

  if (stand.modus === 'REGELBESTEUERUNG') {
    // Alles Weitere prüft `steuerbetrag-passt.ts` — hier gibt es nichts zu
    // ergänzen, und ein zweiter Riegel auf denselben Fall wäre nur eine
    // zweite Stelle, die auseinanderlaufen kann.
    return { erlaubt: true, belegzusatz: null };
  }

  // ── 2. § 19: KEINE Steuer, und kein Schlüssel, der eine voraussetzt ─────
  if (UNTER_19_UNMOEGLICH.has(taxTreatmentCode)) {
    return {
      erlaubt: false,
      grund:
        `Unter § 19 UStG ist „${taxTreatmentCode}" nicht möglich: dieser Betrieb weist ` +
        'keine Umsatzsteuer aus, also gibt es auch keine zu verteilen oder zu übertragen. ' +
        'Bitte den Artikel ohne Steuerschlüssel verkaufen.',
      belegzusatz: null,
    };
  }

  if (vatCents !== 0n) {
    return {
      erlaubt: false,
      grund:
        'Unter § 19 UStG darf kein Steuerbetrag ausgewiesen werden. Ein trotzdem ' +
        'ausgewiesener Betrag wird nach § 14c Abs. 1 UStG geschuldet, und zwar ' +
        'zusätzlich, ohne ihn eingenommen zu haben.',
      belegzusatz: null,
    };
  }

  return { erlaubt: true, belegzusatz: HINWEIS_19 };
}

/**
 * Liest den Stand aus zwei Einstellungswerten.
 *
 * Bewusst streng: alles, was nicht genau einer der beiden Modi ist, wird zu
 * `null`. Ein Tippfehler in `system_settings` soll den Verkauf anhalten, nicht
 * still zur Regelbesteuerung führen.
 */
export function leseSteuerstand(
  modusWert: string | null | undefined,
  abWert: string | null | undefined,
): Steuerstand {
  const m =
    modusWert === 'REGELBESTEUERUNG' || modusWert === 'KLEINUNTERNEHMER_19' ? modusWert : null;
  if (m === null) return { modus: null, giltAb: null };

  const d = abWert ? new Date(abWert) : null;
  // ⚠️ Ein Modus OHNE gültiges Datum zählt als nicht beantwortet. Ohne die
  // Grenze wäre der DATEV-Export rückwirkend falsch, und das fällt erst beim
  // Steuerberater auf — Monate später.
  if (d === null || Number.isNaN(d.getTime())) return { modus: null, giltAb: null };

  return { modus: m, giltAb: d };
}

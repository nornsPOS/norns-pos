/**
 * Der Verkaufspreis eines Edelmetallstücks wird GERECHNET, nicht gespeichert.
 *
 * ── WARUM ES DIESE DATEI GIBT ──────────────────────────────────────────────
 *
 * Basel, 05.08.2026: „اذا شترييت قرام ذهب بسعر معين وبعد يومين ارتفع سعر
 * الذهب هل سعر المنتج يرتفع كونه ذهب؟" — wenn ich ein Gramm Gold zu einem
 * Preis kaufe und der Goldkurs zwei Tage später steigt, steigt dann der Preis
 * des Stücks mit?
 *
 * Die gemessene Antwort war: **nein**. Ein `grep` nach
 * `spotPrice|repricing|preisNachfuehr|neuberechn` über `apps/api-cloud/src`
 * fand NICHTS. Jeder Preis war für immer eingefroren, so wie er einmal
 * eingetippt wurde. Bei hundert einzelnen Goldstücken heisst das hundert
 * Änderungen von Hand bei jeder Kursbewegung. Basel wörtlich: „دمار اخسر مع
 * الوقت الذهب مرتفع والسعر قديم".
 *
 * Seine Entscheidung vom selben Tag: der Preis wird aus dem Stück gerechnet.
 *
 *     Feingewicht × Tageskurs je Gramm + Aufschlag
 *
 * ── ⚠️ DIE ROTE LINIE: NUR BESTAND, NIEMALS EIN BELEG ──────────────────────
 *
 * Diese Rechnung gilt für Ware, die IM LAGER LIEGT. Sobald verkauft ist, gilt
 * für immer die Zahl, die auf dem Beleg steht und in `transaction_items`
 * gebucht wurde. Ein abgeschlossener Beleg darf sich NIE rückwirkend ändern —
 * das wäre ein GoBD-Bruch und vor der Prüfung schlimmer als jeder
 * Preisverlust. Diese Datei kennt deshalb KEINEN Beleg und keine Buchung; sie
 * rechnet ausschliesslich für die Anzeige eines Lagerstücks.
 *
 * ── WAS SIE NICHT TUT ──────────────────────────────────────────────────────
 *
 * Sie rät nie. Fehlt das Gewicht, der Feingehalt oder der Tageskurs, gibt sie
 * `null` zurück und der Aufrufer zeigt den gespeicherten Preis mit einem
 * ehrlichen Hinweis. Ein erfundener Goldpreis wäre schlimmer als ein alter.
 */

import { Money } from '../money/index.js';

/** Die vier Metalle, für die es einen Tageskurs gibt. */
export type Metall = 'gold' | 'silver' | 'platinum' | 'palladium';

const METALLE: ReadonlySet<string> = new Set<Metall>([
  'gold',
  'silver',
  'platinum',
  'palladium',
]);

/**
 * Warum ein Stück KEINEN gerechneten Preis bekommt. Jeder Grund ist ein
 * Satz, den die Fläche einem Menschen zeigen kann — kein stilles `null`.
 */
export type KeinKurspreisGrund =
  | 'kein_metall'
  | 'kein_gewicht'
  | 'kein_feingehalt'
  | 'kein_tageskurs'
  | 'aufschlag_unplausibel'
  | 'fest_gepflegt';

export interface Kursgrundlage {
  /** Reines Metall in Gramm: Gewicht × Feingehalt. */
  readonly feingewichtGramm: string;
  /** Der verwendete Tageskurs je Gramm, in Euro. */
  readonly kursJeGrammEur: string;
  /** Der Materialwert vor dem Aufschlag. */
  readonly materialwertEur: string;
  /**
   * Der Aufschlag als ANTEIL, wie ihn die Einstellungen führen: 0.10 heisst
   * zehn Prozent. Siehe die Warnung an `kurspreisFuerStueck`.
   */
  readonly aufschlagAnteil: string;
  /** Woher der Kurs stammt, für den ehrlichen Satz an der Fläche. */
  readonly kursQuelle: string;
  /** Wann der Kurs erhoben wurde. */
  readonly kursStand: string;
}

export type Kurspreis =
  | { readonly art: 'gerechnet'; readonly preisEur: string; readonly grundlage: Kursgrundlage }
  | { readonly art: 'kein_kurspreis'; readonly grund: KeinKurspreisGrund };

export interface StueckFuerKurspreis {
  readonly metal: string | null | undefined;
  /** Gramm als Dezimalzeichenkette, wie die Datenbank sie liefert. */
  readonly weightGrams: string | null | undefined;
  /** Feingehalt 0..1 als Dezimalzeichenkette, z. B. "0.9990". */
  readonly finenessDecimal: string | null | undefined;
  /**
   * Wenn wahr, folgt dieses Stück dem Kurs NICHT. Für eine Uhr, eine
   * Antiquität oder ein Sammlerstück, dessen Wert nicht am Metall hängt.
   */
  readonly festerPreis?: boolean | null;
}

export interface Tageskurs {
  readonly metal: string;
  /** Euro je Gramm reines Metall. */
  readonly pricePerGramEur: string;
  readonly source: string;
  readonly asOf: string;
}

/** Eine Dezimalzeichenkette, wie Postgres und die Schnittstelle sie führen. */
function zahl(roh: string | null | undefined): number | null {
  if (roh === null || roh === undefined) return null;
  const s = String(roh).trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Rechnet den Verkaufspreis eines Lagerstücks aus dem Tageskurs.
 *
 * @param stueck        Das Stück, so wie es in der Datenbank steht.
 * @param kurse         Die Tageskurse, nach Metall.
 * @param aufschlagAnteil Aufschlag als ANTEIL je Metall, aus den Einstellungen.
 *
 * ⚠️ ANTEIL, NICHT PROZENT. `0.10` heisst zehn Prozent. Das Haus führt die
 * Ankaufmarge (`pricing.ankauf_safety_margin_pct`) seit jeher als Anteil in
 * [0, 0.50]; eine zweite Einheit im selben System wäre ein Preisfehler um den
 * Faktor hundert, und zwar still. Ein Wert über 1 wird deshalb ABGEWIESEN,
 * nicht gerechnet: wer „10" statt „0.10" einträgt, bekommt keinen Preis,
 * sondern einen Grund.
 */
export function kurspreisFuerStueck(
  stueck: StueckFuerKurspreis,
  kurse: ReadonlyMap<string, Tageskurs>,
  aufschlagAnteil: ReadonlyMap<string, string>,
): Kurspreis {
  if (stueck.festerPreis === true) return { art: 'kein_kurspreis', grund: 'fest_gepflegt' };

  const metall = (stueck.metal ?? '').trim().toLowerCase();
  if (!METALLE.has(metall)) return { art: 'kein_kurspreis', grund: 'kein_metall' };

  const gewicht = zahl(stueck.weightGrams);
  if (gewicht === null || gewicht <= 0) return { art: 'kein_kurspreis', grund: 'kein_gewicht' };

  const fein = zahl(stueck.finenessDecimal);
  if (fein === null || fein <= 0 || fein > 1) {
    return { art: 'kein_kurspreis', grund: 'kein_feingehalt' };
  }

  const kurs = kurse.get(metall);
  const jeGramm = kurs ? zahl(kurs.pricePerGramEur) : null;
  if (!kurs || jeGramm === null || jeGramm <= 0) {
    return { art: 'kein_kurspreis', grund: 'kein_tageskurs' };
  }

  // Aufschlag: fehlt einer, gilt null. Ein FEHLENDER Aufschlag darf nie zu
  // einem erfundenen werden — lieber der nackte Materialwert, den der Händler
  // sofort als zu niedrig erkennt, als ein stiller Fantasiezuschlag.
  const roh = aufschlagAnteil.get(metall);
  const anteil = roh === undefined ? 0 : zahl(roh);
  if (anteil === null || anteil < 0) return { art: 'kein_kurspreis', grund: 'aufschlag_unplausibel' };
  // ⚠️ Der Riegel gegen die Einheitenverwechslung. Ein Anteil über 1 hiesse
  // mehr als hundert Prozent Aufschlag; viel wahrscheinlicher hat jemand
  // „10" statt „0.10" eingetragen. Lieber kein Preis als das Zehnfache.
  if (anteil > 1) return { art: 'kein_kurspreis', grund: 'aufschlag_unplausibel' };

  const feingewicht = gewicht * fein;
  const material = Money.of(String(jeGramm)).multiply(feingewicht.toFixed(6));
  const preis = material.multiply(String(1 + anteil));

  return {
    art: 'gerechnet',
    preisEur: preis.toString(),
    grundlage: {
      feingewichtGramm: feingewicht.toFixed(4),
      kursJeGrammEur: material.isZero() ? '0.00' : String(jeGramm),
      materialwertEur: material.toString(),
      aufschlagAnteil: String(anteil),
      kursQuelle: kurs.source,
      kursStand: kurs.asOf,
    },
  };
}

/**
 * Der deutsche Satz zu einem Stück ohne gerechneten Preis. Er sagt, WAS
 * fehlt, damit der Händler es nachtragen kann statt zu rätseln.
 */
export const KEIN_KURSPREIS_SATZ: Readonly<Record<KeinKurspreisGrund, string>> = {
  kein_metall: 'Kein Edelmetall hinterlegt, der Preis bleibt wie eingetragen.',
  kein_gewicht: 'Ohne Gewicht lässt sich kein Tagespreis rechnen. Bitte das Gewicht nachtragen.',
  kein_feingehalt:
    'Ohne Feingehalt lässt sich kein Tagespreis rechnen. Bitte Karat oder Feingehalt nachtragen.',
  kein_tageskurs: 'Für dieses Metall liegt kein Tageskurs vor, der Preis bleibt wie eingetragen.',
  aufschlag_unplausibel:
    'Der Aufschlag in den Einstellungen ist unplausibel. Er wird als Anteil geführt: 0,10 sind zehn Prozent.',
  fest_gepflegt: 'Fester Preis, folgt dem Kurs bewusst nicht.',
};

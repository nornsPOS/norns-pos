/**
 * metal-tick — pure formatting for one metal-price ticker cell (UX §3.A).
 *
 * Takes the REAL current price and a prior reference (the ticker supplies the
 * 10-day average from the rates query) and produces the glanceable trio:
 *   • price      — German-comma, 2 dp (or "—" when unknown)
 *   • deltaLabel — signed percent, German comma (e.g. "+4,2 %"); "" when no Δ
 *   • tone       — 'up' | 'down' | 'flat' (drives verdigris / wax-red / neutral)
 *
 * No facade: the sign/tone is computed from current-vs-prior. No float drift
 * concern — this is a display percent + a sign, not money arithmetic.
 */
import { zahlVomServer } from './decimal.js';
import { alsTag } from '@norns/domain';

export type TickTone = 'up' | 'down' | 'flat';

export interface MetalTick {
  price: string;
  deltaLabel: string;
  tone: TickTone;
}

/** Below this absolute percent the move reads as flat (rounds to 0,0 %). */
const FLAT_EPSILON_PCT = 0.05;

/*
 * ⚠️ HIER STAND `normalizeDecimal`, UND GOLD KOSTETE 1.138.664 EUR JE GRAMM.
 *
 * Der Wert kommt vom eigenen Motor, nicht aus einem Textfeld. Ein Parser, der
 * zwischen deutschem Komma und Tausenderpunkt RAET, hat hier nichts zu suchen:
 * bei vier Nachkommastellen entschied er sich fuer „Tausenderpunkt" und strich
 * ihn. Die ganze Begruendung steht bei `zahlVomServer`.
 */
function parseDecimal(s: string | null | undefined): number | null {
  return zahlVomServer(s);
}

/** Locale-free German number: fixed dp, dot → comma. */
function deFixed(n: number, dp: number): string {
  return n.toFixed(dp).replace('.', ',');
}

export function formatMetalTick(
  current: string | null | undefined,
  prior: string | null | undefined,
): MetalTick {
  const cur = parseDecimal(current);
  if (cur === null) return { price: '-', deltaLabel: '', tone: 'flat' };

  const price = deFixed(cur, 2);
  const pri = parseDecimal(prior);
  if (pri === null || pri === 0) return { price, deltaLabel: '', tone: 'flat' };

  const pct = ((cur - pri) / pri) * 100;
  let tone: TickTone = 'flat';
  if (pct > FLAT_EPSILON_PCT) tone = 'up';
  else if (pct < -FLAT_EPSILON_PCT) tone = 'down';

  const sign = tone === 'up' ? '+' : tone === 'down' ? '−' : '';
  const deltaLabel = `${sign}${deFixed(Math.abs(pct), 1)} %`;
  return { price, deltaLabel, tone };
}

// ── Wie viele Tage stecken WIRKLICH im Mittel? ───────────────────────────────

/** Das Fenster, über das der Server mittelt (`AVG_WINDOW_DAYS` in der Route). */
export const MITTEL_FENSTER_TAGE = 10;

export interface MittelDeckung {
  /** Beobachtete Kalendertage im Fenster. 0, wenn nichts vorliegt. */
  tage: number;
  /**
   * Der Satz hinter der Prozentzahl. `null` heisst: die Prozentzahl darf gar
   * nicht erscheinen, weil es nichts gibt, wogegen sie vergleicht.
   */
  vergleichstext: string | null;
}

/**
 * ⚠️ 01.08.2026, auf einer frischen Kasse gesehen: das Kursband sagte
 * „0,0 % ggü. Ø 10 Tage". Beide Hälften waren falsch.
 *
 * Der Server mittelt zeitgewichtet über zehn Tage. Liegt nur EIN Tag vor, ist
 * das Mittel exakt der heutige Kurs — die Differenz ist zwangsläufig null. Die
 * Kasse zeigte also „unverändert" und meinte „ich habe nichts zum Vergleichen".
 * Das ist der gefährlichere der beiden Fehler: ein Händler, der beim Ankauf auf
 * ein ruhiges Band schaut, liest daraus eine Marktlage, die niemand gemessen
 * hat.
 *
 * Der Aufklapper holt die Kurshistorie ohnehin (`metalPricesApi.history`). Er
 * kann die Tage also ZÄHLEN, statt zehn zu behaupten.
 *
 * @param abrufIsos `fetchedAt` je Kurszeile, Reihenfolge egal.
 * @param jetzt     wird hereingereicht, damit der Wächter feste Tage prüfen kann.
 */
export function deckeMittelAb(
  abrufIsos: readonly (string | null | undefined)[],
  jetzt: Date,
): MittelDeckung {
  const grenze = jetzt.getTime() - MITTEL_FENSTER_TAGE * 24 * 60 * 60 * 1000;
  const tageImFenster = new Set<string>();
  for (const iso of abrufIsos) {
    if (iso === null || iso === undefined) continue;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t) || t < grenze || t > jetzt.getTime()) continue;
    /*
     * Nach Kalendertag bündeln: zwei Abrufe am selben Tag sind EIN Tag.
     *
     * ⚠️ Nach dem BERLINER Kalendertag (bis 21.08.2026 stand hier
     * `toISOString`, also UTC). Zwei Abrufe um 00:30 und um 23:30 Ortszeit
     * fielen damit auf zwei verschiedene Tage, und das Mittel behauptete
     * einen Tag mehr, als es gesehen hatte.
     */
    tageImFenster.add(alsTag(new Date(t)));
  }
  const tage = tageImFenster.size;

  // Ein einziger Tag heisst: das Mittel IST der heutige Kurs. Jede Prozentzahl
  // daraus ist eine Null ohne Aussage, also erscheint sie nicht.
  if (tage <= 1) return { tage, vergleichstext: null };
  if (tage >= MITTEL_FENSTER_TAGE) {
    return { tage, vergleichstext: `ggü. Ø ${MITTEL_FENSTER_TAGE} Tage` };
  }
  return { tage, vergleichstext: `ggü. Ø ${tage} Tagen, mehr liegt noch nicht vor` };
}

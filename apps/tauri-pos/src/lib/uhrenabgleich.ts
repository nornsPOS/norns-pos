/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  uhrenabgleich — die Geräteuhr gegen die Uhr der Sicherheitseinrichtung
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── WARUM ES DAS BRAUCHT (20.08.2026) ──────────────────────────────────────
 *
 * Basels Prüfliste warnte, eine falsche Geräteuhr könne „die TSE stoppen".
 * Gemessen stimmt die Sorge nicht in ihrer Mechanik: die SIGNATURZEIT stammt
 * bei einer Cloud-TSE vom Signaturdienst, nicht vom Gerät, und keine lokale
 * Drift kann eine Signatur anhalten oder umordnen.
 *
 * Das ECHTE Restrisiko ist ein anderes, und es ist real:
 *
 *   • Der Bon trägt den Vorgangsbeginn aus der GERÄTEUHR (§ 6 KassenSichV).
 *   • Der Geschäftstag, unter dem ein Beleg im Tagesabschluss landet, folgt
 *     derselben Uhr.
 *   • Steht sie falsch, weichen Bon und DSFinV-K von der Signaturzeit ab —
 *     und genau diese Abweichung sieht ein Prüfer sofort, weil beide Zeiten
 *     nebeneinander im Prüfpaket stehen.
 *
 * Dagegen hilft kein Quelltext, sondern die Zeitsynchronisierung des
 * Betriebssystems. Was der Quelltext kann, ist: es MERKEN und sagen, statt es
 * monatelang unbemerkt mitzuschreiben.
 *
 * ── WIE GEMESSEN WIRD ──────────────────────────────────────────────────────
 *
 * Jede erfolgreiche Signatur bringt ihre Zeit mit (`finishedAt`). Die Kasse
 * hält daneben ihren eigenen Zeitpunkt. Die Differenz ist die Drift.
 *
 * ⚠️ EIN EHRLICHER ABZUG: zwischen dem Stempel des Dienstes und dem Ablesen
 * der eigenen Uhr liegt die Netzreise. Die Kasse misst deshalb NICHT auf die
 * Sekunde genau, und die Schwelle ist bewusst grob: erst ab zwei Minuten wird
 * gewarnt. Eine Kasse, die wegen 300 Millisekunden Netzlaufzeit Alarm gibt,
 * erzieht dazu, den Alarm zu ignorieren.
 */

/**
 * Ab wann eine Abweichung eine Warnung wert ist.
 *
 * Zwei Minuten: weit über jeder Netzlaufzeit und jeder Sommerzeit-Sekunde,
 * aber deutlich unter dem, was einen Geschäftstag verschieben könnte.
 */
export const DRIFT_SCHWELLE_MS = 120_000;

export interface Uhrenbefund {
  /** Abweichung in Millisekunden. Positiv: die Geräteuhr geht VOR. */
  abweichungMs: number;
  /** Überschreitet die Abweichung die Schwelle? */
  auffaellig: boolean;
  /** Ein fertiger deutscher Satz, oder `null`, wenn alles stimmt. */
  satz: string | null;
}

/**
 * Vergleicht die Zeit einer Signatur mit der Geräteuhr.
 *
 * @param signaturZeit Der Zeitstempel der Sicherheitseinrichtung (ISO).
 * @param geraeteZeit  Der Zeitpunkt der Kasse; für Prüfsätze übergebbar.
 */
export function pruefeUhr(
  signaturZeit: string | null | undefined,
  geraeteZeit: Date = new Date(),
): Uhrenbefund | null {
  if (!signaturZeit) return null;
  const tse = new Date(signaturZeit).getTime();
  if (!Number.isFinite(tse)) return null;

  const abweichungMs = geraeteZeit.getTime() - tse;
  const betrag = Math.abs(abweichungMs);
  if (betrag < DRIFT_SCHWELLE_MS) {
    return { abweichungMs, auffaellig: false, satz: null };
  }

  const minuten = Math.round(betrag / 60_000);
  const richtung = abweichungMs > 0 ? 'vor' : 'nach';
  return {
    abweichungMs,
    auffaellig: true,
    satz:
      `Die Uhr dieser Kasse geht rund ${minuten} Minuten ${richtung}, gemessen gegen die ` +
      'Zeit der Sicherheitseinrichtung. Der Bon und die Tageszuordnung folgen der ' +
      'Geräteuhr, die Signatur ihrer eigenen: das fällt einem Prüfer auf. Bitte die ' +
      'automatische Zeitsynchronisierung im Betriebssystem einschalten.',
  };
}

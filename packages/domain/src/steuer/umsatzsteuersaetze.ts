/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Die Umsatzsteuersätze — und ab WANN jeder gilt
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 20.08.2026 (Basels Prüfbericht, nachgemessen) ───────────
 *
 * Die Sätze 19 und 7 standen als feste Zahlen im Quelltext, an vier Stellen:
 *
 *     lib/cart-math.ts                 19n/119n, 7n/107n, '0.1900', '0.0700'
 *     lib/steuerbetrag-passt.ts        STANDARD_19: '0.1900'
 *     lib/marge-nachrechnen.ts         19n/119n
 *     lib/gesamtdifferenz-25a.ts       19n/119n
 *
 * Keine dieser Stellen kannte ein DATUM. Basel hat das als Rechtsrisiko
 * benannt, und er hat recht — aber der Schaden liegt woanders, als es auf den
 * ersten Blick aussieht.
 *
 * ── WO ES WIRKLICH WEHTUT ──────────────────────────────────────────────────
 *
 * Jede gebuchte Zeile trägt ihren Satz SELBST (`applied_vat_rate`). Alte
 * Belege rechnen also nicht von sich aus falsch. Gefährlich ist der Tag, an
 * dem der Gesetzgeber den Satz ändert:
 *
 *   • Zieht man die Konstante auf den neuen Satz, weist `steuerbetrag-passt`
 *     ab sofort JEDEN alten Beleg ab — Storno, Nachdruck und die Nachrechnung
 *     der Marge scheitern an Belegen, die völlig korrekt sind.
 *   • Lässt man sie stehen, kann die Kasse den neuen Satz gar nicht buchen.
 *
 * Beides ist ein Betriebsstillstand mit Prüfer im Haus. Deshalb ist der Satz
 * hier eine Funktion des TAGES, nicht eine Zahl.
 *
 * ── DASS DAS KEIN GEDANKENSPIEL IST ────────────────────────────────────────
 *
 * Deutschland hat den Regelsatz zuletzt 2020 für ein halbes Jahr gesenkt
 * (Zweites Corona-Steuerhilfegesetz: 16 statt 19, ermässigt 5 statt 7, vom
 * 1. Juli bis 31. Dezember 2020). § 147 AO verlangt zehn Jahre Aufbewahrung —
 * von 2026 aus reicht das bis 2016 zurück, dieses halbe Jahr liegt also
 * MITTEN in der Aufbewahrungsfrist. Ein Haus, das Belege aus 2020 übernimmt
 * oder storniert, braucht genau diese Spanne.
 *
 * ── WAS HIER NICHT PASSIERT ────────────────────────────────────────────────
 *
 * ⚠️ Die Steuerschlüssel heissen weiterhin `STANDARD_19` und `REDUCED_7`. Die
 * Zahl im NAMEN ist unschön, aber der Name steht in jeder gebuchten Zeile,
 * in der DSFinV-K-Ausfuhr und im DATEV-Stapel. Ihn zu ändern hiesse, die
 * Bücher umzuschreiben. Der Name bleibt also ein KENNWORT; was er bedeutet,
 * entscheidet dieses Verzeichnis und der Tag.
 */

/** Welcher der beiden Sätze des § 12 UStG gemeint ist. */
export type Steuersatzart = 'REGEL' | 'ERMAESSIGT';

/** Eine Spanne, in der ein Satz galt. `bis` offen heisst: gilt weiter. */
export interface Satzspanne {
  /** Erster Tag, an dem der Satz galt (JJJJ-MM-TT). */
  readonly ab: string;
  /** Letzter Tag, an dem er galt, oder `null` für „gilt weiter". */
  readonly bis: string | null;
  /** Der Satz als Dezimaltext, genau wie `applied_vat_rate` ihn trägt. */
  readonly satz: string;
}

/**
 * Der Regelsatz nach § 12 Abs. 1 UStG.
 *
 * ⚠️ Diese Liste ist RECHT, kein Geschmack. Wer sie ändert, ändert, was die
 * Kasse für steuerlich richtig hält — mit einer Quelle im Commit, oder gar
 * nicht.
 */
export const REGELSATZ: readonly Satzspanne[] = [
  { ab: '1993-01-01', bis: '1998-03-31', satz: '0.1500' },
  { ab: '1998-04-01', bis: '2006-12-31', satz: '0.1600' },
  { ab: '2007-01-01', bis: '2020-06-30', satz: '0.1900' },
  // Zweites Corona-Steuerhilfegesetz, befristet auf ein halbes Jahr.
  { ab: '2020-07-01', bis: '2020-12-31', satz: '0.1600' },
  { ab: '2021-01-01', bis: null, satz: '0.1900' },
];

/** Der ermässigte Satz nach § 12 Abs. 2 UStG. */
export const ERMAESSIGTER_SATZ: readonly Satzspanne[] = [
  { ab: '1993-01-01', bis: '2020-06-30', satz: '0.0700' },
  { ab: '2020-07-01', bis: '2020-12-31', satz: '0.0500' },
  { ab: '2021-01-01', bis: null, satz: '0.0700' },
];

/** Der erste Tag, für den dieses Verzeichnis eine Auskunft hat. */
export const FRUEHESTER_TAG = '1993-01-01';

/** Ein Geschäftstag als `JJJJ-MM-TT`. */
const TAG = /^\d{4}-\d{2}-\d{2}$/;

export class UnbekannterSteuersatzError extends Error {
  public readonly tag: string;
  constructor(art: Steuersatzart, tag: string) {
    super(
      `Für den ${art === 'REGEL' ? 'Regelsatz' : 'ermässigten Satz'} gibt es zum ` +
        `${tag} keine Auskunft. Die Kasse rät keinen Steuersatz.`,
    );
    this.name = 'UnbekannterSteuersatzError';
    this.tag = tag;
  }
}

/**
 * Welcher Satz an diesem Tag galt.
 *
 * ⚠️ Wirft, statt zu raten. Ein erfundener Steuersatz ist der eine Fehler,
 * den man an einem Beleg nicht mehr sieht: die Zahl steht da, sie sieht
 * plausibel aus, und sie ist falsch. Lieber ein lauter Abbruch.
 *
 * @param art Regelsatz oder ermässigter Satz.
 * @param tag Der GESCHÄFTSTAG des Belegs (`JJJJ-MM-TT`), nicht „heute".
 *            Für einen Storno ist es der Tag des URSPRUNGSBELEGS.
 */
export function satzAm(art: Steuersatzart, tag: string): string {
  if (!TAG.test(tag)) throw new UnbekannterSteuersatzError(art, tag);
  const liste = art === 'REGEL' ? REGELSATZ : ERMAESSIGTER_SATZ;
  for (const s of liste) {
    if (tag >= s.ab && (s.bis === null || tag <= s.bis)) return s.satz;
  }
  throw new UnbekannterSteuersatzError(art, tag);
}

/**
 * Der Satz, der HEUTE gilt — für einen Verkauf, der jetzt entsteht.
 *
 * Getrennt benannt, damit man an der Aufrufstelle sieht, ob mit dem heutigen
 * oder mit einem historischen Tag gerechnet wird.
 */
export function satzHeute(art: Steuersatzart, heute: Date = new Date()): string {
  return satzAm(art, alsTag(heute));
}

/**
 * Ein Zeitpunkt als Geschäftstag in DEUTSCHER Ortszeit.
 *
 * ⚠️ Nicht `toISOString().slice(0, 10)`: das rechnet nach UTC, und ein
 * Verkauf um 00:30 deutscher Sommerzeit fiele damit auf den VORTAG. An einer
 * Steuersatzgrenze (Silvester, und genau so lag der 31.12.2020) wäre das der
 * falsche Satz.
 */
export function alsTag(zeitpunkt: Date, zone = 'Europe/Berlin'): string {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return f.format(zeitpunkt);
}

/**
 * Gilt an diesem Tag ein ANDERER Satz als heute?
 *
 * Die Flächen benutzen das für einen ruhigen Hinweis („dieser Beleg stammt
 * aus einer Zeit mit 16 Prozent"), damit niemand den Unterschied für einen
 * Rechenfehler hält.
 */
export function satzWeichtVonHeuteAb(
  art: Steuersatzart,
  tag: string,
  heute: Date = new Date(),
): boolean {
  return satzAm(art, tag) !== satzHeute(art, heute);
}

/**
 * Der Satz als Bruch, um die Steuer aus einem BRUTTObetrag herauszurechnen.
 *
 * Die Kasse rechnet in ganzen Cent mit `bigint`: Steuer = brutto × z / n.
 * Aus `'0.1900'` wird 1900/11900 (gekürzt dasselbe wie das vertraute 19/119),
 * aus `'0.1600'` wird 1600/11600, aus `'0.0500'` 500/10500.
 *
 * ⚠️ Bewusst KEINE Gleitkommazahl. `0.19` ist im Binärsystem nicht darstellbar,
 * und an einer Geldstelle ist das der Anfang von Ein-Cent-Abweichungen, die
 * niemand mehr zuordnen kann.
 */
export function bruttoBruch(satz: string): { zaehler: bigint; nenner: bigint } {
  if (!/^\d\.\d{4}$/.test(satz)) {
    throw new Error(`Ein Steuersatz hat vier Nachkommastellen; bekommen: „${satz}"`);
  }
  const zaehler = BigInt(satz.replace('.', ''));
  return { zaehler, nenner: 10_000n + zaehler };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Die Artikelnummer, die die Kasse selbst vorschlägt
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 20.08.2026 ──────────────────────────────────────────────
 *
 * Die Artikelnummer ist am Ankauf ein PFLICHTFELD. Wer am Tresen einen Ring
 * kauft, muss sich also eine Nummer ausdenken, während der Verkäufer davor
 * steht und wartet.
 *
 * Das Haus KANN es längst: `ProductSheet.tsx` schlägt beim Anlegen im Lager
 * eine vor. Nur stand die Regel dort als private Funktion mitten in einer
 * Datei mit fast zweitausend Zeilen — der Ankauf sah sie nicht.
 *
 * ── DIE FORM ───────────────────────────────────────────────────────────────
 *
 *     GM-260820-K3F9
 *     │  │      └── vier Zeichen aus Zufall, gegen Zusammenstösse
 *     │  └───────── der Tag, JJMMTT
 *     └──────────── die Warenart: GM = Goldmünze
 *
 * Sie ist LESBAR, und das ist Absicht: wer eine Etikette in der Hand hält,
 * sieht die Warenart und den Tag der Aufnahme, ohne etwas nachzuschlagen.
 *
 * ⚠️ Ein Vorschlag, kein Zwang. Wer eine eigene Nummernordnung führt (viele
 * Händler tun das seit Jahrzehnten), überschreibt das Feld einfach.
 */

/** Die Warenarten, wie der Motor sie kennt. */
export type Warenart =
  | 'gold_jewelry'
  | 'gold_coin'
  | 'gold_bar'
  | 'silver_jewelry'
  | 'silver_coin'
  | 'silver_bar'
  | 'platinum_jewelry'
  | 'platinum_coin'
  | 'platinum_bar'
  | 'antique'
  | 'watch'
  | 'other';

/**
 * Das Kürzel je Warenart.
 *
 * ⚠️ Diese Zuordnung stand bis zum 20.08.2026 als private Tabelle in
 * `ProductSheet.tsx`. Sie steht hier, damit Lager UND Ankauf DIESELBEN
 * Nummern vergeben — zwei Tabellen hätten irgendwann zwei Nummernkreise
 * ergeben, und die Etiketten im Regal hätten sich widersprochen.
 */
export const ART_KUERZEL: Record<Warenart, string> = {
  gold_jewelry: 'GS',
  gold_coin: 'GM',
  gold_bar: 'GB',
  silver_jewelry: 'SS',
  silver_coin: 'SM',
  silver_bar: 'SB',
  platinum_jewelry: 'PS',
  platinum_coin: 'PM',
  platinum_bar: 'PB',
  antique: 'AQ',
  watch: 'UH',
  other: 'XX',
};

/** Zeichen ohne die verwechselbaren: kein I gegen 1, kein O gegen 0. */
const ZEICHEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Vier Zeichen aus Zufall.
 *
 * ⚠️ `I`/`1` und `O`/`0` fehlen mit Absicht. Eine Artikelnummer wird von
 * einer Etikette ABGELESEN und am Tresen nachgetippt; zwei verwechselbare
 * Zeichen darin kosten irgendwann eine falsche Zuordnung.
 */
function zufallsteil(zufall: () => number): string {
  let raus = '';
  for (let i = 0; i < 4; i++) {
    raus += ZEICHEN[Math.floor(zufall() * ZEICHEN.length)];
  }
  return raus;
}

/**
 * Eine Artikelnummer vorschlagen.
 *
 * @param art    Die Warenart; bestimmt das Kürzel.
 * @param heute  Der Tag der Aufnahme.
 * @param zufall Nur für die Proben austauschbar.
 */
export function skuVorschlag(
  art: Warenart,
  heute: Date = new Date(),
  zufall: () => number = Math.random,
): string {
  const kuerzel = ART_KUERZEL[art] ?? 'XX';
  const jj = String(heute.getFullYear()).slice(2);
  const mm = String(heute.getMonth() + 1).padStart(2, '0');
  const tt = String(heute.getDate()).padStart(2, '0');
  return `${kuerzel}-${jj}${mm}${tt}-${zufallsteil(zufall)}`;
}

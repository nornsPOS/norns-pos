/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER KLIENT ERKLÄRTE SEINE EIGENE STEUER. NIEMAND RECHNETE NACH.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `validateTransactionMath` prüft bei § 25a genau EINE Sache: dass
 * `marginEur` und `acquisitionCostEurSnapshot` gemeinsam gesetzt oder gemeinsam
 * `null` sind (`transaction-math.ts:140`). Ob die Zahlen STIMMEN, prüft
 * niemand.
 *
 * Das heisst: ein Aufrufer schickt
 *
 *     lineTotalEur: '270.00'
 *     acquisitionCostEurSnapshot: '269.00'   ← erfunden
 *     marginEur: '1.00'                      ← erfunden
 *     lineVatEur: '0.16'                     ← erfunden
 *
 * und der Server nimmt es. Der echte Einkaufspreis steht in `products`, wird
 * aber nicht gelesen. Statt 3,19 EUR Steuer werden 0,16 gebucht — in eine
 * fortschreibungsgeschützte, hashverkettete Aufzeichnung.
 *
 * Kassiererrecht genügt. Und es fällt nirgends auf: die Bilanzgleichung geht
 * auf, die Summen stimmen, der Beleg sieht aus wie jeder andere.
 *
 * ── Warum das schwerer wiegt als der Klientenfehler von heute ────────────
 *
 * Heute wurde die Kasse repariert: sie nimmt jetzt den hinterlegten
 * Steuerschlüssel statt ihn neu zu erraten. Das macht den Klienten RICHTIG.
 *
 * Es macht ihn nicht ÜBERPRÜFBAR. Solange der Server die Marge nicht selbst
 * rechnet, hängt die Richtigkeit jeder Steuerzeile daran, dass die Software am
 * Tresen fehlerfrei ist — und genau die war es heute nicht.
 *
 * § 146a AO verlangt eine unveränderbare Aufzeichnung. Eine Zahl, die der
 * Aufzeichnende frei bestimmt, ist unveränderbar falsch.
 *
 * ── Was diese Datei tut ──────────────────────────────────────────────────
 *
 * Sie rechnet die Marge aus dem im Bestand hinterlegten Einkaufspreis nach und
 * vergleicht sie mit dem, was der Klient behauptet. Weicht es ab, wird der
 * Vorgang abgelehnt — mit beiden Zahlen im Text, damit der Mensch am Tresen
 * sieht, worum es geht.
 *
 * ⚠️ Sie rechnet NICHT still um. Ein Server, der die Zahl des Klienten
 * korrigiert, statt sie abzulehnen, verdeckt einen Fehler in der Kasse — und
 * dann merkt niemand, dass die Kasse falsch rechnet.
 */

/** Ein Cent Spielraum, aus demselben Grund wie in `steuerbetrag-passt.ts`. */
const TOLERANZ_CENT = 1n;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WARE, DIE NIE IN DIE MARGENBESTEUERUNG DARF (19.08.2026)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * § 25a Abs. 1 Nr. 3 UStG nimmt Edelmetalle vom Verfahren aus, und zwar
 * namentlich nach Zolltarif: Positionen 71 06 (Silber), 71 08 (Gold),
 * 71 10 (Platin) und 71 12 (Abfälle und Schrott). Für diese Ware gibt es kein
 * Wahlrecht — sie ist regelbesteuert, immer.
 *
 * Bis heute prüfte das niemand:
 *
 *   • `NeuesProduktDialog.tsx` stellt das Feld auf `MARGIN_25A` VOR, für jede
 *     Warenart, und bietet jeden Schlüssel ohne Einschränkung an.
 *   • `cart-math.ts` leitet zwar richtig ab (eine Barre fällt dort auf
 *     `STANDARD_19`), aber der HINTERLEGTE Schlüssel gewinnt bedingungslos —
 *     die Ableitung läuft gar nicht erst.
 *   • Dieser Prüfer rechnete die Marge sauber nach, fragte aber nie, WAS er
 *     da bemargt.
 *
 * Gemessen an einer Silberbarre, EK 800,00 / VK 1.000,00:
 *
 *     nach § 25a  Marge 200,00 → 19/119 →   31,93 EUR
 *     nach Gesetz  Entgelt 1.000,00 brutto → 159,66 EUR
 *     ───────────────────────────────────────────────
 *     zu wenig erklärt                       127,73 EUR — je Barre.
 *
 * ── Warum genau diese drei und keine mehr ────────────────────────────────
 *
 * Die Zuordnung ist keine Auslegung, sie folgt dem Tarif:
 *
 *   `*_bar`   Rohmetall in Barrenform → 71 06 / 71 08 / 71 10 → AUSGESCHLOSSEN
 *   `*_coin`  Münzen → Position 71 18, nicht genannt → § 25a bleibt offen
 *   `*_jewelry` Schmuck → Position 71 13, nicht genannt → § 25a bleibt offen
 *
 * Deshalb steht hier eine Liste der drei Barrenarten und nicht etwa ein
 * Wortfilter auf „gold" — eine Goldmünze aus zweiter Hand ist der klassische
 * Fall der Differenzbesteuerung und muss durchgehen.
 *
 * Quelle: § 25a Abs. 1 Nr. 3 UStG.
 */
const TARIFLICH_AUSGESCHLOSSEN: ReadonlySet<string> = new Set([
  'gold_bar',
  'silver_bar',
  'platinum_bar',
]);

export interface MargenZeile {
  index: number;
  appliedTaxTreatmentCode?: string | null;
  /**
   * Die im Bestand hinterlegte Warenart (`products.item_type`). `null` heisst:
   * der Aufrufer konnte sie nicht mitgeben — dann wird die Tarifprüfung
   * übersprungen, nicht etwa geraten.
   */
  warenart?: string | null;
  /** Bruttobetrag der Zeile in Cent. */
  lineTotalCent: bigint;
  /** Was der Klient als Einkaufspreis behauptet, in Cent. `null`, wenn keiner. */
  behaupteterEinkaufCent: bigint | null;
  /** Was der Klient als Marge behauptet, in Cent. */
  behaupteteMargeCent: bigint | null;
  /** Was der Klient als Steuer behauptet, in Cent. */
  behaupteteSteuerCent: bigint;
  /**
   * Der im Bestand hinterlegte Einkaufspreis in Cent.
   *
   * `null` heisst: das Produkt trägt keinen — dann ist § 25a nicht belegbar.
   */
  echterEinkaufCent: bigint | null;
}

export interface Befund {
  field: string;
  message: string;
  expected: string;
  actual: string;
}

/** Wie `cart-math.ts` rundet — dieselbe Regel, sonst entstehen Cent-Differenzen. */
function rundeHalfEven(zaehler: bigint, nenner: bigint): bigint {
  const negativ = zaehler < 0n;
  const z = negativ ? -zaehler : zaehler;
  const ganz = z / nenner;
  const rest = z % nenner;
  const doppelt = rest * 2n;
  let auf = false;
  if (doppelt > nenner) auf = true;
  else if (doppelt === nenner) auf = ganz % 2n === 1n;
  const e = auf ? ganz + 1n : ganz;
  return negativ ? -e : e;
}

const cent = (c: bigint) => `${(Number(c) / 100).toFixed(2).replace('.', ',')} EUR`;

/**
 * Rechnet jede § 25a-Zeile nach. Leeres Ergebnis heisst: alles stimmt.
 *
 * Rein: keine Uhr, kein Netz, keine Datenbank. Der Aufrufer liefert den echten
 * Einkaufspreis mit.
 */
export function pruefeMargen(zeilen: readonly MargenZeile[]): Befund[] {
  const befunde: Befund[] = [];

  for (const z of zeilen) {
    if (z.appliedTaxTreatmentCode !== 'MARGIN_25A') continue;

    // ── 0. Darf diese Ware überhaupt in das Verfahren? ────────────────────
    //
    // Zuerst, vor jeder Rechnung: eine richtig gerechnete Marge auf einer
    // Barre bleibt eine Steuer, die es nicht geben darf. Siehe
    // TARIFLICH_AUSGESCHLOSSEN oben.
    if (z.warenart != null && TARIFLICH_AUSGESCHLOSSEN.has(z.warenart)) {
      befunde.push({
        field: `items[${z.index}].appliedTaxTreatmentCode`,
        message:
          'Edelmetall in Barrenform ist von der Differenzbesteuerung ausgenommen ' +
          '(§ 25a Abs. 1 Nr. 3 UStG nennt die Zolltarif-Positionen 71 06, 71 08 und 71 10). ' +
          'Dieses Stück muss regelbesteuert verkauft werden.',
        expected: 'STANDARD_19',
        actual: `MARGIN_25A auf Warenart ${z.warenart}`,
      });
      continue;
    }

    // ── 1. Ohne hinterlegten Einkaufspreis ist § 25a nicht belegbar ───────
    if (z.echterEinkaufCent === null) {
      befunde.push({
        field: `items[${z.index}].acquisitionCostEurSnapshot`,
        message:
          'Für dieses Stück ist kein Einkaufspreis hinterlegt. Ohne ihn lässt sich die ' +
          'Marge nach § 25a nicht belegen (§ 25a Abs. 6 UStG verlangt die Aufzeichnung).',
        expected: 'ein hinterlegter Einkaufspreis',
        actual: 'keiner',
      });
      continue;
    }

    // ── 2. Der behauptete Einkaufspreis muss der echte sein ──────────────
    //
    // ⚠️ Das ist der Kern. Ohne diesen Vergleich kann der Klient jeden
    // beliebigen Einkaufspreis erfinden und damit jede beliebige Steuer.
    const einkaufAbweichung =
      z.behaupteterEinkaufCent === null
        ? null
        : z.behaupteterEinkaufCent > z.echterEinkaufCent
          ? z.behaupteterEinkaufCent - z.echterEinkaufCent
          : z.echterEinkaufCent - z.behaupteterEinkaufCent;

    if (einkaufAbweichung === null || einkaufAbweichung > TOLERANZ_CENT) {
      befunde.push({
        field: `items[${z.index}].acquisitionCostEurSnapshot`,
        message:
          'Der übermittelte Einkaufspreis stimmt nicht mit dem im Bestand hinterlegten ' +
          'überein. Der Steuerbetrag nach § 25a hängt genau daran.',
        expected: cent(z.echterEinkaufCent),
        actual: z.behaupteterEinkaufCent === null ? 'keiner' : cent(z.behaupteterEinkaufCent),
      });
      continue;
    }

    // ── 3. Die Marge folgt zwingend aus Preis und Einkauf ────────────────
    //
    // Eine negative Marge wird null — der Laden hat Verlust gemacht, das
    // Finanzamt zahlt keine Steuer zurück (Abschn. 25a.1 Abs. 11 Satz 3 UStAE;
    // 19.08.2026 berichtigt, vorher stand hier Abs. 12).
    const roh = z.lineTotalCent - z.echterEinkaufCent;
    const margeSoll = roh < 0n ? 0n : roh;

    if (z.behaupteteMargeCent === null || z.behaupteteMargeCent !== margeSoll) {
      befunde.push({
        field: `items[${z.index}].marginEur`,
        message: 'Die übermittelte Marge folgt nicht aus Verkaufspreis minus Einkaufspreis.',
        expected: cent(margeSoll),
        actual: z.behaupteteMargeCent === null ? 'keine' : cent(z.behaupteteMargeCent),
      });
      continue;
    }

    // ── 4. Und die Steuer folgt zwingend aus der Marge ───────────────────
    const steuerSoll = rundeHalfEven(margeSoll * 19n, 119n);
    const abweichung =
      z.behaupteteSteuerCent > steuerSoll
        ? z.behaupteteSteuerCent - steuerSoll
        : steuerSoll - z.behaupteteSteuerCent;

    if (abweichung > TOLERANZ_CENT) {
      befunde.push({
        field: `items[${z.index}].lineVatEur`,
        message:
          'Der übermittelte Steuerbetrag folgt nicht aus der Marge (19/119 der Marge, ' +
          'kaufmännisch gerundet).',
        expected: cent(steuerSoll),
        actual: cent(z.behaupteteSteuerCent),
      });
    }
  }

  return befunde;
}

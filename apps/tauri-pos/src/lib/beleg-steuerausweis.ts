/**
 * Was auf einem Beleg an Umsatzsteuer STEHEN DARF, und was nicht.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  BEI DIFFERENZBESTEUERUNG IST DER GESONDERTE STEUERAUSWEIS VERBOTEN.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * § 14a Abs. 6 Satz 2 UStG: der Wiederverkäufer darf die im Preis enthaltene
 * Umsatzsteuer NICHT gesondert ausweisen. Wer es trotzdem tut, schuldet den
 * ausgewiesenen Betrag zusätzlich nach § 14c UStG, und zwar dem Finanzamt,
 * ohne ihn vom Kunden bekommen zu haben.
 *
 * Bis zum 26.07.2026 druckten alle drei Ausgabewege der Kasse bedingungslos
 * eine Zeile „MwSt. X EUR": der Thermodruck, die Vorschau und die A4-Rechnung.
 * Bei einem Stück für 1.000 Euro mit 700 Euro Einstand stand dort die
 * Margensteuer, also genau der verbotene Ausweis. Der Beleg widersprach sich
 * dabei selbst: die Fusszeile sagte „Vorsteuerabzug ist ausgeschlossen", drei
 * Zeilen darüber stand der Betrag, den der Käufer angeblich nicht ziehen darf.
 *
 * Gemessen an der Entwicklungsdatenbank: 62 Positionen `MARGIN_25A`, 43.256,46
 * Euro brutto, 5.393,19 Euro Margensteuer auf 28 Belegen. Rund 87 Prozent des
 * bisherigen Umsatzes wären so gedruckt worden.
 *
 * ── Und die zweite Hälfte des Gesetzes, die leicht übersehen wird ──────────
 *
 * § 14a Abs. 6 Satz 1 UStG verlangt zusätzlich einen HINWEIS auf die
 * angewandte Sonderregelung, und zwar mit vorgeschriebenem Wortlaut
 * (Art. 226 Nr. 14 MwStSystRL, in Deutschland über UStAE 14a.1):
 *
 *     „Gebrauchtgegenstände/Sonderregelung"
 *
 * Ein blosser Verweis auf § 25a ist der übliche Zusatz, ersetzt den Wortlaut
 * aber nicht. Deshalb steht hier beides.
 *
 * ── Warum je ZEILE entschieden wird und nicht je Beleg ────────────────────
 *
 * Die Steuerart hängt am Produkt (`deriveTaxTreatment`), nicht am Vorgang. Ein
 * Korb kann einen gebrauchten Goldring (§ 25a) und eine neue Ware (19 %)
 * zugleich enthalten. Dann MUSS die Steuer der Regelware ausgewiesen werden
 * und die der Margenware NICHT. Ein Schalter je Beleg wäre in genau diesem
 * Fall falsch, und zwar in beide Richtungen.
 *
 * Der Unterscheider ist bereits da und muss nicht erfunden werden:
 * `appliedVatRate` ist genau dann `null`, wenn die Zeile unter einer
 * Sonderregelung läuft (§ 25a und § 25c). Alles andere trägt einen Satz.
 */

/** Die Steuerarten, wie sie `cart-math.ts` kennt. */
export type Steuerart =
  | 'STANDARD_19'
  | 'REDUCED_7'
  | 'MARGIN_25A'
  | 'INVESTMENT_GOLD_25C'
  | 'REVERSE_CHARGE_13B';

/** Was dieses Modul je Belegzeile braucht. Bewusst wenig. */
export interface BelegZeile {
  taxTreatmentCode: Steuerart;
  /** Die Steuer dieser Zeile in ganzen Cent. Bei § 25a die Margensteuer. */
  lineVatCents: bigint;
  /**
   * Der angewandte Satz, oder `null` bei einer Sonderregelung. Kommt
   * unverändert aus `computeLineMath`.
   */
  appliedVatRate: string | null;
}

export interface Steuerausweis {
  /**
   * Der Betrag, der als „MwSt." auf dem Beleg stehen DARF, in ganzen Cent.
   * `null` heisst: gar keine Steuerzeile drucken.
   *
   * Nicht „0,00" drucken: eine Null-Zeile ist ebenfalls eine Aussage über die
   * Steuer und lädt zur Nachfrage ein, ob da etwas fehlt.
   */
  ausweisbareVatCents: bigint | null;
  /**
   * Die vorgeschriebenen Hinweise, in der Reihenfolge, in der sie auf den
   * Beleg gehören. Leer, wenn keine Sonderregelung im Spiel ist.
   */
  hinweise: string[];
  /**
   * Nur für Protokoll und Prüfung: die Steuer, die NICHT ausgewiesen werden
   * darf. Sie wird geschuldet und abgeführt, sie steht nur nicht auf dem
   * Beleg. Wer sie druckt, druckt einen § 14c-Fehler.
   */
  nichtAusweisbareVatCents: bigint;
}

/**
 * Der vorgeschriebene Wortlaut je Sonderregelung.
 *
 * Die erste Zeile ist der gesetzlich verlangte Begriff, die zweite der übliche
 * Zusatz mit der Fundstelle. Beide zusammen, weil der Begriff allein für einen
 * Kunden nichtssagend ist und die Fundstelle allein den Begriff nicht ersetzt.
 */
const WORTLAUT: Partial<Record<Steuerart, string[]>> = {
  MARGIN_25A: [
    'Gebrauchtgegenstände/Sonderregelung',
    'Differenzbesteuerung nach § 25a UStG.',
    'Umsatzsteuer ist nicht gesondert ausweisbar.',
  ],
  INVESTMENT_GOLD_25C: [
    'Steuerfreie Lieferung von Anlagegold',
    'nach § 25c UStG.',
  ],
  REVERSE_CHARGE_13B: [
    'Steuerschuldnerschaft des Leistungsempfängers',
    'nach § 13b UStG.',
  ],
};

/**
 * Entscheidet, was gedruckt werden darf. Rein: keine Uhr, kein Netz, keine
 * Datenbank. Genau deshalb prüfbar.
 */
/**
 * Steuerarten, die einen gesonderten Ausweis VERBIETEN und einen Hinweis
 * verlangen, auch wenn sie einen Satz mitführen.
 *
 * ⚠️ `REVERSE_CHARGE_13B` steht hier, weil `computeLineMath` ihm
 * `appliedVatRate: '0.0000'` gibt und NICHT `null`. Über den Satz allein wäre
 * die Zeile also „ausweisbar mit null Steuer", und der nach § 14a Abs. 5 UStG
 * zwingende Hinweis „Steuerschuldnerschaft des Leistungsempfängers" fiele
 * weg. Ein Beleg ohne diesen Hinweis ist bei § 13b unvollständig.
 */
const SONDERREGELUNGEN: ReadonlySet<Steuerart> = new Set([
  'MARGIN_25A',
  'INVESTMENT_GOLD_25C',
  'REVERSE_CHARGE_13B',
]);

/**
 * Der Steuerstatus des BETRIEBS, nicht der Zeile.
 *
 * ⚠️ 20.08.2026, ein echter Fund: bis heute kannte diese Funktion nur die
 * Steuerart je ZEILE. Der Kleinunternehmer nach § 19 UStG ist aber ein
 * Zustand des ganzen Betriebs — und sein Beleg MUSS den Hinweis tragen.
 * Der Server prüfte den Zustand bereits (`lib/steuermodus.ts`) und warf
 * seinen fertigen Hinweissatz weg; auf dem Bon stand er nie. Damit war
 * jeder Beleg eines Kleinunternehmers unvollständig.
 */
export type BetriebsSteuermodus = 'REGELBESTEUERUNG' | 'KLEINUNTERNEHMER_19';

/**
 * Der Wortlaut des Hinweises. WÖRTLICH derselbe wie auf dem Server
 * (`apps/api-cloud/src/lib/steuermodus.ts`, `HINWEIS_19`) — ein Wächter hält
 * beide zusammen, denn zwei Fassungen desselben Rechtssatzes sind eine zu
 * viel.
 */
export const HINWEIS_KLEINUNTERNEHMER = 'Steuerfrei als Kleinunternehmer gemäß § 19 UStG.';

export function steuerausweisFuerBeleg(
  zeilen: readonly BelegZeile[],
  /**
   * Der Nachweis der USt-IdNr.-Abfrage, wenn § 13b im Spiel ist.
   *
   * ⚠️ Er gehoert auf den BELEG, nicht nur in die Datenbank. Bei einer Pruefung
   * Jahre spaeter liegt der Beleg auf dem Tisch. § 6a Abs. 4 UStG schuetzt den
   * guten Glauben nur bei belegter Sorgfalt — und „belegt" heisst hier woertlich.
   *
   * Der Server liefert ihn (`lib/reverse-charge.ts`, Feld `belegvermerk`) und
   * gibt § 13b ohne ihn gar nicht erst frei. Fehlt er hier trotzdem, wird der
   * Hinweis NICHT weggelassen: dann steht dort, dass der Nachweis fehlt.
   * Ein stiller § 13b-Beleg ohne Nachweis ist genau der Zustand, den diese
   * Arbeit beendet hat.
   */
  reverseChargeNachweis?: string | null,
  /**
   * Der Steuerstatus des Betriebs. Fehlt er, verhält sich die Funktion wie
   * bisher (Regelbesteuerung) — eine Kasse, die den Status noch nicht kennt,
   * darf ohnehin nicht verkaufen: der Server weist sie ab.
   */
  betriebsmodus?: BetriebsSteuermodus | null,
): Steuerausweis {
  let ausweisbar = 0n;
  let nichtAusweisbar = 0n;
  const gesehen: Steuerart[] = [];

  for (const z of zeilen) {
    // ZWEI Bedingungen, und beide werden gebraucht:
    //
    //   • `appliedVatRate === null` faengt jede Sonderregelung, auch eine
    //     kuenftige, an die hier niemand gedacht hat. Unbekannt heisst dann
    //     „nicht ausweisen", und das ist die sichere Richtung.
    //   • Die ausdrueckliche Liste faengt `REVERSE_CHARGE_13B`, das einen Satz
    //     von '0.0000' traegt und ueber die erste Bedingung durchrutschen
    //     wuerde, samt seinem zwingenden Hinweis.
    if (z.appliedVatRate === null || SONDERREGELUNGEN.has(z.taxTreatmentCode)) {
      nichtAusweisbar += z.lineVatCents;
      if (!gesehen.includes(z.taxTreatmentCode)) gesehen.push(z.taxTreatmentCode);
    } else {
      ausweisbar += z.lineVatCents;
    }
  }

  const hinweise: string[] = [];
  for (const art of gesehen) {
    const w = WORTLAUT[art];
    if (w) hinweise.push(...w);
    if (art === 'REVERSE_CHARGE_13B') {
      hinweise.push(
        reverseChargeNachweis && reverseChargeNachweis.trim() !== ''
          ? reverseChargeNachweis
          : // Kein stiller Beleg. Wer das liest, weiss, dass hier nachzuarbeiten ist.
            'USt-IdNr.: Nachweis der EU-Abfrage FEHLT.',
      );
    }
  }

  /*
   * ── DER KLEINUNTERNEHMER (20.08.2026) ──────────────────────────────────
   *
   * Sein Hinweis steht ZULETZT und gilt für den ganzen Beleg, nicht für eine
   * Zeile. Und er verträgt keinen Steuerausweis daneben: wer als
   * Kleinunternehmer Steuer ausweist, SCHULDET sie nach § 14c Abs. 2 UStG,
   * auch wenn er sie nie eingenommen hat. Deshalb wird der ausweisbare
   * Betrag hier hart auf null gesetzt statt nur „nicht gedruckt" — der
   * Server weist einen Beleg mit Steuerbetrag unter § 19 ohnehin ab, und
   * zwei Wege zur selben Wahrheit sind besser als einer.
   */
  const kleinunternehmer = betriebsmodus === 'KLEINUNTERNEHMER_19';
  if (kleinunternehmer) hinweise.push(HINWEIS_KLEINUNTERNEHMER);

  return {
    // Keine Steuerzeile, wenn nichts ausweisbar ist. Bei einem reinen
    // § 25a-Beleg bleibt der Platz leer, und der Hinweis darunter sagt warum.
    ausweisbareVatCents: kleinunternehmer || ausweisbar <= 0n ? null : ausweisbar,
    hinweise,
    nichtAusweisbareVatCents: nichtAusweisbar,
  };
}

/** Cent als deutscher Betrag, „1234" wird zu „12,34". */
export function centsAlsBetrag(cents: bigint): string {
  const negativ = cents < 0n;
  const abs = negativ ? -cents : cents;
  const euro = abs / 100n;
  const rest = abs % 100n;
  return `${negativ ? '-' : ''}${euro},${rest.toString().padStart(2, '0')}`;
}

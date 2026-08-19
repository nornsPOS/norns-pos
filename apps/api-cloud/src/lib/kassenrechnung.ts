/**
 * ════════════════════════════════════════════════════════════════════════
 *  Die Kassenbericht-Rechnung, die ein Prüfer auf dem Blatt nachrechnen kann
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 05.08.2026 ───────────────────────────────────────────
 *
 * Der Abschnitt „Kasse" des Kassenberichts trug DREI Zeilen: erwartet,
 * gezählt, Differenz. Der Anfangsbestand fehlte, der Barankauf fehlte,
 * Einlagen und Entnahmen fehlten.
 *
 * Gemessen am eigenen Kreuzprobeszenario: Anfangsbestand 1.000,00,
 * Bareinnahmen 269,29, Barankauf 500,00, erwartet 769,29. Auf dem Blatt
 * standen davon genau zwei Zahlen — 269,29 und 769,29. Ein Prüfer, der
 * nachrechnet, findet 500,00 EUR Unterschied und kann sie mit KEINER Angabe
 * des Berichts auflösen.
 *
 * Für einen Edelmetallhändler ist der Barankauf nicht der Sonderfall, sondern
 * das Kerngeschäft. An einem Tag mit 8.000 EUR Barankauf trägt das Blatt einen
 * erwarteten Bestand weit UNTER den ausgewiesenen Bareinnahmen, ohne dass
 * irgendetwas auf dem Blatt das erklärt.
 *
 * ── DIE FORM ────────────────────────────────────────────────────────────
 *
 * AEAO zu § 146 Nr. 3.3 beschreibt den Kassenbericht als Rechnung. In der
 * fortschreitenden Form, wie sie hier steht:
 *
 *     Anfangsbestand
 *   + Bareinnahmen
 *   − Barauszahlungen (Ankauf)
 *   − Barausgaben (Betriebsausgaben, seit dem 06.08.2026 erfassbar)
 *   + Einlagen
 *   − Entnahmen (Bankabschöpfung, Tresortransit)
 *   ─────────────────────────────
 *   = Erwarteter Endbestand
 *
 * Jede Zeile steht auf dem Blatt. Damit ist der erwartete Bestand aus dem
 * Blatt SELBST herleitbar, und genau das ist der Zweck.
 *
 * ── ⚠️ UND DIE RECHNUNG WIRD GEGEN DIE GEBUCHTE ZAHL GEHALTEN ───────────
 *
 * `cashExpectedEur` steht seit dem Abschluss fest. Diese Rechnung ersetzt sie
 * NICHT — sie prüft sie. Weichen beide ab, sagt der Bericht das, statt eine
 * der beiden Zahlen zu verschweigen. Eine unerklärte Abweichung, die niemand
 * nennt, ist vor der Prüfung schlimmer als eine, die dasteht.
 */

/** Geld in ganzen Cent. Kein Gleitkomma auf einem Prüferblatt. */
function zuCent(s: string | null | undefined): bigint {
  const t = (s ?? '0').trim();
  const neg = t.startsWith('-');
  const [w = '0', f = ''] = (neg ? t.slice(1) : t).split('.');
  const v = BigInt(w || '0') * 100n + BigInt((f + '00').slice(0, 2));
  return neg ? -v : v;
}

function ausCent(c: bigint): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}

/**
 * Die Bargeldbewegungen eines Geschäftstages, aus `cash_movements`.
 *
 * Die Richtungen sind die des Hauses (`cash_movement_direction`):
 * `OPENING_FLOAT`, `INJECTION`, `BANK_DROP`, `SAFE_TRANSIT`,
 * `CLOSING_RECONCILIATION`. Alle Beträge sind POSITIV gespeichert; die
 * Richtung entscheidet das Vorzeichen, nicht der Betrag.
 */
export interface Bargeldbewegung {
  readonly direction: string;
  readonly amountEur: string;
}

export interface KassenrechnungEingabe {
  /**
   * Der Anfangsbestand der Lade, aus `shifts.opening_float_eur`.
   *
   * ⚠️ GEMESSEN AM 06.08.2026: er steht NICHT in `cash_movements`. Die Art
   * `OPENING_FLOAT` existiert im Datenbanktyp, aber KEIN Schreibweg im ganzen
   * Haus legt je eine solche Zeile an — `POST /api/shifts/open` schreibt den
   * Betrag allein auf die Schicht.
   *
   * Der erste Anschluss dieser Rechnung las nur `cash_movements` und zeigte
   * deshalb einen Anfangsbestand von 0,00 und eine Abweichung von 1.000,00
   * EUR, die es gar nicht gab. Ein Blatt, das eine erfundene Lücke ausweist,
   * ist schlimmer als eines, das keine zeigt: der Händler sucht dann Geld,
   * das nie gefehlt hat.
   *
   * Die Zahl kommt daher von dort, wo sie WIRKLICH steht.
   */
  readonly anfangsbestandEur: string;
  /** Barzahlungen der VERKAUFSseite, positiv. */
  readonly bareinnahmenEur: string;
  /** Barzahlungen der ANKAUFSseite, positiv angegeben; sie MINDERN die Lade. */
  readonly barauszahlungAnkaufEur: string;
  /**
   * Die BAR bezahlten Betriebsausgaben des Tages, positiv angegeben; sie
   * MINDERN die Lade.
   *
   * ⚠️ NUR `zahlweg = 'BAR'`. Zeilen mit `UNBEKANNT` stammen aus der Zeit vor
   * dem 06.08.2026, in der `operating_expenses` gar keine Zahlungsart hatte —
   * sie hier als bar zu zählen hiesse, aus jeder alten Ausgabe rückwirkend
   * eine Entnahme zu machen und damit festgeschriebene Kassenberichte um
   * Beträge zu ändern, die niemand so gemeint hat.
   */
  readonly barausgabenEur: string;
  /**
   * Wie viele Ausgaben dieses Tages KEINEN Zahlweg tragen (`UNBEKANNT`).
   *
   * ⚠️ Sie fehlen in der Rechnung, und das darf nicht STUMM geschehen. Wer
   * eine alte Barausgabe hat, sieht sonst eine Differenz und findet nichts,
   * was sie erklärt. Der Bericht nennt die Zahl und sagt, was zu tun ist.
   */
  readonly ausgabenOhneZahlweg: number;
  readonly bewegungen: readonly Bargeldbewegung[];
  /** Was der Abschluss als erwarteten Bestand festgeschrieben hat. */
  readonly gebuchtErwartetEur: string | null;
  readonly gezaehltEur: string | null;
}

export interface Kassenzeile {
  readonly label: string;
  readonly value: string;
  readonly emphasis?: boolean;
}

export interface Kassenrechnung {
  readonly zeilen: readonly Kassenzeile[];
  /** Der aus den Zeilen GERECHNETE Endbestand. */
  readonly erwartetEur: string;
  /**
   * Weicht die Rechnung von der gebuchten Zahl ab? Dann steht beides auf dem
   * Blatt, mit einer Zeile, die es benennt.
   */
  readonly weichtVonGebuchtemAb: boolean;
}

/**
 * Was eine Bewegungsart mit der Lade macht, und wie sie auf dem Blatt heisst.
 *
 * ⚠️ Eine Art mit dem Wert `undefined` ist AUSDRÜCKLICH eingeordnet: sie
 * bewegt die Lade nicht. Eine Art, die hier gar nicht vorkommt, ist NICHT
 * eingeordnet — und genau die läuft still an der Rechnung vorbei. Der Wächter
 * in `kassenrechnung.test.ts` hält die Schlüssel dieser Tabelle gegen den
 * echten Datenbanktyp; er darf sich nicht auf die BETRÄGE verlassen, denn eine
 * unbekannte Art ergibt null, und null sähe wie „eingeordnet" aus.
 */
const BEWEGUNG: Record<string, { name: string; vorzeichen: 1n | -1n } | undefined> = {
  // ⚠️ AUSDRÜCKLICH KEINE Bewegung. Der Anfangsbestand kommt über
  // `anfangsbestandEur` aus `shifts.opening_float_eur`, wo er wirklich steht.
  // Würde er ZUSÄTZLICH als Bewegung gezählt, stünde er doppelt auf dem Blatt,
  // sobald jemand später anfängt, solche Zeilen zu schreiben. Eine Quelle.
  OPENING_FLOAT: undefined,
  INJECTION: { name: 'Einlage', vorzeichen: 1n },
  BANK_DROP: { name: 'Entnahme zur Bank', vorzeichen: -1n },
  SAFE_TRANSIT: { name: 'Entnahme in den Tresor', vorzeichen: -1n },
  // ⚠️ `CLOSING_RECONCILIATION` ist die Zeile, die beim Schichtschluss den
  // gezählten Bestand festhält. Sie ist eine AUFZEICHNUNG, keine Bewegung —
  // wer sie mitrechnet, zählt den Bestand doppelt.
  CLOSING_RECONCILIATION: undefined,
};

/**
 * Die Bewegungsarten, über die diese Datei eine Meinung hat.
 *
 * Nur für den Wächter. `Object.keys` über die Tabelle nimmt auch die Einträge
 * mit, deren Wert `undefined` ist, und genau das ist hier gewollt: „bewegt die
 * Lade nicht" IST eine Einordnung.
 */
export const EINGEORDNETE_BEWEGUNGSARTEN: readonly string[] = Object.keys(BEWEGUNG);

export function baueKassenrechnung(e: KassenrechnungEingabe): Kassenrechnung {
  const zeilen: Kassenzeile[] = [];

  // Der Anfangsbestand steht ZUERST, auch wenn er null ist: eine fehlende
  // Zeile liest sich wie eine vergessene, eine Null wie eine Aussage.
  const anfang = zuCent(e.anfangsbestandEur);
  const gruppen = new Map<string, bigint>();
  for (const b of e.bewegungen) {
    const regel = BEWEGUNG[b.direction];
    if (!regel) continue;
    gruppen.set(b.direction, (gruppen.get(b.direction) ?? 0n) + zuCent(b.amountEur));
  }

  zeilen.push({ label: 'Anfangsbestand (Wechselgeld)', value: ausCent(anfang) });

  const bareinnahmen = zuCent(e.bareinnahmenEur);
  zeilen.push({ label: 'Bareinnahmen', value: ausCent(bareinnahmen) });

  const barausgaben = zuCent(e.barausgabenEur);
  const barankauf = zuCent(e.barauszahlungAnkaufEur);
  // ⚠️ Mit MINUS auf dem Blatt. Der Ankauf ist eine Auszahlung, und eine Zahl
  // ohne Vorzeichen wäre genau der Grund, warum die Rechnung vorher nicht
  // aufging.
  zeilen.push({ label: 'Barauszahlung Ankauf', value: ausCent(-barankauf) });

  // Die Zeile steht NUR da, wenn es sie gibt. Eine ständige Null unter jedem
  // Blatt liest sich wie eine Rubrik, die niemand pflegt.
  if (barausgaben !== 0n) {
    zeilen.push({ label: 'Barausgaben (Betriebsausgaben)', value: ausCent(-barausgaben) });
  }

  let bewegt = 0n;
  // Feste Reihenfolge, damit zwei Berichte desselben Tages gleich aussehen.
  for (const art of ['INJECTION', 'BANK_DROP', 'SAFE_TRANSIT'] as const) {
    const summe = gruppen.get(art);
    if (summe === undefined || summe === 0n) continue;
    const regel = BEWEGUNG[art];
    if (!regel) continue;
    const wert = regel.vorzeichen * summe;
    bewegt += wert;
    zeilen.push({ label: regel.name, value: ausCent(wert) });
  }

  const erwartet = anfang + bareinnahmen - barankauf - barausgaben + bewegt;
  zeilen.push({ label: 'Erwarteter Endbestand', value: ausCent(erwartet), emphasis: true });

  zeilen.push({ label: 'Gezählter Endbestand', value: e.gezaehltEur ?? '—' });
  if (e.gezaehltEur !== null && e.gezaehltEur !== undefined) {
    zeilen.push({
      label: 'Differenz',
      value: ausCent(zuCent(e.gezaehltEur) - erwartet),
      emphasis: true,
    });
  }

  // ⚠️ Was nicht mitgerechnet werden KONNTE, steht trotzdem auf dem Blatt.
  if (e.ausgabenOhneZahlweg > 0) {
    zeilen.push({
      label: 'Ausgaben ohne erfassten Zahlweg',
      value: `${e.ausgabenOhneZahlweg} nicht in der Rechnung`,
    });
  }

  // ⚠️ Die Gegenprobe gegen die festgeschriebene Zahl.
  const gebucht = e.gebuchtErwartetEur === null ? null : zuCent(e.gebuchtErwartetEur);
  const weichtAb = gebucht !== null && gebucht !== erwartet;
  if (weichtAb && gebucht !== null) {
    zeilen.push({
      label: 'Beim Abschluss festgeschrieben',
      value: ausCent(gebucht),
    });
    zeilen.push({
      label: 'Abweichung zur Rechnung oben',
      value: ausCent(gebucht - erwartet),
      emphasis: true,
    });
  }

  return { zeilen, erwartetEur: ausCent(erwartet), weichtVonGebuchtemAb: weichtAb };
}

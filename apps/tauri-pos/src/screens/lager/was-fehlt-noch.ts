/**
 * Warum der Speichern-Knopf grau ist, in einem Satz.
 *
 * ── BASELS BESCHWERDE VOM 02.08.2026 ───────────────────────────────────────
 *
 * Wörtlich: er habe versucht, ein Produkt ins Lager aufzunehmen, es wurde
 * nicht aufgenommen, da sei ein Problem.
 *
 * ── WAS WIRKLICH GESCHAH ───────────────────────────────────────────────────
 *
 * ⚠️ Nichts war kaputt. Der Knopf war grau, und NICHTS sagte warum.
 *
 * Der Dialog rechnet drei Stufen durch, und `valid` verlangt vier Dinge auf
 * einmal. Eines davon, das Herkunftsland, wohnt in einem zugeklappten
 * Abschnitt; zwei weitere, Einkaufspreis und Verkaufspreis, auf einer
 * ANDEREN Stufe als der Knopf. Wer auf Stufe 2 steht und speichern will,
 * sieht einen grauen Knopf und kein einziges rotes Feld: die Ursache liegt
 * hinter ihm, auf einer Stufe, die er schon verlassen hat.
 *
 * Das ist die Klasse „Sperre ohne Ausgang", diesmal ohne einen einzigen
 * Fehler im Code. Der Händler steht am Tresen, das Stück liegt vor ihm, und
 * die Kasse schweigt.
 *
 * ── WARUM EIN EIGENES MODUL ────────────────────────────────────────────────
 *
 * Damit ein Prüfsatz jede Kombination befragen kann, ohne ein Fenster zu
 * bauen. Und damit die Bedingung des Knopfes und der Satz darunter aus
 * DERSELBEN Rechnung kommen: zwei getrennte Rechnungen driften, und dann
 * sagt der Satz „alles vollständig", während der Knopf grau bleibt.
 */

/** Die Stufen des Dialogs, wie der Mensch sie liest. */
export type Stufe = 0 | 1 | 2;

export interface Luecke {
  /** Auf welcher Stufe das fehlende Feld wohnt. */
  stufe: Stufe;
  /** Der Name des Feldes, wie er auf dem Bildschirm steht. */
  feld: string;
  /** Was zu tun ist. Ein ganzer Satz, kein Stichwort. */
  satz: string;
}

export interface Entwurf {
  name: string;
  sku: string;
  /** Zwei Grossbuchstaben, oder leer. Leer ist erlaubt. */
  herkunftsland: string;
  einkaufspreis: string;
  verkaufspreis: string;
  /** Leer erlaubt; sonst eine Zahl mit höchstens drei Nachkommastellen. */
  gewichtGramm: string;
}

/** Die Prüfung für Geldfelder, vom Aufrufer hereingereicht. */
export type Geldpruefung = (roh: string, nachkomma?: number) => boolean;

export const NAME_STUFE: Readonly<Record<Stufe, string>> = {
  0: 'Eckdaten',
  1: 'Preis und Steuer',
  2: 'Foto, Etikett, Online',
};

/**
 * Was noch fehlt, in der Reihenfolge, in der der Mensch es antrifft.
 *
 * ⚠️ Diese Liste ist die EINZIGE Wahrheit über die Speicherbarkeit. Der Knopf
 * fragt sie, und der Satz darunter fragt sie. Eine zweite Rechnung daneben
 * wäre eine zweite Wahrheit.
 */
export function wasFehltNoch(e: Entwurf, istGeld: Geldpruefung): Luecke[] {
  const luecken: Luecke[] = [];

  if (e.name.trim().length === 0) {
    luecken.push({
      stufe: 0,
      feld: 'Bezeichnung',
      satz: 'Die Bezeichnung fehlt. Sie steht später auf dem Beleg und auf dem Etikett.',
    });
  }

  if (e.sku.trim().length === 0) {
    luecken.push({
      stufe: 0,
      feld: 'Artikelnummer',
      satz: 'Die Artikelnummer fehlt. Ohne sie findet niemand das Stück im Lager wieder.',
    });
  }

  // ⚠️ Leer ist ERLAUBT. Ein Land ist nur dann falsch, wenn es dasteht und
  // keine zwei Grossbuchstaben sind. Genau dieses Feld wohnt in einem
  // zugeklappten Abschnitt und war deshalb der häufigste stumme Grund.
  const land = e.herkunftsland.trim();
  if (land.length > 0 && !/^[A-Z]{2}$/.test(land)) {
    luecken.push({
      stufe: 0,
      feld: 'Herkunftsland',
      satz:
        'Das Herkunftsland muss aus genau zwei Grossbuchstaben bestehen, etwa DE oder CH. ' +
        'Sie finden es unter den Sammlerangaben. Leer lassen ist erlaubt.',
    });
  }

  if (!istGeld(e.einkaufspreis)) {
    luecken.push({
      stufe: 1,
      feld: 'Einkaufspreis',
      satz:
        'Der Einkaufspreis fehlt oder ist keine Zahl. Er entscheidet über die ' +
        'Differenzbesteuerung nach § 25a und darf deshalb nicht geraten werden. ' +
        'Ein Komma ist erlaubt, etwa 199,99.',
    });
  }

  if (!istGeld(e.verkaufspreis)) {
    luecken.push({
      stufe: 1,
      feld: 'Verkaufspreis',
      satz:
        'Der Verkaufspreis fehlt oder ist keine Zahl. Ein Komma ist erlaubt, etwa 249,00. ' +
        'Null ist erlaubt, dann geht das Stück nicht in den Kundenshop.',
    });
  }

  const gewicht = e.gewichtGramm.trim();
  if (gewicht.length > 0 && !istGeld(gewicht, 3)) {
    luecken.push({
      stufe: 1,
      feld: 'Gewicht',
      satz:
        'Das Gewicht ist keine Zahl. Ein Komma ist erlaubt, etwa 31,103. ' +
        'Leer lassen ist erlaubt.',
    });
  }

  return luecken;
}

/**
 * Was der Mensch WISSEN sollte, ohne dass es ihn aufhält.
 *
 * ── DER NEBENFUND VOM 04.08.2026 ───────────────────────────────────────────
 *
 * ⚠️ `isMoneyInput(x, 3)` nimmt „1,23456" AN und macht daraus still 1,234.
 * Wer den Wert von der Goldwaage kopiert, sieht fünf Stellen im Feld und
 * bekommt drei in die Bücher, ohne ein Wort dazu.
 *
 * Drei Nachkommastellen sind physikalisch richtig: die Waage wiegt auf
 * Milligramm. Das SCHWEIGEN ist es nicht. An diesem Gewicht hängt der
 * Schmelzwert, und ein Händler, der später eine andere Zahl im System findet
 * als auf seinem Zettel, misstraut der ganzen Kasse.
 *
 * Deshalb kein Riegel, sondern ein Satz.
 */
export function hinweise(e: Entwurf): string[] {
  const raus: string[] = [];
  const gewicht = e.gewichtGramm.trim();
  const nachkomma = /[.,](\d+)\s*$/.exec(gewicht)?.[1] ?? '';
  if (nachkomma.length > 3) {
    const gekuerzt = gewicht.replace(/([.,])(\d+)\s*$/, (_, sep: string, ziffern: string) =>
      `${sep}${ziffern.slice(0, 3)}`,
    );
    raus.push(
      `Das Gewicht wird auf drei Nachkommastellen gespeichert, also ${gekuerzt} Gramm. ` +
        'Die Waage wiegt auf Milligramm genau, feiner rechnet die Kasse nicht.',
    );
  }
  return raus;
}

/** Lässt sich der Entwurf speichern? Genau dann, wenn nichts fehlt. */
export function istSpeicherbar(e: Entwurf, istGeld: Geldpruefung): boolean {
  return wasFehltNoch(e, istGeld).length === 0;
}

/**
 * Der Satz unter dem grauen Knopf.
 *
 * Er nennt die STUFE mit, denn die Ursache liegt oft hinter dem Menschen: er
 * steht auf Stufe 2 und das fehlende Feld wohnt auf Stufe 0. Ohne den
 * Stufennamen sucht er auf dem falschen Bildschirm.
 */
export function grundZeile(luecken: readonly Luecke[]): string {
  if (luecken.length === 0) return '';
  const erste = luecken[0]!;
  if (luecken.length === 1) {
    return `${NAME_STUFE[erste.stufe]}: ${erste.satz}`;
  }
  const weitere = luecken
    .slice(1)
    .map((l) => `${l.feld} (${NAME_STUFE[l.stufe]})`)
    .join(', ');
  return `${NAME_STUFE[erste.stufe]}: ${erste.satz} Ausserdem fehlt: ${weitere}.`;
}

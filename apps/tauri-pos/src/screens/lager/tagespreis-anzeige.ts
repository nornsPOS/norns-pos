/**
 * Der gerechnete Tagespreis, so wie eine Fläche ihn zeigen darf.
 *
 * ── WAS GEMESSEN FALSCH WAR ────────────────────────────────────────────────
 *
 * Der Motor rechnet den Tagespreis seit Langem und legt ihn bei JEDER
 * Lagerabfrage bei: `apps/api-cloud/src/routes/products-list.ts:275` schreibt
 * `kurspreisEur`, Zeile 279 `kurspreisGrund`, und
 * `apps/api-cloud/src/schemas/product-list.ts:120` lässt beide auch wirklich
 * über die Leitung (Fastify wirft jede nicht angemeldete Eigenschaft weg).
 *
 * Gelesen hat sie NIEMAND. Ein `grep` nach `kurspreis` über
 * `apps/tauri-pos/src` und `packages/api-client/src` fand null Treffer —
 * die Kasse zeigte auf jeder Fläche den eingefrorenen `listPriceEur`.
 * Gleichzeitig versprach die Aufschlagsfläche wörtlich, alle Goldstücke
 * stiegen mit dem Kurs mit. Der Händler hätte bei steigendem Goldkurs Tag
 * für Tag zu Preisen von vorgestern verkauft und es an keiner Stelle
 * gesehen.
 *
 * ── WARUM EIN EIGENES MODUL, UND WARUM `unknown` ───────────────────────────
 *
 * `ProductListRow` in `packages/api-client` kennt die zwei Felder noch nicht;
 * dieses Paket gehört einer anderen Hand. Die Felder liegen aber zur Laufzeit
 * auf dem Objekt. Dieses Modul liest sie deshalb ehrlich als `unknown` und
 * prüft jeden Wert selbst, statt einen Typ zu behaupten, den es nicht gibt.
 *
 * ⚠️ Fehlen die Felder ganz — ein älterer Motor am anderen Ende —, dann sagt
 * das Ergebnis `nicht_geliefert`, und die Fläche zeigt schlicht den
 * gespeicherten Preis. Sie erfindet nie einen Tagespreis und behauptet nie,
 * es gäbe keinen, wenn nur niemand gefragt hat.
 *
 * ── DIE ROTE LINIE ─────────────────────────────────────────────────────────
 *
 * Der Tagespreis ERSETZT den gespeicherten Preis nicht, er steht DANEBEN.
 * Gebucht wird beim Verkauf, was in der Karte steht; ein Beleg ändert sich
 * niemals rückwirkend. Genau so schreibt es auch das Antwortschema des
 * Motors vor.
 *
 * Die deutschen Sätze sind hier nachgeführt statt aus `@norns/domain`
 * geholt: dieses Paket steht nicht in den Abhängigkeiten von `tauri-pos`,
 * und ein neues Paket nachzuinstallieren war für diesen Schritt nicht
 * erlaubt. Der Prüfsatz unten hält die Sätze fest.
 */

import { formatEur } from '../../lib/decimal.js';

/** Warum ein Stück keinen gerechneten Tagespreis hat. Kennwort des Motors. */
export type KeinTagespreisGrund =
  | 'kein_metall'
  | 'kein_gewicht'
  | 'kein_feingehalt'
  | 'kein_tageskurs'
  | 'aufschlag_unplausibel'
  | 'fest_gepflegt';

const GRUENDE: ReadonlySet<string> = new Set<KeinTagespreisGrund>([
  'kein_metall',
  'kein_gewicht',
  'kein_feingehalt',
  'kein_tageskurs',
  'aufschlag_unplausibel',
  'fest_gepflegt',
]);

/** Der ganze Satz für den Menschen. Sagt, was zu tun ist, nicht nur was fehlt. */
export const KEIN_TAGESPREIS_SATZ: Readonly<Record<KeinTagespreisGrund, string>> = {
  kein_metall: 'Kein Edelmetall hinterlegt. Der Preis bleibt, wie er eingetragen ist.',
  kein_gewicht: 'Ohne Gewicht lässt sich kein Tagespreis rechnen. Bitte das Gewicht nachtragen.',
  kein_feingehalt:
    'Ohne Feingehalt lässt sich kein Tagespreis rechnen. Bitte Karat oder Feingehalt nachtragen.',
  kein_tageskurs:
    'Für dieses Metall liegt kein Tageskurs vor. Der Preis bleibt, wie er eingetragen ist.',
  aufschlag_unplausibel:
    'Der Aufschlag in den Einstellungen ist unplausibel. Er wird als Anteil geführt: 0,10 sind zehn Prozent.',
  fest_gepflegt: 'Fester Preis. Dieses Stück folgt dem Kurs bewusst nicht.',
};

/**
 * Das kurze Wort in der engen Preisspalte. `null` heisst: gar nichts zeigen.
 *
 * Bei `kein_metall` schweigt die Zeile bewusst — eine Briefmarke, eine Uhr
 * und eine Münze ohne Metallangabe sähen sonst alle gleich nach Mangel aus,
 * und eine Liste, die bei jeder zweiten Zeile mahnt, wird nicht mehr gelesen.
 */
export const KEIN_TAGESPREIS_KURZ: Readonly<Record<KeinTagespreisGrund, string | null>> = {
  kein_metall: null,
  kein_gewicht: 'Gewicht fehlt',
  kein_feingehalt: 'Feingehalt fehlt',
  kein_tageskurs: 'kein Tageskurs',
  aufschlag_unplausibel: 'Aufschlag prüfen',
  fest_gepflegt: 'fester Preis',
};

export type Tagespreisanzeige =
  | {
      readonly art: 'tagespreis';
      /** Der gerechnete Preis als kanonische Dezimalzeichenkette. */
      readonly tagespreisEur: string;
      /** Der gespeicherte Preis, unangetastet. */
      readonly gespeicherterPreisEur: string;
      readonly richtung: 'hoeher' | 'niedriger' | 'gleich';
      /** Betrag des Unterschieds, immer ohne Vorzeichen. */
      readonly unterschiedEur: string;
      readonly satz: string;
    }
  | {
      readonly art: 'kein_tagespreis';
      readonly grund: KeinTagespreisGrund;
      readonly satz: string;
      readonly kurz: string | null;
    }
  /** Der Motor am anderen Ende kennt die Felder nicht. Nichts behaupten. */
  | { readonly art: 'nicht_geliefert' };

const DEZIMAL = /^-?\d+(?:\.\d+)?$/;

function feld(zeile: unknown, name: string): unknown {
  if (typeof zeile !== 'object' || zeile === null) return undefined;
  return (zeile as Record<string, unknown>)[name];
}

/** Dezimalzeichenkette zu ganzen Cent. `null`, wenn es keine Zahl ist. */
function cent(roh: unknown): number | null {
  if (typeof roh !== 'string') return null;
  const s = roh.trim();
  if (!DEZIMAL.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Ganze Cent zurück in die kanonische Zeichenkette, immer zwei Stellen. */
function alsBetrag(c: number): string {
  const negativ = c < 0;
  const a = Math.abs(c);
  return `${negativ ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

/**
 * Liest die zwei Felder des Motors von einer Lagerzeile.
 *
 * @param zeile Die Zeile, so wie sie über die Leitung kam.
 */
export function tagespreisAnzeige(zeile: unknown): Tagespreisanzeige {
  const rohPreis = feld(zeile, 'kurspreisEur');
  const rohGrund = feld(zeile, 'kurspreisGrund');

  const tagespreisCent = cent(rohPreis);
  if (tagespreisCent !== null) {
    const gespeichert = feld(zeile, 'listPriceEur');
    const gespeichertCent = cent(gespeichert);
    const tagespreisEur = alsBetrag(tagespreisCent);

    // Ohne gespeicherten Preis gibt es nichts zu vergleichen. Dann steht der
    // Tagespreis für sich, statt gegen eine erfundene Null gerechnet zu werden.
    if (gespeichertCent === null) {
      return {
        art: 'tagespreis',
        tagespreisEur,
        gespeicherterPreisEur: '',
        richtung: 'gleich',
        unterschiedEur: '0.00',
        satz: 'Aus dem heutigen Kurs gerechnet.',
      };
    }

    const unterschiedCent = tagespreisCent - gespeichertCent;
    const unterschiedEur = alsBetrag(Math.abs(unterschiedCent));
    const gespeicherterPreisEur = alsBetrag(gespeichertCent);

    if (unterschiedCent === 0) {
      return {
        art: 'tagespreis',
        tagespreisEur,
        gespeicherterPreisEur,
        richtung: 'gleich',
        unterschiedEur,
        satz: 'Tagespreis und gespeicherter Preis stimmen überein.',
      };
    }

    return {
      art: 'tagespreis',
      tagespreisEur,
      gespeicherterPreisEur,
      richtung: unterschiedCent > 0 ? 'hoeher' : 'niedriger',
      unterschiedEur,
      satz:
        unterschiedCent > 0
          ? `Der Tagespreis liegt ${formatEur(unterschiedEur)} € über dem gespeicherten Preis.`
          : `Der Tagespreis liegt ${formatEur(unterschiedEur)} € unter dem gespeicherten Preis.`,
    };
  }

  if (typeof rohGrund === 'string' && GRUENDE.has(rohGrund)) {
    const grund = rohGrund as KeinTagespreisGrund;
    return {
      art: 'kein_tagespreis',
      grund,
      satz: KEIN_TAGESPREIS_SATZ[grund],
      kurz: KEIN_TAGESPREIS_KURZ[grund],
    };
  }

  return { art: 'nicht_geliefert' };
}

/**
 * Der Umfang, über den gezählt wurde.
 *
 * ── ⚠️ WAS OHNE IHN GEMESSEN FALSCH WAR ────────────────────────────────────
 *
 * Die Zusammenfassung zählte die GELADENE SEITE und sagte es nicht.
 * `Lager.tsx` fragt fünfzig Zeilen ab (`PAGE_SIZE = 50`), der Motor schickt
 * daneben die Gesamtzahl der Auswahl mit (`total`). Bei achthundert Stücken
 * nannte die Zeile also eine Zahl über fünfzig davon, und der Händler las
 * sie als Aussage über sein ganzes Lager. Dieses Haus kennt die Klasse:
 * eine Liste mit fester Obergrenze braucht die Gesamtzahl und den Hinweis
 * auf die weiteren.
 *
 * Der Umfang steht deshalb IM Satz, nicht daneben. Ein zweiter Satz, der
 * einschränkt, wird überlesen; ein Satz, der mit „Von den 50 geladenen
 * Stücken" beginnt, kann gar nicht global gelesen werden.
 */
export interface Tagespreisumfang {
  /**
   * Wie viele Stücke die Auswahl INSGESAMT hat — die Zahl, die der Motor
   * neben der Seite mitschickt (`total`), nicht die Länge der Seite.
   */
  readonly gesamt: number;
  /**
   * Wie die nicht gezählten Stücke zu nennen sind. Im Lager sind sie „noch
   * nicht geladen" (der Fuss der Liste holt sie nach), im Verkauf werden sie
   * schlicht nicht gezeigt (Metallfilter oder Obergrenze der Abfrage). Ohne
   * Angabe gilt das vorsichtigere „gezeigt".
   */
  readonly rest?: 'geladen' | 'gezeigt';
}

export interface Tagespreisbild {
  /** Wie viele Zeilen wirklich gezählt wurden. */
  readonly betrachtet: number;
  /** Wie viele davon einen gerechneten Tagespreis tragen. */
  readonly mitTagespreis: number;
  readonly hoeher: number;
  readonly niedriger: number;
  /** Die Gesamtzahl der Auswahl, oder `null`: der Aufrufer kennt sie nicht. */
  readonly gesamt: number | null;
  /** Wie viele Stücke der Auswahl NICHT gezählt sind. `null`: unbekannt. */
  readonly nichtGezaehlt: number | null;
  /** Der gezählte Befund — mit seinem Umfang im selben Satz. */
  readonly satz: string | null;
  /** Was der Befund nicht abdeckt. `null`, wenn er wirklich alles abdeckt. */
  readonly umfangSatz: string | null;
}

function zahlwort(n: number): string {
  return n === 1 ? 'eines' : String(n);
}

function liegt(n: number): string {
  return n === 1 ? 'liegt' : 'liegen';
}

/** Der Satzanfang, der den Umfang trägt. */
function umfangPhrase(
  betrachtet: number,
  nichtGezaehlt: number | null,
  rest: 'geladen' | 'gezeigt',
): string {
  if (nichtGezaehlt === 0) {
    return betrachtet === 1
      ? 'Das einzige Stück der Auswahl'
      : `Von allen ${betrachtet} Stücken der Auswahl`;
  }
  const wort = rest === 'geladen' ? 'geladene' : 'gezeigte';
  return betrachtet === 1
    ? `Das eine ${wort} Stück`
    : `Von den ${betrachtet} ${wort}n Stücken`;
}

/** Der gezählte Befund selbst, ohne Umfang. `null`, wenn nichts abweicht. */
function befundPhrase(betrachtet: number, hoeher: number, niedriger: number): string | null {
  if (hoeher === 0 && niedriger === 0) return null;
  if (betrachtet === 1) {
    return hoeher === 1
      ? 'liegt über dem gespeicherten Preis.'
      : 'liegt unter dem gespeicherten Preis.';
  }
  if (hoeher > 0 && niedriger > 0) {
    return `${liegt(hoeher)} ${zahlwort(hoeher)} über dem gespeicherten Preis, ${zahlwort(niedriger)} ${liegt(niedriger)} darunter.`;
  }
  if (hoeher > 0) return `${liegt(hoeher)} ${zahlwort(hoeher)} über dem gespeicherten Preis.`;
  return `${liegt(niedriger)} ${zahlwort(niedriger)} unter dem gespeicherten Preis.`;
}

/** Der Satz über das, was NICHT mitgezählt ist. */
function umfangSatzBauen(nichtGezaehlt: number | null, rest: 'geladen' | 'gezeigt'): string | null {
  if (nichtGezaehlt === null) return 'Gezählt ist nur, was gerade gezeigt wird.';
  if (nichtGezaehlt <= 0) return null;
  if (rest === 'geladen') {
    return nichtGezaehlt === 1
      ? 'Ein weiteres Stück der Auswahl ist noch nicht geladen und hier nicht mitgezählt.'
      : `${nichtGezaehlt} weitere Stücke der Auswahl sind noch nicht geladen und hier nicht mitgezählt.`;
  }
  return nichtGezaehlt === 1
    ? 'Ein weiteres Stück der Auswahl wird hier nicht gezeigt und ist nicht mitgezählt.'
    : `${nichtGezaehlt} weitere Stücke der Auswahl werden hier nicht gezeigt und sind nicht mitgezählt.`;
}

/**
 * Das Bild über die übergebenen Zeilen: wie viele Stücke heute über oder
 * unter ihrem gespeicherten Preis stehen — und über wie viele überhaupt
 * geredet wird.
 *
 * Der Satz entsteht NUR aus gezählten Zeilen. Trägt keine Zeile einen
 * Tagespreis oder weicht keine ab, bleibt er `null` und die Fläche schweigt,
 * statt eine beruhigende Behauptung aufzustellen.
 *
 * @param zeilen Die Zeilen, die wirklich vorliegen.
 * @param umfang Die Gesamtzahl der Auswahl, wenn der Aufrufer sie kennt.
 *   Fehlt sie, sagt der Satz ausdrücklich, dass nur das Gezeigte zählt — er
 *   tut nie so, als wäre die Seite das Lager.
 */
export function fasseTagespreiseZusammen(
  zeilen: readonly unknown[],
  umfang?: Tagespreisumfang,
): Tagespreisbild {
  let mitTagespreis = 0;
  let hoeher = 0;
  let niedriger = 0;

  for (const zeile of zeilen) {
    const a = tagespreisAnzeige(zeile);
    if (a.art !== 'tagespreis') continue;
    mitTagespreis += 1;
    if (a.richtung === 'hoeher') hoeher += 1;
    else if (a.richtung === 'niedriger') niedriger += 1;
  }

  const betrachtet = zeilen.length;
  const rest = umfang?.rest ?? 'gezeigt';
  // Eine unsinnige Gesamtzahl (kleiner als die Seite, keine Zahl) gilt als
  // UNBEKANNT. Lieber „nur das Gezeigte zählt" als eine erfundene Restzahl.
  const gesamt =
    umfang !== undefined &&
    Number.isFinite(umfang.gesamt) &&
    umfang.gesamt >= betrachtet
      ? Math.trunc(umfang.gesamt)
      : null;
  const nichtGezaehlt = gesamt === null ? null : gesamt - betrachtet;

  const befund = befundPhrase(betrachtet, hoeher, niedriger);
  const satz = befund === null ? null : `${umfangPhrase(betrachtet, nichtGezaehlt, rest)} ${befund}`;

  return {
    betrachtet,
    mitTagespreis,
    hoeher,
    niedriger,
    gesamt,
    nichtGezaehlt,
    satz,
    umfangSatz: satz === null ? null : umfangSatzBauen(nichtGezaehlt, rest),
  };
}

/**
 * „Stand 14:32 Uhr" — wann die gezeigten Zahlen gelesen wurden.
 *
 * ── ⚠️ WARUM EINE UHRZEIT UND KEIN ALTER ───────────────────────────────────
 *
 * Die Kasse holt die Liste, wenn die Fläche lädt; sie rechnet den Tagespreis
 * NICHT laufend nach (`Lager.tsx` hält dreissig Sekunden, `CatalogGrid.tsx`
 * zehn, und keine der beiden holt bei Fensterwechsel nach). Vorher versprach
 * die Aufschlagsfläche trotzdem „sofort". Statt eines Versprechens steht hier
 * jetzt eine Messung.
 *
 * Sie ist ABSOLUT, nie „vor zwölf Minuten": ein Alter wird beim Zeichnen
 * gerechnet, und eine Fläche, die stehen bleibt, zeichnet nicht nach. Aus
 * „vor zwei Minuten" würde nach einer Stunde eine Lüge, die aussieht wie eine
 * Zusage. Eine Uhrzeit veraltet nicht, sie wird nur älter.
 */
export function standSatz(zeitpunkt: number | null | undefined): string | null {
  if (typeof zeitpunkt !== 'number' || !Number.isFinite(zeitpunkt) || zeitpunkt <= 0) return null;
  const zeit = new Date(zeitpunkt);
  if (Number.isNaN(zeit.getTime())) return null;
  const uhr = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(zeit);
  return `Stand ${uhr} Uhr`;
}

/**
 * Der Hinweis auf der Lagerfläche: wo der Händler den Preis nachzieht.
 *
 * ⚠️ Hier stand „Über „anpassen" tragen Sie den Tagespreis in das Stück ein".
 * Gemessen: „anpassen" ist die Beschriftung in der Aktionsspalte
 * (`LagerTable.tsx`), ein Klick auf die Zeile öffnet das Produktblatt — und
 * das Preisfeld liegt dort unter „Details" (`ProductSheet.tsx:1118`), nicht
 * unter „Preis & Veröffentlichen"; dieser Abschnitt zeigt den Preis nur an.
 * Ändern darf ihn ausserdem nur die Ladenleitung (`ProductSheet.tsx:1029`).
 * Der Satz nennt jetzt genau diesen Weg.
 */
export const TAGESPREIS_HINWEIS_LAGER =
  'Kursgebundene Stücke verkauft die Kasse zum Tageskurs; der gespeicherte Preis ist ihr Rückfall, wenn kein Kurs vorliegt. Wer einen festen Preis will, setzt ihn am Stück — das darf nur die Ladenleitung.';

/**
 * Der Hinweis auf der Verkaufsfläche: was die Karte wirklich bucht.
 *
 * ── 20.08.2026, DER SATZ HAT SICH UMGEDREHT ────────────────────────────────
 *
 * Hier stand: „Gebucht wird der Preis, der auf der Kachel steht. Den
 * Tagespreis übernehmen Sie im Lager: Zeile anklicken, unter Details den
 * Verkaufspreis eintragen." Der Satz war WAHR und beschrieb genau den Defekt,
 * über den Basel zu Recht zornig war: die Kasse kannte den Tagespreis und
 * verlangte trotzdem Handarbeit, jeden Morgen, für jedes Stück.
 *
 * Seit heute bucht der Korb den Tagespreis selbst (`lib/korbpreis.ts`), und
 * der Satz sagt, was jetzt gilt.
 */
export const TAGESPREIS_HINWEIS_KASSE =
  'Kursgebundene Stücke werden zum Tageskurs verkauft; die Karte rechnet ihn laufend mit. Ein Stück mit festem Preis behält seinen.';

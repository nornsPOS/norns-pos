/**
 * Woher der Metallkurs kommt, und wer das entscheidet.
 *
 * ── BASELS ANWEISUNG VOM 02.08.2026 ────────────────────────────────────────
 *
 * Wörtlich: der Inhaber soll die Quelle wählen können und zwischen mehreren
 * vertrauenswürdigen Quellen wechseln, in den Einstellungen. Und wenn kein
 * Netz da ist, soll er den Kurs von Hand eintragen können. Einfach für den
 * gewöhnlichen Benutzer, gewaltig dahinter.
 *
 * ── WAS HIER GEMESSEN IST, NICHT BEHAUPTET ─────────────────────────────────
 *
 * Jede Quelle wurde mit echten Abrufen geprüft. Keine braucht einen Schlüssel,
 * kein Abonnement, keine Anmeldung. Das ist die Bedingung: ein Händler in
 * Bremen soll die Kasse aufstellen und Kurse haben, ohne vorher irgendwo ein
 * Konto anzulegen.
 *
 *   GOLDPREIS_DE  api.edelmetalle.de/public.json  (Messung 13.08.2026)
 *                 ALLE VIER Metalle DIREKT IN EURO, in einem einzigen Abruf.
 *                 HTTP 200, 229 Byte, 0,22 Sekunden, ohne Schlüssel. Damit
 *                 fällt die Umrechnung für ALLE vier weg, nicht nur für zwei.
 *
 *   GOLD_API      api.gold-api.com/price/XAU   → 4079,60 USD je Unze, HTTP 200
 *                 Alle vier Metalle, aber in DOLLAR. Braucht deshalb den
 *                 Umrechnungskurs, und der ist eine zweite Fehlerquelle.
 *
 *   SWISSQUOTE    forex-data-feed.swissquote.com/public-quotes/…/XAU/EUR
 *                 Gold 3541,01 und Silber 51,58 DIREKT IN EURO, HTTP 200.
 *                 ⚠️ Platin und Palladium gibt es dort NUR gegen Dollar
 *                 (XPT/EUR antwortete mit einer leeren Liste, XPT/USD mit
 *                 1732,28). Für diese zwei wird also doch umgerechnet.
 *
 * ── WARUM ZWEI QUELLEN UND NICHT EINE ──────────────────────────────────────
 *
 * Nicht der Vollständigkeit halber. Eine einzige Quelle ist ein einzelner
 * Ausfallpunkt für den ANKAUFPREIS: fällt sie aus oder liefert sie Unsinn,
 * altert der Kurs still und der Händler kauft zum Kurs von vorgestern. Zwei
 * unabhängige Häuser sind zwei unabhängige Ausfälle.
 *
 * Und die zweite spart bei Gold und Silber die Umrechnung ganz. Genau die
 * Umrechnung hat diesem Haus gemessen 253,50 EUR je Kilogramm Feingold
 * gekostet, immer in dieselbe Richtung, weil der Anbieterkurs kein
 * amtlicher Kurs war.
 *
 * ── UND DIE DRITTE „QUELLE": DER MENSCH ────────────────────────────────────
 *
 * HAND heisst: die Kasse fragt niemanden mehr. Es gilt, was der Inhaber
 * eingetragen hat, so lange, bis er etwas anderes einträgt. Das ist kein
 * Notbehelf, sondern eine gültige Betriebsart: wer einen festen Tageskurs
 * mit seinem Scheideanstalt vereinbart hat, will genau das.
 *
 * ⚠️ Von Hand eintragen geht IMMER, in jeder Betriebsart. Ein Kurs von Hand
 * ist nie gesperrt, weil sonst ein Netzausfall den Laden anhielte.
 */

import { sql as drizzleSql } from 'drizzle-orm';

import type { AppDb } from '@norns/db/client';

/** Der Einstellungsschlüssel für die Metallquelle. */
export const SCHLUESSEL_METALLQUELLE = 'kurs.metall_quelle';

/** Der Einstellungsschlüssel für die Herkunft des Umrechnungskurses. */
export const SCHLUESSEL_FXQUELLE = 'kurs.fx_quelle';

/** Die Kennungen, die der Rumpf kennt. Mehr gibt es nicht. */
/*
 * ⚰️ 18.08.2026: 'HAND' ist gefallen. Basels Anweisung dieses Tages hebt
 * seine eigene vom 02.08. auf („ohne Netz den Kurs von Hand eintragen"):
 * ein Goldpreis wird NICHT mehr von Hand eingetragen. Der POST-Weg
 * antwortet mit 410, der Beipack-Dienst uebergeht einen gespeicherten
 * Altwert laut, und die Kasse bietet die Wahl nicht mehr an.
 */
export const METALLQUELLEN_KENNUNGEN = [
  'GOLDPREIS_DE',
  'GOLD_API',
  'SWISSQUOTE',
] as const;
export type MetallquelleKennung = (typeof METALLQUELLEN_KENNUNGEN)[number];

/** Die Herkünfte des Dollarkurses. */
export const FXQUELLEN_KENNUNGEN = ['EZB', 'ANBIETER'] as const;
export type FxquelleKennung = (typeof FXQUELLEN_KENNUNGEN)[number];

/**
 * Was der Inhaber auf dem Bildschirm liest.
 *
 * Kein Fachwort ohne Übersetzung: `währung` sagt in einem Satz, ob umgerechnet
 * wird, denn genau daran hängt, ob der Dollarkurs überhaupt eine Rolle spielt.
 */
export interface Metallquelle {
  kennung: MetallquelleKennung;
  /** Der Name, unter dem die Quelle bekannt ist. */
  name: string;
  /** Ein Satz: was sie liefert und woher. */
  was: string;
  /** Braucht diese Quelle Netz? HAND nicht. */
  netz: boolean;
  /** Braucht sie einen Umrechnungskurs, und wofür? Leer, wenn nein. */
  waehrung: string;
  /** Welche Metalle sie deckt. Gemessen, nicht aus dem Prospekt. */
  metalle: readonly string[];
}

export const METALLQUELLEN: readonly Metallquelle[] = [
  {
    kennung: 'GOLDPREIS_DE',
    name: 'Deutscher Goldpreis',
    was:
      'Der Kurs, an dem sich der deutsche Edelmetallhandel ausrichtet. Dasselbe Haus ' +
      'stellt ihn maschinenlesbar bereit, ohne Anmeldung, ohne Schlüssel.',
    netz: true,
    waehrung:
      'Alle vier Metalle kommen direkt in Euro. Es wird nichts umgerechnet, der ' +
      'Dollarkurs unten spielt hier also gar keine Rolle.',
    metalle: ['Gold', 'Silber', 'Platin', 'Palladium'],
  },
  {
    kennung: 'GOLD_API',
    name: 'Freier Kursdienst',
    was: 'Ein freier Kursdienst für alle vier Metalle. Ohne Anmeldung, ohne Schlüssel.',
    netz: true,
    waehrung: 'Liefert in Dollar. Wird mit dem Dollarkurs unten in Euro umgerechnet.',
    metalle: ['Gold', 'Silber', 'Platin', 'Palladium'],
  },
  {
    kennung: 'SWISSQUOTE',
    name: 'Swissquote',
    was: 'Der öffentliche Kursstrom einer Schweizer Bank. Ohne Anmeldung, ohne Schlüssel.',
    netz: true,
    waehrung:
      'Gold und Silber kommen direkt in Euro, ganz ohne Umrechnung. Nur Platin und ' +
      'Palladium werden umgerechnet.',
    metalle: ['Gold', 'Silber', 'Platin', 'Palladium'],
  },
];

/**
 * Die Vorgabe. Seit dem 13.08.2026 goldpreis.de.
 *
 * ── BASELS ANWEISUNG VOM 13.08.2026 ──────────────────────────────────────
 *
 * Wörtlich: die meisten Händler in Deutschland richten sich nach
 * `goldpreis.de`, also soll die Kasse genau diesen Kurs nehmen, unverändert,
 * und er soll die VORGABE sein.
 *
 * Das ist keine Geschmacksfrage. Wer im Laden mit einem Kunden über ein
 * Armband verhandelt, hat oft genau diese Seite offen. Zeigt die Kasse eine
 * andere Zahl, steht der Händler vor dem Kunden als der, dessen Gerät falsch
 * rechnet, auch wenn beide Zahlen für sich stimmen.
 *
 * ── UND DIE MESSUNG STÜTZT ES ────────────────────────────────────────────
 *
 * `goldpreis.de` hat keine öffentliche Schnittstelle, und die Seite abzugreifen
 * wäre falsch: sie nennt am Fuss selbst Six Financial Information und
 * Morningstar als Herkunft, also fremde, lizenzierte Daten.
 *
 * DASSELBE HAUS bietet die Zahlen aber frei und maschinenlesbar an, unter
 * `api.edelmetalle.de/public.json`. Gemessen am Handelsregister ist es
 * wirklich dasselbe Haus:
 *
 *     goldpreis.de     Amtsgericht Ulm, HRB 4847
 *     edelmetalle.de   Amtsgericht Ulm, HRB 4847   (ADEOS MEDIA GmbH)
 *
 * Gegenprobe an derselben Zahl, am 13.08.2026 im Abstand einer Minute:
 * die Seite zeigte 3.773,60 EUR je Unze Gold, die Schnittstelle gab 3773.6.
 *
 * Und fachlich ist es ohnehin die beste der drei: ALLE VIER Metalle kommen
 * direkt in Euro. Swissquote schafft das nur für Gold und Silber, gold-api.com
 * für keines. Jede Umrechnung, die entfällt, ist eine Fehlerquelle weniger,
 * und genau diese Umrechnung hat dieses Haus gemessen 253,50 EUR je Kilogramm
 * Feingold gekostet, immer in dieselbe Richtung.
 *
 * ── WARUM VORHER SWISSQUOTE STAND, UND WARUM DAS RICHTIG WAR ─────────────
 *
 * Basels Auftrag vom 11.08.: der Goldpreis MUSS stimmen, das ist fuer einen
 * Edelmetallhaendler keine Anzeigefrage, sondern der Einkaufspreis jedes
 * Ankaufs. Beide Quellen am 11.08. gegeneinander gemessen:
 *
 *     gold-api.com 4398,60 USD je Unze, ueber die EZB-Tagesdatei
 *                  → 3806,66 EUR je Unze
 *     Swissquote   XAU/EUR direkt, Mitte aus Geld und Brief
 *                  → 3809,30 EUR je Unze (Stand auf die Sekunde)
 *
 * In der stillen Nacht nur 0,069 Prozent. Der STRUKTURELLE Fehler des alten
 * Wegs ist die Umrechnung: die amtliche EZB-Datei traegt EINEN Kurs je
 * Werktag (etwa 16 Uhr). Bewegt sich der Dollar tagsueber um ein halbes bis
 * ganzes Prozent, und das tut er an bewegten Tagen, liegt der Goldpreis der
 * Kasse um 600 bis 1200 EUR je Kilogramm daneben, den ganzen Tag, immer in
 * eine Richtung.
 *
 * Swissquote liefert Gold und Silber DIREKT in Euro: die Umrechnung samt
 * ihrer Fehlerquelle entfaellt fuer genau die zwei Metalle, an denen dieses
 * Geschaeft haengt. Platin und Palladium kommen weiter ueber den Dollarweg.
 *
 * Beide bleiben waehlbar. Wer sie will, stellt in den Einstellungen um; kein
 * Wechsel der Vorgabe nimmt einem Haendler eine Quelle weg, die er schon
 * eingestellt hat.
 */
export const METALLQUELLE_VORGABE: MetallquelleKennung = 'GOLDPREIS_DE';

export interface Fxquelle {
  kennung: FxquelleKennung;
  name: string;
  was: string;
}

export const FXQUELLEN: readonly Fxquelle[] = [
  {
    kennung: 'EZB',
    name: 'Europäische Zentralbank',
    was:
      'Der amtliche Referenzkurs, einmal an jedem Bankarbeitstag. Empfohlen: er ist ' +
      'derselbe Kurs, den auch das Finanzamt ansetzt.',
  },
  {
    kennung: 'ANBIETER',
    name: 'Kursanbieter',
    was:
      'Der Kurs des Kursdienstes selbst, dafür minütlich frisch. Er wich gemessen um ' +
      '253,50 Euro je Kilogramm Feingold vom amtlichen Kurs ab, immer in dieselbe Richtung.',
  },
];

/** Die Vorgabe: amtlich. */
export const FXQUELLE_VORGABE: FxquelleKennung = 'EZB';

/** Prüft eine Kennung, ohne zu raten. Unbekanntes wird zur Vorgabe. */
export function metallquelleAus(roh: string | null | undefined): MetallquelleKennung {
  const wert = (roh ?? '').trim().replace(/^"|"$/g, '').trim().toUpperCase();
  return (METALLQUELLEN_KENNUNGEN as readonly string[]).includes(wert)
    ? (wert as MetallquelleKennung)
    : METALLQUELLE_VORGABE;
}

export function fxquelleAus(roh: string | null | undefined): FxquelleKennung {
  const wert = (roh ?? '').trim().replace(/^"|"$/g, '').trim().toUpperCase();
  return (FXQUELLEN_KENNUNGEN as readonly string[]).includes(wert)
    ? (wert as FxquelleKennung)
    : FXQUELLE_VORGABE;
}

/** Holt beide Entscheidungen in EINEM Zugriff. */
export async function leseKurseinstellung(
  db: AppDb,
): Promise<{ metall: MetallquelleKennung; fx: FxquelleKennung }> {
  const zeilen = await db.execute<{ key: string; wert: string | null }>(drizzleSql`
    SELECT key, value #>> '{}' AS wert FROM system_settings
     WHERE key IN (${SCHLUESSEL_METALLQUELLE}, ${SCHLUESSEL_FXQUELLE})`);
  const nach = new Map(zeilen.map((z) => [z.key, z.wert]));
  return {
    metall: metallquelleAus(nach.get(SCHLUESSEL_METALLQUELLE)),
    fx: fxquelleAus(nach.get(SCHLUESSEL_FXQUELLE)),
  };
}

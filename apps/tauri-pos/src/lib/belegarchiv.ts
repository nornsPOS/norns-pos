/**
 * belegarchiv — der Nachdruckvorrat DIESER Kasse.
 *
 * ── DER GEMESSENE FUND (13.08.2026) ────────────────────────────────────────
 *
 * Der Belegspeicher (`state/last-receipt-store.ts`) hielt GENAU EINEN Beleg,
 * nur im Arbeitsspeicher, und überschrieb ihn bedingungslos:
 *
 *     setLastReceipt: (r) => set({ lastReceipt: r })
 *
 * Zwei Dinge folgten daraus, und beide traf der Händler am Tresen:
 *
 *   1. Nach dem NÄCHSTEN Verkauf war der vorige Beleg weg. Der Kunde, der
 *      zwanzig Minuten später mit seinem Bon zurückkam, bekam keinen Nachdruck
 *      mehr — obwohl inzwischen nur ein einziger anderer Kunde kassiert wurde.
 *   2. Ein Neustart der Kasse löschte auch den letzten. Morgens war der
 *      Nachdruckknopf im Kassenbuch grundsätzlich grau.
 *
 * Gleichzeitig versprach der Ankaufdialog wörtlich, der Beleg sei „auch später
 * über die Kasse nachdruckbar" (`AnkaufBezahlenDialog.tsx:1261`). Die Fläche
 * sagte also zu, was der Speicher nicht halten konnte.
 *
 * ── WAS DIESES MODUL IST, UND WAS NICHT ────────────────────────────────────
 *
 * Es ist ein NACHDRUCKVORRAT, kein Archiv im Rechtssinn. Das Archiv der
 * Aufzeichnungen liegt im Server; diese Kasse hält nur die letzten
 * `BELEGARCHIV_HOECHSTZAHL` Belege bereit, damit ein Nachdruck am Tresen ohne
 * Rückfrage geht. Die Obergrenze ist Absicht: sie begrenzt zugleich, wie viele
 * Kunden- und Kassierernamen dauerhaft auf dieser Platte liegen.
 *
 * ⚠️ Eine Route, die einen älteren Beleg vom Server zurückholt, GIBT ES NICHT.
 * Gesucht wurde in `packages/api-client`: `/api/transactions/recent` liefert
 * nur Nummer, Betrag und Zeit (kein Warenkorb, keine Signatur), sonst existiert
 * zu Belegen ausschliesslich Schreibverkehr. Solange das so ist, endet die
 * Nachdruckbarkeit an dieser Obergrenze — und die Flächen müssen genau das
 * sagen, statt mehr zu versprechen.
 *
 * ── DIE GRENZE ZUM SPEICHER IST UNVERTRAUT (Muster P2.6) ───────────────────
 *
 * Wie im `logo-lager`: ein kaputter oder manipulierter Eintrag wird verworfen,
 * nicht durchgereicht. Verworfen wird aber NUR der einzelne Eintrag — eine
 * einzige beschädigte Zeile darf nicht neunundvierzig heile Belege mitnehmen.
 */

import type { ThermalReceiptData } from './hardware-client.js';

export const BELEGARCHIV_SCHLUESSEL = 'warehouse14.belegarchiv.v1';

/**
 * Wie viele Belege bereitliegen.
 *
 * Fünfzig deckt an einem gewöhnlichen Ladentag jeden Kunden ab, der mit seinem
 * Bon zurückkommt, und hält den Eintrag klein genug für den Speicher des
 * Fensters (ohne Logo etwa zwei Kilobyte je Beleg, also rund hundert insgesamt).
 */
export const BELEGARCHIV_HOECHSTZAHL = 50;

// ─────────────────────────────────────────────────────────────────────────
// Die Sätze, die der Mensch liest — EINE Quelle
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wo der Nachdruck wohnt. Steht hier, damit Zusage und Fläche denselben Ort
 * nennen; eine abweichende Kopie im Dialog war genau der Grund, warum die alte
 * Zusage auf einen Knopf zeigte, der nur EINEN Beleg drucken konnte.
 */
export const NACHDRUCK_ORT = 'Dokumente';

/** Die Zusage nach einem gelungenen Druck. */
export const NACHDRUCK_ZUSAGE =
  `Der Beleg bleibt in dieser Kasse gespeichert und ist unter „${NACHDRUCK_ORT}" ` +
  `nachdruckbar, solange er zu den letzten ${BELEGARCHIV_HOECHSTZAHL} gehört.`;

/**
 * Die Zusage, wenn der Belegkopf unvollständig ist.
 *
 * ⚠️ Hier stand vorher „Der Beleg bleibt über die Kasse nachdruckbar." Das war
 * doppelt falsch: der Nachdruck prüft denselben Riegel wie der Erstdruck
 * (`fehlendeBelegangabenAufNutzlast`), also ist er ebenfalls gesperrt. Der Satz
 * sagt jetzt, was WIRKLICH geht — aufgehoben, und druckbar, sobald die fehlende
 * Angabe nachgetragen ist.
 */
export const NACHDRUCK_ZUSAGE_GESPERRT =
  `Der Beleg ist in dieser Kasse aufgehoben. Sobald die fehlende Angabe in den ` +
  `Einstellungen ergänzt ist, lässt er sich unter „${NACHDRUCK_ORT}" drucken.`;

/** Die Zusage, nachdem der Drucker den Beleg nicht angenommen hat. */
export const NACHDRUCK_NACH_DRUCKFEHLER =
  `Drucker prüfen. Der Beleg ist in dieser Kasse aufgehoben und unter ` +
  `„${NACHDRUCK_ORT}" nachdruckbar.`;

/**
 * Der Kopfsatz der Belegliste.
 *
 * ⚠️ GEMESSEN am 13.08.2026. Vorher stand dort:
 *
 *     „Die letzten 50 Belege, die diese Kasse GEDRUCKT hat."
 *
 * Drei Behauptungen, drei Prüfungen:
 *
 *   • „gedruckt" ist FALSCH. In den Vorrat kommt ein Beleg beim ABSCHLUSS,
 *     nicht beim Druck: `BezahlenDialog.tsx:1259` legt ihn im Bauen der
 *     Nutzlast ab, und die Aufrufe stehen in den Abschlusszweigen, den
 *     Offline-Zweig eingeschlossen (`:1495`), wo überhaupt kein Drucker im
 *     Spiel ist. Am Ankaufweg dasselbe (`AnkaufBezahlenDialog.tsx:257`, offline
 *     `:584`). Eine Kasse ganz ohne eingerichteten Drucker füllt diese Liste
 *     also vollständig. Das Wort heisst deshalb „ausgestellt".
 *
 *   • „Die letzten 50" ist eine ÜBERTREIBUNG, solange weniger da sind. Bei
 *     drei Belegen behauptete der Satz einen Vorrat, den es nicht gab. Genannt
 *     wird jetzt die WIRKLICHE Zahl, und die Obergrenze als das, was sie ist.
 *
 *   • „Sie bleiben über einen Neustart hinweg nachdruckbar" gilt nur, solange
 *     die Platte den Vorrat annimmt. `belegeSchreiben` schluckt einen vollen
 *     oder abgeschalteten Speicher bewusst (der Beleg ist da schon gedruckt und
 *     verbucht) und meldet den Fehlschlag nur am Rückgabewert. Ist der einmal
 *     falsch gewesen, sagt der Satz das, statt weiter Dauerhaftigkeit zu
 *     versprechen.
 */
export function belegvorratSatz(anzahl: number, ueberlebtNeustart: boolean): string {
  const bestand =
    anzahl === 0
      ? 'Noch kein Beleg liegt hier bereit.'
      : anzahl === 1
        ? 'Ein Beleg liegt hier bereit, ausgestellt von dieser Kasse.'
        : `${anzahl} Belege liegen hier bereit, ausgestellt von dieser Kasse.`;

  const grenze = `Aufgehoben werden die letzten ${BELEGARCHIV_HOECHSTZAHL}.`;

  const dauer = ueberlebtNeustart
    ? 'Sie überstehen einen Neustart.'
    : 'Achtung: der Speicher dieser Kasse nimmt nichts mehr an. Was seither dazugekommen ist, ist nach einem Neustart nicht mehr da.';

  const server =
    'Ältere Vorgänge sind im Server aufgezeichnet, von hier aus lassen sie sich nicht nachdrucken.';

  return `${bestand} ${grenze} ${dauer} ${server}`;
}

/**
 * Die Leermeldung. Auch sie sagte „gedruckt" und war aus demselben Grund
 * falsch: eine Kasse ohne Drucker stellt trotzdem Belege aus.
 */
export const BELEGVORRAT_LEER = 'Diese Kasse hat noch keinen Beleg ausgestellt.';

// ─────────────────────────────────────────────────────────────────────────
// Die Zeile, die der Mensch sieht
//
// ⚠️ GEMESSEN am 13.08.2026, nachdem die Belegliste zum ersten Mal wirklich
// gerendert wurde (`BelegeDieserKasse.test.ts` rendert sie und liest das HTML):
//
//   1. JEDER Ankaufbeleg zeigte statt des Betrags einen Gedankenstrich. Der
//      Ankaufweg füllt `totalEur` sehr wohl, aber DEUTSCH formatiert:
//      `ankauf-receipt.ts:112` schreibt `formatEuro(...)`, also „1.234,50",
//      weil `ReceiptPreview` das Feld roh aufs Papier setzt. `MoneyAmount`
//      nimmt aber nur die Maschinenschreibweise an (`MoneyAmount.tsx:48`,
//      `^-?\d+(\.\d+)?$`) und zeigt sonst „—". Der Verkaufsweg schreibt
//      `fromCents(...)`, also „1234.50", und traf deshalb nie auf.
//
//   2. Die Zeitspalte zeigte den FALSCHEN TAG. `printedAt` ist bei ALLEN
//      Schreibern schon deutscher Anzeigetext (`BezahlenDialog.tsx:1189`,
//      `ankauf-receipt.ts:93`, `GeraeteManager.tsx:1440`,
//      `Belegdesigner.tsx:952`). `new Date("3.8.2026, 09:15:00")` ergibt in V8
//      aber NICHT „ungültig", sondern den 8. März. Ein Beleg vom 3. August
//      stand als „08.03." in der Liste. Nur die Tage 13 bis 31 fielen auf
//      „ungültig" zurück; an den Tagen 1 bis 12 log die Spalte mit voller
//      Überzeugung.
//
// Daraus die Regel dieses Abschnitts: die Grenze zum Speicher ist unvertraut
// (Muster P2.6), und zwar auch im FORMAT. Zwei Schreiber haben über Monate
// zwei Schreibweisen in dasselbe Feld gelegt; auf der Platte liegen beide
// schon. Also normalisiert der LESER, statt einen Schreiber umzustellen und
// die bereits gespeicherten Einträge kaputt zu lassen.
//
// ⚠️ Hier wird NIRGENDS `new Date` auf gespeicherten Text angewandt, ausser
// der Text ist eindeutiges ISO. Ein mehrdeutiges Datum lieber unverändert
// zeigen als falsch formatiert: ein Gedankenstrich ist ehrlich, ein falscher
// Tag auf einem Beleg ist es nicht.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Genau die Schreibweise, die `MoneyAmount` annimmt (`MoneyAmount.tsx:48`).
 * Steht hier als EINE Regel, damit „was die Anzeige nimmt" und „was der Leser
 * durchlässt" nicht auseinanderlaufen können.
 */
const MASCHINENBETRAG = /^-?\d+(?:\.\d+)?$/;

/** Deutscher Anzeigebetrag: „1.234,50", „119,90", „-8,00". */
const DEUTSCHER_BETRAG = /^(-?)(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/;

/**
 * Einen gespeicherten Betrag auf die Maschinenschreibweise bringen.
 *
 * Die Annahmemenge ist ABSICHTLICH genau die von `MoneyAmount`: was die Anzeige
 * heute schon rendert, geht unverändert durch, und nur der deutsche
 * Anzeigetext wird zusätzlich übersetzt. Eine eigene, engere Regel hier wäre
 * eine ZWEITE Auslegung desselben Feldes, und zwei Auslegungen laufen
 * auseinander: dann zeigte dieselbe Zahl an zwei Stellen der Kasse
 * Verschiedenes.
 *
 * `null` heisst „weder das eine noch das andere". Dann zeigt `MoneyAmount`
 * seinen Platzhalter, und das ist auch richtig so, denn geraten wird nichts.
 */
export function betragKanonisch(roh: string): string | null {
  const s = (roh ?? '').trim();
  if (s.length === 0) return null;
  if (MASCHINENBETRAG.test(s)) return s;

  const de = DEUTSCHER_BETRAG.exec(s);
  if (de === null) return null;
  const [, vorzeichen = '', ganz = '', rest = ''] = de;
  return `${vorzeichen}${ganz.replaceAll('.', '')}.${rest}`;
}

/** Deutscher Zeitstempel, wie ihn `toLocaleString('de-DE')` schreibt. */
const DEUTSCHE_ZEIT = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:,\s*(\d{1,2}):(\d{2}))?/;
/** Eindeutiges ISO. Nur DAS darf an `new Date`. */
const ISO_ZEIT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

function zwei(wert: string | number): string {
  return String(wert).padStart(2, '0');
}

/**
 * Den gespeicherten Zeitstempel als kurze Spalte „TT.MM., HH:MM" zeigen.
 *
 * Was nicht sicher erkannt wird, kommt UNVERÄNDERT zurück. Lieber ein langer
 * Text in der Spalte als ein erfundener Tag.
 */
export function zeitpunktKurz(roh: string): string {
  const s = (roh ?? '').trim();
  if (s.length === 0) return s;

  const de = DEUTSCHE_ZEIT.exec(s);
  if (de) {
    const tag = Number(de[1]);
    const monat = Number(de[2]);
    // Ein unmöglicher Tag ist kein deutscher Stempel. Dann lieber roh zeigen.
    if (tag >= 1 && tag <= 31 && monat >= 1 && monat <= 12) {
      return de[4] === undefined
        ? `${zwei(tag)}.${zwei(monat)}.${de[3]}`
        : `${zwei(tag)}.${zwei(monat)}., ${zwei(de[4])}:${de[5]}`;
    }
  }

  if (ISO_ZEIT.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  }

  return s;
}

/** Eine fertige Zeile der Belegliste. Die Fläche rechnet selbst nichts mehr. */
export interface Belegzeile {
  receiptLocator: string;
  /** Maschinenschreibweise für `MoneyAmount`, oder `null` wenn unlesbar. */
  betragEur: string | null;
  /** Der Betrag, wie er gespeichert ist. Fällt zurück, wenn oben `null` steht. */
  rohbetrag: string;
  /** Kurze Zeitspalte, oder der gespeicherte Text unverändert. */
  zeitpunkt: string;
  art: 'Verkauf' | 'Ankauf';
}

/**
 * Aus einer gespeicherten Nutzlast die Zeile bauen, die auf dem Bildschirm
 * steht. EINE Stelle, damit die Fläche keine eigene zweite Auslegung erfindet.
 */
export function belegZeile(beleg: ThermalReceiptData): Belegzeile {
  return {
    receiptLocator: beleg.receiptLocator,
    betragEur: betragKanonisch(beleg.totalEur),
    rohbetrag: beleg.totalEur,
    zeitpunkt: zeitpunktKurz(beleg.printedAt),
    art: beleg.documentKind === 'ANKAUF' ? 'Ankauf' : 'Verkauf',
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Die Regeln — rein, ohne Speicher
// ─────────────────────────────────────────────────────────────────────────

function istZeichenkette(wert: unknown): wert is string {
  return typeof wert === 'string';
}

function istZeichenkettenListe(wert: unknown): wert is string[] {
  return Array.isArray(wert) && wert.every(istZeichenkette);
}

function istZeichenketteOderNichts(wert: unknown): boolean {
  return wert === null || typeof wert === 'string';
}

function istBelegzeile(wert: unknown): boolean {
  if (typeof wert !== 'object' || wert === null) return false;
  const z = wert as Record<string, unknown>;
  return (
    istZeichenkette(z.name) &&
    typeof z.quantity === 'number' &&
    istZeichenkette(z.unitPriceEur) &&
    istZeichenkette(z.lineTotalEur) &&
    istZeichenkette(z.vatLabel)
  );
}

/**
 * Hält dieser Eintrag eine Belegnutzlast, mit der ein Nachdruck wirklich geht?
 *
 * Geprüft werden die Felder, die `ThermalReceiptData` als PFLICHT führt — also
 * genau das, worauf Vorschau, Steuerriegel und Druckweg zugreifen. Die
 * wahlfreien Felder werden bewusst NICHT einzeln aufgezählt: eine Namensliste
 * wird blind, sobald jemand ein Feld ergänzt. Deshalb reicht die Prüfung den
 * Eintrag unverändert weiter, statt ihn Feld für Feld neu zu bauen.
 */
export function istBelegNutzlast(wert: unknown): wert is ThermalReceiptData {
  if (typeof wert !== 'object' || wert === null) return false;
  const b = wert as Record<string, unknown>;

  // Die Belegnummer ist der Schlüssel des ganzen Vorrats. Ohne sie liesse sich
  // der Eintrag weder finden noch von einem zweiten Druck desselben Belegs
  // unterscheiden.
  if (!istZeichenkette(b.receiptLocator) || b.receiptLocator.length === 0) return false;
  if (!istZeichenkette(b.printedAt) || b.printedAt.length === 0) return false;

  if (!istZeichenkette(b.shopName)) return false;
  if (!istZeichenkettenListe(b.shopAddress)) return false;
  if (!istZeichenkette(b.shopVatId)) return false;
  if (!istZeichenkette(b.shopTaxNumber)) return false;
  if (!istZeichenketteOderNichts(b.shopPhone)) return false;
  if (!istZeichenkette(b.cashierName)) return false;
  if (!istZeichenketteOderNichts(b.shiftId)) return false;

  if (!Array.isArray(b.items) || !b.items.every(istBelegzeile)) return false;
  if (!istZeichenkette(b.subtotalEur)) return false;
  if (!istZeichenkette(b.vatEur)) return false;
  if (!istZeichenkette(b.totalEur)) return false;
  if (!istZeichenkette(b.paymentMethodLabel)) return false;
  if (!istZeichenketteOderNichts(b.cashReceivedEur)) return false;
  if (!istZeichenketteOderNichts(b.changeEur)) return false;

  if (!istZeichenkette(b.tseSignatureValue)) return false;
  if (!istZeichenkette(b.tseSignatureCounter)) return false;
  if (!istZeichenkette(b.tseTransactionNumber)) return false;
  if (!istZeichenkette(b.tseQrPayload)) return false;
  if (!istZeichenkettenListe(b.footerLines)) return false;

  return true;
}

/**
 * Das Logo aus der Nutzlast NEHMEN, bevor sie auf die Platte geht.
 *
 * Zwei Gründe, und der zweite ist der wichtigere:
 *   • Ein Logo darf 256 KB gross sein (die Servergrenze). Fünfzig Belege mit
 *     Logo sprengen jeden Fensterspeicher; ohne Logo bleiben es Kilobytes.
 *   • `thermalClient.print` hängt das Logo ZENTRAL an, aber nur wenn das Feld
 *     `undefined` ist (`mitLogo`, hardware-client.ts:637). Ein gespeichertes
 *     `null` würde den Nachdruck also dauerhaft ohne Bild lassen. Deshalb wird
 *     der Schlüssel ENTFERNT, nicht auf `null` gesetzt.
 *
 * Folge, bewusst in Kauf genommen: der Nachdruck trägt das HEUTE hinterlegte
 * Logo. Das Logo ist keine Pflichtangabe eines Belegs; die Ladenidentität auf
 * dem Beleg bleibt die gespeicherte.
 */
function ohneLogo(beleg: ThermalReceiptData): ThermalReceiptData {
  const { logoBytesBase64: _b, logoFormat: _f, logoSize: _s, ...rest } = beleg;
  return rest as ThermalReceiptData;
}

/**
 * Einen Beleg vorn einreihen.
 *
 * • Derselbe Beleg zweimal (ein zweiter Druckversuch, ein Wiederholungslauf)
 *   ergibt EINEN Eintrag — verglichen wird die Belegnummer.
 * • Der neue steht vorn, weil am Tresen fast immer der jüngste gesucht wird.
 * • Über der Obergrenze fällt der ÄLTESTE heraus, nie der neue.
 */
export function belegEinreihen(
  vorhanden: readonly ThermalReceiptData[],
  neu: ThermalReceiptData,
  hoechstzahl: number = BELEGARCHIV_HOECHSTZAHL,
): ThermalReceiptData[] {
  const schlank = ohneLogo(neu);
  const ohneDoppel = vorhanden.filter((b) => b.receiptLocator !== schlank.receiptLocator);
  return [schlank, ...ohneDoppel].slice(0, Math.max(1, hoechstzahl));
}

/**
 * Einen Beleg an seiner Nummer holen.
 *
 * ⚠️ Diese Funktion wird von der Oberfläche NICHT gerufen: die Belegliste sucht
 * mit `filtereBelege` (der einen Suchregel des Hauses, die auch Teilstücke und
 * Beträge trifft) und trägt die Nutzlast gleich in der Zeile. Sie steht hier als
 * Prüfwerkzeug der Regeln oben — nicht als zweiter, ungenutzter Weg in die
 * Oberfläche.
 */
export function belegAnNummer(
  belege: readonly ThermalReceiptData[],
  nummer: string,
): ThermalReceiptData | null {
  return belege.find((b) => b.receiptLocator === nummer) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────
// Die Platte
// ─────────────────────────────────────────────────────────────────────────

function standardLager(): Storage | null {
  return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
}

/**
 * Gibt es überhaupt eine Platte?
 *
 * Ist der Speicher des Fensters abgeschaltet, überlebt KEIN Beleg einen
 * Neustart, und das steht schon beim Start fest. Die Belegliste verspricht
 * Dauerhaftigkeit deshalb erst, wenn diese Frage mit Ja beantwortet ist. Ohne
 * die Frage log der Kopfsatz vom ersten Rendern an.
 */
export function plattenVorhanden(lager: Storage | null = standardLager()): boolean {
  return lager !== null;
}

/**
 * Den Vorrat lesen. Alles, was nicht als Beleg durchgeht, fällt einzeln weg.
 * Ist gar nichts lesbar, kommt eine leere Liste — nie eine Ausnahme: der
 * Nachdruck ist Komfort, er darf den Start der Kasse nicht aufhalten.
 */
export function belegeLesen(lager: Storage | null = standardLager()): ThermalReceiptData[] {
  let roh: string | null;
  try {
    roh = lager?.getItem(BELEGARCHIV_SCHLUESSEL) ?? null;
  } catch {
    return [];
  }
  if (roh === null) return [];

  let wert: unknown;
  try {
    wert = JSON.parse(roh);
  } catch {
    return [];
  }
  if (!Array.isArray(wert)) return [];

  return wert.filter(istBelegNutzlast).slice(0, BELEGARCHIV_HOECHSTZAHL);
}

/**
 * Den Vorrat schreiben.
 *
 * Ein voller oder abgeschalteter Speicher darf keinen Verkauf stoppen: der
 * Beleg ist in diesem Moment schon gedruckt und beim Server verbucht. Deshalb
 * wird der Fehlschlag geschluckt — und der Aufrufer erfährt ihn am
 * Rückgabewert, falls er ihn anzeigen will.
 *
 * Gibt `true` zurück, wenn der Vorrat wirklich auf der Platte liegt.
 */
export function belegeSchreiben(
  belege: readonly ThermalReceiptData[],
  lager: Storage | null = standardLager(),
): boolean {
  if (lager === null) return false;
  try {
    lager.setItem(BELEGARCHIV_SCHLUESSEL, JSON.stringify(belege));
    return true;
  } catch {
    return false;
  }
}

/** Den ganzen Vorrat löschen. */
export function belegeLoeschen(lager: Storage | null = standardLager()): void {
  try {
    lager?.removeItem(BELEGARCHIV_SCHLUESSEL);
  } catch {
    /* Speicher abgeschaltet — mehr ist hier nicht zu tun. */
  }
}

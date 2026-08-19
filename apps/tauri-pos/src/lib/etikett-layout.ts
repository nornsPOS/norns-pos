/**
 * Der Bauplan des Etiketts — in Millimetern, ohne Leinwand und ohne Drucker.
 *
 * ── WAS BASEL WOLLTE (25.07.2026) ──────────────────────────────────────────
 * „مافي بار كود يقراه السكنر ومساحة الملصق غير مستغلّة … حط بار كود يقراه
 *  السكنر وكيو ار كود صغير للعمليات الداخليه داخل المخزون بحيث يكون اليبل
 *  انيق مرتب وتقني عميق ومنضم"
 *
 * Zwei Codes auf einem Etikett, mit verschiedenen Aufgaben:
 *
 *   • Der STRICHCODE wird vom Handscanner am Tresen gelesen, und der kann nur
 *     eine Zeile Text zurückgeben. Genau diese eine Zeile löst die Kasse auf.
 *   • Der QR trägt einen internen Verweis für das Lager. Er ist klein, weil er
 *     nicht über den Tresen muss, sondern aus der Hand am Regal.
 *
 * ── UND WAS AM 26.07.2026 DAZUKAM ──────────────────────────────────────────
 * Der Drucker kann zehn Grössen, nicht eine. Der Inhaber soll je Artikel
 * wählen: ein Kapselfähnchen für die kleine Münze, das Haus-Etikett fürs
 * Regal, ein grosses für die Schatulle. Deshalb kennt dieser Bauplan jetzt
 * DREI Familien statt einer festen Tabelle, und er rechnet mit der
 * BEDRUCKBAREN Fläche statt mit dem Papiermass.
 *
 * ── WARUM DAS HIER GERECHNET WIRD UND NICHT GEZEICHNET ─────────────────────
 * Ein Etikett ist eine Geometrie-Aufgabe, keine Zeichen-Aufgabe. Ob der
 * Strichcode auf das Papier passt und ob seine schmalste Linie noch lesbar
 * ist, entscheidet sich in Zahlen — lange bevor Farbe fliesst. Deshalb liefert
 * dieses Modul nur PRIMITIVE (Rechtecke, Linien, Text) mit Millimeter-Koordinaten.
 * Wer daraus ein Bild malt, ist eine andere Datei, und die Prüfungen brauchen
 * dafür keinen Drucker.
 */

import { ETIKETT_SCHEMA } from './marke.js';
import { code128BalkenBreiten } from './code128.js';
import {
  type EtikettMasse,
  type EtikettMedium,
  ausDruckpunkten,
  inDruckpunkte,
  mediumFuer,
  standardMedium,
} from './etikett-groessen.js';
import { type QrGitter, qrGitter } from './qr.js';

export type { EtikettMasse } from './etikett-groessen.js';
export { DRUCKPUNKT_MM } from './etikett-groessen.js';

/**
 * Die schmalste Linie, die ein gewöhnlicher Handscanner am Tresen noch sicher
 * liest.
 *
 * Bei 300 dpi ist ein Druckpunkt 0,0847 mm. Drei Punkte sind 0,254 mm — das
 * ist die verbreitete Untergrenze für Code128 auf Thermopapier. Darunter
 * verschmiert der Thermodruck die Lücken, und der Scanner piept nicht mehr.
 * Diese Zahl ist deshalb eine Grenze, kein Vorschlag.
 */
export const SCHMALSTE_LINIE_MM = 0.254;

/** Die Ruhezone links und rechts vom Strichcode, in Modulen. Norm: 10. */
export const RUHEZONE_MODULE = 10;

/**
 * ── FUND 1: JEDES MODUL MUSS EIN GANZES VIELFACHES EINES DRUCKPUNKTS SEIN ──
 *
 * Vorher wurde die Modulbreite als `spalte / gesamtModule` gerechnet, also
 * krumm — etwa 0,3172 mm. Der Thermokopf kennt aber nur ganze Punkte und
 * rundet jede Kante EINZELN. Aus lauter gleich breiten Balken werden dann
 * abwechselnd drei und vier Punkte, und die schmalste Linie ist mal 0,254 mm,
 * mal 0,339 mm. Genau das sieht ein Scanner als Rauschen.
 *
 * Deshalb wird die Modulbreite hier auf ganze Druckpunkte gerastet. Drei Punkte
 * sind die Untergrenze (0,254 mm); mehr als acht (0,677 mm) bringt keinem
 * Scanner etwas und frisst nur Etikett.
 */
export const MODUL_MINDESTPUNKTE = 3;
export const MODUL_HOECHSTPUNKTE = 8;

/**
 * Wie fein ein QR-Punkt werden darf, in Druckpunkten.
 *
 * Vier Punkte sind 0,339 mm. Das ist die Kante, an der ein Telefon aus der
 * Hand am Regal noch zuverlässig entziffert. Wird es enger, wird der QR
 * WEGGELASSEN statt geschrumpft: ein Code, der nicht liest, ist schlimmer als
 * kein Code, weil ihn jemand am Regal trotzdem versucht.
 */
export const QR_MINDESTPUNKTE = 4;

/** Versalhöhe als Anteil des Gevierts, je Schrift. */
const VERSAL = { mono: 0.562, sans: 0.717 } as const;

/**
 * Wie tief eine Unterlänge unter die Grundlinie reicht, als Anteil des GEVIERTS.
 *
 * ── FUND 2: 0,23 GEVIERT, NICHT 0,23 VERSALHÖHE ────────────────────────────
 * Der Unterschied klingt nach Haarspalterei und ist keiner: bei der
 * Festbreitenschrift ist die Versalhöhe nur 0,562 Geviert, das „g" hängt also
 * fast doppelt so tief, wie eine Rechnung auf Versalhöhe glauben macht. In der
 * alten Zonentabelle stiess die Artikelnummer deshalb rechnerisch knapp an die
 * Namenszeile, obwohl sie sie in Wahrheit berührte.
 */
const UNTERLAENGE_GEVIERT = 0.23;

export function unterlaengeMm(hoeheMm: number, schrift: 'mono' | 'sans'): number {
  return UNTERLAENGE_GEVIERT * (hoeheMm / VERSAL[schrift]);
}

export interface EtikettInhalt {
  /** Die Artikelnummer. Sie steht im Klartext und im QR. */
  sku: string;
  /**
   * Der kurze Code, den das kleine Etikett als Strichcode trägt.
   *
   * ── WARUM ES DEN ÜBERHAUPT GIBT ──────────────────────────────────────────
   * Auf 40,3 mm bedruckbarer Länge passen höchstens elf Zeichen als lesbarer
   * Code. Artikelnummern in diesem Haus sind regelmässig länger
   * („GLD-2026-00817"). Ein Stück ohne Strichcode ist am Tresen aber ein
   * Ärgernis. Der Kurzcode löst das: er hängt am Artikel, nicht an der Nummer.
   *
   * Fehlt er, wird NICHTS erfunden — dann versucht der Bauplan die
   * Artikelnummer, und wenn die zu lang ist, sagt er das und druckt keinen
   * Strichcode. Ein selbst ausgedachter Code sähe echt aus und liesse sich in
   * keiner Datenbank auflösen.
   */
  kurzcode?: string | undefined;
  /** Der Name, wie er am Regal gelesen wird. Wird bei Bedarf gekürzt. */
  name: string;
  /** Gewicht in Gramm als Text, z. B. „4.2000". Leer lassen, wenn kein Metall. */
  gewichtGramm?: string | undefined;
  /** Feingehalt, z. B. „585". */
  karat?: string | undefined;
  /** Wo das Stück liegt, z. B. „Tresor-1 / Fach-3". */
  lagerort?: string | undefined;
  /**
   * Der Verkaufspreis in Euro als Text, z. B. „890.00".
   *
   * Er steht GROSS und FETT auf dem Etikett — das ist die Zahl, für die ein
   * Mensch stehen bleibt. Fehlt er, steht dort „in Bewertung" statt einer
   * leeren Zone: ein Stück ohne Preis ist ein Zustand, kein Loch.
   */
  preisEur?: string | undefined;
}

export type Ton = 'tinte' | 'blass';

export type Primitiv =
  | { art: 'rechteck'; x: number; y: number; breite: number; hoehe: number; ton: Ton }
  | {
      art: 'text';
      x: number;
      y: number;
      /** Die Grundlinie liegt bei `y`; die Höhe meint die Versalhöhe. */
      text: string;
      hoeheMm: number;
      schrift: 'mono' | 'sans';
      fett: boolean;
      anker: 'links' | 'rechts';
      /** Sperrung zwischen den Zeichen, in Millimetern. */
      sperrung?: number;
      ton: Ton;
    };

/**
 * Die belegten Blöcke — Strichcode und QR als EIN Kasten statt als hundert
 * Rechtecke.
 *
 * Nur damit lässt sich prüfen, dass kein Text auf einem Code landet. Über die
 * Einzelbalken geht das nicht: die berühren einander von Natur aus, eine
 * Kollisionsprüfung darüber wäre immer rot.
 */
export interface EtikettFlaeche {
  art: 'strichcode' | 'qr';
  x: number;
  y: number;
  breite: number;
  hoehe: number;
}

export type Bauplanfamilie = 'klein' | 'standard' | 'gross';

export interface EtikettPlan {
  masse: EtikettMasse;
  primitive: Primitiv[];
  /**
   * Die tatsächlich gewählte Modulbreite des Strichcodes, in Millimetern.
   *
   * FEHLT, wenn kein Strichcode gedruckt wird. Das ist Absicht und deckt sich
   * mit der Rust-Seite (`Option<f64>`): eine Null wäre dort eine Modulbreite
   * unter der Lesbarkeitsgrenze und würde den ganzen Stapel blockieren.
   */
  modulbreiteMm?: number | undefined;
  /**
   * Wie viele Module der Strichcode belegt — OHNE Ruhezone.
   *
   * Früher war die Ruhezone eingerechnet. Sie wird jetzt nicht mehr aus der
   * Druckfläche genommen (siehe `waehleStrichcode`), also gehört sie auch
   * nicht in diese Zahl.
   */
  strichcodeModule: number;
  /** Der Inhalt des QR — sichtbar gemacht, damit ihn eine Prüfung lesen kann. */
  qrInhalt: string;
  /** Welche der drei Familien diesen Plan gebaut hat. */
  familie: Bauplanfamilie;
  /** Was der Strichcode trägt: der Kurzcode oder die Artikelnummer. */
  strichcodeText: string;
  /**
   * Warum KEIN Strichcode auf dem Etikett steht.
   *
   * Ein Satz für den Menschen am Tresen, nicht für ein Protokoll. Ist er
   * gesetzt, soll die Oberfläche diese Grösse gar nicht erst anbieten.
   */
  sperrgrund?: string | undefined;
  /** Die belegten Blöcke, für die Kollisionsprüfung. */
  flaechen: EtikettFlaeche[];
}

/**
 * Das Etikett, das an dieser Maschine als Vorgabe eingelegt ist: DYMO 99010.
 *
 * ── FUND 3: HIER STAND DAS PAPIERMASS ──────────────────────────────────────
 * Bis zum 26.07.2026 stand hier 88,9 × 28,6 mm. Das ist das PAPIER. Der
 * Thermokopf erreicht davon nur 78,4 × 27,2 mm — seitlich fehlen 0,7 mm, an
 * beiden Enden der Laufrichtung je 5,3 mm. Ein Bauplan auf dem Papiermass
 * musste also von der Druckseite verkleinert werden, und mit ihm schrumpfte
 * der Strichcode: aus 0,254 mm schmalsten Linien wurden 0,224 mm. Am Tresen
 * war das der Code, den die Kassiererin dreimal über das Glas zieht.
 *
 * Jetzt steht hier die bedruckbare Fläche, direkt aus der Treiberdatei
 * gerechnet. Die Einpassung auf der Rust-Seite ergibt damit sauber 1,0.
 */
export const DYMO_99010: EtikettMasse = standardMedium().bedruckbar;

/**
 * Der interne Verweis im QR.
 *
 * Bewusst KURZ: jedes Zeichen mehr vergrössert das Gitter, und ein grösseres
 * Gitter bedeutet auf gleichbleibender Fläche kleinere Punkte. „norns://p/SKU"
 * bleibt bei üblichen Artikelnummern in Version 2 (25 × 25).
 *
 * Er trägt KEINEN Preis und keine Kundendaten. Ein Etikett klebt am Regal und
 * ist für jeden sichtbar, der im Laden steht.
 */
export function qrVerweis(sku: string): string {
  return `${ETIKETT_SCHEMA}p/${sku}`;
}

/**
 * Wie breit wird dieser Text ungefähr?
 *
 * Eine Schätzung, aber eine belastbare: die Festbreitenschrift ist exakt
 * 0,6 Geviert je Zeichen, bei der Grotesk sind 0,58 für Grossbuchstaben und
 * Ziffern grosszügig gerechnet. Sie dient dem Kollisionsschutz — und dort ist
 * grosszügig die richtige Richtung, weil eine Überschneidung auf Papier nicht
 * mehr zu heilen ist.
 */
export function textbreiteMm(
  text: string,
  hoeheMm: number,
  schrift: 'mono' | 'sans',
  sperrung = 0,
): number {
  const geviert = hoeheMm / VERSAL[schrift];
  if (schrift === 'mono') return text.length * (0.6 * geviert + sperrung);

  // Bei der Grotesk je Zeichenklasse. Ein pauschaler Mittelwert war zu grob:
  // „14,50 g · 585" besteht fast nur aus Ziffern und Zwischenräumen und wurde
  // damit um ein Drittel zu breit gerechnet — die Feinheit „585" flog vom
  // Etikett, obwohl reichlich Platz war.
  let em = 0;
  for (const z of text) {
    if (z === ' ') em += 0.278;
    else if (/[.,:;·'`!|]/.test(z)) em += 0.3;
    else if (/[0-9]/.test(z)) em += 0.556;
    else if (/[A-ZÄÖÜ]/.test(z)) em += 0.7;
    else if (/[a-zäöüß]/.test(z)) em += 0.54;
    else em += 0.6;
  }
  return em * geviert + text.length * sperrung;
}

/**
 * Auf eine BREITE kürzen, nicht auf eine Zeichenzahl.
 *
 * „Armband Gelbgold mit Karabiner" und „WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW" haben
 * dieselbe Zeichenzahl und sehr verschiedene Breiten. Wer nach Zeichen kürzt,
 * schiebt den einen über den Rand und lässt beim anderen Platz liegen.
 */
function kuerzenAufBreite(
  text: string,
  maxMm: number,
  hoeheMm: number,
  schrift: 'mono' | 'sans',
): string {
  if (textbreiteMm(text, hoeheMm, schrift) <= maxMm) return text;
  let n = text.length;
  while (n > 1 && textbreiteMm(`${text.slice(0, n)}…`, hoeheMm, schrift) > maxMm) n--;
  return `${text.slice(0, n).trimEnd()}…`;
}

/** Den Text in Zeilen brechen, die je in die Zone passen. */
function zeilenBrechen(
  text: string,
  zoneMm: number,
  hoeheMm: number,
  schrift: 'mono' | 'sans',
): string[] {
  const woerter = text.split(/\s+/).filter((w) => w.length > 0);
  const zeilen: string[] = [];
  let aktuell = '';
  for (const wort of woerter) {
    const versuch = aktuell === '' ? wort : `${aktuell} ${wort}`;
    if (textbreiteMm(versuch, hoeheMm, schrift) <= zoneMm) {
      aktuell = versuch;
      continue;
    }
    if (aktuell !== '') {
      zeilen.push(aktuell);
      aktuell = '';
    }
    // Ein einzelnes Wort, das allein zu breit ist, wird hart getrennt. Das ist
    // hässlich, aber ehrlicher als ein Wort, das über den Rand läuft.
    let rest = wort;
    while (rest.length > 1 && textbreiteMm(rest, hoeheMm, schrift) > zoneMm) {
      let n = rest.length;
      while (n > 1 && textbreiteMm(rest.slice(0, n), hoeheMm, schrift) > zoneMm) n--;
      zeilen.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    aktuell = rest;
  }
  if (aktuell !== '') zeilen.push(aktuell);
  return zeilen.length > 0 ? zeilen : [''];
}

/**
 * Den Namen auf höchstens `maxZeilen` Zeilen bringen.
 *
 * Erst wird die Schrift kleiner, und erst wenn auch das nicht mehr reicht,
 * wird gekürzt. Das ist dieselbe Regel wie überall auf diesem Etikett: nicht
 * die Position passt sich an, sondern die Grösse.
 */
function umbrechen(
  text: string,
  zoneMm: number,
  wunschHoehe: number,
  schrift: 'mono' | 'sans',
  maxZeilen: number,
  boden: number,
): { zeilen: string[]; hoeheMm: number } {
  let h = wunschHoehe;
  for (;;) {
    const z = zeilenBrechen(text, zoneMm, h, schrift);
    if (z.length <= maxZeilen) return { zeilen: z, hoeheMm: h };
    if (h <= boden + 1e-9) {
      const behalten = z.slice(0, maxZeilen);
      behalten[maxZeilen - 1] = kuerzenAufBreite(z.slice(maxZeilen - 1).join(' '), zoneMm, h, schrift);
      return { zeilen: behalten, hoeheMm: h };
    }
    h = Math.max(boden, Math.round((h - 0.05) * 100) / 100);
  }
}

/**
 * Eine Versalhöhe finden, mit der der Text in seine Zone passt.
 *
 * Verkleinert nur, vergrössert nie: die Wunschgrösse ist die Regel, das
 * Schrumpfen die Ausnahme. Unter `mindestens` wird nicht mehr verkleinert —
 * dann ist der Text schlicht zu lang und wird gekürzt, denn eine Zeile, die
 * niemand mehr lesen kann, hilft am Regal nicht.
 */
function passeEin(
  text: string,
  zoneMm: number,
  wunschHoehe: number,
  schrift: 'mono' | 'sans',
  sperrung = 0,
  mindestens = 1.6,
): number {
  let h = wunschHoehe;
  while (h > mindestens && textbreiteMm(text, h, schrift, sperrung) > zoneMm) h -= 0.05;
  return Math.max(mindestens, Math.round(h * 100) / 100);
}

/**
 * Den Preis so schreiben, wie er am Regal gelesen wird.
 *
 * ── FUND 4: „890,00 €" KOSTET VERSALHÖHE, DIE ES NICHT ZU VERSCHENKEN GIBT ─
 * Die drei Zeichen „,00" sind auf dem kleinen Etikett rund ein Viertel der
 * Preisbreite. Weil der Preis in seiner Zone schrumpft, statt sie zu
 * verlassen, kostet jedes überflüssige Zeichen echte Millimeter Schriftgrösse.
 * Volle Euro werden deshalb ohne Cent gesetzt: „890 €". Sind Cent da, stehen
 * sie da — weggelassen wird nur, was null ist.
 */
export function preisText(preisEur: string): string {
  const zahl = Number(preisEur);
  if (!Number.isFinite(zahl)) return `${preisEur} €`;
  // Tausenderpunkt nach deutscher Schreibweise, damit „12.900 €" auf einen
  // Blick als ein Betrag lesbar ist und nicht als zwei Zahlen.
  const [ganz, bruch] = zahl.toFixed(2).split('.');
  const mitPunkt = (ganz ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return bruch === '00' ? `${mitPunkt} €` : `${mitPunkt},${bruch} €`;
}

/** Was in der Preiszone steht, wenn es noch keinen Preis gibt. */
export const OHNE_PREIS = 'in Bewertung';

// ───────────────────────────────────────────────────────────────────────────
// Der Strichcode
// ───────────────────────────────────────────────────────────────────────────

interface Strichcodewahl {
  breiten: number[];
  module: number;
  modulbreiteMm: number;
  vonX: number;
  breiteMm: number;
}

/**
 * Die Modulbreite wählen — oder ehrlich sagen, dass es nicht geht.
 *
 * ── FUND 5: DER ÜBERSTAND, DER AUF DEM BILDSCHIRM RICHTIG AUSSAH ───────────
 * Vorher stand hier:
 *
 *     const modulbreiteMm = Math.max(SCHMALSTE_LINIE_MM, spalte / gesamtModule);
 *
 * Das klemmt nach UNTEN ab und macht den Code damit nicht enger, sondern
 * BREITER als seine Spalte. Nachgerechnet: auf der linken Spalte von 66,4 mm
 * ergab eine 22-stellige Artikelnummer einen Code von 75,4 mm — 9,0 mm über
 * dem Rand. Auf dem kleinen Etikett (40,3 mm) waren es bei zwölf Zeichen
 * 47,5 mm, also 7,2 mm Überstand. In der Vorschau sah beides richtig aus, weil
 * dort nichts abgeschnitten wird; erst der Drucker verschluckt das Ende. Ein
 * Code ohne sein Schlusszeichen wird von keinem Scanner gelesen, und ihm sieht
 * man das am Regal nicht an.
 *
 * ── FUND 6: DIE RUHEZONE DARF IM UNBEDRUCKBAREN WEISS LIEGEN ───────────────
 * Die 5,256 mm an jedem Ende der Laufrichtung sind weisses Etikettenpapier vor
 * dem Stanzschnitt — nur ausserhalb der Reichweite des Kopfes. Eine Ruhezone
 * verlangt WEISS, nicht Druckfläche. Vorher wurden zweimal zehn Module aus der
 * Druckfläche geschnitten, obwohl direkt daneben ein Vielfaches davon weiss
 * lag. Auf dem kleinen Etikett hob das die Obergrenze von acht auf elf Zeichen
 * und erlaubte einem sechsstelligen Code vier Druckpunkte je Modul (0,339 mm,
 * 133 Prozent der Lesbarkeitsgrenze) statt drei.
 */
function waehleStrichcode(
  text: string,
  zoneVonX: number,
  zoneBisX: number,
  weissLinksMm: number,
  weissRechtsMm: number,
  ausrichtung: 'links' | 'mitte',
): { ok: true; wahl: Strichcodewahl } | { ok: false; grund: string } {
  const breiten = code128BalkenBreiten(text);
  const module = breiten.reduce((a, b) => a + b, 0);
  const zone = zoneBisX - zoneVonX;

  const hoechst = Math.min(MODUL_HOECHSTPUNKTE, inDruckpunkte(zone / module));
  for (let punkte = hoechst; punkte >= MODUL_MINDESTPUNKTE; punkte--) {
    const modulbreiteMm = ausDruckpunkten(punkte);
    const breiteMm = module * modulbreiteMm;
    if (breiteMm > zone + 1e-9) continue;
    const rest = zone - breiteMm;
    const vonX = ausrichtung === 'mitte' ? zoneVonX + rest / 2 : zoneVonX;
    const noetig = RUHEZONE_MODULE * modulbreiteMm;
    const weissLinks = vonX - zoneVonX + weissLinksMm;
    const weissRechts = zoneBisX - (vonX + breiteMm) + weissRechtsMm;
    if (weissLinks + 1e-9 < noetig || weissRechts + 1e-9 < noetig) continue;
    return { ok: true, wahl: { breiten, module, modulbreiteMm, vonX, breiteMm } };
  }

  const schmalste = module * SCHMALSTE_LINIE_MM;
  const grund =
    schmalste > zone
      ? `„${text}" braucht als Strichcode mindestens ${schmalste.toFixed(1)} mm, hier stehen nur ${zone.toFixed(1)} mm zur Verfügung. Ein kürzerer Code oder ein grösseres Etikett löst das.`
      : `„${text}" passt als Strichcode nur ohne die nötige Ruhezone auf dieses Etikett. Gedruckt läse ihn kein Scanner. Ein kürzerer Code oder ein grösseres Etikett löst das.`;
  return { ok: false, grund };
}

// ───────────────────────────────────────────────────────────────────────────
// Der QR
// ───────────────────────────────────────────────────────────────────────────

interface Qrwahl {
  gitter: QrGitter;
  punkteJeModul: number;
  kantePunkte: number;
  kanteMm: number;
}

/**
 * Die QR-Kante auf ganze Druckpunkte je Modul rasten.
 *
 * Dieselbe Begründung wie beim Strichcode: ein QR-Punkt, der 6,3 Druckpunkte
 * breit ist, wird vom Kopf abwechselnd als 6 und als 7 gesetzt. Aus dem
 * regelmässigen Gitter wird ein leicht welliges, und genau daran scheitern
 * Telefone bei schlechtem Licht.
 */
function waehleQr(text: string, wunschKanteMm: number): Qrwahl | undefined {
  if (wunschKanteMm <= 0) return undefined;
  const gitter = qrGitter(text);
  const punkteJeModul = Math.floor(inDruckpunkte(wunschKanteMm) / gitter.groesse);
  if (punkteJeModul < QR_MINDESTPUNKTE) return undefined;
  const kantePunkte = punkteJeModul * gitter.groesse;
  return { gitter, punkteJeModul, kantePunkte, kanteMm: ausDruckpunkten(kantePunkte) };
}

/** Das QR-Gitter als möglichst wenige Rechtecke. */
function qrPrimitive(wahl: Qrwahl, linksX: number, obenY: number): Primitiv[] {
  const p: Primitiv[] = [];
  const { gitter } = wahl;
  const punkt = ausDruckpunkten(wahl.punkteJeModul);
  for (let zeile = 0; zeile < gitter.groesse; zeile++) {
    // Waagerechte Läufe zusammenfassen: aus 25 Einzelpunkten werden wenige
    // Rechtecke. Das spart nicht nur Bytes — aneinandergrenzende Rechtecke
    // zeigen beim Rastern sonst Haarrisse zwischen den Punkten.
    let start = -1;
    for (let spalte = 0; spalte <= gitter.groesse; spalte++) {
      // `module` ist EINE flache Reihe, nicht ein Gitter aus Zeilen.
      const gesetzt =
        spalte < gitter.groesse && gitter.module[zeile * gitter.groesse + spalte] === true;
      if (gesetzt && start === -1) start = spalte;
      if (!gesetzt && start !== -1) {
        p.push({
          art: 'rechteck',
          x: linksX + start * punkt,
          y: obenY + zeile * punkt,
          breite: (spalte - start) * punkt,
          hoehe: punkt,
          ton: 'tinte',
        });
        start = -1;
      }
    }
  }
  return p;
}

/**
 * Was in der Strichcode-Zone steht, wenn kein Strichcode gedruckt wird.
 *
 * ── WARUM DA ÜBERHAUPT ETWAS STEHT ─────────────────────────────────────────
 * Der Bauplan verweigert den Code jetzt ehrlich, statt ihn über den Rand
 * laufen zu lassen. Damit kommt aber ein Etikett aus dem Drucker, auf dem an
 * der gewohnten Stelle NICHTS ist — und das sieht am Regal aus wie ein
 * Druckfehler. Der Sperrgrund steht im Bauplan und kann von der Oberfläche
 * angezeigt werden; auf dem Papier bleibt davon nur dieser eine Satz, damit
 * niemand das Etikett wegwirft und neu druckt.
 */
function ohneStrichcode(vonX: number, bisX: number, obenY: number, bandhoehe: number): Primitiv[] {
  const platz = bandhoehe / (1 + UNTERLAENGE_GEVIERT / VERSAL.sans) - 0.1;
  if (platz < 1.4) return [];
  const text = 'kein Strichcode';
  const hoehe = passeEin(text, bisX - vonX, Math.min(2.2, platz), 'sans', 0, 1.4);
  return [
    {
      art: 'text',
      x: vonX,
      y: obenY + hoehe,
      text,
      hoeheMm: hoehe,
      schrift: 'sans',
      fett: false,
      anker: 'links',
      ton: 'blass',
    },
  ];
}

/** Die Balken eines Strichcodes als Rechtecke. */
function strichcodePrimitive(wahl: Strichcodewahl, obenY: number, hoehe: number): Primitiv[] {
  const p: Primitiv[] = [];
  let x = wahl.vonX;
  let tinte = true; // Code128 beginnt IMMER mit einem Balken.
  for (const b of wahl.breiten) {
    const w = b * wahl.modulbreiteMm;
    if (tinte) p.push({ art: 'rechteck', x, y: obenY, breite: w, hoehe, ton: 'tinte' });
    x += w;
    tinte = !tinte;
  }
  return p;
}

// ───────────────────────────────────────────────────────────────────────────
// Familie KLEIN — das Kapselfähnchen
// ───────────────────────────────────────────────────────────────────────────

/**
 * Das Kapselfähnchen für kleine Münzen und kleine Stücke (w54h144 und
 * Verwandte).
 *
 * ── DIE SENKRECHTE AUFTEILUNG, IN DRUCKPUNKTEN GERECHNET ───────────────────
 * Auf 17,639 mm Bahnbreite passen 208 Druckpunkte. Verteilt werden 207:
 *
 *   oben       8 Pt = 0,677 mm
 *   QR       100 Pt = 8,467 mm   (25 Module zu je 4 Punkten)
 *   Ruhezone  16 Pt = 1,355 mm
 *   Strichcode 79 Pt = 6,689 mm
 *   unten      4 Pt = 0,339 mm
 *
 * Der Strichcode trägt einen sechsstelligen KURZCODE, nicht die Artikelnummer:
 * 101 Module × 0,339 mm = 34,205 mm auf 40,287 mm bedruckbarer Länge, weisses
 * Papier je Seite 3,041 mm bedruckbar plus 5,256 mm unbedruckbar gegen
 * geforderte 3,387 mm Ruhezone — Faktor 2,45. Ein Etikett dieser Grösse mit
 * einer vierzehnstelligen Artikelnummer hätte diesen Spielraum nicht.
 *
 * Reicht die Bahnbreite nicht einmal für einen lesbaren QR (Hängemappe,
 * 13,1 mm), fällt der QR WEG statt zu schrumpfen. Was bleibt, ist ein
 * ehrliches Fähnchen aus Strichcode und Preis.
 */
function baueKlein(inhalt: EtikettInhalt, masse: EtikettMasse): EtikettPlan {
  const B = masse.breiteMm;
  const H = masse.hoeheMm;
  const randLaengs = masse.randLaengsMm ?? 0;

  const OBEN_PT = 8;
  const LUFT_PT = 16;
  const CODE_PT = 79;
  const UNTEN_PT = 4;

  const p: Primitiv[] = [];
  const flaechen: EtikettFlaeche[] = [];

  const qrInhalt = qrVerweis(inhalt.sku);
  const platzPt = inDruckpunkte(H) - (OBEN_PT + LUFT_PT + CODE_PT + UNTEN_PT);
  const qr = waehleQr(qrInhalt, ausDruckpunkten(Math.max(0, platzPt)));

  const obenMm = ausDruckpunkten(OBEN_PT);
  const codeOben = qr
    ? ausDruckpunkten(OBEN_PT + qr.kantePunkte + LUFT_PT)
    : H - ausDruckpunkten(CODE_PT + UNTEN_PT);
  const codeHoehe = ausDruckpunkten(CODE_PT);

  if (qr) {
    p.push(...qrPrimitive(qr, 0, obenMm));
    flaechen.push({ art: 'qr', x: 0, y: obenMm, breite: qr.kanteMm, hoehe: qr.kanteMm });
  }

  // Der Strichcode nimmt die GANZE bedruckbare Länge und steht mittig darin.
  // Die Ruhezone liegt links und rechts davon im weissen Papier.
  const strichcodeText = inhalt.kurzcode?.trim() || inhalt.sku;
  const code = waehleStrichcode(strichcodeText, 0, B, randLaengs, randLaengs, 'mitte');
  if (code.ok) {
    p.push(...strichcodePrimitive(code.wahl, codeOben, codeHoehe));
    flaechen.push({
      art: 'strichcode',
      x: code.wahl.vonX,
      y: codeOben,
      breite: code.wahl.breiteMm,
      hoehe: codeHoehe,
    });
  } else {
    p.push(...ohneStrichcode(0, B, codeOben, codeHoehe));
  }

  // Der Preis: feste Grundlinie, feste rechte Kante, nur die Grösse gibt nach.
  // Der Wunsch sind 5,6 mm Versalhöhe; passt die samt Unterlänge nicht über
  // den Strichcode, wird der Wunsch selbst kleiner — nicht die Grundlinie.
  const kopfhoehe = codeOben - obenMm;
  // Ein Zehntelmillimeter Luft über dem Strichcode. Ohne den landete die
  // Unterlänge der Preisziffern auf der Aktenmappe (13,1 mm Bahnbreite)
  // rechnerisch GENAU auf dem obersten Balken — und ein Buchstabe im Code
  // macht ihn unlesbar.
  const luftUeberCode = 0.15;
  // Auf zwei Nachkommastellen ABGERUNDET, nicht gerundet: `passeEin` rundet
  // seinerseits kaufmännisch, und aus einem Wunsch von 4,049 mm wurden so
  // 4,05 mm — vier tausendstel Millimeter zu viel, die genau in den Code
  // ragten.
  const preisWunsch =
    Math.floor(
      Math.min(5.6, (kopfhoehe - luftUeberCode) / (1 + UNTERLAENGE_GEVIERT / VERSAL.sans)) * 100,
    ) / 100;
  const preisGrund = codeOben - luftUeberCode - unterlaengeMm(preisWunsch, 'sans');
  const preisKopf = preisGrund - preisWunsch;
  const preisLinks = qr ? qr.kanteMm + 1.2 : 0;

  /**
   * SICHERHEITSRAND FÜR TEXT AN DER RECHTEN KANTE.
   *
   * ── DER FUND (26.07.2026, gemessen statt gelesen) ────────────────────────
   * Der Preis war rechtsbündig auf `B` gesetzt, also exakt auf die Reichweite
   * des Druckkopfs. Beim Nachmessen des fertigen Bauplans endete „890 €" bei
   * 40,29 mm auf 40,287 mm Fläche — bündig, mit null Rand.
   *
   * Das ist NICHT dasselbe wie ein knapper Rand. Jenseits dieser Kante kann
   * der Kopf nicht markieren: was darüber hinausragt, landet nicht in einem
   * Rand, es wird gar nicht gedruckt. Der halbe Euro fehlt einfach.
   *
   * Dass es bisher trotzdem passte, lag daran, dass `textbreiteMm` die Breite
   * ÜBERSCHÄTZT — für „890 €" um 0,35 mm gegen die echten Schriftmasse. Ein
   * Entwurf, der davon lebt, dass der Schätzer grosszügig rechnet, bricht in
   * dem Augenblick, in dem jemand den Schätzer genauer macht. Genau das habe
   * ich heute schon einmal getan.
   *
   * Für die Ruhezone des Strichcodes gilt das ausdrücklich NICHT: sie verlangt
   * WEISS, nicht Druckfläche, und darf im unbedruckbaren Papier liegen. Ein
   * Zeichen dagegen muss sichtbar sein.
   */
  const TEXT_RAND_MM = 0.5;
  const textRechts = B - TEXT_RAND_MM;

  const preisWert = inhalt.preisEur;
  const hatPreis = preisWert !== undefined && preisWert !== '';
  const preisZeile = hatPreis ? preisText(preisWert) : OHNE_PREIS;
  p.push({
    art: 'text',
    x: textRechts,
    y: preisGrund,
    text: preisZeile,
    hoeheMm: passeEin(preisZeile, textRechts - preisLinks, preisWunsch, 'sans', 0, 2.6),
    schrift: 'sans',
    fett: hatPreis,
    anker: 'rechts',
    ton: hatPreis ? 'tinte' : 'blass',
  });

  // Der Kurzcode im Klartext — aber nur, wenn er ÜBER den Preis passt, ohne
  // ihn zu berühren. Wenn der Scanner streikt, tippt ihn ein Mensch ab.
  const marke = 1.5;
  if (preisKopf - obenMm >= marke * (1 + UNTERLAENGE_GEVIERT / VERSAL.mono) + 0.1 && code.ok) {
    p.push({
      art: 'text',
      x: preisLinks,
      y: obenMm + marke,
      text: strichcodeText,
      hoeheMm: passeEin(strichcodeText, textRechts - preisLinks, marke, 'mono', 0.12),
      schrift: 'mono',
      fett: false,
      anker: 'links',
      sperrung: 0.12,
      ton: 'blass',
    });
  }

  const plan: EtikettPlan = {
    masse,
    primitive: p,
    strichcodeModule: code.ok ? code.wahl.module : 0,
    qrInhalt: qr ? qrInhalt : '',
    familie: 'klein',
    strichcodeText,
    flaechen,
  };
  if (code.ok) plan.modulbreiteMm = code.wahl.modulbreiteMm;
  else plan.sperrgrund = code.grund;
  return plan;
}

// ───────────────────────────────────────────────────────────────────────────
// Familie STANDARD — das Haus-Etikett mit QR-Spalte
// ───────────────────────────────────────────────────────────────────────────

/**
 * Das Haus-Etikett (w81h252 und w101h252).
 *
 *   ┌───────────────────────────────────────────────┬──────────┐
 *   │ WAREHOUSE 14                   Tresor-1/Fach-3│          │
 *   │ ───────────────────────────────────────────── │ ▄▄▄▄▄▄▄▄ │
 *   │ ▌▌▌ ▌▌ ▌▌▌▌ ▌ ▌▌▌ ▌▌ ▌▌▌ ▌ ▌▌▌▌ ▌▌ ▌ ▌▌▌     │ ▄  QR  ▄ │
 *   │ MZ-0042                                       │ ▄▄▄▄▄▄▄▄ │
 *   │ Silbergroschen 1871                           │          │
 *   │ 4,20 g · 585                          890 €   │    LAGER │
 *   └───────────────────────────────────────────────┴──────────┘
 *
 * Jedes Feld hat einen FESTEN Platz. Das war Basels Einwand am zweiten Muster:
 * ein Preis, der je nach Länge der Artikelnummer woanders steht, zwingt die
 * Hand am Regal, ihn jedes Mal zu suchen. Zwei Etiketten nebeneinander sollen
 * gleich aussehen — gleiche Grundlinie, gleiche rechte Kante.
 *
 * Nicht die POSITION passt sich also an, sondern die SCHRIFTGRÖSSE.
 *
 * Die Zeilenzahl des Namens hängt an der Bahnbreite: auf w81h252 (27,2 mm)
 * bleibt eine Zeile, auf w101h252 (34,2 mm) werden es zwei — dort trägt der
 * volle Name ohne Auslassungszeichen.
 */
function baueStandard(inhalt: EtikettInhalt, masse: EtikettMasse): EtikettPlan {
  return baueTafel(inhalt, masse, {
    familie: 'standard',
    rand: 1.6,
    kopfHoehe: 2.1,
    nummerHoehe: 3.4,
    nameHoehe: 2.6,
    nameBoden: 1.8,
    nameZeilenHoechstens: 2,
    fussHoehe: 2.3,
    preisWunsch: 5.2,
    preisBoden: 2.6,
    strichcodeMindesthoehe: 5.0,
    qrWunsch: 16.0,
    qrAnteil: 0.22,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Familie GROSS — Schatulle, Kasten, Paket
// ───────────────────────────────────────────────────────────────────────────

/** Höchstens so viele Zeilen bekommt der Name auf einem grossen Etikett. */
const GROSS_NAME_ZEILEN = 3;

/**
 * Die kleinste Versalhöhe, mit der ein Lagerort noch aufs grosse Etikett kommt.
 *
 * Darunter wird er nicht kleiner gesetzt, sondern umgehängt — erst rückt die
 * Wortmarke zusammen, dann wandert er nach unten neben Gewicht und Feinheit.
 * Ein Lagerort in 1,6 mm auf einem Etikett von 52 × 59 mm ist keine Angabe
 * mehr, das ist ein Beleg dafür, dass niemand nachgemessen hat.
 */
const GROSS_ORT_BODEN_MM = 2.0;

/**
 * Und die Grenze, unter der auch ein VOLLSTÄNDIGER Lagerort nichts mehr nützt.
 *
 * Zwischen diesen beiden Zahlen gilt: lieber ganz und klein als gross und
 * abgeschnitten. „Lager Nord / Regal 7" passt auf der Diskette bei 2,0 mm um
 * zwei Millimeter nicht in die Kopfzeile — bei 1,85 mm steht es ganz da, und
 * das ist am Regal die bessere Angabe.
 */
const GROSS_ORT_LESEGRENZE_MM = 1.6;

/**
 * Die Wortmarke und ihre Sperrung — auf jedem Etikett dieselbe.
 *
 * ⚠️ 30.07.2026, MANDANTENNEUTRAL. Hier stand fest `'WAREHOUSE 14'`. Auf jedem
 * gedruckten Etikett stand damit der Name einer FREMDEN Firma, und der Kunde
 * bekam ihn in die Hand. Dieselbe Fehlerklasse wie bei den Belegen und der
 * Rechnung, nur eine Ebene tiefer und deshalb länger unentdeckt.
 *
 * Norns POS wird an Läden verkauft. Der Name auf dem Etikett gehört dem
 * HÄNDLER, nicht uns. Er kommt aus der Ladenidentität; steht dort nichts,
 * bleibt die Zeile LEER statt einen fremden Namen zu drucken.
 */
let wortmarke = '';

/** Die Ladenidentität setzen, bevor ein Etikett gerechnet wird. */
export function setzeWortmarke(name: string): void {
  wortmarke = name.trim().toUpperCase();
}
const WORTMARKE_SPERRUNG = 0.35;

/**
 * Das grosse Etikett (Diskette, Farbdose, 2,25 × 4,00 Zoll, Porto).
 *
 * Hier steht der QR NICHT in einer Spalte, sondern unten links, und alle
 * Textzeilen bekommen die volle Breite. Der Grund ist gemessen, nicht
 * empfunden: auf der fast quadratischen Diskette (59,3 × 52,6 mm bedruckbar)
 * frisst eine QR-Spalte ein Drittel der Breite, und der volle Name passt dann
 * gerade NICHT mehr in drei Zeilen — genau das, wofür dieses Etikett da ist.
 * Unten liegend kostet derselbe QR nur eine Zeile Höhe, und der Name bekommt
 * die vollen 54 mm.
 *
 * ── FUND 7: DAS LOCH IN DER MITTE (26.07.2026, auf 1:1-Bogen gemessen) ─────
 * Die grosse Familie lief bis heute durch dieselbe Tafel wie das Haus-Etikett,
 * mit EINER festen Zahlentabelle für alle fünf Grössen. Damit rückte der Inhalt
 * auf einem grösseren Etikett nur weiter auseinander, statt mitzuwachsen, und
 * am Bogen war zwischen Kopf und Fuss ein leeres Band zu sehen. Nachgemessen
 * waren es vier verschiedene Fehler, jeder für sich klein:
 *
 *   • Der Strichcode bekam, was von der Höhe übrig blieb — aber die Tafel legte
 *     VOR dem Umbruch fest, wie viele Namenszeilen sie freihält. Brauchte der
 *     Name weniger, blieb die reservierte Zeile leer stehen: auf 2,25 × 4,00
 *     Zoll waren das 4,5 mm mitten im Etikett, und der Strichcode blieb bei
 *     6,97 mm — NIEDRIGER als auf dem viel kleineren Haus-Etikett (7,90 mm)
 *     und nur 10 Prozent seiner eigenen Breite, wo 15 Prozent die Faustregel
 *     sind.
 *   • Die Artikelnummer wurde mit ihrer WUNSCHhöhe eingeplant, aber in der
 *     eingepassten Höhe gesetzt. Die Differenz stand als Luft im Bauplan.
 *   • Der Preis hing an einer Grundlinie, die aus dem WUNSCH gerechnet war. Ein
 *     langer Betrag schrumpfte in seiner Zone — und liess über sich ein Loch
 *     stehen, das genau so hoch war, wie er geschrumpft ist.
 *   • Der Lagerort wurde auf die Wunschhöhe gekürzt und dann in der kleineren
 *     eingepassten Höhe gesetzt. Auf der Farbdose stand deshalb „Tresor-1 / F…"
 *     obwohl zwei Zentimeter darunter nichts stand.
 *
 * Deshalb rechnet diese Familie jetzt selbst statt über die Tafel: jedes Mass
 * wächst mit der Bahnbreite, jede Zeile wird in der Höhe eingeplant, in der sie
 * auch gesetzt wird, und der Strichcode bekommt, was danach übrig ist.
 */
function baueGross(inhalt: EtikettInhalt, masse: EtikettMasse): EtikettPlan {
  const B = masse.breiteMm;
  const H = masse.hoeheMm;
  const randLaengs = masse.randLaengsMm ?? 0;

  /**
   * Der Massstab: die WURZEL aus dem Verhältnis zur Bahnbreite des
   * Haus-Etiketts.
   *
   * Linear gestreckt käme auf der Diskette (52,6 mm, also fast das Doppelte)
   * eine Artikelnummer von 6,6 mm heraus — die passt auf 59 mm Länge nicht mehr
   * in eine Zeile, und was nicht in die Zeile passt, wird eingepasst und lässt
   * die eingeplante Luft stehen. Die Wurzel dämpft genau das: 1,39 statt 1,94.
   */
  const massstab = Math.sqrt(H / DYMO_99010.hoeheMm);

  /**
   * Der Rand wächst mit der Wurzel des MASSSTABS, nicht mit dem Massstab.
   *
   * Rand ist Weissraum, und Weissraum ist das Einzige auf diesem Etikett, das
   * nicht mitwachsen soll: jeder Millimeter Rand ist ein Millimeter, den der
   * Strichcode nicht bekommt. Aussen liegt ohnehin noch der unbedruckbare
   * Streifen des Druckkopfs.
   */
  const rand = 1.6 * Math.sqrt(massstab);
  const luft = 0.4 * massstab;
  const kopfWunsch = 2.1 * massstab;
  const nummerWunsch = 3.4 * massstab;
  const nameWunsch = 2.6 * massstab;
  const nameBoden = 1.8 * massstab;
  const fussWunsch = 2.3 * massstab;
  const preisBoden = 2.6 * massstab;

  const textRechts = B - rand;
  const untenKante = H - rand;

  const p: Primitiv[] = [];
  const flaechen: EtikettFlaeche[] = [];

  // ── Der QR unten links ───────────────────────────────────────────────────
  // Er wächst BEWUSST nicht mit dem Etikett. Mit 14,8 mm trägt er auf allen
  // fünf Grössen Module von 0,59 mm, also 175 Prozent der Untergrenze, aus der
  // Hand am Regal. Jeder Millimeter darüber wäre ein Millimeter weniger
  // Strichcodehöhe — und der Strichcode ist der Code, den ein GERÄT am Tresen
  // lesen muss.
  const qrInhalt = qrVerweis(inhalt.sku);
  const qr = waehleQr(qrInhalt, Math.min(15.0, (B - 2 * rand) * 0.3, (H - 2 * rand) * 0.4));
  const qrSeite = qr?.kanteMm ?? 0;
  // Ohne QR bleibt das untere Band trotzdem stehen: dort liegt der Preis.
  const bandHoehe = qr ? qrSeite : 0.25 * H;
  const bandOben = untenKante - bandHoehe;
  const bandLinks = rand + qrSeite + (qr ? 1.8 * massstab : 0);
  const bandZone = textRechts - bandLinks;

  // ── Gewicht und Feinheit — rechts neben dem QR, nicht in einer eigenen Zeile
  // Eine eigene Zeile über dem Band kostete 4,2 mm Höhe, die dem Strichcode
  // fehlten, während rechts neben dem QR dieselben 4,2 mm leer blieben.
  const teile: string[] = [];
  if (inhalt.gewichtGramm) {
    const n = Number(inhalt.gewichtGramm);
    if (Number.isFinite(n)) teile.push(`${n.toFixed(2).replace('.', ',')} g`);
  }
  if (inhalt.karat) teile.push(inhalt.karat);
  const fussText = teile.join('  ·  ');
  const fussHoehe = fussText === '' ? 0 : passeEin(fussText, bandZone, fussWunsch, 'sans', 0, 1.6);

  // ── Der Lagerort: zwei Plätze, und er nimmt den, der ihn GANZ trägt ─────
  // Erste Wahl ist die Kopfzeile, und die Wortmarke tritt dafür schrittweise
  // zurück: sie ist eine Marke, keine Angabe. Wo das Stück liegt, muss am
  // Regal lesbar sein; dass das Haus Warehouse 14 heisst, weiss dort jeder.
  // Zweite Wahl ist die Bandzeile neben Gewicht und Feinheit. Trägt ihn keiner
  // der beiden ganz, bekommt er den Platz, der MEHR von ihm zeigt — vorher
  // wurde er stumpf oben gekürzt, während unten die doppelte Breite frei war.
  const lagerort = inhalt.lagerort?.trim() ?? '';

  /**
   * Den Lagerort in eine Zone einpassen — und dabei VOLLSTÄNDIGKEIT über
   * Grösse stellen, aber nur bis zur Lesegrenze.
   */
  const ortEinpassen = (zone: number, wunsch: number): { hoehe: number; text: string } => {
    if (lagerort === '' || zone <= 2.0) return { hoehe: 0, text: '' };
    const gross = passeEin(lagerort, zone, wunsch, 'sans', 0, GROSS_ORT_BODEN_MM);
    const grossText = kuerzenAufBreite(lagerort, zone, gross, 'sans');
    if (grossText === lagerort) return { hoehe: gross, text: grossText };
    const klein = passeEin(lagerort, zone, wunsch, 'sans', 0, GROSS_ORT_LESEGRENZE_MM);
    const kleinText = kuerzenAufBreite(lagerort, zone, klein, 'sans');
    return kleinText === lagerort
      ? { hoehe: klein, text: kleinText }
      : { hoehe: gross, text: grossText };
  };

  let kopfHoehe = kopfWunsch;
  let ortKopfHoehe = 0;
  let ortKopfText = '';
  if (lagerort !== '') {
    const kopfZone = (h: number) =>
      Math.max(0, textRechts - rand - textbreiteMm(wortmarke, h, 'sans', WORTMARKE_SPERRUNG) - 2.0 * massstab);
    for (;;) {
      // In dieser Schleife wird NUR bis zum bevorzugten Boden eingepasst: erst
      // soll die Marke Platz machen, und erst wenn die nichts mehr hergibt,
      // darf der Lagerort selbst kleiner werden.
      const zone = kopfZone(kopfHoehe);
      ortKopfHoehe = passeEin(lagerort, zone, kopfHoehe, 'sans', 0, GROSS_ORT_BODEN_MM);
      ortKopfText = zone > 2.0 ? kuerzenAufBreite(lagerort, zone, ortKopfHoehe, 'sans') : '';
      if (ortKopfText === lagerort) break;
      // Unter das Hausmass des Haus-Etiketts schrumpft die Marke nicht.
      if (kopfHoehe <= 2.1 + 1e-9) {
        const letzterVersuch = ortEinpassen(kopfZone(kopfHoehe), kopfHoehe);
        ortKopfHoehe = letzterVersuch.hoehe;
        ortKopfText = letzterVersuch.text;
        break;
      }
      kopfHoehe = Math.max(2.1, Math.round((kopfHoehe - 0.05) * 100) / 100);
    }
  }

  const fussBreite = fussText === '' ? 0 : textbreiteMm(fussText, fussHoehe, 'sans');
  const ortBandVon = bandLinks + (fussText === '' ? 0 : fussBreite + luft);
  const ortBand = ortEinpassen(
    Math.max(0, textRechts - ortBandVon),
    fussText === '' ? fussWunsch : fussHoehe,
  );
  const ortBandHoehe = ortBand.hoehe;
  const ortBandText = ortBand.text;
  const ortImKopf =
    lagerort !== '' && (ortKopfText === lagerort || ortKopfText.length >= ortBandText.length);
  const ortImBand = lagerort !== '' && !ortImKopf && ortBandText !== '';
  // Steht der Lagerort unten, hat die Marke nichts nachzugeben.
  if (!ortImKopf) kopfHoehe = kopfWunsch;

  // ── Das untere Band, von unten gepackt ──────────────────────────────────
  // Erst der Preis an der Unterkante, dann die Bandzeile direkt darüber. Wird
  // der Preis lang und muss schrumpfen, entsteht die Luft OBEN am Band, wo sie
  // an den Weissraum unter dem Namen anschliesst — und nicht als Loch zwischen
  // zwei Zeilen.
  const bandZeileHoehe = Math.max(fussHoehe, ortImBand ? ortBandHoehe : 0);
  const bandZeileKasten =
    bandZeileHoehe === 0 ? 0 : bandZeileHoehe + unterlaengeMm(bandZeileHoehe, 'sans') + luft;

  const preisWert = inhalt.preisEur;
  const hatPreis = preisWert !== undefined && preisWert !== '';
  const preisZeile = hatPreis ? preisText(preisWert) : OHNE_PREIS;
  // Der Preis darf das ganze Band füllen, das die Bandzeile ihm übrig lässt.
  const preisWunsch = Math.max(
    preisBoden,
    (bandHoehe - bandZeileKasten) / (1 + UNTERLAENGE_GEVIERT / VERSAL.sans),
  );
  const preisHoehe = passeEin(preisZeile, bandZone, preisWunsch, 'sans', 0, preisBoden);
  /**
   * Der Preis hängt an der UNTERKANTE, nicht an einer gerechneten Grundlinie.
   *
   * Auf dem Haus-Etikett steht die Grundlinie fest, damit zwei Etiketten
   * nebeneinander den Preis auf derselben Höhe zeigen. Diese Grundlinie war
   * dort aus der WUNSCHhöhe gerechnet — hier auf der grossen Fläche schrumpft
   * ein langer Betrag aber um Millimeter, und die Differenz blieb als Loch über
   * ihm stehen. Die Unterkante ist derselbe feste Bezug (auf jedem Etikett
   * dieser Grösse dieselbe Linie), nur ohne das Loch.
   */
  const preisGrund = untenKante - unterlaengeMm(preisHoehe, 'sans');
  const preisOben = preisGrund - preisHoehe;

  const bandGrund =
    bandZeileHoehe === 0 ? preisOben : preisOben - luft - unterlaengeMm(bandZeileHoehe, 'sans');
  const bandZeileOben = bandGrund - bandZeileHoehe;

  // ── Der Kopf ────────────────────────────────────────────────────────────
  const kopfGrund = rand + kopfHoehe;
  const trennerY = kopfGrund + unterlaengeMm(kopfHoehe, 'sans') + luft;
  const codeOben = trennerY + 0.2 + 0.9 * massstab;

  // ── Nummer und Name ─────────────────────────────────────────────────────
  // Beide werden in der Höhe EINGEPLANT, in der sie auch gesetzt werden. Die
  // Nummer wird auf der Diskette von der Länge gedeckelt (14 Zeichen auf 55 mm
  // Zeile), nicht vom Wunsch — wer mit dem Wunsch plant, plant dort 1,2 mm
  // Luft ein, die nie jemand sieht.
  const nummerHoehe = passeEin(inhalt.sku, B - 2 * rand, nummerWunsch, 'mono', 0.18);
  const nummerUnterlaenge = unterlaengeMm(nummerHoehe, 'mono');

  // ── Der Strichcode wird VOR dem Namen gewählt ───────────────────────────
  // Nicht der Reihenfolge halber, sondern weil seine BREITE bestimmt, wie hoch
  // er mindestens sein muss: unter etwa 15 Prozent seiner Breite wird ein
  // Code 128 flach und wandert beim Ziehen über das Glas leicht aus dem
  // Lesestrahl. Der Deckel bei 10 mm ist ebenso gemessen — ein 128 mm langer
  // Code auf dem Portoetikett bräuchte danach 19 mm, und die fehlten dann dem
  // Namen, ohne dass ein Scanner davon etwas hätte.
  const strichcodeText = inhalt.kurzcode?.trim() || inhalt.sku;
  const code = waehleStrichcode(
    strichcodeText,
    rand,
    textRechts,
    rand + randLaengs,
    rand + randLaengs,
    'links',
  );
  const strichcodeMindesthoehe = code.ok
    ? Math.max(6.0 * massstab, Math.min(0.15 * code.wahl.breiteMm, 10.0))
    : 6.0 * massstab;
  const nameZone = textRechts - rand;
  const nameUnterkante = Math.min(bandOben, bandZeileHoehe === 0 ? preisOben : bandZeileOben) - luft;

  function stapelFuer(hoechstens: number) {
    const name = umbrechen(inhalt.name, nameZone, nameWunsch, 'sans', hoechstens, nameBoden);
    const zeilenabstand = name.hoeheMm * 1.45;
    const letzte = nameUnterkante - unterlaengeMm(name.hoeheMm, 'sans');
    const erste = letzte - (name.zeilen.length - 1) * zeilenabstand;
    const nummerGrund = erste - name.hoeheMm - nummerUnterlaenge - 0.3 * massstab;
    return { name, zeilenabstand, erste, nummerGrund, codeUnten: nummerGrund - nummerHoehe - luft };
  }

  // Nur so viele Zeilen freihalten, wie der Name WIRKLICH braucht — und wenn
  // dem Strichcode dann noch Höhe fehlt, den Namen enger setzen statt den Code
  // zu verkürzen. Der Strichcode ist der einzige Teil, den ein Gerät lesen muss.
  let stapel = stapelFuer(GROSS_NAME_ZEILEN);
  for (
    let n = GROSS_NAME_ZEILEN - 1;
    n >= 1 && stapel.codeUnten - codeOben < strichcodeMindesthoehe;
    n--
  ) {
    stapel = stapelFuer(n);
  }
  const codeHoehe = stapel.codeUnten - codeOben;

  // ── Kopfzeile ───────────────────────────────────────────────────────────
  p.push({
    art: 'text',
    x: rand,
    y: kopfGrund,
    text: wortmarke,
    hoeheMm: kopfHoehe,
    schrift: 'sans',
    fett: true,
    anker: 'links',
    sperrung: WORTMARKE_SPERRUNG,
    ton: 'tinte',
  });
  if (ortImKopf && ortKopfText !== '') {
    p.push({
      art: 'text',
      x: textRechts,
      y: kopfGrund,
      text: ortKopfText,
      hoeheMm: ortKopfHoehe,
      schrift: 'sans',
      fett: false,
      anker: 'rechts',
      ton: 'blass',
    });
  }
  p.push({
    art: 'rechteck',
    x: rand,
    y: trennerY,
    breite: textRechts - rand,
    hoehe: 0.2,
    ton: 'tinte',
  });

  // ── Der Strichcode ──────────────────────────────────────────────────────
  if (code.ok) {
    p.push(...strichcodePrimitive(code.wahl, codeOben, codeHoehe));
    flaechen.push({
      art: 'strichcode',
      x: code.wahl.vonX,
      y: codeOben,
      breite: code.wahl.breiteMm,
      hoehe: codeHoehe,
    });
  } else {
    p.push(...ohneStrichcode(rand, textRechts, codeOben, codeHoehe));
  }

  // ── Die Artikelnummer im Klartext ───────────────────────────────────────
  p.push({
    art: 'text',
    x: rand,
    y: stapel.nummerGrund,
    text: inhalt.sku,
    hoeheMm: nummerHoehe,
    schrift: 'mono',
    fett: true,
    anker: 'links',
    sperrung: 0.18,
    ton: 'tinte',
  });

  // ── Der Name ────────────────────────────────────────────────────────────
  stapel.name.zeilen.forEach((zeile, i) => {
    p.push({
      art: 'text',
      x: rand,
      y: stapel.erste + i * stapel.zeilenabstand,
      text: zeile,
      hoeheMm: stapel.name.hoeheMm,
      schrift: 'sans',
      fett: false,
      anker: 'links',
      ton: 'tinte',
    });
  });

  // ── Die Bandzeile: Gewicht und Feinheit links, Lagerort rechts ──────────
  if (fussText !== '') {
    p.push({
      art: 'text',
      x: bandLinks,
      y: bandGrund,
      text: fussText,
      hoeheMm: fussHoehe,
      schrift: 'sans',
      fett: false,
      anker: 'links',
      ton: 'blass',
    });
  }
  if (ortImBand) {
    p.push({
      art: 'text',
      x: textRechts,
      y: bandGrund,
      // Gekürzt wird in der Höhe, in der auch gesetzt wird. Vorher wurde auf
      // die Wunschhöhe gekürzt und dann kleiner gesetzt — doppelt bestraft.
      text: ortBandText,
      hoeheMm: ortBandHoehe,
      schrift: 'sans',
      fett: false,
      anker: 'rechts',
      ton: 'blass',
    });
  }

  // ── Der Preis ───────────────────────────────────────────────────────────
  p.push({
    art: 'text',
    x: textRechts,
    y: preisGrund,
    text: preisZeile,
    hoeheMm: preisHoehe,
    schrift: 'sans',
    fett: hatPreis,
    anker: 'rechts',
    ton: hatPreis ? 'tinte' : 'blass',
  });

  // ── Der QR ──────────────────────────────────────────────────────────────
  if (qr) {
    p.push(...qrPrimitive(qr, rand, untenKante - qrSeite));
    flaechen.push({ art: 'qr', x: rand, y: untenKante - qrSeite, breite: qrSeite, hoehe: qrSeite });
  }

  const plan: EtikettPlan = {
    masse,
    primitive: p,
    strichcodeModule: code.ok ? code.wahl.module : 0,
    qrInhalt: qr ? qrInhalt : '',
    familie: 'gross',
    strichcodeText,
    flaechen,
  };
  if (code.ok) plan.modulbreiteMm = code.wahl.modulbreiteMm;
  else plan.sperrgrund = code.grund;
  return plan;
}

/**
 * Der Stil der Tafel — seit dem 26.07.2026 trägt sie NUR noch die Familie
 * STANDARD.
 *
 * Vorher lief die grosse Familie durch dieselbe Tafel, mit einem Schalter für
 * „QR als Spalte" und einer festen Zahlentabelle. Der Schalter hatte damit
 * keinen zweiten Fall mehr; die toten Zweige sind entfernt statt
 * auskommentiert, damit niemand sie für lebendig hält. Dass das Haus-Etikett
 * dabei auf das letzte Tausendstel gleich geblieben ist, wurde nachgemessen:
 * 45 Baupläne aus Kapselfähnchen und Haus-Etikett, davor und danach Zeichen
 * für Zeichen verglichen.
 */
interface Tafelstil {
  familie: Bauplanfamilie;
  rand: number;
  kopfHoehe: number;
  nummerHoehe: number;
  nameHoehe: number;
  nameBoden: number;
  nameZeilenHoechstens: number;
  fussHoehe: number;
  preisWunsch: number;
  preisBoden: number;
  strichcodeMindesthoehe: number;
  qrWunsch: number;
  qrAnteil: number;
}

function baueTafel(inhalt: EtikettInhalt, masse: EtikettMasse, stil: Tafelstil): EtikettPlan {
  const B = masse.breiteMm;
  const H = masse.hoeheMm;
  const randLaengs = masse.randLaengsMm ?? 0;
  const p: Primitiv[] = [];
  const flaechen: EtikettFlaeche[] = [];

  const qrInhalt = qrVerweis(inhalt.sku);
  const qr = waehleQr(
    qrInhalt,
    Math.min(stil.qrWunsch, (B - 2 * stil.rand) * stil.qrAnteil, H - 8.0),
  );
  const qrSeite = qr?.kanteMm ?? 0;

  // ── Die Spalten ──────────────────────────────────────────────────────────
  const trennerX = qr ? B - stil.rand - qrSeite - 1.6 : B - stil.rand;
  const spalteRechts = qr ? trennerX - 1.6 : B - stil.rand;

  // ── Die Zeilen, von unten nach oben ──────────────────────────────────────
  // Der Preis hängt an der Unterkante: seine Unterlänge muss noch auf das
  // Papier, sonst schneidet der Stanzschnitt sie ab.
  const untenKante = H - 0.2;
  const preisGrund = untenKante - unterlaengeMm(stil.preisWunsch, 'sans');
  const fussGrund = preisGrund;

  const kopfGrund = stil.rand + stil.kopfHoehe;
  const trennerY = kopfGrund + unterlaengeMm(stil.kopfHoehe, 'sans') + 0.4;
  const codeOben = trennerY + 0.2 + 0.9;

  const nameGrundLetzte =
    fussGrund - stil.fussHoehe - unterlaengeMm(stil.nameHoehe, 'sans') - 0.3;
  const zeilenabstand = stil.nameHoehe * 1.5;

  // Wie viele Namenszeilen passen, ohne dem Strichcode seine Höhe zu nehmen?
  // Der Strichcode hat Vorrang: er ist der einzige Teil des Etiketts, den ein
  // Gerät lesen muss.
  const nummerUnterlaenge = unterlaengeMm(stil.nummerHoehe, 'mono');
  const codeUntenFuer = (n: number): number =>
    nameGrundLetzte -
    (n - 1) * zeilenabstand -
    stil.nameHoehe -
    nummerUnterlaenge -
    0.3 -
    stil.nummerHoehe -
    0.4;
  let zeilen = 1;
  for (let n = stil.nameZeilenHoechstens; n >= 1; n--) {
    if (codeUntenFuer(n) - codeOben >= stil.strichcodeMindesthoehe) {
      zeilen = n;
      break;
    }
  }
  const nameGrundErste = nameGrundLetzte - (zeilen - 1) * zeilenabstand;
  const nummerGrund = nameGrundErste - stil.nameHoehe - nummerUnterlaenge - 0.3;
  const codeUnten = nummerGrund - stil.nummerHoehe - 0.4;
  const codeHoehe = codeUnten - codeOben;

  // ── Die Preiszone ────────────────────────────────────────────────────────
  // Sie ist fest breit und rechtsbündig, in derselben Zeile wie Gewicht und
  // Feinheit. Kein Text darf in sie hineinragen.
  const preisLinks = spalteRechts - (spalteRechts - stil.rand) * 0.42;
  const textRechts = preisLinks - 1.5;

  // ── Kopfzeile ────────────────────────────────────────────────────────────
  p.push({
    art: 'text',
    x: stil.rand,
    y: kopfGrund,
    text: wortmarke,
    hoeheMm: stil.kopfHoehe,
    schrift: 'sans',
    fett: true,
    anker: 'links',
    sperrung: WORTMARKE_SPERRUNG,
    ton: 'tinte',
  });
  if (inhalt.lagerort) {
    const kopfBreite = textbreiteMm(wortmarke, stil.kopfHoehe, 'sans', WORTMARKE_SPERRUNG);
    const zone = spalteRechts - stil.rand - kopfBreite - 2.0;
    if (zone > 4.0) {
      // ── FUND 8: ERST EINPASSEN, DANN KÜRZEN ────────────────────────────
      // Hier stand das Kürzen auf der WUNSCHhöhe und daneben die Einpassung
      // auf die tatsächlich gesetzte, kleinere Höhe. Der Lagerort wurde damit
      // doppelt bestraft: erst nach einem zu breiten Lineal abgeschnitten und
      // dann auch noch kleiner gesetzt, sodass hinter dem Auslassungszeichen
      // Platz stehen blieb, der ihn ganz getragen hätte.
      const hoehe = passeEin(inhalt.lagerort, zone, stil.kopfHoehe * 0.95, 'sans');
      p.push({
        art: 'text',
        x: spalteRechts,
        y: kopfGrund,
        text: kuerzenAufBreite(inhalt.lagerort, zone, hoehe, 'sans'),
        hoeheMm: hoehe,
        schrift: 'sans',
        fett: false,
        anker: 'rechts',
        ton: 'blass',
      });
    }
  }
  p.push({
    art: 'rechteck',
    x: stil.rand,
    y: trennerY,
    breite: spalteRechts - stil.rand,
    hoehe: 0.2,
    ton: 'tinte',
  });

  // ── Die senkrechte Trennlinie ────────────────────────────────────────────
  // Sie macht die zwei Spalten sichtbar. Ohne sie wirken QR und Angaben wie
  // zufällig nebeneinandergelegt statt geordnet.
  if (qr) {
    p.push({
      art: 'rechteck',
      x: trennerX,
      y: codeOben,
      breite: 0.2,
      hoehe: fussGrund - codeOben,
      ton: 'blass',
    });
  }

  // ── Der Strichcode ───────────────────────────────────────────────────────
  // Feste linke Kante, bündig mit Kopfzeile und Artikelnummer. Das weisse
  // Papier links davon ist der Rand plus der unbedruckbare Streifen.
  const strichcodeText = inhalt.kurzcode?.trim() || inhalt.sku;
  const code = waehleStrichcode(
    strichcodeText,
    stil.rand,
    spalteRechts,
    stil.rand + randLaengs,
    // Rechts vom Strichcode ist die Lücke bis zur senkrechten Trennlinie
    // weiss; ohne QR-Spalte der Rand plus das unbedruckbare Papier am Ende der
    // Laufrichtung.
    qr ? trennerX - spalteRechts : stil.rand + randLaengs,
    'links',
  );
  if (code.ok) {
    p.push(...strichcodePrimitive(code.wahl, codeOben, codeHoehe));
    flaechen.push({
      art: 'strichcode',
      x: code.wahl.vonX,
      y: codeOben,
      breite: code.wahl.breiteMm,
      hoehe: codeHoehe,
    });
  } else {
    p.push(...ohneStrichcode(stil.rand, spalteRechts, codeOben, codeHoehe));
  }

  // ── Die Artikelnummer im Klartext ────────────────────────────────────────
  // Über die GANZE linke Spalte, damit auch eine lange Nummer gross bleibt.
  // Wenn der Scanner streikt, tippt sie ein Mensch ab.
  p.push({
    art: 'text',
    x: stil.rand,
    y: nummerGrund,
    text: inhalt.sku,
    hoeheMm: passeEin(inhalt.sku, spalteRechts - stil.rand, stil.nummerHoehe, 'mono', 0.18),
    schrift: 'mono',
    fett: true,
    anker: 'links',
    sperrung: 0.18,
    ton: 'tinte',
  });

  // ── Der Name ─────────────────────────────────────────────────────────────
  const nameZone = textRechts - stil.rand;
  const name = umbrechen(
    inhalt.name,
    nameZone,
    stil.nameHoehe,
    'sans',
    zeilen,
    stil.nameBoden,
  );
  name.zeilen.forEach((zeile, i) => {
    p.push({
      art: 'text',
      x: stil.rand,
      y: nameGrundErste + i * zeilenabstand,
      text: zeile,
      hoeheMm: name.hoeheMm,
      schrift: 'sans',
      fett: false,
      anker: 'links',
      ton: 'tinte',
    });
  });

  // ── Gewicht und Feinheit ─────────────────────────────────────────────────
  const teile: string[] = [];
  if (inhalt.gewichtGramm) {
    const n = Number(inhalt.gewichtGramm);
    if (Number.isFinite(n)) teile.push(`${n.toFixed(2).replace('.', ',')} g`);
  }
  if (inhalt.karat) teile.push(inhalt.karat);
  if (teile.length > 0) {
    p.push({
      art: 'text',
      x: stil.rand,
      y: fussGrund,
      text: kuerzenAufBreite(teile.join('  ·  '), textRechts - stil.rand, stil.fussHoehe, 'sans'),
      hoeheMm: stil.fussHoehe,
      schrift: 'sans',
      fett: false,
      anker: 'links',
      ton: 'blass',
    });
  }

  // ── Der Preis: IMMER hier, immer rechtsbündig ────────────────────────────
  // Er wandert nicht mehr. Wird der Betrag lang, schrumpft die Schrift in
  // ihrer Zone — die Stelle bleibt dieselbe. Zwei Etiketten nebeneinander
  // zeigen den Preis auf derselben Höhe und an derselben Kante.
  const preisWert = inhalt.preisEur;
  const hatPreis = preisWert !== undefined && preisWert !== '';
  const preisZeile = hatPreis ? preisText(preisWert) : OHNE_PREIS;
  p.push({
    art: 'text',
    x: spalteRechts,
    y: preisGrund,
    text: preisZeile,
    hoeheMm: passeEin(
      preisZeile,
      spalteRechts - preisLinks,
      stil.preisWunsch,
      'sans',
      0,
      stil.preisBoden,
    ),
    schrift: 'sans',
    fett: hatPreis,
    anker: 'rechts',
    ton: hatPreis ? 'tinte' : 'blass',
  });

  // ── Der QR ───────────────────────────────────────────────────────────────
  if (qr) {
    const qrX = B - stil.rand - qrSeite;
    const qrY = codeOben;
    p.push(...qrPrimitive(qr, qrX, qrY));
    flaechen.push({ art: 'qr', x: qrX, y: qrY, breite: qrSeite, hoehe: qrSeite });

    // Die Marke „LAGER" sagt, wofür der QR da ist. Sie kommt nur aufs Etikett,
    // wenn sie samt Unterlänge noch aufs Papier passt.
    const markeHoehe = 1.6;
    const markeGrund = qrY + qrSeite + 1.8;
    if (markeGrund + unterlaengeMm(markeHoehe, 'sans') <= H) {
      p.push({
        art: 'text',
        x: B - stil.rand,
        y: markeGrund,
        text: 'LAGER',
        hoeheMm: markeHoehe,
        schrift: 'sans',
        fett: false,
        anker: 'rechts',
        sperrung: 0.5,
        ton: 'blass',
      });
    }
  }

  const plan: EtikettPlan = {
    masse,
    primitive: p,
    strichcodeModule: code.ok ? code.wahl.module : 0,
    qrInhalt: qr ? qrInhalt : '',
    familie: stil.familie,
    strichcodeText,
    flaechen,
  };
  if (code.ok) plan.modulbreiteMm = code.wahl.modulbreiteMm;
  else plan.sperrgrund = code.grund;
  return plan;
}

// ───────────────────────────────────────────────────────────────────────────
// Der Einstieg
// ───────────────────────────────────────────────────────────────────────────

/**
 * Den Bauplan für ein Etikett rechnen.
 *
 * Welche der drei Familien baut, entscheidet die BAHNBREITE der bedruckbaren
 * Fläche. Übergeben wird immer die bedruckbare Fläche, nie das Papiermass —
 * dafür gibt es `etikettPlanFuerMedium`.
 */
export function etikettPlan(inhalt: EtikettInhalt, masse: EtikettMasse = DYMO_99010): EtikettPlan {
  if (masse.hoeheMm <= 20) return baueKlein(inhalt, masse);
  if (masse.hoeheMm <= 36) return baueStandard(inhalt, masse);
  return baueGross(inhalt, masse);
}

/** Denselben Bauplan, aber für ein Medium aus dem Katalog. */
export function etikettPlanFuerMedium(inhalt: EtikettInhalt, cups: string): EtikettPlan {
  const medium: EtikettMedium | undefined = mediumFuer(cups);
  if (!medium) throw new Error(`Die Etikettengrösse „${cups}" kennt der Drucker nicht.`);
  return etikettPlan(inhalt, medium.bedruckbar);
}

/**
 * Warum diese Grösse für diesen Artikel NICHT gewählt werden darf.
 *
 * Gibt `undefined` zurück, wenn alles passt. Sonst einen Satz, den die
 * Oberfläche an der gesperrten Grösse anzeigen kann. Heimlich verkleinern gilt
 * nicht: ein Etikett, dessen Code unter der Lesbarkeitsgrenze liegt, sieht auf
 * dem Bildschirm aus wie jedes andere und fällt erst am Scanner auf.
 */
export function etikettSperre(inhalt: EtikettInhalt, masse: EtikettMasse): string | undefined {
  try {
    return etikettPlan(inhalt, masse).sperrgrund;
  } catch (fehler) {
    return fehler instanceof Error ? fehler.message : String(fehler);
  }
}

/** Dasselbe für ein Medium aus dem Katalog. */
export function etikettSperreFuerMedium(inhalt: EtikettInhalt, cups: string): string | undefined {
  const medium = mediumFuer(cups);
  if (!medium) return `Die Etikettengrösse „${cups}" kennt der Drucker nicht.`;
  return etikettSperre(inhalt, medium.bedruckbar);
}


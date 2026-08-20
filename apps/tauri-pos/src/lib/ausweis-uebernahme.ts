/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ausweis-uebernahme — was vom Ausweis ins Formular darf, und was nicht
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 20.08.2026 ──────────────────────────────────────────────
 *
 * Basel hat nach dem Ausweisleser am Ankauf gefragt. Beim Nachmessen kam
 * heraus: er ist GEBAUT — `components/MrzScanner.tsx` samt Kamera, Handeingabe
 * und einem Auswerter mit allen Prüfziffern nach ICAO 9303 (`lib/mrz-parse.ts`,
 * eigene Proben). Und er ist an KEINER Fläche eingebaut. Gebaut und
 * liegengelassen.
 *
 * Dieses Stück ist die Brücke: aus den Feldern eines Ausweises werden die
 * Felder der Kundenanlage.
 *
 * ── DIE JAHRHUNDERTREGEL ───────────────────────────────────────────────────
 *
 * Ein Ausweis druckt das Geburtsdatum ZWEISTELLIG (`900615`). Ob das 1990 oder
 * 2090 heisst, steht nirgends. Die Regel hier: ein Geburtsdatum liegt in der
 * VERGANGENHEIT. Ergäbe die Deutung als 20xx ein Datum in der Zukunft, ist es
 * 19xx.
 *
 * `90` → 2090 läge in der Zukunft → 1990.
 * `26` → 2026 liegt nicht in der Zukunft → 2026 (ein Säugling; kommt vor).
 *
 * ── WAS HIER NICHT PASSIERT ────────────────────────────────────────────────
 *
 * ⚠️ Ein Ausweis mit FALSCHER Prüfziffer wird NICHT stillschweigend
 * übernommen. Der Auswerter meldet `valid: false`, wenn eine Prüfziffer nicht
 * aufgeht — abgetippt, zerkratzt, oder gefälscht. Nach § 10 GwG ist die
 * Identifizierung eine Pflicht des Händlers; eine Kasse, die eine
 * unstimmige Nummer wortlos ins Formular schreibt, nimmt ihm die Möglichkeit,
 * genauer hinzusehen. Die Übernahme sagt deshalb IMMER, wie sicher sie ist,
 * und die Fläche zeigt es an.
 */

import type { MrzPerson } from './mrz-parse.js';

/** Was aus einem Ausweis in die Kundenanlage übernommen wird. */
export interface Ausweisuebernahme {
  /** Vorname(n) und Nachname, in der Reihenfolge, wie ein Mensch sie schreibt. */
  fullName: string;
  /** Geburtsdatum als `TT.MM.JJJJ` — so, wie das Formular es erwartet. */
  geburtsdatum: string | null;
  /** Die Dokumentennummer, für die Identifizierung nach § 10 GwG. */
  dokumentennummer: string;
  /** Staatsangehörigkeit, dreistellig wie im Dokument. */
  staat: string;
  /**
   * ⛔ Gingen ALLE Prüfziffern auf?
   *
   * `false` heisst nicht „gefälscht" — es heisst „stimmt nicht zusammen".
   * Die Fläche muss es zeigen, und ein Mensch muss entscheiden.
   */
  geprueft: boolean;
  /**
   * WAS nicht aufging, im Klartext — leer, wenn alles stimmt.
   *
   * ⚠️ 20.08.2026, beim Gegenprüfen gefunden: die erste Fassung machte aus
   * `geprueft === false` den Satz „Prüfziffern stimmen nicht". Beim Muster
   * stimmten alle vier Prüfziffern, und in Wahrheit war der STAATENCODE
   * unbekannt. Eine falsch benannte Ursache schickt den Händler an die
   * falsche Stelle — bei einer Identifizierung nach § 10 GwG ist das
   * schlimmer als gar keine Angabe.
   */
  beanstandet: string[];
  /** Ist der Ausweis am Tag der Übernahme ABGELAUFEN? */
  abgelaufen: boolean;
}

/** Die Feldnamen des Auswerters auf Deutsch. */
const FELD_KLARTEXT: Record<string, string> = {
  documentNumber: 'Dokumentennummer',
  birthDate: 'Geburtsdatum',
  expirationDate: 'Ablaufdatum',
  compositeCheckDigit: 'Gesamtprüfziffer',
  issuingState: 'Ausstellender Staat',
  nationality: 'Staatsangehörigkeit',
  sex: 'Geschlecht',
  documentCode: 'Dokumentenart',
  personalNumber: 'Personalnummer',
};

/** `YYMMDD` in ein Jahr, einen Monat und einen Tag zerlegen. */
function zerlege(yymmdd: string): { jj: number; mm: number; tt: number } | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const jj = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  const tt = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12 || tt < 1 || tt > 31) return null;
  return { jj, mm, tt };
}

/**
 * Ein zweistelliges GEBURTSJAHR auf vier Stellen bringen.
 *
 * Ein Geburtsdatum liegt in der Vergangenheit; was als 20xx in der Zukunft
 * läge, ist 19xx.
 */
export function geburtsjahrVierstellig(jj: number, heute: Date = new Date()): number {
  const jahrhundert = Math.floor(heute.getFullYear() / 100) * 100;
  const alsHeutiges = jahrhundert + jj;
  return alsHeutiges > heute.getFullYear() ? alsHeutiges - 100 : alsHeutiges;
}

/**
 * Ein zweistelliges ABLAUFJAHR auf vier Stellen bringen.
 *
 * Ein Ablaufdatum liegt meist in der Zukunft, kann aber vergangen sein (ein
 * abgelaufener Ausweis). Ein Ausweis gilt höchstens zehn Jahre; alles, was
 * mehr als zehn Jahre in der Zukunft läge, gehört ins vorige Jahrhundert.
 */
export function ablaufjahrVierstellig(jj: number, heute: Date = new Date()): number {
  const jahrhundert = Math.floor(heute.getFullYear() / 100) * 100;
  const alsHeutiges = jahrhundert + jj;
  return alsHeutiges > heute.getFullYear() + 10 ? alsHeutiges - 100 : alsHeutiges;
}

/** `TT.MM.JJJJ`, wie das Formular es erwartet. */
function alsDeutschesDatum(tt: number, mm: number, jjjj: number): string {
  return `${String(tt).padStart(2, '0')}.${String(mm).padStart(2, '0')}.${jjjj}`;
}

/**
 * Die Felder eines Ausweises in die Felder der Kundenanlage übersetzen.
 *
 * @param person Was der Auswerter aus den Maschinenzeilen gelesen hat.
 * @param heute  Für die Jahrhundertregel und die Ablaufprüfung.
 */
export function uebernimmAusweis(person: MrzPerson, heute: Date = new Date()): Ausweisuebernahme {
  // Der Ausweis druckt NACHNAME zuerst; ein Mensch schreibt den Vornamen
  // zuerst. Das Formular führt EIN Namensfeld, also wird hier gedreht.
  const vor = person.givenNames.trim();
  const nach = person.surname.trim();
  const fullName = [vor, nach].filter((t) => t !== '').join(' ');

  const geb = zerlege(person.dateOfBirth);
  const geburtsdatum =
    geb === null
      ? null
      : alsDeutschesDatum(geb.tt, geb.mm, geburtsjahrVierstellig(geb.jj, heute));

  const ablauf = zerlege(person.expiryDate);
  const abgelaufen =
    ablauf === null
      ? false
      : new Date(
          Date.UTC(ablaufjahrVierstellig(ablauf.jj, heute), ablauf.mm - 1, ablauf.tt),
        ).getTime() < Date.UTC(heute.getFullYear(), heute.getMonth(), heute.getDate());

  return {
    fullName,
    geburtsdatum,
    dokumentennummer: person.documentNumber.trim(),
    staat: person.nationality.trim(),
    geprueft: person.valid,
    beanstandet: person.beanstandet.map((f) => FELD_KLARTEXT[f] ?? f),
    abgelaufen,
  };
}

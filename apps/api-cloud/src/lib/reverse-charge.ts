/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DARF DIESER VORGANG OHNE UMSATZSTEUER LAUFEN?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Bis zum 26.07.2026 lautete die Antwort: ja, wenn der Aufrufer es sagt.
 *
 * `POST /api/transactions/finalize` nahm `taxTreatmentCode` aus dem Rumpf und
 * schrieb ihn durch, bis in den Hauptbuch-Eintrag. Keine Zeile prüfte bei
 * `REVERSE_CHARGE_13B`, ob der Kunde überhaupt eine USt-IdNr. trägt.
 * Kassiererrecht genügte. Es ging um 19 Prozent jedes Verkaufs.
 *
 * ── Was das Gesetz verlangt ──────────────────────────────────────────────
 *
 * § 18e UStG gibt dem Unternehmer die qualifizierte Bestätigungsabfrage.
 * § 6a Abs. 4 UStG schützt den guten Glauben NUR bei eingehaltener und
 * belegter Sorgfalt. Ohne dokumentierte Abfrage schuldet der Verkäufer die
 * Steuer selbst, aus einem Verkauf, bei dem er sie nie eingenommen hat.
 *
 * ── Warum das Alter zählt ────────────────────────────────────────────────
 *
 * Eine USt-IdNr. kann erlöschen. Eine Abfrage von vor zwei Jahren belegt für
 * den heutigen Umsatz nichts. Die Finanzverwaltung erwartet die Abfrage
 * zeitnah zum Umsatz, bei laufender Geschäftsbeziehung wiederkehrend.
 *
 * 90 Tage ist die Vorgabe, und sie ist eine Einstellung, kein Beton:
 * `vat.pruefung_hoechstalter_tage` in `system_settings`.
 *
 * ── Und warum „konnte nicht fragen" nicht genügt ─────────────────────────
 *
 * Die Route gab bei Zeitüberschreitung dasselbe `valid: false` zurück wie bei
 * einer wirklich ungültigen Nummer. Für den Bildschirm ist das eine falsche
 * Anschuldigung, für diesen Riegel ist es einerlei: wer nicht fragen konnte,
 * hat nichts belegt. `NICHT_ERREICHBAR` berechtigt so wenig zu § 13b wie
 * `UNGUELTIG` — aber der Satz, den der Mensch liest, ist ein anderer.
 */

/*
 * ⚠️ Die EINZIGE Einfuhr dieses sonst reinen Moduls, und sie ist Absicht.
 *
 * `alsTag` ist der eine Ort, an dem ein Zeitpunkt zum deutschen Geschäftstag
 * wird — dieselbe Rechnung, nach der auch der Steuersatz gewählt wird. Diese
 * Rechnung hier ein sechstes Mal abzuschreiben wäre kürzer und falsch: zwei
 * Rechnungen sind zwei Wahrheiten, und sie laufen auseinander.
 */
import { alsTag } from '@norns/domain';

/** Dieselben vier Werte wie der Aufzählungstyp `vat_check_result` (Wanderung 0116). */
export type VatPruefergebnis = 'GUELTIG' | 'UNGUELTIG' | 'NICHT_ERREICHBAR' | 'FORMFEHLER';

/** Die Vorgabe, wenn in `system_settings` nichts steht. Begründung oben. */
export const VAT_PRUEFUNG_HOECHSTALTER_TAGE = 90;

export interface KundeSteuerstand {
  /** Die USt-IdNr., wie sie heute beim Kunden steht. */
  vatId: string | null;
  /** Die Nummer, die WIRKLICH abgefragt wurde. */
  geprueftesVatId: string | null;
  /**
   * ⚠️ `Date` ODER Zeichenkette. Der Aufrufer liest die Spalte mit rohem SQL
   * (`db.execute`), und dort kommt `timestamptz` als STRING zurück — der
   * Treiber wandelt nur bei den typisierten Wegen. Die Typangabe an der
   * Aufrufstelle behauptete `Date` und war damit eine BEHAUPTUNG, die der
   * Compiler nicht prüfen kann.

   *
   * Gemessen am 28.07.2026 im Monatslauf: JEDER § 13b-Verkauf endete in einem
   * 500er, `kunde.geprueftAm.getTime is not a function`. Der Riegel, der
   * § 13b absichern sollte, machte ihn unbenutzbar.

   */

  geprueftAm: Date | string | null;
  ergebnis: VatPruefergebnis | null;
}

export interface Urteil {
  erlaubt: boolean;
  /**
   * Der Satz für den Menschen an der Kasse. Er muss sagen, was zu TUN ist,
   * nicht bloss, dass etwas fehlt: ein „nicht erlaubt" ohne nächsten Schritt
   * führt dazu, dass jemand den Steuerschlüssel von Hand umstellt.
   */
  grund?: string;
  /** Kurzform für den Beleg. `null`, wenn kein § 13b im Spiel ist. */
  belegvermerk: string | null;
}

/** `de 123 456 789` → `DE123456789`. Genau so wird auch abgefragt. */
export function normalisiereVatId(v: string): string {
  return v.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function darfReverseCharge(input: {
  kunde: KundeSteuerstand | null;
  jetzt: Date;
  hoechstalterTage?: number;
}): Urteil {
  const { kunde, jetzt } = input;
  const grenze =
    Number.isFinite(input.hoechstalterTage) && (input.hoechstalterTage ?? 0) > 0
      ? (input.hoechstalterTage as number)
      : VAT_PRUEFUNG_HOECHSTALTER_TAGE;

  if (kunde == null) {
    return {
      erlaubt: false,
      grund:
        'Reverse-Charge (§ 13b) ohne Kunden nicht möglich. Der Vorgang braucht einen ' +
        'Geschäftskunden mit geprüfter USt-IdNr.',
      belegvermerk: null,
    };
  }

  if (!kunde.vatId || kunde.vatId.trim() === '') {
    return {
      erlaubt: false,
      grund:
        'Reverse-Charge (§ 13b) verlangt eine USt-IdNr. beim Kunden. ' +
        'Bitte im Kundensatz eintragen und prüfen lassen.',
      belegvermerk: null,
    };
  }

  if (kunde.ergebnis == null || kunde.geprueftAm == null) {
    return {
      erlaubt: false,
      grund:
        'Die USt-IdNr. wurde nie geprüft. § 6a Abs. 4 UStG schützt nur bei belegter ' +
        'Sorgfalt, sonst schuldet das Haus die Steuer selbst. Bitte „USt-IdNr. prüfen".',
      belegvermerk: null,
    };
  }

  // ⚠️ Die Reihenfolge ist Absicht: ERST vergleichen, welche Nummer geprüft
  // wurde. Sonst könnte jemand eine geprüfte Nummer eintragen, die Prüfung
  // stehenlassen und die Nummer danach austauschen — die Prüfung würde still
  // auf die neue Nummer übergehen.
  const jetzige = normalisiereVatId(kunde.vatId);
  const gepruefte = kunde.geprueftesVatId ? normalisiereVatId(kunde.geprueftesVatId) : null;
  if (gepruefte !== jetzige) {
    return {
      erlaubt: false,
      grund:
        `Die geprüfte USt-IdNr. (${gepruefte ?? 'keine'}) ist nicht die eingetragene ` +
        `(${jetzige}). Bitte erneut prüfen.`,
      belegvermerk: null,
    };
  }

  if (kunde.ergebnis === 'UNGUELTIG') {
    return {
      erlaubt: false,
      grund: `Die USt-IdNr. ${jetzige} ist bei der EU nicht gültig. Reverse-Charge ist ausgeschlossen.`,
      belegvermerk: null,
    };
  }

  if (kunde.ergebnis === 'FORMFEHLER') {
    return {
      erlaubt: false,
      grund: `${jetzige} hat nicht die Form einer USt-IdNr. und wurde deshalb gar nicht abgefragt.`,
      belegvermerk: null,
    };
  }

  if (kunde.ergebnis === 'NICHT_ERREICHBAR') {
    return {
      erlaubt: false,
      grund:
        'Die EU-Abfrage war zuletzt nicht erreichbar, die USt-IdNr. ist also ungeprüft. ' +
        'Das ist KEINE Aussage über die Nummer, bitte die Prüfung wiederholen.',
      belegvermerk: null,
    };
  }

  // Beide Formen werden angenommen; eine unlesbare wird wie „nie geprüft"
  // behandelt, nicht wie „frisch geprüft". Die sichere Richtung.
  const geprueft = kunde.geprueftAm instanceof Date
    ? kunde.geprueftAm
    : new Date(kunde.geprueftAm);
  if (Number.isNaN(geprueft.getTime())) {
    return {
      erlaubt: false,
      grund:
        'Der Zeitpunkt der USt-IdNr.-Prüfung ist nicht lesbar. Bitte die Nummer ' +
        'erneut prüfen, bevor ohne Umsatzsteuer verkauft wird.',
      belegvermerk: null,
    };
  }
  const alterTage = (jetzt.getTime() - geprueft.getTime()) / 86_400_000;
  // Eine Prüfung aus der Zukunft ist ein Uhrfehler, kein frischer Beleg. Sie
  // zählt als Alter null, damit eine schiefe Serveruhr den Verkauf nicht
  // lahmlegt — dieselbe Regel wie beim Metallkurs.
  if (Math.max(0, alterTage) > grenze) {
    return {
      erlaubt: false,
      grund:
        `Die letzte Prüfung der USt-IdNr. ist ${Math.floor(alterTage)} Tage alt (erlaubt: ${grenze}). ` +
        'Eine USt-IdNr. kann erlöschen; die Abfrage muss zeitnah zum Umsatz erfolgen.',
      belegvermerk: null,
    };
  }

  return {
    erlaubt: true,
    belegvermerk: belegvermerkFuerVatPruefung(jetzige, geprueft),
  };
}

/**
 * Der Wortlaut des Belegvermerks — an EINER Stelle.
 *
 * ⚠️ 27.07.2026. Er stand bis heute nur hier, und `darfReverseCharge` läuft
 * erst beim Kassieren. Die Kasse aber siegelt ihren Belegrumpf VOR dem Netz,
 * bekam den Vermerk also nie zu sehen und druckte auf JEDEN § 13b-Beleg
 * „USt-IdNr.: Nachweis der EU-Abfrage FEHLT." — auch dann, wenn die Abfrage
 * durchgeführt worden und gültig war. Der Server rechnete den Satz aus und
 * warf ihn weg.
 *
 * Jetzt gibt ihn schon die Prüfroute heraus. Damit es NICHT zwei Wortlaute
 * gibt, die auseinanderlaufen, steht er hier und wird von beiden gerufen.
 *
 * Der Vermerk gehört auf den Beleg, nicht nur in die Datenbank: bei einer
 * Prüfung Jahre später ist der Beleg das, was auf dem Tisch liegt. § 6a Abs. 4
 * UStG schützt den guten Glauben nur bei belegter Sorgfalt.
 */
export function belegvermerkFuerVatPruefung(vatId: string, geprueftAm: Date): string {
  /*
   * ⛔ HIER STAND `geprueftAm.toISOString().slice(0, 10)` (bis 21.08.2026).
   *
   * `toISOString` rechnet in UTC. In deutscher Sommerzeit (UTC+2) bekam damit
   * JEDE Abfrage zwischen 00:00 und 02:00 Ortszeit den VORTAG aufgedruckt, im
   * Winter (UTC+1) jede zwischen 00:00 und 01:00.
   *
   * Und dieser Tag steht AUF DEM BELEG — genau das sagt der Absatz darüber:
   * bei einer Prüfung Jahre später ist der Beleg das, was auf dem Tisch liegt.
   * Die Datenbank haelt den Zeitpunkt als `timestamptz`, also richtig; der
   * Beleg haette dem eigenen Datenbestand widersprochen. Dieselbe Klasse wie
   * der Rechtshinweis, der 19 Prozent nannte, waehrend die Rechnung 16 rechnete.
   */
  const [jahr, monat, tagZahl] = alsTag(geprueftAm).split('-');
  return `USt-IdNr. ${vatId} · EU-Abfrage vom ${tagZahl}.${monat}.${jahr} · gültig`;
}

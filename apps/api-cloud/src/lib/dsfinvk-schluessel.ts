/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE GESCHLOSSENEN LISTEN DER NORM — und drei Werte, die dort nie standen
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `BON_TYP`, `GV_TYP` und `ZAHLART_TYP` sind keine freien Textfelder. Die
 * DSFinV-K führt sie in den Anhängen B, C und D als GESCHLOSSENE Listen. Ein
 * Wert daneben ist kein Schönheitsfehler: das Prüfwerkzeug kennt ihn nicht.
 *
 * ── Was der alte Erzeuger schrieb, und was davon falsch war ──────────────
 *
 * 1. `BON_TYP = 'Beleg-Storno'` bei einem Storno.
 *    Diesen Wert gibt es nicht. Anhang B kennt `AVBelegstorno`.
 *
 * 2. `GV_TYP = 'Einkauf'` beim Ankauf von Privat.
 *    Im ganzen Normtext kommt „Einkauf" NULL Mal als Geschäftsvorfalltyp vor.
 *    Nachgezählt am Volltext der amtlichen PDF.
 *
 * 3. `UST_SCHLUESSEL_FALLBACK = '7'` für jeden unbekannten Code.
 *    Ein stiller Rückfall in einen Steuerschlüssel. Was der Erzeuger nicht
 *    kannte, buchte er als Differenzbesteuerung.
 *
 * ── Und der schwerste: Schlüssel 7 für § 25a ─────────────────────────────
 *
 * Der alte Quelltext behauptete in einem Kommentar, 7 stehe für die
 * Differenzbesteuerung. Dafür gibt es keinen Beleg. Anhang C der Norm hält
 * die IDs unter 1000 für die DSFinV-K selbst zurück; individuelle
 * Sachverhalte beginnen bei 1000.
 *
 * Welche Nummer für § 25a zu vergeben ist, entscheidet der Steuerberater —
 * sie muss zu seiner Buchhaltung passen, nicht zu unserer Vermutung. Bis er
 * sie nennt, bleibt das Feld LEER und der Export sagt, warum.
 */

import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

/** Anhang B — die Vorgangstypen. Wörtlich aus der Norm. */
export const BON_TYP = {
  BELEG: 'Beleg',
  RECHNUNG: 'AVRechnung',
  TRANSFER: 'AVTransfer',
  BESTELLUNG: 'AVBestellung',
  TRAINING: 'AVTraining',
  /** Der Storno. NICHT „Beleg-Storno" — den Wert gibt es nicht. */
  BELEGSTORNO: 'AVBelegstorno',
  BELEGABBRUCH: 'AVBelegabbruch',
  SACHBEZUG: 'AVSachbezug',
  SONSTIGE: 'AVSonstige',
} as const;

/** Anhang C — die Geschäftsvorfalltypen. Wörtlich aus der Norm. */
export const GV_TYP = {
  UMSATZ: 'Umsatz',
  PFAND: 'Pfand',
  PFAND_RUECKZAHLUNG: 'PfandRueckzahlung',
  RABATT: 'Rabatt',
  AUFSCHLAG: 'Aufschlag',
  ZUSCHUSS_ECHT: 'ZuschussEcht',
  ZUSCHUSS_UNECHT: 'ZuschussUnecht',
  TRINKGELD_AG: 'TrinkgeldAG',
  TRINKGELD_AN: 'TrinkgeldAN',
  EINZWECK_KAUF: 'EinzweckgutscheinKauf',
  EINZWECK_EINLOESUNG: 'EinzweckgutscheinEinloesung',
  MEHRZWECK_KAUF: 'MehrzweckgutscheinKauf',
  MEHRZWECK_EINLOESUNG: 'MehrzweckgutscheinEinloesung',
  FORDERUNGSENTSTEHUNG: 'Forderungsentstehung',
  FORDERUNGSAUFLOESUNG: 'Forderungsaufloesung',
  ANZAHLUNGSEINSTELLUNG: 'Anzahlungseinstellung',
  ANZAHLUNGSAUFLOESUNG: 'Anzahlungsaufloesung',
  ANFANGSBESTAND: 'Anfangsbestand',
  PRIVATENTNAHME: 'Privatentnahme',
  PRIVATEINLAGE: 'Privateinlage',
  GELDTRANSIT: 'Geldtransit',
  LOHNZAHLUNG: 'Lohnzahlung',
  EINZAHLUNG: 'Einzahlung',
  AUSZAHLUNG: 'Auszahlung',
  DIFFERENZ_SOLL_IST: 'DifferenzSollIst',
} as const;

/** Anhang D — die Zahlarten. Wörtlich aus der Norm. */
export const ZAHLART_TYP = {
  BAR: 'Bar',
  UNBAR: 'Unbar',
  KEINE: 'Keine',
  EC_KARTE: 'ECKarte',
  KREDITKARTE: 'Kreditkarte',
  EL_ZAHLUNGSDIENSTLEISTER: 'ElZahlungsdienstleister',
  GUTHABENKARTE: 'Guthabenkarte',
} as const;

/** Ein Wert, den die Norm nicht kennt, wird NICHT geschrieben. */
export class UnbekannterNormwertError extends DomainError {
  /**
   * ⚠️ 409, nicht 500. Nichts ist kaputt — ein Wert passt nicht zur Norm,
   * und die Meldung sagt genau welcher und was erlaubt wäre.
   *
   * Der erste Entwurf erbte von `Error`, und der Fehlerbehandler prüft
   * `instanceof DomainError`. Der ganze Satz stand dann nur im
   * Serverprotokoll, während der Mensch „Internal server error" las.
   */
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
  public constructor(feld: string, wert: string, erlaubt: readonly string[]) {
    super(
      `DSFinV-K ${feld}: „${wert}" steht nicht in der geschlossenen Liste der Norm. ` +
        `Erlaubt sind: ${erlaubt.join(', ')}. Es wurde KEIN Paket erzeugt, ein ` +
        `Prüfwerkzeug kennt den Wert nicht und weist den Datenträger zurück.`,
    );
  }
}

const erlaubt = (o: Record<string, string>): string[] => Object.values(o);

export function pruefeBonTyp(wert: string): string {
  if (!erlaubt(BON_TYP).includes(wert)) {
    throw new UnbekannterNormwertError('BON_TYP', wert, erlaubt(BON_TYP));
  }
  return wert;
}

export function pruefeGvTyp(wert: string): string {
  if (!erlaubt(GV_TYP).includes(wert)) {
    throw new UnbekannterNormwertError('GV_TYP', wert, erlaubt(GV_TYP));
  }
  return wert;
}

export function pruefeZahlartTyp(wert: string): string {
  if (!erlaubt(ZAHLART_TYP).includes(wert)) {
    throw new UnbekannterNormwertError('ZAHLART_TYP', wert, erlaubt(ZAHLART_TYP));
  }
  return wert;
}

// ═══════════════════════════════════════════════════════════════════════════
//  DIE ZUORDNUNG DES HAUSES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Der Vorgangstyp eines Belegs.
 *
 * ⚠️ ZWEIMAL berichtigt, und die zweite Berichtigung wiegt schwerer.
 *
 * Der alte Erzeuger schrieb `Beleg-Storno` — ein Wert, den Anhang B nicht
 * kennt. Ich ersetzte ihn durch `AVBelegstorno`, weil der Wert dort steht.
 * Das war zu kurz gedacht: er steht dort, aber er meint etwas ANDERES, und
 * für eine TSE-Kasse ist er ausdrücklich verboten.
 *
 * Anhang B, wörtlich:
 *
 *   „Der AVBelegstorno zeigt eine vollständige Stornierung des Originalbelegs
 *    an, so dass sämtliche Beträge nicht mehr im Kassenabschluss
 *    berücksichtigt werden. Hinweis: Mit dem AVBelegstorno ist nicht die
 *    negative Darstellung eines Beleges gemeint. Hierfür muss weiterhin der
 *    Vorgangstyp ‚Beleg' mit umgekehrten Vorzeichen und ohne
 *    Storno-Kennzeichen genutzt werden."
 *
 *   „Achtung! Sobald eine TSE an einer Kasse eingesetzt wird, ist es
 *    technisch nicht mehr möglich, den Vorgangstyp ‚AVBelegstorno' korrekt zu
 *    verwenden, da jeder Beleg schon vor dem Setzen des Storno-Kennzeichens
 *    bereits durch die TSE [signiert wurde]."
 *
 * Dieses Haus schreibt eine GEGENBUCHUNG: der Storno ist ein eigener Beleg
 * mit negierten Beträgen und eigener TSE-Signatur. Das ist genau die
 * „negative Darstellung", für die der Vorgangstyp `Beleg` gilt.
 *
 * Der Unterschied ist nicht kosmetisch: `AVBelegstorno` nähme dem Prüfer BEIDE
 * Belege aus dem Kassenabschluss. Bei uns stehen beide drin, und ihre Summe
 * ist null. Das ist die richtige Darstellung — und der Verweis auf den
 * Urbeleg gehört dann zwingend in `references.csv` (Tz. 4.2.2).
 */
export function bonTypFuer(_istStorno: boolean): string {
  return BON_TYP.BELEG;
}

/**
 * Der Geschäftsvorfalltyp.
 *
 * ⚠️ Der VERKAUF ist `Umsatz`, das ist eindeutig.
 *
 * Der ANKAUF von Privat ist es NICHT. Der alte Erzeuger schrieb „Einkauf" —
 * ein Wert, der im ganzen Normtext null Mal vorkommt. Aus der geschlossenen
 * Liste käme `Auszahlung` in Betracht (Geld verlässt die Kasse), aber das ist
 * eine AUSLEGUNG, und Auslegungen dieser Art gehören dem Steuerberater.
 *
 * Bis er entscheidet, bricht der Export beim Ankauf ab, statt einen Wert zu
 * schreiben, den ein Prüfwerkzeug nicht kennt.
 */
export class GeschaeftsvorfallOffenError extends DomainError {
  /**
   * ⚠️ 409, und das ist wichtiger als es aussieht.
   *
   * Für einen Edelmetallhändler ist der Ankauf von Privat das halbe Geschäft
   * und die QUELLE der Differenzbesteuerung. Ein `throw new Error` hier liess
   * JEDEN Tag mit einem Ankaufbeleg mit 500 scheitern — also fast jeden Tag.
   *
   * Gesperrt bleibt es trotzdem: ein erfundener Geschäftsvorfalltyp wäre
   * schlimmer als kein Paket. Aber der Mensch erfährt jetzt, WARUM.
   */
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

/**
 * Der Einstellungsschlüssel, unter dem die Entscheidung des Händlers steht.
 *
 * Sie steht in den EINSTELLUNGEN und nicht im Quelltext, weil sie eine
 * steuerliche Auslegung ist und dem Steuerberater des Händlers gehört — nicht
 * uns. Dasselbe Muster wie `steuer.modus`: eine Frage, die nur der Händler
 * beantworten kann, wird gestellt statt geraten.
 */
export const SCHLUESSEL_GV_TYP_ANKAUF = 'dsfinvk.gv_typ.ankauf';

/**
 * Der Geschäftsvorfalltyp einer Richtung.
 *
 * ⚠️ 02.08.2026. Vorher warf der Ankauf IMMER. Die Begründung war und bleibt
 * richtig: „Einkauf" kommt im Normtext null Mal vor, und einen Wert zu
 * erfinden, den ein Prüfwerkzeug nicht kennt, wäre schlimmer als kein Paket.
 *
 * Nur war die Sperre ohne Ausgang. Für Norns ist das keine Randnotiz: die
 * Kasse ist auf Gold und Schmuck ausgerichtet, und dort IST der Ankauf von
 * Privat das halbe Geschäft. Es scheiterte also fast JEDER Tag, und der
 * Händler hatte keinen Ort, an dem er die Frage hätte beantworten können.
 *
 * `ankaufTyp` kommt aus den Einstellungen. Leer heisst weiterhin: gesperrt.
 * Ein Wert, den Anhang C nicht kennt, heisst ebenfalls gesperrt — sonst hätte
 * jemand „Einkauf" über die Oberfläche eintippen können, genau den Wert, dessen
 * Erfindung dieser Riegel verhindern soll.
 */
export function gvTypFuer(
  richtung: 'VERKAUF' | 'ANKAUF',
  ankaufTyp?: string | null,
): string {
  if (richtung === 'VERKAUF') return GV_TYP.UMSATZ;

  const gewaehlt = (ankaufTyp ?? '').trim();
  // ⚠️ Die erlaubten Werte kommen aus GV_TYP selbst, NICHT aus einer zweiten
  // Aufzählung. Eine handgepflegte Zweitliste driftet von Anhang C weg, und
  // niemand merkt es — das ist die stillste Art, eine Norm zu verfehlen.
  const amtlich: readonly string[] = Object.values(GV_TYP);
  if (gewaehlt !== '' && amtlich.includes(gewaehlt)) return gewaehlt;

  throw new GeschaeftsvorfallOffenError(
    'DSFinV-K GV_TYP: für den Ankauf von Privat ist noch nicht festgelegt, welcher ' +
      'Geschäftsvorfalltyp der Norm gilt. Der bisherige Wert „Einkauf" kommt im ' +
      'Normtext nicht vor. Aus Anhang C käme „Auszahlung" in Betracht, das ist eine ' +
      'Auslegung und gehört dem Steuerberater. Bitte die Entscheidung des ' +
      'Steuerberaters unter Einstellungen, Steuer eintragen; bis dahin wurde KEIN ' +
      'Paket erzeugt.' +
      (gewaehlt !== ''
        ? ` Der eingetragene Wert „${gewaehlt}" steht nicht in Anhang C und wurde nicht angenommen.`
        : ''),
  );
}

/** Die Zahlart. */
export function zahlartTypFuer(methode: string): string {
  switch (methode) {
    case 'CASH':
      return ZAHLART_TYP.BAR;
    case 'ZVT_CARD':
      return ZAHLART_TYP.EC_KARTE;
    case 'STRIPE':
    case 'STRIPE_TERMINAL':
    case 'SUMUP':
    case 'MOLLIE':
    case 'EBAY':
      return ZAHLART_TYP.EL_ZAHLUNGSDIENSTLEISTER;
    case 'BANK_TRANSFER':
      return ZAHLART_TYP.UNBAR;
    case 'VOUCHER':
      return ZAHLART_TYP.GUTHABENKARTE;

    /**
     * ⚠️ Diese beiden fehlten. Ein einziger solcher Beleg, und der ganze Tag
     * liesse sich nicht mehr ausgeben — die Funktion fiel in den `default`
     * und warf.
     *
     * ── Was davon HEUTE zutrifft, nachgemessen ─────────────────────────
     *
     * Nicht die Panik, die hier zuerst stand. Der erste Entwurf dieses
     * Kommentars nannte Inzahlungnahme und Anschreiben „einen normalen
     * Dienstag". Nachgezählt am 29.07.2026:
     *
     *     transaction_payments, warehouse14:       CASH 65, ZVT_CARD 1
     *     transaction_payments, Simulation t900:   CASH 63, ZVT_CARD 7,
     *                                              BANK_TRANSFER 7
     *
     * NULL Zeilen mit TRADE_IN, NULL mit DEBT — und zwar zwangsläufig: das
     * API-Schema `PaymentMethod` in `schemas/transaction.ts` kennt neun
     * Werte und hat die beiden NIE geführt (`git log -S` findet keinen
     * einzigen Treffer). Über HTTP kommt so eine Zeile also gar nicht
     * herein.
     *
     * ── Und trotzdem gehören sie hierher ────────────────────────────────
     *
     * Weil unter dem geschlossenen Schalter die halbe Maschine schon läuft:
     *
     *     Aufzählung `payment_method`            elf Werte, beide dabei
     *     CHECK  …_tradein_requires_ankauf       verlangt den Ankaufsbeleg
     *     FK     …_trade_in_ankauf_transaction…  zeigt auf ihn
     *     TRIGGER …_debt_guard                   verweigert DEBT ohne Kunden
     *     TRIGGER …_accumulate_debt              führt cumulative_debt_eur
     *     datev-kontierung.ts                    kennt beide seit langem
     *
     * Der DATEV-Weg trägt „Inzahlungnahme" und „Kundenkonto" also längst,
     * während der DSFinV-K-Weg an denselben Zeilen gestorben wäre. Diese
     * Schieflage ist der eigentliche Fund. Wer den Schalter öffnet, soll
     * nicht am Prüferpaket scheitern.
     *
     * Beide Zuordnungen stehen wörtlich in Anhang D:
     *
     *   „Unbar"  — „bildet alle Sachverhalte OHNE BARGELDBEWEGUNG ab … eine
     *              zusammenfassende Form für alle unbaren Zahlarten."
     *              Eine Inzahlungnahme schliesst den Vorgang ab, nur fliesst
     *              kein Bargeld. Genau dieser Fall.
     *
     *   „Keine"  — „steht für Vorgänge, die MIT KEINER ZAHLUNG abgeschlossen
     *              werden (z. B. Lieferscheine, Bestellungen …)."
     *              Ein Anschreiben ist die Entstehung einer Forderung; gezahlt
     *              wird später, und dann mit der dann gewählten Zahlart.
     *
     * Die feinere Unterscheidung trägt `ZAHLART_NAME` — auch das verlangt
     * Anhang D ausdrücklich („Individualisierung bzw. weitergehende
     * Untergliederung der Zahlarten").
     */
    case 'TRADE_IN':
      return ZAHLART_TYP.UNBAR;
    case 'DEBT':
      return ZAHLART_TYP.KEINE;
    default:
      throw new UnbekannterNormwertError('ZAHLART_TYP', methode, erlaubt(ZAHLART_TYP));
  }
}

/**
 * Der Umsatzsteuerschlüssel.
 *
 * ⚠️ Es gibt KEINEN Rückfallwert mehr. Der alte Erzeuger buchte jeden
 * unbekannten Code als `7` — also als Differenzbesteuerung. Was er nicht
 * kannte, wurde damit zur Marge.
 *
 * `MARGIN_25A` und `REVERSE_CHARGE_13B` haben hier bewusst KEINEN festen
 * Wert: die Norm hält die IDs unter 1000 für sich zurück, individuelle
 * Sachverhalte beginnen bei 1000. Welche Nummern gelten, entscheidet der
 * Steuerberater und trägt sie in den Einstellungen ein.
 */
export const UST_SCHLUESSEL_FEST: Readonly<Record<string, string>> = {
  STANDARD_19: '1',
  REDUCED_7: '2',
  /**
   * ⚠️ 6, nicht 5 — der Unterschied ist rechtlich, nicht kosmetisch.
   *
   * Anlage 2 zur DSFinV-K (Stand 05.12.2024), wörtlich:
   *     5  0,00 %  Nicht Steuerbar
   *     6  0,00 %  Umsatzsteuerfrei
   *
   * § 25c Abs. 1 UStG: „Die Lieferung von Anlagegold … ist STEUERFREI."
   * Steuerfrei heisst steuerBAR und befreit. „Nicht steuerbar" ist etwas
   * anderes: ein Vorgang ausserhalb des deutschen Umsatzsteuerrechts.
   *
   * ── Woher die 5 kam ─────────────────────────────────────────────────────
   *
   * Aus derselben Anlage 2, aber aus dem ANDEREN Abschnitt. Dort steht für
   * die Steuercontainer der TSE („Kassenbeleg-V1", Anhang I): Container 5 =
   * „0 % (umfasst nicht steuerbare UND umsatzsteuerfreie Umsätze …)". Für den
   * SIGNATURcontainer stimmt die 5 also. Für UST_SCHLUESSEL nicht.
   *
   * Zwei Zahlen, zwei Felder, ein Dokument. Wer nur einmal hinsieht,
   * verwechselt sie — und trägt Anlagegold als „nicht steuerbar" in ein
   * Prüferpaket ein.
   */
  INVESTMENT_GOLD_25C: '6',
};

/**
 * Die STAMMDATEN zu den festen Schlüsseln, wörtlich aus Anlage 2 zur
 * DSFinV-K (Stand 05.12.2024).
 *
 * Nur die drei, die dieses Haus überhaupt vergibt. Die übrigen Nummern der
 * Anlage (3, 4, 7, 8 und die historischen ab 11) gehören zu Sachverhalten,
 * die hier nicht vorkommen — sie stünden sonst als Behauptung im Paket.
 */
export const UST_STAMM_FEST: Readonly<Record<string, { satz: string; beschreibung: string }>> = {
  '1': { satz: '19.00', beschreibung: 'Allgemeiner Steuersatz § 12 Abs. 1 UStG' },
  '2': { satz: '7.00', beschreibung: 'Ermäßigter Steuersatz § 12 Abs. 2 UStG' },
  '6': { satz: '0.00', beschreibung: 'Umsatzsteuerfrei' },
};

/** Welche Behandlungen auf eine Entscheidung des Beraters warten. */
export const UST_SCHLUESSEL_OFFEN = ['MARGIN_25A', 'REVERSE_CHARGE_13B'] as const;

export class UstSchluesselOffenError extends DomainError {
  /** 409 aus demselben Grund wie oben: es fehlt eine Angabe, nichts ist kaputt. */
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
  public constructor(code: string) {
    super(
      `DSFinV-K UST_SCHLUESSEL: für „${code}" ist kein Umsatzsteuerschlüssel hinterlegt. ` +
        `Die Norm hält die IDs unter 1000 für sich zurück; individuelle Sachverhalte ` +
        `beginnen bei 1000. Welche Nummer gilt, entscheidet der Steuerberater, sie muss ` +
        `zu seiner Buchhaltung passen. Bitte unter Einstellungen → Steuer eintragen. ` +
        `Es wurde KEIN Paket erzeugt.`,
    );
  }
}

/**
 * Den Schlüssel für eine Behandlung ermitteln.
 *
 * @param eigene Die vom Berater vergebenen Nummern, aus den Einstellungen.
 */
export function ustSchluesselFuer(
  code: string,
  eigene: Readonly<Record<string, string>> = {},
): string {
  const fest = UST_SCHLUESSEL_FEST[code];
  if (fest) return fest;
  const vergeben = (eigene[code] ?? '').trim();
  if (vergeben !== '') return vergeben;
  throw new UstSchluesselOffenError(code);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER LIZENZRIEGEL — im Motor, nicht im Fenster
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Basels Auftrag vom 12.08.2026: der Freischaltschlüssel soll „im Nerv der
 * Anwendung" liegen und nicht als ein `if` im Fenster, das man löscht.
 *
 * ── DER BEFUND, DER DAS NÖTIG MACHT (gemessen am 13.08.2026) ──────────────
 *
 * `lizenz.rs` prüfte einwandfrei: Ed25519 über minisign, Gerätebindung,
 * Frist. Und `darf_verkaufen()` wurde von NICHTS gerufen ausser den eigenen
 * Tests. Eine Kasse ganz ohne Schlüssel verkaufte unbegrenzt weiter. Gebaut
 * und nie angeschlossen, im teuersten Sinn.
 *
 * ── WO DER RIEGEL SITZT UND WO NICHT ─────────────────────────────────────
 *
 *   GESPERRT   NEUE fiskalische Vorgänge: Verkauf abschliessen, Ankauf
 *              anlegen. Das ist das Geschäft, und dafür wird gezahlt.
 *
 *   OFFEN      ⚠️ ALLES ANDERE, und das ist keine Nachlässigkeit, sondern
 *              die wichtigste Zeile dieser Datei:
 *                • Tagesabschluss    — § 146a AO
 *                • DSFinV-K, DATEV, Kassennachschau — § 147 AO
 *                • Storno            — sonst sitzt der Händler auf einem
 *                                      falschen Beleg, den er nicht mehr
 *                                      berichtigen kann
 *                • Bücher lesen, Belege nachdrucken
 *
 * Ein Lizenzriegel, der den Tagesabschluss oder eine Ausfuhr blockiert,
 * zwingt einen zahlenden Kunden in die Ordnungswidrigkeit — und zwar genau
 * dann, wenn der Prüfer im Laden steht. Das wäre der teuerste Fehler des
 * ganzen Systems. Wer diese Datei erweitert: der Riegel gehört an den
 * VERKAUF, nie an Signatur, Abschluss, Storno oder Ausfuhr.
 *
 * ── WIE DER WERT HIERHERKOMMT ────────────────────────────────────────────
 *
 * Der Rumpf (Rust) besitzt den Motor, liest die Lizenz beim Start und reicht
 * `NORNS_VERKAUF_FREI` in die Umgebung. Wer das umgehen will, muss das
 * Rust-Programm ODER das Motorbündel verändern, nicht bloss einen Schalter
 * im Fenster umlegen. Mehr ist bei einem Programm, das auf dem Rechner des
 * Kunden liegt, ehrlich nicht zu haben; wer „unknackbar" verspricht,
 * verkauft ein Gefühl.
 *
 * ⚠️ FEHLT die Variable, ist der Verkauf FREI. Das ist Absicht: die Kasse
 * läuft auch in Entwicklung, in Tests und auf einem Server ohne Rumpf. Ein
 * Riegel, der bei fehlender Angabe zuschlägt, würde jede fremde Umgebung
 * stilllegen — und der ehrliche Weg, ihn zu setzen, führt ohnehin über den
 * Rumpf, der ihn immer mitschickt.
 */

/** Darf ein NEUER fiskalischer Vorgang beginnen? */
export function verkaufIstFreigegeben(umgebung: NodeJS.ProcessEnv = process.env): boolean {
  return (umgebung.NORNS_VERKAUF_FREI ?? '1').trim() !== '0';
}

/**
 * Der Satz, den der Kassierer liest.
 *
 * Er muss sagen, was NOCH geht. Ein Kassierer, der glaubt, die Kasse sei
 * kaputt, ruft den Steuerberater an statt den Inhaber — und macht in der
 * Zwischenzeit seinen Tagesabschluss nicht.
 */
export const LIZENZ_FEHLT_SATZ =
  'Diese Kasse ist nicht mehr freigeschaltet. Neue Verkäufe und Ankäufe ' +
  'brauchen einen gültigen Freischaltschlüssel. Der Tagesabschluss, alle ' +
  'Ausfuhren für das Finanzamt, Stornos und Ihre Bücher bleiben offen. ' +
  'Den Schlüssel trägt der Inhaber unter Einstellungen ein.';

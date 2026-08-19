/**
 * ════════════════════════════════════════════════════════════════════════
 *  Der Hausstandard der DSFinV-K-Angaben — EINE Quelle, zwei Flächen
 * ════════════════════════════════════════════════════════════════════════
 *
 * Der Hausstandard vom 12.08.2026, Basels Entscheidung, amtlich gegengeprüft
 * (DSFinV-K 2.4 samt Anlage 2, per Prüfsumme verifiziert). Bis zum
 * 18.08.2026 wohnte er allein in der SteuerberaterSection; seit die
 * Erstinbetriebnahme dieselben Werte als Vorschlag anbietet, steht er hier,
 * damit zwei Kopien nie auseinanderlaufen.
 *
 * ⚠️ Er wird NIE still gespeichert. Beide Flächen tragen ihn nur in LEERE
 * Felder eines sichtbaren Entwurfs ein; gespeichert wird erst, wenn der
 * Mensch es tut. Die Beschriftung für § 25a ist auf die amtlichen 55
 * Zeichen von UST-BESCHR gekürzt (Basels voller Satz hat 71); der volle
 * Satz gehört auf den Beleg, nicht in dieses Normfeld. Der Satz 19,00 bei
 * § 25a ist die Rechengrösse der Marge, KEIN offener Ausweis
 * (§ 14a Abs. 6 Satz 2 UStG); bei § 13b schuldet der Empfänger die Steuer,
 * darum 0,00. Die Kanzlei zeichnet gegen (Brief in docs/fiskal).
 */
export const HAUSSTANDARD_DSFINVK = {
  'dsfinvk.gv_typ.ankauf': 'Auszahlung',
  'dsfinvk.ust_schluessel.margin_25a': '1001',
  'dsfinvk.ust_schluessel.reverse_charge_13b': '1002',
  'dsfinvk.ust_satz.margin_25a': '19.00',
  'dsfinvk.ust_satz.reverse_charge_13b': '0.00',
  'dsfinvk.ust_beschreibung.margin_25a': 'Differenzbesteuerung § 25a UStG, Basis ist die Marge',
  'dsfinvk.ust_beschreibung.reverse_charge_13b': 'Steuerschuldnerschaft des Leistungsempfängers',
} as const;

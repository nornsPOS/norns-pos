/**
 * shop-info — the shop identity printed on every customer receipt (Kassenbon)
 * and shown in the on-screen receipt preview.
 *
 * GoBD / KassenSichV require the REAL shop name, full address, and USt-IdNr. on
 * the receipt. The live values come from `GET /api/shop-info` (Owner-editable,
 * system_settings, migration 0044); this bundled constant is the fallback for
 * the header fields that are safe to default (name, tagline, address).
 *
 * The tax identifiers and phone are DELIBERATELY empty here (Phase 7.2): a
 * receipt must NEVER print a placeholder id (`DE123456789` on a Kassenbon is a
 * GoBD breach). With NEITHER identifier configured the receipt LOCKS (see
 * `isReceiptShopValid`) rather than printing a fake or blank one.
 *
 * ── Steuernummer ODER USt-IdNr., nicht zwingend beide ──────────────────────
 *
 * § 14 Abs. 4 Nr. 2 UStG verlangt "die dem leistenden Unternehmer vom
 * Finanzamt erteilte Steuernummer ODER die ihm vom Bundeszentralamt für
 * Steuern erteilte Umsatzsteuer-Identifikationsnummer". Beides erfüllt das
 * Gesetz, eines genügt.
 *
 * Diese Datei verlangte früher ausschliesslich die USt-IdNr. Ein Einzelhändler,
 * der nur eine Steuernummer hat, und das ist bei einem frisch gegründeten
 * Edelmetallhandel der Regelfall, konnte damit am ersten Tag ÜBERHAUPT KEINEN
 * Beleg drucken. Kein Umweg, keine Fehlermeldung, die den wahren Grund nennt:
 * die Kasse blieb einfach gesperrt.
 *
 * Darum trägt der Beleg jetzt, was der Betrieb wirklich hat, unter der jeweils
 * richtigen Beschriftung. Eine Steuernummer unter der Überschrift "USt-IdNr."
 * zu drucken wäre der zweitschlimmste Ausweg gewesen.
 */

export interface ShopInfo {
  name: string;
  /** One short tagline under the name, e.g. trade line. Empty string hides it. */
  tagline: string;
  /** Each entry is one printed address line (street, then "PLZ Ort"). */
  address: readonly string[];
  /** USt-IdNr. (German VAT id). Empty when not configured. */
  vatId: string;
  /** Steuernummer vom Finanzamt. Die Alternative zur USt-IdNr. nach § 14 UStG. */
  taxNumber: string;
  /** Optional phone; printed as `Tel.: …` when set. */
  phone: string | null;
}

/**
 * ⚠️ 30.07.2026, MANDANTENNEUTRAL. Hier standen Name, Zeile und Anschrift
 * EINES Ladens fest im Programm. In Warehouse14 war das der eigene Laden und
 * damit richtig; in Norns POS ist jeder Käufer ein anderer Laden, und ein
 * fest eingebauter Name druckt einem fremden Händler die Adresse eines
 * anderen auf seine Belege.
 *
 * Alles kommt jetzt aus der Ladenidentität. Steht dort nichts, bleibt es
 * LEER — eine leere Zeile fällt beim ersten Beleg auf, ein fremder Name
 * vielleicht nie.
 */
export const SHOP_INFO: ShopInfo = {
  name: '',
  tagline: '',
  address: [],
  // NO placeholder VAT id / phone — an unconfigured USt-IdNr. must LOCK the
  // receipt, never print a fake one (GoBD). The real values live in the server
  // shop-info settings and flow in via `resolveShopInfo`.
  vatId: '',
  taxNumber: '',
  phone: null,
};

/** The `GET /api/shop-info` payload shape (system_settings, migration 0044). */
export interface ShopInfoApi {
  name: string;
  tagline: string;
  addressLine1: string;
  addressLine2: string;
  vatId: string;
  taxNumber: string;
  phone: string;
}

/**
 * Merge the API shop identity over the bundled fallback. The VAT id is taken
 * ONLY from the server (never the constant, which is empty) so an unconfigured
 * id resolves to empty and locks the receipt — it can never inject a placeholder.
 */
export function resolveShopInfo(api: ShopInfoApi | undefined): ShopInfo {
  if (!api) return SHOP_INFO;
  const serverAddress = [api.addressLine1, api.addressLine2].filter((l) => l.length > 0);
  return {
    // ── KEINE FREMDE IDENTITÄT ALS RÜCKFALL (30.07.2026, Basels Befund) ─────
    //
    // Hier stand `api.name || SHOP_INFO.name`, und die Anschrift genauso.
    // Damit trug JEDER Mandant mit noch leeren Feldern — also jeder neue
    // Laden am ersten Tag — sichtbar „WAREHOUSE 14, Rosenstraße 40" auf
    // Beleg, Briefkopf und in der Maske. Zwei Schäden in einem: die
    // Mandantenneutralität (KOORDINATION §7) war gebrochen, UND ein Inhaber,
    // der ein Feld LEERTE, sah den fremden Wert zurückkommen — sein Eingriff
    // wirkte wie verworfen.
    //
    // Leer ist ab jetzt leer. Wer den Platz füllen muss, sieht das an der
    // Leere; die Flächen benennen sie (Einstellungen → Beleg & Shop), und
    // der Druck sperrt, statt einen fremden Namen zu erfinden.
    name: api.name,
    tagline: api.tagline,
    address: serverAddress,
    vatId: api.vatId.trim(),
    taxNumber: (api.taxNumber ?? '').trim(),
    phone: api.phone.trim().length > 0 ? api.phone.trim() : null,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE PFLICHTANGABEN DES BELEGKOPFES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── WAS HIER VORHER STAND, UND WARUM ES FALSCH WAR (05.08.2026) ────────────
 *
 * `isReceiptShopValid` war eine einzige Zeile:
 *
 *     return shop.vatId.trim().length > 0 || shop.taxNumber.trim().length > 0;
 *
 * Der Riegel fragte also NUR nach der Steuerkennung. Firmenname und Anschrift
 * durfte ein Betrieb leer lassen, und der Beleg wurde trotzdem gedruckt.
 *
 * Gemessen war damit möglich: ein vollständiger Verkauf, bezahlt, signiert,
 * und am Ende ein Papier, auf dem oben NICHTS steht ausser einer Steuernummer.
 * § 14 Abs. 4 UStG verlangt aber in Nummer 1 den vollständigen Namen UND die
 * vollständige Anschrift des leistenden Unternehmers, und erst in Nummer 2 die
 * Steuernummer oder die USt-IdNr. Der Riegel erzwang die Nummer 2 und liess
 * die Nummer 1 offen.
 *
 * Das ist genau die Sorte Lücke, die nie auffällt: der Kassierer sieht einen
 * Beleg, der Drucker läuft, nichts wird rot. Erst der Kunde, der den Zettel
 * liest, oder der Prüfer, der ihn in die Hand nimmt, sieht das leere Feld.
 *
 * ── WARUM EINE TABELLE UND KEINE KETTE VON UND-VERGLEICHEN ─────────────────
 *
 * Der Riegel prüft eine EIGENSCHAFT je Angabe, nicht eine feste Bedingung an
 * einer Stelle. Wer später eine vierte Pflichtangabe braucht, trägt sie hier
 * ein, und Sperre, Meldung und Prüfsatz kennen sie sofort. Eine ausgeschriebene
 * Kette müsste an drei Stellen nachgezogen werden, und die dritte vergisst man.
 */
interface Pflichtangabe {
  /** So heisst die Angabe, wenn sie in einer Meldung genannt wird. */
  label: string;
  /** Steht sie da? Leerraum zählt nicht als Angabe. */
  vorhanden: (shop: ShopInfo) => boolean;
}

export const BELEG_PFLICHTANGABEN: readonly Pflichtangabe[] = [
  // § 14 Abs. 4 Nr. 1 UStG: der vollständige Name des Unternehmers.
  { label: 'der Firmenname', vorhanden: (s) => s.name.trim().length > 0 },
  // § 14 Abs. 4 Nr. 1 UStG: die vollständige Anschrift. Eine gepflegte Zeile
  // genügt als Nachweis, dass überhaupt jemand die Anschrift eingetragen hat;
  // ob sie fachlich stimmt, kann diese Kasse nicht wissen und erfindet sie
  // deshalb auch nicht.
  {
    label: 'die Anschrift',
    vorhanden: (s) => s.address.some((zeile) => zeile.trim().length > 0),
  },
  // § 14 Abs. 4 Nr. 2 UStG: Steuernummer ODER USt-IdNr., eines genügt.
  {
    label: 'die Steuernummer oder die USt-IdNr.',
    vorhanden: (s) => receiptTaxIdentifier(s) !== null,
  },
];

/**
 * Welche Pflichtangaben des Belegkopfes fehlen, in der Sprache des Inhabers.
 * Leer heisst: der Kopf ist vollständig.
 */
export function fehlendeBelegangaben(shop: ShopInfo): string[] {
  return BELEG_PFLICHTANGABEN.filter((p) => !p.vorhanden(shop)).map((p) => p.label);
}

/**
 * True when the shop identity is complete enough to print a GoBD-valid receipt.
 *
 * Fehlt eine einzige Pflichtangabe, ist der Beleg gesperrt, statt mit einer
 * erfundenen oder leeren Zeile gedruckt zu werden. Ein leeres Feld fällt auf,
 * ein erfundenes sieht richtig aus.
 */
export function isReceiptShopValid(shop: ShopInfo): boolean {
  return fehlendeBelegangaben(shop).length === 0;
}

/**
 * Welche Kennung auf den Beleg gehört, mit der Beschriftung, die dazu passt.
 *
 * Die USt-IdNr. hat Vorrang, wenn beide vorhanden sind: sie ist im
 * grenzüberschreitenden Geschäft die aussagekräftigere Angabe. Gibt es keine
 * von beiden, liefert die Funktion null, und der Aufrufer darf nicht drucken.
 */
export function receiptTaxIdentifier(shop: ShopInfo): { label: string; value: string } | null {
  const vat = shop.vatId.trim();
  if (vat.length > 0) return { label: 'USt-IdNr.', value: vat };
  const tax = shop.taxNumber.trim();
  if (tax.length > 0) return { label: 'Steuernummer', value: tax };
  return null;
}

/**
 * Der EINE Satz, den jede Druckfläche zeigt, wenn der Belegkopf unvollständig
 * ist. Hier als einzige Quelle, damit Erstdruck und Nachdruck denselben
 * Wortlaut zeigen; eine abweichende Kopie auf dem Nachdruckweg war schon
 * einmal der Grund, warum die Sperre still umgangen wurde.
 *
 * ── WAS VORHER DASTAND, UND WARUM ES JETZT FALSCH WÄRE (05.08.2026) ────────
 *
 * Der Satz lautete: „Weder Steuernummer noch USt-IdNr. hinterlegt. Beleg
 * gesperrt. Bitte eine der beiden in den Einstellungen ergänzen."
 *
 * Er war richtig, solange der Riegel NUR die Steuerkennung prüfte. Seit der
 * Riegel auch Firmenname und Anschrift verlangt, hätte dieser Wortlaut gelogen:
 * ein Betrieb mit gepflegter Steuernummer und leerem Namen hätte gelesen, seine
 * Steuernummer fehle, und hätte sie nachgetragen, ohne dass sich etwas ändert.
 * Eine Sperre, die auf das falsche Feld zeigt, ist schlimmer als gar keine.
 *
 * ⚠️ Der Name der Konstante bleibt, obwohl sie mehr abdeckt als die
 * Steuerkennung. Umbenennen hiesse, drei Flächen anzufassen, und dieser
 * Eingriff gehört ausdrücklich nur in den Motor. Wer den Namen später
 * mitzieht, findet die Aufrufer über eine Textsuche nach dem Bezeichner.
 *
 * ⚠️ Der Satz nennt die PFLICHT, nicht das einzelne fehlende Feld: eine
 * Konstante kann nicht wissen, was gerade leer ist. Welche Angabe konkret
 * fehlt, sagt `fehlendeBelegangaben`; eine Fläche, die das anzeigen will,
 * fragt dort nach.
 */
export const RECEIPT_VAT_LOCK_REASON =
  'Der Belegkopf ist unvollständig. Nach § 14 UStG gehören auf jeden Beleg der ' +
  'Firmenname, die vollständige Anschrift und die Steuernummer oder die USt-IdNr. ' +
  'Beleg gesperrt. Bitte die fehlende Angabe in den Einstellungen ergänzen.';

/**
 * Dieselbe Entscheidung wie `receiptTaxIdentifier`, aber auf der FERTIGEN
 * Belegnutzlast statt auf der Ladenidentität.
 *
 * Sie ist nötig, weil der Nachdruck aus dem Kassenbuch einen gespeicherten
 * Beleg zeigt und nicht die heutigen Einstellungen. Ein Beleg von gestern muss
 * genau die Kennung tragen, die gestern gedruckt wurde.
 *
 * WARUM ALS EIGENE FUNKTION, und nicht als Vergleich an der Aufrufstelle:
 * genau dort lag der Fehler schon einmal. Der Nachdruckpfad prüfte
 * `shopVatId.trim()` von Hand statt die gemeinsame Regel zu benutzen, und war
 * damit von der Regel abgekoppelt, ohne dass es jemand sah.
 */
export function receiptPayloadTaxIdentifier(payload: {
  shopVatId: string;
  shopTaxNumber?: string;
}): { label: string; value: string } | null {
  const vat = payload.shopVatId.trim();
  if (vat.length > 0) return { label: 'USt-IdNr.', value: vat };
  const tax = (payload.shopTaxNumber ?? '').trim();
  if (tax.length > 0) return { label: 'Steuernummer', value: tax };
  return null;
}

/**
 * Dieselbe Prüfung wie `fehlendeBelegangaben`, aber auf der FERTIGEN
 * Belegnutzlast statt auf der heutigen Ladenidentität.
 *
 * ── WARUM ES DIESE ZWEITE TÜR BRAUCHT ──────────────────────────────────────
 *
 * Der Erstdruck fragt die Einstellungen, der Nachdruck aus dem Kassenbuch
 * fragt den gespeicherten Beleg. Bis heute prüfte der Nachdruckweg nur, ob eine
 * Steuerkennung auf dem gespeicherten Beleg steht (`receiptPayloadTaxIdentifier`
 * als Sperre). Ein gespeicherter Beleg ohne Absender liess sich damit beliebig
 * oft nachdrucken, auch nachdem der Erstdruck dafür gesperrt wurde. Das ist die
 * Klasse „Vordertür zu, Hintertür offen", die dieses Haus beim TSE-Riegel schon
 * einmal teuer bezahlt hat.
 *
 * ⚠️ Sie baut KEINE eigene Regel, sondern reicht die Nutzlast an die EINE
 * Tabelle weiter. Die Regel ist damit dieselbe.
 *
 * ── EINE STELLE, AN DER DIE NUTZLAST TROTZDEM MILDER IST (05.08.2026) ──────
 *
 * Hier stand: „Damit kann der Nachdruck nicht strenger und nicht milder werden
 * als der Erstdruck, auch nicht versehentlich." Das ist nachgemessen FALSCH und
 * darum die gefährlichste Zeile der Datei gewesen: sie hätte einen späteren
 * Leser glauben lassen, die Hintertür sei durch die Bauart zu.
 *
 * Gemessen: die Nutzlast trägt gar keine getrennte Anschrift. `BezahlenDialog`
 * und `buildAnkaufReceipt` schreiben beide `[shop.tagline, ...shop.address]` in
 * EIN Feld `shopAddress`, und `ThermalReceiptData` kennt kein eigenes Feld für
 * die Zeile unter dem Namen. Ein Betrieb mit gepflegter Zeile („An- und
 * Verkauf") und LEERER Anschrift sperrt deshalb beim Erstdruck, würde beim
 * Nachdruck aber durchgelassen: die Zeile sieht in der Nutzlast wie eine
 * Anschriftszeile aus.
 *
 * Betroffen sind gespeicherte Belege aus der Zeit VOR diesem Riegel, und genau
 * die soll der Nachdruckriegel ja abfangen. Zu schliessen ist das nur dort, wo
 * der Fehler entsteht: die Nutzlast muss Zeile und Anschrift getrennt führen.
 * Das sind `lib/hardware-client.ts` und die beiden Erzeuger, also fremde
 * Dateien; hier steht deshalb die gemessene Wahrheit statt eines Versprechens.
 * Der Prüfsatz „die Nutzlast kann Zeile und Anschrift NICHT unterscheiden"
 * hält den Befund fest, bis jemand ihn wirklich behebt.
 *
 * `tagline` und `phone` sind hier bewusst leer beziehungsweise null: beide sind
 * keine Pflichtangabe, und ein erfundener Wert wäre schlimmer als ein leerer.
 */
export function fehlendeBelegangabenAufNutzlast(payload: {
  shopName: string;
  shopAddress: readonly string[];
  shopVatId: string;
  shopTaxNumber?: string;
}): string[] {
  return fehlendeBelegangaben({
    name: payload.shopName,
    tagline: '',
    address: payload.shopAddress,
    vatId: payload.shopVatId,
    taxNumber: payload.shopTaxNumber ?? '',
    phone: null,
  });
}

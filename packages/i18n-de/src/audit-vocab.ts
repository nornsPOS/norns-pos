/**
 * Audit / Tagebuch — die geteilte Präsentationsschicht für das GoBD-Ereignis-
 * register (`ledger_events`). Anders als die Benachrichtigungszentrale, die nur
 * die wenigen owner-relevanten Ereignisse KURATIERT, zeigt das Tagebuch das
 * VOLLSTÄNDIGE, fortlaufende Protokoll: wer hat wann was getan. Jede Zeile ist
 * ein unveränderlicher, hash-verketteter Append-only-Eintrag (`rowHashHex`),
 * den der Server geschrieben hat. Diese Fläche ist READ-ONLY und CLIENT-ONLY
 * über `GET /api/ledger` — sie liest das Protokoll, sie verändert nichts.
 *
 * Honesty-Regel (absolut): Labels und Werte stammen NUR aus dem echten
 * Ereignistyp + den echten Payload-Feldern (defensiv gelesen). Fehlt ein Detail,
 * fällt es weg — nie wird eine Zahl, ein Name oder ein Betrag erfunden. Der
 * Ereignistyp-Raum ist OFFEN (die api-client-Typen akzeptieren ausdrücklich auch
 * unbekannte Strings): darum gibt es kuratierte deutsche Labels für die bekannten
 * Typen UND eine ehrliche, humanisierende Herleitung für jeden unbekannten
 * `domain.action`-String — nie ein roher Maschinen-String ohne Kontext.
 *
 * Reines, framework-freies Modul (keine React-Imports) — nur Daten + Mapper, so
 * wie belege-ui.ts / whatsapp-ui.ts / ebay-ui.ts. Die Bildschirme ziehen daraus.
 */
import { DOCUMENT_CATEGORY_LABELS } from "@norns/api-client"

import {
  ANKAUF_CONDITION_LABEL,
  APPOINTMENT_STATUS_LABEL,
  APPOINTMENT_TYPE_LABEL,
  CLOSING_STATE_LABELS,
  CUSTOMER_KYC_STATUS_LABEL,
  CUSTOMER_TRUST_LEVEL_LABEL,
  PAYMENT_METHOD_LABEL,
  PRODUCT_STATUS_LABEL,
  TASK_STATUS_LABEL,
  TAX_TREATMENT_LABEL,
  TRANSACTION_DIRECTION_LABEL,
} from "./german-text"

/**
 * Dev-build detection that works everywhere this shared module runs: React
 * Native (the Metro global `__DEV__`), Node/Vite (NODE_ENV). Never throws when
 * the global is absent — it just reports "not dev" so the warning stays silent.
 */
function isDevBuild(): boolean {
  const g = globalThis as { __DEV__?: boolean; process?: { env?: { NODE_ENV?: string } } }
  if (typeof g.__DEV__ === "boolean") return g.__DEV__
  return g.process?.env?.NODE_ENV !== "production"
}

// ── Ereignis-Kategorie (die Filter-Dimension) ────────────────────────────────
// Jeder Ereignistyp ist ein `domain.action`-String (z. B. `transaction.finalized`).
// Wir bündeln die `domain`-Präfixe zu wenigen, stabilen Owner-Kategorien — die
// Chips, nach denen gefiltert wird. „alert"/„security" werden bewusst zu EINER
// Sicherheits-Kategorie zusammengezogen (sie lesen sich gleich laut), und alles
// Unbekannte fällt ehrlich in „Sonstiges", statt eine falsche Heimat zu erfinden.

export type EventCategory =
  | "sales" // Verkauf / Storno / Rückgabe / Ankauf der fiskalische Kern
  | "inventory" // Artikel: angelegt, geändert, reserviert, archiviert
  | "customers" // Kunden + KYC/GwG-Stammdaten
  | "fiscal" // Tagesabschluss, Belegtexte, Metallpreise, Schicht/Kasse
  | "security" // alert.* + security.* Sicherheits- & Compliance-Signale
  | "approvals" // Freigaben (command.approval_*)
  | "appointments" // Termine
  | "system" // Auth, Einstellungen, Hintergrund-Jobs, Foto-Pipeline
  | "other" // alles ehrlich Unbekannte

export interface CategoryText {
  /** Kurzes deutsches Label für den Filter-Chip + die Detail-Kopfzeile. */
  label: string
  /**
   * Ob die Kategorie ein echtes Sicherheits-/Compliance-Signal ist und optisch
   * laut (ruhig-rot) markiert werden darf — die einzige, die das darf.
   */
  emphasis: boolean
  /** Eine ruhige deutsche Erklärzeile für die Filter-/Leer-Hilfe. */
  hint: string
}

/**
 * The PURE category vocabulary (label + hint + emphasis) — no icon, no badge
 * variant. Each platform pairs this with its own icon/badge presentation
 * (mobile in audit-ui.ts, desktop in its own audit presentation module) so the
 * words stay in one place and only the rendering differs.
 */
export const CATEGORY_TEXT: Readonly<Record<EventCategory, CategoryText>> = {
  sales: {
    label: "Handel",
    emphasis: false,
    hint: "Verkäufe, Stornos, Rückgaben und Ankäufe der fiskalische Kern.",
  },
  inventory: {
    label: "Lager",
    emphasis: false,
    hint: "Artikel angelegt, geändert, reserviert, umgelagert oder archiviert.",
  },
  customers: {
    label: "Kunden",
    emphasis: false,
    hint: "Kundenstammdaten und KYC-/GwG-Nachweise.",
  },
  fiscal: {
    label: "Fiskal",
    emphasis: false,
    hint: "Tagesabschlüsse, Belegtexte, Metallpreise und Schicht-/Kassenbewegungen.",
  },
  security: {
    label: "Sicherheit",
    emphasis: true,
    hint: "Sicherheits- und Compliance-Signale (Alerts, GwG, TSE, Signaturkette).",
  },
  approvals: {
    label: "Freigaben",
    emphasis: false,
    hint: "Freigabe-Anfragen und -Entscheidungen für hochwertige Vorgänge.",
  },
  appointments: {
    label: "Termine",
    emphasis: false,
    hint: "Termine gebucht, bestätigt, verschoben oder abgesagt.",
  },
  system: {
    label: "System",
    emphasis: false,
    hint: "Anmeldungen, Einstellungen, Hintergrund-Jobs und die Foto-Pipeline.",
  },
  other: {
    label: "Sonstiges",
    emphasis: false,
    hint: "Weitere protokollierte Ereignisse.",
  },
}

export function categoryText(category: EventCategory): CategoryText {
  return CATEGORY_TEXT[category]
}

/**
 * Reihenfolge der Filter-Chips: der fiskalische Kern zuerst, dann die lauten
 * Sicherheits-Signale, dann der Betrieb, „Sonstiges" zuletzt.
 */
export const CATEGORY_ORDER: readonly EventCategory[] = [
  "sales",
  "fiscal",
  "security",
  "inventory",
  "customers",
  "approvals",
  "appointments",
  "system",
  "other",
] as const

/**
 * Welche `domain`-Präfixe (der Teil vor dem ersten „.") in welche Kategorie
 * fallen. Das ist die ehrliche, deterministische Heimat-Findung: ein unbekannter
 * Typ mit bekanntem Präfix (z. B. ein neues `product.foo`) landet trotzdem in
 * „Lager", ohne dass wir den Typ einzeln kennen müssen.
 */
const DOMAIN_CATEGORY: Readonly<Record<string, EventCategory>> = {
  transaction: "sales",
  ankauf: "sales",
  appraisal: "sales",
  payment_intent: "sales",
  // Web-Reservierungen zur Abholung (0099): reservieren, annehmen, vorbereiten,
  // abholbereit, abholen. Das ist der Storefront-Handel und landet unter „Handel".
  web_order: "sales",
  product: "inventory",
  inventory: "inventory",
  photo: "system",
  customer: "customers",
  daily_closing: "fiscal",
  shift: "fiscal",
  cash: "fiscal",
  metal_price: "fiscal",
  belegtext: "fiscal",
  alert: "security",
  security: "security",
  command: "approvals",
  appointment: "appointments",
  auth: "system",
  user: "system",
  pin: "system",
  session: "system",
  device: "system",
  system_setting: "system",
  task: "system",
  document: "system",
  internal_task: "system",
}

/** Den `domain`-Teil eines `domain.action`-Ereignistyps (vor dem ersten „."). */
export function eventDomain(eventType: string): string {
  const dot = eventType.indexOf(".")
  return dot === -1 ? eventType : eventType.slice(0, dot)
}

/** Den `action`-Teil eines Ereignistyps (nach dem ersten „."), oder "". */
export function eventAction(eventType: string): string {
  const dot = eventType.indexOf(".")
  return dot === -1 ? "" : eventType.slice(dot + 1)
}

/** Die Kategorie eines Ereignistyps — bekannt über das Präfix, sonst „Sonstiges". */
export function eventCategory(eventType: string): EventCategory {
  return DOMAIN_CATEGORY[eventDomain(eventType)] ?? "other"
}

// ── Kuratierte deutsche Labels (für die häufigen, bekannten Typen) ────────────
// Eine genaue, ruhige deutsche Überschrift je bekanntem Ereignistyp. Fehlt der
// Typ hier, leitet `humanizeAction` aus dem `action`-Teil ein lesbares Label ab
// (nie ein roher `snake_case.string`). So bleibt die Liste auch bei einem neuen
// Backend-Ereignistyp ehrlich und lesbar, ohne hier zu lügen.

const EVENT_LABELS: Readonly<Record<string, string>> = {
  // Handel
  "transaction.finalized": "Verkauf abgeschlossen",
  "transaction.stornoed": "Storno gebucht",
  "transaction.stornoed_with_reason": "Storno gebucht",
  "transaction.returned": "Rückgabe gebucht",
  "ankauf.completed": "Ankauf abgeschlossen",
  "appraisal.accepted": "Bewertung angenommen",
  "appraisal.rejected": "Bewertung abgelehnt",
  "payment_intent.payment_failed": "Zahlung fehlgeschlagen",
  "payment_intent.succeeded": "Zahlung bestätigt",
  "payment_intent.canceled": "Zahlung abgebrochen",
  "cart.abandoned_by_sweeper": "Warenkorb verfallen",
  // Web-Reservierungen zur Abholung (0099)
  "web_order.reserved": "Online reserviert",
  "web_order.approved": "Bestellung angenommen",
  "web_order.prepared": "Bestellung in Vorbereitung",
  "web_order.ready": "Bestellung abholbereit",
  "web_order.collected": "Bestellung abgeholt",
  "web_order.expired": "Reservierung verfallen",
  "web_order.cancelled": "Bestellung storniert",
  // Lager
  "product.created": "Artikel angelegt",
  "product.listed": "Artikel veröffentlicht",
  "product.updated": "Artikel geändert",
  "product.archived": "Artikel archiviert",
  "product.deleted": "Artikel gelöscht",
  "product.reserved": "Artikel reserviert",
  "product.released": "Reservierung aufgehoben",
  "product.sold": "Artikel verkauft",
  "product.location_changed": "Lagerort geändert",
  "product.photo_requested": "Foto angefordert",
  "inventory.adjusted": "Bestand korrigiert",
  "inventory.session_opened": "Inventur geöffnet",
  "inventory.session_closed_with_shrinkage": "Inventur mit Schwund abgeschlossen",
  "inventory.reservation_auto_released": "Reservierung automatisch aufgehoben",
  "product.inventory_adjustment_logged": "Bestandskorrektur erfasst",
  // Kunden
  "customer.created": "Kunde angelegt",
  "customer.updated": "Kunde geändert",
  "customer.kyc_verified": "KYC geprüft",
  "customer.kyc_document_added": "KYC-Nachweis hinzugefügt",
  "customer.kyc_document_viewed": "KYC-Nachweis eingesehen",
  "customer.trust_changed": "Vertrauensstufe geändert",
  "customer.price_notes_changed": "Preisnotizen geändert",
  "customer.sanctions_checked": "Sanktionsprüfung",
  "customer.smurfing_flagged": "Smurfing-Verdacht markiert",
  "customer.kyc_purged": "KYC-Daten gelöscht",
  // Fiskal
  "daily_closing.finalized": "Tagesabschluss gebucht",
  "shift.opened": "Schicht geöffnet",
  "shift.closed_with_variance": "Schicht mit Differenz geschlossen",
  "cash.movement_recorded": "Kassenbewegung erfasst",
  "metal_price.set": "Metallpreis gesetzt",
  "metal_price.recorded": "Metallpreis erfasst",
  "metal_price.manual_override": "Metallpreis manuell überschrieben",
  "metal_price.overridden": "Metallpreis überschrieben",
  "belegtext.published": "Belegtext veröffentlicht",
  "belegtext.updated": "Belegtext geändert",
  // Sicherheit / Compliance
  "alert.suspicious_aml_flagged": "Geldwäsche-Verdacht",
  "alert.smurfing_detected": "Smurfing erkannt",
  "alert.duress": "Duress-Alarm",
  "alert.worker_job_dead_letter": "Hintergrund-Job fehlgeschlagen",
  "alert.hash_chain_verification_failed": "Signaturkette gestört",
  "alert.anomaly_detected": "Anomalie erkannt",
  "alert.ebay_sale_conflict": "eBay-Verkaufskonflikt",
  "alert.ebay_double_sale_attempt": "eBay-Doppelverkauf",
  "alert.customer_marked_suspicious": "Kunde als verdächtig markiert",
  "alert.customer_banned": "Kunde gesperrt",
  "alert.tse_cert_expiry": "TSE-Zertifikat läuft ab",
  "alert.tse_critical_failure": "TSE-Störung",
  "security.duress_login_alert": "Duress-Anmeldung",
  "security.kyc_image_missing": "KYC-Bild fehlt",
  "security.kyc_image_sha_mismatch": "KYC-Bild-Prüfsumme abweichend",
  "security.kyc_image_tamper": "KYC-Bild manipuliert",
  "auth.pin_failed": "PIN falsch eingegeben",
  "auth.pin_locked": "PIN-Anmeldung gesperrt",
  "auth.step_up_failed": "Bestätigung fehlgeschlagen",
  "auth.step_up_success": "Bestätigung erfolgreich",
  // Freigaben
  "command.approval_requested": "Freigabe angefragt",
  "command.approval_resolved": "Freigabe entschieden",
  "command.dispatched": "Befehl ausgeführt",
  // Termine
  "appointment.scheduled": "Termin gebucht",
  "appointment.booked": "Termin gebucht",
  "appointment.confirmed": "Termin bestätigt",
  "appointment.checked_in": "Gast eingecheckt",
  "appointment.rescheduled": "Termin verschoben",
  "appointment.cancelled": "Termin abgesagt",
  "appointment.no_show_grace_minutes": "Karenzzeit für Nichterscheinen geändert",
  // System
  "auth.pin_login": "PIN-Anmeldung",
  "auth.sign_out": "Abmeldung",
  "user.login": "Anmeldung",
  "pin.set": "PIN gesetzt",
  "pin.set_duress": "Duress-PIN gesetzt",
  "system_setting.changed": "Einstellung geändert",
  "system_setting.updated": "Einstellung geändert",
  "task.completed": "Aufgabe erledigt",
  "photo.upload_url_requested": "Foto-Upload vorbereitet",
  "photo.uploaded_via_api": "Foto hochgeladen",
  "document.uploaded": "Beleg hochgeladen",
  "document.archived": "Beleg archiviert",
  "fixed_cost.created": "Fixkosten angelegt",
  "fixed_cost.updated": "Fixkosten geändert",
  "operating_expense.created": "Ausgabe gebucht",
  "operating_expense.updated": "Ausgabe geändert",
}

/**
 * Aus einem unbekannten `action`-Teil (z. B. „some_new_thing") ein lesbares
 * deutsches-naheres Label ableiten: snake_case → Wörter, Anfangsbuchstabe groß.
 * Das ist KEINE Übersetzung — es ist die ehrliche, lesbare Form des echten
 * Maschinen-Strings, damit nie ein roher `snake_case` in der UI steht.
 */
function humanizeAction(action: string): string {
  if (!action) return "Ereignis"
  const words = action.replace(/_/g, " ").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Die deutsche Überschrift eines Ereignisses — kuratiert oder ehrlich abgeleitet. */
export function eventLabel(eventType: string): string {
  const known = EVENT_LABELS[eventType]
  if (known) return known
  return humanizeAction(eventAction(eventType) || eventType)
}

/** Ob für diesen Ereignistyp ein kuratiertes Label existiert (vs. abgeleitet). */
export function hasCuratedLabel(eventType: string): boolean {
  return eventType in EVENT_LABELS
}

// ── Entitäts-Tabelle → deutsches Label ───────────────────────────────────────
// `entityTable` ist der DB-Tabellenname, an dem das Ereignis hängt. Wir
// übersetzen die bekannten in ein ruhiges deutsches Wort; ein unbekannter Name
// wird humanisiert (nie roh angezeigt).

const ENTITY_LABELS: Readonly<Record<string, string>> = {
  transactions: "Vorgang",
  products: "Artikel",
  customers: "Kunde",
  users: "Benutzer",
  devices: "Gerät",
  daily_closings: "Tagesabschluss",
  shifts: "Schicht",
  appointments: "Termin",
  metal_prices: "Metallpreis",
  belegtext_templates: "Belegtext",
  documents: "Beleg",
  internal_tasks: "Aufgabe",
  appraisals: "Bewertung",
  fixed_costs: "Fixkosten",
  operating_expenses: "Ausgabe",
  photos: "Foto",
  system_settings: "Einstellung",
  cash_movements: "Kassenbewegung",
}

export function entityLabel(entityTable: string): string {
  const known = ENTITY_LABELS[entityTable]
  if (known) return known
  // Tabellennamen sind plural-snake; humanisieren statt roh zeigen.
  const words = entityTable.replace(/_/g, " ").trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Eintrag"
}

// ── Kurz-IDs + Hash (ehrlich verkürzt, nie als klickbarer Link) ──────────────
// `entityId`/`actorUserId`/`deviceId` sind UUIDs, `rowHashHex` ist der hex-SHA-256
// der Zeile. Wir zeigen sie monospaced und verkürzt als Forensik-Korrelat — der
// volle Wert steht in der Detailansicht, aber nie wird ein „Öffnen" vorgetäuscht.

export function shortId(id: string | null): string | null {
  if (!id) return null
  const s = id.trim()
  if (s.length <= 10) return s || null
  return s.slice(0, 8)
}

export function shortHash(hex: string | null): string | null {
  if (!hex) return null
  const h = hex.trim().toLowerCase()
  if (h.length < 12) return h || null
  return `${h.slice(0, 8)}…${h.slice(-4)}`
}

// ── Akteur (wer) ─────────────────────────────────────────────────────────────
// Das Protokoll trägt `actorUserId` (UUID), nicht den Namen. Manche Payloads
// tragen einen Klarnamen (cashier_name o. ä.) — den nehmen wir, sonst die
// verkürzte ID, sonst ehrlich „System" (kein Akteur = trigger-/server-erzeugt).

export interface ActorInfo {
  /** Anzeigeform: Klarname, „Gerät", verkürzte ID oder „System". */
  label: string
  /** Ob ein menschlicher Akteur (actorUserId gesetzt) dahintersteht. */
  isHuman: boolean
}

export function actorInfo(
  actorUserId: string | null,
  payload: unknown,
): ActorInfo {
  const name = payloadString(payload, "cashier_name", "cashierName", "actor_name", "actorName")
  if (name) return { label: name, isHuman: true }
  if (actorUserId) {
    const short = shortId(actorUserId)
    return { label: short ? `Benutzer ${short}` : "Benutzer", isHuman: true }
  }
  return { label: "System", isHuman: false }
}

// ── Payload-Leser (defensiv — die Payload ist owner-vertraut, aber lose) ──────

function asRecord(v: unknown): Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

/** Ein nicht-leeres String-Feld aus der Payload, oder null. */
export function payloadString(payload: unknown, ...keys: string[]): string | null {
  const p = asRecord(payload)
  for (const k of keys) {
    const v = p[k]
    if (typeof v === "string" && v.trim().length > 0) return v.trim()
  }
  return null
}

/**
 * Die Payload als geordnete Liste lesbarer Schlüssel/Wert-Paare für die
 * Detailansicht. Schlüssel werden humanisiert, Werte ehrlich formatiert
 * (Strings/Zahlen/Booleans direkt; Objekte/Arrays als kompaktes JSON). Nichts
 * wird erfunden — eine leere Payload ergibt eine leere Liste.
 */
export interface PayloadEntry {
  key: string
  /** Humanisierter Schlüssel (z. B. „price per gram eur"). */
  label: string
  /** Ehrlich formatierter Wert. */
  value: string
  /** Ob der Wert eine ID/Hash-artige Zeichenkette ist (→ monospaced anzeigen). */
  mono: boolean
}

// ── Schlüssel-Normalisierung (camelCase → snake_case, EINE Quelle der Wahrheit) ─
// Der Backend-Payload mischt zwei Schreibweisen: die meisten Trigger schreiben
// snake_case (`total_eur`, `trust_level`), aber viele Routen schreiben camelCase
// (`customerId`, `fromTrustLevel`, `oldValue`, `kycDocumentId`, `lockedUntil`,
// `changedFields` …). Statt jeden camelCase-Schlüssel einzeln zu aliasen,
// kanonisieren wir JEDEN Schlüssel einmal nach snake_case, BEVOR irgendeine
// Registry (Label oder Enum-Wert) befragt wird. So ist die snake_case-Tabelle die
// einzige Quelle der Wahrheit und ein neuer camelCase-Schlüssel kann nie wieder
// roh-englisch durchrutschen.
export function toSnakeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2") // userId → user_Id
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2") // ISO2Code → ISO2_Code
    .toLowerCase()
}

/**
 * Dev-only Warnung, wenn ein Payload-Schlüssel oder Enum-Wert ohne kuratiertes
 * deutsches Label durch die Fallback-Humanisierung läuft. In Produktion ein
 * No-op (die Humanisierung greift weiterhin, nie ein roher Maschinen-String) —
 * aber im Dev-Build wird die Lücke laut, damit fehlende Übersetzungen gefunden
 * und ergänzt werden, statt still anglisiert zu rendern.
 */
function warnUntranslated(kind: "Schlüssel" | "Wert", raw: string, key?: string): void {
  if (isDevBuild()) {
    const where = key ? ` (Feld ${key}")` : ""
    console.warn(
      `[audit-ui] Kein kuratiertes deutsches Label für ${kind} ${raw}"${where} ` +
        `Fallback-Humanisierung greift. Bitte in audit-ui.ts ergänzen.`,
    )
  }
}

// ID-/Hash-artige Schlüssel (forensisch: roher Wert, monospaced). Deckt
// snake_case (`_id`), camelCase (`customerId`, `kycDocumentId`) und die
// Krypto-Begriffe ab. Wir normalisieren zuerst nach snake_case, damit eine
// einzige `_id$`-Regel beide Schreibweisen erfasst.
const ID_KEY_RE = /(_id$|^id$|hash|sha|fingerprint|serial|uuid)/i
function isIdKey(key: string): boolean {
  return ID_KEY_RE.test(toSnakeKey(key))
}

// ── Payload-Schlüssel → deutsches Label ──────────────────────────────────────
// Die Payload-Schlüssel sind englische Maschinennamen. Jeder Schlüssel wird VOR
// dem Nachschlagen per `toSnakeKey` kanonisiert, darum ist diese Tabelle rein
// snake_case — ein camelCase-Backend-Schlüssel (`customerId`, `fromTrustLevel`,
// `oldValue` …) trifft denselben Eintrag wie sein snake_case-Zwilling. Ein
// unbekannter Schlüssel wird humanisiert (Unterstriche raus, erster Buchstabe
// groß) — nie roh als `snake_case`/`camelCase` oder als blanker englischer
// Begriff stehengelassen.
const PAYLOAD_KEY_LABELS: Readonly<Record<string, string>> = {
  // Handel / Vorgang
  direction: "Richtung",
  total_eur: "Gesamt",
  subtotal_eur: "Zwischensumme",
  vat_eur: "Umsatzsteuer",
  storno_of: "Storno von",
  receipt_locator: "Beleg-Nummer",
  finalized_at: "Abgeschlossen am",
  tax_treatment_code: "Besteuerungsart",
  payment_method: "Zahlart",
  payout_method: "Auszahlung",
  // Lager / Artikel
  sku: "Artikelnummer",
  channel: "Kanal",
  delta: "Veränderung",
  reason: "Grund",
  location: "Lagerort",
  status: "Status",
  previous_status: "Vorheriger Status",
  // Kunden / KYC
  trust_level: "Vertrauensstufe",
  kyc_status: "KYC-Status",
  verified_by: "Geprüft von",
  // Termine
  appointment_type: "Terminart",
  starts_at: "Beginn",
  duration_minutes: "Dauer (Minuten)",
  booked_via: "Gebucht über",
  staff_user_id: "Mitarbeiter",
  customer_id: "Kunde",
  product_id: "Artikel",
  // Fiskal / Metall
  metal: "Metall",
  source: "Quelle",
  price_per_gram_eur: "Preis je Gramm",
  kind: "Art",
  // Fiskal / Tagesabschluss (daily_closing.finalized)
  state: "Status",
  business_day: "Geschäftstag",
  gross_verkauf_eur: "Verkauf brutto",
  net_verkauf_eur: "Verkauf netto",
  gross_ankauf_eur: "Ankauf brutto",
  net_ankauf_eur: "Ankauf netto",
  verkauf_count: "Anzahl Verkäufe",
  ankauf_count: "Anzahl Ankäufe",
  storno_count: "Anzahl Stornos",
  cash_drawer_variance_eur: "Kassendifferenz",
  tse_finished_count: "TSE abgeschlossen",
  tse_pending_count: "TSE ausstehend",
  tse_failed_count: "TSE fehlgeschlagen",
  ledger_anchor_id: "Journal-Anker",
  // Sicherheit / Kunde (alert.customer_* · customer.trust_changed)
  // camelCase im Payload (`customerId`, `fromTrustLevel` …) — als snake_case
  // gelistet, weil `toSnakeKey` vor dem Nachschlagen kanonisiert.
  from_trust_level: "Vorherige Vertrauensstufe",
  to_trust_level: "Neue Vertrauensstufe",
  reason_length: "Begründungslänge",
  changed_fields: "Geänderte Felder",
  step_up_enforced: "Bestätigung erzwungen",
  // Sicherheit / Auth (auth.pin_* / step_up_*)
  decision: "Ergebnis",
  failed_attempts: "Fehlversuche",
  locked_until: "Gesperrt bis",
  is_owner: "Inhaberkonto",
  session_id: "Sitzung",
  // Bestandskorrektur (product.inventory_adjustment_logged · product.relocate)
  previous_location: "Vorheriger Lagerort",
  next_location: "Neuer Lagerort",
  via: "Vorgang",
  // KYC-Nachweis (customer.kyc_* · security.kyc_*)
  kyc_document_id: "KYC-Nachweis",
  document_type: "Nachweisart",
  issuing_country_iso2: "Ausstellungsland",
  issued_on: "Ausgestellt am",
  expires_on: "Gültig bis",
  retention_years: "Aufbewahrung (Jahre)",
  // Beleg (document.uploaded / .archived)
  document_id: "Beleg",
  category: "Kategorie",
  file_name: "Dateiname",
  mime_type: "Dateityp",
  size_bytes: "Größe (Byte)",
  // Einstellung (system_setting.changed)
  key: "Schlüssel",
  old_value: "Vorher",
  new_value: "Nachher",
  // Freigabe (command.approval_resolved)
  resolved_by_user_id: "Entschieden von",
  resolved_at: "Entschieden am",
  // Storno (transaction.stornoed*)
  original_transaction_id: "Ursprünglicher Vorgang",
  original_total_eur: "Ursprungsbetrag",
  storno_total_eur: "Stornobetrag",
  // Metallpreis (metal_price.*)
  new_price_per_gram_eur: "Neuer Preis je Gramm",
  previous_price_per_gram_eur: "Vorheriger Preis je Gramm",
  // System / Auth
  device_class: "Geräteklasse",
  success: "Erfolgreich",
  title: "Titel",
  notes: "Notiz",
  route: "Route",
}

// ── Bekannte Enum-Werte → deutsches Label, je nach Schlüssel ─────────────────
// Ein roher String-Wert kann ein SCREAMING_SNAKE-Enum sein (`ANKAUF`,
// `SCHEDULED`, `MARGIN_25A`) oder ein kleingeschriebenes Code-Wort (`pos`,
// `storefront`, `manual`). Der Schlüssel bestimmt die passende Registry, damit
// z. B. `status` bei einem Termin als „Geplant" und nie als „SCHEDULED" liest.
// Greift keine Registry, fängt `humanizeToken` den Wert ab — es bleibt nie ein
// SCREAMING_SNAKE oder ein englisches Code-Wort in der UI stehen.

/**
 * PIN-/Step-up-Entscheidung (`decision`-Payload) → deutsches Wort. Eigene
 * Registry, damit „success"/„failed" nur HIER greifen und nicht versehentlich
 * gleichlautende freie Textwerte anderer Felder übersetzen.
 */
const AUTH_DECISION_LABEL: Readonly<Record<string, string>> = {
  success: "Erfolgreich",
  failed: "Fehlgeschlagen",
  failed_now_locked: "Fehlgeschlagen, jetzt gesperrt",
  already_locked: "Bereits gesperrt",
}

// Schlüssel-spezifische Enum-Registrys (aus dem geteilten german-text-Vokabular).
// Die Schlüssel sind snake_case — der Lookup kanonisiert vorher per `toSnakeKey`,
// also greifen camelCase-Felder (`fromTrustLevel`, `toTrustLevel`) automatisch
// auf den `from_trust_level`/`to_trust_level`-Eintrag.
const KEY_VALUE_REGISTRY: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  direction: TRANSACTION_DIRECTION_LABEL,
  tax_treatment_code: TAX_TREATMENT_LABEL,
  kind: TAX_TREATMENT_LABEL,
  payment_method: PAYMENT_METHOD_LABEL,
  payout_method: PAYMENT_METHOD_LABEL,
  trust_level: CUSTOMER_TRUST_LEVEL_LABEL,
  from_trust_level: CUSTOMER_TRUST_LEVEL_LABEL,
  to_trust_level: CUSTOMER_TRUST_LEVEL_LABEL,
  kyc_status: CUSTOMER_KYC_STATUS_LABEL,
  appointment_type: APPOINTMENT_TYPE_LABEL,
  status: APPOINTMENT_STATUS_LABEL,
  previous_status: APPOINTMENT_STATUS_LABEL,
  condition: ANKAUF_CONDITION_LABEL,
  product_status: PRODUCT_STATUS_LABEL,
  task_status: TASK_STATUS_LABEL,
  // Beleg-Kategorie (document.uploaded `category`): AUSWEIS|RECHNUNG|… → „Ausweis"
  // /„Rechnung", nie das rohe Enum.
  category: DOCUMENT_CATEGORY_LABELS,
  // Der Tagesabschluss-`state` ist COUNTING | FINALIZED — als „Offen"/
  // „Abgeschlossen" lesen, nie als rohes „FINALIZED".
  state: CLOSING_STATE_LABELS,
  decision: AUTH_DECISION_LABEL,
}

/** Audit-spezifische Tokens, die das geteilte Vokabular nicht abdeckt. */
const AUDIT_VALUE_LABELS: Readonly<Record<string, string>> = {
  POS_TERMINAL: "Kassen-Terminal",
  MOBILE: "Mobil",
  WEB: "Web",
  MANUAL: "Manuell",
  AUTOMATIC: "Automatisch",
  SYSTEM: "System",
  pos: "Kasse",
  storefront: "Ladengeschäft",
  online: "Online",
  manual: "Manuell",
  gold: "Gold",
  silver: "Silber",
  platinum: "Platin",
  palladium: "Palladium",
  // `reason`/`decision`-Codewörter aus den Sicherheits- und Hintergrund-
  // Ereignissen (PIN, Reservierung, KYC-Löschung) — sonst läsen sie als
  // englische Maschinenwörter („Already locked", „Retention expired").
  already_locked: "Bereits gesperrt",
  failed_now_locked: "Jetzt gesperrt",
  retention_expired: "Aufbewahrungsfrist abgelaufen",
  reservation_expires_at_lapsed: "Reservierung abgelaufen",
  pos_stale_hold_reclaimed: "Kassen-Reservierung zurückgeholt",
  reservation_expires_at_passed: "Reservierung abgelaufen",
  // Freigabe-Entscheidung (command.approval_resolved `status`) — sonst „Approved"
  // /„Rejected". Eigener Schlüssel kollidiert mit dem Termin-`status`, darum hier
  // im globalen Fallback (greift erst NACH der Termin-Registry, kein Konflikt).
  APPROVED: "Freigegeben",
  REJECTED: "Abgelehnt",
  PENDING: "Ausstehend",
  // Bestandskorrektur-/Umlagerungs-Grund (`reason`: inventory-adjustment ·
  // product.relocate) — sonst „Location change", „Operator note".
  LOCATION_CHANGE: "Lagerort geändert",
  LOST: "Verlust",
  DAMAGED: "Beschädigt",
  FOUND: "Wiedergefunden",
  OPERATOR_NOTE: "Notiz",
}

/**
 * Einen rohen, code-artigen String-Wert lesbar machen, ohne je einen rohen Token
 * (SCREAMING_SNAKE / snake_case) durchzulassen: Unterstriche zu Leerzeichen,
 * dann nur den ersten Buchstaben groß und den Rest klein — so wird aus
 * `POS_TERMINAL` „Pos terminal" statt eines lauten Maschinen-Strings.
 */
function humanizeToken(value: string): string {
  const words = value.replace(/_/g, " ").trim().toLowerCase()
  if (!words) return value
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Ob ein String-Wert wie ein Enum-/Code-Token aussieht (kein freier Klartext). */
function looksLikeToken(value: string): boolean {
  // Reines SCREAMING_SNAKE / snake_case / lowercase-Code, ohne Leerzeichen.
  return /^[A-Za-z][A-Za-z0-9]*(_[A-Za-z0-9]+)*$/.test(value) && /[_A-Z]/.test(value)
}

/**
 * Ein `*_eur`-Payload-Feld trägt einen rohen Geld-Dezimalstring („50.00") mit
 * Punkt-Trenner und ohne Währung. Wir formatieren ihn ehrlich nach de-DE mit €,
 * damit nie „50.00" statt „50,00 €" in der UI steht. Kein gültiger Betrag →
 * null (der Rohwert läuft dann durch die normale Reinigung).
 */
function formatEurString(value: string): string | null {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

/**
 * Einen rohen String-Payload-Wert in ein sauberes deutsches Label übersetzen.
 * Erst Geld-Felder (de-DE €), dann die schlüssel-spezifische Registry, dann das
 * Audit-Vokabular, dann (nur für offensichtliche Code-Tokens) der Humanizer.
 * Freier Klartext (Namen, Gründe, IDs) bleibt unverändert — er ist
 * owner-vertraut, kein Enum.
 */
function purifyStringValue(key: string, value: string): string {
  // Einmal nach snake_case kanonisieren: jede schlüssel-abhängige Regel (Geld,
  // Datum, Enum-Registry) greift dann gleichermaßen für snake_case- UND
  // camelCase-Felder.
  const snake = toSnakeKey(key)
  if (snake.endsWith("_eur")) {
    const money = formatEurString(value)
    if (money != null) return money
  }
  // Ein Zeitstempel-Feld (`*_at`/`*_until`, camelCase wie `lockedUntil` →
  // `locked_until`) trägt einen rohen ISO-Zeitstempel — als volle de-DE
  // Datum+Uhrzeit zeigen, damit nie ein „2026-…T…Z" in der UI steht.
  if (/(_at|_until)$/.test(snake) && value.includes("T")) {
    const date = formatEventDate(value)
    if (date != null) return date
  }
  // Ein Geschäftstag-/Datums-Feld (`business_day`, `*_day`, `*_date`) trägt ein
  // reines ISO-Datum (YYYY-MM-DD) — als de-DE Datum zeigen, nie roh als
  // „2026-06-21".
  if (snake === "business_day" || snake.endsWith("_day") || snake.endsWith("_date")) {
    const day = formatEventDay(value)
    if (day != null) return day
  }
  const registry = KEY_VALUE_REGISTRY[snake]
  if (registry) {
    const hit = registry[value]
    if (hit !== undefined) return hit
  }
  const auditHit = AUDIT_VALUE_LABELS[value]
  if (auditHit !== undefined) return auditHit
  // Ein code-artiger Token ohne bekannte Übersetzung: humanisieren, damit nie
  // ein SCREAMING_SNAKE / snake_case in der UI steht. Im Dev-Build laut warnen,
  // damit die fehlende Übersetzung gefunden wird. Klartext (Namen, Gründe in
  // freier Sprache) bleibt unberührt.
  if (looksLikeToken(value)) {
    warnUntranslated("Wert", value, key)
    return humanizeToken(value)
  }
  return value
}

function humanizeKey(key: string): string {
  // Erst nach snake_case kanonisieren — so trifft `customerId` denselben Eintrag
  // wie `customer_id` und es muss kein camelCase-Alias gepflegt werden.
  const snake = toSnakeKey(key)
  const known = PAYLOAD_KEY_LABELS[snake]
  if (known) return known
  // Kein kuratiertes Label: snake_case → Wörter, erster Buchstabe groß. Damit
  // steht nie ein roher `snake_case`/`camelCase`-Maschinenname in der UI; im
  // Dev-Build wird die Lücke laut, damit ein deutsches Label ergänzt wird.
  const words = snake.replace(/_/g, " ").trim()
  if (!words) return key
  warnUntranslated("Schlüssel", key)
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function formatScalar(key: string, v: unknown): { value: string; mono: boolean } {
  if (v === null) return { value: "—", mono: false }
  if (typeof v === "boolean") return { value: v ? "Ja" : "Nein", mono: false }
  if (typeof v === "number") {
    return { value: Number.isFinite(v) ? v.toLocaleString("de-DE") : String(v), mono: true }
  }
  if (typeof v === "string") {
    // IDs/Hashes/Seriennummern bleiben roh + monospaced (Forensik); jeder andere
    // String wird gegen das deutsche Enum-Vokabular gereinigt, nie roh gezeigt.
    if (isIdKey(key)) return { value: v, mono: true }
    const clean = purifyStringValue(key, v)
    return { value: clean, mono: clean.length > 16 && !clean.includes(" ") }
  }
  // Objekt/Array — kompaktes JSON, ehrlich als Rohwert markiert (monospaced).
  try {
    return { value: JSON.stringify(v), mono: true }
  } catch {
    return { value: String(v), mono: true }
  }
}

export function payloadEntries(payload: unknown): PayloadEntry[] {
  const p = asRecord(payload)
  const out: PayloadEntry[] = []
  for (const key of Object.keys(p)) {
    const { value, mono } = formatScalar(key, p[key])
    out.push({ key, label: humanizeKey(key), value, mono: mono || isIdKey(key) })
  }
  return out
}

/** Ob die Payload überhaupt anzeigbare Felder trägt. */
export function hasPayload(payload: unknown): boolean {
  return Object.keys(asRecord(payload)).length > 0
}

// ── Datum / Zeit (ISO → de-DE, ehrlich null bei ungültig) ────────────────────

/** ISO-Zeitstempel als volle de-DE Datum+Uhrzeit, oder null wenn ungültig. */
export function formatEventDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

/**
 * Ein reines ISO-Datum (YYYY-MM-DD, z. B. ein Geschäftstag) als de-DE Datum
 * ohne Uhrzeit, oder null wenn ungültig. Wir lesen die Bestandteile direkt aus
 * dem String (keine Date-Zeitzonen-Verschiebung), damit der Geschäftstag exakt
 * bleibt.
 */
export function formatEventDay(iso: string | null): string | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return null
  const [, y, mo, d] = m
  const dt = new Date(Number(y), Number(mo) - 1, Number(d))
  if (Number.isNaN(dt.getTime())) return null
  return dt.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })
}

/** Nur die Uhrzeit (HH:MM) eines ISO-Zeitstempels, oder null. */
export function formatEventTime(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
}

/**
 * Ein „YYYY-MM-DD"-Tagesschlüssel (lokale Zeit) für die Gruppierung der Liste
 * nach Tag. Ungültige Zeitstempel ergeben null (sie landen unter „Unbekannt").
 */
export function dayKey(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * Eine ruhige deutsche Tages-Überschrift für eine Gruppe: „Heute" / „Gestern"
 * für die jüngsten zwei Tage, sonst das de-DE-Datum mit Wochentag.
 */
export function dayHeading(key: string, now: number = Date.now()): string {
  if (key === "unknown") return "Unbekanntes Datum"
  const d = new Date(`${key}T00:00:00`)
  if (Number.isNaN(d.getTime())) return key
  const today = dayKey(new Date(now).toISOString())
  const yesterday = dayKey(new Date(now - 86_400_000).toISOString())
  if (key === today) return "Heute"
  if (key === yesterday) return "Gestern"
  return d.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

/**
 * Eine kompakte deutsche „vor … "-Relativzeit für die Zeile, mit absolutem
 * de-DE-Datum als Fallback ab einem Tag. „gerade eben" in der ersten Minute.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ""
  const diffMs = Math.max(0, now - then)
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return "gerade eben"
  if (min < 60) return `vor ${min} min`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `vor ${hours} Std.`
  const days = Math.floor(hours / 24)
  if (days < 7) return `vor ${days} ${days === 1 ? "Tag" : "Tagen"}`
  return new Date(then).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

// ── Gruppierung nach Tag (neueste zuerst) ────────────────────────────────────
// Die Liste kommt vom Server schon id-absteigend (neueste zuerst). Wir gruppieren
// stabil nach Kalendertag, ohne die Reihenfolge innerhalb des Tages zu ändern.

export interface DayGroup<T> {
  /** „YYYY-MM-DD" oder „unknown". */
  key: string
  heading: string
  items: T[]
}

export function groupByDay<T>(
  items: ReadonlyArray<T>,
  getIso: (item: T) => string,
  now: number = Date.now(),
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = []
  const index = new Map<string, DayGroup<T>>()
  for (const item of items) {
    const key = dayKey(getIso(item)) ?? "unknown"
    let g = index.get(key)
    if (!g) {
      g = { key, heading: dayHeading(key, now), items: [] }
      index.set(key, g)
      groups.push(g)
    }
    g.items.push(item)
  }
  return groups
}

// ── Datums-Bereichs-Filter (echte Zeitfenster, ehrlich serverseitig) ─────────
// Die Bereichs-Chips übersetzen in das `fromBusinessDay`/`toBusinessDay`-Paar des
// Endpunkts (created_at >= from, < to+1Tag). Wir rechnen die Grenzen lokal, damit
// der „Heute"-Chip wirklich heute meint, und geben „YYYY-MM-DD"-Strings zurück.

export type DateRange = "all" | "today" | "7d" | "30d"

export const DATE_RANGE_ORDER: readonly DateRange[] = ["all", "today", "7d", "30d"] as const

export const DATE_RANGE_LABELS: Readonly<Record<DateRange, string>> = {
  all: "Alle",
  today: "Heute",
  "7d": "7 Tage",
  "30d": "30 Tage",
}

function isoDay(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * Das `{ fromBusinessDay, toBusinessDay }`-Paar für einen Bereichs-Chip, relativ
 * zu `now`. „all" gibt ein leeres Objekt (kein Filter). Beide Grenzen sind
 * inklusive Tagesgrenzen, die der Server in created_at-Bereiche übersetzt.
 */
export function dateRangeQuery(
  range: DateRange,
  now: number = Date.now(),
): { fromBusinessDay?: string; toBusinessDay?: string } {
  if (range === "all") return {}
  const today = new Date(now)
  const to = isoDay(today)
  if (range === "today") return { fromBusinessDay: to, toBusinessDay: to }
  const days = range === "7d" ? 6 : 29 // inklusive heute → 7 bzw. 30 Tage
  const from = new Date(now - days * 86_400_000)
  return { fromBusinessDay: isoDay(from), toBusinessDay: to }
}

// ── Zählung (echte Summen aus echten Zeilen) ─────────────────────────────────
// Anzahl je Kategorie aus der geladenen Seite — füttert die Zähler an den
// Filter-Chips. Reine Reduktion; keine erfundene „0 als Erfolg".

export function countByCategory<T extends { eventType: string }>(
  items: ReadonlyArray<T>,
): Readonly<Record<EventCategory, number>> {
  const counts: Record<EventCategory, number> = {
    sales: 0,
    inventory: 0,
    customers: 0,
    fiscal: 0,
    security: 0,
    approvals: 0,
    appointments: 0,
    system: 0,
    other: 0,
  }
  for (const item of items) counts[eventCategory(item.eventType)] += 1
  return counts
}

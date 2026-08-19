/**
 * The German text spine — the purification core every owner surface speaks
 * through. ONE place that turns the backend's developer vocabulary into clean,
 * human, idiomatic German.
 *
 * Two responsibilities:
 *   1. `describeError(err)` — maps EVERY `ApiErrorCode` the api-cloud can return
 *      (plus the raw CONFLICT constraint tokens its DB triggers raise, and the
 *      ajv 400 field paths) to one actionable German sentence. The English wire
 *      text — an ajv keyword, a Postgres RAISE message, a provider rejection —
 *      is NEVER surfaced to the operator.
 *   2. The enum/status LABEL REGISTRY — every status / type / kind / category /
 *      trust level / priority / tax treatment / metal / role / payment method /
 *      direction the backend uses as a SCREAMING_SNAKE or lower_snake token,
 *      mapped to its German display string. Each registry is typed as
 *      `Record<TheEnum, string>`, so the TypeScript compiler refuses to build if
 *      a backend enum gains a member we forgot to translate.
 *
 * HONESTY RULE (absolute): a label is a faithful translation of a known enum,
 * never an invented status. When `describeError` cannot recognise a conflict it
 * stays neutral and actionable rather than guessing a cause it can't prove.
 *
 * Why a Record and not a function with a default: an exhaustive `Record` is a
 * compile-time guard. A `switch` with a `default` would silently leak the raw
 * token the day the backend adds an enum member. The registry has no escape
 * hatch — every member must be present.
 */
import {
  ApiError,
  ApiNetworkError,
  type ApiErrorCode,
  type ActorRole,
  type AnkaufCondition,
  type AnkaufItemType,
  type AnkaufMetal,
  type AnkaufPayoutMethod,
  type AppointmentPatchStatus,
  type AppointmentStatus,
  type AppointmentType,
  type BelegtextKind,
  type ClosingListItem,
  type CustomerKycStatus,
  type CustomerLanguage,
  type CustomerTrustLevel,
  type DocumentCategory,
  type PaymentMethod,
  type ProductStatus,
  type TaskPriority,
  type TaskStatus,
  type TaxTreatmentCode,
  type TransactionDirection,
} from "@norns/api-client"

// ════════════════════════════════════════════════════════════════════════════
// 1 · FEHLERTEXTE — describeError()
// ════════════════════════════════════════════════════════════════════════════

/** One ajv error entry as Fastify forwards it in a 400's `details` array. We
 *  only read the field path; the English keyword/message stays hidden. */
interface AjvErrorDetail {
  instancePath?: string
  /** Welche Regel gerissen ist: "pattern", "minLength", "maximum", … */
  keyword?: string
  /** Die Regel selbst. Bei "pattern" steht hier das Muster. */
  params?: { pattern?: string; limit?: number }
}

/**
 * German labels for the body fields the server can reject, keyed by the
 * top-level JSON path ajv reports in `instancePath` (e.g. "/dateOfBirth").
 * Spans every surface's forms — field names are unique across domains, so a
 * bad-format 400 (e.g. a due date the server reads in the wrong format) names
 * the offending field in German instead of leaking the raw English ajv text.
 */
const VALIDATION_FIELD_LABELS: Readonly<Record<string, string>> = {
  // Kunden
  fullName: "Name",
  dateOfBirth: "Geburtsdatum",
  email: "E-Mail-Adresse",
  phone: "Telefonnummer",
  address: "Adresse",
  vatId: "USt-IdNr.",
  notes: "Notiz",
  // Aufgaben
  title: "Titel",
  description: "Beschreibung",
  dueDate: "Fälligkeitsdatum",
  cancellationReason: "Abbruchgrund",
  // Verkauf / Ankauf — Geldwege
  totalEur: "Gesamtbetrag",
  negotiatedPriceEur: "Auszahlungsbetrag",
  listPriceEur: "Verkaufspreis",
  weightGrams: "Gewicht",
  payoutExternalRef: "Überweisungsreferenz",
  customerId: "Kunde",
}

/**
 * The stable Postgres-message → German-line table for CONFLICT (409) responses.
 *
 * A 409 carries the raw English `message` verbatim — a DB trigger's RAISE text,
 * a domain error, or a Postgres constraint name — which must NEVER reach the
 * operator. We match the stable token (the same tokens api-cloud's
 * `error-handler.ts` keys on) to an actionable German line. Order is
 * most-specific first; the first hit wins. Entries whose German line needs a
 * count pulled from the English message live in `describeConflict` below.
 *
 * WARUM EXPORTIERT (04.08.2026): hier stand `const` ohne `export`, und der
 * einzige Weg, die Tabelle zu prüfen, führte über `describeError`. Damit liess
 * sich zwar prüfen, ob eine Meldung ANKOMMT, aber nicht, ob ein Eintrag
 * überhaupt je erreichbar ist. Zwei Fehler blieben so unsichtbar: ein
 * Erkennungsmerkmal, das im Serverquelltext gar nicht vorkommt (ein Geist, der
 * nie trifft), und ein Merkmal, das von einem früheren, breiteren vollständig
 * verdeckt wird (ein deutscher Satz, den niemand je liest). Der Wächter
 * `konflikt-merkmale.guard.test.ts` prüft beides und braucht dafür die ECHTE
 * Tabelle, keine abgeschriebene Kopie.
 */
export const CONFLICT_TOKENS: ReadonlyArray<{ token: string; line: string }> = [
  // 14.08.2026: zwölf Merkmale (eBay-Zustandsmaschine, Bestellungen,
  // Versand, Support-Antworten, DHL) fielen mit der Trennung von warehouse14.
  // Ihre Server-Saetze existieren nicht mehr; der Waechter unten hat jeden
  // einzelnen als Geist gemeldet.
  // ── Kunden (Blind-Index-Eindeutigkeit) ────────────────────────────────────
  {
    token: "customers_email_blind_index_active_uq",
    line: "Diese E-Mail-Adresse ist bereits einem Kunden zugeordnet.",
  },
  {
    token: "customers_phone_blind_index_active_uq",
    line: "Diese Telefonnummer ist bereits einem Kunden zugeordnet.",
  },
  // ── eBay-Listung (Zustandsmaschine) ──────────────────────────────────────────
  // ── Termine ────────────────────────────────────────────────────────────────
  {
    token: "Invalid appointment status transition",
    line: "Dieser Statuswechsel ist nicht möglich. Bitte die Termin-Ansicht aktualisieren.",
  },
  {
    token: "Selected slot is no longer available",
    line: "Dieser Termin-Slot ist nicht mehr frei. Bitte eine andere Zeit wählen.",
  },
  {
    token: "appointments_no_staff_overlap",
    line: "Zu dieser Zeit liegt bereits ein Termin. Bitte eine andere Zeit wählen.",
  },
  {
    // Day 8: a buy-in (Ankauf) was linked to an appointment that already has a
    // transaction — the partial UNIQUE refuses the second link.
    token: "appointments_one_transaction_link_uq",
    line: "Dieser Termin ist bereits mit einem Vorgang verknüpft.",
  },
  // ── Tagesabschluss / Z-Bon (Kassensturz-Reihenfolge) ───────────────────────
  {
    // closings-finalize raises four precise German 409s. They are the most
    // fiscally important conflicts in the app: each names the EXACT next step
    // (close the shift / do the Kassensturz first), so the generic
    // "aktualisieren und erneut versuchen" fallback would actively mislead the
    // owner. We key on a stable, collision-free substring of each message and
    // pass through its own actionable guidance. Order is most-specific first.
    //
    // 1) An OPEN shift exists for the target day — the day cannot be sealed until
    //    the till is closed. ("Für {day} ist noch eine Kasse geöffnet …")
    token: "noch eine Kasse geöffnet",
    line: "Für diesen Tag ist noch eine Kasse geöffnet. Bitte zuerst die Schicht abschließen (Kassensturz).",
  },
  {
    // 2) Sales exist for the day but no shift was counted/closed — the cash
    //    position is unknown. ("Für {day} liegen Belege vor, aber kein
    //    Kassensturz …") Match the distinctive "kein Kassensturz" phrase; the
    //    internal empty-day note string is never thrown, so there is no clash.
    token: "kein Kassensturz",
    line: "Für diesen Tag liegen Belege vor, aber kein Kassensturz. Bitte zuerst die Schicht abschließen.",
  },
  {
    // 3) The day is already sealed — a Z-Bon is immutable, so a second finalize
    //    is refused. ("Der Tagesabschluss für {day} besteht bereits.") "besteht
    //    bereits" is unique to this message.
    token: "besteht bereits",
    line: "Der Tagesabschluss für diesen Tag besteht bereits.",
  },
  {
    // 18.08.2026, Prueferpaket (§ 146b AO): der gewaehlte Zeitraum traegt
    // keinen einzigen festgeschriebenen Tagesabschluss. Der Satz nennt den
    // naechsten Schritt, statt neutral zu vertroesten. Merkmal: die Wortfolge
    // „kein festgeschriebener" kommt nur aus routes/pruefer-paket.ts.
    token: "kein festgeschriebener",
    line: "Im gewählten Zeitraum liegt kein festgeschriebener Tagesabschluss. Das Prüferpaket packt nur abgeschlossene Tage; bitte zuerst den Tagesabschluss ausführen oder den Zeitraum ändern.",
  },
  {
    // 18.08.2026, Fremdbeleg-Export: Altzeilen ohne Zahlweg sperren die Datei.
    // Merkmal: „traegt keinen Zahlweg" kommt nur aus routes/expenses.ts.
    token: "traegt keinen Zahlweg",
    line: "Mindestens eine Ausgabe im Zeitraum trägt keinen Zahlweg. Bitte unter Finanzen die Ausgabe bearbeiten und Bar, Bank oder Karte nachtragen; danach entsteht die Datei.",
  },
  {
    /*
     * 19.08.2026, Fund der boeswilligen Pruefung: ein Zeichen ausserhalb von
     * Windows-1252 (tuerkisches ş, polnisches ł, ein Emoji im
     * Lieferantennamen) kippte den ganzen DATEV-Export in ein nacktes 500.
     * Der Server nennt jetzt die FUNDSTELLE, und dieser Satz reicht sie
     * durch, statt sie hinter „unerwarteter Fehler" zu begraben.
     */
    token: "Windows-1252",
    line: "Die DATEV-Datei enthält ein Zeichen, das DATEV nicht kennt. Bitte die im Serverhinweis genannte Stelle ändern (oft ein Sonderzeichen in einer Notiz oder einem Lieferantennamen) und den Export erneut ziehen.",
  },
  {
    // 19.08.2026: der Deckel auf dem Prueferpaket-Zeitraum, und die verdrehte
    // Spanne. Beide Saetze nennen den naechsten Schritt selbst.
    token: "ergibt keine Spanne",
    line: "Der gewählte Zeitraum ergibt keine Spanne: der Anfang liegt hinter dem Ende. Bitte die beiden Daten tauschen.",
  },
  {
    token: "ein Paket traegt hoechstens",
    line: "Der gewählte Zeitraum ist zu gross für ein einzelnes Prüferpaket. Bitte in Abschnitte teilen, etwa Jahr für Jahr, und die Pakete einzeln ziehen.",
  },
  {
    // 18.08.2026, Fremdbeleg-Export: der Zeitraum hat keine unbare Ausgabe.
    token: "keine unbare Ausgabe",
    line: "Im gewählten Zeitraum liegt keine per Bank oder Karte bezahlte Ausgabe. Bar bezahlte Ausgaben stehen bereits im DATEV-Stapel ihres Kassentages.",
  },
  {
    /*
     * ── 11.08.2026: DER TAG IST GERADE NICHT ABGESCHLOSSEN ────────────────
     *
     * Bis heute fiel auch die Kollision der ABSCHLUSSNUMMER auf den Satz
     * darüber — und der ist dann UNWAHR: der Tag wurde nicht geschrieben.
     * Wer „besteht bereits" liest, hakt einen Tag ohne Z-Bon ab, und genau
     * daran erkennt ein Prüfer einen fehlenden Abschluss (§ 146 Abs. 1
     * Satz 2 AO). Seit der Sperre auf der Nummernvergabe ist der Fall
     * praktisch ausgeschlossen; der Satz muss trotzdem stimmen.
     *
     * Das Merkmal beginnt bei „wurde NICHT geschrieben", weil nur diese
     * Wortfolge die Kollision vom versiegelten Tag trennt.
     */
    token: "wurde NICHT geschrieben",
    line: "Der Tagesabschluss wurde nicht geschrieben: eine zweite Kasse hat im selben Augenblick dieselbe Abschlussnummer vergeben. Der Tag ist weiterhin offen. Bitte den Abschluss noch einmal auslösen.",
  },
  {
    // 4) No ledger anchor at finalize time — the chain head is missing, so the
    //    seal cannot be set. ("Kein Ledger-Anker vorhanden …") A system-state
    //    edge the owner cannot self-cure, so name it plainly and point at
    //    support rather than at a refresh that won't help.
    token: "Kein Ledger-Anker",
    line: "Der Tagesabschluss kann gerade nicht gesetzt werden die Buchungskette fehlt noch. Bitte später erneut versuchen oder den Support kontaktieren.",
  },
  // ── Schicht / Zweitkasse (eine offene Schicht pro Gerät) ───────────────────
  {
    // Opening a second shift on a device that already has one OPEN is refused —
    // the shifts route raises "A shift is already OPEN on this device." Point the
    // owner at the already-running register rather than the generic "aktualisieren"
    // fallback, which would not tell them the till is in fact already open here.
    token: "already OPEN on this",
    line: "Auf diesem Gerät ist bereits eine Schicht geöffnet. Sie wird oben unter Im Dienst angezeigt.",
  },
  {
    /**
     * ⚠️ 09.08.2026 nachgetragen. Die Fehlerklasse entstand am 08.08., der
     * deutsche Satz nicht — und der Wächter war seitdem ROT, ohne dass es
     * jemandem auffiel: ich hatte nur die Prüfung von `api-cloud` laufen
     * lassen, nie die dieses Pakets.
     *
     * Ohne Satz sah der Tresen nur „der aktuelle Stand passt nicht mehr" und
     * wusste NICHT, dass eine Schicht fehlt.
     */
    token: "Für Bargeld muss eine Schicht",
    line: "Für Bargeld muss eine Schicht geöffnet sein. Ohne Schicht erscheint dieses Geld in keinem Kassensturz. Bitte zuerst oben unter Im Dienst eine Schicht öffnen.",
  },
  {
    /*
     * ── DIE RÜCKGABE DESSELBEN BARGELDS, 11.08.2026 ──────────────────────
     *
     * Der Satz darüber gilt dem VERKAUF. Der Storno bekam denselben Riegel
     * erst heute (`StornoBargeldOhneSchichtError`), und ohne eigenen Satz
     * hätte der Tresen wieder nur „der aktuelle Stand passt nicht mehr"
     * gelesen — genau der Fehler, den die Warnung darüber beschreibt.
     *
     * Das Merkmal beginnt bei „Barrückgabe", weil nur dieses Wort den
     * Storno vom Verkauf trennt.
     */
    token: "Für eine Barrückgabe muss eine Schicht",
    line: "Für eine Barrückgabe muss eine Schicht geöffnet sein. Ohne Schicht erscheint dieses Geld in keinem Kassensturz, und der Tagesabschluss würde eine Differenz festschreiben, die es nie gab. Bitte zuerst oben unter Im Dienst eine Schicht öffnen.",
  },
  {
    /*
     * ── UND DER ANKAUF, 12.08.2026 ───────────────────────────────────────
     *
     * Die zwei Sätze darüber gelten dem Verkauf (08.08.) und dem Storno
     * (11.08.). Der ANKAUF hatte den Riegel bis heute gar nicht: er zahlte
     * bar aus und setzte die Schicht still auf nichts. Bei Edelmetall sind
     * das schnell mehrere tausend Euro, die die Lade verlassen und in
     * keinem Kassensturz auftauchen.
     *
     * Das Merkmal beginnt bei „Barauszahlung", weil nur dieses Wort den
     * Ankauf von den beiden anderen trennt.
     */
    token: "Für eine Barauszahlung muss eine Schicht",
    line: "Für eine Barauszahlung muss eine Schicht geöffnet sein. Ohne Schicht erscheint dieses Geld in keinem Kassensturz, und der Tagesabschluss würde eine Differenz festschreiben, die es nie gab. Bitte zuerst oben unter Im Dienst eine Schicht öffnen.",
  },
  {
    // Die Bargeldbewegung hat kein Gegenkonto: der Steuerberater muss es
    // nennen. Ein geratenes Konto fiele erst bei der Betriebsprüfung auf.
    token: "ist keine Buchung hinterlegt",
    line: "Für diese Bargeldbewegung ist keine Buchung hinterlegt, deshalb wurde keine DATEV-Datei erzeugt. Bitte lassen Sie sich von Ihrem Steuerberater das Konto nennen und tragen Sie es unter Einstellungen, Steuer und Buchhaltung ein.",
  },
  {
    /**
     * ⚠️ Das Merkmal endet HIER und nicht bei „ist kein Aufwandskonto…":
     * der Serversatz ist über eine Verkettung gebrochen
     * (`… ist kein ` + `Aufwandskonto hinterlegt, …`), und ein Merkmal über
     * die Bruchstelle hinweg käme im Quelltext wörtlich nicht vor.
     */
    token: "Aufwandskonto hinterlegt",
    line: "Für diese Ausgabenart ist kein Aufwandskonto hinterlegt, deshalb wurde keine DATEV-Datei erzeugt. Ein geratenes Konto stünde sonst monatelang falsch in der Buchhaltung. Bitte lassen Sie sich das Konto von Ihrem Steuerberater nennen.",
  },
  // ── Geldwege (Fiskal-Eindeutigkeit) ────────────────────────────────────────
  {
    // Storno idempotency: a second storno of the same original is refused.
    token: "transactions_one_storno_per_original_uq",
    line: "Dieser Vorgang wurde bereits storniert.",
  },
  // ── Sammlungen (Kategorien-Verwaltung) ─────────────────────────────────────
  {
    // Duplicate slug on create/rename. The operator never sees the slug as a
    // field, so name the conflict in their vocabulary (Kurzname = slug).
    token: "already exists.",
    line: "Eine Sammlung mit diesem Kurznamen gibt es bereits. Bitte einen anderen Namen wählen.",
  },
  // ── Kunden-Vertrauensstufe (KYC-Heraufstufung) ─────────────────────────────
  {
    // The ONLY 409 the KYC/Ausweis line truthfully describes: TrustConflictError
    // raises "cannot promote to {VERIFIED|VIP} without a prior physical-ID check".
    // Gate the KYC step on this token alone — never blame KYC for an unrelated
    // conflict, which would send the operator into a dead-end loop.
    token: "without a prior physical-ID check",
    line: "Aktion nicht möglich zuerst die KYC-Prüfung (Ausweis) bestätigen.",
  },
  {
    // Eine SUSPICIOUS/BANNED-Stufe ohne Notiz wäre eine Sperre ohne Begründung —
    // der Server lässt das Leeren darum nicht zu.
    token: "cannot clear notes while",
    line: "Bei dieser Vertrauensstufe muss eine Notiz hinterlegt bleiben. Bitte zuerst die Stufe ändern oder eine andere Notiz eintragen.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DER FUND (26.07.2026): 47 ECHTE 409-MELDUNGEN OHNE DEUTSCHEN SATZ
  //
  // Was falsch war: die Tabelle oben kannte 15 Konflikte. Der Server wirft aber
  // an 71 Stellen einen 409, und 47 verschiedene Meldungen davon standen in
  // keiner Zeile hier. Jede einzelne landete auf dem neutralen Rückfall
  // („der aktuelle Stand passt nicht mehr, bitte aktualisieren").
  //
  // Was am Tresen schiefging: dieser Rückfall ist nicht falsch, er ist LEER. Er
  // rät zum Aktualisieren, und Aktualisieren half in fast keinem dieser Fälle.
  // Wer einen verkauften Artikel löschen wollte, wer eine zweite Inventur
  // startete, wer einen abgelaufenen Gutschein einlöste, wer eine Bestellung
  // ohne Lieferadresse versenden wollte: alle bekamen denselben blassen Satz,
  // aktualisierten, versuchten es erneut und bekamen ihn wieder. Der Grund
  // stand die ganze Zeit in der Antwort des Servers, nur eben auf Englisch.
  //
  // Bitterer noch: an SIEBEN Stellen (Artikel löschen) und an FÜNF (Bestellungen)
  // schreibt der Server bereits einen sauberen, konkreten deutschen Satz. Der
  // Rückfall hat ihn WEGGEWORFEN und durch einen vageren ersetzt. Wir haben
  // Auskunft vernichtet, die schon da war.
  //
  // Warum trotzdem eigene Sätze statt die Servermeldung durchzureichen: die
  // deutschen Servertexte tragen lange Gedankenstriche, die in dieser Oberfläche
  // nichts zu suchen haben, und ein Durchreichen wäre nur so lange sicher, wie
  // niemand serverseitig englisch dazwischenschreibt. Ein eigener Satz je
  // Erkennungsmerkmal kann nie englisch werden. Der Preis: die Artikelnummer
  // aus der Servermeldung fällt weg — der Bedienende sieht ohnehin den Artikel,
  // den er gerade offen hat.
  //
  // Die Erkennungsmerkmale sind so gewählt, dass sie NIE über eine eingesetzte
  // Grösse hinweggreifen (`${sku}`, `${status}`) — sonst träfen sie nur im Test
  // und nie am Tresen. Der Wächter in `server-errors.guard.test.ts` erzwingt das.
  // ══════════════════════════════════════════════════════════════════════════

  // ── Bewertung / Ankauf-Schätzung ───────────────────────────────────────────
  {
    token: "cannot modify items",
    line: "Diese Bewertung ist nicht mehr offen. Positionen lassen sich darin nicht mehr ändern.",
  },
  {
    token: "cannot remove items",
    line: "Diese Bewertung ist nicht mehr offen. Positionen lassen sich darin nicht mehr entfernen.",
  },
  {
    token: "cannot complete.",
    line: "Diese Bewertung lässt sich nicht abschliessen sie ist nicht mehr offen. Bitte die Ansicht aktualisieren.",
  },
  {
    token: "only COMPLETED can be accepted",
    line: "Diese Bewertung kann noch nicht angenommen werden. Bitte sie zuerst abschliessen.",
  },
  {
    token: "Cannot reject an ACCEPTED appraisal",
    line: "Diese Bewertung wurde bereits angenommen und lässt sich nicht mehr ablehnen. Bitte stattdessen stornieren oder zurücknehmen.",
  },
  {
    token: "already REJECTED",
    line: "Diese Bewertung wurde bereits abgelehnt.",
  },

  // ── Tagesabschluss-Export (DATEV / Kassenbericht / DSFinV-K) ───────────────
  {
    // Alle drei Ausfuhrwege werfen denselben Satz mit anderem Format-Namen. Das
    // Merkmal steht vor dem Formatnamen, deckt also alle drei ab.
    token: "ist noch nicht finalisiert",
    line: "Für diesen Tag ist der Tagesabschluss noch nicht gesetzt. Der Export ist erst nach dem Z-Bon möglich.",
  },

  // ── Ausweisbilder (KYC-Speicher) ───────────────────────────────────────────
  {
    token: "KYC image store is full",
    line: "Der Ausweis-Speicher ist voll das Bild wurde NICHT gespeichert. Bitte den Support kontaktieren.",
  },
  {
    token: "KYC image file missing",
    line: "Das Ausweisbild fehlt im Speicher, obwohl der Datensatz es führt. Bitte den Ausweis neu aufnehmen.",
  },
  {
    token: "KYC image authentication failed",
    line: "Das Ausweisbild lässt sich nicht entschlüsseln es gehört nicht zu diesem Kunden. Bitte den Support kontaktieren.",
  },
  {
    token: "KYC image integrity check failed",
    line: "Das Ausweisbild ist beschädigt und lässt sich nicht anzeigen. Bitte den Ausweis neu aufnehmen.",
  },

  // ── Inventur ───────────────────────────────────────────────────────────────
  {
    token: "inventory session is already OPEN",
    line: "Es läuft bereits eine Inventur. Bitte diese zuerst abschliessen.",
  },
  {
    token: "Inventory session is CLOSED",
    line: "Diese Inventur ist abgeschlossen es lässt sich nichts mehr dazu erfassen.",
  },
  {
    token: "Session is already CLOSED",
    line: "Diese Inventur wurde bereits abgeschlossen.",
  },

  // ── Bestellungen (Abhol-Ablauf) ────────────────────────────────────────────
  {
    token: "zur Abholung offen",
    line: "Diese Bestellung steht nicht mehr zur Abholung offen. Bitte die Bestellung neu laden.",
  },

  // ── Fotos ──────────────────────────────────────────────────────────────────
  {
    token: "Fotospeicher voll",
    line: "Der Fotospeicher ist voll das Foto wurde NICHT gespeichert. Fotos verkaufter Artikel werden automatisch aufgeräumt, bitte in einigen Minuten erneut versuchen.",
  },

  // ── Zustandswechsel (Aufgaben + Fotoablauf) ────────────────────────────────
  {
    // Aufgaben und der Fotoablauf werfen WÖRTLICH denselben Satz
    // („Illegal transition X → Y"). Sie lassen sich hier nicht auseinanderhalten
    // — die Heilung ist aber in beiden Fällen dieselbe, darum ist eine
    // gemeinsame Zeile ehrlich und nicht geraten. Steht bewusst NACH dem
    // eBay-Merkmal, damit die eBay-Zeile ihren eigenen Satz behält.
    token: "Illegal transition",
    line: "Dieser Schritt ist nicht mehr möglich der Stand hat sich inzwischen geändert. Bitte die Ansicht aktualisieren.",
  },

  // ── Artikel (Bearbeiten / Archivieren / Löschen) ───────────────────────────
  {
    token: "is not permitted via PUT",
    line: "Dieser Statuswechsel lässt sich nicht über das Bearbeiten-Formular setzen. Reserviert und Verkauft entstehen nur über Verkauf oder Reservierung.",
  },
  {
    token: "Only SOLD products may be archived",
    line: "Nur verkaufte Artikel lassen sich archivieren. Dieser Artikel ist noch nicht verkauft.",
  },
  {
    token: "is already archived.",
    line: "Dieser Artikel ist bereits archiviert.",
  },
  {
    token: "ist bereits archiviert und kann nicht gelöscht werden",
    line: "Dieser Artikel ist bereits archiviert und lässt sich nicht mehr löschen.",
  },
  {
    token: "Teil der fiskalischen Aufzeichnung",
    line: "Dieser Artikel wurde verkauft und gehört zur fiskalischen Aufzeichnung. Er lässt sich nur archivieren, nicht löschen.",
  },
  {
    token: "ist derzeit reserviert und kann nicht gelöscht werden",
    line: "Dieser Artikel ist derzeit reserviert. Bitte zuerst die Reservierung aufheben, danach lässt er sich löschen.",
  },
  {
    token: "aktuell live bei eBay gelistet",
    line: "Dieser Artikel ist gerade live bei eBay. Bitte das Listing zuerst beenden, danach lässt er sich löschen.",
  },
  {
    token: "ist mit einem Beleg verknüpft",
    line: "Dieser Artikel hängt an einem Beleg und lässt sich darum nicht löschen. Archivieren ist möglich.",
  },
  {
    token: "mit einem Termin (Besichtigung/Reservierung) verknüpft",
    line: "Dieser Artikel hängt an einem Termin (Besichtigung oder Reservierung) und lässt sich darum nicht löschen.",
  },
  {
    token: "noch mit anderen Datensätzen verknüpft",
    line: "Dieser Artikel hängt noch an anderen Datensätzen, etwa einem Dokument, einer Inventur oder einem Warenkorb, und lässt sich darum nicht endgültig löschen.",
  },

  // ── Schicht / Kassensturz ──────────────────────────────────────────────────
  {
    token: "cash movement on a CLOSED shift",
    line: "Die Schicht ist bereits abgeschlossen. Eine Bareinlage oder Barentnahme lässt sich nicht mehr buchen bitte zuerst eine neue Schicht öffnen.",
  },
  {
    token: "Shift is already CLOSED",
    line: "Diese Schicht wurde bereits abgeschlossen.",
  },

  // ── Versand ────────────────────────────────────────────────────────────────

  // ── Anfragen (Support-Postfach) ────────────────────────────────────────────

  // ── Rücknahme + Storno ─────────────────────────────────────────────────────
  /*
   * ⚰️ 15.08.2026: hier stand `Only WEB sales can be online-returned`.
   * Die Route `transactions-return.ts` ist an diesem Tag ersatzlos gelöscht
   * worden, also kann dieser Serversatz nirgends mehr entstehen. Der Wächter
   * `konflikt-merkmale.guard.test.ts` hat den Geist gefunden.
   */
  {
    token: "has already been stornoed",
    line: "Dieser Vorgang wurde bereits storniert.",
  },

  // ── Gutscheine ─────────────────────────────────────────────────────────────
  {
    token: "cannot redeem",
    line: "Dieser Gutschein lässt sich nicht einlösen er ist bereits eingelöst, abgelaufen oder gesperrt.",
  },
  {
    token: "Voucher has expired",
    line: "Dieser Gutschein ist abgelaufen und lässt sich nicht mehr einlösen.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DER FUND (04.08.2026): 14 EHRLICHE ABSAGEN DES SERVERS ERREICHTEN DEN
  // BILDSCHIRM NICHT
  //
  // Gemessen mit `server-errors.guard.test.ts` gegen den Serverquelltext:
  // vierzehn 409-Meldungen hatten hier keine Zeile und landeten alle auf
  // `UNRECOGNISED_CONFLICT_LINE` („der aktuelle Stand passt nicht mehr, bitte
  // aktualisieren").
  //
  // Das Schlimmste davon war die fehlende TSE. Der Server sagt wörtlich, es sei
  // keine technische Sicherheitseinrichtung eingerichtet, Belege würden nicht
  // signiert, und nennt sogar den Weg (Einstellungen, Geräte). Am Tresen stand
  // stattdessen „bitte aktualisieren und erneut versuchen". Aktualisieren hilft
  // hier NIE: es ist nichts veraltet, es ist etwas nicht eingerichtet. Der
  // Verkäufer drückt also im Kreis, während der Grund die ganze Zeit in der
  // Antwort stand. Dieselbe Klasse traf DATEV (Zahlart ohne Buchungskonto,
  // Sachkontenlänge, Kontenrahmen), den fehlenden Ladennamen, die Buchung
  // ausserhalb der Arbeitszeit, zwei Tagesabschluss-Riegel, den Kartenleser
  // ohne Stripe-Konto, die Erstattung einer nicht erfolgreichen Zahlung, die
  // verlorene Kassenbewegung und den Storno über den falschen Weg.
  //
  // Der Wortlaut des Servers ist übernommen, wo er gut ist — er ist es meistens.
  // Nicht durchgereicht, sondern abgeschrieben: eine durchgereichte Meldung ist
  // nur so lange deutsch, wie niemand serverseitig englisch dazwischenschreibt,
  // und die Servertexte tragen lange Gedankenstriche, die hier nichts zu suchen
  // haben. Die eingesetzten Grössen (Zahlart, Tag, Anzahl, Zustand) fallen weg;
  // die Merkmale greifen darum NIE über eine eingesetzte Grösse hinweg, sonst
  // träfen sie nur im Test und nie am Tresen.
  // ══════════════════════════════════════════════════════════════════════════

  // ── Technische Sicherheitseinrichtung (§ 146a AO) ──────────────────────────
  /*
   * ⚰️ 15.08.2026: hier stand `Belege ohne technische Sicherheitseinrichtung
   * sind aufgebraucht`, der Satz zum Vorrat von zehn Belegen. Der Vorrat ist
   * an diesem Tag ersatzlos amputiert worden.
   *
   * ⚠️ UND EINE KORREKTUR AN MIR SELBST. Der Eintrag trug die Begründung, er
   * müsse bleiben, weil „eine Kasse, die noch nicht aktualisiert ist, vom
   * Server weiter den alten Satz bekommt". Das ist hier falsch: der Motor
   * reist als Beiwagen IN der Kasse (`externalBin: binaries/norns-sidecar`,
   * gebündelt von `scripts/buendle-motor.mjs`). Eine alte Kasse hat also
   * genau denselben alten Motor UND dieses alte Wörterbuch. Es gibt keinen
   * neueren Server, der ihr einen Satz schicken könnte, den sie nicht kennt.
   *
   * Die Regel gilt für echte Netzdienste, nicht für einen mitgelieferten
   * Motor. Wer sie das nächste Mal anführt, prüfe zuerst, ob Sender und
   * Empfänger überhaupt getrennt ausgeliefert werden.
   */
  {
    // Der ALTE Wortlaut. Kommt nur noch von einer Kasse, die den Stand vom
    // 13.08.2026 nicht hat. Siehe die Begründung im Eintrag darüber.
    token: "keine technische Sicherheitseinrichtung eingerichtet",
    line:
      "Es ist keine technische Sicherheitseinrichtung eingerichtet. Belege werden nicht " +
      "signiert, und die Kasse erfüllt § 146a AO nicht. Bitte die TSE unter Einstellungen, " +
      "Geräte einrichten. Bis dahin ist dieser Vorgang nicht möglich.",
  },

  // ── Tagesabschluss: die zwei Riegel, die oben fehlten ──────────────────────
  {
    // Der Server hat seinen Wortlaut geändert: er sagt heute „keine geschlossene
    // Schicht deckt diesen Tag ab" statt „kein Kassensturz". Das ältere Merkmal
    // oben trifft diese Meldung darum nicht mehr, und der Riegel war blass.
    token: "keine geschlossene Schicht deckt",
    line: "Für diesen Tag liegen Belege vor, aber keine abgeschlossene Schicht deckt ihn ab. Bitte zuerst die Schicht abschliessen (Kassensturz).",
  },
  {
    // Belege ohne TSE-Signatur: der Tag lässt sich abschliessen, aber nur
    // ausdrücklich. Der Sammelsatz riet zum Aktualisieren und verschwieg damit,
    // dass hier eine BESTÄTIGUNG verlangt wird, nicht ein neuer Versuch.
    token: "keine TSE-Signatur",
    line: "Für diesen Tag tragen noch Belege keine TSE-Signatur. Der Tag lässt sich abschliessen, aber nur ausdrücklich: die fehlenden Signaturen werden nachgeholt, sobald die Sicherungseinrichtung wieder erreichbar ist, und der Abschluss hält fest, dass sie zum Abschlusszeitpunkt fehlten.",
  },

  // ── DATEV (Kontierung + Mandantenangaben) ──────────────────────────────────
  {
    // Der Export bricht ab, statt still auf die Kasse zu buchen. Das ist die
    // richtige Entscheidung, aber der Sammelsatz machte daraus einen
    // Aktualisierungshinweis — und verschwieg, dass KEINE Datei erzeugt wurde.
    token: "ist kein Buchungskonto hinterlegt",
    line: "Für eine Zahlart dieses Zeitraums ist kein Buchungskonto hinterlegt, darum wurde KEINE DATEV-Datei erzeugt. Sie still auf die Kasse zu buchen wäre falsch: das Konto Kasse darf nur echtes Bargeld tragen. Bitte lassen Sie sich von Ihrem Steuerberater das passende Konto nennen.",
  },
  {
    token: "Die Sachkontenlänge muss vier bis acht Stellen haben",
    line: "Die eingetragene Sachkontenlänge ist ungültig. Sie muss vier bis acht Stellen haben und zum Bestand Ihres Steuerberaters passen. Bitte den Wert in den DATEV-Angaben berichtigen.",
  },
  {
    token: "Der Kontenrahmen muss SKR03 oder SKR04 sein",
    line: "Der eingetragene Kontenrahmen ist ungültig. Erlaubt sind SKR03 und SKR04. Bitte den Wert in den DATEV-Angaben berichtigen.",
  },

  // ── Ladenname (Belegidentität) ─────────────────────────────────────────────
  {
    token: "Der Name des Ladens ist nicht eingetragen",
    line: "Der Name des Ladens ist nicht eingetragen. Bitte ihn unter Einstellungen, Laden nachtragen.",
  },

  // ── Termine (Arbeitszeit, Feiertag, Urlaub) ────────────────────────────────
  {
    // Beim Verlegen eines Termins. Der Sammelsatz schickte hier besonders in die
    // Irre: der Stand ist nicht veraltet, die gewählte Zeit ist schlicht keine
    // Arbeitszeit. Wer aktualisiert, bekommt dieselbe Absage.
    // Bewusst NICHT Wort für Wort der Servertext: der Wächter verlangt einen
    // eigenen Satz, und zwar zu Recht. Eine durchgereichte Meldung bleibt nur
    // so lange deutsch, wie niemand serverseitig etwas anderes hinschreibt.
    token: "ausserhalb der Arbeitszeit",
    line: "Dieser Zeitpunkt liegt ausserhalb der Arbeitszeit, auf einem Feiertag oder im Urlaub. Bitte eine Zeit innerhalb der hinterlegten Arbeitszeiten wählen, oder die Zeiten unter Termine anpassen.",
  },

  // ── Schicht: die verlorene Kassenbewegung ──────────────────────────────────
  {
    // Ein Systemzustand, den der Bedienende nicht selbst heilen kann. Wichtig ist
    // hier vor allem die Auskunft, dass NICHTS gebucht wurde — sonst bucht
    // jemand dieselbe Einlage ein zweites Mal.
    token: "Kassenbewegung konnte weder angelegt noch wiedergefunden werden",
    line: "Die Kassenbewegung konnte weder angelegt noch wiedergefunden werden. Es wurde NICHTS gebucht. Bitte die Schicht neu laden und, wenn es bleibt, den Support kontaktieren.",
  },

  // ── Kartenleser (Stripe Terminal) ──────────────────────────────────────────
  {
    // Der Server schreibt „Haendlerkonto" ohne Umlaut; das Merkmal folgt dem
    // Serverwortlaut, die gelesene Zeile schreibt sauberes Deutsch.
    token: "kein Stripe-Haendlerkonto verbunden",
    line: "Es ist kein Stripe-Händlerkonto verbunden. Der Kartenleser kann darum nicht kassieren. Bitte zuerst die Stripe-Einrichtung abschliessen.",
  },
  {
    token: "Nur eine erfolgreiche Zahlung kann erstattet werden",
    line: "Erstatten lässt sich nur eine Zahlung, die erfolgreich abgeschlossen wurde. Diese ist es nicht. Bitte den Stand der Zahlung neu laden.",
  },

  // ── Storno auf dem falschen Weg ────────────────────────────────────────────
  {
    // Der Abschluss nimmt keinen Storno entgegen. Der Sammelsatz liess offen,
    // dass es einen richtigen Weg GIBT — der Server nennt ihn, wir auch.
    token: "Eine Stornierung wird nicht über den Abschluss gebucht",
    line: "Eine Stornierung wird nicht über den Abschluss gebucht. Bitte den Storno-Weg benutzen: er verlangt die Zweitbestätigung unabhängig vom Betrag und einen Grund im Klartext, und schreibt beides ins Tagebuch. Für eine Rückgabe mit Ware gibt es den Rückgabe-Weg.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DIE DREI WURFSTELLEN, VOR DENEN DER WÄCHTER STUMM IST (05.08.2026 gemessen)
  //
  // Der Wächter `server-errors.guard.test.ts` liest den Meldungstext aus der
  // Wurfstelle. Diese drei reichen ihn als VARIABLE durch, nicht als
  // Zeichenkette, und werden darum still übersprungen:
  //
  //   routes/shipping.ts        new DhlNotSetUpError(err.message)
  //   routes/stripe-terminal.ts new TerminalZustandError(tor.reason)
  //
  // Sie waren also NICHT vom Wächter gedeckt, und gemessen fielen alle drei
  // Wortlaute auf den Sammelsatz: „der aktuelle Stand passt nicht mehr, bitte
  // aktualisieren". Das ist in allen drei Fällen falsch. Nichts ist veraltet;
  // es fehlt ein Zugang, oder Stripe prüft noch. Wer aktualisiert, bekommt
  // dieselbe Absage.
  //
  // Die Merkmale sind aus dem Serverquelltext ABGESCHRIEBEN und liegen bewusst
  // am ENDE der Tabelle: sie sind die jüngsten, sie sollen kein älteres,
  // engeres Merkmal überholen. Dass sie trotzdem gewinnen und dass es sie im
  // Server wörtlich gibt, misst `konflikt-merkmale.guard.test.ts`.
  //
  // Jedes Merkmal bleibt INNERHALB eines Zeichenketten-Stücks des Servers: die
  // DHL-Meldung ist dort aus zwei Stücken verkettet, ein Merkmal quer über die
  // Naht stünde nirgends wörtlich und wäre ein Geist.
  // ══════════════════════════════════════════════════════════════════════════

  // ── DHL ohne hinterlegten Zugang ───────────────────────────────────────────

  // ── Kartenleser: das Stripe-Konto ist noch nicht freigeschaltet ────────────
  {
    // Hier hilft Warten, nicht Handeln. Der Sammelsatz forderte das Gegenteil.
    token: "Stripe prüft die eingereichten Angaben noch",
    line: "Stripe prüft die eingereichten Angaben noch. Bis die Prüfung durch ist, kann der Kartenleser nicht kassieren. Bitte solange bar oder mit einem anderen Weg kassieren.",
  },
  {
    // Und hier hilft Handeln, nicht Warten. Genau diese Unterscheidung ging im
    // Sammelsatz verloren, obwohl der Server sie sauber trifft.
    token: "Die Einrichtung des Stripe-Kontos ist noch nicht abgeschlossen",
    line: "Die Einrichtung des Stripe-Kontos ist noch nicht abgeschlossen, darum kann der Kartenleser nicht kassieren. Bitte den Vorgang bei Stripe zu Ende führen, dann hier neu laden.",
  },
]

/**
 * Liest aus einem Zahlenmuster die erlaubte Form und sagt sie auf deutsch.
 *
 * ⚠️ WARUM ES DAS BRAUCHT (Basels Befund vom 05.08.2026): er tippte das
 * Gewicht einer Feinunze ein, 31,103 g, und bekam „Gewicht ungültig bitte
 * prüfen". Vor ihm lag ein völlig richtiges Gewicht. Der Satz war ehrlich und
 * trotzdem nutzlos: er nannte das Feld, aber nicht die Bedingung, an der es
 * scheiterte. Wer nicht weiss, WAS erlaubt ist, kann nichts korrigieren, und
 * genau da hat er aufgehört und gefragt.
 *
 * Die Ursache selbst ist behoben. Der Satz bleibt trotzdem stumpf, solange er
 * die Regel verschweigt — beim nächsten Feld stünde derselbe Mensch wieder
 * ratlos davor.
 */
function musterAlsSatz(muster: string): string | null {
  const m = /^\^-?\\d(?:\{1,(\d+)\})?\(\\\.\\d(?:\{1,(\d+)\})?\)\?\$$/.exec(muster)
  if (!m) return null
  const stellen = m[2] ? Number(m[2]) : 1
  return stellen === 1
    ? "höchstens eine Nachkommastelle"
    : `höchstens ${stellen} Nachkommastellen`
}

/**
 * Turn a VALIDATION_ERROR's ajv detail into a field-specific German line, so a
 * server-side reject the client missed (a bad calendar date, a too-short phone)
 * names the offending field in German instead of leaking the raw English ajv
 * message. Returns null when no known field can be read — the caller then uses a
 * generic German fallback. The English `err.message` is never surfaced.
 *
 * Wo die Regel sich in einen deutschen Halbsatz übersetzen lässt, wird sie
 * ANGEHÄNGT. „Gewicht ungültig" allein hat einen Menschen ratlos gelassen;
 * „Gewicht ungültig, höchstens 4 Nachkommastellen" hätte er lösen können.
 */
function describeValidationError(err: ApiError): string | null {
  const details = err.details
  if (!Array.isArray(details)) return null
  for (const entry of details as AjvErrorDetail[]) {
    const path = entry?.instancePath
    if (typeof path !== "string" || path.length === 0) continue
    // "/dateOfBirth" → "dateOfBirth"; "/address/city" → "address".
    const field = path.split("/").filter(Boolean)[0]
    const label = field ? VALIDATION_FIELD_LABELS[field] : undefined
    if (!label) continue

    if (entry.keyword === "pattern" && typeof entry.params?.pattern === "string") {
      const regel = musterAlsSatz(entry.params.pattern)
      if (regel) return `${label} ungültig, ${regel}.`
    }
    if (entry.keyword === "minLength" && typeof entry.params?.limit === "number") {
      return `${label} ungültig, mindestens ${entry.params.limit} Zeichen.`
    }
    if (entry.keyword === "maxLength" && typeof entry.params?.limit === "number") {
      return `${label} ungültig, höchstens ${entry.params.limit} Zeichen.`
    }
    return `${label} ungültig bitte prüfen.`
  }
  return null
}

/**
 * Der neutrale Rückfall für einen 409, den wir nicht wiedererkennen. Ehrlich,
 * aber blass: er sagt dem Tresen NICHT, was zu tun ist.
 *
 * Exportiert, weil der Wächter (`server-errors.guard.test.ts`) genau darauf
 * zeigt: er liest die 409-Würfe aus dem Serverquelltext und wird rot, sobald
 * eine davon hier landet. Als eingetippte Zeichenkette in der Prüfung würde
 * eine spätere Umformulierung den Wächter still ausschalten.
 */
export const UNRECOGNISED_CONFLICT_LINE =
  "Aktion derzeit nicht möglich der aktuelle Stand passt nicht mehr. Bitte aktualisieren und erneut versuchen."

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  FISKALE SPERREN SPRECHEN SCHON DEUTSCH. WÖRTLICH WEITERREICHEN.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 13.08.2026 ──────────────────────────────────────────────
 *
 * Sieben Konfliktklassen des Fiskalwegs landeten auf dem neutralen Rückfall
 * oben. Am Tresen las der Händler dann:
 *
 *     „Aktion derzeit nicht möglich der aktuelle Stand passt nicht mehr.
 *      Bitte aktualisieren und erneut versuchen."
 *
 * Das ist nicht blass, das ist FALSCH. Aktualisieren hilft nie: es fehlt eine
 * Z-Nummer, ein Umsatzsteuerschlüssel, ein Einkaufspreis nach § 25a, oder ein
 * Wert steht nicht in der geschlossenen Liste der Norm. Der Händler hätte
 * beliebig oft neu geladen, während KEIN Paket und KEINE DATEV-Datei
 * entstanden ist und er das nicht erfährt.
 *
 * Gefunden erst, nachdem der Wächter geweitet war: sein Fenster von 400
 * Zeichen am Klassenrumpf hatte genau diese sieben verdeckt.
 *
 * ── WARUM WÖRTLICH UND NICHT ÜBERSETZT ─────────────────────────────────────
 *
 * `describeError` gibt es, weil Servermeldungen sonst englischer Drahttext
 * wären. Diese hier sind keiner. Sie sind auf Deutsch geschrieben, nennen den
 * betroffenen Beleg oder das betroffene Feld, sagen ausdrücklich, dass nichts
 * erzeugt wurde, und nennen den Handgriff („Bitte unter Einstellungen →
 * Steuer eintragen"). Eine kürzere Zeile hier wäre in jeder Hinsicht weniger
 * wert als das Original.
 *
 * ⚠️ Diese Liste darf NICHT blind werden. Der Schutz dagegen steht nicht
 * hier, sondern im Wächter: `server-errors.guard.test.ts` fegt alle
 * `DomainError`-Klassen des Servers und wird rot, sobald eine 409-Meldung auf
 * dem Rückfall landet. Eine neue fiskale Sperre ohne Eintrag hier fällt also
 * dort auf, und zwar bevor sie den Händler erreicht.
 */
export const FISKALE_SPERREN: ReadonlyArray<{ wendung: string; klasse: string }> = [
  { wendung: "steht nicht in der geschlossenen Liste der Norm", klasse: "UnbekannterNormwertError" },
  { wendung: "welcher Geschäftsvorfalltyp der Norm gilt", klasse: "GeschaeftsvorfallOffenError" },
  { wendung: "fehlen die Angaben zum Steuerpflichtigen", klasse: "StammdatenUnvollstaendigError" },
  { wendung: "trägt keine Z-Nummer", klasse: "ZNummerFehltError" },
  { wendung: "ist kein Umsatzsteuerschlüssel hinterlegt", klasse: "UstSchluesselOffenError" },
  { wendung: "nach § 25a keinen Einkaufspreis", klasse: "MargeOhneEinkaufspreisError" },
  { wendung: "hat kein Erlöskonto", klasse: "UnbekannteSteuerbehandlungError" },
]

/**
 * Map a 409 CONFLICT to an actionable German line. First the count-bearing
 * cases (which read a real number out of the English message), then the static
 * token table, then a neutral honest fallback for an unrecognised conflict.
 */
function describeConflict(err: ApiError): string {
  const msg = err.message ?? ""

  // Delete refused because products still point at the category — the route
  // raises "Category … is assigned to N product(s). Unassign first." Pull the
  // count out so the line stays a real number, never a guess.
  if (msg.includes("is assigned to") && msg.includes("product(s)")) {
    const n = msg.match(/is assigned to (\d+) product/)?.[1]
    return n
      ? `Diese Sammlung ist noch ${n} Artikel${n === "1" ? "" : "n"} zugeordnet. Bitte zuerst die Zuordnung lösen.`
      : "Dieser Sammlung sind noch Artikel zugeordnet. Bitte zuerst die Zuordnung lösen."
  }
  // Delete refused because a child category exists — "Category … has N
  // subcategory/-ies. Delete or re-parent first."
  if (msg.includes("subcategory/-ies")) {
    const n = msg.match(/has (\d+) subcategory/)?.[1]
    return n
      ? `Diese Sammlung hat noch ${n} Untersammlung${n === "1" ? "" : "en"}. Bitte diese zuerst löschen oder verschieben.`
      : "Diese Sammlung hat noch Untersammlungen. Bitte diese zuerst löschen oder verschieben."
  }

  for (const { token, line } of CONFLICT_TOKENS) {
    if (msg.includes(token)) return line
  }

  // Fiskale Sperren sprechen schon Deutsch, und zwar vollständig. Wörtlich
  // weiterreichen, statt sie zu kürzen. Siehe `FISKALE_SPERREN`.
  for (const { wendung } of FISKALE_SPERREN) {
    if (msg.includes(wendung)) return msg
  }

  // Unrecognised conflict. Stay honest: don't surface the raw English, don't
  // fabricate a cause we can't prove. A neutral, actionable German line.
  return UNRECOGNISED_CONFLICT_LINE
}

/**
 * Map a 401 UNAUTHORIZED to an actionable German line.
 *
 * CRITICAL: the api-cloud PIN-login route raises its 401 messages in ENGLISH —
 * "Invalid PIN (N attempts remaining)", "PIN login requires a paired device",
 * "PIN not set for this user", "Authentication required". (We cannot change that
 * route: it is shared by the cashier POS + storefront.) So the owner must NEVER
 * see `err.message` here — we recognise the stable English token and answer in
 * German, pulling the real attempts-remaining count out of the message so the
 * line stays an honest number rather than a guess. An unrecognised 401 falls
 * back to the calm German default ("Falsche PIN."), never the raw English.
 */
function describeUnauthorized(err: ApiError): string {
  const msg = err.message ?? ""

  // The common wrong-PIN case carries the real attempts-remaining count in its
  // English text — surface that number in German so the owner knows how many
  // tries remain before the lockout, without ever seeing the English.
  if (msg.includes("Invalid PIN")) {
    const n = msg.match(/\((\d+) attempts? remaining\)/)?.[1]
    if (n === "1") return "Falsche PIN noch 1 Versuch, dann wird die PIN gesperrt."
    return n
      ? `Falsche PIN noch ${n} Versuche.`
      : "Falsche PIN bitte erneut versuchen."
  }
  // Device pairing / PIN-not-set are setup states, not a wrong PIN. Name them in
  // the owner's vocabulary so the screen never blames the entered PIN.
  if (msg.includes("requires a paired device")) {
    return "Dieses Gerät ist nicht freigegeben bitte zuerst koppeln."
  }
  if (msg.includes("PIN not set")) {
    return "Für dieses Konto ist noch keine PIN hinterlegt."
  }
  // Any other 401 (e.g. "Authentication required") → calm German default.
  //
  // WARUM NICHT MEHR „Falsche PIN." (25.07.2026): dieser Zweig fängt JEDEN 401,
  // der nicht ausdrücklich eine Anmeldung ablehnt — vor allem den ganz normalen
  // Fall „die Sitzung ist abgelaufen oder wurde widerrufen". Die Zeile stand
  // dann quer über den ganzen Betrieb (Übersicht, Lager, Kunden) und beschuldigte
  // eine PIN, die es seit dem 21.07. gar nicht mehr gibt und die auf keinem
  // dieser Schirme ein Eingabefeld hat. Sie benennt jetzt den wahren Zustand und
  // sagt, was zu tun ist. Wir geben nie die Draht-Meldung weiter, die englisch ist.
  return "Die Sitzung ist abgelaufen bitte erneut anmelden."
}

/**
 * The fixed German line for each stable `ApiErrorCode`, EXCEPT the four codes
 * whose copy depends on the response body and so are computed in
 * `describeError`: PIN_LOCKED (countdown), UNAUTHORIZED (server message),
 * VALIDATION_ERROR (ajv field), CONFLICT (constraint token).
 *
 * Typed as a Record over those remaining codes, so adding a new `ApiErrorCode`
 * member to the api-cloud contract fails the build until it has a German line.
 */
type StaticErrorCode = Exclude<
  ApiErrorCode,
  "PIN_LOCKED" | "UNAUTHORIZED" | "VALIDATION_ERROR" | "CONFLICT"
>

/**
 * Der letzte Rückfall: der Server hat einen Code geschickt, den dieses Paket
 * nicht kennt. Er nennt keinen Grund, weil wir keinen kennen aber er sagt,
 * dass der Vorgang NICHT ausgeführt wurde. Das ist die wichtigste Auskunft am
 * Tresen: nicht noch einmal blind buchen.
 *
 * Exportiert, damit der Wächter darauf zeigen kann. WICHTIG: dieser Satz ist
 * ein Sicherheitsnetz für den Tresen, KEIN Ersatz für eine Übersetzung. Beim
 * Beweislauf am 26.07.2026 hat sich gezeigt, dass er den Wächter sonst blind
 * macht: ein frisch erfundener Servercode fiel weich auf diesen Satz, und die
 * Prüfung blieb grün, obwohl niemand ihn übersetzt hatte. Der Wächter fordert
 * darum ausdrücklich einen ANDEREN Satz als diesen.
 */
export const UNKNOWN_CODE_LINE =
  "Der Vorgang wurde nicht ausgeführt der Server hat ihn abgelehnt. Bitte erneut versuchen und, wenn es bleibt, den Support kontaktieren."

const STATIC_ERROR_LINES: Readonly<Record<StaticErrorCode, string>> = {
  NOT_FOUND: "Datensatz nicht gefunden.",
  FORBIDDEN: "Keine Berechtigung für diese Aktion.",
  STEP_UP_REQUIRED: "PIN-Bestätigung erforderlich.",
  DEVICE_NOT_AUTHORIZED: "Dieses Gerät ist nicht freigegeben.",
  // ⚠️ Der Satz muss sagen, was NOCH geht. Wer glaubt, die Kasse sei kaputt,
  // ruft den Steuerberater an statt den Inhaber und macht in der Zwischenzeit
  // seinen Tagesabschluss nicht.
  LIZENZ_FEHLT:
    "Diese Kasse ist nicht mehr freigeschaltet. Neue Verkäufe und Ankäufe brauchen einen gültigen Freischaltschlüssel. Tagesabschluss, Stornos, Ihre Bücher und alle Ausfuhren für das Finanzamt bleiben offen. Den Schlüssel trägt der Inhaber unter Einstellungen ein.",
  RATE_LIMITED: "Zu viele Versuche bitte einen Moment warten und erneut versuchen.",
  // Fiskal- + Inventar-Codes der Geldwege — sie tragen ihren EIGENEN code.
  PRODUCT_NOT_RESERVABLE:
    "Dieser Artikel ist nicht mehr verfügbar er wurde bereits reserviert oder verkauft.",
  CLOSING_DAY_FINALIZED:
    "Der Kassentag ist bereits abgeschlossen (Z-Bon). Eine Buchung ist erst nach dem nächsten Kassenstart möglich.",
  // ⚠️ 30.07.2026. Der Server wirft `VatCheckRequiredError` mit einem
  // sorgfältig formulierten deutschen Grund, aber der CODE stand hier nicht:
  // der Kassierer sah den nichtssagenden Standardsatz, während der Server
  // genau erklärt hatte, was fehlt. Der Riegel über § 13b ist damit
  // unsichtbar geworden — er greift, aber niemand versteht warum.
  PIN_NOT_SET:
    "Für diese Kasse ist noch kein Code gesetzt. Bitte richten Sie ihn beim " +
    "ersten Start ein — er wird nicht vorgegeben, sondern von Ihnen gewählt.",
  VAT_CHECK_REQUIRED:
    "Für § 13b braucht dieser Vorgang eine geprüfte USt-IdNr. Die EU-Abfrage war " +
    "zuletzt nicht erreichbar oder liegt zu lange zurück. Bitte die Prüfung " +
    "wiederholen, oder den Verkauf mit dem Regelsatz abschliessen.",
  KYC_REQUIRED:
    "Ausweis-Identifikation erforderlich bitte zuerst einen geprüften Kunden zuordnen.",
  SANCTIONS_BLOCK: "Sanktionslisten-Treffer die Buchung ist gesperrt. Bitte intern prüfen.",
  // ── DER RÜCKFALL, NICHT DER HAUPTWEG (26.07.2026) ───────────────────────
  // Seit Wanderung 0117 steht in keiner Wanderung mehr eine Beraternummer und
  // keine Mandantennummer: sie gehören dem Händler, nicht dem Erzeugnis. Bei
  // JEDEM neuen Laden fehlen sie also, bis er sie einträgt — das ist kein
  // Fehler, sondern der erste DATEV-Abruf.
  //
  // Die Kasse fängt diesen Code deshalb ab und öffnet an Ort und Stelle ein
  // Einrichtungsformular; dieser Satz wird dort NIE gelesen. Er ist für jede
  // andere Fläche da, die den Code (noch) nicht kennt — und er sagt genau
  // das, was der Inhaber dann wissen muss: wer die Zahlen hat, und dass es
  // eine einmalige Eintragung ist, kein Ausfall.
  DATEV_MANDANT_FEHLT:
    "Für DATEV fehlen noch Beraternummer und Mandantennummer. Beide bekommen Sie von Ihrem Steuerberater. Sie werden einmal eingetragen danach läuft jeder Export ohne Nachfrage; ohne sie wird keine Datei erzeugt.",
  STORNO_OF_STORNO: "Eine Stornierung kann nicht erneut storniert werden.",
  EXTERNAL_SERVICE_FAILED: "Der externe Dienst hat abgelehnt die Aktion wurde nicht ausgeführt.",
  SERVICE_UNAVAILABLE:
    "Diese Funktion ist derzeit nicht eingerichtet und steht noch nicht zur Verfügung.",
  INTERNAL_ERROR:
    "Es ist ein unerwarteter Serverfehler aufgetreten. Bitte später erneut versuchen.",
}

/**
 * Map ANY thrown error to one themed, actionable German sentence. The single
 * function every surface calls to render a failure — never raw English, never a
 * SCREAMING_SNAKE code, never a fabricated success.
 */
/**
 * Die Stelle an einen Satz hängen, wenn es eine gibt.
 *
 * ── DER BEFUND VOM 09.08.2026 ─────────────────────────────────────────
 *
 * Der Mensch sah die Kennung NIE. `requestId` liegt sauber auf dem
 * Fehlerobjekt, kommt im ganzen Kassenquelltext aber nur viermal vor —
 * alle vier in Vorschau-Attrappen. Im Bausatz null Treffer.
 *
 * Und `code` allein benennt nur die Art: 194 Fehlerklassen des Motors
 * fallen auf 20 Codes zusammen, 139 davon auf drei. „Es kam ein Konflikt"
 * — davon gibt es fünfzig.
 *
 * Die Kennung steht deshalb IM Satz, in Klammern. Kein zweites Feld, kein
 * eigener Kasten: sie soll dort stehen, wo der Mensch ohnehin hinsieht,
 * und am Telefon vorlesbar sein.
 */
function mitStelle(satz: string, err: unknown): string {
  const stelle = err instanceof ApiError ? err.stelle : null
  if (stelle === null || stelle === undefined || stelle === "") return satz
  return `${satz} (${stelle})`
}

/*
 * ⚰️ 18.08.2026: hier stand `beschreibeKursband` samt eigenem Zweig fuer
 * 'IMPLAUSIBLE_PRICE'. Der Code ist mit der Handeingabe des Kurses
 * abgeschafft (lib/kursband.ts geloescht, die Route antwortet 410); der
 * Server kann ihn nie wieder senden, und ein Zweig fuer einen unsendbaren
 * Code ist die Hausklasse "Waechter, der nie feuert".
 */

export function describeError(err: unknown): string {
  return mitStelle(satzOhneStelle(err), err)
}

function satzOhneStelle(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "PIN_LOCKED": {
        // The api-cloud error-handler serializes the 423 lockout as
        // `details.lockedUntil` (an ISO string) with NO Retry-After header.
        // Derive the remaining minutes ourselves; only show the countdown when
        // it's a future instant we can trust.
        const lockedUntil = (err.details as { lockedUntil?: string } | undefined)?.lockedUntil
        const untilMs = lockedUntil ? Date.parse(lockedUntil) : NaN
        const remainingMs = Number.isFinite(untilMs) ? untilMs - Date.now() : NaN
        const mins =
          Number.isFinite(remainingMs) && remainingMs > 0 ? Math.ceil(remainingMs / 60000) : null
        return mins
          ? `PIN gesperrt in ${mins} Min. erneut versuchen.`
          : "PIN gesperrt bitte später erneut versuchen."
      }
      case "UNAUTHORIZED":
        // The PIN-login route raises its 401 messages in ENGLISH — never echo
        // them. `describeUnauthorized` recognises each stable token and answers
        // in German, surfacing the real attempts-remaining count.
        return describeUnauthorized(err)
      case "VALIDATION_ERROR":
        return describeValidationError(err) ?? "Eingabe ungültig bitte die Angaben prüfen."
      case "CONFLICT":
        return describeConflict(err)
      default:
        // DER FUND (26.07.2026): hier stand `return STATIC_ERROR_LINES[err.code]`
        // ohne Rückfall. `err.code` ist als `ApiErrorCode` GETYPT, kommt aber
        // ungeprüft vom Draht — der api-client übernimmt `error.code` aus der
        // Antwort wörtlich. Die Codeliste im api-client ist eine von Hand
        // abgeschriebene Kopie der Serverliste; sobald der Server einen Code
        // bekommt, den diese Kopie noch nicht kennt, greift der Nachschlagesatz
        // ins Leere und die Funktion gab `undefined` zurück, obwohl ihre
        // Signatur `string` verspricht. Der Übersetzer merkt davon nichts.
        // AM TRESEN: an drei Stellen der Kasse wird das Ergebnis in einen Satz
        // eingesetzt (`Eingabe ungültig. ${describeError(err)}`) — dort stand
        // dann wörtlich das Wort „undefined" statt einer Auskunft; anderswo
        // blieb der Fehlerbereich einfach leer, also sah es aus, als sei nichts
        // passiert, während der Vorgang gescheitert war.
        return STATIC_ERROR_LINES[err.code] ?? UNKNOWN_CODE_LINE
    }
  }
  // Transport failures aren't ApiError subclasses, so their `.message` is the
  // raw English string ("Network request failed" / a TimeoutError message) on
  // React Native. Map them to German — distinguishing a timeout (reached the
  // network but didn't answer in time) from a hard offline.
  if (err instanceof ApiNetworkError) {
    const timedOut = (err.cause as { name?: string } | undefined)?.name === "TimeoutError"
    return timedOut
      ? "Zeitüberschreitung der Server antwortet nicht. Bitte erneut versuchen."
      : "Keine Verbindung zum Server. Bitte Internetverbindung prüfen."
  }
  // A non-api error we can't classify. Stay calm and generic — never echo a raw
  // JS Error message, which could be English or a developer string.
  return "Es ist ein Fehler aufgetreten. Bitte erneut versuchen."
}

// ════════════════════════════════════════════════════════════════════════════
// 2 · ENUM-/STATUS-REGISTER — jeder Backend-Token → ein deutsches Label
// ════════════════════════════════════════════════════════════════════════════
//
// Each registry is `Record<TheEnum, string>`, so a backend enum that gains a
// member fails the typecheck here until it has a German label. This is the one
// place a surface should reach for an enum label — never inline a token.

// ── Artikel (Produkt-Status) ─────────────────────────────────────────────────
export const PRODUCT_STATUS_LABEL: Readonly<Record<ProductStatus, string>> = {
  DRAFT: "Entwurf",
  AVAILABLE: "Verfügbar",
  RESERVED: "Reserviert",
  SOLD: "Verkauft",
}

// ── Aufgaben (Status + Priorität) ────────────────────────────────────────────
export const TASK_STATUS_LABEL: Readonly<Record<TaskStatus, string>> = {
  OPEN: "Offen",
  IN_PROGRESS: "In Arbeit",
  BLOCKED: "Blockiert",
  DONE: "Erledigt",
  CANCELLED: "Abgebrochen",
}

export const TASK_PRIORITY_LABEL: Readonly<Record<TaskPriority, string>> = {
  LOW: "Niedrig",
  NORMAL: "Normal",
  HIGH: "Hoch",
  URGENT: "Dringend",
}

// ── Termine (Art + Status + Folgeschritt) ────────────────────────────────────
export const APPOINTMENT_TYPE_LABEL: Readonly<Record<AppointmentType, string>> = {
  VIEWING: "Besichtigung",
  BUYBACK_EVAL: "Ankauf-Bewertung",
  CONSULTATION: "Beratung",
  PICKUP: "Abholung",
}

export const APPOINTMENT_STATUS_LABEL: Readonly<Record<AppointmentStatus, string>> = {
  SCHEDULED: "Geplant",
  CONFIRMED: "Bestätigt",
  CHECKED_IN: "Eingetroffen",
  IN_PROGRESS: "Läuft",
  COMPLETED: "Abgeschlossen",
  NO_SHOW: "Nicht erschienen",
  CANCELLED: "Abgesagt",
  RESCHEDULED: "Verschoben",
}

/** The status an appointment can be advanced TO (the PATCH body's enum). */
export const APPOINTMENT_NEXT_STATUS_LABEL: Readonly<Record<AppointmentPatchStatus, string>> = {
  CONFIRMED: "Bestätigen",
  CHECKED_IN: "Eingetroffen",
  IN_PROGRESS: "Starten",
  COMPLETED: "Abschließen",
  CANCELLED: "Absagen",
  NO_SHOW: "Nicht erschienen",
}

// ── Kunden (KYC-Status + Vertrauensstufe + Sprache) ──────────────────────────
export const CUSTOMER_KYC_STATUS_LABEL: Readonly<Record<CustomerKycStatus, string>> = {
  NOT_REQUIRED: "Nicht erforderlich",
  PENDING: "Ausstehend",
  CAPTURED: "Ausweis erfasst",
  VERIFIED: "Geprüft",
  EXPIRED: "Abgelaufen",
  REJECTED: "Abgelehnt",
}

export const CUSTOMER_TRUST_LEVEL_LABEL: Readonly<Record<CustomerTrustLevel, string>> = {
  NEW: "Neu",
  VERIFIED: "Verifiziert",
  VIP: "VIP",
  SUSPICIOUS: "Beobachten",
  BANNED: "Gesperrt",
}

export const CUSTOMER_LANGUAGE_LABEL: Readonly<Record<CustomerLanguage, string>> = {
  de: "Deutsch",
  en: "Englisch",
  ar: "Arabisch",
}

// ── Team (Rollen) ────────────────────────────────────────────────────────────
export const ACTOR_ROLE_LABEL: Readonly<Record<ActorRole, string>> = {
  ADMIN: "Verwaltung",
  CASHIER: "Kasse",
  READONLY: "Nur Ansicht",
}

// ── Belege (Kategorie) ───────────────────────────────────────────────────────
export const DOCUMENT_CATEGORY_LABEL: Readonly<Record<DocumentCategory, string>> = {
  AUSWEIS: "Ausweis",
  ANKAUFBELEG: "Ankaufbeleg",
  RECHNUNG: "Rechnung",
  EXPERTISE: "Expertise",
  ZERTIFIKAT: "Zertifikat",
  VERSANDBELEG: "Versandbeleg",
}




// ── Geldwege (Richtung + Zahlart) ────────────────────────────────────────────
export const TRANSACTION_DIRECTION_LABEL: Readonly<Record<TransactionDirection, string>> = {
  VERKAUF: "Verkauf",
  ANKAUF: "Ankauf",
}

export const PAYMENT_METHOD_LABEL: Readonly<Record<PaymentMethod, string>> = {
  CASH: "Bar",
  ZVT_CARD: "Kartenzahlung",
  SUMUP: "SumUp",
  MOLLIE: "Mollie",
  STRIPE: "Stripe",
  EBAY: "eBay",
  BANK_TRANSFER: "Überweisung",
  VOUCHER: "Gutschein",
  // Der Leser am Ladentisch (26.07.2026). Unterscheidbar vom ZVT-Terminal
  // ("Kartenzahlung") und vom Web-Shop ("Stripe").
  STRIPE_TERMINAL: "Kartenzahlung Stripe-Leser",
}

export const ANKAUF_PAYOUT_METHOD_LABEL: Readonly<Record<AnkaufPayoutMethod, string>> = {
  CASH: "Barauszahlung",
  BANK_TRANSFER: "Überweisung",
}

/**
 * Der Zustand eines Gutscheins, in Worten für den Tresen.
 *
 * ── DER BEFUND VOM 12.08.2026 ────────────────────────────────────────────
 *
 * `VoucherField.tsx` setzte den Zustand ROH in den Satz: wer einen
 * abgelaufenen Gutschein einlöste, las am Tresen wörtlich „Gutschein ist
 * EXPIRED." — ein englisches Schreikappen-Wort aus der Leitung, mitten in
 * einem deutschen Satz, vor dem Kunden. Nur `REDEEMED` war von Hand
 * übersetzt; die beiden anderen fielen durch.
 *
 * Deshalb steht das Vokabular jetzt HIER, bei den übrigen Aufzählungen, und
 * nicht als Sonderfall in einer Fläche: die nächste Fläche, die einen
 * Gutscheinzustand zeigt, findet die Wörter vor.
 *
 * Die Sätze sagen zusätzlich, WAS los ist, nicht nur wie der Zustand heisst
 * — „gesperrt" allein liesse den Kassierer raten, ob er etwas falsch
 * gemacht hat.
 */
export const VOUCHER_STATUS_LABEL: Readonly<Record<string, string>> = {
  ACTIVE: "gültig",
  REDEEMED: "bereits eingelöst",
  EXPIRED: "abgelaufen",
  REVOKED: "gesperrt",
}

/**
 * Was der Kassierer liest, wenn ein Gutschein nicht einlösbar ist.
 *
 * Ein unbekannter Zustand bekommt bewusst KEINE erfundene Erklärung: dann
 * steht da, dass dieser Gutschein sich nicht einlösen lässt, und der
 * Kassierer holt den Inhaber. Das ist ehrlicher als ein geratener Grund.
 */
export function gutscheinZustandSatz(status: string): string {
  const wort = VOUCHER_STATUS_LABEL[status]
  return wort === undefined
    ? "Dieser Gutschein lässt sich nicht einlösen."
    : `Dieser Gutschein ist ${wort}.`
}

// ── Ankauf (Artikelart + Edelmetall + Zustand) ───────────────────────────────
export const ANKAUF_ITEM_TYPE_LABEL: Readonly<Record<AnkaufItemType, string>> = {
  gold_jewelry: "Goldschmuck",
  gold_coin: "Goldmünze",
  gold_bar: "Goldbarren",
  silver_jewelry: "Silberschmuck",
  silver_coin: "Silbermünze",
  silver_bar: "Silberbarren",
  platinum_jewelry: "Platinschmuck",
  platinum_coin: "Platinmünze",
  platinum_bar: "Platinbarren",
  antique: "Antiquität",
  watch: "Uhr",
  other: "Sonstiges",
}

export const ANKAUF_METAL_LABEL: Readonly<Record<AnkaufMetal, string>> = {
  gold: "Gold",
  silver: "Silber",
  platinum: "Platin",
  palladium: "Palladium",
}

export const ANKAUF_CONDITION_LABEL: Readonly<Record<AnkaufCondition, string>> = {
  NEW: "Neu",
  USED_EXCELLENT: "Gebraucht sehr gut",
  USED_GOOD: "Gebraucht gut",
  USED_FAIR: "Gebraucht mäßig",
  ANTIQUE_RESTORED: "Antik restauriert",
  ANTIQUE_AS_FOUND: "Antik Fundzustand",
}

// ── Steuer (Besteuerungsart + Belegtext-Art) ─────────────────────────────────
export const TAX_TREATMENT_LABEL: Readonly<Record<TaxTreatmentCode, string>> = {
  MARGIN_25A: "Differenzbesteuerung (§25a)",
  STANDARD_19: "Standard 19 %",
  REDUCED_7: "Ermäßigt 7 %",
  INVESTMENT_GOLD_25C: "Anlagegold (§25c)",
  MIXED: "Gemischt",
  REVERSE_CHARGE_13B: "Reverse-Charge (§13b)",
}

export const BELEGTEXT_KIND_LABEL: Readonly<Record<BelegtextKind, string>> = {
  MARGIN_25A: "Differenzbesteuerung (§25a)",
  STANDARD_19: "Standard 19 %",
  REDUCED_7: "Ermäßigt 7 %",
  INVESTMENT_GOLD_25C: "Anlagegold (§25c)",
  KLEINUNTERNEHMER_19: "Kleinunternehmer (§19)",
  ANKAUFBELEG_DECLARATION: "Ankaufbeleg-Erklärung",
  GENERIC_HEADER: "Allgemeiner Kopftext",
  GENERIC_FOOTER: "Allgemeiner Fußtext",
  REVERSE_CHARGE_13B: "Reverse-Charge (§13b)",
}

// ── Tagesabschluss-Status (COUNTING | FINALIZED) ─────────────────────────────
// Der Z-Bon-Zustand: „Offen" während der Zählung, „Abgeschlossen" sobald der
// Tagesabschluss fiskalisch versiegelt ist. Lives in the shared spine so the
// audit vocabulary and both apps read the same word for the same state.
export type ClosingState = ClosingListItem["state"]

export const CLOSING_STATE_LABELS: Readonly<Record<ClosingState, string>> = {
  COUNTING: "Offen",
  FINALIZED: "Abgeschlossen",
}

// ════════════════════════════════════════════════════════════════════════════
// 3 · Sichere Nachschlage-Helfer (für Werte, die zur Laufzeit unbekannt sein
//     können — z. B. ein Status aus einem rohen Ledger-Event-String)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Look a value up in a label registry, returning a clean fallback rather than
 * the raw token if the value is somehow unknown at runtime (e.g. a new enum
 * member arrives from a newer backend than this build expects). NEVER returns
 * the raw SCREAMING_SNAKE token — the operator sees "Unbekannt", not a leak.
 */
export function germanLabel<K extends string>(
  registry: Readonly<Record<K, string>>,
  value: string,
  fallback = "Unbekannt",
): string {
  return (registry as Record<string, string | undefined>)[value] ?? fallback
}

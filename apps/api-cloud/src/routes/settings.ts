/**
 * Settings endpoints (Owner Control Desktop — Einstellungen surface).
 *
 *   GET   /api/settings       — ADMIN: read snapshot of tunables + device fleet.
 *   PATCH /api/settings/:key  — ADMIN: change one operator-tunable.
 *
 * `system_settings` holds the operator-tunable knobs (anomaly Z-score, AI
 * budget caps, smurfing/KYC thresholds, cash-drawer variance, …) and the
 * paired `devices` fleet (POS terminals, control desktops, workers) with cert
 * headroom. The PATCH path guards every change behind a curated allow-list with
 * per-key range validation — an unknown or non-editable key is refused (no
 * arbitrary writes) — and records the actor to audit_log. Device revocation
 * (mTLS cert) stays out of scope here: it is a security-sensitive operation
 * without an endpoint yet, so the fleet remains read-only.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog } from '@norns/db/schema';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import {
  KONTENRAHMEN,
  type KontenrahmenId,
  PLATZHALTER_SCHLUESSEL,
  istDatevSchluessel,
  ladeKontenplan,
  ladeMandantEinstellungen,
  normalisiereRahmen,
  pruefeDatevEinstellung,
} from '../lib/kontenrahmen.js';
import {
  FXQUELLEN_KENNUNGEN,
  METALLQUELLEN_KENNUNGEN,
  SCHLUESSEL_FXQUELLE,
  SCHLUESSEL_METALLQUELLE,
} from '../lib/kursquellen.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

/**
 * The curated set of operator-tunable settings the Owner Desktop may write.
 * Anything outside this map is refused — `system_settings` also stores
 * worker-populated rows (lbma.latest_fix) and shapes we must not clobber.
 *
 * `kind` mirrors the stored jsonb shape so we round-trip it faithfully:
 *   • 'number' → a bare JSON number  ('3.0'::jsonb)
 *   • 'money'  → a JSON string with 2 decimals  ('"5.00"'::jsonb)
 *   • 'text'   → a free JSON string  ('"WAREHOUSE 14"'::jsonb), max `maxLen`
 *   • 'auswahl' → a JSON string aus einer GESCHLOSSENEN Liste
 *
 * ── WARUM ES 'auswahl' GIBT (01.08.2026) ───────────────────────────────────
 *
 * `steuer.modus` kennt genau zwei Werte, und `transactions-finalize.ts` liest
 * ihn bei JEDEM Verkauf. Als freien Text zu speichern hiesse: ein Tippfehler
 * („REGELBESTEURUNG") wird angenommen, und ab da scheitert jeder Verkauf mit
 * einer Meldung, die auf das falsche Problem zeigt. Eine geschlossene Liste
 * lehnt den Tippfehler dort ab, wo er entsteht.
 */
type EditableKind = 'number' | 'money' | 'text' | 'auswahl';
interface EditableSetting {
  kind: EditableKind;
  /** number/money: numeric bounds. text/auswahl: ignoriert. */
  min: number;
  max: number;
  /** text only: max characters (default 200). */
  maxLen?: number;
  /** auswahl only: die einzigen erlaubten Werte. */
  werte?: readonly string[];
  /**
   * text only: die verlangte FORM, etwa ein Datum. Ohne Muster ist jeder
   * Text bis `maxLen` erlaubt.
   */
  muster?: { regex: RegExp; wie: string };
  /** German one-liner shown if the value is invalid. */
  label: string;
}
const EDITABLE_SETTINGS: Record<string, EditableSetting> = {
  'anomaly.sigma_threshold': {
    kind: 'number',
    min: 2.0,
    max: 4.0,
    label: 'Z-Wert-Schwelle (2,0–4,0)',
  },
  // 19.08.2026: hier standen drei Budget-Regler des ausgebauten
  // Kanal-Erbes (Wanderung 0149 raeumt auch ihre Saat aus system_settings).
  'appointment.no_show_grace_minutes': {
    kind: 'number',
    min: 0,
    max: 240,
    label: 'Kulanz bis No-Show (Min.)',
  },
  'smurfing.ankauf_count_window_days': {
    kind: 'number',
    min: 1,
    max: 90,
    label: 'Smurfing-Fenster (Tage)',
  },
  'smurfing.ankauf_count_threshold': {
    kind: 'number',
    min: 1,
    max: 20,
    label: 'Smurfing-Anzahl-Schwelle',
  },
  'cash_drawer.variance_alert_threshold_eur': {
    kind: 'money',
    min: 0,
    max: 1_000,
    label: 'Kassendifferenz-Schwelle',
  },
  // Shop identity printed on the receipt header (migration 0044).
  'shop.name': { kind: 'text', min: 0, max: 0, maxLen: 80, label: 'Geschäftsname' },
  'shop.tagline': { kind: 'text', min: 0, max: 0, maxLen: 80, label: 'Slogan' },
  'shop.address_line1': { kind: 'text', min: 0, max: 0, maxLen: 100, label: 'Adresse Zeile 1' },
  'shop.address_line2': { kind: 'text', min: 0, max: 0, maxLen: 100, label: 'Adresse Zeile 2' },
  'shop.vat_id': { kind: 'text', min: 0, max: 0, maxLen: 20, label: 'USt-IdNr.' },
  // § 14 Abs. 4 Nr. 2 UStG lässt Steuernummer ODER USt-IdNr. zu. Ein Betrieb
  // ohne USt-IdNr. konnte vorher gar keinen Beleg drucken.
  'shop.tax_number': { kind: 'text', min: 0, max: 0, maxLen: 25, label: 'Steuernummer' },

  // ── DER UMSATZSTEUER-STATUS DES BETRIEBS (01.08.2026) ────────────────────
  //
  // Diese zwei Schlüssel fehlten in der Positivliste, während
  // `transactions-finalize.ts:269` sie bei JEDEM Verkauf liest. Sie standen
  // in der Erstsaat auf Romans Werten vorbelegt, und kein Händler konnte sie
  // ändern: nicht über diese Route, nicht über eine Maske.
  //
  // Die Saat liefert sie jetzt LEER aus. `lib/steuermodus.ts` behandelt leer
  // ausdrücklich als „nie beantwortet" und verweigert den Verkauf, statt
  // Regelbesteuerung zu vermuten. Damit das kein Sackgassenzustand ist,
  // müssen sie HIER schreibbar sein.
  /**
   * Der Geschäftsvorfalltyp für den Ankauf von Privat.
   *
   * ⚠️ Ohne diesen Eintrag bricht das DSFinV-K-Paket beim ERSTEN Ankaufbeleg
   * ab. Für einen Edelmetallhändler ist der Ankauf von Privat das halbe
   * Geschäft, also scheitert fast jeder Tag — und der Händler hatte bis zum
   * 02.08.2026 keinen Ort, an dem er die Frage hätte beantworten können.
   *
   * Die Werte sind die amtlichen aus Anhang C. „Einkauf", was der alte
   * Erzeuger schrieb, steht ABSICHTLICH nicht dabei: es kommt im ganzen
   * Normtext null Mal vor. Welcher der amtlichen Werte gilt, ist eine
   * Auslegung und gehört dem Steuerberater — deshalb eine Frage, keine
   * Vorgabe.
   */
  'dsfinvk.gv_typ.ankauf': {
    kind: 'auswahl',
    min: 0,
    max: 0,
    werte: ['', 'Auszahlung', 'Privatentnahme', 'Umsatz'],
    label: 'DSFinV-K: Geschäftsvorfall beim Ankauf von Privat',
  },
  /**
   * Die Umsatzsteuerschlüssel des Steuerberaters, je Steuerbehandlung.
   *
   * ── DER FUND VOM 02.08.2026 ────────────────────────────────────────────
   *
   * `closing-export.ts:1496` liest `dsfinvk.ust_schluessel.<code>`, und
   * `ustSchluesselFuer` bricht den GANZEN Export ab, wenn der Schlüssel für
   * eine offene Behandlung fehlt. Offen sind § 25a (Differenzbesteuerung) und
   * § 13b (Reverse-Charge).
   *
   * ⚠️ Geschrieben wurde dieser Schlüssel NIRGENDS: nicht in dieser Liste,
   * nicht in einer Wanderung, nicht in einer Saat, in keiner Fläche. Die
   * Fehlermeldung schickte den Menschen „unter Einstellungen, Steuer" an
   * einen Ort, den es nicht gab.
   *
   * Für einen Edelmetallhändler ist § 25a der Regelfall. Damit war der
   * Prüferknopf dauerhaft zu, und zwar mit einer Absage, die einen Ausweg
   * versprach.
   *
   * ⚠️ RICHTIGGESTELLT am 12.08.2026: der Wert ist KEINE Kontonummer aus dem
   * Kontenrahmen (so stand es hier bis heute), sondern die ID des Feldes
   * UST-SCHLUESSEL der DSFinV-K. Amtlich (Anlage 2 vom 05.12.2024 und
   * Tz. 3.2.6, Seite 27): die IDs bis 999 gehören der Norm, AB 1000 legt das
   * Haus eigene Nummern für genau solche Fälle an (§ 25a und § 13b werden
   * dort wörtlich als Beispiele genannt) und hält sie in der
   * Verfahrensdokumentation fest. Hausstandard (Basel, 12.08.2026): 1001 für
   * § 25a, 1002 für § 13b — die Fläche zeigt sie als VORSCHLAG, gespeichert
   * wird erst durch den Menschen.
   */
  'dsfinvk.ust_schluessel.margin_25a': {
    kind: 'text',
    min: 0,
    max: 0,
    maxLen: 16,
    muster: { regex: /^\d{1,16}$/, wie: 'Nur Ziffern. Eigene Nummern beginnen amtlich ab 1000.' },
    label: 'Umsatzsteuerschlüssel für § 25a (Differenzbesteuerung)',
  },
  'dsfinvk.ust_schluessel.reverse_charge_13b': {
    kind: 'text',
    min: 0,
    max: 0,
    maxLen: 16,
    muster: { regex: /^\d{1,16}$/, wie: 'Nur Ziffern. Eigene Nummern beginnen amtlich ab 1000.' },
    label: 'Umsatzsteuerschlüssel für § 13b (Reverse-Charge)',
  },
  /**
   * Prozentsatz und Beschriftung je eigenem Schlüssel.
   *
   * ── DER FUND (Bericht 05.08.2026, Zeilen 677 und 692) ────────────────────
   * `closing-export.ts` LIEST `dsfinvk.ust_satz.*` und
   * `dsfinvk.ust_beschreibung.*` für die `vat.csv` — aber KEIN Weg konnte sie
   * je schreiben: sie fehlten in dieser Positivliste, in jeder Saat und in
   * jeder Fläche. Die Spalten UST-SATZ und UST-BESCHR blieben deshalb bei
   * jedem eigenen Schlüssel für immer leer. Eine Tabelle, die gelesen und nie
   * gefüllt wird — die bekannte Hauskrankheit, hier in der Gegenrichtung
   * geschlossen.
   *
   * Zum Satz bei § 25a: die Steuer rechnet NUR auf die Marge und darf auf dem
   * Beleg nicht offen ausgewiesen werden (§ 14a Abs. 6 Satz 2 UStG); die
   * 19,00 ist die Rechengrösse der Norm, kein offener Ausweis. Bei § 13b
   * schuldet der Empfänger die Steuer, der Satz der Kasse ist 0,00.
   */
  'dsfinvk.ust_satz.margin_25a': {
    kind: 'text',
    min: 0,
    max: 0,
    maxLen: 6,
    muster: { regex: /^\d{1,3}\.\d{2}$/, wie: 'Prozentsatz mit Punkt und zwei Stellen, z. B. 19.00' },
    label: 'UST-SATZ für § 25a (Rechengrösse der Marge)',
  },
  'dsfinvk.ust_satz.reverse_charge_13b': {
    kind: 'text',
    min: 0,
    max: 0,
    maxLen: 6,
    muster: { regex: /^\d{1,3}\.\d{2}$/, wie: 'Prozentsatz mit Punkt und zwei Stellen, z. B. 0.00' },
    label: 'UST-SATZ für § 13b (Steuerschuld beim Empfänger)',
  },
  'dsfinvk.ust_beschreibung.margin_25a': {
    kind: 'text',
    min: 0,
    max: 0,
    maxLen: 55,
    label: 'UST-BESCHR für § 25a (liest das Finanzamt)',
  },
  'dsfinvk.ust_beschreibung.reverse_charge_13b': {
    kind: 'text',
    min: 0,
    max: 0,
    maxLen: 55,
    label: 'UST-BESCHR für § 13b (liest das Finanzamt)',
  },
  // 14.08.2026: hier stand `betrieb.online_kanaele` (Kundenshop, Abholung,
  // Versand). Der Kundenshop ist mit der Trennung von warehouse14 gefallen,
  // seine Wege existieren nicht mehr, der Schalter hatte nichts mehr zu
  // schalten. Ein bereits gespeicherter Wert in `settings` bleibt harmlos
  // liegen und wird von niemandem gelesen.
  /**
   * ── Die Modulschalter (14.08.2026, Basels Entscheidung) ──────────────────
   *
   * Der Kern nimmt NICHT an, dass der Haendler Edelmetall verkauft. Die
   * Goldkunde (Kursleiste, Waage) bleibt vollstaendig im Code und wird hier
   * je Betrieb ein- oder ausgeschaltet, nie amputiert. Vorgabe ist AN, denn
   * die heutigen Kunden sind Juweliere. Leer gilt als AN.
   *
   * ⚠️ Jeder Schalter hat einen ECHTEN Leser in der Flaeche (MetalTicker,
   * Waagen-Block). Ein Schalter ohne Leser waere die Hausklasse
   * „Schalter ohne Ausgang" und darf hier nicht eingetragen werden.
   */
  'modul.kursleiste': {
    kind: 'auswahl',
    min: 0,
    max: 0,
    werte: ['AN', 'AUS'],
    label: 'Metallkurs-Leiste am oberen Rand',
  },
  'modul.waage': {
    kind: 'auswahl',
    min: 0,
    max: 0,
    werte: ['AN', 'AUS'],
    label: 'Waage (Wiegen im Ankauf, Geraete-Einrichtung)',
  },
  /**
   * Woher der Metallkurs kommt.
   *
   * Basels Anweisung vom 02.08.2026: der Inhaber soll die Quelle wählen und
   * wechseln können. Die angebotenen Quellen wurden mit echten Abrufen
   * geprüft und brauchen keinen Schlüssel; die Messungen stehen in
   * `lib/kursquellen.ts`.
   *
   * ⚰️ 18.08.2026: 'HAND' („ohne Netz von Hand eintragen", ebenfalls 02.08)
   * ist abgeschafft — Basels neue Anweisung hebt die alte auf, ein Goldpreis
   * wird nicht mehr von Hand eingetragen. Weil `werte` aus
   * METALLQUELLEN_KENNUNGEN kommt, weist dieser Weg einen NEUEN Schreibversuch
   * von 'HAND' seither von selbst ab; ein gespeicherter Altwert wird im
   * Beipack-Dienst laut übergangen.
   */
  [SCHLUESSEL_METALLQUELLE]: {
    kind: 'auswahl',
    min: 0,
    max: 0,
    werte: METALLQUELLEN_KENNUNGEN,
    label: 'Herkunft der Metallkurse',
  },
  [SCHLUESSEL_FXQUELLE]: {
    kind: 'auswahl',
    min: 0,
    max: 0,
    werte: FXQUELLEN_KENNUNGEN,
    label: 'Herkunft des Dollarkurses',
  },
  'steuer.modus': {
    kind: 'auswahl',
    min: 0,
    max: 0,
    werte: ['REGELBESTEUERUNG', 'KLEINUNTERNEHMER_19'],
    label: 'Umsatzsteuer-Status',
  },
  'steuer.modus_gilt_ab': {
    kind: 'text',
    min: 0,
    max: 0,
    maxLen: 10,
    muster: { regex: /^\d{4}-\d{2}-\d{2}$/, wie: 'Datum in der Form JJJJ-MM-TT.' },
    label: 'Umsatzsteuer-Status gilt ab',
  },
  'shop.phone': { kind: 'text', min: 0, max: 0, maxLen: 32, label: 'Telefon' },
  // Die Stammdaten des Steuerpflichtigen (Wanderung 0126, KOORDINATION §11.5).
  // Hier öffnet sich nur das FACH — ob die Angaben für ein Prüferpaket
  // GENÜGEN, entscheidet allein `lib/haendler-stammdaten.ts` beim Export.
  // Leer speichern ist erlaubt: leer sperrt dort mit ehrlicher Meldung,
  // ein erzwungener Platzhalter hier ergäbe ein Paket, das vollständig
  // aussieht und falsch ist.
  'shop.legal_name': { kind: 'text', min: 0, max: 0, maxLen: 120, label: 'Firmenname (rechtlich)' },
  'shop.street': { kind: 'text', min: 0, max: 0, maxLen: 100, label: 'Straße und Hausnummer' },
  'shop.postal_code': { kind: 'text', min: 0, max: 0, maxLen: 10, label: 'Postleitzahl' },
  'shop.city': { kind: 'text', min: 0, max: 0, maxLen: 80, label: 'Ort' },
  'shop.country_code': { kind: 'text', min: 0, max: 0, maxLen: 3, label: 'Länderkennzeichen' },
  'kasse.seriennummer': { kind: 'text', min: 0, max: 0, maxLen: 60, label: 'Seriennummer der Kasse' },

  // ── DIE VIER FÄCHER DER VERFAHRENSDOKUMENTATION (11.08.2026) ─────────────
  //
  // ── DER BEFUND ─────────────────────────────────────────────────────────
  // Wanderung 0134 legte diese vier Fächer an, `verfahrensdokumentation.ts`
  // liest sie, und der vierte Schritt des Einrichtungsassistenten fragt drei
  // davon ab. Nur schreiben konnte sie NIEMAND: sie fehlten in dieser
  // Positivliste, und `PATCH /api/settings/:key` antwortete auf jedes der
  // drei Felder mit HTTP 400 („is not editable from the Owner Desktop").
  //
  // Weil der Assistent bei einem Fehler abbricht, kam der Händler an dieser
  // Stelle nicht weiter — beim ersten Fenster, in dem er der Kasse vertraut.
  //
  // ── WARUM DER NAHELIEGENDE WEG FALSCH WÄRE ─────────────────────────────
  // Die Felder aus dem Assistenten zu streichen wäre die kleinere Änderung
  // und die schlechtere: die Angaben sind echt (Rz. 21 GoBD, § 7 GwG,
  // § 147 Abs. 1 AO), die Fächer existieren, das Dokument liest sie. Es
  // fehlte allein die Tür.
  //
  // ⚠️ LEER bleibt ausdrücklich erlaubt. Wer keinen Geldwäschebeauftragten
  // bestellt hat, lässt das Feld leer; die Verfahrensdokumentation weist die
  // Stelle dann sichtbar als offen aus. Ein erzwungener Wert benennte den
  // falschen Menschen und sähe vollständig aus.
  'betrieb.verantwortlich_aufzeichnungen': {
    kind: 'text',
    min: 0,
    max: 0,
    maxLen: 120,
    label: 'Verantwortlich für die Aufzeichnungen',
  },
  'betrieb.geldwaeschebeauftragter': {
    kind: 'text',
    min: 0,
    max: 0,
    maxLen: 120,
    label: 'Geldwäschebeauftragter nach § 7 GwG',
  },
  'betrieb.sicherungsort': {
    kind: 'text',
    min: 0,
    max: 0,
    maxLen: 200,
    label: 'Ort der Sicherungskopien',
  },
  // Bei einer Kassennachschau nach § 146b AO eine der ersten Fragen. Dasselbe
  // Fach aus 0134, dieselbe geschlossene Tür — deshalb hier mit.
  'betrieb.inbetriebnahme_am': {
    kind: 'text',
    min: 0,
    max: 0,
    maxLen: 10,
    muster: { regex: /^\d{4}-\d{2}-\d{2}$/, wie: 'Datum in der Form JJJJ-MM-TT.' },
    label: 'Inbetriebnahme dieser Kasse am',
  },
};

class SettingNotEditableError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}
class SettingRangeError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}
class SettingNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

const SettingItem = Type.Object({
  key: Type.String(),
  value: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  updatedAt: Type.String({ format: 'date-time' }),
});

const DeviceItem = Type.Object({
  id: Type.String({ format: 'uuid' }),
  deviceClass: Type.String(),
  status: Type.String(),
  certExpiresAt: Type.String({ format: 'date-time' }),
  lastSeenAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});

const SettingsResponse = Type.Object({
  settings: Type.Array(SettingItem),
  devices: Type.Array(DeviceItem),
});

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const UpdateSettingParams = Type.Object({ key: Type.String({ minLength: 1, maxLength: 120 }) });
const UpdateSettingBody = Type.Object({
  /**
   * New value. Number/money keys take a number; text keys take a string.
   *
   * ⚠️ Bewusst `Unknown`, nicht `Union([Number, String])`: Fastifys ajv
   * läuft mit Typ-Zwang, und gegen die Union wurde eine REIN NUMERISCHE
   * Zeichenkette („73614") in eine Zahl gezwungen, BEVOR der Handler sie
   * sah — der Text-Zweig lehnte dann jede Postleitzahl, jede nur-Ziffern-
   * Telefonnummer ab („Text erforderlich"). Der Handler unten prüft je
   * Schlüsselart selbst (Text: String + Höchstlänge; Zahl: Number + Spanne)
   * und behält dabei führende Nullen, die eine Zwangs-Zahl verlöre.
   * Beweis: tests/integration/stammdaten-maske-oeffnet-die-faecher.test.ts.
   */
  value: Type.Unknown(),
});
const UpdateSettingResponse = Type.Object({
  key: Type.String(),
  value: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  updatedAt: Type.String({ format: 'date-time' }),
});
type TUpdateSettingParams = { key: string };
type TUpdateSettingBody = { value: unknown };

type SettingRow = { key: string; value: string; description: string | null; updated_at: Date };
type DeviceRow = {
  id: string;
  device_class: string;
  status: string;
  cert_expires_at: Date;
  last_seen_at: Date | null;
};

// ────────────────────────────────────────────────────────────────────
//  Der DATEV-Kontenrahmen als Oberfläche
//
//  GET   /api/settings/datev       — alles lesen, MIT dem Merkmal
//                                    „Vorschlag oder bestätigt".
//  PATCH /api/settings/datev/:key  — genau eine Angabe ändern.
//
//  Getrennt vom allgemeinen PATCH oben, aus einem Grund: dort wird
//  ausschliesslich UPDATE gefahren, weil jeder erlaubte Schlüssel schon eine
//  Zeile hat. Die Kontenschlüssel haben KEINE — solange niemand etwas
//  geändert hat, gilt die Vorlage, und es soll auch keine Zeile geben, denn
//  das blosse Vorhandensein der Zeile IST hier das Merkmal „bestätigt".
//  Dieser Weg schreibt deshalb einfügend-oder-ändernd.
// ────────────────────────────────────────────────────────────────────

const DatevRahmen = Type.Object({
  id: Type.String(),
  label: Type.String(),
  aktiv: Type.Boolean(),
});

const DatevMandantFeld = Type.Object({
  schluessel: Type.String(),
  label: Type.String(),
  hinweis: Type.String(),
  art: Type.String(),
  wert: Type.Union([Type.String(), Type.Null()]),
  /** VORSCHLAG | BESTAETIGT | FEHLT */
  herkunft: Type.String(),
});

const DatevKonto = Type.Object({
  schluessel: Type.String(),
  konto: Type.String(),
  label: Type.String(),
  zweck: Type.String(),
  wert: Type.String(),
  vorlagewert: Type.String(),
  /** VORSCHLAG | BESTAETIGT */
  herkunft: Type.String(),
  quelle: Type.String(),
});

const DatevSettingsResponse = Type.Object({
  rahmen: Type.String(),
  verfuegbareRahmen: Type.Array(DatevRahmen),
  mandant: Type.Array(DatevMandantFeld),
  konten: Type.Array(DatevKonto),
});

const DatevUpdateBody = Type.Object({
  value: Type.Union([Type.Number(), Type.String({ maxLength: 40 }), Type.Boolean()]),
});
const DatevUpdateResponse = Type.Object({
  schluessel: Type.String(),
  wert: Type.String(),
  herkunft: Type.String(),
});

const RAHMEN_LABEL: Record<KontenrahmenId, string> = {
  SKR03: 'SKR03, nach Geschäftsprozessen geordnet',
  SKR04: 'SKR04, nach der Gliederung des Jahresabschlusses geordnet',
};

const settingsRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/settings',
    {
      schema: {
        tags: ['settings'],
        summary: 'Read system settings + paired device fleet (ADMIN).',
        description: 'Read-only snapshot of system_settings tunables and the devices table.',
        response: { 200: SettingsResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const settingRows = (await app.db.execute<SettingRow>(sql`
        SELECT key, value::text AS value, description, updated_at
          FROM system_settings
         ORDER BY key ASC
      `)) as unknown as SettingRow[];

      const deviceRows = (await app.db.execute<DeviceRow>(sql`
        SELECT id::text AS id, device_class::text AS device_class, status::text AS status,
               cert_expires_at, last_seen_at
          FROM devices
         ORDER BY paired_at DESC
      `)) as unknown as DeviceRow[];

      return reply.status(200).send({
        settings: settingRows.map((r) => ({
          key: r.key,
          value: r.value,
          description: r.description,
          updatedAt: new Date(r.updated_at).toISOString(),
        })),
        devices: deviceRows.map((r) => ({
          id: r.id,
          deviceClass: r.device_class,
          status: r.status,
          certExpiresAt: new Date(r.cert_expires_at).toISOString(),
          lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
        })),
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // PATCH /api/settings/:key — change one operator-tunable (ADMIN).
  // ────────────────────────────────────────────────────────────────────
  app.patch<{ Params: TUpdateSettingParams; Body: TUpdateSettingBody }>(
    '/api/settings/:key',
    {
      schema: {
        tags: ['settings'],
        summary: 'Change one operator-tunable setting (ADMIN).',
        description:
          'Writes one allow-listed key in system_settings after range validation. ' +
          'Records the actor to audit_log. Unknown / non-editable keys are refused.',
        params: UpdateSettingParams,
        body: UpdateSettingBody,
        response: {
          200: UpdateSettingResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const { key } = req.params;
      const spec = EDITABLE_SETTINGS[key];
      if (!spec) {
        throw new SettingNotEditableError(
          `Setting "${key}" is not editable from the Owner Desktop.`,
        );
      }

      const { value } = req.body;

      // Round-trip the stored jsonb shape from a BOUND parameter (never
      // string-concatenated jsonb): number → bare JSON number, money →
      // 2-decimal JSON string, text → free JSON string.
      let jsonbValue: ReturnType<typeof sql>;
      if (spec.kind === 'auswahl') {
        const erlaubt = spec.werte ?? [];
        if (typeof value !== 'string' || !erlaubt.includes(value)) {
          throw new SettingRangeError(
            `${spec.label}: nur einer von ${erlaubt.join(' oder ')}.`,
          );
        }
        jsonbValue = sql`to_jsonb(${value}::text)`;
      } else if (spec.kind === 'text') {
        if (typeof value !== 'string') {
          throw new SettingRangeError(`${spec.label}: Text erforderlich.`);
        }
        const maxLen = spec.maxLen ?? 200;
        if (value.length > maxLen) {
          throw new SettingRangeError(`${spec.label}: höchstens ${maxLen} Zeichen.`);
        }
        // Ein Muster gilt nur für einen NICHT leeren Wert: leer heisst „noch
        // nicht beantwortet", und das muss man speichern dürfen.
        if (spec.muster && value !== '' && !spec.muster.regex.test(value)) {
          throw new SettingRangeError(`${spec.label}: ${spec.muster.wie}`);
        }
        jsonbValue = sql`to_jsonb(${value}::text)`;
      } else {
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < spec.min ||
          value > spec.max
        ) {
          throw new SettingRangeError(
            `${spec.label}: Wert muss zwischen ${spec.min} und ${spec.max} liegen.`,
          );
        }
        jsonbValue =
          spec.kind === 'money'
            ? sql`to_jsonb(${value.toFixed(2)}::text)`
            : sql`to_jsonb(${value}::numeric)`;
      }

      // P1.5 — the value change + the rich-context audit row commit together in
      // ONE transaction. Previously the UPDATE committed, then the audit insert
      // ran as a separate statement; a crash or transient pool error between
      // them left the tunable changed with NO device/IP/user-agent audit row.
      // (The DB trigger's minimal audit row already commits with the UPDATE; this
      // makes the route's richer row equally atomic.)
      const row = await app.db.transaction(async (txAny) => {
        const tx = txAny as unknown as typeof app.db;
        // Capture the prior value in the SAME statement as the write (a CTE over
        // the pre-write row) so the audit delta is atomic — no read-then-write
        // race. `old_value` is the jsonb text BEFORE this write applied, and it
        // is NULL when the key had no row yet.
        //
        // ⚠️ 02.08.2026: hier stand ein reines UPDATE, und das war eine SPERRE
        // OHNE AUSGANG. Ein Schlüssel der Positivliste, für den keine Zeile
        // gesät war, liess sich NIE setzen: das UPDATE traf null Zeilen, und
        // die Route antwortete 404 mit dem englischen Satz
        // `Setting "…" not found.`. Getroffen hat es genau die Schlüssel, die
        // eine fiskalische Sperre öffnen sollen — `dsfinvk.gv_typ.ankauf`
        // (ohne ihn bricht jeder Export mit einem Ankaufbeleg ab) und
        // `steuer.modus` (ohne ihn kein Verkauf). Der Mensch las „bitte in den
        // Einstellungen eintragen", ging dorthin, und die Eingabe wurde
        // abgewiesen.
        //
        // Die Positivliste IST die Erlaubnis. Steht ein Schlüssel dort, darf er
        // gesetzt werden, ob eine Saatzeile existiert oder nicht. Deshalb ein
        // UPSERT. Der Prüfstempel bleibt vollständig: der Auslöser
        // `trg_system_settings_audit` feuert auf `AFTER INSERT OR UPDATE OF
        // value`, also auch beim ersten Setzen.
        const updated = (await tx.execute<SettingRow & { old_value: string | null }>(sql`
          WITH prev AS (
            SELECT key, value::text AS old_value FROM system_settings WHERE key = ${key}
          )
          INSERT INTO system_settings AS s (key, value, description)
          VALUES (${key}, ${jsonbValue}, ${spec.label})
          ON CONFLICT (key) DO UPDATE
             SET value = ${jsonbValue}, updated_at = now()
          RETURNING s.key, s.value::text AS value,
                    (SELECT old_value FROM prev) AS old_value,
                    s.description, s.updated_at
        `)) as unknown as (SettingRow & { old_value: string | null })[];

        const r = updated[0];
        if (!r) throw new SettingNotFoundError(`Setting "${key}" not found.`);

        await tx.insert(auditLog).values({
          eventType: 'system_setting.changed',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          // Record the full delta so a GwG/GoBD auditor sees what changed.
          payload: { key, oldValue: r.old_value, newValue: r.value },
        });
        return r;
      });

      return reply.status(200).send({
        key: row.key,
        value: row.value,
        description: row.description,
        updatedAt: new Date(row.updated_at).toISOString(),
      });
    },
  );

  // ── GET /api/settings/datev — der ganze Kontenrahmen, ehrlich beschriftet ──
  app.get<{ Querystring: { kontenrahmen?: string } }>(
    '/api/settings/datev',
    {
      schema: {
        tags: ['settings'],
        summary: 'DATEV-Kontenrahmen lesen, mit dem Merkmal Vorschlag oder bestätigt (ADMIN).',
        description:
          'Liefert die sechs Mandantenangaben und JEDES logische Konto des geltenden ' +
          'Kontenrahmens. Zu jedem Wert steht, ob er nur ein VORSCHLAG dieses Hauses ist ' +
          'oder vom Inhaber BESTAETIGT wurde, dazu die Vorlagezahl und ihre Herkunft im ' +
          'Klartext. `?kontenrahmen=SKR03|SKR04` zeigt den anderen Rahmen, ohne etwas ' +
          'umzustellen.',
        querystring: Type.Object({ kontenrahmen: Type.Optional(Type.String({ maxLength: 10 })) }),
        response: {
          200: DatevSettingsResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const mandant = await ladeMandantEinstellungen(app.db);
      const gespeicherterRahmen = mandant.find(
        (f) => f.schluessel === 'datev.sachkontenrahmen',
      )?.wert;

      // Ohne gespeicherten Rahmen und ohne Wunsch: SKR03 anzeigen, weil das der
      // Rahmen ist, in dem dieses Haus bisher gebucht hat. Angezeigt wird dann
      // ohnehin bei JEDEM Konto „Vorschlag".
      const rahmen = normalisiereRahmen(
        req.query.kontenrahmen && req.query.kontenrahmen !== ''
          ? req.query.kontenrahmen
          : (gespeicherterRahmen ?? 'SKR03'),
      );
      const plan = await ladeKontenplan(app.db, rahmen);

      return reply.status(200).send({
        rahmen,
        verfuegbareRahmen: KONTENRAHMEN.map((id) => ({
          id,
          label: RAHMEN_LABEL[id],
          aktiv: id === rahmen,
        })),
        mandant: mandant.map((f) => ({
          schluessel: f.schluessel,
          label: f.label,
          hinweis: f.hinweis,
          art: f.art,
          wert: f.wert,
          herkunft: f.herkunft,
        })),
        konten: plan.eintraege.map((e) => ({
          schluessel: e.schluessel,
          konto: e.konto,
          label: e.label,
          zweck: e.zweck,
          wert: e.wert,
          vorlagewert: e.vorlagewert,
          herkunft: e.herkunft,
          quelle: e.quelle,
        })),
      });
    },
  );

  // ── PATCH /api/settings/datev/:key — genau eine Angabe ändern ─────────────
  app.patch<{ Params: { key: string }; Body: { value: number | string | boolean } }>(
    '/api/settings/datev/:key',
    {
      schema: {
        tags: ['settings'],
        summary: 'Eine DATEV-Angabe oder ein einzelnes Konto ändern (ADMIN).',
        description:
          'Schreibt genau einen `datev.*`-Schlüssel: eine der sechs Mandantenangaben oder ' +
          'ein einzelnes Konto (`datev.konto.skr03.kasse`). Der Wert wird auf Unsinn ' +
          'geprüft, nicht auf fachliche Richtigkeit, die kennt nur der Steuerberater. ' +
          'Mit dem Speichern gilt der Wert als BESTAETIGT: der Schlüssel fällt aus der ' +
          'Platzhalterliste, und die Oberfläche nennt ihn nicht mehr Vorschlag. ' +
          'Jede Änderung geht in das Prüfprotokoll.',
        params: Type.Object({ key: Type.String({ minLength: 1, maxLength: 120 }) }),
        body: DatevUpdateBody,
        response: {
          200: DatevUpdateResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const { key } = req.params;
      if (!istDatevSchluessel(key)) {
        throw new SettingNotEditableError(
          `Die Einstellung „${key}" gehört nicht zum DATEV-Export und wird hier nicht geändert.`,
        );
      }
      // Wirft mit 400 und einer deutschen Meldung, wenn der Wert Unsinn ist.
      const geprueft = pruefeDatevEinstellung(key, req.body.value);

      // Aus einem GEBUNDENEN Parameter, nie aus zusammengesetztem jsonb-Text.
      const jsonbWert =
        geprueft.art === 'text'
          ? sql`to_jsonb(${geprueft.wert}::text)`
          : geprueft.art === 'zahl'
            ? sql`to_jsonb(${geprueft.wert}::numeric)`
            : sql`to_jsonb(${geprueft.wert}::boolean)`;

      const row = await app.db.transaction(async (txAny) => {
        const tx = txAny as unknown as typeof app.db;

        // Einfügend-ODER-ändernd: die Kontenschlüssel haben vor der ersten
        // Änderung bewusst keine Zeile. `prev` hält den Wert VOR dieser
        // Schreibung, damit das Prüfprotokoll die Änderung zeigt und nicht nur
        // das Ergebnis.
        const geschrieben = (await tx.execute<{ wert: string; alt: string | null }>(sql`
          WITH prev AS (
            SELECT key, value #>> '{}' AS alt FROM system_settings WHERE key = ${key}
          )
          INSERT INTO system_settings (key, value, description)
          VALUES (${key}, ${jsonbWert}, 'Vom Inhaber gesetzt (DATEV-Kontenrahmen).')
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
          RETURNING system_settings.value #>> '{}' AS wert,
                    (SELECT alt FROM prev) AS alt
        `)) as unknown as { wert: string; alt: string | null }[];

        const g = geschrieben[0];
        if (!g) throw new SettingNotFoundError(`Die Einstellung „${key}" wurde nicht geschrieben.`);

        // Der Schlüssel ist damit bestätigt — er fällt aus der Platzhalterliste.
        // `jsonb_agg` über eine leere Auswahl liefert NULL, deshalb COALESCE:
        // sonst stünde dort `null` statt einer leeren Liste, und der Leser
        // hielte alle sechs Angaben wieder für unbestätigt.
        await tx.execute(sql`
          UPDATE system_settings
             SET value = (
                   SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
                     FROM jsonb_array_elements(value) AS e
                    WHERE e <> to_jsonb(${key}::text)
                 ),
                 updated_at = now()
           WHERE key = ${PLATZHALTER_SCHLUESSEL}
             AND jsonb_typeof(value) = 'array'
             AND value @> jsonb_build_array(${key}::text)
        `);

        await tx.insert(auditLog).values({
          eventType: 'system_setting.changed',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: { key, oldValue: g.alt, newValue: g.wert, quelle: 'datev-kontenrahmen' },
        });
        return g;
      });

      return reply.status(200).send({
        schluessel: key,
        wert: row.wert,
        // Gespeichert heisst bestätigt. Ein Mensch hat den Wert angefasst.
        herkunft: 'BESTAETIGT',
      });
    },
  );
};

export default settingsRoute;

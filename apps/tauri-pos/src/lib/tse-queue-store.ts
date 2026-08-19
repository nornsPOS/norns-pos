/**
 * tse-queue-store — the DURABLE TSE signature replay queue (Phase 1.3).
 *
 * Replaces the volatile `localStorage['warehouse14.tse-queue.v1']` queue in
 * `tse-service.ts`, which was wiped on sign-out and silently rolled off at 200
 * rows — both fatal for fiscal records (KassenSichV §146a signatures the till
 * could not finish or record online). This store persists to the same
 * `sqlite:warehouse14.db` the outbox uses (table `tse_signature_queue`, created
 * by the `0003_tse_queue.sql` migration on startup), so an entry survives crash
 * + refresh + sign-out and is NEVER dropped.
 *
 * Modeled on `outbox-store.ts`: lazy `db()` (the SQLite open is paid only on the
 * failure/offline path that enqueues), a monotonic per-device sequence for a
 * deterministic FIFO drain order, and `$N` placeholders (tauri-plugin-sql /
 * sqlx). Outside a Tauri webview `Database.load` rejects — same contract as
 * `kyc-store.ts`: the store propagates and the callers (the drain hook + the
 * Gerätemanager badge) degrade to "no local records". Enqueue only ever runs
 * from the Tauri-gated fiscal finalize path, so its reject can only surface on a
 * real till, where it is a genuine problem that must not be swallowed.
 *
 * Two replay paths, distinguished by `signature`:
 *   (a) finish-failed  → `signature: null`  → replay re-invokes Fiskaly FINISH,
 *                          then POSTs the result to the server.
 *   (b) record-failed  → `signature: <TseSignature>` → the FINISH already
 *                          consumed the intention; replay MUST NOT re-finish,
 *                          only re-POST the stored signature to the server.
 */

import { lesbareAblehnung } from './drucker-diagnose.js';
import type Database from '@tauri-apps/plugin-sql';

import type { TsePaymentKind, TseReceiptType, TseSignature } from './hardware-client.js';
import { istWiederFaellig } from './tse-nachreichen-regel.js';
import type { VatAmount } from './tse-vat.js';
import { fiskalzustandSatz, zustandAusAusfall } from './fiskalzustand-satz.js';

const DB_PATH = 'sqlite:warehouse14.db';
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/**
 * A crash mid-drain leaves an `in_flight` row. After this window the next sweep
 * re-selects it so it is never stranded. Must exceed a single drain's realistic
 * wall time (one Fiskaly FINISH + one server POST) with margin.
 */
export const STALE_MS = 60_000;

/**
 * Outbound retry cap per row. Bounds hammering a recovering Fiskaly (the real
 * DoS direction is outbound). On the Nth failure the drain moves the row to
 * `failed_terminal` — surfaced in the Gerätemanager badge, never deleted.
 */
export const MAX_ATTEMPTS = 8;

export type TseQueueStatus = 'pending' | 'in_flight' | 'succeeded' | 'failed_terminal';

/**
 * What an enqueue supplies — the complete, self-contained fiscal context needed
 * to replay a FINISH + server-POST with a byte-identical signed body. Integer
 * cents throughout (`amountCents`, every `amountsPerVatId` bucket); the STRICT
 * table rejects a non-integer, so a lossy float can never slip in.
 */
export interface EnrichedTseQueueEntry {
  intentionId: string;
  fiskalyTransactionId: string;
  tssId: string;
  clientId: string;
  /** result.id (Verkauf) / result.transactionId (Ankauf) — the `:id` in the POST route. */
  serverTransactionId: string;
  amountCents: number;
  paymentKind: TsePaymentKind;
  amountsPerVatRate: VatAmount[];
  receiptType: TseReceiptType;
  processType: string;
  receiptLocator: string | null;
  /** NULL = finish-failed (path a); populated = record-failed (path b, never re-finish). */
  signature: TseSignature | null;
  /** ms epoch, device clock — the failure timestamp. */
  createdAt: number;
  /** The originating failure, for the honest surface. */
  lastError?: unknown;
}

/** Raw columns read back from `tse_signature_queue`. */
export interface TseQueueRow {
  id: number;
  monotonic_seq: number;
  intention_id: string;
  fiskaly_transaction_id: string;
  tss_id: string;
  client_id: string;
  server_transaction_id: string;
  amount_cents: number;
  payment_kind: string;
  amounts_per_vat_id_json: string;
  receipt_type: string;
  process_type: string;
  receipt_locator: string | null;
  signature_json: string | null;
  status: TseQueueStatus;
  attempt_count: number;
  last_attempt_at: number | null;
  last_error_json: string | null;
  created_at: number;
  retention_until: number;
}

/** A parsed, drain-ready entry (row + decoded JSON columns). */
export interface DrainableTseEntry {
  id: number;
  monotonicSeq: number;
  intentionId: string;
  fiskalyTransactionId: string;
  tssId: string;
  clientId: string;
  serverTransactionId: string;
  amountCents: number;
  paymentKind: TsePaymentKind;
  amountsPerVatRate: VatAmount[];
  receiptType: TseReceiptType;
  processType: string;
  receiptLocator: string | null;
  signature: TseSignature | null;
  status: TseQueueStatus;
  attemptCount: number;
  /**
   * Wann diese Zeile zuletzt versucht wurde, in Millisekunden. `null` heisst:
   * noch nie. Die Verzoegerungsstaffel in `listDrainable` rechnet damit.
   */
  lastAttemptAt: number | null;
}

export interface TseQueueStats {
  pending: number;
  inFlight: number;
  failedTerminal: number;
}

/** The store contract — the drain (Step 5) and the badge (Step 6) depend on this. */
export interface TseQueueStore {
  enqueue(entry: EnrichedTseQueueEntry): Promise<void>;
  listDrainable(now: number): Promise<DrainableTseEntry[]>;
  markInFlight(id: number, now: number): Promise<void>;
  /**
   * Persist a freshly-finished signature onto a finish-failed row WITHOUT
   * changing its status (B1). The drain calls this the instant Fiskaly FINISH
   * succeeds, BEFORE the server-record leg — so a crash in between leaves a
   * signed, record-only-replayable row instead of a NULL row that would
   * re-FINISH an already-finished (and now unreconstructable) intention.
   */
  persistSignature(id: number, signature: TseSignature): Promise<void>;
  incrementAttempt(id: number, error: unknown, now: number): Promise<void>;
  markSucceeded(id: number, now: number): Promise<void>;
  markFailedTerminal(id: number, error: unknown, now: number): Promise<void>;
  getStats(): Promise<TseQueueStats>;
}

export class TauriSqlTseQueueStore implements TseQueueStore {
  private dbPromise: Promise<Database> | null = null;

  private db(): Promise<Database> {
    if (!this.dbPromise) {
      this.dbPromise = import('@tauri-apps/plugin-sql').then(({ default: Db }) => Db.load(DB_PATH));
    }
    return this.dbPromise;
  }

  async enqueue(entry: EnrichedTseQueueEntry): Promise<void> {
    await this.schreibe(entry, 'pending');
  }

  /**
   * ⚠️ EIN AUSFALL, DER NIE NACHGEREICHT WERDEN KANN, IST KEINE WARTESCHLANGE.
   *
   * Der Befund vom 13.08.2026: die Zeile eines gescheiterten EROEFFNUNGS-
   * Schrittes wurde als `pending` geschrieben. Der Geraetemanager liest daraus
   * „Ausstehende TSE-Signaturen werden automatisch nachgereicht"
   * (`screens/secondary/GeraeteManager.tsx:1331`) — und das war fuer diese
   * Zeile fuer immer falsch, denn nachgereicht werden kann sie nie:
   *
   *   · Sie traegt keine Vorgangsnummer (`OHNE_EROEFFNUNG`), also gibt es bei
   *     der Sicherungseinrichtung nichts, das man abschliessen koennte.
   *   · Selbst wenn man sie spaeter eroeffnen wuerde, setzte
   *     `tse_start_transaction` den Startzeitpunkt auf `Utc::now()`
   *     (`src-tauri/src/commands/tse.rs`). Eine Stunde spaeter nachgeholt,
   *     truege der Vorgang eine falsche Protokollzeit — eine unrichtige Angabe
   *     nach § 146a AO, schlimmer als die fehlende Signatur.
   *
   * Deshalb wird ein solcher Ausfall SOFORT als endgueltig vermerkt: dauerhaft
   * festgehalten, zehn Jahre aufbewahrt, nie geloescht, im Geraetemanager als
   * Stoerung sichtbar — aber ohne das Versprechen einer Heilung, die es nicht
   * gibt. Das ist der dokumentierte Ausfall, den § 146a AO verlangt.
   */
  async vermerkeDauerhaftenAusfall(entry: EnrichedTseQueueEntry): Promise<void> {
    await this.schreibe(entry, 'failed_terminal');
  }

  private async schreibe(entry: EnrichedTseQueueEntry, status: TseQueueStatus): Promise<void> {
    const db = await this.db();
    const retentionUntil = entry.createdAt + TEN_YEARS_MS; // fiscal-only table: always +10y

    // UPSERT that PROMOTES (D2a). Two enqueue paths can fire for one intention:
    // a finish-failed row (signature NULL) may already exist when the later
    // record-failed path enqueues the signed one. `COALESCE(excluded, existing)`
    // promotes NULL→signed and NEVER overwrites a real signature with NULL, while
    // re-arming the status to the one THIS write asked for. A pure duplicate
    // collapses to a no-op UPDATE.
    // `INSERT OR IGNORE` would silently DROP the signature — fiscal-signature loss.
    await db.execute(
      `INSERT INTO tse_signature_queue (
         monotonic_seq, intention_id, fiskaly_transaction_id, tss_id, client_id,
         server_transaction_id, amount_cents, payment_kind, amounts_per_vat_id_json,
         process_type, receipt_type, receipt_locator, signature_json, status, attempt_count,
         last_attempt_at, last_error_json, created_at, retention_until
       ) VALUES (
         (SELECT COALESCE(MAX(monotonic_seq), 0) + 1 FROM tse_signature_queue),
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 0, $14, $15, $16, $17
       )
       ON CONFLICT(intention_id) DO UPDATE SET
         signature_json  = COALESCE(excluded.signature_json, tse_signature_queue.signature_json),
         status          = excluded.status,
         last_error_json = excluded.last_error_json,
         last_attempt_at = excluded.last_attempt_at`,
      [
        entry.intentionId,
        entry.fiskalyTransactionId,
        entry.tssId,
        entry.clientId,
        entry.serverTransactionId,
        entry.amountCents,
        entry.paymentKind,
        JSON.stringify(entry.amountsPerVatRate),
        entry.processType,
        entry.receiptType,
        entry.receiptLocator,
        entry.signature ? JSON.stringify(entry.signature) : null,
        status,
        entry.createdAt, // last_attempt_at ← failure time
        entry.lastError !== undefined ? JSON.stringify(serializeError(entry.lastError)) : null,
        entry.createdAt,
        retentionUntil,
      ],
    );
  }

  async listDrainable(now: number): Promise<DrainableTseEntry[]> {
    const db = await this.db();
    const staleThreshold = now - STALE_MS;
    // pending, OR an in_flight row whose drain crashed (last_attempt older than
    // STALE_MS, or never stamped). succeeded/failed_terminal are excluded.
    const rows = await db.select<TseQueueRow[]>(
      `SELECT * FROM tse_signature_queue
        WHERE status = 'pending'
           OR (status = 'in_flight' AND (last_attempt_at IS NULL OR last_attempt_at < $1))
        ORDER BY monotonic_seq ASC`,
      [staleThreshold],
    );
    // ⚠️ DIE VERZOEGERUNGSSTAFFEL, DIE DER BAUPLAN SEIT JEHER VERSPRACH.
    //
    //     0003_tse_queue.sql:39
    //     last_attempt_at INTEGER, -- … stale-in_flight re-selection + backoff
    //
    // Sie existierte nie: `last_attempt_at` wurde nur fuer die haengengebliebene
    // Zeile gelesen, nie fuer eine wartende. Der Takt war fest fuenf Sekunden,
    // und nach acht Versuchen war Schluss.
    //
    // Seit dem 08.08.2026 gibt der Weg nicht mehr auf. Damit „nicht aufgeben"
    // nicht „im Sekundentakt anklopfen" heisst, wird hier gefiltert: eine
    // Zeile ist erst wieder dran, wenn ihre gewachsene Wartezeit um ist.
    // Gedeckelt bei einer Viertelstunde, damit eine TSE, die nach Stunden
    // zurueckkommt, noch am selben Tag bedient wird.
    return rows
      .map(rowToDrainable)
      .filter((e) => istWiederFaellig(e.attemptCount, e.lastAttemptAt ?? null, now));
  }

  async markInFlight(id: number, now: number): Promise<void> {
    const db = await this.db();
    await db.execute(
      `UPDATE tse_signature_queue SET status = 'in_flight', last_attempt_at = $1 WHERE id = $2`,
      [now, id],
    );
  }

  async persistSignature(id: number, signature: TseSignature): Promise<void> {
    const db = await this.db();
    // Status intentionally untouched — the row is 'in_flight' mid-drain; the very
    // next line records it. A crash here leaves an in_flight+signed row, which the
    // stale re-selection picks up as record-only (never re-FINISH). B1.
    await db.execute(`UPDATE tse_signature_queue SET signature_json = $1 WHERE id = $2`, [
      JSON.stringify(signature),
      id,
    ]);
  }

  async incrementAttempt(id: number, error: unknown, now: number): Promise<void> {
    const db = await this.db();
    // Re-arm to 'pending' so the next sweep re-selects it; bump the attempt count
    // (the drain caps it, then calls markFailedTerminal instead — never here).
    await db.execute(
      `UPDATE tse_signature_queue
          SET attempt_count = attempt_count + 1,
              status = 'pending',
              last_error_json = $1,
              last_attempt_at = $2
        WHERE id = $3`,
      [JSON.stringify(serializeError(error)), now, id],
    );
  }

  async markSucceeded(id: number, now: number): Promise<void> {
    const db = await this.db();
    // Retained, not deleted (D6): the signed fiscal record stays for the +10y
    // retention. getStats() excludes 'succeeded' so the badge clears.
    await db.execute(
      `UPDATE tse_signature_queue SET status = 'succeeded', last_attempt_at = $1 WHERE id = $2`,
      [now, id],
    );
  }

  async markFailedTerminal(id: number, error: unknown, now: number): Promise<void> {
    const db = await this.db();
    await db.execute(
      `UPDATE tse_signature_queue
          SET status = 'failed_terminal', last_error_json = $1, last_attempt_at = $2
        WHERE id = $3`,
      [JSON.stringify(serializeError(error)), now, id],
    );
  }

  /**
   * Liegt fuer diese Absicht wirklich eine Zeile im Korb?
   *
   * ⚠️ Absichtlich NICHT Teil von `TseQueueStore`: die Nachbauten in den
   * bestehenden Pruefungen erfuellen die Schnittstelle als Objektliteral, ein
   * neues Pflichtfeld haette sie rot gemacht, ohne etwas zu messen.
   *
   * Jeder Status zaehlt, auch `succeeded` und `failed_terminal`: die Frage ist
   * „ist der Vorgang dauerhaft festgehalten?", nicht „wartet er noch?".
   */
  async istEingereiht(intentionId: string): Promise<boolean> {
    const db = await this.db();
    const rows = await db.select<Array<{ anzahl: number }>>(
      `SELECT COUNT(*) AS anzahl FROM tse_signature_queue WHERE intention_id = $1`,
      [intentionId],
    );
    return (rows[0]?.anzahl ?? 0) > 0;
  }

  async getStats(): Promise<TseQueueStats> {
    const db = await this.db();
    // 'succeeded' is intentionally excluded (D6) so the Gerätemanager badge shows
    // only the live backlog (pending + in_flight) plus anything stuck terminal.
    const rows = await db.select<Array<{ status: TseQueueStatus; count: number }>>(
      `SELECT status, COUNT(*) AS count
         FROM tse_signature_queue
        WHERE status IN ('pending', 'in_flight', 'failed_terminal')
        GROUP BY status`,
    );
    const stats: TseQueueStats = { pending: 0, inFlight: 0, failedTerminal: 0 };
    for (const row of rows) {
      if (row.status === 'pending') stats.pending = row.count;
      else if (row.status === 'in_flight') stats.inFlight = row.count;
      else if (row.status === 'failed_terminal') stats.failedTerminal = row.count;
    }
    return stats;
  }
}

/**
 * Der eine Korb dieser Kasse.
 *
 * Absichtlich die KONKRETE Klasse: `ausfallSichern` braucht `istEingereiht`,
 * das bewusst nicht in der Schnittstelle steht (Begruendung dort). Nach aussen
 * bleibt `tseQueueStore` mit unveraendertem Vertrag.
 */
const korb = new TauriSqlTseQueueStore();

// ═══════════════════════════════════════════════════════════════════════════
//  ⚠️ DER BEFUND VOM 13.08.2026 — DIE STILLE LUECKE VOR DEM ERSTEN SCHRITT
// ═══════════════════════════════════════════════════════════════════════════
//
// Gemessen im Bezahlweg (`screens/verkauf/BezahlenDialog.tsx`):
//
//   823  const intentionRes = await openTseSession({ … })   ← Eroeffnung
//   954  const finishRes    = await closeTseSession({ … })  ← Abschluss
//   981  await transactionsApi.recordTseSignature(…)        ← Melden
//
// Eine Zeile in diesem Korb entstand an GENAU ZWEI Stellen: in
// `closeTseSession` (Abschluss gescheitert, `tse-service.ts:119`) und in
// `enqueueSignatureRecordOnly` (Melden gescheitert, `tse-service.ts:170`).
//
// Faellt das Netz aus, scheitert aber schon die EROEFFNUNG. Dann lief der
// Bezahlweg in seinen `else`-Zweig, zeigte „Die Signatur wird nachgeholt,
// sobald die Sicherungseinrichtung wieder antwortet" — und es entstand
// NIRGENDS eine Zeile. Nachgeholt wurde nie etwas. Zweierlei auf einmal: eine
// verlorene fiskalische Aufzeichnung und ein falscher Satz auf dem Schirm.
//
// Dazu kam eine zweite, kleinere Luege: schlug in `closeTseSession` auch noch
// der Korbschreiber fehl (`tse-service.ts:135` faengt und schreibt nur in die
// Entwicklerausgabe), meldete die Funktion trotzdem `queued_offline`, und der
// Bezahlweg versprach eine Nachreichung, die es nicht gab.
//
// Was hier dazukommt, schliesst beides: eine Nachsehe-Frage (`istEingereiht`),
// ein Sicherungsweg, der EHRLICH meldet, ob es geklappt hat (`ausfallSichern`),
// und die Saetze fuer den Kassierer, die ohne diese Messung nicht ausgesprochen
// werden duerfen (`meldungNachAusfall`).

/**
 * ⚠️ KEINE VORGANGSNUMMER, WEIL ES KEINE GIBT.
 *
 * `fiskaly_transaction_id` kommt aus der ANTWORT der Eroeffnung
 * (`src-tauri/src/commands/tse.rs:246` liest `_id`). Scheitert die Eroeffnung,
 * gibt es keine Antwort und damit keine Nummer.
 *
 * Hier etwas hinzuschreiben, das plausibel aussieht — etwa die Absichtsnummer —
 * waere eine erfundene Angabe in einer Aufzeichnung nach § 146a AO. Genau davor
 * warnt der Prüfstand selbst: er antwortet absichtlich mit `fiskaly-tx-{tx}`
 * statt mit der Absichtsnummer (`src-tauri/tests/tse_hil.rs:156`), damit
 * niemand die beiden fuer dasselbe haelt.
 *
 * Die Spalte ist NOT NULL, also steht hier die leere Zeichenkette: sie sagt
 * „nie eroeffnet".
 *
 * ⚠️ NACHGEMESSEN AM 13.08.2026 — HIER STAND EINE ANNAHME, DIE NICHT STIMMTE.
 *
 * An dieser Stelle stand: „Der Nachreiche-Weg laeuft damit einmal in eine
 * dauerhafte Ablehnung und stellt die Zeile auf `failed_terminal`." Das tat er
 * nie. Der Nachreicher rief `tseClient.finish`, die Bruecke lehnte mit
 * `{kind, details}` ab (`src-tauri/src/error.rs`), und `istDauerhaftAbgelehnt`
 * kannte diese Form nicht — die Zeile ging zurueck auf `pending`, in alle
 * Ewigkeit. Der Geraetemanager las daraus „werden automatisch nachgereicht".
 *
 * Zwei Dinge wurden daraufhin richtiggestellt: die Erkennung versteht jetzt die
 * echte Fehlerform der Bruecke (`tse-nachreichen-regel.ts`), und eine Zeile
 * ohne Eroeffnung wird gar nicht erst zum Nachreichen gestellt, sondern sofort
 * als dauerhafter Ausfall vermerkt (`vermerkeDauerhaftenAusfall`) — sichtbar im
 * Geraetemanager, zehn Jahre aufbewahrt, nie geloescht. Das ist der
 * dokumentierte Ausfall, den § 146a AO verlangt; nachtraeglich signieren laesst
 * sich ein Vorgang, den die Sicherungseinrichtung nie gesehen hat, nicht.
 */
export const OHNE_EROEFFNUNG = '';

/** An welchem Schritt des TSE-Wegs es gescheitert ist. */
export type TseAusfallSchritt =
  | 'keine_tse' // Diese Kasse hat gar keine Sicherungseinrichtung hinterlegt.
  | 'eroeffnung' // Die Sicherungseinrichtung hat den Vorgang nie angenommen.
  | 'abschluss' // Vorgang offen, aber der Abschluss kam nicht durch.
  | 'melden'; // Signatur da, aber der Server hat sie nicht bekommen.

/**
 * ⚠️ DIE EINE TRENNLINIE DIESER DATEI: WAS KANN ÜBERHAUPT NACHGEREICHT WERDEN?
 *
 * Nur ein Vorgang, den die Sicherungseinrichtung SCHON GESEHEN hat. Dann liegt
 * dort eine offene Aufzeichnung mit ihrer eigenen Startzeit, und ein späterer
 * Abschluss trägt die richtige Zeit.
 *
 * Bei `keine_tse` und `eroeffnung` hat sie ihn nie gesehen. Eine Eröffnung von
 * Hand nachzuholen setzte den Startzeitpunkt auf JETZT
 * (`src-tauri/src/commands/tse.rs`, `tse_start_transaction` schreibt
 * `Utc::now()`) — der Vorgang trüge dann eine erfundene Protokollzeit. Das wäre
 * eine unrichtige Angabe nach § 146a AO und damit schlimmer als die fehlende
 * Signatur, die dort nur als Ausfall zu vermerken ist.
 *
 * Diese Antwort entscheidet beides: ob eine Zeile in die Nachreichung geht und
 * ob der Satz auf dem Schirm eine Nachreichung versprechen darf.
 */
export function istNachreichbar(schritt: TseAusfallSchritt): boolean {
  return schritt === 'abschluss' || schritt === 'melden';
}

export interface AusfallMeldung {
  title: string;
  body: string;
}

/**
 * Der Satz, den der Kassierer zu sehen bekommt — und zwar erst, NACHDEM
 * gemessen wurde, ob die Sicherung wirklich gelungen ist.
 *
 * ⚠️ Die Trennlinie: „wird nachgereicht" darf nur fallen, wenn eine Zeile
 * wirklich liegt UND der Vorgang bei der Sicherungseinrichtung existiert — also
 * genau dann, wenn `istNachreichbar` es sagt. Bei `keine_tse` und `eroeffnung`
 * existiert er nicht, also verspricht dieser Fall keine Nachreichung, sondern
 * nennt den Ausfall beim Namen. Und wenn nicht einmal die örtliche Sicherung
 * ging, ist das der einzige Fall echten Datenverlusts — der muss sofort und
 * unmissverständlich auf den Schirm.
 */
export function meldungNachAusfall(
  schritt: TseAusfallSchritt,
  eingereiht: boolean,
  vorgang: 'Verkauf' | 'Ankauf',
): AusfallMeldung {
  // ⛔ 13.08.2026 — HIER STANDEN FÜNF EIGENE SÄTZE.
  //
  // Sie waren richtig, und genau das war das Problem: dieselbe Aussage stand
  // damit ein sechstes Mal im Baum, unabhängig getippt. Beim nächsten neuen
  // Zustand wäre sie stehengeblieben, während die anderen fünf umgestellt
  // werden — die bekannte Art, wie eine Lüge WANDERT statt zu sterben.
  //
  // Ton, Überschrift, Satz und nächster Schritt kommen jetzt aus derselben
  // Quelle, die auch Gerätemanager, Belegvorschau, Tagesabschluss und der
  // Ankaufweg lesen. Der Wortlaut bleibt damit an EINER Stelle wartbar.
  //
  // Kein Kreis: `fiskalzustand-satz.ts` holt von hier nur TYPEN
  // (`import type`), und die sind zur Laufzeit weg.
  const satz = fiskalzustandSatz(zustandAusAusfall(schritt, eingereiht), vorgang);
  return {
    title: satz.titel,
    body: `${satz.satz} ${satz.naechsterSchritt.text}`,
  };
}

/**
 * Sichert einen gescheiterten TSE-Schritt dauerhaft und meldet EHRLICH, ob es
 * gelungen ist. Wirft nie: der Verkauf ist zu diesem Zeitpunkt gebucht, und ein
 * Ausfall der Sicherungseinrichtung darf den Verkauf nie blockieren.
 *
 * Liegt fuer diese Absicht schon eine Zeile (etwa weil `closeTseSession` sie
 * geschrieben hat), wird nicht noch einmal geschrieben. Die Rueckgabe ist die
 * MESSUNG, auf die sich der Satz auf dem Schirm stuetzen darf.
 *
 * ⚠️ Der `schritt` entscheidet, in welchem Zustand die Zeile entsteht: ein
 * nachreichbarer Ausfall wird `pending` und vom Nachreicher bedient, ein nicht
 * nachreichbarer sofort als dauerhafter Ausfall vermerkt. Begruendung in
 * `istNachreichbar` und `vermerkeDauerhaftenAusfall`. Ohne diese Trennung stand
 * eine Zeile fuer immer auf `pending`, und der Geraetemanager versprach
 * ebenso lange eine Nachreichung, die nie kam.
 */
export async function ausfallSichern(
  eintrag: EnrichedTseQueueEntry,
  schritt: TseAusfallSchritt,
): Promise<boolean> {
  try {
    if (await korb.istEingereiht(eintrag.intentionId)) return true;
  } catch {
    // Nachsehen ging nicht (kein Tauri, Datei gesperrt) — dann eben schreiben
    // und am Schreiben messen. Der UPSERT macht aus einer Doppelung nichts.
  }
  try {
    if (istNachreichbar(schritt)) await korb.enqueue(eintrag);
    else await korb.vermerkeDauerhaftenAusfall(eintrag);
    return true;
  } catch (err) {
    // Der einzige Fall echten Verlusts. Nicht verschlucken: der Aufrufer sagt
    // es dem Kassierer, hier bleibt die Spur fuer die Fehlersuche.
    // eslint-disable-next-line no-console
    console.error('TSE-Ausfall konnte oertlich nicht gesichert werden', err);
    return false;
  }
}

function rowToDrainable(row: TseQueueRow): DrainableTseEntry {
  return {
    id: row.id,
    monotonicSeq: row.monotonic_seq,
    lastAttemptAt: row.last_attempt_at ?? null,
    intentionId: row.intention_id,
    fiskalyTransactionId: row.fiskaly_transaction_id,
    tssId: row.tss_id,
    clientId: row.client_id,
    serverTransactionId: row.server_transaction_id,
    amountCents: row.amount_cents,
    // ⚠️ Eine Zeile aus der Zeit vor dem 08.08.2026 trägt noch „Bar"/„Unbar".
    // Sie hier zu übersetzen ist kein Raten: die beiden Wörter hatten genau
    // eine Bedeutung, und ein unübersetzter Wert würde beim Nachsignieren
    // wieder abgewiesen und der Beleg bliebe für immer ohne Signatur.
    paymentKind:
      row.payment_kind === 'NON_CASH' || row.payment_kind === 'Unbar' ? 'NON_CASH' : 'CASH',
    amountsPerVatRate: safeParse<VatAmount[]>(row.amounts_per_vat_id_json) ?? [],
    receiptType: (row.receipt_type as TseReceiptType | undefined) ?? 'RECEIPT',
    processType: row.process_type,
    receiptLocator: row.receipt_locator,
    signature: row.signature_json ? (safeParse<TseSignature>(row.signature_json) ?? null) : null,
    status: row.status,
    attemptCount: row.attempt_count,
  };
}

function safeParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** Reduce an arbitrary thrown value to an audit-stable JSON shape (mirrors outbox-store). */
function serializeError(error: unknown): Record<string, unknown> {
  if (error && typeof error === 'object') {
    const e = error as {
      name?: unknown;
      message?: unknown;
      serverCode?: unknown;
      serverDetails?: unknown;
    };
    return {
      name: typeof e.name === 'string' ? e.name : 'Error',
      message: typeof e.message === 'string' ? e.message : lesbareAblehnung(error),
      ...(e.serverCode !== undefined ? { serverCode: e.serverCode } : {}),
      ...(e.serverDetails !== undefined ? { serverDetails: e.serverDetails } : {}),
    };
  }
  // ⚠️ 02.08.2026: hier stand `String(error)`. Das ist zwar kein
  // Bildschirmtext, sondern ein Protokollsatz — aber ein Protokoll, in dem
  // „[object Object]" steht, ist bei der Fehlersuche genauso wertlos.
  return { name: 'Error', message: lesbareAblehnung(error) };
}

/** Process-wide singleton — one durable queue per till. */
export const tseQueueStore: TseQueueStore = korb;

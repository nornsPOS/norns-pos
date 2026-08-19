/**
 * Offline-queue middleware (ADR-0044) — failure mode (A): wifi drops
 * mid-transaction. For a German precious-metals / antiques retailer a lost
 * mutation is not just bad UX, it is a GoBD §146 breach: a sale, Ankauf, or
 * Storno the cashier believes was tendered MUST be persistable regardless of
 * network state at the moment of tender.
 *
 * Position in the production chain (ADR-0044 §3), directly after step-up and
 * above retry:
 *
 *   step-up → [offline-queue] → retry → telemetry → circuit → dedup → terminal
 *
 * Why above retry: it must catch BOTH `ApiNetworkError` AND
 * `ApiCircuitOpenError` before retry burns its budget on infrastructure that
 * is unreachable. To the cashier who pressed "Ankauf bestätigen", a circuit
 * being open is indistinguishable from the network being down — both must
 * enqueue. Why below step-up: a `STEP_UP_REQUIRED` while online means the
 * operator must re-PIN now; queueing it would defer the modal to next
 * connectivity, which is meaningless.
 *
 * Pure module — no Tauri, no SQLite, no React. The durable store is injected
 * (`OutboxStore`), exactly like the sink for telemetry and `requestStepUp`
 * for step-up. The Tauri-SQLite implementation lives in the app layer.
 *
 * SCOPE (ADR-0044 action items 1–3): this middleware ENQUEUES. The replay
 * loop, conflict resolution, and the Compliance Inbox (ADR-0045) are separate
 * action items and intentionally not implemented here.
 */

import { ApiCircuitOpenError, ApiNetworkError, ApiOfflineQueuedError } from '../errors.js';
import { uuidv7 } from '../internal/uuidv7.js';
import type { HttpMethod, Middleware, MiddlewareResponse } from '../middleware.js';

/**
 * Lifecycle of an outbox row. The terminal resolution states
 * (`succeeded` / `failed_terminal` / `conflict` / `deferred`) are written by
 * the replay loop + Compliance Inbox; this middleware only ever creates rows
 * in `pending`.
 */
export type OutboxStatus =
  | 'pending'
  | 'in_flight'
  | 'succeeded'
  | 'failed_terminal'
  | 'conflict'
  | 'deferred';

/**
 * A mutation captured for durable replay. Headers and body are SEALED at
 * enqueue time — the replay loop sends these exact bytes; the server
 * validates them at original-intent time via the `Idempotency-Key` cache
 * (ADR-0044 §5). Mirrors the `outbox_mutations` table columns.
 */
export interface OutboxRecord {
  /** Stable across every replay attempt — server-side dedup depends on it. */
  readonly idempotencyKey: string;
  /** Client trace id if telemetry already stamped one; else null. */
  readonly traceId: string | null;
  readonly method: HttpMethod;
  readonly path: string;
  readonly url: string;
  /**
   * Sealed at enqueue. Do NOT recompose from current state on replay.
   *
   * ⚠️ Mit EINER Ausnahme, und die ist der ganze Grund für
   * `ohneSitzungsschluessel`: der Sitzungsschlüssel gehört NICHT hierher. Er
   * ist das einzige Feld, dessen Gültigkeit verfällt, während der Rest der
   * Zeile beliebig lange gültig bleibt.
   */
  readonly headers: Record<string, string>;
  /** Not yet stringified — the store serializes (and may compress) it. */
  readonly body: unknown;
  /** ms epoch, device clock, captured at enqueue. */
  readonly enqueuedAt: number;
  /** Drives retention: 10y when true (GoBD §147), 30d otherwise. */
  readonly gobdRelevant: boolean;
  /** Forensic provenance: true ⇒ a fiscal call site supplied the key. */
  readonly callerSuppliedKey: boolean;
  readonly deviceId: string;
}

/**
 * The durable outbox. `enqueue` and `markSucceeded` are the write path used
 * by the middleware + replay loop; `listPending` is the read path the replay
 * loop drains in FIFO order. Implementations MUST treat `idempotencyKey` as
 * unique (insert-or-ignore) so a crash-recovery resubmit can't double-row.
 */
export interface OutboxStore {
  enqueue(record: OutboxRecord): Promise<void>;
  markSucceeded(idempotencyKey: string, response: unknown): Promise<void>;
  /**
   * Mark a row as halted on an unresolved divergence. Conflict rows are NEVER
   * auto-pruned (ADR-0044 §7) — they await human resolution in the Compliance
   * Inbox (ADR-0045).
   */
  markConflict(idempotencyKey: string, error: unknown): Promise<void>;
  /** Pending rows in FIFO (enqueue) order — drained by the replay loop. */
  listPending(): Promise<readonly OutboxRecord[]>;
  /**
   * Optional queue-health snapshot for the offline-status UI: how many rows are
   * still `pending` and how many are `conflict` (halted, awaiting the Compliance
   * Inbox). Stores that cannot cheaply compute it may omit this method.
   */
  getStats?(): Promise<{ pending: number; conflict: number }>;
}

/**
 * Fiscal route prefixes (ADR-0044 §5). A mutation on any of these carries
 * GoBD §147 weight → 10-year outbox retention. Exported so the app-layer
 * middleware wiring and any server-side mirror share ONE source of truth and
 * cannot drift (ADR-0044 action item 7).
 */
export const FISCAL_PATH_PREFIXES: readonly string[] = [
  // The api-client posts to the FULL '/api/...' path, so the prefixes must
  // carry it too — otherwise a queued offline sale/buy/storno was never tagged
  // GoBD-relevant and missed its 10-year retention (audit 2026-06-07, P0).
  '/api/transactions/ankauf',
  '/api/transactions/finalize',
  '/api/transactions/storno',
];

/**
 * Fiskalische Wege, die eine KENNUNG IN DER MITTE tragen.
 *
 * ── DER BEFUND VOM 12.08.2026 ──────────────────────────────────────────────
 *
 * In der Liste darüber standen `/api/cash-movements` und `/api/shifts/close`.
 * Beide gibt es NICHT. Der Klient ruft (siehe `domains/shifts.ts`):
 *
 *     POST /api/shifts/<kennung>/cash-movements
 *     POST /api/shifts/<kennung>/close
 *
 * Ein Präfixvergleich kann eine Kennung IN DER MITTE nicht treffen:
 * `'/api/shifts/abc/close'.startsWith('/api/shifts/close')` ist falsch. Beide
 * fiskalischen Wege galten damit als NICHT GoBD-relevant.
 *
 * Die Folge trifft genau das, was zehn Jahre liegen muss: eine Einlage, eine
 * Entnahme, ein Geldtransit (§ 146 AO Kassenbuch) und der Schichtabschluss
 * landeten im Ausgangskorb mit 30 Tagen Aufbewahrung statt zehn Jahren
 * (§ 147 AO) — und `pruneExpired` räumt danach ab.
 *
 * ⚠️ Der Prüfsatz dazu prüfte die ERFUNDENEN Pfade und war deshalb grün: die
 * Hausklasse „der Prüfstand macht denselben Fehler". Er misst jetzt die
 * Pfade, die der Klient wirklich baut.
 */
export const FISCAL_PATH_MUSTER: readonly RegExp[] = [
  // Bargeldbewegung: Einlage, Entnahme, Geldtransit — das Kassenbuch.
  /^\/api\/shifts\/[^/]+\/cash-movements$/,
  // Der Kassensturz samt Z-Bon.
  /^\/api\/shifts\/[^/]+\/close$/,
];

/**
 * True when `path` is a fiscal route.
 *
 * Zwei Formen, weil es zwei Bauarten gibt: Wege mit fester Vorsilbe
 * (`/api/transactions/finalize`) und Wege mit einer Kennung in der Mitte
 * (`/api/shifts/<kennung>/close`).
 */
export function isGobdRelevantPath(path: string): boolean {
  if (FISCAL_PATH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return true;
  return FISCAL_PATH_MUSTER.some((m) => m.test(path));
}

/**
 * FLÜCHTIGE WEGE — sie dürfen NIEMALS in den Ausgangskorb.
 *
 * ── WARUM ES DIESE LISTE GIBT (26.07.2026, an der Kasse am Tresen gemessen) ─
 * `FISCAL_PATH_PREFIXES` beantwortet die Frage „wie LANGE aufbewahren?" und
 * kennt nur zwei Antworten: 10 Jahre oder 30 Tage. Beide heissen: einreihen.
 * Es fehlte die Frage davor — „einreihen ÜBERHAUPT?".
 *
 * Der gemessene Fall: die Kassiererin tippt ohne Netz ein Stück an. Die Kasse
 * ruft `/api/inventory/reserve`, das Mittelstück reiht ein und wirft
 * `ApiOfflineQueuedError`. Der Verkauf findet nie statt. Stunden später kommt
 * das Netz zurück, `drainOutbox` spielt die Reservierung WIRKLICH ab, und das
 * Stück steht auf RESERVIERT — mit einer Sitzungskennung, die es nur in einem
 * längst vergangenen Bildschirm gab. Niemand kann sie freigeben. Der
 * Aufräumer (`pos-reservation-sweeper`) holt sie erst nach 720 Minuten. Der
 * Kunde, der ohne Netz kaufen wollte, kann das Stück danach einen halben Tag
 * lang NICHT kaufen — auch nicht mit Netz. Drei angetippte Artikel sind drei
 * blockierte Stücke.
 *
 * Ein Halt ist FLÜCHTIG. Ihn später nachzuspielen ist nicht „spät", sondern
 * FALSCH: er sperrt Ware für einen Verkauf, den es nie gab. Deshalb scheitern
 * diese Wege ohne Netz sofort und ehrlich (`ApiNetworkError`), statt eine
 * Zusage zu geben, die sie nicht halten.
 *
 * ── FAUSTREGEL: GEHÖRT EIN NEUER WEG HIER HINEIN? ──────────────────────────
 * Hat der Aufruf eine HALTBARKEIT — verfällt sein Sinn, wenn er ein paar
 * Minuten später ankommt? Dann ist er flüchtig und gehört hierher.
 * Drei Proben, die das entscheiden:
 *   1. Wirkt ein Nachspielen in einer Welt, die sich inzwischen weiterbewegt
 *      hat, noch richtig? (Halt, Anmeldung, Abmeldung: NEIN.)
 *   2. Hängt an dem Aufruf ein Zustand, den nur der Aufrufer kennt — eine
 *      Sitzungskennung, eine Aufforderung, ein kurzlebiger Schlüssel? Wenn der
 *      Aufrufer weg ist, kann das Ergebnis niemand mehr einsammeln.
 *   3. Zählt die ANTWORT und nicht die Wirkung? (Ein signierter Ablage-Weg,
 *      eine Prüfung.) Dann ist der Aufruf ohne seinen Aufrufer wertlos.
 * Umgekehrt: alles, was einen dauerhaften WILLEN trägt — ein Beleg, ein
 * Ankauf, ein Stammdatensatz, eine Zählung, eine Nachricht — gehört NICHT
 * hierher. Bei ihm ist spät wirklich nur spät, und das Einreihen rettet ihn.
 *
 * Im Zweifel NICHT aufnehmen: ein zu Unrecht eingereihter Weg spielt spät ab,
 * ein zu Unrecht ausgeschlossener verliert den Willen der Kassiererin.
 */
export const FLUECHTIGE_PFADE: readonly string[] = [
  // Bestandshalte. Der gemessene Fall. Reservieren UND freigeben wirken beide
  // auf denselben verfallenden Halt; beide Aufrufstellen schlucken den Fehler
  // ohnehin (`safeRelease`, `releaseCart` mit allSettled), und der Aufräumer
  // ist der dauerhafte Rückhalt.
  '/api/inventory/reserve',
  '/api/inventory/release',
  '/api/inventory/release/batch',
  // Anmeldung und Aufforderung. Eine Anmeldung Stunden später nachzuspielen
  // ergibt keinen Sinn, und bis dahin läge ein Geheimnis 30 Tage lang
  // unverschlüsselt in der Ablage des Geräts.
  '/api/auth/pin-login',
  '/api/auth/step-up',
  '/api/auth/step-up/device',
  // Abmeldung. Nachgespielt trifft sie NICHT die Sitzung, die beendet werden
  // sollte, sondern die frische, an der gerade jemand arbeitet.
  '/api/auth/sign-out',
  '/api/auth/sign-out-all',
  // Kurzlebiger Ablage-Schlüssel: zählt nur als ANTWORT, und die kann niemand
  // mehr entgegennehmen, wenn der Bildschirm längst geschlossen ist.
  '/api/photos/upload-url',
  // Der Werkzeugkanal des Assistenten. Ein Gesprächszug, den man Stunden
  // später abspielt, ist kein Gespräch mehr.
  '/api/mcp',
  // Der Stripe-Leser am Tresen (27.07.2026, Gewerk „die eine Geste"). Ein
  // eingereihter Zahlungs-START, Stunden später nachgespielt, lässt den Leser
  // Geld von einem Kunden verlangen, der längst gegangen ist — Probe 1 und 3
  // der Faustregel oben treffen alle Unterwege: starten, abbrechen, erstatten
  // (die ANTWORT mit dem Erstattungsweg zählt, der Kunde steht am Tresen)
  // und die Leser-Verwaltung (Registrierungscode und Stufenanhebung
  // verfallen). Der Beleg selbst (/api/transactions/finalize) bleibt bewusst
  // einreihbar: IST die Karte belastet, rettet das Einreihen den Willen.
  '/api/stripe/terminal',
];

/**
 * Ist `path` ein flüchtiger Weg (genau oder als Unterweg)?
 *
 * Bewusst dieselbe Vergleichsform wie `isGobdRelevantPath`, damit die beiden
 * Listen nicht mit zwei verschiedenen Vorstellungen von „passt" auseinander-
 * laufen.
 */
export function istFluechtigerPfad(path: string): boolean {
  return FLUECHTIGE_PFADE.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * ⚠️ DER SITZUNGSSCHLÜSSEL GEHÖRT NICHT IN DEN AUSGANGSKORB (11.08.2026)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND ────────────────────────────────────────────────────────────
 * Hier stand `headers: { ...req.headers }`. Damit wanderte der
 * `Authorization: Bearer <Sitzung>` mit in die Zeile. Gemessen:
 *
 *     Versiegelter Kopf in der Zeile: Bearer TOKEN-VON-MONTAG
 *     Was WIRKLICH über die Leitung ging: Bearer TOKEN-VON-MONTAG
 *     Aktueller Schlüssel im Speicher: TOKEN-VON-DIENSTAG
 *     drainOutbox: { kind: 'aborted', reason: 'auth' }
 *     überhaupt versucht: [ 1 ]  noch in der Warteschlange: [ 'V-1','V-2','V-3' ]
 *
 * Die Personal-Sitzung läuft nach acht Stunden ab. Eine Kasse, die abends ohne
 * Netz einen Verkauf einreiht und am nächsten Morgen hochfährt, schickt den
 * toten Schlüssel von gestern. Auf Windows-WebView2 wird der Keks verworfen —
 * deshalb existiert der Bearer überhaupt —, also gibt es keinen zweiten Weg.
 * Der Server antwortet 401, der Abspieler bricht ab, und weil die Reihenfolge
 * streng ist, wird ALLES dahinter nicht einmal versucht. Jede neue Anmeldung
 * erzeugt einen NEUEN Schlüssel, während die Zeile den alten mitschleppt: die
 * Warteschlange löst sich nie von selbst. § 146 Abs. 1 AO, Einzelaufzeichnung
 * und zeitgerechte Erfassung — ein Verkauf, der die Bücher nie erreicht.
 *
 * ── WARUM DER NAHELIEGENDE WEG FALSCH IST ─────────────────────────────────
 * „Beim Abspielen den frischen Schlüssel danebenlegen" wirkt nicht: `client.ts`
 * setzt den Bearer nur, wenn noch KEINER da ist — und in der Zeile ist einer.
 * Der Tote gewinnt. Er darf gar nicht erst hineingelegt werden. Alles andere
 * am Kopf bleibt versiegelt: der Idempotenzschlüssel ist der Grund, warum ein
 * Nachspielen überhaupt sicher ist, und er verfällt nicht.
 *
 * `Cookie` ist derselbe Fall und wird gleich behandelt. Der Vergleich ist
 * kleingeschrieben, weil ein Kopf in JS zwar sortiert ankommt, aber nicht
 * normalisiert: `authorization` und `Authorization` sind beide möglich.
 */
export function ohneSitzungsschluessel(
  headers: Record<string, string>,
): Record<string, string> {
  const sauber: Record<string, string> = {};
  for (const [name, wert] of Object.entries(headers)) {
    const klein = name.toLowerCase();
    if (klein === 'authorization' || klein === 'cookie') continue;
    sauber[name] = wert;
  }
  return sauber;
}

export interface OfflineQueueDependencies {
  /** Durable outbox (Tauri-SQLite in production). */
  store: OutboxStore;
  /** Current connectivity. Production: `() => navigator.onLine`. */
  isOnline: () => boolean;
  /** Stable per-till identifier, embedded in every outbox row. */
  deviceId: string;
  /**
   * Idempotency-key generator for NON-fiscal mutations. Defaults to UUID v7.
   * Fiscal call sites supply their own key via `meta.custom.idempotencyKey`
   * (see ownership model below) and never hit this.
   */
  generateKey?: () => string;
  /**
   * Classifies a request as fiscally relevant (10y retention, GoBD §147).
   * A caller may also force it via `meta.custom.gobdRelevant === true`.
   * Defaults to non-fiscal.
   */
  classifyGobdRelevant?: (path: string, method: HttpMethod) => boolean;
}

const HEADER = 'idempotency-key';

/**
 * Idempotency-key ownership (ADR-0044 §4), the single hardest correctness
 * concern in Phase 3:
 *
 *   • FISCAL paths (ankauf / sales / storno / cash-movement / shift-close):
 *     the CALLER generates the key and persists its intent BEFORE invoking
 *     `client.request`, passing it via `meta.custom.idempotencyKey`. We must
 *     NOT generate it here — by the time the middleware runs, a crash would
 *     already have lost the intent↔key linkage on disk.
 *
 *   • NON-FISCAL mutations: the MIDDLEWARE auto-generates a UUID v7 for
 *     ergonomics, and tags `meta.custom.idempotencyKeyAutoGenerated = true`
 *     so an auditor can tell at a glance that loss-on-crash was acceptable
 *     for that row.
 */
export function offlineQueueMiddleware(deps: OfflineQueueDependencies): Middleware {
  const generateKey = deps.generateKey ?? uuidv7;
  const classifyGobd = deps.classifyGobdRelevant ?? ((path: string) => isGobdRelevantPath(path));

  return async (req, next): Promise<MiddlewareResponse> => {
    // Reads are never enqueued — only mutations have durable intent.
    if (req.method === 'GET' || req.method === 'HEAD') return next(req);
    // The replay loop sets this to prevent recursive re-enqueueing.
    if (req.meta.custom?.skipOfflineQueue === true) return next(req);

    const callerKey = req.meta.custom?.idempotencyKey;
    const callerSupplied = typeof callerKey === 'string' && callerKey.length > 0;
    const idempotencyKey = callerSupplied ? (callerKey as string) : generateKey();

    // Seal the key onto the outbound request + record the forensic flag.
    req.headers[HEADER] = idempotencyKey;
    req.meta.custom = {
      ...(req.meta.custom ?? {}),
      idempotencyKey,
      idempotencyKeyAutoGenerated: !callerSupplied,
    };

    const gobdRelevant =
      req.meta.custom?.gobdRelevant === true || classifyGobd(req.path, req.method);

    // Flüchtig? Dann ist der Ausgangskorb die falsche Antwort — siehe
    // FLUECHTIGE_PFADE. Einmal ausgerechnet, weil beide Einreih-Stellen
    // (bekannt offline und Netzfehler) dieselbe Entscheidung brauchen.
    const fluechtig = istFluechtigerPfad(req.path);

    const enqueue = async (cause?: unknown): Promise<never> => {
      if (fluechtig) {
        // Ehrlich sofort scheitern. Den ursprünglichen Transportfehler
        // durchreichen, wo es einen gibt: die Fläche soll den WAHREN Grund
        // sehen und nicht einen von uns nachgebauten.
        if (cause !== undefined) throw cause;
        throw new ApiNetworkError(
          `flüchtiger Weg ${req.path} nicht eingereiht — Gerät ist offline`,
        );
      }
      const enqueuedAt = Date.now();
      await deps.store.enqueue({
        idempotencyKey,
        traceId: req.meta.traceId ?? null,
        method: req.method,
        path: req.path,
        url: req.url,
        // ⚠️ NICHT `{ ...req.headers }` — siehe `ohneSitzungsschluessel`.
        headers: ohneSitzungsschluessel(req.headers),
        body: req.body,
        enqueuedAt,
        gobdRelevant,
        callerSuppliedKey: callerSupplied,
        deviceId: deps.deviceId,
      });
      throw new ApiOfflineQueuedError(idempotencyKey, enqueuedAt, cause);
    };

    // Known-offline: don't waste a network attempt — enqueue immediately.
    if (!deps.isOnline()) return enqueue();

    try {
      return await next(req);
    } catch (err) {
      // Only transport-level unreachability enqueues. A real 4xx/5xx from a
      // reachable server (validation, conflict, sanctions, …) is a genuine
      // outcome and must surface to the caller unchanged.
      if (err instanceof ApiNetworkError || err instanceof ApiCircuitOpenError) {
        return enqueue(err);
      }
      throw err;
    }
  };
}

/**
 * Common types re-exported across all api-client domain files.
 *
 * The stable `ApiErrorCode` enum mirrors `apps/api-cloud/src/plugins/error-handler.ts`
 * — keep them in sync. A backend PR that introduces a new code must add it
 * here in the same PR (CI guard candidate, Phase 1.5).
 */

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'STEP_UP_REQUIRED'
  | 'PIN_LOCKED'
  | 'CONFLICT'
  /** DATEV nicht eingerichtet — die Flaeche zeigt darauf ein Einrichtungsformular. */
  | 'DATEV_MANDANT_FEHLT'
  | 'SANCTIONS_BLOCK'
  | 'KYC_REQUIRED'
  | 'CLOSING_DAY_FINALIZED'
  // ⚠️ 30.07.2026 — FEHLTE. Der Server wirft `VatCheckRequiredError` mit einem
  // sorgfältig formulierten deutschen Grund, aber der Code stand in dieser
  // Aufzählung nicht. Damit konnte ihn `german-text.ts` gar nicht übersetzen:
  // der Kassierer sah den nichtssagenden Rückfallsatz, während der Server
  // genau erklärt hatte, was fehlt. Der Riegel über § 13b griff, und niemand
  // verstand warum. Wer hier einen Servercode vergisst, macht ihn stumm.
  | 'VAT_CHECK_REQUIRED'
  // Norns POS, offline: der gesäte Inhaber hat beim ERSTEN Start noch kein
  // Anmeldegeheimnis. Das ist kein „falscher Code", sondern ein anderer
  // Zustand, und die Kasse muss ihn unterscheiden können — sonst zeigt sie
  // dem Händler „falsch" für etwas, das er noch gar nicht gesetzt hat.
  | 'PIN_NOT_SET'
  | 'STORNO_OF_STORNO'
  | 'PRODUCT_NOT_RESERVABLE'
  | 'DEVICE_NOT_AUTHORIZED'
  /** Die Kasse ist nicht freigeschaltet. Betrifft NUR neue Verkaeufe und
   *  Ankaeufe; Abschluss, Storno und Ausfuhren bleiben offen. */
  | 'LIZENZ_FEHLT'
  /** Metallkurs von Hand ausserhalb des Bandes um den laufenden Kurs. */
  | 'RATE_LIMITED'
  | 'EXTERNAL_SERVICE_FAILED'
  /** An optional capability (Stripe/R2/AI) is not configured — a 503, not a crash. */
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface RequestOptions {
  /** Abort the request when the signal fires. Plumbs through to `fetch`. */
  signal?: AbortSignal;
  /** Override the per-request timeout in ms (default: client-level). */
  timeoutMs?: number;
  /** Additional headers — merged with the client defaults. */
  headers?: Record<string, string>;
  /**
   * Stable route label for telemetry, e.g. `/ankauf/:id` (so telemetry can
   * group attempts on the same logical endpoint even when the URL contains
   * IDs). If omitted, telemetry falls back to the raw path.
   */
  routeTemplate?: string;
  /**
   * Seed for `meta.custom` — the cross-cutting channel middlewares read.
   * Recognized keys: `skipStepUp`, `skipOfflineQueue`, `idempotencyKey`,
   * `idempotent`, `gobdRelevant`. Used by the session probe (`skipStepUp`)
   * and by the outbox replay loop (`skipOfflineQueue` + `skipStepUp` +
   * `idempotencyKey`) to drive requests through the chain without recursion.
   */
  custom?: Record<string, unknown>;
  /**
   * Response handling for the SUCCESS (2xx) case. `'json'` (default) parses the
   * body as JSON; `'text'` returns the raw response text unparsed — used for
   * file downloads (CSV exports) whose body isn't JSON; `'arraybuffer'` returns
   * the raw bytes (used for binary downloads like the private KYC image).
   * Error (non-2xx) responses are ALWAYS parsed as the JSON error envelope, so
   * middlewares (e.g. the step-up interceptor) still fire on a 403.
   */
  responseType?: 'json' | 'text' | 'arraybuffer';
}

export interface ApiClientConfig {
  /** Base URL of the API — e.g. `https://api.warehouse14.de` or `http://localhost:3001`. */
  baseUrl: string;
  /** Default timeout per request, in milliseconds. Default: 15_000. */
  timeoutMs?: number;
  /** Include credentials (cookies) — Tauri webview sets this to `'include'`. */
  credentials?: RequestCredentials;
  /** Extra default headers, e.g. `{ 'X-Dev-Device-Fingerprint': '…' }` in dev. */
  defaultHeaders?: Record<string, string>;
  /**
   * Optional bearer-token provider, evaluated per request. When it returns a
   * non-empty string the client adds `Authorization: Bearer <token>`. Seit dem
   * 11.08.2026 gewinnt dieser LEBENDE Schlüssel immer: ein vom Aufrufer
   * mitgebrachter `Authorization`-Kopf wird verworfen, weil die einzige Quelle
   * dafür der Ausgangskorb mit einem GESTERN versiegelten Schlüssel war (siehe
   * `client.ts`). Ohne Sitzung geht gar kein Kopf — ein ehrlicher 401 ist
   * besser als ein toter Schlüssel. This is the durable auth
   * path for the Tauri webview on Windows (WebView2 @ the non-secure
   * `http://tauri.localhost` origin), where the cross-site `SameSite=None;
   * Secure` session cookie is dropped. Cookie auth still applies where the
   * browser keeps it; the header is an additive fallback.
   */
  getAuthToken?: () => string | null | undefined;
  /**
   * Middleware chain. Outermost first; the terminal `fetch` runs after the
   * last entry. Order is load-bearing — see ADR-0042 + ADR-0043 in
   * `docs/architecture/adr/`. Omit for a raw client (used by the session
   * probe and by integration tests that want deterministic terminal
   * behaviour without retries/dedup).
   *
   * Imported as `Middleware` from `./middleware.js` — kept untyped here to
   * avoid a circular import; consumers should use the const factory exported
   * from `apps/tauri-pos/src/lib/api-context.tsx` (`productionMiddlewares`).
   */
  middlewares?: readonly import('./middleware.js').Middleware[];
}

/**
 * The thin `request()` helper + the `ApiClient` carrier object every domain
 * cluster consumes. Domain methods receive an `ApiClient` and call
 * `client.request(...)` — they never see `fetch` directly.
 *
 * As of ADR-0042/0043, `request()` drives a middleware chain. The public
 * surface is unchanged — every existing call site (auth-pin, products,
 * customers, transactions, ankauf, photos, ebay, dashboard, …) works
 * without edits.
 *
 * Layering (innermost → outermost):
 *   terminal fetch  →  user-supplied middlewares (in order)  →  caller
 *
 * Timeout + abort composition lives in the public `request()` entrypoint,
 * NOT inside the terminal — this way every middleware sees the already-
 * composed signal and can short-circuit cleanly when the caller aborts.
 * The composeSignals helper also fixes the prior listener leak (see
 * internal/abort.ts).
 */

import { ApiError, ApiNetworkError } from './errors.js';
import { TimeoutError, composeSignals } from './internal/abort.js';
import {
  type HttpMethod,
  type Middleware,
  type MiddlewareRequest,
  type MiddlewareResponse,
  type Next,
  compose,
} from './middleware.js';
import type { ApiClientConfig, ApiErrorCode, RequestOptions } from './types.js';

export interface ApiClient {
  readonly baseUrl: string;
  /**
   * Issue an HTTP request and parse the response shape. Non-2xx throws
   * `ApiError` (with the stable `code`); network failures throw
   * `ApiNetworkError`. 204 / empty bodies return `undefined`.
   */
  request<T>(method: HttpMethod, path: string, body?: unknown, opts?: RequestOptions): Promise<T>;

  /**
   * Wie `request`, gibt aber zusätzlich den Dateinamen zurück, den der SERVER
   * im Kopf `Content-Disposition` genannt hat.
   *
   * ── WARUM ES DAS GEBEN MUSS (26.07.2026) ─────────────────────────────────
   * Bei DATEV ist der Dateiname Teil des Vertrags: er muss mit `EXTF_`
   * beginnen, sonst erscheint die Datei in der Stapelverarbeitung des
   * Steuerberaters überhaupt nicht (Meldung REW04506) und wirkt, als wäre sie
   * nie angekommen. Der richtige Name enthält Berater- und Mandantennummer,
   * die nur der Server kennt.
   *
   * Bis heute erfanden ihn FÜNF Stellen in den Oberflächen parallel
   * (`DATEV_2026-06-06.csv`). Jetzt kommt er aus der einen Stelle, die ihn
   * kennen kann.
   */
  requestMitDateiname<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    opts?: RequestOptions,
  ): Promise<{ inhalt: T; dateiname: string | null }>;
}

/** `attachment; filename="EXTF_….csv"` → `EXTF_….csv`. */
export function dateinameAusKopf(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(contentDisposition);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

interface ErrorEnvelope {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
    details?: unknown;
    /** WO es passierte, z. B. NORNS-BARGELD-OHNE-SCHICHT. */
    stelle?: string;
  };
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const defaultTimeout = config.timeoutMs ?? 15_000;
  const middlewares: readonly Middleware[] = config.middlewares ?? [];

  const terminal: Next = createTerminal(config);
  const chain: Next = compose(middlewares, terminal);

  /**
   * Der gemeinsame Rumpf. `request` gibt nur die Nutzlast zurück,
   * `requestMitDateiname` zusätzlich den Namen aus dem Antwortkopf. Beide
   * gehen durch DIESE eine Stelle, damit sie nie auseinanderlaufen.
   */
  async function requestVoll(
    method: HttpMethod,
    path: string,
    body?: unknown,
    opts: RequestOptions = {},
  ): Promise<{ data: unknown; headers?: Headers }> {
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    // The request-level signal carries ONLY the caller's cancellation. The
    // timeout travels via meta and is composed PER ATTEMPT in the terminal —
    // otherwise awaiting the step-up PIN dialog or a retry backoff burns the
    // network window and the replay aborts instantly (felt as a wrongful
    // reject after typing the PIN slowly).
    const signal = opts.signal ?? new AbortController().signal;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...config.defaultHeaders,
      ...opts.headers,
    };
    /**
     * ⚠️ DER SITZUNGSSCHLÜSSEL KOMMT AUS DER SITZUNG, NIE AUS EINEM KOPF
     * ═════════════════════════════════════════════════════════════════════
     *
     * ── DER BEFUND VOM 11.08.2026 ────────────────────────────────────────
     * Hier stand: „setze den Bearer nur, wenn der Aufrufer keinen mitbringt".
     * Genau einer bringt einen mit — der Abspieler des Ausgangskorbs, mit dem
     * Kopf, der GESTERN versiegelt wurde. Gemessen:
     *
     *     Versiegelter Kopf in der Zeile: Bearer TOKEN-VON-MONTAG
     *     Was WIRKLICH über die Leitung ging: Bearer TOKEN-VON-MONTAG
     *     Aktueller Schlüssel im Speicher: TOKEN-VON-DIENSTAG
     *
     * Der tote Schlüssel gewann also gegen den lebenden. Auf der Windows-Kasse
     * gibt es keinen zweiten Weg (WebView2 verwirft den Keks), also 401 — und
     * weil die Reihenfolge im Korb streng ist, stand danach ALLES dahinter.
     *
     * ── WARUM ZWEI RIEGEL, NICHT EINER ───────────────────────────────────
     * `offlineQueueMiddleware` legt den Schlüssel seit demselben Tag gar nicht
     * mehr in den Korb. Das rettet aber nur NEUE Zeilen. Auf ausgelieferten
     * Kassen liegen ALTE Zeilen mit versiegeltem Schlüssel — die lösen sich
     * nur, wenn der lebende Schlüssel hier gewinnt.
     *
     * Kein Aufrufer in diesem Haus setzt `Authorization` selbst; die einzige
     * Quelle war die versiegelte Zeile. Ist keine Sitzung da, wird gar keiner
     * geschickt: ein ehrlicher 401 ist besser als ein toter Schlüssel.
     */
    delete headers.Authorization;
    delete headers.authorization;
    const authToken = config.getAuthToken?.();
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const req: MiddlewareRequest = {
      method,
      url,
      path,
      headers,
      body,
      signal,
      meta: {
        attempt: 1,
        startedAt: performance.now(),
        timeoutMs: opts.timeoutMs ?? defaultTimeout,
        ...(opts.routeTemplate !== undefined ? { routeTemplate: opts.routeTemplate } : {}),
        ...(opts.custom !== undefined ? { custom: opts.custom } : {}),
        ...(opts.responseType !== undefined ? { responseType: opts.responseType } : {}),
      },
    };

    const res = await chain(req);
    return { data: res.data, ...(res.headers ? { headers: res.headers } : {}) };
  }

  async function request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    opts: RequestOptions = {},
  ): Promise<T> {
    return (await requestVoll(method, path, body, opts)).data as T;
  }

  async function requestMitDateiname<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    opts: RequestOptions = {},
  ): Promise<{ inhalt: T; dateiname: string | null }> {
    const res = await requestVoll(method, path, body, opts);
    return {
      inhalt: res.data as T,
      dateiname: dateinameAusKopf(res.headers?.get('content-disposition') ?? null),
    };
  }

  return { baseUrl, request, requestMitDateiname };
}

function createTerminal(config: ApiClientConfig): Next {
  return async (req: MiddlewareRequest): Promise<MiddlewareResponse> => {
    // Fresh timeout window PER ATTEMPT (composed with the caller signal). Every
    // retry and the post-PIN step-up replay each get the full budget — and time
    // spent in the PIN dialog or a retry sleep costs nothing.
    const { signal, cleanup } = composeSignals(req.signal, req.meta.timeoutMs ?? 15_000);
    let res: Response;
    try {
      res = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        credentials: config.credentials ?? 'include',
        signal,
        body: req.body !== undefined ? JSON.stringify(req.body) : null,
      });
    } catch (err) {
      // Distinguish timeout from generic network/abort so UX can react
      // differently. The retry middleware also uses this distinction.
      if (signal.aborted && signal.reason instanceof TimeoutError) {
        throw new ApiNetworkError(signal.reason.message, signal.reason);
      }
      throw new ApiNetworkError(
        err instanceof Error ? err.message : 'unknown network failure',
        err,
      );
    } finally {
      cleanup();
    }

    const requestId = res.headers.get('x-request-id');
    const traceId = req.meta.traceId ?? null;
    const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));

    // No body case (204, HEAD-like).
    if (res.status === 204 || res.headers.get('Content-Length') === '0') {
      if (!res.ok) {
        throw new ApiError({
          code: mapHttpStatus(res.status),
          message: `HTTP ${res.status} (no body)`,
          httpStatus: res.status,
          requestId,
          details: retryAfterMs !== undefined ? { retryAfterMs } : undefined,
        });
      }
      return { data: undefined, status: res.status, headers: res.headers, requestId, traceId };
    }

    // Binary download (e.g. the private KYC image): on success, return the raw
    // bytes. Must read the body as an ArrayBuffer BEFORE any res.text() (the
    // body can only be consumed once). Errors fall through to the text + JSON
    // envelope path below, so the step-up interceptor still fires on a 403.
    if (res.ok && req.meta.responseType === 'arraybuffer') {
      const buffer = await res.arrayBuffer();
      return { data: buffer, status: res.status, headers: res.headers, requestId, traceId };
    }

    const text = await res.text();

    // File download (CSV exports): on success, return the body verbatim — it is
    // not JSON, so we must NOT JSON.parse it. Errors still fall through to the
    // JSON-envelope path below, so the step-up interceptor fires on a 403.
    if (res.ok && req.meta.responseType === 'text') {
      return { data: text, status: res.status, headers: res.headers, requestId, traceId };
    }

    let parsed: unknown;
    try {
      parsed = text.length === 0 ? undefined : JSON.parse(text);
    } catch {
      throw new ApiError({
        code: 'INTERNAL_ERROR',
        message: `non-JSON body (HTTP ${res.status})`,
        httpStatus: res.status,
        requestId,
        details: { text: text.slice(0, 200) },
      });
    }

    if (!res.ok) {
      const envelope = parsed as Partial<ErrorEnvelope>;
      const e = envelope?.error;
      throw new ApiError({
        code: e?.code ?? mapHttpStatus(res.status),
        message: e?.message ?? `HTTP ${res.status}`,
        httpStatus: res.status,
        requestId: e?.requestId ?? requestId,
        details: mergeRetryAfter(e?.details, retryAfterMs),
        // Die Stelle, sofern der Motor sie mitschickt. Ein älterer Motor
        // schickt sie nicht; dann bleibt sie null statt erfunden zu werden.
        stelle: e?.stelle ?? null,
      });
    }

    return { data: parsed, status: res.status, headers: res.headers, requestId, traceId };
  };
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function mergeRetryAfter(details: unknown, retryAfterMs: number | undefined): unknown {
  if (retryAfterMs === undefined) return details;
  if (details && typeof details === 'object') return { ...details, retryAfterMs };
  return { retryAfterMs };
}

function mapHttpStatus(status: number): ApiErrorCode {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422) return 'VALIDATION_ERROR';
  if (status === 429) return 'RATE_LIMITED';
  return 'INTERNAL_ERROR';
}

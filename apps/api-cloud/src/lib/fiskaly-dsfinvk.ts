/**
 * Fiskaly DSFinV-K client (Epic K — Part 1).
 *
 * Pushes a day's cash-point closing to the Fiskaly DSFinV-K cloud, which
 * assembles the BMF-mandated DSFinV-K export bundle for a Finanzamt audit.
 * Same `fetchImpl`-injection pattern as opensanctions.ts so it is unit-testable
 * without the network.
 *
 * FAIL-SAFE (memory.md #63): a year-end export is important, but a transient
 * Fiskaly outage must NEVER block the daily-closing flow. Every failure mode —
 * missing credentials, timeout, non-2xx — resolves to `{ error: string }` and
 * is logged by the caller; nothing throws.
 *
 * ── DER FUND (26.07.2026) ──────────────────────────────────────────────────
 * Dieser Weg hat sich mit BASIC-AUTH angemeldet, also mit dem API-Schlüssel
 * als Benutzernamen. Gemessen gegen die echte Schnittstelle mit Basels
 * Testzugang:
 *
 *   GET /api/v1/exports   Authorization: Basic base64(key:secret)
 *   → 401  "Authorization header must follow the format
 *           \"Authorization: Bearer ...\""
 *
 *   POST /api/v1/auth  {api_key, api_secret}
 *   → 200  access_token
 *
 * Der DSFinV-K-Weg konnte also NIE etwas hochladen. Das ist **derselbe
 * Fehler wie im TSE-Weg der Kasse**, an einer zweiten Stelle: der Schlüssel
 * ist kein Token. Beide blieben unentdeckt, weil die Zugangsdaten in der
 * Produktion leer sind und der Aufruf dann still übersprungen wird — der
 * Fehler kann erst auftreten, wenn jemand echte Daten einträgt.
 *
 * Hier wie dort: einmal tauschen, das Token im Speicher halten, mit
 * Sicherheitspuffer vor dem Ablauf, und einer Sperre um den Tausch, damit
 * zwei gleichzeitige Abschlüsse EINEN Tausch auslösen.
 */

export interface FiskalyConfig {
  apiKey: string;
  apiSecret: string;
}

/**
 * Wie lange vor dem Ablauf ein Token als verbraucht gilt.
 *
 * Ohne Puffer holt ein Aufruf ein Token, das zwischen Prüfung und Ankunft am
 * Server abläuft — ein Fehler, der nur unter Last auftritt und sich nicht
 * nachstellen lässt.
 */
const TOKEN_SICHERHEITSPUFFER_S = 120;

interface Zugangstoken {
  wert: string;
  laeuftAbUm: number;
  /** An welchen Schlüssel das Token gebunden ist. Wechselt der Zugang, ist es wertlos. */
  fuerSchluessel: string;
}

let gehaltenesToken: Zugangstoken | null = null;
let laufenderTausch: Promise<string> | null = null;

/** Nur für Tests: den Tokenspeicher leeren. */
export function _tokenSpeicherLeeren(): void {
  gehaltenesToken = null;
  laufenderTausch = null;
}

/**
 * Den API-Schlüssel gegen ein Zugriffstoken tauschen.
 *
 * Wirft bei Misserfolg; die aufrufenden Handgriffe fangen und geben
 * `{ error }` zurück, damit der Tagesabschluss nie stehenbleibt.
 */
async function zugangstoken(
  config: FiskalyConfig,
  baseUrl: string,
  fetchImpl: FiskalyFetch,
  timeoutMs: number,
): Promise<string> {
  const jetzt = Math.floor(Date.now() / 1000);
  const t = gehaltenesToken;
  if (t && t.fuerSchluessel === config.apiKey && t.laeuftAbUm - TOKEN_SICHERHEITSPUFFER_S > jetzt) {
    return t.wert;
  }
  if (laufenderTausch) return laufenderTausch;

  laufenderTausch = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${baseUrl}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: config.apiKey, api_secret: config.apiSecret }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`fiskaly auth failed: HTTP ${res.status}`);
      }
      const data = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!data.access_token) {
        throw new Error('fiskaly auth response missing access_token');
      }
      gehaltenesToken = {
        wert: data.access_token,
        // Ohne `expires_in` konservativ eine Stunde annehmen, nicht ewig.
        laeuftAbUm: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
        fuerSchluessel: config.apiKey,
      };
      return data.access_token;
    } finally {
      clearTimeout(timer);
      laufenderTausch = null;
    }
  })();

  return laufenderTausch;
}

/** Opaque DSFinV-K cash-point-closing payload (BMF schema, built by caller). */
export type CashPointClosing = Record<string, unknown>;

export interface FiskalyError {
  error: string;
}

export type PushClosingResult = { exportId: string } | FiskalyError;

/**
 * Ein angestossener Auszug ist NICHT sofort fertig. `state` läuft über
 * PENDING nach COMPLETED; eine Adresse zum Herunterladen gibt es erst danach,
 * über `exportDownloadHref`.
 */
export type TriggerExportResult = { exportId: string; state: string } | FiskalyError;

export type FiskalyFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal | undefined;
  },
) => Promise<Response>;

export interface FiskalyClientOptions {
  baseUrl?: string;
  fetchImpl?: FiskalyFetch;
  /** Hard timeout in ms (default 15_000). */
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'https://dsfinvk.fiskaly.com/api/v1';
const DEFAULT_TIMEOUT_MS = 15_000;
const defaultFetch: FiskalyFetch = (input, init) => fetch(input, init as RequestInit | undefined);

export function isFiskalyConfigured(config: FiskalyConfig): boolean {
  return config.apiKey.length > 0 && config.apiSecret.length > 0;
}

/**
 * Verengungshilfe, damit Aufrufer ohne Typzusicherung auf Erfolg verzweigen.
 *
 * Über das Ergebnis verallgemeinert, und das ist kein Feinschliff: die
 * Ergebnisse sind Vereinigungen wie `{ exportId } | { error }`, und der
 * Erfolgszweig hat mit `{ error?: string }` KEINE Eigenschaft gemeinsam.
 * TypeScript lehnt so einen Wert ab (Erkennung schwacher Typen), sodass jeder
 * Aufruf eine Zusicherung gebraucht hätte. Gemerkt hat das niemand, weil die
 * Tests bis zum 26.07.2026 gar nicht typgeprüft wurden.
 */
export function isFiskalyError<T extends object>(r: T): r is T & FiskalyError {
  return typeof (r as { error?: unknown }).error === 'string';
}

/**
 * Einen Tagesabschluss bei fiskaly einstellen.
 *
 * ── DER ZWEITE FUND (26.07.2026) ───────────────────────────────────────────
 * Hier stand `POST /cash_point_closings`. Diesen Weg gibt es nicht:
 *
 *   POST /api/v1/cash_point_closings  → 404  "Path does not exist"
 *
 * Die Fassung 1.27.7 der Schnittstelle, abgelesen aus ihrer eigenen
 * Beschreibung unter `/_spec.json`, kennt nur:
 *
 *   PUT /cash_point_closings/{closing_id}
 *
 * Der AUFRUFER vergibt die Kennung, nicht der Dienst — dasselbe Muster wie
 * beim TSE-Weg. Das macht den Aufruf nebenbei wiederholbar: derselbe
 * Tagesabschluss zweimal geschickt erzeugt keinen zweiten Eintrag.
 *
 * `closingId` ist deshalb ein Pflichtwert, kein Zufall im Innern: ein zweiter
 * Versuch nach einem Netzfehler MUSS dieselbe Kennung tragen, und nur der
 * Aufrufer weiss, ob es ein zweiter Versuch ist.
 */
export async function pushCashPointClosing(
  config: FiskalyConfig,
  closingId: string,
  closing: CashPointClosing,
  opts: FiskalyClientOptions = {},
): Promise<PushClosingResult> {
  if (!isFiskalyConfigured(config)) {
    return { error: 'fiskaly not configured' };
  }
  if (!closingId) {
    return { error: 'fiskaly closing id missing' };
  }

  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const token = await zugangstoken(config, baseUrl, fetchImpl, timeoutMs);
    const res = await fetchImpl(
      `${baseUrl}/cash_point_closings/${encodeURIComponent(closingId)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(closing),
        signal: controller.signal,
      },
    );

    if (!res.ok) {
      return { error: `fiskaly cash_point_closings failed: HTTP ${res.status}` };
    }

    // Die Antwort trägt `closing_id`. `_id` und `id` bleiben als Rückfall
    // stehen, falls eine ältere Fassung der Schnittstelle antwortet.
    const data = (await res.json()) as { closing_id?: string; _id?: string; id?: string };
    const exportId = data.closing_id ?? data._id ?? data.id;
    if (!exportId) {
      return { error: 'fiskaly response missing closing id' };
    }
    return { exportId };
  } catch (err) {
    return { error: `fiskaly cash_point_closings unreachable: ${describeError(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Einen DSFinV-K-Auszug anstossen.
 *
 * ── DER DRITTE FUND (26.07.2026) ───────────────────────────────────────────
 * Hier stand `POST /exports` mit `{cash_point_closing_id}` im Körper. Auch
 * diesen Weg gibt es nicht (404). Richtig ist `PUT /exports/{export_id}`,
 * wieder mit einer Kennung, die der Aufrufer vergibt.
 *
 * Und die Antwort trägt KEINE Adresse zum Herunterladen. Der Auszug wird
 * erzeugt, sein `state` läuft über PENDING nach COMPLETED, und erst dann
 * liefert `GET /exports/{id}/href` die Adresse. Die alte Fassung las
 * `download_url` aus einer Antwort, die dieses Feld nie hatte — sie hätte
 * also selbst dann „fiskaly response missing download_url" gemeldet, wenn
 * alles davor gestimmt hätte.
 *
 * Deshalb gibt dieser Handgriff jetzt den Zustand zurück, nicht eine Adresse.
 * Wer die Datei will, fragt danach, wenn der Auszug fertig ist. Ein Aufruf,
 * der so tut, als sei etwas sofort da, wäre wieder die halbe Wahrheit.
 */
export async function triggerExport(
  config: FiskalyConfig,
  exportId: string,
  opts: FiskalyClientOptions & { clientId?: string } = {},
): Promise<TriggerExportResult> {
  if (!isFiskalyConfigured(config)) {
    return { error: 'fiskaly not configured' };
  }
  if (!exportId) {
    return { error: 'fiskaly export id missing' };
  }

  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const token = await zugangstoken(config, baseUrl, fetchImpl, timeoutMs);
    const res = await fetchImpl(`${baseUrl}/exports/${encodeURIComponent(exportId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(opts.clientId ? { client_id: opts.clientId } : {}),
      signal: controller.signal,
    });

    if (!res.ok) {
      return { error: `fiskaly exports failed: HTTP ${res.status}` };
    }

    const data = (await res.json()) as { state?: string; _id?: string };
    if (!data.state) {
      return { error: 'fiskaly response missing export state' };
    }
    return { exportId: data._id ?? exportId, state: data.state };
  } catch (err) {
    return { error: `fiskaly exports unreachable: ${describeError(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Die Adresse zum Herunterladen holen — erst sinnvoll, wenn der Auszug
 * COMPLETED ist. Vorher antwortet der Dienst mit einem Fehler, und genau den
 * geben wir weiter, statt eine leere Adresse zu erfinden.
 */
export async function exportDownloadHref(
  config: FiskalyConfig,
  exportId: string,
  opts: FiskalyClientOptions = {},
): Promise<{ downloadUrl: string } | FiskalyError> {
  if (!isFiskalyConfigured(config)) {
    return { error: 'fiskaly not configured' };
  }

  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const token = await zugangstoken(config, baseUrl, fetchImpl, timeoutMs);
    const res = await fetchImpl(`${baseUrl}/exports/${encodeURIComponent(exportId)}/href`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { error: `fiskaly export href failed: HTTP ${res.status}` };
    }
    const data = (await res.json()) as { href?: string; download_url?: string };
    const downloadUrl = data.href ?? data.download_url;
    if (!downloadUrl) {
      return { error: 'fiskaly response missing href' };
    }
    return { downloadUrl };
  } catch (err) {
    return { error: `fiskaly export href unreachable: ${describeError(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

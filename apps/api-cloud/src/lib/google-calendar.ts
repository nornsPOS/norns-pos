/**
 * google-calendar — server-side Google Calendar access via a SERVICE ACCOUNT.
 *
 * The service-account JSON (base64) lives in the server env as
 * GOOGLE_SERVICE_ACCOUNT_B64 and never leaves the box; the target calendar is
 * GOOGLE_CALENDAR_ID. We mint a short-lived OAuth access token by signing a
 * JWT with the account's private key (RS256) — no googleapis dependency — and
 * call the Calendar v3 REST API. This gives the POS full read/write control of
 * one shop calendar (list/create/update/delete events), and is the same layer
 * the future WhatsApp/booking flow will use.
 */

import { createSign } from 'node:crypto';

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description: string | null;
  location: string | null;
  start: string; // ISO (or YYYY-MM-DD for all-day)
  end: string | null;
  allDay: boolean;
  htmlLink: string | null;
}

export interface CalendarEventInput {
  summary: string;
  description?: string | null;
  location?: string | null;
  start: string; // ISO datetime
  end?: string | null; // ISO datetime; defaults to start + 1h
  allDay?: boolean;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar';
const TZ = 'Europe/Berlin';

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

let cachedSa: ServiceAccount | null | undefined;
function serviceAccount(): ServiceAccount | null {
  if (cachedSa !== undefined) return cachedSa;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  if (!b64) {
    cachedSa = null;
    return null;
  }
  try {
    const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as ServiceAccount;
    cachedSa = json.client_email && json.private_key ? json : null;
  } catch {
    cachedSa = null;
  }
  return cachedSa;
}

export function calendarConfigured(): boolean {
  return serviceAccount() !== null && (process.env.GOOGLE_CALENDAR_ID ?? '').length > 0;
}

function calendarId(): string {
  return process.env.GOOGLE_CALENDAR_ID ?? '';
}

/** Cached access token (Google tokens last 3600s; refresh at 3300s). */
let tokenCache: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt > now + 60) return tokenCache.token;

  const sa = serviceAccount();
  if (!sa) throw new GoogleCalendarError('Service-Account nicht konfiguriert.', 503);

  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  // Optional Domain-Wide-Delegation impersonation: when GOOGLE_CALENDAR_IMPERSONATE
  // is set, the SA acts AS that Workspace user (e.g. admin@warehouse14.de), so
  // GOOGLE_CALENDAR_ID can be that user's own primary calendar — the same one
  // their phone uses by default (no separate shared calendar to select).
  const claimObj: Record<string, unknown> = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const subject = process.env.GOOGLE_CALENDAR_IMPERSONATE;
  if (subject && subject.length > 0) claimObj.sub = subject;
  const claim = b64url(JSON.stringify(claimObj));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const jwt = `${header}.${claim}.${b64url(signer.sign(sa.private_key))}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !j.access_token) {
    throw new GoogleCalendarError(`Token-Fehler: ${j.error ?? res.status}`, 502);
  }
  tokenCache = { token: j.access_token, expiresAt: now + (j.expires_in ?? 3600) };
  return j.access_token;
}

export class GoogleCalendarError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'GoogleCalendarError';
  }
}

interface RawEvent {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

function toEvent(raw: RawEvent): CalendarEvent {
  const allDay = typeof raw.start?.date === 'string';
  return {
    id: raw.id ?? '',
    summary: raw.summary ?? '',
    description: raw.description ?? null,
    location: raw.location ?? null,
    start: raw.start?.dateTime ?? raw.start?.date ?? '',
    end: raw.end?.dateTime ?? raw.end?.date ?? null,
    allDay,
    htmlLink: raw.htmlLink ?? null,
  };
}

function toGoogleTimes(input: CalendarEventInput): { start: object; end: object } {
  if (input.allDay) {
    const day = input.start.slice(0, 10);
    const endDay = (input.end ?? input.start).slice(0, 10);
    return { start: { date: day }, end: { date: endDay } };
  }
  const end = input.end ?? new Date(new Date(input.start).getTime() + 3600_000).toISOString();
  return {
    start: { dateTime: input.start, timeZone: TZ },
    end: { dateTime: end, timeZone: TZ },
  };
}

async function call(path: string, init?: RequestInit): Promise<unknown> {
  const token = await accessToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init?.headers },
  });
  if (res.status === 204) return null;
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) {
    throw new GoogleCalendarError(body.error?.message ?? `Kalender-Fehler (${res.status})`, res.status);
  }
  return body;
}

export async function listEvents(opts?: { daysAhead?: number; max?: number }): Promise<CalendarEvent[]> {
  const now = new Date();
  const until = new Date(now.getTime() + (opts?.daysAhead ?? 28) * 86_400_000);
  const qs = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMin: now.toISOString(),
    timeMax: until.toISOString(),
    maxResults: String(opts?.max ?? 100),
  });
  const j = (await call(`/calendars/${encodeURIComponent(calendarId())}/events?${qs}`)) as {
    items?: RawEvent[];
  };
  return (j.items ?? []).map(toEvent);
}

export async function createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
  const body = {
    summary: input.summary,
    description: input.description ?? undefined,
    location: input.location ?? undefined,
    ...toGoogleTimes(input),
  };
  const j = (await call(`/calendars/${encodeURIComponent(calendarId())}/events`, {
    method: 'POST',
    body: JSON.stringify(body),
  })) as RawEvent;
  return toEvent(j);
}

export async function updateEvent(id: string, input: CalendarEventInput): Promise<CalendarEvent> {
  const body = {
    summary: input.summary,
    description: input.description ?? undefined,
    location: input.location ?? undefined,
    ...toGoogleTimes(input),
  };
  const j = (await call(
    `/calendars/${encodeURIComponent(calendarId())}/events/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  )) as RawEvent;
  return toEvent(j);
}

export async function deleteEvent(id: string): Promise<void> {
  await call(`/calendars/${encodeURIComponent(calendarId())}/events/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export interface WatchChannel {
  id: string;
  resourceId: string;
  /** epoch millis the channel expires (Google returns ms as a string). */
  expiration: number;
}

/** Register an events.watch push channel pointed at our webhook. */
export async function watchEvents(input: {
  channelId: string;
  address: string;
  token: string;
  ttlSeconds?: number;
}): Promise<WatchChannel> {
  const body = {
    id: input.channelId,
    type: 'web_hook',
    address: input.address,
    token: input.token,
    ...(input.ttlSeconds ? { params: { ttl: String(input.ttlSeconds) } } : {}),
  };
  const j = (await call(`/calendars/${encodeURIComponent(calendarId())}/events/watch`, {
    method: 'POST',
    body: JSON.stringify(body),
  })) as { id?: string; resourceId?: string; expiration?: string };
  return {
    id: j.id ?? input.channelId,
    resourceId: j.resourceId ?? '',
    expiration: Number(j.expiration ?? 0),
  };
}

/** Stop a previously-created channel (best-effort; 404 = already gone). */
export async function stopChannel(channelId: string, resourceId: string): Promise<void> {
  const token = await accessToken();
  const res = await fetch(`${API}/channels/stop`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: channelId, resourceId }),
  });
  if (!res.ok && res.status !== 404) {
    const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new GoogleCalendarError(b.error?.message ?? `channel stop (${res.status})`, res.status);
  }
}

export interface SyncedEvent {
  id: string;
  status: string; // 'confirmed' | 'tentative' | 'cancelled'
  summary: string | null;
  description: string | null;
  startIso: string | null; // dateTime (null for all-day / cancelled stubs)
  endIso: string | null;
  created: string | null;
}

interface RawSyncEvent extends RawEvent {
  status?: string;
  created?: string;
}

/**
 * Incremental sync (Google → us). Pass the stored `syncToken` to get only the
 * events that changed since last time; omit it for an initial bounded sync
 * (which also returns the first `nextSyncToken`). Cancelled/deleted events come
 * back with status='cancelled'. A 410 means the token expired → caller should
 * re-run a full sync (`fullResyncNeeded`).
 */
export async function syncEvents(
  syncToken?: string | null,
): Promise<{ events: SyncedEvent[]; nextSyncToken: string | null; fullResyncNeeded: boolean }> {
  const base = `/calendars/${encodeURIComponent(calendarId())}/events`;
  const events: SyncedEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;

  do {
    const qs = new URLSearchParams({
      singleEvents: 'true',
      showDeleted: 'true',
      maxResults: '250',
    });
    if (syncToken) qs.set('syncToken', syncToken);
    // First sync only (syncToken + timeMin are mutually exclusive): bound the
    // window so we don't import ancient history.
    else qs.set('timeMin', new Date(Date.now() - 86_400_000).toISOString());
    if (pageToken) qs.set('pageToken', pageToken);

    let body: { items?: RawSyncEvent[]; nextPageToken?: string; nextSyncToken?: string };
    try {
      body = (await call(`${base}?${qs}`)) as typeof body;
    } catch (err) {
      if (err instanceof GoogleCalendarError && err.status === 410) {
        return { events: [], nextSyncToken: null, fullResyncNeeded: true };
      }
      throw err;
    }

    for (const raw of body.items ?? []) {
      events.push({
        id: raw.id ?? '',
        status: raw.status ?? 'confirmed',
        summary: raw.summary ?? null,
        description: raw.description ?? null,
        startIso: raw.start?.dateTime ?? null,
        endIso: raw.end?.dateTime ?? null,
        created: raw.created ?? null,
      });
    }
    pageToken = body.nextPageToken;
    if (body.nextSyncToken) nextSyncToken = body.nextSyncToken;
  } while (pageToken);

  return { events, nextSyncToken, fullResyncNeeded: false };
}

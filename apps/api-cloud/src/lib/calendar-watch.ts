/**
 * calendar-watch — Google Calendar push notifications (events.watch), the
 * real-time half of the sync. Instead of waiting for the ≤poll-interval tick,
 * Google POSTs a tiny notification to our webhook the instant the calendar
 * changes; the webhook then runs the same incremental `runCalendarPull`.
 *
 *   • ensureWatchChannel() — (re)registers a watch channel pointed at our
 *     public webhook; renews before expiry. Requires the webhook DOMAIN to be
 *     verified in the GCP project (Google rejects unverified callbacks) — until
 *     then this fails gracefully and the poll backstop keeps things in sync.
 *   • classifyWatchNotification() — pure: validate the channel token + decide
 *     whether a notification represents a real change (vs the sync handshake).
 *
 * The notification body is empty by design; it only signals "something
 * changed", so the webhook reuses the syncToken-based pull to fetch the deltas.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { calendarConfigured, stopChannel, watchEvents } from './google-calendar.js';

const CHANNEL_KEY = 'calendar.watch_channel';
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000; // renew when < 1 day to expiry
const RETRY_BACKOFF_MS = 10 * 60 * 1000; // when creation fails, retry at most every 10 min
const CHANNEL_TTL_SECONDS = 7 * 24 * 60 * 60; // ask Google for a 7-day channel

/** Pure: is this webhook hit genuine, and does it warrant a pull? */
export function classifyWatchNotification(
  channelToken: string | undefined,
  resourceState: string | undefined,
  expectedToken: string,
): { authorized: boolean; triggerPull: boolean } {
  if (!expectedToken || channelToken !== expectedToken) {
    return { authorized: false, triggerPull: false };
  }
  // Google sends one 'sync' message right after watch() is created (handshake);
  // every later 'exists'/'not_exists' means the calendar actually changed.
  return { authorized: true, triggerPull: resourceState !== 'sync' };
}

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}
interface LoggerLike {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}
interface StoredChannel {
  id: string;
  resourceId: string;
  expiration: number;
}

let lastAttemptAt = 0;

/**
 * Ensure a live watch channel exists, creating/renewing as needed. Best-effort:
 * a failure (e.g. webhook domain not yet verified) is logged and the poll
 * backstop covers sync until it succeeds on a later attempt.
 */
export async function ensureWatchChannel(
  db: DbLike,
  log: LoggerLike,
  opts: { webhookUrl: string; token: string },
): Promise<void> {
  if (!calendarConfigured() || !opts.webhookUrl || !opts.token) return;

  const rows = (await db.execute(
    sql`SELECT value FROM system_settings WHERE key = ${CHANNEL_KEY}`,
  )) as unknown as Array<{ value: StoredChannel | null }>;
  const current = rows[0]?.value ?? null;
  const now = Date.now();

  if (current?.expiration && current.expiration - now > RENEW_BEFORE_MS) return; // still healthy
  if (now - lastAttemptAt < RETRY_BACKOFF_MS) return; // throttle failing retries / churn
  lastAttemptAt = now;

  try {
    if (current?.id && current?.resourceId) {
      await stopChannel(current.id, current.resourceId).catch(() => {}); // best-effort
    }
    const channel = await watchEvents({
      channelId: randomUUID(),
      address: opts.webhookUrl,
      token: opts.token,
      ttlSeconds: CHANNEL_TTL_SECONDS,
    });
    await db.execute(sql`
      INSERT INTO system_settings (key, value, description)
      VALUES (${CHANNEL_KEY}, ${JSON.stringify(channel)}::jsonb, 'Google Calendar watch channel')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `);
    log.info({ expiration: channel.expiration }, 'calendar watch: channel established');
  } catch (err) {
    log.warn(
      { err },
      'calendar watch: channel not established (is the webhook domain verified in GCP?) — poll backstop active',
    );
  }
}

/**
 * Smurfing (structuring) detection — GwG / §259 StGB AML defense (memory.md §3).
 *
 * Structuring — splitting one large Ankauf into several sub-€2,000 buys to dodge
 * the GwG identity-recording threshold — is a realistic AML risk in a cash-heavy
 * precious-metals trade. This module flags it.
 *
 * THRESHOLDS ARE PLACEHOLDERS: the window, the "small" ceiling, the linked-txn
 * count, and the €2.000 aggregate line all live in `system_settings` (see
 * `loadSmurfingThresholds`) with conservative defaults. The REAL numbers must be
 * confirmed with the Steuerberater + bank before go-live — never hardcode them.
 *
 * V1 is DETECT-AND-ALERT, never block: a finalized sale is sacrosanct. The
 * detection runs AFTER the finalize transaction commits, so a bug here can
 * never roll back a valid fiscal record. On a hit it emits the critical ledger
 * event `alert.smurfing_detected` (one of the 7 DND-bypassing alerts, memory.md
 * #45 / ADR-0019) plus a forensic `audit_log` entry.
 *
 * Money discipline: all amounts are bigint CENTS — no float arithmetic ever.
 * The rolling window is anchored on the transaction's OWN `finalized_at`, not
 * `now()`, so offline-replayed transactions are scored against their real
 * occurrence time.
 */

import { sql as drizzleSql } from 'drizzle-orm';

import { emit, emitAudit } from '@norns/audit';
import type { AnyDb, RootDb } from '@norns/db/client';

/** GwG §10 identity-recording threshold — €2,000.00 in cents. */
export const KYC_LIMIT_CENTS = 200_000n;

export interface SmurfingThresholds {
  /** Rolling lookback window in days. */
  windowDays: number;
  /** Number of near-threshold buys in the window that trips the count rule. */
  countThreshold: number;
  /** "Just below the limit" floor, in cents (e.g. €1,999.00 → 199900). */
  nearThresholdCents: bigint;
  /** The GwG identity threshold the aggregate must cross, in cents. */
  kycLimitCents: bigint;
}

export const DEFAULT_SMURFING_THRESHOLDS: SmurfingThresholds = {
  // 30-day rolling window (Roman Grützner GwG go-live sign-off). The
  // system_settings key `smurfing.ankauf_count_window_days` (migration 0050)
  // is the runtime source of truth; this is the fallback default.
  windowDays: 30,
  countThreshold: 3,
  nearThresholdCents: 199_900n, // €1,999.00
  kycLimitCents: KYC_LIMIT_CENTS,
};

/** A transaction reduced to the two facts detection needs. */
export interface WindowTxn {
  /** Signed NUMERIC(18,2) value already parsed to cents; sign is ignored. */
  totalCents: bigint;
  /** The transaction's own finalized_at (its real occurrence time). */
  occurredAt: Date;
}

export interface SmurfingInput {
  /** The transaction being finalized now. */
  incoming: WindowTxn;
  /** Prior same-customer, same-direction transactions (any age; filtered here). */
  priors: WindowTxn[];
  thresholds: SmurfingThresholds;
}

export type SmurfingReason = 'AGGREGATE_CROSSES_KYC_LIMIT' | 'NEAR_THRESHOLD_COUNT';

export interface SmurfingVerdict {
  flagged: boolean;
  reasons: SmurfingReason[];
  /** Count of transactions inside the window (incoming included). */
  windowCount: number;
  /** Sum of the in-window transactions (incoming included), in cents. */
  aggregateCents: bigint;
  /** Largest single in-window transaction, in cents. */
  maxSingleCents: bigint;
  /** Count of in-window transactions in [nearThreshold, kycLimit). */
  nearThresholdCount: number;
  /** Inclusive lower bound of the window. */
  windowStart: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const absCents = (c: bigint): bigint => (c < 0n ? -c : c);

/**
 * Parse a NUMERIC(18,2) euro string ("1999.00", "-50.5") to bigint cents.
 * No float arithmetic — string-split + BigInt only.
 */
export function eurToCents(eur: string): bigint {
  const trimmed = eur.trim();
  const negative = trimmed.startsWith('-');
  const unsigned = trimmed.replace(/^[+-]/, '');
  const [whole = '0', frac = ''] = unsigned.split('.');
  const cents = BigInt(whole === '' ? '0' : whole) * 100n + BigInt(`${frac}00`.slice(0, 2));
  return negative ? -cents : cents;
}

/** Format bigint cents back to a NUMERIC(18,2) euro string for payloads. */
export function centsToEur(cents: bigint): string {
  const negative = cents < 0n;
  const a = absCents(cents);
  const whole = a / 100n;
  const frac = (a % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`;
}

/**
 * Pure structuring decision. Two independent rules trip a flag:
 *   • AGGREGATE_CROSSES_KYC_LIMIT — ≥2 buys, none individually at/over the €2k
 *     ID line, but their windowed sum reaches it (classic structuring).
 *   • NEAR_THRESHOLD_COUNT — `countThreshold`+ buys each sitting just below the
 *     limit ([nearThreshold, kycLimit)).
 */
export function detectSmurfing(input: SmurfingInput): SmurfingVerdict {
  const { incoming, priors, thresholds } = input;
  const { windowDays, countThreshold, nearThresholdCents, kycLimitCents } = thresholds;

  const anchorMs = incoming.occurredAt.getTime();
  const windowStartMs = anchorMs - windowDays * DAY_MS;
  const windowStart = new Date(windowStartMs);

  const considered = [incoming, ...priors]
    .filter((t) => {
      const ms = t.occurredAt.getTime();
      return ms >= windowStartMs && ms <= anchorMs;
    })
    .map((t) => absCents(t.totalCents));

  const aggregateCents = considered.reduce((acc, c) => acc + c, 0n);
  const maxSingleCents = considered.reduce((m, c) => (c > m ? c : m), 0n);
  const nearThresholdCount = considered.filter(
    (c) => c >= nearThresholdCents && c < kycLimitCents,
  ).length;

  const reasons: SmurfingReason[] = [];
  if (considered.length >= 2 && maxSingleCents < kycLimitCents && aggregateCents >= kycLimitCents) {
    reasons.push('AGGREGATE_CROSSES_KYC_LIMIT');
  }
  if (nearThresholdCount >= countThreshold) {
    reasons.push('NEAR_THRESHOLD_COUNT');
  }

  return {
    flagged: reasons.length > 0,
    reasons,
    windowCount: considered.length,
    aggregateCents,
    maxSingleCents,
    nearThresholdCount,
    windowStart,
  };
}

// ────────────────────────────────────────────────────────────────────────
// DB-aware wrapper — thresholds from system_settings + the finalize hook.
// ────────────────────────────────────────────────────────────────────────

function unquote(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const t = value.trim();
  return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
}

function parseIntSetting(value: string | undefined, fallback: number): number {
  const s = unquote(value);
  if (s == null || s === '') return fallback;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseEurSetting(value: string | undefined, fallback: bigint): bigint {
  const s = unquote(value);
  if (s == null || s === '') return fallback;
  try {
    const cents = eurToCents(s);
    return cents > 0n ? cents : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Load the ADMIN-tunable thresholds from `system_settings`, falling back to the
 * conservative PLACEHOLDER defaults when a key is absent (the table accepts
 * arbitrary dotted keys, so they are seedable without a migration).
 *
 * ⚠️ PLACEHOLDERS — the REAL numbers come from Basel's Steuerberater + bank and
 * MUST be confirmed before go-live. The four keys:
 *   • smurfing.ankauf_count_window_days        — rolling lookback (days)
 *   • smurfing.ankauf_amount_near_threshold_eur — per-tx "small" ceiling (€)
 *   • smurfing.ankauf_count_threshold           — min linked-txn count
 *   • gwg.identity_threshold_eur                — the §10 aggregate ID line (€)
 * The aggregate line is NO LONGER hardcoded — it reads the same GwG identity
 * threshold the KYC gate uses (#I-41), so one setting governs both.
 */
export async function loadSmurfingThresholds(db: AnyDb): Promise<SmurfingThresholds> {
  const rows = await db.execute<{ key: string; value: string }>(drizzleSql`
    SELECT key, value::text AS value
      FROM system_settings
     WHERE key IN (
       'smurfing.ankauf_count_window_days',
       'smurfing.ankauf_count_threshold',
       'smurfing.ankauf_amount_near_threshold_eur',
       'gwg.identity_threshold_eur'
     )`);
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.key, r.value);
  return {
    windowDays: parseIntSetting(
      map.get('smurfing.ankauf_count_window_days'),
      DEFAULT_SMURFING_THRESHOLDS.windowDays,
    ),
    countThreshold: parseIntSetting(
      map.get('smurfing.ankauf_count_threshold'),
      DEFAULT_SMURFING_THRESHOLDS.countThreshold,
    ),
    nearThresholdCents: parseEurSetting(
      map.get('smurfing.ankauf_amount_near_threshold_eur'),
      DEFAULT_SMURFING_THRESHOLDS.nearThresholdCents,
    ),
    // The §10 aggregate ID line — configurable (default €2.000), not hardcoded.
    kycLimitCents: parseEurSetting(map.get('gwg.identity_threshold_eur'), KYC_LIMIT_CENTS),
  };
}

export interface SmurfingCheckParams {
  transactionId: string;
  customerId: string;
  direction: 'VERKAUF' | 'ANKAUF';
  /** NUMERIC(18,2) string of the just-finalized transaction. */
  totalEur: string;
  /** The transaction's own finalized_at — its actual time (offline-replay safe). */
  occurredAt: Date;
  actorUserId: string | null;
  deviceId: string | null;
  ipAddress: string | null;
  /** Pre-loaded thresholds (tests); otherwise read from system_settings. */
  thresholds?: SmurfingThresholds;
}

// A `type` (not `interface`) so it satisfies the `Record<string, unknown>`
// constraint on `db.execute<T>` (interfaces lack an implicit index signature).
type PriorRow = {
  total_eur: string;
  finalized_at: Date;
};

/**
 * Screen a just-finalized transaction for structuring and, on a hit, emit the
 * critical ledger alert + an audit_log entry. Returns the verdict, or `null`
 * when the check does not apply (V1: ANKAUF only — the §259 Hehlerei risk, and
 * the configured keys are ankauf-scoped).
 *
 * Both writes go through the append-only emit helpers (DB triggers compute the
 * hash chain). Intended to run AFTER the finalize commit — never blocking.
 */
export async function runSmurfingDetection(
  db: RootDb,
  params: SmurfingCheckParams,
): Promise<SmurfingVerdict | null> {
  if (params.direction !== 'ANKAUF') return null;

  const thresholds = params.thresholds ?? (await loadSmurfingThresholds(db));
  const anchorIso = params.occurredAt.toISOString();

  const priors = await db.execute<PriorRow>(drizzleSql`
    SELECT total_eur, finalized_at
      FROM transactions
     WHERE customer_id = ${params.customerId}::uuid
       AND direction = 'ANKAUF'
       AND storno_of_transaction_id IS NULL
       AND id <> ${params.transactionId}::uuid
       AND finalized_at <= ${anchorIso}::timestamptz
       AND finalized_at >= ${anchorIso}::timestamptz - (${thresholds.windowDays} || ' days')::interval`);

  const verdict = detectSmurfing({
    incoming: { totalCents: eurToCents(params.totalEur), occurredAt: params.occurredAt },
    priors: priors.map((r) => ({
      totalCents: eurToCents(r.total_eur),
      occurredAt: r.finalized_at,
    })),
    thresholds,
  });

  if (!verdict.flagged) return verdict;

  const payload: Record<string, unknown> = {
    customerId: params.customerId,
    direction: params.direction,
    reasons: verdict.reasons,
    windowDays: thresholds.windowDays,
    windowTransactionCount: verdict.windowCount,
    nearThresholdCount: verdict.nearThresholdCount,
    countThreshold: thresholds.countThreshold,
    aggregateEur: centsToEur(verdict.aggregateCents),
    incomingTotalEur: params.totalEur,
    kycLimitEur: centsToEur(thresholds.kycLimitCents),
    nearThresholdEur: centsToEur(thresholds.nearThresholdCents),
    windowStart: verdict.windowStart.toISOString(),
  };

  // ⚠️ BEIDE Schreibvorgänge in EINER Transaktion, und das ist kein Schmuck.
  //
  // Vorher standen sie als zwei getrennte `await` nacheinander, ohne Klammer.
  // Ein Absturz zwischen ihnen — Stromausfall, ein OOM, ein Neustart durch
  // die Aufsicht — hinterliess einen Geldwäsche-Alarm in der Hauptkette OHNE
  // den dazugehörigen forensischen Eintrag. Genau der ist der Teil, nach dem
  // später gefragt wird: wer wurde wann gewarnt. Ein Alarm, den niemand
  // belegen kann, ist bei einer Prüfung nach dem Geldwäschegesetz schlechter
  // als gar keiner.
  //
  // `RootDb` statt `AnyDb`: dieser Weg läuft NACH dem Festschreiben des
  // Verkaufs mit einer eigenen Verbindung. Bekäme er eine fremde Transaktion
  // herein, würde daraus ein Sicherungspunkt, und die Klammer hier hinge an
  // fremdem Erfolg. Der Typ verbietet das.
  await db.transaction(async (tx) => {
    // Kritischer fiskalischer Alarm — umgeht die Ruhezeiten (ADR-0019).
    await emit(tx, {
      eventType: 'alert.smurfing_detected',
      entityTable: 'transactions',
      entityId: params.transactionId,
      actorUserId: params.actorUserId,
      deviceId: params.deviceId,
      ipAddress: params.ipAddress,
      payload,
    });

    // Die forensische Spur, nicht fiskalisch.
    await emitAudit(tx, {
      eventType: 'customer.smurfing_flagged',
      actorUserId: params.actorUserId,
      deviceId: params.deviceId,
      ipAddress: params.ipAddress,
      payload,
    });
  });

  return verdict;
}

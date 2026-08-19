/**
 * @norns/audit
 *
 * The single discipline boundary for `ledger_events` and `audit_log` INSERTs.
 *
 * The DB-side SHA-256 hash chain (migration 0008) is bypass-proof. This
 * package is the typed, discoverable surface that business code uses. Direct
 * INSERTs to either table outside this package are forbidden by code review
 * (and will be lint-enforced in Phase 1.5).
 *
 * Surface:
 *   emit()         append one row to ledger_events (fiscal events, hash-chained)
 *   emitAudit()    append one row to audit_log     (security events, no chain)
 *   verifyChain()  call verify_ledger_chain() — empty → valid, otherwise the first break
 */

export { emit } from './emit.js';
export { emitAudit } from './emitAudit.js';
export { verifyChain } from './verifyChain.js';

export type {
  EmitInput,
  EmittedEvent,
  AuditInput,
  ChainVerificationResult,
} from './types.js';

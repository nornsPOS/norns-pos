/**
 * audit/ — tamper-evident ledger + non-fiscal audit log.
 *
 * Writes go through @norns/audit's `emit()` and `emitAudit()` helpers —
 * never construct ledger rows or audit entries directly outside that package.
 *
 * See migration 0008_audit_chain.sql.
 */

export * from './ledgerEvents.js';
export * from './auditLog.js';

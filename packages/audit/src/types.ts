/**
 * Public types for @norns/audit.
 */

/**
 * Input to `emit()`. The id, prev_hash, row_hash, and created_at columns
 * are computed by the DB trigger — callers do not provide them.
 */
export interface EmitInput {
  /** Domain event name. Convention: `<entity>.<verb>`, e.g. `transaction.finalized`. */
  eventType: string;
  /** The entity table this event is about. */
  entityTable: string;
  /** The target row's id within `entityTable`. UUID. */
  entityId: string;
  /** Internal user who triggered this event. `null` for system-emitted events. */
  actorUserId?: string | null;
  /** Device/terminal that originated the action. */
  deviceId?: string | null;
  /** Client IP. INET-castable string ('1.2.3.4' or '::1'). */
  ipAddress?: string | null;
  /** Canonical snapshot of the change. Must be a JSON object (not an array or scalar). */
  payload: Record<string, unknown>;
}

/** Result of a successful `emit()`. */
export interface EmittedEvent {
  id: bigint;
  rowHash: Uint8Array;
  prevHash: Uint8Array;
  createdAt: Date;
}

/** Input to `emitAudit()` — the non-fiscal counterpart. */
export interface AuditInput {
  eventType: string;
  actorUserId?: string | null;
  deviceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  payload?: Record<string, unknown>;
}

/** Chain verification outcome. */
export type ChainVerificationResult =
  | { valid: true; rowsVerified: bigint }
  | {
      valid: false;
      breakAtId: bigint;
      reason: string;
      expectedHash: Uint8Array;
      actualHash: Uint8Array;
    };

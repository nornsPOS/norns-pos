/**
 * Local KYC document index (Epic C Part 2) — the offline-queryable half of the
 * encrypted KYC vault. The ciphertext lives on disk (kyc.rs); this records one
 * row per scan in the local `customer_kyc` SQLite table so the POS can list +
 * preview a customer's documents with no network.
 *
 * Lazy-loads the same `sqlite:warehouse14.db` the outbox uses; the `0002_kyc.sql`
 * migration creates the table Rust-side on startup. Outside a Tauri webview the
 * dynamic import / `Database.load` rejects — callers treat that as "no local
 * records" (graceful in the browser / Vitest).
 */

import type Database from '@tauri-apps/plugin-sql';

const DB_PATH = 'sqlite:warehouse14.db';

let dbPromise: Promise<Database> | null = null;
function db(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = import('@tauri-apps/plugin-sql').then(({ default: Db }) => Db.load(DB_PATH));
  }
  return dbPromise;
}

export interface KycRecord {
  id: number;
  customerId: string;
  docType: string;
  filePath: string;
  sha256: string;
  verifiedAt: number | null;
  verifiedByUserId: string | null;
  createdAt: number;
}

export interface NewKycRecord {
  customerId: string;
  docType: string;
  filePath: string;
  sha256: string;
  createdAt: number;
}

interface KycRow {
  id: number;
  customer_id: string;
  doc_type: string;
  file_path: string;
  sha256: string;
  verified_at: number | null;
  verified_by_user_id: string | null;
  created_at: number;
}

/**
 * Record a freshly-encrypted document. UNIQUE(sha256) makes a re-scan a no-op.
 * Returns TRUE when a new index row was written, FALSE when an identical
 * document (same sha256) was already indexed and the INSERT was ignored. The
 * caller MUST unlink the just-written ciphertext on FALSE — otherwise that
 * redundant vault file becomes an un-indexed, un-eraseable orphan (Art.17).
 */
export async function insertKycRecord(rec: NewKycRecord): Promise<boolean> {
  const conn = await db();
  const res = await conn.execute(
    `INSERT OR IGNORE INTO customer_kyc (customer_id, doc_type, file_path, sha256, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [rec.customerId, rec.docType, rec.filePath, rec.sha256, rec.createdAt],
  );
  return (res.rowsAffected ?? 0) > 0;
}

/** All local KYC documents for a customer, newest first. */
export async function listKycForCustomer(customerId: string): Promise<KycRecord[]> {
  const conn = await db();
  const rows = await conn.select<KycRow[]>(
    `SELECT id, customer_id, doc_type, file_path, sha256, verified_at, verified_by_user_id, created_at
       FROM customer_kyc
      WHERE customer_id = $1
      ORDER BY created_at DESC`,
    [customerId],
  );
  return rows.map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    docType: r.doc_type,
    filePath: r.file_path,
    sha256: r.sha256,
    verifiedAt: r.verified_at,
    verifiedByUserId: r.verified_by_user_id,
    createdAt: r.created_at,
  }));
}

/**
 * Remove one local KYC index row (Phase 3.2 — DSGVO Art. 17 erasure). The
 * ciphertext file is deleted separately via the `delete_kyc_document` Tauri
 * command; this drops only the queryable index row so the document stops
 * appearing in the customer's Akte. Deleting an already-gone id is a no-op.
 */
export async function deleteKycRecord(id: number): Promise<void> {
  const conn = await db();
  await conn.execute(`DELETE FROM customer_kyc WHERE id = $1`, [id]);
}

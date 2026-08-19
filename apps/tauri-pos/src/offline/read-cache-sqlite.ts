/**
 * read-cache-sqlite — the durable adapter that lets the last-good read cache
 * survive a cold start (auto-update, crash, morning reboot).
 *
 * Without a persistence adapter, `read-cache` is memory-only: it survives a
 * tab switch but not a relaunch. On a restart with the tunnel still coming up,
 * the Lager, the Kundenakte and RecentSales would show empty instead of the
 * last real figures. This adapter closes that gap.
 *
 * It reuses the SAME `sqlite:warehouse14.db` the outbox/KYC/TSE stores use, but
 * a SEPARATE, throwaway, non-fiscal table (`read_cache_v1`), created lazily at
 * runtime via `CREATE TABLE IF NOT EXISTS`. That deliberately avoids a Rust
 * migration (the outbox tables are baked in with `include_str!` and would need
 * a rebuild): a wegwerfbare cache table is not part of the GoBD schema and must
 * never sit next to the durable outbox rows. Nothing fiscal is stored here.
 *
 * Outside a Tauri webview (browser dev, Vitest) `Database.load` rejects; every
 * method then no-ops gracefully, so the cache silently stays memory-only.
 */

import type Database from '@tauri-apps/plugin-sql';

import { type ReadCachePersistence, installReadCachePersistence } from './read-cache.js';

const DB_PATH = 'sqlite:warehouse14.db';
const TABLE = 'read_cache_v1';

let dbPromise: Promise<Database> | null = null;

/**
 * Load the shared DB and ensure the throwaway cache table exists. Memoised, so
 * the CREATE runs at most once per session. Rejects outside a Tauri webview.
 */
async function db(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = import('@tauri-apps/plugin-sql')
      .then(({ default: Db }) => Db.load(DB_PATH))
      .then(async (database) => {
        await database.execute(
          `CREATE TABLE IF NOT EXISTS ${TABLE} (
             key        TEXT PRIMARY KEY,
             value      TEXT NOT NULL,
             updated_at INTEGER NOT NULL
           )`,
        );
        return database;
      });
  }
  return dbPromise;
}

interface Row {
  value: string;
}

/**
 * The durable persistence port. Every method swallows a load/query failure and
 * degrades to the memory-only behaviour rather than throwing into a read hook.
 */
export const sqliteReadCachePersistence: ReadCachePersistence = {
  async getItem(key: string): Promise<string | null> {
    try {
      const rows = await (await db()).select<Row[]>(
        `SELECT value FROM ${TABLE} WHERE key = $1 LIMIT 1`,
        [key],
      );
      return rows[0]?.value ?? null;
    } catch {
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      await (await db()).execute(
        `INSERT INTO ${TABLE} (key, value, updated_at) VALUES ($1, $2, $3)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [key, value, Date.now()],
      );
    } catch {
      // Storage unavailable (browser/Vitest) or write failed: stay memory-only.
    }
  },

  async keys(): Promise<readonly string[]> {
    try {
      const rows = await (await db()).select<{ key: string }[]>(`SELECT key FROM ${TABLE}`);
      return rows.map((r) => r.key);
    } catch {
      return [];
    }
  },
};

/**
 * Install the durable adapter once at app mount. Safe to call in any
 * environment: outside Tauri the adapter's methods no-op, so the read cache
 * simply stays memory-only.
 */
export function installDurableReadCache(): void {
  installReadCachePersistence(sqliteReadCachePersistence);
}

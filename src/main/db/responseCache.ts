// src/main/db/responseCache.ts
//
// Disk-backed response cache for non-browser, non-tool final LLM responses.
//
// Key   = SHA-256( provider + ":" + model + ":" + systemPrompt + ":" + last-3-messages )
// Value = final assistant text
// TTL   = 30 minutes (configurable via CLAWDIA_RESPONSE_CACHE_TTL_MS env var)
//
// Only caches clean final responses (no tool calls, no browser profile).
// Caps the cache at 500 rows — LRU eviction via accessed_at.

import { createHash } from 'crypto';
import Database from 'better-sqlite3';

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 min
const MAX_ROWS = 500;

let _db: Database.Database | null = null;

export function initResponseCache(db: Database.Database): void {
  _db = db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS response_cache (
      key         TEXT PRIMARY KEY,
      response    TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      accessed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_response_cache_accessed ON response_cache(accessed_at);
  `);
}

function getDb(): Database.Database {
  if (!_db) throw new Error('[responseCache] not initialized');
  return _db;
}

function ttlMs(): number {
  const env = parseInt(process.env.CLAWDIA_RESPONSE_CACHE_TTL_MS ?? '', 10);
  return isNaN(env) ? DEFAULT_TTL_MS : env;
}

/**
 * Build a stable cache key from the request context.
 * Uses the last 3 messages to capture conversational context without
 * including the full history (which changes every turn).
 */
export function buildCacheKey(
  provider: string,
  model: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: unknown }>,
): string {
  const tail = messages.slice(-3).map(m => `${m.role}:${JSON.stringify(m.content)}`).join('|');
  return createHash('sha256')
    .update(`${provider}:${model}:${systemPrompt}:${tail}`)
    .digest('hex');
}

/** Return a cached response if one exists and is within TTL, else null. */
export function getCachedResponse(key: string): string | null {
  try {
    const now = Date.now();
    const row = getDb()
      .prepare(`SELECT response, created_at FROM response_cache WHERE key = ?`)
      .get(key) as { response: string; created_at: number } | undefined;

    if (!row) return null;
    if (now - row.created_at > ttlMs()) {
      // Expired — delete and return miss
      getDb().prepare(`DELETE FROM response_cache WHERE key = ?`).run(key);
      return null;
    }

    // Touch accessed_at for LRU ordering
    getDb().prepare(`UPDATE response_cache SET accessed_at = ? WHERE key = ?`).run(now, key);
    return row.response;
  } catch {
    return null;
  }
}

/** Store a response. Evicts oldest rows beyond MAX_ROWS. */
export function setCachedResponse(key: string, response: string): void {
  try {
    const now = Date.now();
    getDb()
      .prepare(`
        INSERT INTO response_cache (key, response, created_at, accessed_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          response    = excluded.response,
          created_at  = excluded.created_at,
          accessed_at = excluded.accessed_at
      `)
      .run(key, response, now, now);

    // LRU eviction: keep only the MAX_ROWS most recently accessed rows
    const count = (getDb().prepare(`SELECT COUNT(*) as n FROM response_cache`).get() as { n: number }).n;
    if (count > MAX_ROWS) {
      getDb()
        .prepare(`
          DELETE FROM response_cache WHERE key IN (
            SELECT key FROM response_cache ORDER BY accessed_at ASC LIMIT ?
          )
        `)
        .run(count - MAX_ROWS);
    }
  } catch (err: any) {
    console.warn('[responseCache] setCachedResponse failed:', err.message);
  }
}

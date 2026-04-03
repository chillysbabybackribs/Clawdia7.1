// src/main/db/memory.ts
// Memory read/write/search/prune. All operations use the shared better-sqlite3
// instance from db.ts via a lazy getter injected at init time.

import Database from 'better-sqlite3';

export interface MemoryEntry {
  id: number;
  category: string;
  key: string;
  value: string;
  source: string;
  confidence: number;
  created_at: string;
}

const VALID_CATEGORIES = new Set(['preference', 'account', 'workflow', 'fact', 'context']);
const SECRET_PATTERN = /sk-[a-z0-9]{10,}/i;

let _db: Database.Database | null = null;
let _storeCallCount = 0;

/** Called once by initDb() to wire the shared DB instance into this module. */
export function initMemory(db: Database.Database): void {
  _db = db;
  _storeCallCount = 0;
}

function getDb(): Database.Database {
  if (!_db) throw new Error('[memory] not initialized — call initMemory() first');
  return _db;
}

/** Validate a value before writing. Returns error string or null if valid. */
function validateWrite(category: string, key: string, value: string): string | null {
  if (!VALID_CATEGORIES.has(category)) return `invalid category: ${category}`;
  if (key.length > 100) return 'key too long (max 100 chars)';
  if (value.length > 500) return 'value too long (max 500 chars)';
  if (/password|api key/i.test(value)) return 'value looks like a secret — not stored';
  if (SECRET_PATTERN.test(value)) return 'value looks like an API key — not stored';
  return null;
}

/**
 * Upsert a fact into user_memory. On key conflict, increments confidence
 * and updates the value. source='user' facts are never auto-pruned.
 * Returns null on success, or an error string if validation failed.
 */
export function remember(
  category: string,
  key: string,
  value: string,
  source: 'user' | 'agent' = 'agent',
): string | null {
  const err = validateWrite(category, key, value);
  if (err) return err;
  try {
    getDb()
      .prepare(
        `INSERT INTO user_memory (category, key, value, source, confidence)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(category, key) DO UPDATE SET
           value = excluded.value,
           source = excluded.source,
           confidence = confidence + 1`
      )
      .run(category, key, value, source);
    _storeCallCount++;
    if (_storeCallCount % 10 === 0) pruneMemories();
    return null;
  } catch (err: any) {
    console.error('[memory] remember failed:', err.message);
    return err.message;
  }
}

/**
 * Delete a fact by key, optionally scoped to a category.
 * If category is omitted, deletes all facts with matching key.
 */
export function forget(key: string, category?: string): void {
  try {
    if (category) {
      getDb().prepare(`DELETE FROM user_memory WHERE key = ? AND category = ?`).run(key, category);
    } else {
      getDb().prepare(`DELETE FROM user_memory WHERE key = ?`).run(key);
    }
  } catch (err: any) {
    console.error('[memory] forget failed:', err.message);
  }
}

/**
 * FTS5 keyword search on user_memory. Returns up to `limit` results.
 * Falls back to LIKE query if FTS fails.
 */
export function searchMemory(query: string, limit = 5): MemoryEntry[] {
  try {
    return getDb()
      .prepare(
        `SELECT m.* FROM user_memory m
         JOIN user_memory_fts fts ON m.id = fts.rowid
         WHERE user_memory_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(query, limit) as MemoryEntry[];
  } catch {
    // FTS failed — degrade to LIKE
    try {
      const like = `%${query}%`;
      return getDb()
        .prepare(`SELECT * FROM user_memory WHERE key LIKE ? OR value LIKE ? LIMIT ?`)
        .all(like, like, limit) as MemoryEntry[];
    } catch {
      return [];
    }
  }
}

/**
 * Build the memory context block to inject into the system prompt.
 * Returns an empty string if nothing relevant is found or message is too short.
 * Hard cap: ~600 tokens (~2400 chars total output).
 */
export function getMemoryContext(userMessage: string): string {
  if (userMessage.length < 15) return '';

  const parts: string[] = [];

  try {
    // Always include source='user' facts (up to 3), then FTS results
    const userFacts = getDb()
      .prepare(`SELECT * FROM user_memory WHERE source = 'user' ORDER BY confidence DESC LIMIT 3`)
      .all() as MemoryEntry[];

    const ftsQuery = userMessage.slice(0, 200); // trim for FTS safety
    let ftsFacts: MemoryEntry[] = [];
    try {
      ftsFacts = getDb()
        .prepare(
          `SELECT m.* FROM user_memory m
           JOIN user_memory_fts fts ON m.rowid = fts.rowid
           WHERE user_memory_fts MATCH ?
           ORDER BY rank
           LIMIT 5`
        )
        .all(ftsQuery) as MemoryEntry[];
    } catch {
      // FTS failed silently — skip facts recall
    }

    // Merge: user facts first, then FTS results not already included
    const userFactIds = new Set(userFacts.map(f => f.id));
    const merged = [...userFacts, ...ftsFacts.filter(f => !userFactIds.has(f.id))];

    if (merged.length > 0) {
      const lines = merged.map(f => `- ${f.key}: ${f.value}`).join('\n');
      parts.push(`[Memory]\n${lines}`);
    }
  } catch {
    // Silently skip facts if DB unavailable
  }

  if (parts.length === 0) return '';

  const result = parts.join('\n\n');
  // Hard cap at ~2400 chars (~600 tokens)
  return result.slice(0, 2400);
}

/**
 * Returns the total number of facts in user_memory. Used in tests.
 */
export function countMemories(): number {
  try {
    return (getDb().prepare(`SELECT COUNT(*) as n FROM user_memory`).get() as { n: number }).n;
  } catch {
    return 0;
  }
}

/**
 * Prune user_memory to 180 entries (called automatically every 10 stores).
 * Never prunes source='user' facts. Deletes lowest-confidence agent facts first.
 */
export function pruneMemories(): void {
  try {
    const db = getDb();
    const total = (db.prepare(`SELECT COUNT(*) as n FROM user_memory`).get() as { n: number }).n;
    if (total <= 200) return;
    const toDelete = total - 180;
    db.prepare(
      `DELETE FROM user_memory WHERE id IN (
         SELECT id FROM user_memory
         WHERE source = 'agent'
         ORDER BY confidence ASC, created_at ASC
         LIMIT ?
       )`
    ).run(toDelete);
  } catch (err: any) {
    console.error('[memory] pruneMemories failed:', err.message);
  }
}

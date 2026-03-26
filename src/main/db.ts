import Database from 'better-sqlite3';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { initMemory } from './db/memory';

// Row types — plain data shapes matching the SQL schema exactly
export interface ConversationRow {
  id: string;
  title: string;
  mode: string;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string; // JSON-serialized Message
  created_at: number;
}

export interface RunRow {
  id: string;
  conversation_id: string;
  status: string;
  provider: string;
  model: string;
  started_at: number;
  completed_at?: number;
  total_tokens?: number;
  estimated_cost_usd?: number;
}

export interface RunEventRow {
  id: string;
  run_id: string;
  type: string;
  payload: string; // JSON
  created_at: number;
}

// Allow test override of DB path via env variable
function resolveDbPath(): string {
  if (process.env.CLAWDIA_DB_PATH_OVERRIDE) {
    return process.env.CLAWDIA_DB_PATH_OVERRIDE;
  }
  const configDir = path.join(os.homedir(), '.config', 'clawdia');
  fs.mkdirSync(configDir, { recursive: true });
  return path.join(configDir, 'data.sqlite');
}

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) throw new Error('db not initialized — call initDb() first');
  return db;
}

export function initDb(): void {
  try {
    const dbPath = resolveDbPath();
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL,
        mode       TEXT NOT NULL DEFAULT 'chat',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id                TEXT PRIMARY KEY,
        conversation_id   TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role              TEXT NOT NULL,
        content           TEXT NOT NULL,
        created_at        INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

      CREATE TABLE IF NOT EXISTS runs (
        id                  TEXT PRIMARY KEY,
        conversation_id     TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        status              TEXT NOT NULL,
        provider            TEXT NOT NULL,
        model               TEXT NOT NULL,
        started_at          INTEGER NOT NULL,
        completed_at        INTEGER,
        total_tokens        INTEGER,
        estimated_cost_usd  REAL
      );
      CREATE INDEX IF NOT EXISTS idx_runs_conversation ON runs(conversation_id, started_at);

      CREATE TABLE IF NOT EXISTS run_events (
        id          TEXT PRIMARY KEY,
        run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        type        TEXT NOT NULL,
        payload     TEXT NOT NULL,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, created_at);

      CREATE TABLE IF NOT EXISTS user_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'agent',
        confidence INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(category, key)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS user_memory_fts USING fts5(
        key, value,
        content=user_memory,
        content_rowid=id
      );

      CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON user_memory BEGIN
        INSERT INTO user_memory_fts(rowid, key, value) VALUES (new.id, new.key, new.value);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON user_memory BEGIN
        INSERT INTO user_memory_fts(user_memory_fts, rowid, key, value) VALUES ('delete', old.id, old.key, old.value);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON user_memory BEGIN
        INSERT INTO user_memory_fts(user_memory_fts, rowid, key, value) VALUES ('delete', old.id, old.key, old.value);
        INSERT INTO user_memory_fts(rowid, key, value) VALUES (new.id, new.key, new.value);
      END;

      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content=messages,
        content_rowid=rowid
      );

      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;

      INSERT OR IGNORE INTO messages_fts(rowid, content)
        SELECT rowid, content FROM messages;
    `);

    // Mark orphaned runs as failed (app was killed mid-run)
    db.prepare(`UPDATE runs SET status = 'failed' WHERE status = 'running'`).run();

    // Wire memory module after all tables exist
    initMemory(db);
  } catch (err) {
    console.error('[db] Failed to initialize database:', err);
    db = null; // degrade to in-memory-only mode
  }
}

// ── Conversations ──────────────────────────────────────────────────────────

export function createConversation(conv: ConversationRow): void {
  try {
    getDb()
      .prepare(`INSERT INTO conversations (id, title, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run(conv.id, conv.title, conv.mode, conv.created_at, conv.updated_at);
  } catch (err) {
    console.error('[db] createConversation failed:', err);
  }
}

export function listConversations(): ConversationRow[] {
  try {
    return getDb()
      .prepare(`SELECT * FROM conversations ORDER BY updated_at DESC`)
      .all() as ConversationRow[];
  } catch (err) {
    console.error('[db] listConversations failed:', err);
    return [];
  }
}

export function getConversation(id: string): ConversationRow | null {
  try {
    return (getDb().prepare(`SELECT * FROM conversations WHERE id = ?`).get(id) as ConversationRow) ?? null;
  } catch (err) {
    console.error('[db] getConversation failed:', err);
    return null;
  }
}

const CONVERSATION_COLUMNS = new Set<string>(['title', 'mode', 'created_at', 'updated_at']);

export function updateConversation(id: string, patch: Partial<ConversationRow>): void {
  try {
    const keys = Object.keys(patch).filter((k) => CONVERSATION_COLUMNS.has(k));
    if (keys.length === 0) return;
    const fields = keys.map((k) => `${k} = ?`).join(', ');
    const values = [...keys.map((k) => (patch as Record<string, unknown>)[k]), id];
    getDb().prepare(`UPDATE conversations SET ${fields} WHERE id = ?`).run(...values);
  } catch (err) {
    console.error('[db] updateConversation failed:', err);
  }
}

export function deleteConversation(id: string): void {
  try {
    getDb().prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
  } catch (err) {
    console.error('[db] deleteConversation failed:', err);
  }
}

// ── Messages ───────────────────────────────────────────────────────────────

export function addMessage(msg: MessageRow): void {
  try {
    getDb()
      .prepare(`INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(msg.id, msg.conversation_id, msg.role, msg.content, msg.created_at);
  } catch (err) {
    console.error('[db] addMessage failed:', err);
  }
}

export function getMessages(conversationId: string): MessageRow[] {
  try {
    return getDb()
      .prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`)
      .all(conversationId) as MessageRow[];
  } catch (err) {
    console.error('[db] getMessages failed:', err);
    return [];
  }
}

// ── Runs ───────────────────────────────────────────────────────────────────

export function createRun(run: RunRow): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO runs (id, conversation_id, status, provider, model, started_at, completed_at, total_tokens, estimated_cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.id,
        run.conversation_id,
        run.status,
        run.provider,
        run.model,
        run.started_at,
        run.completed_at ?? null,
        run.total_tokens ?? null,
        run.estimated_cost_usd ?? null,
      );
  } catch (err) {
    console.error('[db] createRun failed:', err);
  }
}

const RUN_COLUMNS = new Set<string>(['status', 'provider', 'model', 'started_at', 'completed_at', 'total_tokens', 'estimated_cost_usd']);

export function updateRun(id: string, patch: Partial<RunRow>): void {
  try {
    const keys = Object.keys(patch).filter((k) => RUN_COLUMNS.has(k));
    if (keys.length === 0) return;
    const fields = keys.map((k) => `${k} = ?`).join(', ');
    const values = [...keys.map((k) => (patch as Record<string, unknown>)[k]), id];
    getDb().prepare(`UPDATE runs SET ${fields} WHERE id = ?`).run(...values);
  } catch (err) {
    console.error('[db] updateRun failed:', err);
  }
}

export function getRuns(conversationId: string): RunRow[] {
  try {
    return getDb()
      .prepare(`SELECT * FROM runs WHERE conversation_id = ? ORDER BY started_at DESC`)
      .all(conversationId) as RunRow[];
  } catch (err) {
    console.error('[db] getRuns failed:', err);
    return [];
  }
}

// ── Run Events ─────────────────────────────────────────────────────────────

export function appendRunEvent(event: RunEventRow): void {
  try {
    getDb()
      .prepare(`INSERT INTO run_events (id, run_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(event.id, event.run_id, event.type, event.payload, event.created_at);
  } catch (err) {
    console.error('[db] appendRunEvent failed:', err);
  }
}

export function getRunEvents(runId: string): RunEventRow[] {
  try {
    return getDb()
      .prepare(`SELECT * FROM run_events WHERE run_id = ? ORDER BY created_at ASC`)
      .all(runId) as RunEventRow[];
  } catch (err) {
    console.error('[db] getRunEvents failed:', err);
    return [];
  }
}

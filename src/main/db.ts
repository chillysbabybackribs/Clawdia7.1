import Database from 'better-sqlite3';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { initMemory } from './db/memory';
import { initPolicies } from './db/policies';
import { initSpending } from './db/spending';
import { initAgents } from './db/agents';

// ── Row Types ───────────────────────────────────────────────────────────────
// Matching the actual Clawdia 7.0 SQLite schema

export interface ConversationRow {
  id: string;
  title: string;
  mode: string;
  created_at: string;
  updated_at: string;
  claude_terminal_session_id?: string | null;
  claude_terminal_status?: string;
  claude_terminal_last_activity?: string;
  claude_code_session_id?: string | null;
  codex_chat_thread_id?: string | null;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  tool_calls?: string | null;
  created_at: string;
  attachments_json?: string;
  file_refs_json?: string;
  link_previews_json?: string;
}

export interface RunRow {
  id: string;
  conversation_id: string;
  title: string;
  goal: string;
  status: string;
  started_at: string;
  updated_at: string;
  completed_at?: string | null;
  tool_call_count: number;
  error?: string | null;
  was_detached: number;
  provider?: string | null;
  model?: string | null;
  workflow_stage: string;
  scenario_id?: string | null;
  tool_completed_count?: number;
  tool_failed_count?: number;
  total_tokens?: number; // mapped to DB if needed, or handled separately
  estimated_cost_usd?: number;
  parent_run_id?: string | null;
  system_prompt?: string | null;
}

export interface RunEventRow {
  id?: number;
  run_id: string;
  seq: number;
  ts: string;
  kind: string;
  phase?: string | null;
  surface?: string | null;
  tool_name?: string | null;
  payload_json: string;
}

// ── Database Initialization ───────────────────────────────────────────────

function resolveDbPath(): string {
  if (process.env.CLAWDIA_DB_PATH_OVERRIDE) {
    return process.env.CLAWDIA_DB_PATH_OVERRIDE;
  }
  const configDir = path.join(os.homedir(), '.config', 'clawdia');
  fs.mkdirSync(configDir, { recursive: true });
  return path.join(configDir, 'data.sqlite');
}

let db: Database.Database | null = null;

function formatInitDbError(err: unknown): string {
  if (!(err instanceof Error)) return 'Unknown database initialization error.';
  if (err.message.includes('NODE_MODULE_VERSION') || (err as NodeJS.ErrnoException).code === 'ERR_DLOPEN_FAILED') {
    return `${err.message}\n[db] Native module mismatch detected. Run "npm run rebuild:native" to rebuild Electron-native addons (better-sqlite3, node-pty).`;
  }
  return err.stack ?? err.message;
}

/** @internal — exposed for tests only; do not use in production code. */
export function getDb(): Database.Database {
  if (!db) throw new Error('db not initialized — call initDb() first');
  return db;
}

export function initDb(): boolean {
  try {
    const dbPath = resolveDbPath();
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Ensure core 7.0 tables exist with correct columns. 
    // We use "IF NOT EXISTS" but note that it won't add columns to existing tables.
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id                TEXT PRIMARY KEY,
        title             TEXT NOT NULL DEFAULT 'New Chat',
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
        mode              TEXT NOT NULL DEFAULT 'chat',
        claude_terminal_session_id TEXT,
        claude_terminal_status TEXT NOT NULL DEFAULT 'idle',
        claude_terminal_last_activity TEXT,
        claude_code_session_id TEXT,
        codex_chat_thread_id TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id                TEXT PRIMARY KEY,
        conversation_id   TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role              TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content           TEXT NOT NULL DEFAULT '',
        tool_calls        TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        attachments_json  TEXT,
        file_refs_json    TEXT,
        link_previews_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

      CREATE TABLE IF NOT EXISTS runs (
        id                  TEXT PRIMARY KEY,
        conversation_id     TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        title               TEXT NOT NULL DEFAULT '',
        goal                TEXT NOT NULL DEFAULT '',
        status              TEXT NOT NULL CHECK(status IN ('running', 'awaiting_approval', 'needs_human', 'completed', 'failed', 'cancelled')),
        started_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        completed_at        TEXT,
        tool_call_count     INTEGER NOT NULL DEFAULT 0,
        error               TEXT,
        was_detached        INTEGER NOT NULL DEFAULT 0,
        provider            TEXT,
        model               TEXT,
        workflow_stage      TEXT NOT NULL DEFAULT 'starting',
        scenario_id         TEXT,
        tool_completed_count INTEGER NOT NULL DEFAULT 0,
        tool_failed_count   INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd  REAL,
        total_tokens        INTEGER,
        parent_run_id       TEXT REFERENCES runs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_runs_conversation ON runs(conversation_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS run_events (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id        TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        seq           INTEGER NOT NULL,
        ts            TEXT NOT NULL,
        kind          TEXT NOT NULL,
        phase         TEXT,
        surface       TEXT,
        tool_name     TEXT,
        payload_json  TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_run_events_run_seq ON run_events(run_id, seq ASC);
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
      CREATE INDEX IF NOT EXISTS idx_run_events_kind ON run_events(kind);

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

      CREATE TRIGGER IF NOT EXISTS messages_sync_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_sync_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_sync_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;

      CREATE TABLE IF NOT EXISTS streaming_responses (
        id            TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        run_id        TEXT,
        partial_text  TEXT NOT NULL DEFAULT '',
        started_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS loop_state (
        run_id        TEXT PRIMARY KEY,
        is_paused     INTEGER NOT NULL DEFAULT 0,
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Evolution: Add columns if missing (already-exists errors are expected and ignored)
    const evolve = (sql: string) => {
      try { db!.prepare(sql).run(); }
      catch (e) {
        const msg = (e as Error).message;
        // Only silence "duplicate column" errors; log anything unexpected
        if (!msg.includes('duplicate column')) {
          console.warn('[db] Schema evolution warning:', msg);
        }
      }
    };
    evolve(`ALTER TABLE runs ADD COLUMN total_tokens INTEGER`);
    evolve(`ALTER TABLE runs ADD COLUMN estimated_cost_usd REAL`);
    evolve(`ALTER TABLE runs ADD COLUMN parent_run_id TEXT REFERENCES runs(id) ON DELETE CASCADE`);
    evolve(`ALTER TABLE runs ADD COLUMN system_prompt TEXT`);
    evolve(`ALTER TABLE conversations ADD COLUMN claude_code_session_id TEXT`);
    evolve(`ALTER TABLE conversations ADD COLUMN codex_chat_thread_id TEXT`);

    // Mark orphaned runs as failed (app was killed mid-run)
    db.prepare(`UPDATE runs SET status = 'failed' WHERE status = 'running'`).run();

    // Wire extensions
    initMemory(db);
    initPolicies(db);
    initSpending(db);
    initAgents(db);
    return true;
  } catch (err) {
    console.error('[db] Failed to initialize database:', formatInitDbError(err));
    db = null;
    return false;
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

const CONVERSATION_COLUMNS = new Set<string>([
  'title',
  'mode',
  'created_at',
  'updated_at',
  'claude_code_session_id',
  'codex_chat_thread_id',
]);

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
      .prepare(`INSERT INTO messages (id, conversation_id, role, content, tool_calls, created_at, attachments_json, file_refs_json, link_previews_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(msg.id, msg.conversation_id, msg.role, msg.content, msg.tool_calls ?? null, msg.created_at, msg.attachments_json ?? null, msg.file_refs_json ?? null, msg.link_previews_json ?? null);
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
        `INSERT INTO runs (id, conversation_id, title, goal, status, started_at, updated_at, completed_at, tool_call_count, error, was_detached, provider, model, workflow_stage, scenario_id, tool_completed_count, tool_failed_count, estimated_cost_usd, total_tokens, parent_run_id, system_prompt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.id,
        run.conversation_id,
        run.title,
        run.goal,
        run.status,
        run.started_at,
        run.updated_at,
        run.completed_at ?? null,
        run.tool_call_count,
        run.error ?? null,
        run.was_detached,
        run.provider ?? null,
        run.model ?? null,
        run.workflow_stage,
        run.scenario_id ?? null,
        run.tool_completed_count ?? 0,
        run.tool_failed_count ?? 0,
        run.estimated_cost_usd ?? null,
        run.total_tokens ?? null,
        run.parent_run_id ?? null,
        run.system_prompt ?? null,
      );
  } catch (err) {
    console.error('[db] createRun failed:', err);
  }
}

const RUN_COLUMNS = new Set<string>(['status', 'title', 'goal', 'updated_at', 'completed_at', 'tool_call_count', 'error', 'was_detached', 'provider', 'model', 'workflow_stage', 'tool_completed_count', 'tool_failed_count', 'estimated_cost_usd', 'total_tokens', 'system_prompt']);

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
      .prepare(`INSERT INTO run_events (run_id, seq, ts, kind, phase, surface, tool_name, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(event.run_id, event.seq, event.ts, event.kind, event.phase ?? null, event.surface ?? null, event.tool_name ?? null, event.payload_json);
  } catch (err) {
    console.error('[db] appendRunEvent failed:', err);
  }
}

export function getRunEvents(runId: string): RunEventRow[] {
  try {
    return getDb()
      .prepare(`SELECT * FROM run_events WHERE run_id = ? ORDER BY seq ASC`)
      .all(runId) as RunEventRow[];
  } catch (err) {
    console.error('[db] getRunEvents failed:', err);
    return [];
  }
}

// ── Streaming Responses ────────────────────────────────────────────────────

export function upsertStreamingResponse(id: string, conversationId: string, runId: string | null, partialText: string): void {
  try {
    getDb()
      .prepare(`INSERT INTO streaming_responses (id, conversation_id, run_id, partial_text, started_at, updated_at)
                VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
                ON CONFLICT(id) DO UPDATE SET partial_text = excluded.partial_text, updated_at = datetime('now')`)
      .run(id, conversationId, runId ?? null, partialText);
  } catch { /* best effort */ }
}

export function deleteStreamingResponse(id: string): void {
  try {
    getDb().prepare(`DELETE FROM streaming_responses WHERE id = ?`).run(id);
  } catch { /* best effort */ }
}

export function getOrphanedStreamingResponses(conversationId: string): Array<{ id: string; partial_text: string; run_id: string | null }> {
  try {
    return getDb()
      .prepare(`SELECT id, partial_text, run_id FROM streaming_responses WHERE conversation_id = ? ORDER BY started_at ASC`)
      .all(conversationId) as Array<{ id: string; partial_text: string; run_id: string | null }>;
  } catch {
    return [];
  }
}

// ── Loop State ─────────────────────────────────────────────────────────────

export function setLoopPaused(runId: string, isPaused: boolean): void {
  try {
    getDb()
      .prepare(`INSERT INTO loop_state (run_id, is_paused, updated_at)
                VALUES (?, ?, datetime('now'))
                ON CONFLICT(run_id) DO UPDATE SET is_paused = excluded.is_paused, updated_at = excluded.updated_at`)
      .run(runId, isPaused ? 1 : 0);
  } catch { /* best effort */ }
}

export function deleteLoopState(runId: string): void {
  try {
    getDb().prepare(`DELETE FROM loop_state WHERE run_id = ?`).run(runId);
  } catch { /* best effort */ }
}

export function getLoopPaused(runId: string): boolean {
  try {
    const row = getDb().prepare(`SELECT is_paused FROM loop_state WHERE run_id = ?`).get(runId) as { is_paused: number } | undefined;
    return row ? row.is_paused === 1 : false;
  } catch {
    return false;
  }
}

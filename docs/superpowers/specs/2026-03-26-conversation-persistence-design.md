# Conversation & Run Persistence — Design Spec
**Date:** 2026-03-26
**Status:** Approved

---

## Problem

Clawdia 7.0 holds all conversation and run state in memory. Everything is lost on app restart. This makes the app unsuitable for any sustained use and blocks future features that depend on durable state (memory, agent history, telemetry review).

---

## Scope

This spec covers the first persistence layer: conversations, messages, and run telemetry. Explicitly out of scope: memory extraction, browser playbooks, agent definitions, spending budgets, policy rules.

---

## Database Location

`~/.config/clawdia/data.sqlite`

Same directory as the existing settings fallback location. Visible and accessible outside the app. Created on first launch if it doesn't exist.

---

## Schema

Four tables. No ORM. Plain `better-sqlite3` with typed query functions.

### `conversations`
```sql
CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  mode       TEXT NOT NULL DEFAULT 'chat',  -- 'chat' | 'claude_terminal'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### `messages`
```sql
CREATE TABLE IF NOT EXISTS messages (
  id                TEXT PRIMARY KEY,
  conversation_id   TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role              TEXT NOT NULL,  -- 'user' | 'assistant'
  content           TEXT NOT NULL,  -- JSON-serialized Message content
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
```

`content` is stored as a JSON string. This preserves full fidelity of the existing `Message` type (attachments, feed items, tool calls, link previews, file refs) without requiring a column per field. No schema change needed when message structure evolves.

### `runs`
```sql
CREATE TABLE IF NOT EXISTS runs (
  id                  TEXT PRIMARY KEY,
  conversation_id     TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  status              TEXT NOT NULL,  -- 'running' | 'completed' | 'failed' | 'cancelled'
  provider            TEXT NOT NULL,
  model               TEXT NOT NULL,
  started_at          INTEGER NOT NULL,
  completed_at        INTEGER,
  total_tokens        INTEGER,
  estimated_cost_usd  REAL
);
CREATE INDEX IF NOT EXISTS idx_runs_conversation ON runs(conversation_id, started_at);
```

### `run_events`
```sql
CREATE TABLE IF NOT EXISTS run_events (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,  -- 'tool_call' | 'tool_result' | 'text' | 'thinking' | 'error'
  payload     TEXT NOT NULL,  -- JSON: tool name, args, result, duration_ms, error, etc.
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, created_at);
```

---

## Data Flow

### Startup
1. `initDb()` opens/creates the SQLite file
2. All four tables created with `CREATE TABLE IF NOT EXISTS`
3. Any `runs` with `status = 'running'` are updated to `status = 'failed'` (app was killed mid-run)
4. Existing in-memory `sessions` map stays as the runtime cache for active conversations

### Conversation Lifecycle
- `CONVERSATION_CREATE` → insert into `conversations`, add to in-memory map
- `CONVERSATION_LIST` → read from SQLite sorted by `updated_at DESC`
- `CONVERSATION_LOAD` → read messages from SQLite, hydrate in-memory session
- `CONVERSATION_DELETE` → delete from SQLite (cascades to messages, runs, run_events), remove from memory
- Any new message → bump `conversations.updated_at`

### Message Flow
- Every user message sent → written to `messages` synchronously before API call
- Every assistant message received → written to `messages` after the full streaming response is assembled (not mid-stream)
- `content` serialized as `JSON.stringify(message)` on write, `JSON.parse` on read

### Run Telemetry
- Run starts → insert into `runs` with `status = 'running'`
- Tool call begins → append `run_events` row (`type = 'tool_call'`, payload includes tool name + args summary)
- Tool call returns → append `run_events` row (`type = 'tool_result'`, payload includes result summary + `duration_ms`)
- Run completes → update `runs`: set `status`, `completed_at`, `total_tokens`, `estimated_cost_usd`
- Run fails → update `runs`: set `status = 'failed'`, `completed_at`

---

## File Structure

### New Files

**`src/main/db.ts`**
SQLite connection, schema init, all query functions.

Exports:
- `initDb()` — open connection, create tables, mark orphaned runs as failed
- `createConversation(conv: ConversationRow): void`
- `listConversations(): ConversationRow[]`
- `getConversation(id: string): ConversationRow | null`
- `updateConversation(id: string, patch: Partial<ConversationRow>): void`
- `deleteConversation(id: string): void`
- `addMessage(msg: MessageRow): void`
- `getMessages(conversationId: string): MessageRow[]`
- `createRun(run: RunRow): void`
- `updateRun(id: string, patch: Partial<RunRow>): void`
- `getRuns(conversationId: string): RunRow[]`
- `appendRunEvent(event: RunEventRow): void`
- `getRunEvents(runId: string): RunEventRow[]`

**`src/main/runTracker.ts`**
Run lifecycle wrapper. Keeps run IDs in memory during execution, delegates all writes to `db.ts`.

Exports:
- `startRun(conversationId: string, provider: string, model: string): string` — returns runId
- `trackToolCall(runId: string, toolName: string, argsSummary: string): string` — returns eventId
- `trackToolResult(runId: string, eventId: string, resultSummary: string, durationMs: number): void`
- `completeRun(runId: string, totalTokens: number, estimatedCostUsd: number): void`
- `failRun(runId: string, error: string): void`

### Modified Files

**`src/main/main.ts`**
- Call `initDb()` before registering IPC handlers

**`src/main/registerIpc.ts`**
- Wire `CONVERSATION_CREATE`, `CONVERSATION_LIST`, `CONVERSATION_LOAD`, `CONVERSATION_DELETE` to `db.ts` queries
- Wire `MESSAGE_ADD` to `db.addMessage()`
- Wire `RUN_LIST`, `RUN_GET_EVENTS` to `db.ts` queries (for ProcessesPanel)

**`src/main/anthropicChat.ts`**
- Call `runTracker.startRun()` at loop start
- Call `runTracker.trackToolCall()` / `trackToolResult()` around each tool dispatch
- Call `runTracker.completeRun()` or `failRun()` at loop end

**`src/main/openaiChat.ts`** — same pattern as anthropicChat

**`src/main/geminiChat.ts`** — same pattern as anthropicChat

---

## Dependencies

Add to `package.json`:
```json
"better-sqlite3": "^12.6.2"
```

Add to devDependencies:
```json
"@types/better-sqlite3": "^7.6.12"
```

Native module — requires `@electron/rebuild` (already present) to compile against Electron's Node version.

---

## Error Handling

**Database unavailable on startup:**
- Log error to console, continue in degraded mode (in-memory only)
- No crash, no user-facing error at this stage

**Write failures:**
- All writes wrapped in try/catch
- Log to console, do not bubble to renderer
- A failed message write does not interrupt the chat

**Conversation load with no messages:**
- Treat as fresh conversation, no error

**App killed mid-run:**
- Handled in `initDb()`: `UPDATE runs SET status = 'failed' WHERE status = 'running'`
- Prevents phantom running states on next launch

**Duplicate IDs:**
- SQLite primary key constraint rejects duplicates
- Catch the constraint error, log, do not crash

---

## Out of Scope

The following are explicitly deferred to future specs:

- Memory extraction from conversations
- Browser playbook storage
- Agent definition persistence
- Spending budget enforcement
- Policy rule storage
- Schema migrations
- Database backup/export
- Multi-window or multi-instance safety

# Memory System Design
**Date:** 2026-03-26
**Status:** Approved

## Overview

A lightweight, fast recall system built on SQLite FTS5. No LLM-based extraction — memory is written explicitly by the agent or user, recalled automatically via keyword search before every LLM call. Cost is effectively zero (SQLite queries, no API calls for recall).

Two memory sources:
1. **Structured facts** (`user_memory` table) — things known about the user: preferences, account info, workflows, projects
2. **Conversation recall** (`messages_fts` virtual table) — past conversation snippets surfaced by keyword relevance

## Storage

Lives in the same `data.sqlite` database as conversation persistence (`~/.config/clawdia/data.sqlite`).

### `user_memory` table

```sql
CREATE TABLE user_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(category, key)
);

CREATE VIRTUAL TABLE user_memory_fts USING fts5(
  key, value,
  content=user_memory,
  content_rowid=id
);

CREATE TRIGGER memory_ai AFTER INSERT ON user_memory BEGIN
  INSERT INTO user_memory_fts(rowid, key, value) VALUES (new.id, new.key, new.value);
END;
CREATE TRIGGER memory_ad AFTER DELETE ON user_memory BEGIN
  INSERT INTO user_memory_fts(user_memory_fts, rowid, key, value) VALUES ('delete', old.id, old.key, old.value);
END;
CREATE TRIGGER memory_au AFTER UPDATE ON user_memory BEGIN
  INSERT INTO user_memory_fts(user_memory_fts, rowid, key, value) VALUES ('delete', old.id, old.key, old.value);
  INSERT INTO user_memory_fts(rowid, key, value) VALUES (new.id, new.key, new.value);
END;
```

**Columns:**
- `category`: `preference | account | workflow | fact | context`
- `key`: snake_case label (e.g. `preferred_editor`, `current_project`)
- `value`: one sentence max
- `source`: `user` (user-explicit) or `agent` (agent-stored)
- `confidence`: increments on re-store of same key; used for pruning priority

### Conversation recall

No new content table — piggybacks on the `messages` table from the conversation persistence spec. Add one FTS5 virtual table:

```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  content=messages,
  content_rowid=id
);
```

Add corresponding insert/delete/update triggers on the `messages` table to keep FTS in sync.

Only messages from the last 90 days are searched (filtered in query, not by FTS index).

## Recall & Injection

Before every LLM call, `getMemoryContext(userMessage)` runs two SQLite queries:

1. **Fact recall** — FTS5 MATCH on `user_memory_fts` using the user message as query, limit 5. Always prepends up to 3 `source='user'` facts regardless of relevance.
2. **Conversation recall** — FTS5 MATCH on `messages_fts`, filtered to last 90 days, limit 3. Each snippet trimmed to 200 chars.

Result injected as a block at the top of the system prompt:

```
[Memory]
- preferred_editor: VS Code with vim keybindings
- current_project: clawdia7.0 desktop AI workspace

[Past conversations]
- "...you mentioned the token budget for context was 500 tokens max..."
```

**Rules:**
- Hard cap: 600 tokens total across both sections
- If nothing relevant found, block is omitted entirely — no empty section
- LLM receives no instruction to use this block — natural use only
- FTS failures degrade silently (no block injected, no crash)
- Skip injection if user message is under 15 chars (greetings, single words)

## Agent Tools

Three tools exposed to the agent:

### `memory_store`
```typescript
{
  name: 'memory_store',
  input_schema: {
    category: 'preference' | 'account' | 'workflow' | 'fact' | 'context',
    key: string,          // snake_case, max 100 chars
    value: string,        // one sentence, max 500 chars
    source: 'user' | 'agent'  // 'user' if explicitly requested by user, 'agent' otherwise
  }
}
```
Upserts into `user_memory`. On UNIQUE conflict, increments confidence by 1 and updates value. `source='user'` facts are never auto-pruned.

### `memory_search`
```typescript
{
  name: 'memory_search',
  input_schema: {
    query: string,
    limit?: number  // default 5
  }
}
```
FTS5 search on `user_memory_fts`. Returns matching facts with category, key, value, confidence. Used when the agent needs deeper recall than what was auto-injected.

### `memory_forget`
```typescript
{
  name: 'memory_forget',
  input_schema: {
    key: string,
    category?: string  // optional; if omitted, deletes all facts with matching key
  }
}
```
Hard delete from `user_memory` by key (and optionally category). FTS triggers auto-clean. Agent calls this when user says "forget that..." or equivalent.

## User Commands

No special UI — user speaks naturally, agent interprets and calls tools:

| User says | Agent does |
|-----------|-----------|
| "remember that I prefer dark mode" | `memory_store` with appropriate category/key/value |
| "forget my preferred editor" | `memory_forget` with key `preferred_editor` |
| "what do you remember about me?" | `memory_search` with broad query |

## Security & Validation

Applied on every write (both `memory_store` tool and any internal path):
- Reject values containing `password` or `api key` (case-insensitive)
- Reject values matching API key pattern: `/sk-[a-z0-9]{10,}/i`
- Reject values over 500 chars
- Reject keys over 100 chars
- Reject malformed categories (must be one of the 5 valid values)

## Pruning

**Cap: 200 facts in `user_memory`.**

Runs automatically every 10 agent `memory_store` calls:
1. Count total rows
2. If over 200, delete lowest-confidence `source='agent'` facts until count reaches 180
3. `source='user'` facts are never pruned automatically

No pruning on `messages` — owned by conversation persistence system.

## Implementation Files

New files to create:
- `src/main/db/memory.ts` — `remember()`, `forget()`, `searchMemory()`, `getMemoryContext()`, `pruneMemories()`
- `src/main/core/cli/memoryTools.ts` — tool definitions for `memory_store`, `memory_search`, `memory_forget`
- `src/main/agent/memory-executors.ts` — tool executor functions

Modify:
- `src/main/db/database.ts` — add `user_memory`, `user_memory_fts`, `messages_fts` tables and triggers to schema/migrations
- `src/main/core/cli/toolRegistry.ts` — register memory tools
- `src/main/agent/loop-setup.ts` (or equivalent) — inject `getMemoryContext()` before each LLM call
- `src/renderer/components/ToolActivity.tsx` — already has display labels for `memory_store`, `memory_search` (no change needed)
- `src/renderer/components/ChatPanel.tsx` — already has `memory_read`/`memory_write` activity labels (no change needed)

## Data Flow

```
User message received
       ↓
getMemoryContext(userMessage)
  → FTS5 on user_memory_fts (facts)
  → FTS5 on messages_fts (past conversations, last 90 days)
  → combine, cap at 600 tokens
       ↓
Inject [Memory] + [Past conversations] block into system prompt
       ↓
LLM call — model uses context naturally if relevant
       ↓
Agent may call memory_store / memory_search / memory_forget during response
       ↓
Every 10 memory_store calls: pruneMemories()
```

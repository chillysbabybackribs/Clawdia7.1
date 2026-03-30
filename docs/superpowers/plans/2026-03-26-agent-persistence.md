# Agent Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist agent definitions to SQLite so agents survive app restarts, and wire all agent IPC handlers so the UI's create/list/get/update/delete/history flows actually work.

**Architecture:** One `agents` table stores the full `AgentDefinition` as a JSON blob in `definition_json`, with indexed scalar columns (`id`, `name`, `status`, `agent_type`, `created_at`, `updated_at`) for listing. A new `src/main/db/agents.ts` module owns all agent DB access. `registerIpc.ts` gets a new agent handler section. The preload stubs are replaced with real `ipcRenderer.invoke` calls. Run/test/compile handlers return `{ ok: false, error: 'not implemented' }` explicitly — no silent nulls.

**Tech Stack:** better-sqlite3 (synchronous SQLite), TypeScript, Vitest, Electron IPC

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/main/db/agents.ts` | Create | All agent CRUD DB functions |
| `src/main/db.ts` | Modify | Add `agents` table to schema, call `initAgents()` |
| `src/main/registerIpc.ts` | Modify | Add 11 agent IPC handlers |
| `src/main/preload.ts` | Modify | Replace agent stubs with `ipcRenderer.invoke` |
| `tests/main/db/agents.test.ts` | Create | Unit tests for agent DB functions |

---

### Task 1: Write failing tests for agent DB functions

**Files:**
- Create: `tests/main/db/agents.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// tests/main/db/agents.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initDb } from '../../../src/main/db';
import {
  createAgent,
  getAgent,
  listAgents,
  updateAgent,
  deleteAgent,
} from '../../../src/main/db/agents';
import type { AgentDefinition } from '../../../src/shared/types';

const TEST_DB = path.join(os.tmpdir(), `agents-test-${Date.now()}.sqlite`);

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Agent',
    description: 'A test agent',
    agentType: 'general',
    status: 'draft',
    goal: 'Do something useful',
    resourceScope: {},
    operationMode: 'read_only',
    mutationPolicy: 'no_mutation',
    approvalPolicy: 'always_ask',
    launchModes: ['manual'],
    defaultLaunchMode: 'manual',
    config: {},
    outputMode: 'chat_message',
    lastTestStatus: 'untested',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  process.env.CLAWDIA_DB_PATH_OVERRIDE = TEST_DB;
  initDb();
});

afterEach(() => {
  delete process.env.CLAWDIA_DB_PATH_OVERRIDE;
  try { fs.unlinkSync(TEST_DB); } catch {}
});

describe('createAgent + getAgent', () => {
  it('creates an agent and retrieves it by id', () => {
    const agent = makeAgent({ id: 'a1', name: 'My Agent' });
    createAgent(agent);
    const retrieved = getAgent('a1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe('a1');
    expect(retrieved!.name).toBe('My Agent');
    expect(retrieved!.goal).toBe('Do something useful');
  });

  it('returns null for unknown id', () => {
    expect(getAgent('nonexistent')).toBeNull();
  });

  it('preserves nested fields in definition_json', () => {
    const agent = makeAgent({
      id: 'a2',
      resourceScope: { browserDomains: ['example.com'] },
      config: { sourceMode: 'current_page', sources: [] },
    });
    createAgent(agent);
    const retrieved = getAgent('a2');
    expect(retrieved!.resourceScope.browserDomains).toEqual(['example.com']);
    expect((retrieved!.config as any).sourceMode).toBe('current_page');
  });
});

describe('listAgents', () => {
  it('returns empty array when no agents exist', () => {
    expect(listAgents()).toEqual([]);
  });

  it('returns all agents sorted by updated_at DESC', () => {
    const a1 = makeAgent({ id: 'a1', name: 'First', updatedAt: '2024-01-01T00:00:00.000Z' });
    const a2 = makeAgent({ id: 'a2', name: 'Second', updatedAt: '2024-06-01T00:00:00.000Z' });
    createAgent(a1);
    createAgent(a2);
    const list = listAgents();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('a2'); // most recently updated first
    expect(list[1].id).toBe('a1');
  });
});

describe('updateAgent', () => {
  it('updates name and status', () => {
    const agent = makeAgent({ id: 'a1' });
    createAgent(agent);
    updateAgent('a1', { name: 'Updated Name', status: 'ready' });
    const retrieved = getAgent('a1');
    expect(retrieved!.name).toBe('Updated Name');
    expect(retrieved!.status).toBe('ready');
  });

  it('updates nested fields via definition merge', () => {
    const agent = makeAgent({ id: 'a1', goal: 'original' });
    createAgent(agent);
    updateAgent('a1', { goal: 'updated goal' });
    const retrieved = getAgent('a1');
    expect(retrieved!.goal).toBe('updated goal');
  });
});

describe('deleteAgent', () => {
  it('removes the agent', () => {
    const agent = makeAgent({ id: 'a1' });
    createAgent(agent);
    deleteAgent('a1');
    expect(getAgent('a1')).toBeNull();
  });

  it('is a no-op for nonexistent id', () => {
    expect(() => deleteAgent('nonexistent')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx vitest run tests/main/db/agents.test.ts 2>&1 | tail -10
```

Expected: FAIL with `Cannot find module '../../../src/main/db/agents'`

---

### Task 2: Create `src/main/db/agents.ts`

**Files:**
- Create: `src/main/db/agents.ts`

- [ ] **Step 1: Create the module**

```typescript
// src/main/db/agents.ts
import type Database from 'better-sqlite3';
import type { AgentDefinition } from '../../shared/types';

let db: Database.Database;

export function initAgents(database: Database.Database): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL DEFAULT '',
      status       TEXT NOT NULL DEFAULT 'draft',
      agent_type   TEXT NOT NULL DEFAULT 'general',
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      definition_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agents_updated ON agents(updated_at DESC);
  `);
}

export function createAgent(agent: AgentDefinition): void {
  try {
    db.prepare(`
      INSERT INTO agents (id, name, status, agent_type, created_at, updated_at, definition_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      agent.id,
      agent.name,
      agent.status,
      agent.agentType,
      agent.createdAt,
      agent.updatedAt,
      JSON.stringify(agent),
    );
  } catch (err) {
    console.error('[db/agents] createAgent failed:', err);
  }
}

export function getAgent(id: string): AgentDefinition | null {
  try {
    const row = db.prepare('SELECT definition_json FROM agents WHERE id = ?').get(id) as { definition_json: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.definition_json) as AgentDefinition;
  } catch (err) {
    console.error('[db/agents] getAgent failed:', err);
    return null;
  }
}

export function listAgents(): AgentDefinition[] {
  try {
    const rows = db.prepare('SELECT definition_json FROM agents ORDER BY updated_at DESC').all() as { definition_json: string }[];
    return rows.map(r => JSON.parse(r.definition_json) as AgentDefinition);
  } catch (err) {
    console.error('[db/agents] listAgents failed:', err);
    return [];
  }
}

export function updateAgent(id: string, patch: Partial<AgentDefinition>): AgentDefinition | null {
  try {
    const existing = getAgent(id);
    if (!existing) return null;
    const updated: AgentDefinition = {
      ...existing,
      ...patch,
      id, // never overwrite id
      updatedAt: new Date().toISOString(),
    };
    db.prepare(`
      UPDATE agents SET name = ?, status = ?, agent_type = ?, updated_at = ?, definition_json = ? WHERE id = ?
    `).run(
      updated.name,
      updated.status,
      updated.agentType,
      updated.updatedAt,
      JSON.stringify(updated),
      id,
    );
    return updated;
  } catch (err) {
    console.error('[db/agents] updateAgent failed:', err);
    return null;
  }
}

export function deleteAgent(id: string): void {
  try {
    db.prepare('DELETE FROM agents WHERE id = ?').run(id);
  } catch (err) {
    console.error('[db/agents] deleteAgent failed:', err);
  }
}
```

- [ ] **Step 2: Run tests — expect PASS**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx vitest run tests/main/db/agents.test.ts 2>&1 | tail -10
```

Expected: all 9 tests PASS

- [ ] **Step 3: Run full suite to confirm no regressions**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx vitest run 2>&1 | tail -5
```

Expected: 129 passed (120 existing + 9 new), 0 failures

- [ ] **Step 4: Commit**

```bash
cd /home/dp/Desktop/clawdia7.0 && git add src/main/db/agents.ts tests/main/db/agents.test.ts && git commit -m "feat: add agent DB module with CRUD and tests"
```

---

### Task 3: Wire `initAgents` into `db.ts`

**Files:**
- Modify: `src/main/db.ts`

- [ ] **Step 1: Add import at top of db.ts**

Find the existing imports section (lines 1-8). After `import { initSpending } from './db/spending';`, add:

```typescript
import { initAgents } from './db/agents';
```

- [ ] **Step 2: Call `initAgents(db)` in `initDb()`**

Find the `initDb()` function. After the line that calls `initSpending(db)` (search for `initSpending(db)`), add:

```typescript
    initAgents(db);
```

- [ ] **Step 3: Verify TypeScript — no errors**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | grep "error TS" | head -10
```

Expected: no errors in `db.ts` or `db/agents.ts`

- [ ] **Step 4: Run full test suite**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx vitest run 2>&1 | tail -5
```

Expected: 129 passed, 0 failures

- [ ] **Step 5: Commit**

```bash
cd /home/dp/Desktop/clawdia7.0 && git add src/main/db.ts && git commit -m "feat: initialize agents table on db startup"
```

---

### Task 4: Add agent IPC handlers to `registerIpc.ts`

**Files:**
- Modify: `src/main/registerIpc.ts`

- [ ] **Step 1: Add agent DB imports**

Find the existing db imports block (lines 11-21). Add `createAgent`, `getAgent`, `listAgents`, `updateAgent`, `deleteAgent` to the import from `'./db/agents'`:

```typescript
import {
  createAgent,
  getAgent,
  listAgents,
  updateAgent,
  deleteAgent,
} from './db/agents';
```

- [ ] **Step 2: Add agent IPC handlers**

Find the end of the `registerIpc` function — just before the closing `}`. Add this block before the final `}`:

```typescript
  // ── Agents ──────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.AGENT_LIST, () => {
    return listAgents();
  });

  ipcMain.handle(IPC.AGENT_GET, (_e, id: string) => {
    return getAgent(id);
  });

  ipcMain.handle(IPC.AGENT_CREATE, (_e, input: Partial<import('../shared/types').AgentDefinition> & { goal: string }) => {
    const now = new Date().toISOString();
    const agent: import('../shared/types').AgentDefinition = {
      id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: input.name || 'Untitled Agent',
      description: input.description || '',
      agentType: input.agentType || 'general',
      status: 'draft',
      goal: input.goal,
      blueprint: input.blueprint,
      successDescription: input.successDescription,
      resourceScope: input.resourceScope || {},
      operationMode: input.operationMode || 'read_only',
      mutationPolicy: input.mutationPolicy || 'no_mutation',
      approvalPolicy: input.approvalPolicy || 'always_ask',
      launchModes: input.launchModes || ['manual'],
      defaultLaunchMode: input.defaultLaunchMode || 'manual',
      config: input.config || {},
      outputMode: input.outputMode || 'chat_message',
      outputTarget: input.outputTarget,
      schedule: input.schedule || null,
      lastTestStatus: 'untested',
      createdAt: now,
      updatedAt: now,
    };
    createAgent(agent);
    return agent;
  });

  ipcMain.handle(IPC.AGENT_UPDATE, (_e, id: string, patch: Partial<import('../shared/types').AgentDefinition>) => {
    return updateAgent(id, patch);
  });

  ipcMain.handle(IPC.AGENT_DELETE, (_e, id: string) => {
    deleteAgent(id);
    return { ok: true };
  });

  ipcMain.handle(IPC.AGENT_HISTORY, (_e, agentId: string) => {
    // Returns runs that were started for this agent (agent_id stored in run title for now)
    // Full agent_id tracking on runs is a future enhancement — return empty for now
    return [];
  });

  ipcMain.handle(IPC.AGENT_RUN, () => {
    return { ok: false, error: 'Agent execution not yet implemented' };
  });

  ipcMain.handle(IPC.AGENT_RUN_CURRENT_PAGE, () => {
    return { ok: false, error: 'Agent execution not yet implemented' };
  });

  ipcMain.handle(IPC.AGENT_RUN_URLS, () => {
    return { ok: false, error: 'Agent execution not yet implemented' };
  });

  ipcMain.handle(IPC.AGENT_TEST, () => {
    return { ok: false, error: 'Agent testing not yet implemented' };
  });

  ipcMain.handle(IPC.AGENT_COMPILE, () => {
    return { ok: false, definition: null, error: 'Agent compilation not yet implemented' };
  });
```

- [ ] **Step 3: Verify TypeScript — no errors**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | grep "error TS" | head -10
```

Expected: no new errors

- [ ] **Step 4: Run full test suite**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx vitest run 2>&1 | tail -5
```

Expected: 129 passed, 0 failures

- [ ] **Step 5: Commit**

```bash
cd /home/dp/Desktop/clawdia7.0 && git add src/main/registerIpc.ts && git commit -m "feat: wire agent IPC handlers (CRUD + stub run/test/compile)"
```

---

### Task 5: Replace agent stubs in `preload.ts`

**Files:**
- Modify: `src/main/preload.ts`

- [ ] **Step 1: Replace the agent stubs block**

Find the `agent:` section (lines 123–135). Replace the entire block:

```typescript
  agent: {
    list: () => Promise.resolve([]),
    get: (_id: string) => Promise.resolve(null),
    create: (_input: any) => Promise.resolve(null),
    compile: (_input: any) => Promise.resolve({ ok: false, definition: null, error: 'stub' }),
    update: (_id: string, _patch: any) => Promise.resolve(null),
    delete: (_id: string) => Promise.resolve({ ok: false }),
    run: (_id: string) => Promise.resolve({ ok: false }),
    runOnCurrentPage: (_id: string) => Promise.resolve({ ok: false }),
    runOnUrls: (_id: string, _urls: string[]) => Promise.resolve({ ok: false }),
    history: (_id: string) => Promise.resolve([]),
    test: (_id: string) => Promise.resolve({ ok: false }),
  },
```

With live IPC calls:

```typescript
  agent: {
    list: () => ipcRenderer.invoke(IPC.AGENT_LIST),
    get: (id: string) => ipcRenderer.invoke(IPC.AGENT_GET, id),
    create: (input: any) => ipcRenderer.invoke(IPC.AGENT_CREATE, input),
    compile: (input: any) => ipcRenderer.invoke(IPC.AGENT_COMPILE, input),
    update: (id: string, patch: any) => ipcRenderer.invoke(IPC.AGENT_UPDATE, id, patch),
    delete: (id: string) => ipcRenderer.invoke(IPC.AGENT_DELETE, id),
    run: (id: string) => ipcRenderer.invoke(IPC.AGENT_RUN, id),
    runOnCurrentPage: (id: string) => ipcRenderer.invoke(IPC.AGENT_RUN_CURRENT_PAGE, id),
    runOnUrls: (id: string, urls: string[]) => ipcRenderer.invoke(IPC.AGENT_RUN_URLS, id, urls),
    history: (id: string) => ipcRenderer.invoke(IPC.AGENT_HISTORY, id),
    test: (id: string) => ipcRenderer.invoke(IPC.AGENT_TEST, id),
  },
```

- [ ] **Step 2: Verify TypeScript — no errors**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | grep "error TS" | head -10
```

Expected: no errors

- [ ] **Step 3: Run full test suite**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx vitest run 2>&1 | tail -5
```

Expected: 129 passed, 0 failures

- [ ] **Step 4: Commit**

```bash
cd /home/dp/Desktop/clawdia7.0 && git add src/main/preload.ts && git commit -m "feat: replace agent preload stubs with live IPC calls"
```

---

### Task 6: Also fix `chat.delete` IPC call in preload

**Files:**
- Modify: `src/main/preload.ts`

While reviewing preload, note that `chat.delete` passes no argument to `ipcRenderer.invoke`:

```typescript
delete: (_id: string) => ipcRenderer.invoke(IPC.CHAT_DELETE),  // BUG: id not passed
```

Fix it:

```typescript
delete: (id: string) => ipcRenderer.invoke(IPC.CHAT_DELETE, id),
```

- [ ] **Step 1: Fix the chat.delete call**

Find line: `delete: (_id: string) => ipcRenderer.invoke(IPC.CHAT_DELETE),`

Replace with: `delete: (id: string) => ipcRenderer.invoke(IPC.CHAT_DELETE, id),`

- [ ] **Step 2: Verify TypeScript**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | grep "error TS" | head -10
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd /home/dp/Desktop/clawdia7.0 && git add src/main/preload.ts && git commit -m "fix: pass conversation id to CHAT_DELETE ipc call"
```

---

### Task 7: Final build verification

- [ ] **Step 1: Run full test suite**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx vitest run 2>&1 | tail -8
```

Expected: 129 passed, 0 failures, 15 test files

- [ ] **Step 2: TypeScript clean build**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | grep "error TS"
```

Expected: no output (zero errors)

- [ ] **Step 3: Rebuild better-sqlite3 for Electron**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx electron-rebuild -f -w better-sqlite3 2>&1 | tail -3
```

Expected: `✔ Rebuild Complete`

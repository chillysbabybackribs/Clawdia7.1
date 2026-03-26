# Multi-Agent Pipeline Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-detect complex user goals in chat, decompose them with a Planner agent, run Worker agents in parallel, and synthesize a structured report inline in the chat thread with a live collapsible progress block.

**Architecture:** A `PipelineOrchestrator` class in `src/main/core/PipelineOrchestrator.ts` wraps the existing `agentLoop` to run three sequential stages: Planner (decomposes goal → subtasks JSON), Workers (N parallel `agentLoop` instances), Synthesizer (merges results → structured report). The `CHAT_SEND` IPC handler runs a cheap LLM classifier first; if `pipeline: true`, it delegates to `PipelineOrchestrator` instead of the single `agentLoop`. A new `PipelineBlock` React component renders inline in the chat thread, driven by `SWARM_STATE_CHANGED` events.

**Tech Stack:** Electron 39 + React 19 + TypeScript, better-sqlite3 (sync), Anthropic SDK, existing `agentLoop` / `streamLLM` / `runTracker`, Vitest for tests.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/main/core/PipelineOrchestrator.ts` | **Create** | Planner → Workers → Synthesizer orchestration, emits SwarmState events |
| `src/main/db.ts` | **Modify** | Add `parent_run_id` column to `runs` table migration |
| `src/shared/types.ts` | **Modify** | Add `pipeline` message type to `Message` interface |
| `src/main/registerIpc.ts` | **Modify** | Add intent classifier before `agentLoop` in `CHAT_SEND`; wire preload `onStateChanged`; replace `AGENT_RUN` stub |
| `src/main/preload.ts` | **Modify** | Wire `swarm.onStateChanged` from stub to real `ipcRenderer.on` |
| `src/renderer/components/PipelineBlock.tsx` | **Create** | Inline chat progress block, subscribes to `onStateChanged` |
| `src/renderer/components/ChatPanel.tsx` | **Modify** | Render `<PipelineBlock>` for `msg.type === 'pipeline'` messages |
| `tests/main/PipelineOrchestrator.test.ts` | **Create** | Unit tests for orchestrator stages |
| `tests/renderer/PipelineBlock.test.tsx` | **Create** | Component tests for PipelineBlock |

---

## Task 1: Add `parent_run_id` column to `runs` table

**Files:**
- Modify: `src/main/db.ts`
- Test: `tests/main/db.test.ts`

The `runs` table is created in `initDb()` at line 122. We add `parent_run_id` as a nullable self-reference. The `RunRow` interface at line 36 also needs the field.

- [ ] **Step 1: Write the failing test**

Add to `tests/main/db.test.ts` (after existing tests):

```typescript
it('run can have a parent_run_id', () => {
  const now = new Date().toISOString();
  const parentId = `run-parent-${Date.now()}`;
  const childId = `run-child-${Date.now()}`;
  // parent run needs a conversation
  const convId = `conv-${Date.now()}`;
  db.prepare(`INSERT INTO conversations(id,title,mode,created_at,updated_at) VALUES(?,?,?,?,?)`).run(convId,'t','chat',now,now);
  createRun({ id: parentId, conversation_id: convId, title:'p', goal:'p', status:'running', started_at:now, updated_at:now, tool_call_count:0, was_detached:0, workflow_stage:'orchestrating' });
  createRun({ id: childId, conversation_id: convId, title:'c', goal:'c', status:'running', started_at:now, updated_at:now, tool_call_count:0, was_detached:0, workflow_stage:'executing', parent_run_id: parentId });
  const row = db.prepare('SELECT parent_run_id FROM runs WHERE id=?').get(childId) as any;
  expect(row.parent_run_id).toBe(parentId);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /home/dp/Desktop/clawdia7.0
npx vitest run tests/main/db.test.ts 2>&1 | tail -20
```

Expected: FAIL — `parent_run_id` column does not exist / `createRun` rejects unknown field.

- [ ] **Step 3: Add `parent_run_id` to `RunRow` interface in `src/main/db.ts`**

Find the `RunRow` interface (around line 36) and add the field:

```typescript
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
  total_tokens?: number;
  estimated_cost_usd?: number;
  parent_run_id?: string | null;   // ← add this line
}
```

- [ ] **Step 4: Add `parent_run_id` column to the CREATE TABLE statement in `src/main/db.ts`**

Find the `CREATE TABLE IF NOT EXISTS runs` block (around line 122). Add after `total_tokens INTEGER`:

```sql
parent_run_id TEXT REFERENCES runs(id) ON DELETE CASCADE
```

So the end of the CREATE TABLE looks like:

```sql
        estimated_cost_usd  REAL,
        total_tokens        INTEGER,
        parent_run_id       TEXT REFERENCES runs(id) ON DELETE CASCADE
      );
```

- [ ] **Step 5: Add `parent_run_id` to the `createRun` INSERT in `src/main/db.ts`**

Find the `createRun` function (around line 305). It currently inserts 19 named columns. Add `parent_run_id` to both the column list and the values:

```typescript
export function createRun(run: RunRow): void {
  getDb().prepare(`
    INSERT INTO runs (
      id, conversation_id, title, goal, status,
      started_at, updated_at, completed_at, tool_call_count, error,
      was_detached, provider, model, workflow_stage, scenario_id,
      tool_completed_count, tool_failed_count, estimated_cost_usd, total_tokens,
      parent_run_id
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?
    )
  `).run(
    run.id, run.conversation_id, run.title ?? '', run.goal ?? '', run.status,
    run.started_at, run.updated_at, run.completed_at ?? null, run.tool_call_count, run.error ?? null,
    run.was_detached, run.provider ?? null, run.model ?? null, run.workflow_stage, run.scenario_id ?? null,
    run.tool_completed_count ?? 0, run.tool_failed_count ?? 0, run.estimated_cost_usd ?? null, run.total_tokens ?? null,
    run.parent_run_id ?? null,
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd /home/dp/Desktop/clawdia7.0
npx vitest run tests/main/db.test.ts 2>&1 | tail -20
```

Expected: all tests PASS including the new one.

- [ ] **Step 7: Commit**

```bash
git add src/main/db.ts tests/main/db.test.ts
git commit -m "feat: add parent_run_id column to runs table"
```

---

## Task 2: Create `PipelineOrchestrator`

**Files:**
- Create: `src/main/core/PipelineOrchestrator.ts`
- Test: `tests/main/PipelineOrchestrator.test.ts`

This is the heart of the feature. The orchestrator runs three stages, emits `SwarmState` updates via a callback, and returns the synthesizer's final text. It uses `agentLoop` for workers and direct `streamLLM` calls for the fast planner and synthesizer.

- [ ] **Step 1: Write the failing tests**

Create `tests/main/PipelineOrchestrator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock agentLoop so workers don't actually call the LLM
vi.mock('../../src/main/agent/agentLoop', () => ({
  agentLoop: vi.fn().mockResolvedValue('worker result'),
}));

// Mock streamLLM for planner and synthesizer calls
vi.mock('../../src/main/agent/streamLLM', () => ({
  streamLLM: vi.fn(),
}));

// Mock runTracker so no DB needed
vi.mock('../../src/main/runTracker', () => ({
  startRun: vi.fn().mockReturnValue('run-test-123'),
  completeRun: vi.fn(),
  failRun: vi.fn(),
}));

// Mock db so no SQLite needed
vi.mock('../../src/main/db', () => ({
  createRun: vi.fn(),
  updateRun: vi.fn(),
  getConversation: vi.fn().mockReturnValue({ id: 'conv-1', title: 'test' }),
  createConversation: vi.fn(),
  addMessage: vi.fn(),
  updateConversation: vi.fn(),
}));

import { PipelineOrchestrator } from '../../src/main/core/PipelineOrchestrator';
import { streamLLM } from '../../src/main/agent/streamLLM';
import { agentLoop } from '../../src/main/agent/agentLoop';

const mockStreamLLM = vi.mocked(streamLLM);
const mockAgentLoop = vi.mocked(agentLoop);

const baseOptions = {
  provider: 'anthropic' as const,
  apiKey: 'test-key',
  model: 'claude-sonnet-4-6',
  conversationId: 'conv-1',
  signal: new AbortController().signal,
  browserService: undefined as any,
  unrestrictedMode: false,
};

describe('PipelineOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('classifyIntent returns true for complex multi-part goals', async () => {
    mockStreamLLM.mockResolvedValueOnce({
      text: JSON.stringify({ pipeline: true, reason: 'complex task' }),
      toolBlocks: [],
    });
    const result = await PipelineOrchestrator.classifyIntent('research AI trends and compare top 5 companies', baseOptions);
    expect(result).toBe(true);
  });

  it('classifyIntent returns false for simple goals', async () => {
    mockStreamLLM.mockResolvedValueOnce({
      text: JSON.stringify({ pipeline: false, reason: 'simple task' }),
      toolBlocks: [],
    });
    const result = await PipelineOrchestrator.classifyIntent('what is the weather today', baseOptions);
    expect(result).toBe(false);
  });

  it('classifyIntent returns false on parse error (fail safe)', async () => {
    mockStreamLLM.mockResolvedValueOnce({ text: 'invalid json{{', toolBlocks: [] });
    const result = await PipelineOrchestrator.classifyIntent('something', baseOptions);
    expect(result).toBe(false);
  });

  it('run calls planner, then workers in parallel, then synthesizer', async () => {
    // Planner response
    mockStreamLLM.mockResolvedValueOnce({
      text: JSON.stringify([
        { id: 'sub-1', subtask: 'Research market trends', goal: 'Find top 3 market trends' },
        { id: 'sub-2', subtask: 'Analyze competitors', goal: 'List 3 main competitors' },
      ]),
      toolBlocks: [],
    });
    // Synthesizer response
    mockStreamLLM.mockResolvedValueOnce({
      text: '## Findings\n\nsome findings\n\n## Summary\n\nsome summary',
      toolBlocks: [],
    });

    const stateUpdates: any[] = [];
    const result = await PipelineOrchestrator.run('research the AI market', {
      ...baseOptions,
      onStateChanged: (s) => stateUpdates.push(JSON.parse(JSON.stringify(s))),
      onText: vi.fn(),
    });

    // Workers ran
    expect(mockAgentLoop).toHaveBeenCalledTimes(2);

    // State transitions: planning → workers running → workers done → synthesizing → done
    const statuses = stateUpdates.map(s => s.agents.map((a: any) => a.status));
    expect(stateUpdates[0].agents[0].status).toBe('running'); // planner running
    expect(result).toContain('Findings');
  });

  it('run continues with partial results when a worker fails', async () => {
    mockStreamLLM.mockResolvedValueOnce({
      text: JSON.stringify([
        { id: 'sub-1', subtask: 'Task 1', goal: 'Goal 1' },
        { id: 'sub-2', subtask: 'Task 2', goal: 'Goal 2' },
      ]),
      toolBlocks: [],
    });
    // Worker 1 succeeds, Worker 2 fails
    mockAgentLoop
      .mockResolvedValueOnce('worker 1 result')
      .mockRejectedValueOnce(new Error('worker 2 failed'));
    // Synthesizer
    mockStreamLLM.mockResolvedValueOnce({ text: '## Summary\n\npartial results', toolBlocks: [] });

    const result = await PipelineOrchestrator.run('some task', {
      ...baseOptions,
      onStateChanged: vi.fn(),
      onText: vi.fn(),
    });

    // Synthesizer still called with partial results
    expect(mockStreamLLM).toHaveBeenCalledTimes(2); // planner + synthesizer
    expect(result).toContain('Summary');
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
cd /home/dp/Desktop/clawdia7.0
npx vitest run tests/main/PipelineOrchestrator.test.ts 2>&1 | tail -20
```

Expected: FAIL — `PipelineOrchestrator` module not found.

- [ ] **Step 3: Create `src/main/core/PipelineOrchestrator.ts`**

```typescript
// src/main/core/PipelineOrchestrator.ts
import { agentLoop } from '../agent/agentLoop';
import { streamLLM } from '../agent/streamLLM';
import { createRun, updateRun, addMessage, updateConversation } from '../db';
import type { LoopOptions } from '../agent/types';
import type { SwarmState, SwarmAgent } from '../../shared/types';

export interface PipelineRunOptions {
  provider: 'anthropic' | 'openai' | 'gemini';
  apiKey: string;
  model: string;
  conversationId: string;
  signal: AbortSignal;
  browserService: any;
  unrestrictedMode: boolean;
  onStateChanged: (state: SwarmState) => void;
  onText: (delta: string) => void;
}

interface Subtask {
  id: string;
  subtask: string;
  goal: string;
}

const MAX_WORKERS = 5;
const MAX_WORKER_TOOL_CALLS = 20;
const MAX_WORKER_ITERATIONS = 30;

export class PipelineOrchestrator {
  /**
   * Classify whether the user's goal warrants a multi-agent pipeline.
   * Returns false on any error (fail-safe: fall back to single agent).
   */
  static async classifyIntent(
    goal: string,
    opts: Pick<PipelineRunOptions, 'provider' | 'apiKey' | 'model' | 'signal'>,
  ): Promise<boolean> {
    const systemPrompt =
      'You are a task classifier. Decide if the user goal is complex enough to benefit from being broken into 2–5 independent parallel subtasks. ' +
      'Answer ONLY with JSON: {"pipeline": true|false, "reason": "one sentence"}. ' +
      'Return pipeline:true only if parallel execution genuinely helps (multi-source research, multi-entity analysis, staged work). ' +
      'Return pipeline:false for simple questions, single-step tasks, or greetings.';
    try {
      const { text } = await streamLLM(
        [{ role: 'user', content: goal }],
        systemPrompt,
        '',
        { toolGroup: 'core', modelTier: 'fast', isGreeting: false },
        { ...opts, onText: () => {}, maxIterations: 1 } as any,
      );
      // Extract JSON — model may wrap in markdown fences
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return false;
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.pipeline === true;
    } catch {
      return false;
    }
  }

  /**
   * Run a full Planner → Workers → Synthesizer pipeline.
   * Returns the synthesizer's final text (structured report).
   */
  static async run(goal: string, opts: PipelineRunOptions): Promise<string> {
    const parentRunId = `run-pipe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    // Create parent run record
    createRun({
      id: parentRunId,
      conversation_id: opts.conversationId,
      title: goal.slice(0, 60),
      goal,
      status: 'running',
      started_at: now,
      updated_at: now,
      tool_call_count: 0,
      was_detached: 0,
      workflow_stage: 'orchestrating',
      parent_run_id: null,
    });

    // Build initial SwarmState with planner agent
    const plannerAgent: SwarmAgent = {
      id: 'planner',
      role: 'coordinator',
      goal: 'Decompose goal into subtasks',
      status: 'running',
      startedAt: Date.now(),
      toolCallCount: 0,
    };

    const state: SwarmState = {
      runId: parentRunId,
      totalAgents: 1, // will be updated once planner finishes
      agents: [plannerAgent],
      startedAt: Date.now(),
    };

    opts.onStateChanged({ ...state, agents: [...state.agents] });

    // ── Stage 1: Planner ──────────────────────────────────────────────────────
    let subtasks: Subtask[] = [];
    try {
      const plannerPrompt =
        'You are a task planner. Break the user goal into 2–5 independent parallel subtasks. ' +
        'Each subtask should be self-contained and executable by a separate agent. ' +
        'Respond ONLY with a JSON array: [{"id":"sub-1","subtask":"short name","goal":"what the agent should accomplish"}]. ' +
        'Maximum 5 subtasks. Minimum 2.';

      const { text } = await streamLLM(
        [{ role: 'user', content: goal }],
        plannerPrompt,
        '',
        { toolGroup: 'core', modelTier: 'fast', isGreeting: false },
        { ...opts, onText: () => {}, maxIterations: 1 } as any,
      );

      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('Planner did not return a JSON array');
      subtasks = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(subtasks) || subtasks.length < 2) throw new Error('Planner returned fewer than 2 subtasks');
      subtasks = subtasks.slice(0, MAX_WORKERS);
    } catch (e: any) {
      // Planner failed — mark failed and rethrow so caller can surface error
      plannerAgent.status = 'failed';
      plannerAgent.error = e.message;
      plannerAgent.completedAt = Date.now();
      updateRun(parentRunId, { status: 'failed', workflow_stage: 'failed', updated_at: new Date().toISOString() });
      opts.onStateChanged({ ...state, agents: [...state.agents], completedAt: Date.now() });
      throw e;
    }

    // Planner done — update state with worker agents
    plannerAgent.status = 'done';
    plannerAgent.completedAt = Date.now();

    const workerAgents: SwarmAgent[] = subtasks.map((sub) => ({
      id: sub.id,
      role: 'analyst' as const,
      goal: sub.goal,
      status: 'queued' as const,
      toolCallCount: 0,
    }));

    const synthAgent: SwarmAgent = {
      id: 'synthesizer',
      role: 'synthesizer',
      goal: 'Synthesize worker results into a structured report',
      status: 'queued',
      toolCallCount: 0,
    };

    state.totalAgents = 1 + workerAgents.length + 1; // planner + workers + synthesizer
    state.agents = [plannerAgent, ...workerAgents, synthAgent];
    opts.onStateChanged({ ...state, agents: [...state.agents] });

    // ── Stage 2: Workers (parallel) ───────────────────────────────────────────
    const loopBase: Omit<LoopOptions, 'runId' | 'onText'> = {
      provider: opts.provider,
      apiKey: opts.apiKey,
      model: opts.model,
      signal: opts.signal,
      unrestrictedMode: opts.unrestrictedMode,
      browserService: opts.browserService,
      maxIterations: MAX_WORKER_ITERATIONS,
      onThinking: () => {},
      onToolActivity: (activity) => {
        // Update toolCallCount on the matching worker agent
        const agent = state.agents.find(a => a.id !== 'planner' && a.id !== 'synthesizer' && a.status === 'running');
        if (agent) agent.toolCallCount++;
        opts.onStateChanged({ ...state, agents: [...state.agents] });
      },
    };

    const workerResults: Array<{ subtask: string; result: string; ok: boolean }> = [];

    await Promise.all(
      subtasks.map(async (sub, i) => {
        const workerAgent = workerAgents[i];
        const workerRunId = `run-worker-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const workerNow = new Date().toISOString();

        createRun({
          id: workerRunId,
          conversation_id: opts.conversationId,
          title: sub.subtask,
          goal: sub.goal,
          status: 'running',
          started_at: workerNow,
          updated_at: workerNow,
          tool_call_count: 0,
          was_detached: 0,
          workflow_stage: 'executing',
          parent_run_id: parentRunId,
        });

        workerAgent.status = 'running';
        workerAgent.startedAt = Date.now();
        opts.onStateChanged({ ...state, agents: [...state.agents] });

        try {
          const result = await agentLoop(sub.goal, [], {
            ...loopBase,
            runId: workerRunId,
            onText: () => {},
          });
          workerAgent.status = 'done';
          workerAgent.completedAt = Date.now();
          workerAgent.result = result.slice(0, 500);
          workerResults.push({ subtask: sub.subtask, result, ok: true });
          updateRun(workerRunId, { status: 'completed', workflow_stage: 'completed', updated_at: new Date().toISOString() });
        } catch (e: any) {
          workerAgent.status = 'failed';
          workerAgent.completedAt = Date.now();
          workerAgent.error = e.message;
          workerResults.push({ subtask: sub.subtask, result: '', ok: false });
          updateRun(workerRunId, { status: 'failed', workflow_stage: 'failed', updated_at: new Date().toISOString() });
        }

        opts.onStateChanged({ ...state, agents: [...state.agents] });
      }),
    );

    // ── Stage 3: Synthesizer ──────────────────────────────────────────────────
    synthAgent.status = 'running';
    synthAgent.startedAt = Date.now();
    opts.onStateChanged({ ...state, agents: [...state.agents] });

    const successResults = workerResults.filter(r => r.ok);
    const failedSubtasks = workerResults.filter(r => !r.ok).map(r => r.subtask);

    const workerSummary = successResults
      .map((r, i) => `### Subtask ${i + 1}: ${r.subtask}\n\n${r.result}`)
      .join('\n\n---\n\n');

    const failureNote = failedSubtasks.length > 0
      ? `\n\nNote: The following subtasks failed and have no results: ${failedSubtasks.join(', ')}.`
      : '';

    const synthSystemPrompt =
      'You are a research synthesizer. Given the original user goal and results from parallel worker agents, ' +
      'write a clean structured report. Use markdown with titled sections. Always include: ' +
      '## Findings (key discoveries), ## Analysis (what they mean), ## Summary (2–3 sentence takeaway). ' +
      'Add a ## Sources section if any URLs were referenced. Be concise and factual.';

    const synthUserContent =
      `Original goal: ${goal}${failureNote}\n\n` +
      `Worker results:\n\n${workerSummary}`;

    let finalText = '';
    try {
      const { text } = await streamLLM(
        [{ role: 'user', content: synthUserContent }],
        synthSystemPrompt,
        '',
        { toolGroup: 'core', modelTier: 'standard', isGreeting: false },
        { ...opts, onText: (delta) => { finalText += delta; opts.onText(delta); }, maxIterations: 1 } as any,
      );
      finalText = text;
      synthAgent.status = 'done';
      synthAgent.completedAt = Date.now();
    } catch (e: any) {
      synthAgent.status = 'failed';
      synthAgent.completedAt = Date.now();
      synthAgent.error = e.message;
      updateRun(parentRunId, { status: 'failed', workflow_stage: 'failed', updated_at: new Date().toISOString() });
      opts.onStateChanged({ ...state, agents: [...state.agents], completedAt: Date.now() });
      throw e;
    }

    // Finalize
    updateRun(parentRunId, { status: 'completed', workflow_stage: 'completed', updated_at: new Date().toISOString() });
    state.completedAt = Date.now();
    opts.onStateChanged({ ...state, agents: [...state.agents] });

    return finalText;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/dp/Desktop/clawdia7.0
npx vitest run tests/main/PipelineOrchestrator.test.ts 2>&1 | tail -30
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/PipelineOrchestrator.ts tests/main/PipelineOrchestrator.test.ts
git commit -m "feat: add PipelineOrchestrator with planner/workers/synthesizer stages"
```

---

## Task 3: Wire preload `swarm.onStateChanged` and integrate pipeline into `CHAT_SEND`

**Files:**
- Modify: `src/main/preload.ts` (line 143)
- Modify: `src/main/registerIpc.ts` (lines 257–345, 476–486)

- [ ] **Step 1: Wire `swarm.onStateChanged` in preload**

In `src/main/preload.ts`, find the swarm section (line 142):

```typescript
// BEFORE:
swarm: {
  onStateChanged: (_cb: (state: any) => void) => noop,
},

// AFTER:
swarm: {
  onStateChanged: (cb: (state: any) => void) => {
    ipcRenderer.on(IPC_EVENTS.SWARM_STATE_CHANGED, (_e, state) => cb(state));
    return () => ipcRenderer.removeAllListeners(IPC_EVENTS.SWARM_STATE_CHANGED);
  },
},
```

- [ ] **Step 2: Add pipeline import to `registerIpc.ts`**

At the top of `src/main/registerIpc.ts`, after the existing `agentLoop` import (line 8), add:

```typescript
import { PipelineOrchestrator } from './core/PipelineOrchestrator';
```

- [ ] **Step 3: Add intent detection + pipeline branch to `CHAT_SEND` handler**

In `src/main/registerIpc.ts`, find the `CHAT_SEND` handler. After line 294 (`chatAbort = new AbortController();`) and before line 296 (`const runId = ...`), insert the intent check and pipeline branch. Replace lines 296–344 with:

```typescript
    const settings_provider = settings.provider as 'anthropic' | 'openai' | 'gemini';

    // Check if this goal warrants a multi-agent pipeline
    const usePipeline = await PipelineOrchestrator.classifyIntent(text, {
      provider: settings_provider,
      apiKey,
      model,
      signal: chatAbort!.signal,
    });

    let result: { response: string; error?: string };

    if (usePipeline) {
      // ── Multi-agent pipeline path ─────────────────────────────────────────
      // Insert a synthetic pipeline message into the conversation so PipelineBlock renders
      const pipelineMsgId = `msg-pipe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const pipelineMsgTs = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const pipelineMsg = { id: pipelineMsgId, role: 'assistant', type: 'pipeline', content: '', timestamp: pipelineMsgTs };
      if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_STREAM_END, { ok: true, pipelineMessageId: pipelineMsgId, isPipelineStart: true });

      try {
        const response = await PipelineOrchestrator.run(text, {
          provider: settings_provider,
          apiKey,
          model,
          conversationId: id,
          signal: chatAbort!.signal,
          browserService,
          unrestrictedMode: settings.unrestrictedMode,
          onStateChanged: (state) => {
            if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.SWARM_STATE_CHANGED, state);
          },
          onText: (delta) => {
            if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_STREAM_TEXT, delta);
          },
        });

        result = { response };
        if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_STREAM_END, { ok: true });

        // Persist synthesizer output as assistant message
        if (response) {
          const assistantMsgId = `msg-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const assistantMsgTs = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const assistantMsg: Message = { id: assistantMsgId, role: 'assistant', content: response, timestamp: assistantMsgTs };
          const nowStr = new Date().toISOString();
          addMessage({ id: assistantMsgId, conversation_id: id, role: 'assistant', content: JSON.stringify(assistantMsg), created_at: nowStr });
          updateConversation(id, { updated_at: nowStr, title: text.slice(0, 60) || 'New conversation' });
        }
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        result = { response: '', error: err.message };
        if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message });
      } finally {
        activeRunId = null;
      }
    } else {
      // ── Single agent path (unchanged) ────────────────────────────────────
      const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      activeRunId = runId;

      try {
        const response = await agentLoop(text, sessionMessages, {
          provider: settings_provider,
          apiKey,
          model,
          runId,
          signal: chatAbort!.signal,
          unrestrictedMode: settings.unrestrictedMode,
          browserService,
          onText: (delta) => {
            if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_STREAM_TEXT, delta);
          },
          onThinking: (t) => {
            if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_THINKING, t);
          },
          onToolActivity: (activity) => {
            if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, activity);
          },
        });
        result = { response };
        if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_STREAM_END, { ok: true });
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (err.name === 'AbortError' || err.message === 'AbortError') {
          result = { response: '', error: 'Stopped' };
          if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_STREAM_END, { ok: false, cancelled: true });
        } else {
          result = { response: '', error: err.message };
          if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message });
        }
      } finally {
        activeRunId = null;
      }

      // Persist assistant message
      if (result.response && !result.error) {
        const assistantMsgId = `msg-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const assistantMsgTs = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const assistantMsg: Message = { id: assistantMsgId, role: 'assistant', content: result.response, timestamp: assistantMsgTs };
        const nowStr = new Date().toISOString();
        addMessage({ id: assistantMsgId, conversation_id: id, role: 'assistant', content: JSON.stringify(assistantMsg), created_at: nowStr });
        updateConversation(id, { updated_at: nowStr, title: text.slice(0, 60) || 'New conversation' });
      }
    }

    return result;
```

- [ ] **Step 4: Replace `AGENT_RUN` stub with real implementation**

Find the stub at line 476:

```typescript
// BEFORE:
ipcMain.handle(IPC.AGENT_RUN, () => {
  return { ok: false, error: 'Agent execution not yet implemented' };
});

// AFTER:
ipcMain.handle(IPC.AGENT_RUN, async (_e, id: string) => {
  const agentDef = getAgent(id);
  if (!agentDef) return { ok: false, error: 'Agent not found' };
  const settings = loadSettings();
  const provider = settings.provider as 'anthropic' | 'openai' | 'gemini';
  const apiKey = settings.providerKeys[provider]?.trim();
  if (!apiKey) return { ok: false, error: 'No API key configured' };
  const model = settings.models[provider] ?? DEFAULT_MODEL_BY_PROVIDER[provider];
  const abort = new AbortController();
  const convId = `conv-agent-${Date.now()}`;
  const now = new Date().toISOString();
  createConversation({ id: convId, title: agentDef.name, mode: 'chat', created_at: now, updated_at: now });
  try {
    await PipelineOrchestrator.run(agentDef.goal, {
      provider, apiKey, model,
      conversationId: convId,
      signal: abort.signal,
      browserService,
      unrestrictedMode: settings.unrestrictedMode,
      onStateChanged: (state) => {
        getMainWindow()?.webContents.send(IPC_EVENTS.SWARM_STATE_CHANGED, state);
      },
      onText: () => {},
    });
    return { ok: true, conversationId: convId };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
});
```

- [ ] **Step 5: Add missing imports to `registerIpc.ts`**

The pipeline path uses `createConversation` which is already imported. Verify `updateConversation` is also imported (it is, line 15). No new imports needed beyond the `PipelineOrchestrator` import added in Step 2.

- [ ] **Step 6: Run TypeScript check**

```bash
cd /home/dp/Desktop/clawdia7.0
npx tsc --noEmit 2>&1 | head -40
```

Expected: 0 errors. Fix any type errors before continuing.

- [ ] **Step 7: Commit**

```bash
git add src/main/preload.ts src/main/registerIpc.ts
git commit -m "feat: wire swarm onStateChanged preload + pipeline branch in CHAT_SEND"
```

---

## Task 4: Add `type` field to `Message` interface

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/components/ChatPanel.tsx` (the `Message` interface re-declaration there too)

The renderer has its own local `Message` interface in `ChatPanel.tsx` (line 39) that extends the shared one. Both need the `type` field.

- [ ] **Step 1: Add `type` to shared `Message` type in `src/shared/types.ts`**

Find the `Message` interface in `src/shared/types.ts`. Add the optional `type` field:

```typescript
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  type?: 'chat' | 'pipeline';   // ← add this line; undefined = 'chat'
  content: string;
  timestamp: string;
  attachments?: MessageAttachment[];
  // ... rest unchanged
}
```

- [ ] **Step 2: Add `type` to the renderer's local `Message` interface in `ChatPanel.tsx`**

Find the `Message` interface in `src/renderer/components/ChatPanel.tsx` (around line 39). Add:

```typescript
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  type?: 'chat' | 'pipeline';   // ← add this line
  content: string;
  timestamp: string;
  // ... rest unchanged
}
```

- [ ] **Step 3: Run TypeScript check**

```bash
cd /home/dp/Desktop/clawdia7.0
npx tsc --noEmit 2>&1 | head -20
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/renderer/components/ChatPanel.tsx
git commit -m "feat: add optional type field to Message interface"
```

---

## Task 5: Create `PipelineBlock` component

**Files:**
- Create: `src/renderer/components/PipelineBlock.tsx`
- Test: `tests/renderer/PipelineBlock.test.tsx`

This is the inline collapsible card we designed. It subscribes to `window.clawdia.swarm.onStateChanged` and renders agent rows with fixed height + internal scroll.

- [ ] **Step 1: Write the failing tests**

Create `tests/renderer/PipelineBlock.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PipelineBlock from '../../src/renderer/components/PipelineBlock';
import type { SwarmState } from '../../src/shared/types';

// Mock the clawdia API
const mockOnStateChanged = vi.fn();
const mockOff = vi.fn();
vi.stubGlobal('window', {
  clawdia: {
    swarm: {
      onStateChanged: (cb: (s: SwarmState) => void) => {
        mockOnStateChanged.mockImplementation(cb);
        return mockOff;
      },
    },
  },
});

const runningState: SwarmState = {
  runId: 'run-1',
  totalAgents: 3,
  startedAt: Date.now() - 5000,
  agents: [
    { id: 'planner', role: 'coordinator', goal: 'Plan tasks', status: 'done', startedAt: Date.now() - 5000, completedAt: Date.now() - 4000, toolCallCount: 0 },
    { id: 'sub-1', role: 'analyst', goal: 'Research trends', status: 'running', startedAt: Date.now() - 4000, toolCallCount: 9 },
    { id: 'synthesizer', role: 'synthesizer', goal: 'Synthesize results', status: 'queued', toolCallCount: 0 },
  ],
};

const completedState: SwarmState = {
  ...runningState,
  completedAt: Date.now(),
  agents: runningState.agents.map(a => ({ ...a, status: 'done' as const, completedAt: Date.now() })),
};

describe('PipelineBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when no state received yet', () => {
    const { container } = render(<PipelineBlock />);
    expect(container.firstChild).toBeNull();
  });

  it('shows running state with agent list when state arrives', async () => {
    render(<PipelineBlock />);
    act(() => mockOnStateChanged(runningState));
    expect(screen.getByText(/Running pipeline/i)).toBeInTheDocument();
    expect(screen.getByText(/Research trends/i)).toBeInTheDocument();
    expect(screen.getByText(/9 tools/i)).toBeInTheDocument();
  });

  it('collapses to single line on completion', async () => {
    render(<PipelineBlock />);
    act(() => mockOnStateChanged(completedState));
    expect(screen.getByText(/Pipeline complete/i)).toBeInTheDocument();
    // Agent rows should not be visible in collapsed state
    expect(screen.queryByText(/Research trends/i)).not.toBeInTheDocument();
  });

  it('toggles expanded/collapsed on header click', async () => {
    const user = userEvent.setup();
    render(<PipelineBlock />);
    act(() => mockOnStateChanged(runningState));
    // Initially expanded (running state auto-expands)
    expect(screen.getByText(/Research trends/i)).toBeInTheDocument();
    // Click to collapse
    await user.click(screen.getByText(/Running pipeline/i));
    expect(screen.queryByText(/Research trends/i)).not.toBeInTheDocument();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<PipelineBlock />);
    unmount();
    expect(mockOff).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
cd /home/dp/Desktop/clawdia7.0
npx vitest run tests/renderer/PipelineBlock.test.tsx 2>&1 | tail -20
```

Expected: FAIL — `PipelineBlock` module not found.

- [ ] **Step 3: Create `src/renderer/components/PipelineBlock.tsx`**

```typescript
// src/renderer/components/PipelineBlock.tsx
import { useState, useEffect } from 'react';
import type { SwarmState, SwarmAgent } from '../../shared/types';

function agentStatusDot(status: SwarmAgent['status']): React.ReactElement {
  const style: React.CSSProperties = {
    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
  };
  if (status === 'running') {
    return <span style={{ ...style, background: '#1A73E8', animation: 'pb-pulse 1.5s infinite' }} />;
  }
  if (status === 'done') {
    return <span style={{ ...style, background: 'rgba(255,255,255,0.2)' }} />;
  }
  if (status === 'failed') {
    return <span style={{ ...style, background: 'rgba(200,50,50,0.7)' }} />;
  }
  // queued / cancelled
  return <span style={{ ...style, background: 'rgba(255,255,255,0.08)' }} />;
}

function formatDuration(startedAt?: number, completedAt?: number): string {
  if (!startedAt) return '';
  const ms = (completedAt ?? Date.now()) - startedAt;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function AgentRow({ agent }: { agent: SwarmAgent }) {
  const isActive = agent.status === 'running';
  const isDone = agent.status === 'done';
  const isFailed = agent.status === 'failed';
  const isWaiting = agent.status === 'queued';

  const rowStyle: React.CSSProperties = {
    padding: '7px 14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: isActive ? 'rgba(26,115,232,0.05)' : 'transparent',
  };

  const labelColor = isActive ? '#e0e0e4' : isDone ? '#6a6a7a' : isFailed ? '#b05050' : '#3a3a4a';
  const metaColor = isActive ? '#4d96f0' : isDone ? '#6a6a7a' : isFailed ? '#b05050' : '#3a3a4a';

  const meta = isFailed
    ? `failed${agent.error ? ` · ${agent.error.slice(0, 40)}` : ''}`
    : isDone
    ? `done · ${formatDuration(agent.startedAt, agent.completedAt)}${agent.toolCallCount > 0 ? ` · ${agent.toolCallCount} tools` : ''}`
    : isActive
    ? `${agent.toolCallCount > 0 ? `${agent.toolCallCount} tools` : '…'}`
    : 'waiting';

  return (
    <div style={rowStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {agentStatusDot(agent.status)}
        <span style={{ color: labelColor, fontSize: 11 }}>{agent.goal}</span>
      </div>
      <span style={{ color: metaColor, fontSize: 11, flexShrink: 0, marginLeft: 8 }}>{meta}</span>
    </div>
  );
}

export default function PipelineBlock() {
  const [state, setState] = useState<SwarmState | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const off = window.clawdia.swarm.onStateChanged((s: SwarmState) => {
      setState(s);
      if (!s.completedAt) setExpanded(true);
      else setExpanded(false);
    });
    return off;
  }, []);

  if (!state) return null;

  const isComplete = !!state.completedAt;
  const doneCount = state.agents.filter(a => a.status === 'done').length;
  const totalTools = state.agents.reduce((n, a) => n + a.toolCallCount, 0);
  const wallMs = state.completedAt ? state.completedAt - state.startedAt : Date.now() - state.startedAt;

  if (isComplete) {
    // Collapsed completed state
    return (
      <>
        <style>{`@keyframes pb-pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
        <div
          style={{
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 8,
            overflow: 'hidden',
            background: '#0f0f13',
            margin: '4px 0',
            cursor: 'pointer',
          }}
          onClick={() => setExpanded(e => !e)}
        >
          <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'inline-block' }} />
              <span style={{ color: '#6a6a7a', fontSize: 12 }}>Pipeline complete</span>
              <span style={{ color: '#3a3a4a', fontSize: 11 }}>
                · {state.agents.length} agents · {(wallMs / 1000).toFixed(1)}s{totalTools > 0 ? ` · ${totalTools} tools` : ''}
              </span>
            </div>
            <span style={{ color: '#3a3a4a', fontSize: 11 }}>{expanded ? '▾' : '▸'}</span>
          </div>
          {expanded && (
            <div style={{ maxHeight: 148, overflowY: 'auto', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              {state.agents.map(agent => <AgentRow key={agent.id} agent={agent} />)}
            </div>
          )}
        </div>
      </>
    );
  }

  // Running state
  return (
    <>
      <style>{`@keyframes pb-pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
      <div
        style={{
          border: '1px solid rgba(26,115,232,0.25)',
          borderRadius: 8,
          overflow: 'hidden',
          background: '#0f0f13',
          margin: '4px 0',
        }}
      >
        {/* Header */}
        <div
          style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}
          onClick={() => setExpanded(e => !e)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1A73E8', display: 'inline-block', animation: 'pb-pulse 1.5s infinite' }} />
            <span style={{ color: '#e0e0e4', fontSize: 12, fontWeight: 500 }}>Running pipeline</span>
            <span style={{ color: '#5a5a68', fontSize: 11 }}>· {state.agents.length} agents</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#5a5a68', fontSize: 11 }}>{doneCount} / {state.totalAgents} done</span>
            <span style={{ color: '#5a5a68', fontSize: 11 }}>{expanded ? '▾' : '▸'}</span>
          </div>
        </div>

        {/* Agent list */}
        {expanded && (
          <div style={{ maxHeight: 148, overflowY: 'auto' }}>
            {state.agents.map(agent => <AgentRow key={agent.id} agent={agent} />)}
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/dp/Desktop/clawdia7.0
npx vitest run tests/renderer/PipelineBlock.test.tsx 2>&1 | tail -30
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/PipelineBlock.tsx tests/renderer/PipelineBlock.test.tsx
git commit -m "feat: add PipelineBlock inline chat progress component"
```

---

## Task 6: Render `PipelineBlock` in `ChatPanel`

**Files:**
- Modify: `src/renderer/components/ChatPanel.tsx`

The chat message list (around line 1142) renders `AssistantMessage` or `UserMessage`. We need to handle `msg.type === 'pipeline'` by rendering `<PipelineBlock>` instead.

- [ ] **Step 1: Import `PipelineBlock` in `ChatPanel.tsx`**

At the top of `src/renderer/components/ChatPanel.tsx`, add:

```typescript
import PipelineBlock from './PipelineBlock';
```

- [ ] **Step 2: Update the message list renderer**

Find the message list map (around line 1142):

```typescript
// BEFORE:
{messages.map(msg =>
  msg.role === 'assistant'
    ? <AssistantMessage key={msg.id} message={msg} shimmerText={msg.isStreaming ? shimmerText : undefined} />
    : <UserMessage key={msg.id} message={msg} />
)}

// AFTER:
{messages.map(msg =>
  msg.type === 'pipeline'
    ? <PipelineBlock key={msg.id} />
    : msg.role === 'assistant'
    ? <AssistantMessage key={msg.id} message={msg} shimmerText={msg.isStreaming ? shimmerText : undefined} />
    : <UserMessage key={msg.id} message={msg} />
)}
```

- [ ] **Step 3: Handle the `isPipelineStart` signal in `CHAT_STREAM_END` listener**

In `ChatPanel.tsx`, find the `onStreamEnd` handler (search for `handleStreamEnd` or `onStreamEnd`). When the backend signals `isPipelineStart: true`, we insert a pipeline placeholder message into state so `PipelineBlock` renders:

```typescript
// Inside the onStreamEnd callback, at the top before existing logic:
if (data?.isPipelineStart && data?.pipelineMessageId) {
  const pipelineMsg: Message = {
    id: data.pipelineMessageId,
    role: 'assistant',
    type: 'pipeline',
    content: '',
    timestamp: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  };
  setMessages(prev => [...prev, pipelineMsg]);
  return;
}
```

- [ ] **Step 4: Run TypeScript check**

```bash
cd /home/dp/Desktop/clawdia7.0
npx tsc --noEmit 2>&1 | head -20
```

Expected: 0 errors.

- [ ] **Step 5: Run the full test suite**

```bash
cd /home/dp/Desktop/clawdia7.0
npx vitest run 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/ChatPanel.tsx
git commit -m "feat: render PipelineBlock for pipeline-type messages in ChatPanel"
```

---

## Task 7: End-to-end smoke test in the running app

This task is manual — no automated test possible for the full Electron pipeline.

- [ ] **Step 1: Rebuild better-sqlite3 for Electron**

```bash
cd /home/dp/Desktop/clawdia7.0
npx electron-rebuild -f -w better-sqlite3 2>&1 | tail -5
```

Expected: `✔ Rebuild Complete`

- [ ] **Step 2: Start the app**

```bash
cd /home/dp/Desktop/clawdia7.0
npm run dev
```

- [ ] **Step 3: Send a simple message — verify single-agent path unchanged**

Type: `What is 2 + 2?`

Expected: normal single assistant message, no pipeline block, no delay from classifier.

- [ ] **Step 4: Send a complex research goal — verify pipeline fires**

Type: `Research the top 5 AI coding assistants, compare their pricing and features, and summarize the best options for a solo developer`

Expected:
1. Pipeline block appears in chat (blue border, pulsing dot, "Running pipeline")
2. Agent rows appear: Planner done quickly, Workers running in parallel, Synthesizer waiting
3. Workers finish, Synthesizer starts
4. Structured report streams into chat below the block
5. Pipeline block collapses to completed state (grey, single line with stats)

- [ ] **Step 5: Commit if everything looks good**

```bash
git add -A
git commit -m "feat: multi-agent pipeline orchestration complete"
```

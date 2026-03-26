# Multi-Agent Pipeline Orchestration Design

## Goal

Enable Clawdia to automatically decompose complex user goals into parallel subtasks, run them with independent agents, and synthesize a structured report — all triggered transparently from the chat input with a clean inline progress UI.

---

## Trigger: Intent Detection

Before routing a message to the existing single-agent loop, the chat handler runs a lightweight intent classifier:

- A cheap, fast LLM call with a short system prompt: "Is this task decomposable into 2–5 independent parallel subtasks? Answer JSON: `{ pipeline: boolean, reason: string }`"
- If `pipeline: true`, the message is routed to `PipelineOrchestrator`
- If `pipeline: false`, the message goes through the existing `agentLoop` unchanged — no regression to current behavior
- The classifier is intentionally permissive: it's better to run a small 2-worker pipeline than to force a complex task through one agent
- Users cannot manually force or suppress pipeline mode in v1

---

## Architecture: PipelineOrchestrator

Located at `src/main/core/PipelineOrchestrator.ts`.

Runs three sequential stages using the existing `agentLoop` as the execution primitive:

### Stage 1: Planner
- Single `agentLoop` call, no tools, reasoning-only
- Input: user's original goal
- Output: JSON array of `{ id: string, subtask: string, goal: string }` objects, 2–5 items
- Fast: expected < 5s
- Tracked as events on the parent run (not a separate run record)

### Stage 2: Workers
- N agents run in parallel via `Promise.all`, one per subtask from the planner
- Each worker is a full `agentLoop` instance with its own:
  - Child run record in the `runs` table (linked via `parent_run_id`)
  - Independent tool budget: max 20 tool calls
  - Wall time limit: 3 minutes
  - Abort signal (cancellable independently)
- Workers have no `conversationId` — they run in the background
- Worker count capped at 5
- Each worker returns a text result string when done

### Stage 3: Synthesizer
- Single `agentLoop` call
- Input: original user goal + all worker result strings
- Output: structured report with titled sections (findings, analysis, summary, sources)
- Streamed into the conversation as a normal `assistant` message
- Tracked as events on the parent run

---

## Persistence

### Schema change
One new column on the existing `runs` table:
```sql
ALTER TABLE runs ADD COLUMN parent_run_id TEXT REFERENCES runs(id) ON DELETE CASCADE;
```

### Run records created per pipeline
| Record | Type | conversationId | parent_run_id |
|---|---|---|---|
| Parent run | `workflow_stage: 'orchestrating'` | active chat conversation | null |
| Worker 1..N runs | `workflow_stage: 'executing'` | null | parent run id |

Planner and synthesizer are not separate run records — they emit events on the parent run.

### Completion
When the synthesizer finishes:
1. Synthesizer output saved as `assistant` message in the conversation (same path as normal chat)
2. Parent run marked `completed`
3. All worker runs already marked `completed` or `failed`
4. `SWARM_STATE_CHANGED` emitted with final state → UI collapses pipeline block

---

## IPC

No new channels needed. Existing channels used:

| Channel | Usage |
|---|---|
| `CHAT_SEND` | Entry point — triggers intent detection, then routes to orchestrator or agentLoop |
| `SWARM_STATE_CHANGED` | Emitted by orchestrator as agents start/update/finish. Already defined in IPC channels and preload. |
| `CHAT_STREAM_TEXT` | Synthesizer streams its output through the normal chat streaming path |
| `CHAT_STREAM_END` | Signals completion of the synthesizer, closes the stream |

`AGENT_RUN` IPC handler is replaced with a real implementation calling `PipelineOrchestrator.run()` for agent-definition-triggered runs (future use). For chat-triggered pipelines, the entry point is `CHAT_SEND`.

---

## UI

### PipelineBlock component
- New component: `src/renderer/components/PipelineBlock.tsx`
- Renders inline in the chat message list as a special message type
- When the orchestrator starts, a synthetic message with `type: 'pipeline'` is inserted into the chat thread; `ChatPanel` renders `<PipelineBlock>` instead of markdown for this message type
- Subscribes to `clawdia.swarm.onStateChanged`

**Visual design (running state):**
- Fixed-height card (≈148px inner scroll area), border `rgba(26,115,232,0.25)`, background `#0f0f13`
- Header: pulsing blue dot + "Running pipeline" + agent count + "N / M done"
- Agent rows: active rows highlighted with `rgba(26,115,232,0.05)` background + blue dot; done rows muted; waiting rows dim
- Internal scroll engages when agent list exceeds card height (3px scrollbar)
- Collapsible via ▾/▸ toggle

**Visual design (completed state):**
- Single-line collapsed row: grey dot + "Pipeline complete" + stats (agent count, wall time, total tools)
- Border fades to `rgba(255,255,255,0.06)`
- Stays in the thread permanently as a record

**Colors:** `#1A73E8` (blue active), `#4d96f0` (blue hover/count), `#e0e0e4` (active agent text), `#6a6a7a` (done agents), `#3a3a4a` (waiting agents), `#0f0f13` (background)

### SwarmPanel
- No changes needed — already listens to `clawdia.swarm.onStateChanged`
- Receives the same events as `PipelineBlock` for free
- Remains as an optional detail view

---

## SwarmState shape emitted

The orchestrator emits `SwarmState` objects (already typed in `src/shared/types.ts`):

```typescript
{
  runId: string,           // parent run id
  totalAgents: number,     // planner + workers + synthesizer
  agents: [
    { id, role: 'planner', goal, status, startedAt, completedAt, toolCallCount, result },
    { id, role: 'worker',  goal, status, startedAt, completedAt, toolCallCount, result },
    // ...workers
    { id, role: 'synthesizer', goal, status, startedAt, completedAt, toolCallCount }
  ],
  startedAt: number
}
```

Status values: `'queued' | 'running' | 'done' | 'failed' | 'cancelled'`

---

## Error handling

- **Planner fails**: surface error in chat as a normal assistant error message, no pipeline block shown
- **Worker fails**: mark worker as `failed` in SwarmState, continue with remaining workers. Synthesizer receives partial results and notes which subtasks failed.
- **Synthesizer fails**: surface error in chat, pipeline block shows "Pipeline failed" state
- **User cancels**: existing `CHAT_STOP` IPC propagates abort signal to parent run; orchestrator cancels all in-flight workers via their individual abort signals

---

## Out of scope (v1)

- User-configurable pipeline shape or stage count
- Forcing / suppressing pipeline mode from chat
- Evidence ledger / `SwarmEvidenceRecord` persistence
- Staged reduce / multi-round pipelines
- Streaming worker progress (only status updates, not live tool activity per worker)
- Agent-definition-triggered swarms (AGENT_RUN wired but not fully featured)

# Agent Loop Design

**Date:** 2026-03-26
**Status:** Approved

## Overview

Rebuild Clawdia 7.0's agent loop from three independent per-provider chat files into a single provider-agnostic orchestrator using a pure-function pipeline. Inspired by 4.0's `loop.ts` but decomposed into focused files, capped at ~150 lines in the orchestrator itself.

---

## Problem Statement

7.0 currently has three separate streaming chat files (`anthropicChat.ts`, `openaiChat.ts`, `geminiChat.ts`), each running their own internal tool loop (MAX 20 turns). This means:

- Bug fixes and improvements must be made in 3 places
- No shared pause/cancel/inject-context controls
- No task classification or model tier selection
- No browser budget enforcement
- No post-loop verification or recovery
- No structured dispatch context

---

## Architecture

### File Layout

```
src/main/agent/
  agentLoop.ts       ← thin orchestrator (~150 lines)
  classify.ts        ← task classification → tool group + model tier
  promptBuilder.ts   ← static + dynamic prompt assembly
  dispatch.ts        ← parallel tool execution with DispatchContext
  recovery.ts        ← post-loop verification + single recovery call
  browserBudget.ts   ← browser policy enforcement
  loopControl.ts     ← pause/cancel/inject-context controls (Map keyed by runId)
  types.ts           ← shared interfaces
```

The three existing `*Chat.ts` files are simplified to thin `streamLLM()` adapters — their internal tool loops are removed. All loop logic lives in `agentLoop.ts`.

---

## Shared Types (`types.ts`)

```typescript
interface AgentProfile {
  toolGroup: 'core' | 'browser' | 'desktop' | 'coding' | 'full'
  modelTier: 'fast' | 'standard' | 'powerful'
  isGreeting: boolean
}

interface LoopOptions {
  provider: 'anthropic' | 'openai' | 'gemini'
  apiKey: string
  model?: string
  runId: string
  maxIterations?: number          // default 50
  signal?: AbortSignal
  forcedProfile?: Partial<AgentProfile>
  onText: (delta: string) => void
  onThinking?: (delta: string) => void
  onToolActivity?: (name: string, input: unknown) => void
}

interface DispatchContext {
  runId: string
  signal: AbortSignal
  tools: Tool[]
  iterationIndex: number
  toolCallCount: number
  allToolCalls: ToolCall[]
  browserBudget: BrowserBudgetState
  options: LoopOptions
}

interface VerificationResult {
  issue: string
  context: string
}

interface ToolCall {
  name: string
  input: Record<string, unknown>
  result: NormalizedToolResult
}
```

---

## Orchestrator (`agentLoop.ts`)

Single exported function — sequences all phases, manages iteration state:

```typescript
export async function agentLoop(
  userMessage: string,
  messages: Message[],
  options: LoopOptions
): Promise<string>
```

**Iteration flow:**
1. `classify(userMessage, options.forcedProfile)` → `AgentProfile`
2. `buildStaticPrompt(profile)` + `getToolsForGroup(profile.toolGroup)` — built once
3. `createLoopControl(runId, signal)` + `initDispatchContext(...)` — initialized once
4. For each iteration (max 50):
   - `control.waitIfPaused()` — blocks if paused
   - Check `signal.aborted` — exit if cancelled
   - `injectPendingContext(messages, control)` — add queued user context
   - `buildDynamicPrompt(profile, ctx)` — rebuilt each turn
   - `streamLLM(messages, staticPrompt, dynamicPrompt, tools, options)` → `{ textBlocks, toolBlocks }`
   - If no `toolBlocks`: break (LLM is done)
   - `checkBrowserBudget(toolBlocks, ctx.browserBudget)` + `checkToolPolicy(toolBlocks)` — if violation: push message, continue
   - `dispatch(toolBlocks, ctx)` → results
   - `pushToolResults(messages, toolBlocks, results)`
   - `ctx.iterationIndex++`
5. `verifyOutcomes(finalText, ctx.allToolCalls)` — post-loop check
6. If issue: `runRecovery(issue, finalText, messages, tools, options)`
7. Return `finalText`

---

## Classification (`classify.ts`)

Pure function. Pattern-match on message to determine tool group and model tier. Supports a `forced` partial override for dedicated agent UIs.

**Tool groups:**
- `browser` — web/search/navigate keywords
- `desktop` — click/screenshot/GUI keywords
- `coding` — code/debug/refactor keywords
- `core` — file/folder/read/write keywords
- `full` — default fallback (all tools)

**Model tiers:**
- `fast` — quick/simple/brief keywords → maps to Haiku
- `powerful` — desktop group or complex/thorough keywords → maps to Opus
- `standard` — default → maps to Sonnet

Model tier maps to actual model IDs via the existing `model-registry.ts`.

---

## Prompt Builder (`promptBuilder.ts`)

Two functions:

- `buildStaticPrompt(profile): string` — assembled once per run; includes role description, tool guidance, safety rules. Content varies by tool group.
- `buildDynamicPrompt(profile, ctx): string` — rebuilt each iteration; includes current browser budget state, iteration index, any mid-run guidance.

---

## Dispatch (`dispatch.ts`)

```typescript
export async function dispatch(
  toolBlocks: ToolUseBlock[],
  ctx: DispatchContext
): Promise<NormalizedToolResult[]>
```

- Executes all tool calls in `Promise.all` (parallel)
- `ctx.signal.aborted` checked before each tool — cancel respected immediately
- Per-tool errors caught and returned as error results — loop never throws from dispatch
- Routes via `routeToolExecution`: shell tools → `executeShellTool`, browser tools → `executeBrowserTool`, search tools → `executeSearchTool`
- Appends to `ctx.allToolCalls` for later verification

---

## Recovery (`recovery.ts`)

```typescript
export function verifyOutcomes(
  finalText: string,
  allToolCalls: ToolCall[]
): VerificationResult | null

export async function runRecovery(
  issue: VerificationResult,
  finalText: string,
  messages: Message[],
  tools: Tool[],
  options: LoopOptions
): Promise<string>
```

`verifyOutcomes` is pure — checks whether the LLM's final text claims actions that weren't reflected in tool calls (e.g. claimed a file write that never happened). Returns `null` if clean.

`runRecovery` appends a corrective user message and runs a single additional `streamLLM` call. Falls back to original `finalText` if recovery produces nothing — never returns empty.

---

## Browser Budget (`browserBudget.ts`)

```typescript
interface BrowserBudgetState {
  searchRounds: number           // max 2
  inspectedTargets: Set<string>  // max 6 unique URLs
  backgroundTabs: number         // max 6
  scrollFallbacks: Map<string, number>  // max 2 per URL
}

export function initBrowserBudget(): BrowserBudgetState
export function checkBrowserBudget(toolBlocks, state): string | null  // violation message or null
export function updateBrowserBudget(toolBlocks, results, state): void  // called after dispatch
```

`checkBrowserBudget` is called before dispatch. `updateBrowserBudget` is called after. Budget state lives on `DispatchContext`, initialized once per run.

A companion `checkToolPolicy(toolBlocks): string | null` enforces path rules (e.g. `file_write` must not use absolute paths).

---

## Loop Control (`loopControl.ts`)

Module-level `Map<string, LoopControl>` keyed by `runId`. IPC handlers call these directly:

```typescript
export function createLoopControl(runId: string, parentSignal?: AbortSignal): LoopControl
export function cancelLoop(runId: string): boolean
export function pauseLoop(runId: string): boolean
export function resumeLoop(runId: string): boolean
export function addContext(runId: string, text: string): boolean
```

Pause implemented via a `Promise` that resolves on resume. Cancel fires the `AbortController`. `addContext` queues a string that `injectPendingContext()` inserts into messages at the top of the next iteration.

---

## Integration with Existing Code

- `registerIpc.ts`: `CHAT_SEND` handler calls `agentLoop()` instead of per-provider chat functions. `CHAT_STOP` calls `cancelLoop(runId)`.
- `anthropicChat.ts`, `openaiChat.ts`, `geminiChat.ts`: stripped of their internal tool loops; become thin `streamLLM(provider, ...)` adapters that the orchestrator calls.
- `runTracker.ts`: existing run lifecycle tracking unchanged — `agentLoop` uses the same `runId`.

---

## Constants

```
MAX_ITERATIONS = 50
MAX_BROWSER_SEARCH_ROUNDS = 2
MAX_BROWSER_INSPECTED_TARGETS = 6
MAX_BROWSER_BACKGROUND_TABS = 6
MAX_BROWSER_SCROLL_FALLBACKS_PER_TARGET = 2
```

---

## Out of Scope (deferred)

- Harness system (reactive mid-loop model/tool adjustments)
- Evidence ledger (fact accumulation injected into dynamic prompt)
- Bloodhound/playbook recorder
- Swarm/ytdlp short-circuit paths
- Performance stance (aggressive/standard/conservative)

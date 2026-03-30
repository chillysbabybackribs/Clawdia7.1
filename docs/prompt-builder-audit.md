# PromptBuilder Audit — Clawdia 7.0

**Date:** 2026-03-29
**Scope:** Browser prompting path, prompt assembly, action schemas, structured output contracts, recovery logic, and token efficiency
**Auditor:** Claude (automated audit via source inspection)

---

## 1. Current Call Graph — Browser Prompting Path

```
User message arrives
        │
        ▼
classify(userMessage, forcedProfile?)          [classify.ts]
  → AgentProfile { toolGroup, modelTier, isGreeting, isContinuation, specialMode }
        │
        ▼
buildStaticPrompt(profile, unrestrictedMode)   [promptBuilder.ts]
  → systemPrompt string (once per run, cached for Anthropic prompt cache)
    ├── TOOL_GROUP_GUIDANCE[profile.toolGroup]
    ├── Terminology / tool reference section
    ├── CRITICAL RULES
    ├── if isBrowser: SESSION_CONTEXT + BROWSER_STRATEGY + URL_PATTERNS
    └── if unrestrictedMode: UNRESTRICTED_ADDENDUM
        │
        │  (optional override for app_mapping)
        ├──▶ buildAppMappingSystemPrompt(base, ctx)    [agent/appMapping/]
        │
        ▼
options.onSystemPrompt?.(staticPrompt)         [debug callback]
        │
        ▼
createLoopControl(runId)                       [loopControl.ts]
DispatchContext initialized:
  { browserMode: 'plan', browserBudget: initBrowserBudget(), ... }
        │
        ▼
messages.push(buildUserMessage(text, attachments, provider))  [agentLoop.ts]
  → provider-specific content block construction (Anthropic/OpenAI/Gemini branches)
        │
        ▼ ──────────────── ITERATION LOOP ────────────────────────────────┐
        │                                                                   │
        ▼                                                                   │
buildDynamicPrompt(profile, ctx)               [promptBuilder.ts]          │
  → iteration counter + tool count                                         │
  → if isBrowser: budget string                                            │
  → if isBrowser: BROWSER_MODE_INSTRUCTIONS[ctx.browserMode]               │
  → if stall: detectStall() warning                                        │
  → if i >= 25: wrap-up warning                                            │
        │                                                                   │
        ▼                                                                   │
streamLLM(messages, staticPrompt, dynamicPrompt, profile, opts, accumulated)
        │                                              [streamLLM.ts]       │
        ├── injectDynamicPrompt(messages, dynamicPrompt)                   │
        │   → prepend [context] to last user message text block            │
        │   → skip injection if last msg is a tool_result block            │
        │                                                                   │
        ├── switch(provider)                                               │
        │   ├── anthropic → getAnthropicTools() → streamAnthropicLLM()   │
        │   ├── openai   → getOpenAITools()    → streamOpenAILLM()       │
        │   └── gemini   → getGeminiTools()    → streamGeminiLLM()       │
        │                                                                   │
        ▼                                                                   │
LLMTurn { text, toolBlocks, discoveredTools }                              │
        │                                                                   │
        ▼                                                                   │
if toolBlocks.length === 0: break loop                                     │
        │                                                                   │
        ▼                                                                   │
checkBrowserBudget() + checkToolPolicy()       [browserBudget.ts]          │
  → if violation: inject [POLICY] message, continue                        │
        │                                                                   │
        ▼                                                                   │
messages.push(buildAssistantContent(text, toolBlocks, provider))           │
        │                                                                   │
        ▼                                                                   │
dispatch(toolBlocks, ctx)                      [dispatch.ts]               │
  → parallel execution of each tool                                        │
  → routes: shell / browser / desktop / memory / workspace / self-aware    │
        │                                                                   │
        ▼                                                                   │
updateBrowserBudget(toolBlocks, results, ctx.browserBudget)                │
        │                                                                   │
        ▼                                                                   │
advanceBrowserMode(ctx.browserMode, toolNames, results, stalled)           │
  → plan → act → extract → validate                                        │
  → act  → recover (on failure or stall)                                   │
        │                                                                   │
        ▼                                                                   │
messages.push(buildToolResultMessage(toolBlocks, results, provider))       │
trimMessageHistory(messages)  [HISTORY_WINDOW = 10]                        │
        │                                                                   │
        └───────────────────────────────────────────────────────────────────┘
        │
        ▼
verifyOutcomes(finalText, allToolCalls)        [recovery.ts]
  → regex scan for claimed file writes vs actual file_edit calls
  → if mismatch: inject correction prompt + one more LLM turn
        │
        ▼
return finalText
```

---

## 2. Exact Relevant Files

| File | Lines | Role in Prompt Pipeline |
|------|-------|------------------------|
| `src/main/agent/promptBuilder.ts` | 239 | Static + dynamic prompt construction, browser mode instructions, stall detection, mode transitions |
| `src/main/agent/agentLoop.ts` | 442 | Loop orchestrator; initializes context, calls all prompt builders, drives iteration |
| `src/main/agent/streamLLM.ts` | 280 | Provider routing; injects dynamic prompt into messages; selects/caches tool schemas |
| `src/main/agent/classify.ts` | ~80 | User message classification → AgentProfile |
| `src/main/agent/types.ts` | 102 | All type definitions: AgentProfile, DispatchContext, BrowserMode, LLMTurn |
| `src/main/agent/dispatch.ts` | ~185 | Tool execution router; no prompt logic |
| `src/main/agent/recovery.ts` | 49 | Post-loop claim verification; regex-based write detection |
| `src/main/agent/browserBudget.ts` | 106 | Budget tracking and enforcement; policy injection |
| `src/main/core/cli/systemPrompt.ts` | 46 | Shared system prompts for OpenAI/Gemini and Anthropic streaming paths |
| `src/main/core/cli/browserTools.ts` | ~291 | Browser tool schemas (Anthropic JSON Schema format) + executor |
| `src/main/core/cli/toolRegistry.ts` | ~207 | Tool catalog, fuzzy search, schema conversion (Anthropic → OpenAI → Gemini) |
| `src/main/core/browser/ElectronBrowserService.ts` | ~694 | Browser abstraction; page state, screenshot, text extraction |
| `src/main/anthropicChat.ts` | ~685 | Anthropic streaming loop; builds system prompt separately from agent loop |
| `src/main/openaiChat.ts` | ~380 | OpenAI streaming loop |
| `src/main/geminiChat.ts` | ~435 | Gemini streaming loop |

---

## 3. PromptBuilder Responsibilities Today

`promptBuilder.ts` currently owns:

1. **TOOL_GROUP_GUIDANCE** — one-line tool orientation per profile (browser/desktop/coding/core/full)
2. **BROWSER_MODE_INSTRUCTIONS** — per-phase instructions: plan / act / extract / recover / validate
3. **URL_PATTERNS** — hardcoded list of direct URL construction shortcuts for major sites
4. **SESSION_CONTEXT** — reminder that the agent is in a real user browser with active sessions
5. **BROWSER_STRATEGY** — 6-step ordered action sequence (CHECK → CONSTRUCT → NAVIGATE → READ → ACT → EXTRACT)
6. **detectStall()** — examines last 3 tool calls; if identical, returns a stall warning string
7. **advanceBrowserMode()** — transitions BrowserMode state machine based on tool outcomes
8. **buildStaticPrompt()** — assembles the immutable system prompt string for the run
9. **buildDynamicPrompt()** — assembles the per-iteration context string (injected into last user message)

The module does **not** own:

- Provider-specific tool schema selection (that lives in `streamLLM.ts`)
- Message format construction (in `agentLoop.ts`)
- Dynamic prompt injection into messages (in `streamLLM.ts` → `injectDynamicPrompt`)
- Separate system prompt variants for Anthropic vs OpenAI/Gemini (`systemPrompt.ts`)
- Tool execution or dispatch (`dispatch.ts`)

---

## 4. Exact Weak Points

### W1 — Dual Prompt System: Two Independent System Prompt Paths

**Severity: HIGH**
**Files:** `src/main/agent/promptBuilder.ts` vs `src/main/core/cli/systemPrompt.ts`

The codebase has **two unrelated system prompt builders** that are never reconciled:

- `promptBuilder.buildStaticPrompt()` — used by `agentLoop.ts` for all three providers
- `systemPrompt.buildSharedSystemPrompt()` / `buildAnthropicStreamSystemPrompt()` — used by `anthropicChat.ts` and potentially the OpenAI/Gemini chat paths

These produce different text, different tool references, different guidance. A single user request may arrive through the agent loop path (uses `promptBuilder`) or through a direct chat path (uses `systemPrompt.ts`). There is no guarantee of behavioral consistency. The browser strategy, session context, and URL patterns from `promptBuilder.ts` are absent from `systemPrompt.ts`.

```
agentLoop.ts ──→ promptBuilder.buildStaticPrompt()   ← "You are an agentic assistant..."
anthropicChat.ts ──→ systemPrompt.buildAnthropicStreamSystemPrompt()  ← different instructions
```

### W2 — Provider-Specific Message Construction Inside the Loop

**Severity: HIGH**
**File:** `src/main/agent/agentLoop.ts` (lines 315–438)

`buildUserMessage()`, `buildAssistantContent()`, and `buildToolResultMessage()` each contain explicit `if (provider === 'anthropic') ... if (provider === 'openai') ... // Gemini` branches. This means prompt logic is entangled with wire format construction. Adding a new provider requires editing the loop itself.

### W3 — Tool Schema Selection Spread Across Three Locations

**Severity: HIGH**
**Files:** `streamLLM.ts` (getAnthropicTools/getOpenAITools/getGeminiTools), `anthropicChat.ts` (direct tool list), `openaiChat.ts` (direct tool list), `geminiChat.ts` (direct tool list)

Tool schemas are assembled in `streamLLM.ts` for the agent loop, but the three provider chat files (`anthropicChat.ts`, `openaiChat.ts`, `geminiChat.ts`) each also assemble their own tool lists independently. The `anthropicChat.ts` path includes memory tools and a search_tool_bm25 not present in the agent loop path. There is no single authoritative tool registry query point per profile.

### W4 — Dynamic Prompt Injection Is a String Prepend With No Structure Contract

**Severity: MEDIUM**
**File:** `src/main/agent/streamLLM.ts:injectDynamicPrompt()`

The dynamic context (iteration counter, budget, mode instructions) is injected by prepending `[...context text...]` directly to the last user message's text content. This:

- Mixes agentic metadata with user content in the same message role
- Has no structure contract (just a bracketed string, parseable only by convention)
- Is silently skipped when the last message is a `tool_result` block, meaning some iterations receive **no dynamic context at all**

### W5 — Browser Page State Is Never Automatically Grounded

**Severity: MEDIUM**
**Files:** All prompt files; `ElectronBrowserService.ts`

No current page URL, title, DOM structure, or visible text is injected into any prompt. The agent must explicitly call `browser_get_page_state()` to know where it is. This creates a systematic failure mode: if the agent skips the page-state check (common under token pressure or when the LLM assumes it knows the URL), it acts blindly.

The browser STRATEGY prompt says "call browser_get_page_state first" but there is no mechanical enforcement — the instruction is advisory text only.

### W6 — Recovery Prompting Is Weak and Non-Specific

**Severity: MEDIUM**
**Files:** `promptBuilder.ts` (BROWSER_MODE_INSTRUCTIONS.recover), `recovery.ts`

The `recover` mode instruction is generic:
> "Diagnose the most likely cause... Choose one safe recovery action..."

It provides no structured diagnosis protocol, no reference to the actual failure that triggered recovery, and no differentiation between failure types (navigation timeout, element not found, login wall, JS error, rate limiting, etc.).

The post-loop `verifyOutcomes()` in `recovery.ts` uses regex pattern matching for "written/saved/created to/at/as" — fragile against LLM paraphrase variation and limited to file write claims. There is no equivalent recovery for browser task failures.

### W7 — Token Bloat: URL_PATTERNS and BROWSER_STRATEGY in Every Browser Request

**Severity: MEDIUM**
**File:** `promptBuilder.ts:buildStaticPrompt()`

The `URL_PATTERNS` block (~11 lines) and `BROWSER_STRATEGY` block (~8 lines) are appended to every browser mode system prompt unconditionally. For tasks that don't involve any of the listed sites (e.g., navigating a localhost app, using a corporate intranet), these lines are pure noise. The `SESSION_CONTEXT` block has similar issues.

These are static and never adapted to the actual task being requested.

### W8 — BrowserMode State Machine Exists But Is Not Surfaced to the LLM Cleanly

**Severity: MEDIUM**
**Files:** `promptBuilder.ts`, `agentLoop.ts`

`advanceBrowserMode()` correctly transitions the state machine. However, the current mode is injected as a free-text instruction block appended to the dynamic prompt. The LLM sees:

```
[Iteration 3 | Tools called so far: 5]
Browser budget remaining: searches 1/2, targets 3/6, tabs 6/6
CURRENT MODE: ACT
- Execute exactly one browser action.
...
[user message text]
```

There is no structured field, no JSON envelope, no role separation between "system-level agent context" and "user task content." The LLM has to parse both from the same user turn.

### W9 — History Trimming Discards Mid-Task Context Without Summary

**Severity: LOW-MEDIUM**
**File:** `agentLoop.ts:trimMessageHistory()`

`HISTORY_WINDOW = 10` means after 11+ messages, all earlier context beyond the first message is dropped. There is no summarization pass before dropping (unlike `compactAppMappingHistory()` which inserts a summary). For long browser tasks, this can discard successful navigation state, previously extracted data, and confirmed intermediate results.

`compactAppMappingHistory()` exists but only for `app_mapping` mode on non-Anthropic providers. Standard browser tasks don't benefit from it.

### W10 — Stall Detection Window Is Fixed at 3 and Covers Only Identical Calls

**Severity: LOW**
**File:** `promptBuilder.ts:detectStall()`

The stall detector checks only the last 3 tool calls for exact name+input equality. It misses:

- Near-identical calls (same tool, slightly different selectors that all fail)
- Semantic loops (navigate → extract → navigate to same URL → extract again)
- Oscillation between two different failed actions

---

## 5. Proposed Future `PromptBuilder.ts` Structure

The target design unifies all prompt construction under a single module, separates static from dynamic concerns, introduces typed prompt modes, and provides clean provider-agnostic output with a structured context envelope.

### Responsibilities of the Future Module

```
promptBuilder.ts (future)
│
├── Types/Interfaces (or re-export from types.ts)
│   ├── PromptMode: 'shell' | 'browser' | 'desktop' | 'coding' | 'full'
│   ├── BrowserPhase: 'plan' | 'act' | 'extract' | 'recover' | 'validate'
│   ├── IterationContext (structured, not string)
│   └── PromptParts { system: string; dynamicContext: IterationContext }
│
├── buildSystemPrompt(profile, opts)
│   ├── Merges tool group orientation
│   ├── Merges browser sections only for browser/full modes
│   ├── Merges unrestricted addendum if enabled
│   └── Returns a single canonical string for ALL providers
│       (no more dual systemPrompt.ts path)
│
├── buildIterationContext(profile, ctx): IterationContext
│   ├── Structured object (not freetext string)
│   ├── Fields: iteration, toolCount, browserPhase, budget, stall, warnings
│   └── Serialized to compact bracket notation for injection
│
├── serializeContext(ctx: IterationContext): string
│   ├── Deterministic serialization for message injection
│   └── Stable format for prompt cache stability
│
├── advanceBrowserPhase(current, toolNames, results, stalled): BrowserPhase
│   (already exists — keep as-is)
│
├── detectStall(allToolCalls, windowSize?, semanticMode?): StallResult | null
│   (enhanced version of current detectStall)
│
└── buildRecoveryPrompt(context: RecoveryContext): string
    ├── Takes structured failure info (toolName, errorText, attemptCount, pageUrl)
    └── Returns specific, contextualized recovery instruction
```

---

## 6. Recommended Prompt Modes

Replace the current `ToolGroup` orientation with explicit prompt modes that control which prompt sections are active:

```typescript
type PromptMode =
  | 'minimal'     // greetings, no tools
  | 'shell'       // file + shell only, no browser/GUI sections
  | 'browser'     // full browser stack: strategy, URL patterns, session context
  | 'desktop'     // GUI automation focus
  | 'coding'      // file/shell with code-specific guidance
  | 'full';       // all sections active
```

Browser sub-phases (`BrowserPhase`) remain a separate dimension, injected dynamically:

```typescript
type BrowserPhase = 'plan' | 'act' | 'extract' | 'recover' | 'validate';
```

Mode selection flows from `classify()` → `AgentProfile.toolGroup` → mapped to `PromptMode` inside `buildSystemPrompt()`. This removes the `isBrowser` boolean scattered through the current code.

---

## 7. Recommended Types/Interfaces

```typescript
// promptBuilder.ts — exported types

export interface IterationContext {
  /** 1-based iteration index */
  iteration: number;
  /** Total tool calls executed so far this run */
  toolCallCount: number;
  /** Active browser phase (undefined for non-browser tasks) */
  browserPhase?: BrowserPhase;
  /** Remaining budget slots */
  budget?: {
    searchRounds: number;
    maxSearchRounds: number;
    inspectedTargets: number;
    maxInspectedTargets: number;
    backgroundTabs: number;
    maxBackgroundTabs: number;
  };
  /** Non-null if a stall was detected */
  stall?: StallResult;
  /** True if approaching iteration limit */
  nearLimit?: boolean;
  /** True if this is a continuation request */
  isContinuation?: boolean;
}

export interface StallResult {
  toolName: string;
  inputHash: string;
  count: number;
  message: string;
}

export interface RecoveryContext {
  /** The tool that failed */
  failedTool: string;
  /** Error text from the tool result */
  errorText: string;
  /** How many times this failure has occurred */
  attemptCount: number;
  /** Current page URL at time of failure */
  pageUrl?: string;
  /** Failure category for targeted guidance */
  failureCategory: 'element_not_found' | 'navigation_timeout' | 'login_wall' | 'rate_limit' | 'js_error' | 'unknown';
}

export interface PromptParts {
  /** Complete system prompt string — identical across iterations for cache stability */
  system: string;
  /** Per-iteration context — injected into the last user message */
  context: IterationContext;
}

export interface BuildSystemPromptOptions {
  profile: AgentProfile;
  unrestrictedMode: boolean;
  /** Inject current page state hint (URL + title) for initial grounding */
  initialPageState?: { url: string; title: string };
}
```

---

## 8. Recommended Helper Modules

Split the current monolith and dual-file system into focused helpers:

```
src/main/agent/prompt/
├── index.ts                 — re-exports public API
├── systemPrompt.ts          — buildSystemPrompt() (replaces both current files)
├── iterationContext.ts      — buildIterationContext(), serializeContext()
├── browserPhase.ts          — advanceBrowserPhase(), BROWSER_PHASE_INSTRUCTIONS
├── browserSections.ts       — URL_PATTERNS, SESSION_CONTEXT, BROWSER_STRATEGY
├── stall.ts                 — detectStall(), StallResult
├── recovery.ts              — buildRecoveryPrompt(), classifyFailure()
└── toolGroupSections.ts     — TOOL_GROUP_GUIDANCE per mode
```

**Rationale for this split:**

- `systemPrompt.ts` owns the one canonical static prompt — eliminates the split between `promptBuilder.ts` and `core/cli/systemPrompt.ts`
- `iterationContext.ts` owns structured context serialization — decouples from freetext string building
- `browserPhase.ts` is the only module that knows about BrowserPhase transitions — can be tested in isolation
- `recovery.ts` (new, richer version) classifies failures before constructing prompts — enables targeted guidance rather than generic advice
- `browserSections.ts` isolates the large static text blocks so they can be audited, A/B tested, or swapped without touching logic

---

## 9. Migration Sequence

### Phase 0 — No-op baseline (already done)
- `browserMode` initialized to `'plan'` in `agentLoop.ts` ✅ (present in code)
- `advanceBrowserMode()` wired in loop ✅ (present at line 159)
- Note: the subagent report's claim that `browserMode` was never initialized was incorrect — it is initialized on line 50 of `agentLoop.ts` as `browserMode: 'plan'`

### Phase 1 — Merge System Prompt Paths (low risk, high value)

**Goal:** Eliminate `core/cli/systemPrompt.ts` as an independent path.

1. Add a `provider: 'anthropic' | 'openai' | 'gemini'` parameter to `buildStaticPrompt()`
2. When `provider === 'anthropic'`: use `bash` / `str_replace_based_edit_tool` naming; omit `search_tools` reference
3. When `provider !== 'anthropic'`: keep `shell_exec` / `file_edit` naming; include `search_tools` rule
4. Update `anthropicChat.ts`, `openaiChat.ts`, `geminiChat.ts` to call `buildStaticPrompt()` instead of `buildSharedSystemPrompt()` / `buildAnthropicStreamSystemPrompt()`
5. Delete `core/cli/systemPrompt.ts`

This ensures ALL prompt paths share browser strategy, URL patterns, session context, and critical rules.

### Phase 2 — Structured IterationContext

**Goal:** Replace the freetext `buildDynamicPrompt()` string with a typed `IterationContext` object.

1. Define `IterationContext` interface in `types.ts`
2. Rename `buildDynamicPrompt()` → `buildIterationContext()` returning `IterationContext`
3. Add `serializeContext(ctx: IterationContext): string` for injection
4. Update `streamLLM.ts:injectDynamicPrompt()` to accept `IterationContext` and call `serializeContext()`
5. Existing serialization format is preserved — no LLM behavior change

### Phase 3 — Split into Helper Modules

**Goal:** Decompose `promptBuilder.ts` (239 lines) into focused modules.

1. Create `src/main/agent/prompt/` directory
2. Move each section to its designated file (see §8 above)
3. Export public API from `index.ts`
4. Update all import sites
5. No behavior change — pure refactor

### Phase 4 — Automatic Page Grounding

**Goal:** Inject current page URL + title at the start of browser tasks.

1. In `agentLoop.ts`, before the first iteration of a browser-mode run, call `browserService.getPageState()`
2. Pass `{ url, title }` to `buildStaticPrompt()` (or inject in the initial user message)
3. Add `CURRENT PAGE: {url} | {title}` hint at the top of the browser sections
4. Update `BROWSER_STRATEGY` step 1 to reference this injected state

### Phase 5 — Rich Recovery Prompting

**Goal:** Replace generic `recover` mode text with failure-specific instructions.

1. In `dispatch.ts`, classify tool failures into `RecoveryContext.failureCategory`
2. Pass `RecoveryContext` to `buildRecoveryPrompt()` in `promptBuilder`
3. Return targeted guidance (e.g., "Login wall detected on {url}. Report to user rather than attempting auth.")
4. Update `advanceBrowserMode()` to accept structured failure info rather than raw result strings

### Phase 6 — Enhanced Stall Detection

**Goal:** Catch semantic loops, not just identical calls.

1. Add URL-level loop detection (navigate → extract → navigate same URL)
2. Add fuzzy selector matching (same tool, similar selectors within edit distance threshold)
3. Add oscillation detection (alternating between exactly 2 failing actions)
4. Configurable `windowSize` parameter (default 3, configurable up to 10)

---

## 10. Summary of Weak Points vs Proposed Fixes

| # | Weak Point | Severity | Fix in Phase |
|---|------------|----------|-------------|
| W1 | Dual independent system prompt paths | HIGH | Phase 1 |
| W2 | Provider branching inside loop message construction | HIGH | Phase 3 (extract to codec layer) |
| W3 | Tool schemas assembled in 4 separate locations | HIGH | Phase 3 (centralize in streamLLM) |
| W4 | Dynamic prompt is unstructured string prepend | MEDIUM | Phase 2 |
| W5 | No automatic browser page grounding | MEDIUM | Phase 4 |
| W6 | Recovery prompting is generic, not failure-specific | MEDIUM | Phase 5 |
| W7 | URL patterns / browser strategy injected unconditionally | MEDIUM | Phase 4 (conditionalize) |
| W8 | BrowserMode not surfaced as structured field to LLM | MEDIUM | Phase 2 |
| W9 | History trimming drops mid-task context without summary | LOW-MEDIUM | Phase 3 (extend compact to all modes) |
| W10 | Stall detection window is narrow and exact-only | LOW | Phase 6 |

---

## Appendix A — What Is NOT a Weakness

- **On-demand browser state** (no auto-inject of DOM/screenshot): this is a deliberate and sound design choice. Auto-injecting page state every iteration would be high-token and mostly redundant. The BROWSER_STRATEGY's "CHECK first" instruction is the correct approach; the gap is that it's advisory rather than mechanical (addressed by Phase 4 initial grounding).
- **Prompt cache architecture**: injecting dynamic context into the user message (not the system prompt) to preserve cache stability is correct and should be retained in the target design.
- **BrowserBudget enforcement**: the budget check and policy gate are clean and well-isolated.
- **`advanceBrowserMode()` logic**: the state machine transitions are sound; the weakness is only in how the current mode is communicated to the LLM (freetext rather than structured).
- **History trimming with tool-pair safety**: the `isToolResultMessage` + `isAssistantWithToolUse` boundary logic is correct and should be preserved.

---

## Appendix B — Annotated Key Locations

```
promptBuilder.ts:16   BROWSER_MODE_INSTRUCTIONS — the 5 phase instruction blocks
promptBuilder.ts:51   URL_PATTERNS — static URL shortcut list (unconditional)
promptBuilder.ts:65   SESSION_CONTEXT — login-state reminder
promptBuilder.ts:74   BROWSER_STRATEGY — 6-step ordered action protocol
promptBuilder.ts:84   detectStall() — 3-call exact-match stall check
promptBuilder.ts:111  advanceBrowserMode() — state machine (wired but not well-surfaced)
promptBuilder.ts:161  buildStaticPrompt() — assembles system prompt
promptBuilder.ts:207  buildDynamicPrompt() — assembles per-iteration context string

agentLoop.ts:43       DispatchContext init — browserMode: 'plan' ✓
agentLoop.ts:85       buildDynamicPrompt() call each iteration
agentLoop.ts:156      advanceBrowserMode() call after dispatch
agentLoop.ts:315      buildUserMessage() — 3-way provider branch
agentLoop.ts:385      buildAssistantContent() — 3-way provider branch
agentLoop.ts:412      buildToolResultMessage() — 3-way provider branch

streamLLM.ts:200      injectDynamicPrompt() — string prepend to last user message
streamLLM.ts:238      streamLLM() — main entry; provider switch

core/cli/systemPrompt.ts:10  buildSharedSystemPrompt() — ORPHAN PATH (OpenAI/Gemini chat direct)
core/cli/systemPrompt.ts:32  buildAnthropicStreamSystemPrompt() — ORPHAN PATH (Anthropic direct)
```

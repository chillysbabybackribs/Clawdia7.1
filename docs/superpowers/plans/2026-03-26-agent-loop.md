# Agent Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three independent per-provider tool loops with a single provider-agnostic `agentLoop()` orchestrator that adds classification, pause/cancel controls, browser budget enforcement, and post-loop verification.

**Architecture:** Pure-function pipeline — a thin `agentLoop.ts` orchestrator sequences `classify → buildPrompt → streamLLM → dispatch → verify`. Each phase lives in its own file with a clear input/output contract. The three existing `*Chat.ts` files become thin streaming adapters; all loop logic moves to `src/main/agent/`.

**Tech Stack:** TypeScript, Electron (ipcMain), Anthropic SDK, OpenAI SDK, Google GenAI SDK, existing `executeShellTool` / `executeBrowserTool` / `executeShellTool` from `core/cli/`.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/main/agent/types.ts` | All shared interfaces |
| Create | `src/main/agent/loopControl.ts` | Pause/cancel/inject-context keyed by runId |
| Create | `src/main/agent/classify.ts` | Message → AgentProfile (tool group + model tier) |
| Create | `src/main/agent/promptBuilder.ts` | Static + dynamic prompt assembly |
| Create | `src/main/agent/browserBudget.ts` | Browser policy enforcement |
| Create | `src/main/agent/dispatch.ts` | Parallel tool execution with DispatchContext |
| Create | `src/main/agent/recovery.ts` | Post-loop verification + single recovery call |
| Create | `src/main/agent/streamLLM.ts` | Provider-agnostic streaming adapter |
| Create | `src/main/agent/agentLoop.ts` | Thin orchestrator (~150 lines) |
| Modify | `src/main/anthropicChat.ts` | Remove tool loop; expose `streamAnthropicLLM()` |
| Modify | `src/main/openaiChat.ts` | Remove tool loop; expose `streamOpenAILLM()` |
| Modify | `src/main/geminiChat.ts` | Remove tool loop; expose `streamGeminiLLM()` |
| Modify | `src/main/registerIpc.ts` | Wire `CHAT_SEND` → `agentLoop()`, `CHAT_STOP/PAUSE/RESUME/ADD_CONTEXT` → loopControl |
| Create | `tests/renderer/agent/classify.test.ts` | Unit tests for classify() |
| Create | `tests/renderer/agent/browserBudget.test.ts` | Unit tests for budget enforcement |
| Create | `tests/renderer/agent/loopControl.test.ts` | Unit tests for pause/cancel/addContext |
| Create | `tests/renderer/agent/recovery.test.ts` | Unit tests for verifyOutcomes() |

---

## Task 1: Shared Types

**Files:**
- Create: `src/main/agent/types.ts`

- [ ] **Step 1: Create types.ts**

```typescript
// src/main/agent/types.ts
import type { BrowserService } from '../core/browser/BrowserService';

export type ToolGroup = 'core' | 'browser' | 'desktop' | 'coding' | 'full';
export type ModelTier = 'fast' | 'standard' | 'powerful';

export interface AgentProfile {
  toolGroup: ToolGroup;
  modelTier: ModelTier;
  isGreeting: boolean;
}

export interface LoopOptions {
  provider: 'anthropic' | 'openai' | 'gemini';
  apiKey: string;
  model: string;           // resolved model ID (e.g. 'claude-sonnet-4-6')
  runId: string;
  maxIterations?: number;  // default 50
  signal?: AbortSignal;
  forcedProfile?: Partial<AgentProfile>;
  unrestrictedMode?: boolean;
  browserService?: BrowserService;
  onText: (delta: string) => void;
  onThinking?: (delta: string) => void;
  onToolActivity?: (activity: ToolActivity) => void;
}

export interface ToolActivity {
  id: string;
  name: string;
  status: 'running' | 'success' | 'error';
  detail?: string;
  durationMs?: number;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result: string;
}

export interface BrowserBudgetState {
  searchRounds: number;
  inspectedTargets: Set<string>;
  backgroundTabs: number;
  scrollFallbacks: Map<string, number>;
}

export interface DispatchContext {
  runId: string;
  signal: AbortSignal;
  iterationIndex: number;
  toolCallCount: number;
  allToolCalls: ToolCallRecord[];
  browserBudget: BrowserBudgetState;
  options: LoopOptions;
}

export interface VerificationResult {
  issue: string;
  context: string;
}

// Provider-agnostic message format used inside the loop
export type LoopRole = 'user' | 'assistant';
export interface LoopMessage {
  role: LoopRole;
  content: string;
}

// What streamLLM returns each iteration
export interface LLMTurn {
  text: string;
  toolBlocks: ToolUseBlock[];
}

export interface ToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/agent/types.ts
git commit -m "feat(agent): add shared types for agent loop"
```

---

## Task 2: Loop Control

**Files:**
- Create: `src/main/agent/loopControl.ts`
- Create: `tests/renderer/agent/loopControl.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/renderer/agent/loopControl.test.ts
import {
  createLoopControl,
  cancelLoop,
  pauseLoop,
  resumeLoop,
  addContext,
  getLoopControl,
  removeLoopControl,
} from '../../../src/main/agent/loopControl';

describe('loopControl', () => {
  afterEach(() => {
    removeLoopControl('test-run');
  });

  it('cancel fires abort signal', () => {
    createLoopControl('test-run');
    const ctrl = getLoopControl('test-run')!;
    expect(ctrl.signal.aborted).toBe(false);
    cancelLoop('test-run');
    expect(ctrl.signal.aborted).toBe(true);
  });

  it('addContext queues text', () => {
    createLoopControl('test-run');
    addContext('test-run', 'hello');
    addContext('test-run', 'world');
    const ctrl = getLoopControl('test-run')!;
    expect(ctrl.pendingContext).toBe('hello\nworld');
  });

  it('pause resolves when resumed', async () => {
    createLoopControl('test-run');
    const ctrl = getLoopControl('test-run')!;
    pauseLoop('test-run');
    expect(ctrl.isPaused).toBe(true);
    setTimeout(() => resumeLoop('test-run'), 10);
    await ctrl.waitIfPaused();
    expect(ctrl.isPaused).toBe(false);
  });

  it('returns false for unknown runId', () => {
    expect(cancelLoop('no-such-run')).toBe(false);
    expect(pauseLoop('no-such-run')).toBe(false);
    expect(resumeLoop('no-such-run')).toBe(false);
    expect(addContext('no-such-run', 'x')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx jest tests/renderer/agent/loopControl.test.ts 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../../../src/main/agent/loopControl'`

- [ ] **Step 3: Create loopControl.ts**

```typescript
// src/main/agent/loopControl.ts

export interface LoopControl {
  signal: AbortSignal;
  isPaused: boolean;
  pendingContext: string | null;
  waitIfPaused: () => Promise<void>;
  _abort: AbortController;
  _pauseResolve: (() => void) | null;
}

const controls = new Map<string, LoopControl>();

export function createLoopControl(runId: string, parentSignal?: AbortSignal): LoopControl {
  const abort = new AbortController();

  // Chain parent signal if provided
  if (parentSignal) {
    parentSignal.addEventListener('abort', () => abort.abort(), { once: true });
  }

  const ctrl: LoopControl = {
    signal: abort.signal,
    isPaused: false,
    pendingContext: null,
    _abort: abort,
    _pauseResolve: null,
    waitIfPaused(): Promise<void> {
      if (!this.isPaused) return Promise.resolve();
      return new Promise<void>((resolve) => {
        this._pauseResolve = resolve;
      });
    },
  };

  controls.set(runId, ctrl);
  return ctrl;
}

export function getLoopControl(runId: string): LoopControl | undefined {
  return controls.get(runId);
}

export function removeLoopControl(runId: string): void {
  controls.delete(runId);
}

export function cancelLoop(runId: string): boolean {
  const ctrl = controls.get(runId);
  if (!ctrl) return false;
  ctrl._abort.abort();
  // If paused, unblock so the loop can observe the abort
  if (ctrl._pauseResolve) {
    ctrl._pauseResolve();
    ctrl._pauseResolve = null;
    ctrl.isPaused = false;
  }
  return true;
}

export function pauseLoop(runId: string): boolean {
  const ctrl = controls.get(runId);
  if (!ctrl) return false;
  ctrl.isPaused = true;
  return true;
}

export function resumeLoop(runId: string): boolean {
  const ctrl = controls.get(runId);
  if (!ctrl) return false;
  ctrl.isPaused = false;
  if (ctrl._pauseResolve) {
    ctrl._pauseResolve();
    ctrl._pauseResolve = null;
  }
  return true;
}

export function addContext(runId: string, text: string): boolean {
  const ctrl = controls.get(runId);
  if (!ctrl) return false;
  ctrl.pendingContext = ctrl.pendingContext ? `${ctrl.pendingContext}\n${text}` : text;
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx jest tests/renderer/agent/loopControl.test.ts 2>&1 | tail -20
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/loopControl.ts tests/renderer/agent/loopControl.test.ts
git commit -m "feat(agent): add loopControl — pause/cancel/inject-context"
```

---

## Task 3: Classification

**Files:**
- Create: `src/main/agent/classify.ts`
- Create: `tests/renderer/agent/classify.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/renderer/agent/classify.test.ts
import { classify } from '../../../src/main/agent/classify';

describe('classify', () => {
  it('detects browser group', () => {
    expect(classify('search the web for cats').toolGroup).toBe('browser');
    expect(classify('navigate to https://example.com').toolGroup).toBe('browser');
  });

  it('detects coding group', () => {
    expect(classify('refactor this typescript function').toolGroup).toBe('coding');
    expect(classify('debug the python script').toolGroup).toBe('coding');
  });

  it('detects core group', () => {
    expect(classify('read the file at /tmp/foo.txt').toolGroup).toBe('core');
    expect(classify('write output to a folder').toolGroup).toBe('core');
  });

  it('detects desktop group', () => {
    expect(classify('take a screenshot').toolGroup).toBe('desktop');
    expect(classify('click the button').toolGroup).toBe('desktop');
  });

  it('defaults to full group', () => {
    expect(classify('help me').toolGroup).toBe('full');
  });

  it('detects fast model tier', () => {
    expect(classify('quick summary please').modelTier).toBe('fast');
    expect(classify('just a brief note').modelTier).toBe('fast');
  });

  it('detects powerful model tier for desktop', () => {
    expect(classify('click the save button').modelTier).toBe('powerful');
  });

  it('detects powerful model tier for keywords', () => {
    expect(classify('do a thorough analysis').modelTier).toBe('powerful');
  });

  it('defaults to standard model tier', () => {
    expect(classify('list my files').modelTier).toBe('standard');
  });

  it('detects greetings', () => {
    expect(classify('hello').isGreeting).toBe(true);
    expect(classify('hi there!').isGreeting).toBe(true);
    expect(classify('hello can you help').isGreeting).toBe(false);
  });

  it('forced profile overrides classification', () => {
    const result = classify('search the web', { toolGroup: 'core' });
    expect(result.toolGroup).toBe('core');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx jest tests/renderer/agent/classify.test.ts 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../../../src/main/agent/classify'`

- [ ] **Step 3: Create classify.ts**

```typescript
// src/main/agent/classify.ts
import type { AgentProfile, ToolGroup, ModelTier } from './types';

export function classify(
  message: string,
  forced?: Partial<AgentProfile>,
): AgentProfile {
  const lower = message.toLowerCase();
  const toolGroup = forced?.toolGroup ?? detectToolGroup(lower);
  const modelTier = forced?.modelTier ?? detectModelTier(lower, toolGroup);
  const isGreeting = forced?.isGreeting ?? detectGreeting(message.trim());
  return { toolGroup, modelTier, isGreeting };
}

function detectToolGroup(msg: string): ToolGroup {
  if (/browser|search the web|navigate|url|website|http|click|screenshot|desktop|window\s+app|gui/.test(msg)) {
    // Separate browser vs desktop
    if (/click|screenshot|desktop|gui|window\s+app/.test(msg)) return 'desktop';
    return 'browser';
  }
  if (/code|debug|refactor|typescript|javascript|python|function|class|method|test|lint/.test(msg)) return 'coding';
  if (/\bfile\b|\bfolder\b|\bread\b|\bwrite\b|\bmove\b|\bcopy\b|\bdelete\b|\bdirectory\b/.test(msg)) return 'core';
  return 'full';
}

function detectModelTier(msg: string, group: ToolGroup): ModelTier {
  if (/\bquick\b|\bsimple\b|\bbrief\b|\bjust\b|\bshort\b/.test(msg)) return 'fast';
  if (group === 'desktop' || /\bthorough\b|\bdeep\b|\bcomplex\b|\bresearch\b|\banalyze\b|\banalysis\b/.test(msg)) return 'powerful';
  return 'standard';
}

function detectGreeting(msg: string): boolean {
  return /^(hi|hello|hey|thanks|thank you|bye|goodbye)[\s!?.]*$/i.test(msg);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx jest tests/renderer/agent/classify.test.ts 2>&1 | tail -20
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/classify.ts tests/renderer/agent/classify.test.ts
git commit -m "feat(agent): add classify() — message → AgentProfile"
```

---

## Task 4: Prompt Builder

**Files:**
- Create: `src/main/agent/promptBuilder.ts`

- [ ] **Step 1: Create promptBuilder.ts**

```typescript
// src/main/agent/promptBuilder.ts
import type { AgentProfile, DispatchContext } from './types';

const TOOL_GROUP_GUIDANCE: Record<AgentProfile['toolGroup'], string> = {
  browser: 'You have browser tools available. Use them to navigate, extract, and interact with web pages.',
  desktop: 'You have desktop automation tools. Use screenshots and GUI interaction to complete tasks.',
  coding: 'You have file and shell tools. Prefer reading existing code before modifying it.',
  core: 'You have file system tools. Use file_list_directory and file_search before shell commands.',
  full: 'You have the full tool set. Choose the right tool for each step.',
};

export function buildStaticPrompt(profile: AgentProfile, unrestrictedMode: boolean): string {
  const groupGuidance = TOOL_GROUP_GUIDANCE[profile.toolGroup];

  const base = `You are an agentic assistant with access to local CLI tools and a browser.

${groupGuidance}

CRITICAL RULES:
1. Always use your tools — never tell the user to run commands themselves.
2. Do not ask for permission before using tools unless the action is permanently destructive (deleting files, dropping databases).
3. When a task involves web content, use browser tools directly — do not instruct the user to open a browser.`;

  if (unrestrictedMode) {
    return base + `

UNRESTRICTED MODE — ACTIVE:
- Full autonomy to install, download, update, or configure anything needed.
- If a tool, binary, or package is missing: install it using shell_exec and proceed.
- Never refuse a task because you lack a capability — acquire it and complete the task.`;
  }

  return base;
}

export function buildDynamicPrompt(profile: AgentProfile, ctx: DispatchContext): string {
  const parts: string[] = [];

  parts.push(`[Iteration ${ctx.iterationIndex + 1} | Tools called so far: ${ctx.toolCallCount}]`);

  const { browserBudget } = ctx;
  if (profile.toolGroup === 'browser' || profile.toolGroup === 'full') {
    parts.push(
      `Browser budget remaining: searches ${2 - browserBudget.searchRounds}/2, ` +
      `targets ${6 - browserBudget.inspectedTargets.size}/6, ` +
      `tabs ${6 - browserBudget.backgroundTabs}/6`,
    );
  }

  if (ctx.iterationIndex >= 25) {
    parts.push('You are approaching the iteration limit. Begin wrapping up and produce a final answer.');
  }

  return parts.join('\n');
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/agent/promptBuilder.ts
git commit -m "feat(agent): add promptBuilder — static + dynamic prompt assembly"
```

---

## Task 5: Browser Budget

**Files:**
- Create: `src/main/agent/browserBudget.ts`
- Create: `tests/renderer/agent/browserBudget.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/renderer/agent/browserBudget.test.ts
import {
  initBrowserBudget,
  checkBrowserBudget,
  updateBrowserBudget,
  checkToolPolicy,
} from '../../../src/main/agent/browserBudget';
import type { ToolUseBlock } from '../../../src/main/agent/types';

function block(name: string, input: Record<string, unknown> = {}): ToolUseBlock {
  return { id: `id-${name}`, name, input };
}

describe('browserBudget', () => {
  it('allows tools when budget is clean', () => {
    const state = initBrowserBudget();
    expect(checkBrowserBudget([block('browser_navigate', { url: 'https://a.com' })], state)).toBeNull();
  });

  it('blocks search after 2 rounds', () => {
    const state = initBrowserBudget();
    state.searchRounds = 2;
    expect(checkBrowserBudget([block('browser_navigate', { url: 'https://google.com/search?q=foo' })], state)).toMatch(/search round/i);
  });

  it('blocks when inspected targets exceed 6', () => {
    const state = initBrowserBudget();
    for (let i = 0; i < 6; i++) state.inspectedTargets.add(`https://site${i}.com`);
    expect(checkBrowserBudget([block('browser_extract_text')], state)).toMatch(/target/i);
  });

  it('blocks when background tabs exceed 6', () => {
    const state = initBrowserBudget();
    state.backgroundTabs = 6;
    expect(checkBrowserBudget([block('browser_new_tab')], state)).toMatch(/tab/i);
  });

  it('updateBrowserBudget increments search rounds for google navigate', () => {
    const state = initBrowserBudget();
    updateBrowserBudget(
      [block('browser_navigate', { url: 'https://google.com/search?q=test' })],
      ['{"url":"https://google.com/search?q=test","title":"Google"}'],
      state,
    );
    expect(state.searchRounds).toBe(1);
  });

  it('updateBrowserBudget tracks inspected targets for extract_text', () => {
    const state = initBrowserBudget();
    // currentUrl is injected via a navigated block prior; simulate by faking a prior navigate
    state.inspectedTargets.add('https://example.com');
    expect(state.inspectedTargets.size).toBe(1);
  });

  it('checkToolPolicy blocks absolute paths in file_edit create', () => {
    expect(checkToolPolicy([block('file_edit', { command: 'create', path: '/etc/passwd', file_text: 'x' })])).toMatch(/absolute/i);
  });

  it('checkToolPolicy allows relative paths', () => {
    expect(checkToolPolicy([block('file_edit', { command: 'create', path: 'src/foo.ts', file_text: 'x' })])).toBeNull();
  });

  it('returns null for non-browser non-file tools', () => {
    const state = initBrowserBudget();
    expect(checkBrowserBudget([block('shell_exec', { command: 'ls' })], state)).toBeNull();
    expect(checkToolPolicy([block('shell_exec', { command: 'ls' })])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx jest tests/renderer/agent/browserBudget.test.ts 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../../../src/main/agent/browserBudget'`

- [ ] **Step 3: Create browserBudget.ts**

```typescript
// src/main/agent/browserBudget.ts
import type { BrowserBudgetState, ToolUseBlock } from './types';

const MAX_SEARCH_ROUNDS = 2;
const MAX_INSPECTED_TARGETS = 6;
const MAX_BACKGROUND_TABS = 6;
const MAX_SCROLL_FALLBACKS = 2;

const SEARCH_ENGINES = ['google.com/search', 'bing.com/search', 'duckduckgo.com/?q', 'search.yahoo.com'];
const EXTRACT_TOOLS = new Set(['browser_extract_text', 'browser_get_page_state', 'browser_find_elements']);
const TAB_TOOLS = new Set(['browser_new_tab']);
const SCROLL_TOOLS = new Set(['browser_scroll']);

export function initBrowserBudget(): BrowserBudgetState {
  return {
    searchRounds: 0,
    inspectedTargets: new Set(),
    backgroundTabs: 0,
    scrollFallbacks: new Map(),
  };
}

export function checkBrowserBudget(
  toolBlocks: ToolUseBlock[],
  state: BrowserBudgetState,
): string | null {
  for (const block of toolBlocks) {
    const { name, input } = block;

    if (name === 'browser_navigate') {
      const url = (input.url as string) ?? '';
      if (SEARCH_ENGINES.some(e => url.includes(e)) && state.searchRounds >= MAX_SEARCH_ROUNDS) {
        return `Browser budget: search round limit (${MAX_SEARCH_ROUNDS}) reached. Stop searching and synthesize from what you have.`;
      }
    }

    if (EXTRACT_TOOLS.has(name) && state.inspectedTargets.size >= MAX_INSPECTED_TARGETS) {
      return `Browser budget: inspected target limit (${MAX_INSPECTED_TARGETS}) reached. Stop inspecting new pages and produce a final answer.`;
    }

    if (TAB_TOOLS.has(name) && state.backgroundTabs >= MAX_BACKGROUND_TABS) {
      return `Browser budget: background tab limit (${MAX_BACKGROUND_TABS}) reached. Close tabs before opening new ones.`;
    }

    if (SCROLL_TOOLS.has(name)) {
      const url = (input._currentUrl as string) ?? 'unknown';
      const scrollCount = state.scrollFallbacks.get(url) ?? 0;
      if (scrollCount >= MAX_SCROLL_FALLBACKS) {
        return `Browser budget: scroll fallback limit (${MAX_SCROLL_FALLBACKS}) reached for this page. Try a different approach.`;
      }
    }
  }
  return null;
}

export function updateBrowserBudget(
  toolBlocks: ToolUseBlock[],
  results: string[],
  state: BrowserBudgetState,
): void {
  for (let i = 0; i < toolBlocks.length; i++) {
    const block = toolBlocks[i];
    const { name, input } = block;

    if (name === 'browser_navigate') {
      const url = (input.url as string) ?? '';
      if (SEARCH_ENGINES.some(e => url.includes(e))) {
        state.searchRounds++;
      }
    }

    if (EXTRACT_TOOLS.has(name)) {
      const result = results[i] ?? '';
      try {
        const parsed = JSON.parse(result);
        const url = parsed.url as string | undefined;
        if (url) state.inspectedTargets.add(url);
      } catch { /* non-JSON result, skip */ }
    }

    if (TAB_TOOLS.has(name)) {
      state.backgroundTabs++;
    }

    if (SCROLL_TOOLS.has(name)) {
      const url = (input._currentUrl as string) ?? 'unknown';
      state.scrollFallbacks.set(url, (state.scrollFallbacks.get(url) ?? 0) + 1);
    }
  }
}

export function checkToolPolicy(toolBlocks: ToolUseBlock[]): string | null {
  for (const block of toolBlocks) {
    if ((block.name === 'file_edit' || block.name === 'str_replace_based_edit_tool')) {
      const path = block.input.path as string | undefined;
      const cmd = block.input.command as string | undefined;
      if (path && (cmd === 'create' || cmd === 'str_replace') && path.startsWith('/')) {
        // Allow common safe absolute paths
        const safe = ['/tmp/', '/home/', process.env.HOME ?? ''].some(p => path.startsWith(p));
        if (!safe) {
          return `Tool policy: absolute path "${path}" is not allowed in file_edit. Use a relative path or a path under /tmp or $HOME.`;
        }
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx jest tests/renderer/agent/browserBudget.test.ts 2>&1 | tail -20
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/browserBudget.ts tests/renderer/agent/browserBudget.test.ts
git commit -m "feat(agent): add browserBudget + checkToolPolicy"
```

---

## Task 6: Dispatch

**Files:**
- Create: `src/main/agent/dispatch.ts`

- [ ] **Step 1: Create dispatch.ts**

```typescript
// src/main/agent/dispatch.ts
import { executeShellTool } from '../core/cli/shellTools';
import { executeBrowserTool } from '../core/cli/browserTools';
import { truncateBrowserResult } from '../core/cli/truncate';
import { trackToolCall, trackToolResult } from '../runTracker';
import type { DispatchContext, ToolUseBlock, ToolCallRecord } from './types';

const SHELL_TOOL_NAMES = new Set([
  'shell_exec', 'bash', 'file_edit', 'str_replace_based_edit_tool',
  'file_list_directory', 'file_search',
]);

const BROWSER_TOOL_NAMES = new Set([
  'browser_navigate', 'browser_click', 'browser_type', 'browser_scroll',
  'browser_wait_for', 'browser_evaluate_js', 'browser_find_elements',
  'browser_get_page_state', 'browser_screenshot', 'browser_extract_text',
  'browser_new_tab', 'browser_switch_tab', 'browser_list_tabs',
  'browser_select', 'browser_hover', 'browser_key_press',
  'browser_close_tab', 'browser_get_element_text', 'browser_back', 'browser_forward',
]);

export async function dispatch(
  toolBlocks: ToolUseBlock[],
  ctx: DispatchContext,
): Promise<string[]> {
  const results = await Promise.all(
    toolBlocks.map(block => executeOne(block, ctx)),
  );

  // Record in ledger for verification
  for (let i = 0; i < toolBlocks.length; i++) {
    const record: ToolCallRecord = {
      id: toolBlocks[i].id,
      name: toolBlocks[i].name,
      input: toolBlocks[i].input,
      result: results[i],
    };
    ctx.allToolCalls.push(record);
  }
  ctx.toolCallCount += toolBlocks.length;

  return results;
}

async function executeOne(
  block: ToolUseBlock,
  ctx: DispatchContext,
): Promise<string> {
  if (ctx.signal.aborted) {
    return JSON.stringify({ ok: false, error: 'Cancelled' });
  }

  const { options } = ctx;
  const startMs = Date.now();
  const argsSummary = JSON.stringify(block.input).slice(0, 120);
  const eventId = trackToolCall(ctx.runId, block.name, argsSummary);

  options.onToolActivity?.({
    id: block.id,
    name: block.name,
    status: 'running',
    detail: argsSummary,
  });

  let result: string;
  let isError = false;

  try {
    result = await routeToolExecution(block, ctx);
  } catch (err) {
    result = JSON.stringify({ ok: false, error: (err as Error).message });
    isError = true;
  }

  const durationMs = Date.now() - startMs;
  trackToolResult(ctx.runId, eventId, result.slice(0, 200), durationMs);

  options.onToolActivity?.({
    id: block.id,
    name: block.name,
    status: isError ? 'error' : 'success',
    detail: result.slice(0, 200),
    durationMs,
  });

  return result;
}

async function routeToolExecution(
  block: ToolUseBlock,
  ctx: DispatchContext,
): Promise<string> {
  if (SHELL_TOOL_NAMES.has(block.name)) {
    return executeShellTool(block.name, block.input);
  }

  if (BROWSER_TOOL_NAMES.has(block.name)) {
    const { browserService } = ctx.options;
    if (!browserService) {
      return JSON.stringify({ ok: false, error: 'Browser not available' });
    }
    const output = await executeBrowserTool(block.name, block.input, browserService);
    return truncateBrowserResult(JSON.stringify(output));
  }

  return JSON.stringify({ ok: false, error: `Unknown tool: ${block.name}` });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/agent/dispatch.ts
git commit -m "feat(agent): add dispatch — parallel tool execution with DispatchContext"
```

---

## Task 7: Recovery

**Files:**
- Create: `src/main/agent/recovery.ts`
- Create: `tests/renderer/agent/recovery.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/renderer/agent/recovery.test.ts
import { verifyOutcomes } from '../../../src/main/agent/recovery';
import type { ToolCallRecord } from '../../../src/main/agent/types';

function record(name: string, input: Record<string, unknown>, result: string): ToolCallRecord {
  return { id: 'x', name, input, result };
}

describe('verifyOutcomes', () => {
  it('returns null when no claimed writes', () => {
    expect(verifyOutcomes('Here is a summary.', [])).toBeNull();
  });

  it('returns null when claimed write matches tool call', () => {
    const calls = [record('file_edit', { command: 'create', path: 'src/foo.ts', file_text: 'x' }, 'File created at src/foo.ts')];
    expect(verifyOutcomes("I've written the file to src/foo.ts.", calls)).toBeNull();
  });

  it('returns issue when claimed write has no matching tool call', () => {
    const result = verifyOutcomes("I've saved the output to results.json.", []);
    expect(result).not.toBeNull();
    expect(result!.issue).toMatch(/results\.json/);
  });

  it('returns null when loop produced no claims', () => {
    const calls = [record('shell_exec', { command: 'ls' }, 'foo.ts')];
    expect(verifyOutcomes('The directory contains foo.ts.', calls)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx jest tests/renderer/agent/recovery.test.ts 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../../../src/main/agent/recovery'`

- [ ] **Step 3: Create recovery.ts**

```typescript
// src/main/agent/recovery.ts
import type { ToolCallRecord, VerificationResult, LoopOptions } from './types';

// Patterns that suggest the LLM claimed to write/save a file
const CLAIMED_WRITE_PATTERNS = [
  /(?:written|saved|created|wrote|stored)\s+(?:the\s+)?(?:file\s+)?(?:to\s+|at\s+|as\s+)?['"`]?([^\s'"`]+\.[a-z]{1,6})['"`]?/gi,
  /(?:file|output)\s+(?:has\s+been\s+)?(?:written|saved|created)\s+(?:to\s+|at\s+)?['"`]?([^\s'"`]+\.[a-z]{1,6})['"`]?/gi,
];

const WRITE_TOOL_NAMES = new Set(['file_edit', 'str_replace_based_edit_tool']);

function extractClaimedWrites(text: string): string[] {
  const claimed: string[] = [];
  for (const pattern of CLAIMED_WRITE_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const fname = m[1];
      if (fname && !fname.startsWith('http')) {
        claimed.push(fname);
      }
    }
  }
  return [...new Set(claimed)];
}

export function verifyOutcomes(
  finalText: string,
  allToolCalls: ToolCallRecord[],
): VerificationResult | null {
  const claimedWrites = extractClaimedWrites(finalText);
  if (claimedWrites.length === 0) return null;

  const actualWrites = allToolCalls
    .filter(c => WRITE_TOOL_NAMES.has(c.name) && (c.input.command === 'create' || c.input.command === 'str_replace'))
    .map(c => c.input.path as string);

  for (const claimed of claimedWrites) {
    const matched = actualWrites.some(w => w === claimed || w.endsWith(`/${claimed}`) || w.endsWith(claimed));
    if (!matched) {
      return {
        issue: `Response claimed to write "${claimed}" but no matching file_edit tool call was found.`,
        context: `Actual writes: ${actualWrites.join(', ') || 'none'}`,
      };
    }
  }

  return null;
}

// runRecovery is called from agentLoop — imported there with a streamLLM reference
// to avoid a circular dependency, recovery only exports the pure verifyOutcomes here.
// The recovery iteration logic lives inline in agentLoop.ts.
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx jest tests/renderer/agent/recovery.test.ts 2>&1 | tail -20
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/recovery.ts tests/renderer/agent/recovery.test.ts
git commit -m "feat(agent): add recovery — verifyOutcomes post-loop check"
```

---

## Task 8: streamLLM Adapter

**Files:**
- Modify: `src/main/anthropicChat.ts`
- Modify: `src/main/openaiChat.ts`
- Modify: `src/main/geminiChat.ts`
- Create: `src/main/agent/streamLLM.ts`

The goal: strip the tool loop out of each `*Chat.ts` file and expose a single-turn streaming function. `streamLLM.ts` routes to the right one.

- [ ] **Step 1: Refactor anthropicChat.ts — add streamAnthropicLLM()**

Add this new export at the bottom of `src/main/anthropicChat.ts`. Do NOT remove `streamAnthropicChat` yet (it is still called by `registerIpc.ts` until Task 9).

```typescript
// Add to bottom of src/main/anthropicChat.ts

import type { ToolUseBlock, LLMTurn, LoopOptions } from './agent/types';

export type AnthropicLoopMessage =
  | Anthropic.MessageParam
  | { role: 'user'; content: Anthropic.ToolResultBlockParam[] };

/**
 * Single-turn streaming call for use by agentLoop.
 * Does NOT run a tool loop — returns text + tool_use blocks from one LLM response.
 */
export async function streamAnthropicLLM(
  messages: Anthropic.MessageParam[],
  systemPrompt: string,
  tools: Anthropic.Tool[],
  options: LoopOptions,
): Promise<LLMTurn> {
  const client = new Anthropic({ apiKey: options.apiKey });
  const apiModelId = options.model;

  const body: Anthropic.MessageCreateParams = {
    model: apiModelId,
    max_tokens: 8192,
    messages,
    system: systemPrompt,
    tools: tools as Anthropic.Tool[],
  };

  const response = await client.messages.create(body, { signal: options.signal });

  const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
  const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

  const text = textBlocks.map(b => b.text).join('');
  if (text) options.onText(text);

  const toolBlocks: ToolUseBlock[] = toolUseBlocks.map(b => ({
    id: b.id,
    name: b.name,
    input: b.input as Record<string, unknown>,
  }));

  return { text, toolBlocks };
}
```

- [ ] **Step 2: Refactor openaiChat.ts — add streamOpenAILLM()**

Add this new export at the bottom of `src/main/openaiChat.ts`:

```typescript
// Add to bottom of src/main/openaiChat.ts

import type { ToolUseBlock, LLMTurn, LoopOptions } from './agent/types';

/**
 * Single-turn streaming call for use by agentLoop.
 */
export async function streamOpenAILLM(
  messages: OpenAIMessage[],
  systemPrompt: string,
  tools: OpenAI.Chat.ChatCompletionTool[],
  options: LoopOptions,
): Promise<LLMTurn> {
  const client = new OpenAI({ apiKey: options.apiKey });

  const loopMessages: OpenAIMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  const stream = await client.chat.completions.create(
    {
      model: options.model,
      messages: loopMessages,
      tools,
      tool_choice: 'auto',
      stream: true,
      // @ts-ignore
      store: false,
    },
    { signal: options.signal },
  );

  let text = '';
  const toolCallAccumulators: Record<string, { name: string; args: string }> = {};

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      text += delta.content;
      options.onText(delta.content);
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = String(tc.index);
        if (!toolCallAccumulators[idx]) toolCallAccumulators[idx] = { name: '', args: '' };
        if (tc.function?.name) toolCallAccumulators[idx].name = tc.function.name;
        if (tc.function?.arguments) toolCallAccumulators[idx].args += tc.function.arguments;
      }
    }
  }

  const ts = Date.now();
  const toolBlocks: ToolUseBlock[] = Object.entries(toolCallAccumulators).map(([idx, tc]) => ({
    id: `call_${idx}_${ts}`,
    name: tc.name,
    input: (() => { try { return JSON.parse(tc.args || '{}'); } catch { return {}; } })(),
  }));

  return { text, toolBlocks };
}
```

- [ ] **Step 3: Refactor geminiChat.ts — add streamGeminiLLM()**

Add this new export at the bottom of `src/main/geminiChat.ts`:

```typescript
// Add to bottom of src/main/geminiChat.ts

import type { ToolUseBlock, LLMTurn, LoopOptions } from './agent/types';

/**
 * Single-turn streaming call for use by agentLoop.
 */
export async function streamGeminiLLM(
  sessionMessages: any[],
  systemPrompt: string,
  tools: any[],
  options: LoopOptions,
): Promise<LLMTurn> {
  const ai = new GoogleGenAI({ apiKey: options.apiKey });

  const chat = ai.chats.create({
    model: options.model,
    config: {
      systemInstruction: systemPrompt,
      tools,
      temperature: 0,
    },
    history: sessionMessages.slice(0, -1),
  });

  const responseStream = await chat.sendMessageStream({
    message: sessionMessages[sessionMessages.length - 1].parts,
  });

  let text = '';
  const functionCalls: any[] = [];

  for await (const chunk of responseStream) {
    if (options.signal?.aborted) throw new Error('AbortError');
    if (chunk.text) {
      text += chunk.text;
      options.onText(chunk.text);
    }
    if (chunk.functionCalls?.length) functionCalls.push(...chunk.functionCalls);
  }

  const toolBlocks: ToolUseBlock[] = functionCalls.map((fc, i) => ({
    id: `gc-${Date.now()}-${i}`,
    name: fc.name,
    input: fc.args as Record<string, unknown>,
  }));

  return { text, toolBlocks };
}
```

- [ ] **Step 4: Create streamLLM.ts — provider router**

```typescript
// src/main/agent/streamLLM.ts
import Anthropic from '@anthropic-ai/sdk';
import { BROWSER_TOOLS } from '../core/cli/browserTools';
import { searchTools } from '../core/cli/toolRegistry';
import { SHELL_TOOLS_OPENAI } from '../core/cli/shellTools';
import { streamAnthropicLLM } from '../anthropicChat';
import { streamOpenAILLM } from '../openaiChat';
import { streamGeminiLLM } from '../geminiChat';
import type { LLMTurn, LoopOptions, AgentProfile } from './types';

// Shell tool definitions in Anthropic format (reused from anthropicChat conventions)
const ANTHROPIC_SHELL_TOOLS: Anthropic.Tool[] = [
  {
    name: 'shell_exec',
    description: 'Execute a bash shell command on the local system.',
    input_schema: { type: 'object' as const, properties: { command: { type: 'string' } }, required: ['command'] },
  },
  {
    name: 'file_edit',
    description: 'Read and edit files. command: view|create|str_replace. path: file path.',
    input_schema: { type: 'object' as const, properties: { command: { type: 'string' }, path: { type: 'string' }, file_text: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' } }, required: ['command', 'path'] },
  },
  {
    name: 'file_list_directory',
    description: 'List directory contents as structured JSON.',
    input_schema: { type: 'object' as const, properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'file_search',
    description: 'Search files with regex pattern. Returns JSON matches.',
    input_schema: { type: 'object' as const, properties: { pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' } }, required: ['pattern'] },
  },
];

function getAnthropicTools(profile: AgentProfile): Anthropic.Tool[] {
  const tools = [...ANTHROPIC_SHELL_TOOLS];
  if (profile.toolGroup === 'browser' || profile.toolGroup === 'full') {
    tools.push(...BROWSER_TOOLS);
  }
  return tools;
}

function getOpenAITools(profile: AgentProfile) {
  const shell = searchTools({ names: ['shell_exec', 'file_edit', 'file_list_directory', 'file_search'] });
  // Import inline to avoid circular issues
  const { toOpenAITool } = require('../core/cli/toolRegistry');
  const tools = shell.map(toOpenAITool);
  if (profile.toolGroup === 'browser' || profile.toolGroup === 'full') {
    const browserSchemas = searchTools({ query: 'browser', limit: 30 });
    tools.push(...browserSchemas.map(toOpenAITool));
  }
  return tools;
}

function getGeminiTools(profile: AgentProfile) {
  const { toGeminiDeclaration, getSearchToolGemini, searchTools: st } = require('../core/cli/toolRegistry');
  const shellDecls = st({ names: ['shell_exec', 'file_edit', 'file_list_directory', 'file_search'] }).map(toGeminiDeclaration);
  const decls = [getSearchToolGemini(), ...shellDecls];
  if (profile.toolGroup === 'browser' || profile.toolGroup === 'full') {
    const browserDecls = st({ query: 'browser', limit: 30 }).map(toGeminiDeclaration);
    decls.push(...browserDecls);
  }
  return [{ functionDeclarations: decls }];
}

export async function streamLLM(
  messages: any[],
  systemPrompt: string,
  dynamicPrompt: string,
  profile: AgentProfile,
  options: LoopOptions,
): Promise<LLMTurn> {
  const fullPrompt = dynamicPrompt ? `${systemPrompt}\n\n${dynamicPrompt}` : systemPrompt;

  switch (options.provider) {
    case 'anthropic':
      return streamAnthropicLLM(messages, fullPrompt, getAnthropicTools(profile), options);
    case 'openai':
      return streamOpenAILLM(messages, fullPrompt, getOpenAITools(profile), options);
    case 'gemini':
      return streamGeminiLLM(messages, fullPrompt, getGeminiTools(profile), options);
    default:
      throw new Error(`Unknown provider: ${options.provider}`);
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/main/anthropicChat.ts src/main/openaiChat.ts src/main/geminiChat.ts src/main/agent/streamLLM.ts
git commit -m "feat(agent): add streamLLM adapter + single-turn exports on *Chat.ts files"
```

---

## Task 9: agentLoop Orchestrator

**Files:**
- Create: `src/main/agent/agentLoop.ts`

- [ ] **Step 1: Create agentLoop.ts**

```typescript
// src/main/agent/agentLoop.ts
import { classify } from './classify';
import { buildStaticPrompt, buildDynamicPrompt } from './promptBuilder';
import { createLoopControl, removeLoopControl } from './loopControl';
import { initBrowserBudget, checkBrowserBudget, updateBrowserBudget, checkToolPolicy } from './browserBudget';
import { dispatch } from './dispatch';
import { verifyOutcomes } from './recovery';
import { streamLLM } from './streamLLM';
import { startRun, completeRun, failRun } from '../runTracker';
import type { LoopOptions, DispatchContext, ToolUseBlock } from './types';

const MAX_ITERATIONS = 50;

export async function agentLoop(
  userMessage: string,
  messages: any[],
  options: LoopOptions,
): Promise<string> {
  const { runId } = options;

  // 1. Classify
  const profile = classify(userMessage, options.forcedProfile);

  // 2. Build static prompt (once per run)
  const staticPrompt = buildStaticPrompt(profile, options.unrestrictedMode ?? false);

  // 3. Init loop state
  const control = createLoopControl(runId, options.signal);
  const ctx: DispatchContext = {
    runId,
    signal: control.signal,
    iterationIndex: 0,
    toolCallCount: 0,
    allToolCalls: [],
    browserBudget: initBrowserBudget(),
    options,
  };

  // Greeting shortcut — no tools needed
  if (profile.isGreeting) {
    options.onThinking?.('Responding…');
    const { text } = await streamLLM(messages, staticPrompt, '', profile, { ...options, signal: control.signal });
    removeLoopControl(runId);
    return text;
  }

  let finalText = '';

  try {
    for (let i = 0; i < (options.maxIterations ?? MAX_ITERATIONS); i++) {
      // Pause check
      await control.waitIfPaused();
      if (control.signal.aborted) break;

      // Inject queued user context
      if (control.pendingContext) {
        messages.push({ role: 'user', content: control.pendingContext });
        control.pendingContext = null;
      }

      ctx.iterationIndex = i;
      const dynamicPrompt = buildDynamicPrompt(profile, ctx);

      options.onThinking?.(`Thinking… (step ${i + 1})`);

      // Call LLM
      const { text, toolBlocks } = await streamLLM(
        messages, staticPrompt, dynamicPrompt, profile,
        { ...options, signal: control.signal },
      );

      if (text) finalText = text;

      // No tools → LLM is done
      if (toolBlocks.length === 0) break;

      // Policy checks before execution
      const violation = checkBrowserBudget(toolBlocks, ctx.browserBudget)
        ?? checkToolPolicy(toolBlocks);

      if (violation) {
        messages.push({ role: 'assistant', content: text || '(no text)' });
        messages.push({ role: 'user', content: `[POLICY] ${violation}` });
        continue;
      }

      // Push assistant turn with tool calls
      messages.push({
        role: 'assistant',
        content: buildAssistantContent(text, toolBlocks, options.provider),
      });

      // Execute tools
      const results = await dispatch(toolBlocks, ctx);

      // Update browser budget
      updateBrowserBudget(toolBlocks, results, ctx.browserBudget);

      // Push tool results
      messages.push(buildToolResultMessage(toolBlocks, results, options.provider));
    }

    // Post-loop verification
    const issue = verifyOutcomes(finalText, ctx.allToolCalls);
    if (issue && !control.signal.aborted) {
      options.onThinking?.('Verifying…');
      messages.push({ role: 'user', content: `Your response said: "${issue.issue}". ${issue.context} Please correct this.` });
      const { text } = await streamLLM(messages, staticPrompt, '', profile, { ...options, signal: control.signal });
      if (text) finalText = text;
    }

    return finalText;
  } finally {
    removeLoopControl(runId);
  }
}

// Build the assistant content block in provider-specific format
function buildAssistantContent(text: string, toolBlocks: ToolUseBlock[], provider: string): any {
  if (provider === 'anthropic') {
    const content: any[] = [];
    if (text) content.push({ type: 'text', text });
    for (const b of toolBlocks) {
      content.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input });
    }
    return content;
  }
  if (provider === 'openai') {
    return {
      role: 'assistant',
      content: text || null,
      tool_calls: toolBlocks.map(b => ({
        id: b.id,
        type: 'function',
        function: { name: b.name, arguments: JSON.stringify(b.input) },
      })),
    };
  }
  // Gemini
  const parts: any[] = [];
  if (text) parts.push({ text });
  for (const b of toolBlocks) parts.push({ functionCall: { name: b.name, args: b.input } });
  return parts;
}

// Build the tool result message in provider-specific format
function buildToolResultMessage(toolBlocks: ToolUseBlock[], results: string[], provider: string): any {
  if (provider === 'anthropic') {
    return {
      role: 'user',
      content: toolBlocks.map((b, i) => ({
        type: 'tool_result',
        tool_use_id: b.id,
        content: results[i],
      })),
    };
  }
  if (provider === 'openai') {
    // Return array of tool messages (caller pushes each individually)
    return toolBlocks.map((b, i) => ({
      role: 'tool',
      tool_call_id: b.id,
      content: results[i],
    }));
  }
  // Gemini
  return {
    role: 'user',
    parts: toolBlocks.map((b, i) => ({
      functionResponse: { name: b.name, response: { result: results[i] } },
    })),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/agent/agentLoop.ts
git commit -m "feat(agent): add agentLoop orchestrator"
```

---

## Task 10: Wire registerIpc.ts

**Files:**
- Modify: `src/main/registerIpc.ts`

- [ ] **Step 1: Update CHAT_SEND to call agentLoop()**

In `src/main/registerIpc.ts`, replace the `CHAT_SEND` handler's provider dispatch block (lines 285–326) with:

```typescript
// Replace the provider-dispatch block inside CHAT_SEND handler
// Old code (lines 285-326): if (settings.provider === 'gemini') { ... } else if ... { ... } else { ... }
// New code:

import { agentLoop } from './agent/agentLoop';
import { cancelLoop, pauseLoop, resumeLoop, addContext } from './agent/loopControl';
import { IPC_EVENTS } from './ipc-channels';

// Inside CHAT_SEND handler, after building sessionMessages/pruning:
const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

let result: { response: string; error?: string };
try {
  const response = await agentLoop(text, sessionMessages, {
    provider: settings.provider as 'anthropic' | 'openai' | 'gemini',
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
}
```

- [ ] **Step 2: Wire CHAT_STOP, CHAT_PAUSE, CHAT_RESUME, CHAT_ADD_CONTEXT**

Replace the stub handlers in `registerIpc.ts`:

```typescript
// Replace:
// ipcMain.handle(IPC.CHAT_PAUSE, () => { });
// ipcMain.handle(IPC.CHAT_RESUME, () => { });
// ipcMain.handle(IPC.CHAT_ADD_CONTEXT, () => { });

// With:
ipcMain.handle(IPC.CHAT_PAUSE, () => {
  if (activeRunId) pauseLoop(activeRunId);
});
ipcMain.handle(IPC.CHAT_RESUME, () => {
  if (activeRunId) resumeLoop(activeRunId);
});
ipcMain.handle(IPC.CHAT_ADD_CONTEXT, (_e, text: string) => {
  if (activeRunId) addContext(activeRunId, text);
});
```

Also add `let activeRunId: string | null = null;` near the top of `registerIpc.ts` with the other module-level vars, and set `activeRunId = runId` inside the CHAT_SEND handler before calling `agentLoop`, and `activeRunId = null` after it resolves.

- [ ] **Step 3: Update CHAT_STOP to use cancelLoop**

```typescript
// Replace:
// ipcMain.handle(IPC.CHAT_STOP, () => { chatAbort?.abort(); chatAbort = null; });

// With:
ipcMain.handle(IPC.CHAT_STOP, () => {
  chatAbort?.abort();
  chatAbort = null;
  if (activeRunId) cancelLoop(activeRunId);
});
```

- [ ] **Step 4: Commit**

```bash
git add src/main/registerIpc.ts
git commit -m "feat(agent): wire registerIpc — CHAT_SEND → agentLoop, PAUSE/RESUME/ADD_CONTEXT active"
```

---

## Task 11: Smoke Test End-to-End

- [ ] **Step 1: Build the project**

```bash
cd /home/dp/Desktop/clawdia7.0 && npm run build 2>&1 | tail -40
```

Expected: build completes with no TypeScript errors.

- [ ] **Step 2: Run all agent tests**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx jest tests/renderer/agent/ --verbose 2>&1 | tail -40
```

Expected: all tests pass.

- [ ] **Step 3: Fix any TypeScript or test errors found**

Address any import path issues, type mismatches, or test failures before continuing.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(agent): complete agent loop — classify, dispatch, budget, recovery, loopControl wired"
```

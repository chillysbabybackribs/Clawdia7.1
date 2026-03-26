# Token Efficiency & Caching Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce API token costs and latency across all three providers (Anthropic, OpenAI, Gemini) via tool result truncation, session sliding window, and native prompt caching.

**Architecture:** Three independent optimization layers applied in-process: (1) a shared truncation utility caps unbounded tool outputs before they enter session history; (2) a sliding window prunes the oldest turns from each session in `registerIpc.ts` before each request; (3) provider-specific caching headers/flags mark stable content (system prompt, tool schemas) for server-side caching.

**Tech Stack:** TypeScript, Anthropic SDK (`cache_control: ephemeral`), OpenAI SDK (automatic prefix caching on GPT-4o+), Gemini SDK (module-level declarations), Vitest for tests.

---

### Task 1: Shared truncation utility

**Files:**
- Create: `src/main/core/cli/truncate.ts`
- Create: `tests/main/core/cli/truncate.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/main/core/cli/truncate.test.ts
import { describe, it, expect } from 'vitest';
import { truncateToolResult, SHELL_MAX, FILE_MAX, BROWSER_MAX } from '../../../src/main/core/cli/truncate';

describe('truncateToolResult', () => {
  it('returns short strings unchanged', () => {
    expect(truncateToolResult('hello', SHELL_MAX)).toBe('hello');
  });

  it('truncates long strings and appends marker', () => {
    const long = 'x'.repeat(SHELL_MAX + 100);
    const result = truncateToolResult(long, SHELL_MAX);
    expect(result.length).toBeLessThanOrEqual(SHELL_MAX + 60);
    expect(result).toContain('[truncated');
  });

  it('SHELL_MAX is 4000', () => {
    expect(SHELL_MAX).toBe(4000);
  });

  it('FILE_MAX is 8000', () => {
    expect(FILE_MAX).toBe(8000);
  });

  it('BROWSER_MAX is 2000', () => {
    expect(BROWSER_MAX).toBe(2000);
  });

  it('truncation marker shows original length', () => {
    const long = 'a'.repeat(5000);
    const result = truncateToolResult(long, SHELL_MAX);
    expect(result).toContain('5000');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx vitest run tests/main/core/cli/truncate.test.ts 2>&1 | tail -20
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/main/core/cli/truncate.ts

export const SHELL_MAX = 4000;
export const FILE_MAX = 8000;
export const BROWSER_MAX = 2000;

/**
 * Truncate a tool result string to maxChars, appending a marker with the
 * original length so the model knows content was dropped.
 */
export function truncateToolResult(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const marker = `\n[truncated — original length: ${text.length} chars]`;
  return text.slice(0, maxChars) + marker;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx vitest run tests/main/core/cli/truncate.test.ts 2>&1 | tail -10
```
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/dp/Desktop/clawdia7.0 && git add src/main/core/cli/truncate.ts tests/main/core/cli/truncate.test.ts && git commit -m "feat: add shared truncateToolResult utility with SHELL/FILE/BROWSER max constants"
```

---

### Task 2: Apply truncation to shellTools.ts

**Files:**
- Modify: `src/main/core/cli/shellTools.ts`
- Modify: `tests/main/core/cli/truncate.test.ts` (add shell integration test)

- [ ] **Step 1: Add shell truncation test**

Append to `tests/main/core/cli/truncate.test.ts`:

```typescript
import { executeShellTool } from '../../../src/main/core/cli/shellTools';

describe('executeShellTool truncation', () => {
  it('truncates stdout over SHELL_MAX', async () => {
    // Generate >4000 chars of output
    const result = await executeShellTool('shell_exec', { command: `python3 -c "print('x' * 5000)"` });
    expect(result.length).toBeLessThanOrEqual(SHELL_MAX + 100);
    expect(result).toContain('[truncated');
  });

  it('truncates file view over FILE_MAX', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const tmp = path.join(os.tmpdir(), 'clawdia-test-big.txt');
    fs.writeFileSync(tmp, 'y'.repeat(FILE_MAX + 500));
    const result = await executeShellTool('file_edit', { command: 'view', path: tmp });
    expect(result.length).toBeLessThanOrEqual(FILE_MAX + 100);
    expect(result).toContain('[truncated');
    fs.unlinkSync(tmp);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx vitest run tests/main/core/cli/truncate.test.ts 2>&1 | tail -20
```
Expected: FAIL — shell output not yet truncated.

- [ ] **Step 3: Apply truncation in shellTools.ts**

Edit `src/main/core/cli/shellTools.ts` — add import at top and wrap outputs:

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { truncateToolResult, SHELL_MAX, FILE_MAX } from './truncate';

const execAsync = promisify(exec);

export async function executeShellTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    if (name === 'shell_exec' || name === 'bash') {
      const command = (args.command ?? args.cmd) as string;
      const { stdout, stderr } = await execAsync(command);
      const raw = stdout || stderr || 'Command executed successfully with no output.';
      return truncateToolResult(raw, SHELL_MAX);
    }
    if (name === 'file_edit' || name === 'str_replace_based_edit_tool') {
      const cmd = args.command as string;
      const filePath = args.path as string;
      if (cmd === 'view') {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return truncateToolResult(raw, FILE_MAX);
      }
      if (cmd === 'create') {
        fs.writeFileSync(filePath, (args.file_text as string) ?? '', 'utf-8');
        return `File created at ${filePath}`;
      }
      if (cmd === 'str_replace') {
        const text = fs.readFileSync(filePath, 'utf-8');
        const count = text.split(args.old_str as string).length - 1;
        if (count === 0) return 'Error: old_str not found in file.';
        if (count > 1) return 'Error: old_str found multiple times.';
        fs.writeFileSync(filePath, text.replace(args.old_str as string, args.new_str as string), 'utf-8');
        return 'File updated successfully.';
      }
      return `Executed ${cmd} on ${filePath} (unrecognised command).`;
    }
    return `Error: Unknown tool ${name}`;
  } catch (err: unknown) {
    return `Error executing tool: ${(err as Error).message}`;
  }
}

export const SHELL_TOOLS_OPENAI = [
  {
    type: 'function' as const,
    function: {
      name: 'shell_exec',
      description: 'Execute a bash shell command on the local system.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run.' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'file_edit',
      description: 'Read and edit files on the local filesystem.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Action: view, create, or str_replace.' },
          path: { type: 'string', description: 'Absolute file path.' },
          file_text: { type: 'string', description: 'File content (required for create).' },
          old_str: { type: 'string', description: 'Text to replace (required for str_replace).' },
          new_str: { type: 'string', description: 'Replacement text (required for str_replace).' },
        },
        required: ['command', 'path'],
      },
    },
  },
];
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx vitest run tests/main/core/cli/truncate.test.ts 2>&1 | tail -10
```
Expected: PASS — all tests including new shell integration tests.

- [ ] **Step 5: Commit**

```bash
cd /home/dp/Desktop/clawdia7.0 && git add src/main/core/cli/shellTools.ts tests/main/core/cli/truncate.test.ts && git commit -m "feat: truncate shell stdout at 4000 chars and file view at 8000 chars"
```

---

### Task 3: Apply truncation to browser tool results

**Files:**
- Modify: `src/main/core/cli/browserTools.ts`
- Modify: `src/main/anthropicChat.ts`
- Modify: `src/main/openaiChat.ts`
- Modify: `src/main/geminiChat.ts`

The browser result truncation happens at the point where `executeBrowserTool` returns a value. Each chat file currently does `JSON.stringify(output)` directly — cap that string.

- [ ] **Step 1: Add truncation import and helper to browserTools.ts**

Read `src/main/core/cli/browserTools.ts` first, then add at the top:

```typescript
import { truncateToolResult, BROWSER_MAX } from './truncate';
```

And wrap the return value of `executeBrowserTool` at the end of the function, replacing the final `return output` (or equivalent) with:

```typescript
// After computing output object:
const resultStr = JSON.stringify(output);
return JSON.parse(truncateToolResult(resultStr, BROWSER_MAX));
```

Actually — it's cleaner to export a separate helper that chat modules call after `JSON.stringify`. Edit `src/main/core/cli/truncate.ts` to add:

```typescript
/** Truncate a JSON-stringified tool result. Use after JSON.stringify(output). */
export function truncateBrowserResult(resultStr: string): string {
  return truncateToolResult(resultStr, BROWSER_MAX);
}
```

- [ ] **Step 2: Apply truncateBrowserResult in anthropicChat.ts**

In `src/main/anthropicChat.ts`, in the `executeTools` inner function, change:

```typescript
// Before (line ~235):
content: JSON.stringify(output),
```

To:

```typescript
import { truncateBrowserResult } from './core/cli/truncate';
// ...
content: truncateBrowserResult(JSON.stringify(output)),
```

(Add the import at the top of the file alongside other imports.)

- [ ] **Step 3: Apply truncateBrowserResult in openaiChat.ts**

In `src/main/openaiChat.ts`, in the tool execution section, change:

```typescript
// Before (line ~187):
resultStr = JSON.stringify(output);
```

To:

```typescript
import { truncateBrowserResult } from './core/cli/truncate';
// ...
resultStr = truncateBrowserResult(JSON.stringify(output));
```

(Add the import at the top of the file.)

- [ ] **Step 4: Apply truncateBrowserResult in geminiChat.ts**

In `src/main/geminiChat.ts`, in the tool execution section for browser tools, change:

```typescript
// Before (line ~207):
resultStr = JSON.stringify(output);
```

To:

```typescript
import { truncateBrowserResult } from './core/cli/truncate';
// ...
resultStr = truncateBrowserResult(JSON.stringify(output));
```

(Add the import at the top of the file.)

- [ ] **Step 5: Build to verify no TypeScript errors**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /home/dp/Desktop/clawdia7.0 && git add src/main/core/cli/truncate.ts src/main/core/cli/browserTools.ts src/main/anthropicChat.ts src/main/openaiChat.ts src/main/geminiChat.ts && git commit -m "feat: truncate browser tool results at 2000 chars to cap token usage"
```

---

### Task 4: Session sliding window in registerIpc.ts

**Files:**
- Modify: `src/main/registerIpc.ts`

The `sessions` map stores full history that grows unbounded. Before each `CHAT_SEND`, prune the session to the last N turns (keep system context intact, preserve turn pairs).

- [ ] **Step 1: Write the sliding window logic**

In `src/main/registerIpc.ts`, add a constant and helper after the `sessions` map declaration:

```typescript
const MAX_SESSION_TURNS = 20; // max user+assistant turn PAIRS to keep

/**
 * Prune a session to the last MAX_SESSION_TURNS pairs.
 * A "pair" is one user turn + one assistant turn = 2 messages.
 * Always keeps complete pairs to avoid dangling tool_result blocks.
 */
function pruneSession(messages: any[]): any[] {
  const maxMessages = MAX_SESSION_TURNS * 2;
  if (messages.length <= maxMessages) return messages;
  // Find a safe cut point: drop from the front, but only at a user-role boundary
  // so we don't split a tool_result from its tool_use.
  let start = messages.length - maxMessages;
  // Walk forward until we find a user message at the start
  while (start < messages.length && messages[start].role !== 'user') {
    start++;
  }
  return messages.slice(start);
}
```

- [ ] **Step 2: Apply pruning in the CHAT_SEND handler**

In the `ipcMain.handle(IPC.CHAT_SEND, ...)` handler, after `const sessionMessages = getOrCreateSession(id);` (currently around line 191), add:

```typescript
const sessionMessages = getOrCreateSession(id);
// Prune to sliding window before building request
const prunedSession = pruneSession(sessionMessages);
// Replace in-place for the duration of this request
// (we update the canonical store with new turns after the request)
```

Actually the cleanest approach is to prune the `sessions` map value in-place before passing to the streaming function. Replace the existing lines:

```typescript
ensureConversation();
const id = activeConversationId!;
const sessionMessages = getOrCreateSession(id);
```

With:

```typescript
ensureConversation();
const id = activeConversationId!;
let sessionMessages = getOrCreateSession(id);
// Prune to sliding window
const pruned = pruneSession(sessionMessages);
if (pruned.length < sessionMessages.length) {
  sessions.set(id, pruned);
  sessionMessages = pruned;
}
```

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /home/dp/Desktop/clawdia7.0 && git add src/main/registerIpc.ts && git commit -m "feat: prune session history to last 20 turn pairs to prevent unbounded token growth"
```

---

### Task 5: Anthropic prompt caching

**Files:**
- Modify: `src/main/anthropicChat.ts`

Anthropic charges 0.1x for cache reads. Mark the system prompt and tool definitions with `cache_control: { type: "ephemeral" }` so they're cached after the first request. This requires passing them as structured blocks rather than a plain string.

- [ ] **Step 1: Restructure system prompt as cacheable block**

In `src/main/anthropicChat.ts`, change the `runStream` function's `body` construction. Replace the `system:` string with an array of `SystemBlockParam`:

```typescript
// Replace:
system: `You have access to a local CLI environment. Use the native bash tool...`,

// With:
system: [
  {
    type: 'text' as const,
    text: `You have access to a local CLI environment. Use the native bash tool to execute shell commands and explore the system. Use the native str_replace_based_edit_tool tool to read and edit files. Use these tools efficiently to accomplish the user's tasks. Do not wait for user permission to use these tools unless it involves a destructive system change.`,
    cache_control: { type: 'ephemeral' as const },
  },
],
```

- [ ] **Step 2: Add cache_control to tools in runStream**

In the same `body` object, update the `tools` array:

```typescript
tools: [
  { type: 'bash_20250124', name: 'bash', cache_control: { type: 'ephemeral' as const } } as any,
  { type: 'text_editor_20250728', name: 'str_replace_based_edit_tool', cache_control: { type: 'ephemeral' as const } } as any,
],
```

- [ ] **Step 3: Add cache_control to browser tools in runToolTurn**

In `runToolTurn`, update the body to mark BROWSER_TOOLS as cacheable. Since `BROWSER_TOOLS` is an array, we need to add `cache_control` to the last element (Anthropic caches up to 4 breakpoints; last tool gets the cache point):

```typescript
const body: Anthropic.MessageCreateParams = {
  model: apiModelId,
  max_tokens: 8192,
  messages,
  tools: BROWSER_TOOLS.map((t, i) =>
    i === BROWSER_TOOLS.length - 1
      ? { ...t, cache_control: { type: 'ephemeral' as const } }
      : t
  ) as any,
};
```

- [ ] **Step 4: Build to verify no TypeScript errors**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /home/dp/Desktop/clawdia7.0 && git add src/main/anthropicChat.ts && git commit -m "feat: add Anthropic prompt caching (cache_control: ephemeral) on system prompt and tool definitions"
```

---

### Task 6: OpenAI prompt caching

**Files:**
- Modify: `src/main/openaiChat.ts`

OpenAI's GPT-4o and o-series models support automatic prefix caching — no explicit headers needed. The cache key is based on the prefix of the messages array. To maximize cache hits, the system message (which is stable) must be first and unchanged between requests.

The current `openaiChat.ts` already builds `loopMessages` with the system message first:
```typescript
const loopMessages: OpenAIMessage[] = [
  { role: 'system', content: SYSTEM_PROMPT },
  ...sessionMessages,
];
```

This is already correct for prefix caching. The only change needed: move `SYSTEM_PROMPT` to module level (already done) and ensure it never changes between calls. No API parameter change is needed for OpenAI.

However, we can add the `store: false` flag to avoid storing sensitive user data in OpenAI's logs, and optionally use `seed` for deterministic outputs (helpful for caching consistency):

- [ ] **Step 1: Add store flag to OpenAI request**

In `src/main/openaiChat.ts`, in `client.chat.completions.create(...)`, add:

```typescript
const stream = await client.chat.completions.create(
  {
    model: modelRegistryId,
    messages: loopMessages,
    tools: ALL_TOOLS_OPENAI,
    tool_choice: 'auto',
    stream: true,
    store: false,   // don't log this session in OpenAI dashboard
  },
  { signal },
);
```

- [ ] **Step 2: Build to verify no TypeScript errors**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors. (If `store` is not in the SDK type, use `// @ts-ignore` on that line.)

- [ ] **Step 3: Commit**

```bash
cd /home/dp/Desktop/clawdia7.0 && git add src/main/openaiChat.ts && git commit -m "feat: add store:false to OpenAI requests (prefix caching already works via stable system prompt)"
```

---

### Task 7: Gemini — module-level tool declarations + shared system prompt

**Files:**
- Modify: `src/main/geminiChat.ts`
- Create: `src/main/core/cli/systemPrompt.ts`

Currently `geminiChat.ts` rebuilds `browserDeclarations` and `tools` on every request (inside the function). Move them to module level so the object is constructed once. Also add a `MAX_TOOL_TURNS` cap and fix the session rollback bug.

- [ ] **Step 1: Create shared system prompt**

```typescript
// src/main/core/cli/systemPrompt.ts
export const SHARED_SYSTEM_PROMPT = `You have access to a local CLI environment and a browser. Use shell_exec to run shell commands, file_edit to read and edit files, and browser_* tools to navigate and interact with the browser. Use these tools efficiently. Do not wait for user permission unless the action is destructive.`;
```

- [ ] **Step 2: Move browserDeclarations and tools to module level in geminiChat.ts**

Read `src/main/geminiChat.ts` in full, then replace the function-level `systemInstruction`, `browserDeclarations`, and `tools` definitions with module-level constants.

At the top of `src/main/geminiChat.ts`, after imports, add:

```typescript
import { Type } from '@google/genai';
import { BROWSER_TOOLS } from './core/cli/browserTools';
import { SHARED_SYSTEM_PROMPT } from './core/cli/systemPrompt';

const GEMINI_SYSTEM_INSTRUCTION = SHARED_SYSTEM_PROMPT;

const BROWSER_DECLARATIONS = BROWSER_TOOLS.map(t => ({
  name: t.name,
  description: t.description,
  parameters: {
    type: Type.OBJECT,
    properties: Object.fromEntries(
      Object.entries((t.input_schema as any).properties ?? {}).map(([k, v]: [string, any]) => [
        k,
        { type: v.type === 'number' ? Type.NUMBER : Type.STRING, description: v.description ?? '' },
      ])
    ),
    required: (t.input_schema as any).required ?? [],
  },
}));

const GEMINI_TOOLS = [{
  functionDeclarations: [
    {
      name: 'shell_exec',
      description: 'Execute a bash shell command and explore the local system.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          command: { type: Type.STRING, description: 'The shell command to run.' }
        },
        required: ['command']
      }
    },
    {
      name: 'file_edit',
      description: 'Read and edit files on the local system.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          command: { type: Type.STRING, description: 'The action to perform: view, create, or str_replace.' },
          path: { type: Type.STRING, description: 'The file path.' },
          file_text: { type: Type.STRING, description: 'File content (if create)' },
          old_str: { type: Type.STRING, description: 'Text to replace (if str_replace)' },
          new_str: { type: Type.STRING, description: 'New text (if str_replace)' }
        },
        required: ['command', 'path']
      }
    },
    ...BROWSER_DECLARATIONS,
  ]
}] as any;
```

- [ ] **Step 3: Update streamGeminiChat to use module-level constants**

Inside `streamGeminiChat`, remove the local `systemInstruction`, `browserDeclarations`, and `tools` variable declarations. Update the `ai.chats.create` call to use `GEMINI_SYSTEM_INSTRUCTION` and `GEMINI_TOOLS`:

```typescript
const chat = ai.chats.create({
  model: modelRegistryId,
  config: {
    systemInstruction: GEMINI_SYSTEM_INSTRUCTION,
    tools: GEMINI_TOOLS,
    temperature: 0,
  },
  history: sessionMessages.slice(0, -1),
});
```

- [ ] **Step 4: Add MAX_TOOL_TURNS cap and fix session rollback**

Replace the `while (true)` with a bounded loop and fix the single-pop rollback:

```typescript
const MAX_TOOL_TURNS = 20;
let turns = 0;

// Before the while loop, record the length for rollback:
const sessionLengthBeforeRequest = sessionMessages.length;

// Change while(true) to:
while (turns < MAX_TOOL_TURNS) {
  turns++;
  // ... existing loop body ...
}

if (turns >= MAX_TOOL_TURNS && finalResponseText === '') {
  finalResponseText = '[Tool loop reached maximum turn limit without producing a response.]';
  sendText(finalResponseText);
}
```

In the catch block, replace `sessionMessages.pop()` with:
```typescript
sessionMessages.splice(sessionLengthBeforeRequest);
```

- [ ] **Step 5: Update systemPrompt usage in anthropicChat.ts and openaiChat.ts**

Update imports in both files to use the shared constant:

In `src/main/anthropicChat.ts`, change the system text string to import from `systemPrompt.ts`:
```typescript
import { SHARED_SYSTEM_PROMPT } from './core/cli/systemPrompt';
// In runStream body:
system: [{ type: 'text' as const, text: SHARED_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' as const } }],
```

In `src/main/openaiChat.ts`, replace the `SYSTEM_PROMPT` constant with an import:
```typescript
import { SHARED_SYSTEM_PROMPT } from './core/cli/systemPrompt';
// Remove: const SYSTEM_PROMPT = `...`;
// In loopMessages: { role: 'system', content: SHARED_SYSTEM_PROMPT }
```

- [ ] **Step 6: Build to verify no TypeScript errors**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /home/dp/Desktop/clawdia7.0 && git add src/main/geminiChat.ts src/main/core/cli/systemPrompt.ts src/main/anthropicChat.ts src/main/openaiChat.ts && git commit -m "feat: move Gemini tool declarations to module level, add turn cap, fix session rollback, share system prompt"
```

---

### Task 8: Full build verification

**Files:** None (verification only)

- [ ] **Step 1: Run full TypeScript compile**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1
```
Expected: no errors.

- [ ] **Step 2: Run all tests**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx vitest run 2>&1 | tail -30
```
Expected: all existing tests pass + new truncation tests pass.

- [ ] **Step 3: Run Electron app to verify it starts**

```bash
cd /home/dp/Desktop/clawdia7.0 && npm run dev 2>&1 | head -20
```
Expected: app starts without crash, no import errors in console.

- [ ] **Step 4: Commit any fix needed, then final tag**

```bash
cd /home/dp/Desktop/clawdia7.0 && git log --oneline -10
```

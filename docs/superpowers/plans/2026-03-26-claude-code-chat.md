# Claude Code Chat Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing `claude_terminal` mode toggle button so that when active, messages in the chat panel are sent to a headless `claude` subprocess instead of the normal model, with responses streamed back into chat.

**Architecture:** A new `claudeCodeClient.ts` module spawns `claude -p --dangerously-skip-permissions --output-format stream-json --include-partial-messages` per message, parses streaming JSON from stdout, and calls an `onText` callback per chunk. Session IDs are persisted in memory per `conversationId` so `--resume` is passed on subsequent messages. `registerIpc.ts` branches into this client when the active conversation's DB `mode` is `claude_terminal`, and `CHAT_GET_MODE`/`CHAT_SET_MODE` are wired to actually read/write the `mode` column in the DB.

**Tech Stack:** Node.js `child_process.spawn`, vitest for tests, existing Electron IPC pattern (`IPC_EVENTS.CHAT_STREAM_TEXT` / `CHAT_STREAM_END`)

---

## File Map

| File | Change |
|------|--------|
| `src/main/claudeCodeClient.ts` | **Create** — spawns claude, streams output, manages sessions |
| `src/main/registerIpc.ts` | **Modify** — wire CHAT_GET_MODE, CHAT_SET_MODE, add claude_terminal branch in CHAT_SEND |
| `src/main/registerTerminalIpc.ts` | **Modify** — remove no-op stub comment (line 48-49) |
| `tests/main/claudeCodeClient.test.ts` | **Create** — unit tests for the client |

---

## Task 1: Create `claudeCodeClient.ts` with session management

**Files:**
- Create: `src/main/claudeCodeClient.ts`
- Test: `tests/main/claudeCodeClient.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/claudeCodeClient.test.ts`:

```typescript
// tests/main/claudeCodeClient.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock child_process.spawn
const mockStdout = new EventEmitter() as any;
const mockStderr = new EventEmitter() as any;
const mockChild = new EventEmitter() as any;
mockChild.stdout = mockStdout;
mockChild.stderr = mockStderr;

vi.mock('child_process', () => ({
  spawn: vi.fn(() => mockChild),
}));

import { spawn } from 'child_process';
import { runClaudeCode, clearSessions } from '../../src/main/claudeCodeClient';

beforeEach(() => {
  clearSessions();
  vi.clearAllMocks();
  // Re-attach mocks after clear
  (spawn as any).mockReturnValue(mockChild);
});

describe('runClaudeCode', () => {
  it('spawns claude with required flags', async () => {
    const promise = runClaudeCode({ conversationId: 'conv-1', prompt: 'hello', onText: () => {} });
    mockStdout.emit('data', Buffer.from(''));
    mockChild.emit('close', 0);
    await promise;

    expect(spawn).toHaveBeenCalledWith(
      expect.stringContaining('claude'),
      expect.arrayContaining([
        '--print',
        '--dangerously-skip-permissions',
        '--output-format', 'stream-json',
        '--include-partial-messages',
        'hello',
      ]),
      expect.any(Object),
    );
  });

  it('calls onText for each assistant text chunk', async () => {
    const chunks: string[] = [];
    const promise = runClaudeCode({
      conversationId: 'conv-1',
      prompt: 'hello',
      onText: (t) => chunks.push(t),
    });

    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hi there' }], stop_reason: 'end_turn' },
    });
    mockStdout.emit('data', Buffer.from(line + '\n'));
    mockChild.emit('close', 0);
    await promise;

    expect(chunks).toContain('Hi there');
  });

  it('stores session_id and passes --resume on second call', async () => {
    // First call — no resume
    const p1 = runClaudeCode({ conversationId: 'conv-1', prompt: 'first', onText: () => {} });
    const resultLine = JSON.stringify({ type: 'result', session_id: 'sess-abc', result: 'done' });
    mockStdout.emit('data', Buffer.from(resultLine + '\n'));
    mockChild.emit('close', 0);
    await p1;

    // Second call — should resume
    const p2 = runClaudeCode({ conversationId: 'conv-1', prompt: 'second', onText: () => {} });
    mockStdout.emit('data', Buffer.from(''));
    mockChild.emit('close', 0);
    await p2;

    const secondCallArgs = (spawn as any).mock.calls[1][1] as string[];
    expect(secondCallArgs).toContain('--resume');
    expect(secondCallArgs).toContain('sess-abc');
  });

  it('does not pass --resume for a new conversationId', async () => {
    const p1 = runClaudeCode({ conversationId: 'conv-1', prompt: 'first', onText: () => {} });
    const resultLine = JSON.stringify({ type: 'result', session_id: 'sess-abc', result: 'done' });
    mockStdout.emit('data', Buffer.from(resultLine + '\n'));
    mockChild.emit('close', 0);
    await p1;

    const p2 = runClaudeCode({ conversationId: 'conv-NEW', prompt: 'hi', onText: () => {} });
    mockStdout.emit('data', Buffer.from(''));
    mockChild.emit('close', 0);
    await p2;

    const secondCallArgs = (spawn as any).mock.calls[1][1] as string[];
    expect(secondCallArgs).not.toContain('--resume');
  });

  it('rejects when claude exits with no output', async () => {
    const promise = runClaudeCode({ conversationId: 'conv-1', prompt: 'hello', onText: () => {} });
    mockChild.emit('close', 1);
    await expect(promise).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd ~/Desktop/clawdia7.0 && npx vitest run tests/main/claudeCodeClient.test.ts 2>&1 | tail -20
```

Expected: FAIL — `claudeCodeClient` module not found.

- [ ] **Step 3: Implement `src/main/claudeCodeClient.ts`**

```typescript
// src/main/claudeCodeClient.ts
/**
 * ClaudeCodeClient — runs the installed `claude` CLI headlessly and streams
 * JSON output back to the caller.
 *
 * Each conversation persists its session_id so subsequent messages use
 * --resume, giving Claude Code memory of prior turns.
 */

import { spawn } from 'child_process';

// In-memory session map: conversationId → claude session_id
const sessions = new Map<string, string>();

export interface RunClaudeCodeOptions {
  conversationId: string;
  prompt: string;
  onText: (delta: string) => void;
}

export interface RunClaudeCodeResult {
  finalText: string;
  sessionId: string | null;
}

/** Exported only for tests — clears the session map. */
export function clearSessions(): void {
  sessions.clear();
}

export function runClaudeCode(options: RunClaudeCodeOptions): Promise<RunClaudeCodeResult> {
  const { conversationId, prompt, onText } = options;
  const claudeBin = process.env.CLAUDE_BIN || 'claude';
  const sessionId = sessions.get(conversationId);

  const args = [
    '--print',
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--include-partial-messages',
  ];

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  args.push(prompt);

  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin, args, {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';
    let finalText = '';
    let resolvedSessionId: string | null = null;
    let stderr = '';

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          continue;
        }

        // Capture session_id wherever it appears
        if (typeof msg.session_id === 'string') {
          resolvedSessionId = msg.session_id;
        }

        if (msg.type === 'assistant') {
          const content = (msg as any).message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block?.type === 'text' && typeof block.text === 'string') {
                finalText += block.text;
                onText(block.text);
              }
            }
          }
        }

        if (msg.type === 'result') {
          if (typeof (msg as any).session_id === 'string') {
            resolvedSessionId = (msg as any).session_id;
          }
          // Fallback: use result text if no assistant message produced text
          if (!finalText.trim() && typeof (msg as any).result === 'string') {
            finalText = (msg as any).result;
            onText(finalText);
          }
        }
      }
    });

    child.on('error', (err: Error) => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });

    child.on('close', (code) => {
      // Flush remaining buffer
      if (buffer.trim()) {
        try {
          const msg = JSON.parse(buffer.trim()) as Record<string, unknown>;
          if (typeof msg.session_id === 'string') resolvedSessionId = msg.session_id;
        } catch { /* ignore */ }
      }

      if (!finalText.trim() && code !== 0) {
        reject(new Error(
          `claude exited with code ${code ?? 'null'} and no output. stderr: ${stderr.slice(0, 300)}`,
        ));
        return;
      }

      if (resolvedSessionId) {
        sessions.set(conversationId, resolvedSessionId);
      }

      resolve({ finalText: finalText.trim(), sessionId: resolvedSessionId });
    });
  });
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd ~/Desktop/clawdia7.0 && npx vitest run tests/main/claudeCodeClient.test.ts 2>&1 | tail -20
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/clawdia7.0 && git add src/main/claudeCodeClient.ts tests/main/claudeCodeClient.test.ts && git commit -m "feat: add ClaudeCodeClient — headless claude subprocess with session persistence"
```

---

## Task 2: Wire CHAT_GET_MODE and CHAT_SET_MODE to the DB

**Files:**
- Modify: `src/main/registerIpc.ts:251-255`

- [ ] **Step 1: Read the current stubs**

Open `src/main/registerIpc.ts` and find lines 251–255:

```typescript
ipcMain.handle(IPC.CHAT_GET_MODE, (_e, _id: string) => ({
  mode: 'chat' as const,
  claudeTerminalStatus: 'idle' as const,
}));
ipcMain.handle(IPC.CHAT_SET_MODE, () => ({ ok: true }));
```

- [ ] **Step 2: Replace both stubs with DB-backed implementations**

Replace those 5 lines with:

```typescript
ipcMain.handle(IPC.CHAT_GET_MODE, (_e, id: string) => {
  const conv = getConversation(id);
  const mode = conv?.mode ?? 'chat';
  return { mode, claudeTerminalStatus: 'idle' as const };
});

ipcMain.handle(IPC.CHAT_SET_MODE, (_e, id: string, mode: string) => {
  if (id) updateConversation(id, { mode });
  return { ok: true, mode };
});
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd ~/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
cd ~/Desktop/clawdia7.0 && git add src/main/registerIpc.ts && git commit -m "fix: wire CHAT_GET_MODE and CHAT_SET_MODE to DB mode column"
```

---

## Task 3: Add `claude_terminal` branch in CHAT_SEND

**Files:**
- Modify: `src/main/registerIpc.ts` — CHAT_SEND handler (~line 258)

- [ ] **Step 1: Add the import for claudeCodeClient at the top of registerIpc.ts**

Find the existing imports block at the top of `src/main/registerIpc.ts` and add:

```typescript
import { runClaudeCode } from './claudeCodeClient';
```

- [ ] **Step 2: Add the claude_terminal branch inside CHAT_SEND**

In `CHAT_SEND`, after `ensureConversation()` and the DB persistence of the user message (around line 293, after the `addMessage` call for the user message), find the `const usePipeline = ...` check. Add a new branch **before** the `usePipeline` check:

```typescript
// ── Claude Code path ──────────────────────────────────────────────────────
const conv = getConversation(id);
if (conv?.mode === 'claude_terminal') {
  try {
    const { finalText } = await runClaudeCode({
      conversationId: id,
      prompt: text,
      onText: (delta) => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_STREAM_TEXT, delta);
      },
    });

    if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_STREAM_END, { ok: true });

    if (finalText) {
      const assistantMsgId = `msg-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const assistantMsgTs = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const assistantMsg: Message = { id: assistantMsgId, role: 'assistant', content: finalText, timestamp: assistantMsgTs };
      const nowStr = new Date().toISOString();
      addMessage({ id: assistantMsgId, conversation_id: id, role: 'assistant', content: JSON.stringify(assistantMsg), created_at: nowStr });
      updateConversation(id, { updated_at: nowStr });
    }

    return { response: finalText };
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message });
    return { response: '', error: err.message };
  }
}
// ── End Claude Code path ──────────────────────────────────────────────────
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd ~/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 4: Run all tests**

```bash
cd ~/Desktop/clawdia7.0 && npx vitest run 2>&1 | tail -20
```

Expected: All existing tests still pass.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/clawdia7.0 && git add src/main/registerIpc.ts && git commit -m "feat: route claude_terminal conversations through ClaudeCodeClient in CHAT_SEND"
```

---

## Task 4: Clean up the stub in registerTerminalIpc.ts

**Files:**
- Modify: `src/main/registerTerminalIpc.ts:48-49`

- [ ] **Step 1: Remove the stub comment and no-op handler**

Find lines 48–49 in `src/main/registerTerminalIpc.ts`:

```typescript
// Stub — Claude Code integration not implemented yet
ipcMain.handle(IPC.TERMINAL_SPAWN_CLAUDE_CODE, () => ({ sessionId: null }));
```

Replace with nothing — delete both lines entirely. The `TERMINAL_SPAWN_CLAUDE_CODE` channel is no longer needed since the integration runs through `CHAT_SEND`.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd ~/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -30
```

Expected: No errors. If `TERMINAL_SPAWN_CLAUDE_CODE` is referenced elsewhere causing an error, check `src/main/preload.ts` and remove any corresponding `ipcRenderer.invoke` for that channel.

- [ ] **Step 3: Run all tests**

```bash
cd ~/Desktop/clawdia7.0 && npx vitest run 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
cd ~/Desktop/clawdia7.0 && git add src/main/registerTerminalIpc.ts && git commit -m "chore: remove TERMINAL_SPAWN_CLAUDE_CODE stub — integration now in CHAT_SEND"
```

---

## Task 5: Manual smoke test

- [ ] **Step 1: Build and launch the app**

```bash
cd ~/Desktop/clawdia7.0 && npm run dev 2>&1 &
```

- [ ] **Step 2: Toggle to claude_terminal mode**

In the chat panel, click the Text/Claude mode button (the toggle in `InputBar`). The button should switch state.

- [ ] **Step 3: Send a simple message**

Type: `what is 2 + 2` and send. Expected: response streams into the chat panel from `claude`, not from the normal model.

- [ ] **Step 4: Send a follow-up message**

Type: `what did i just ask you?` — Claude Code should remember the prior message via `--resume`.

- [ ] **Step 5: Toggle back to chat mode**

Click the button again. Send a message. Expected: normal model responds, not claude CLI.

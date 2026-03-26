# PTY Terminal Implementation Design

## Goal

Port a fully functional PTY terminal from clawdia5.0 into clawdia7.0, with real shell process management, session ownership semantics, live AI command streaming, and user takeover support.

## Architecture

Three new files, four modified files. The existing `TerminalPanel.tsx`, IPC channel definitions, and preload API shape are **untouched** — they already expect this exact interface.

**New files:**
- `src/main/core/terminal/types.ts` — shared types
- `src/main/core/terminal/TerminalSessionController.ts` — PTY lifecycle and session management
- `src/main/registerTerminalIpc.ts` — IPC handler registration and event forwarding

**Modified files:**
- `package.json` — add `node-pty`
- `src/main/main.ts` — instantiate TerminalSessionController, call registerTerminalIpc
- `src/main/registerIpc.ts` — import and call registerTerminalIpc
- `src/main/preload.ts` — replace all terminal stubs with real ipcRenderer.invoke calls

---

## Types (`src/main/core/terminal/types.ts`)

```typescript
export type SessionOwner = 'user' | 'clawdia_agent' | 'system';
export type SessionMode = 'user_owned' | 'agent_owned' | 'observe_only' | 'handoff_pending';
export type TerminalWriteSource = 'user' | 'clawdia_agent' | 'system';

export interface TerminalSessionState {
  sessionId: string;
  owner: SessionOwner;
  mode: SessionMode;
  connected: boolean;
  agentControlled: boolean;
  runId: string | null;
  conversationId: string | null;
  exitCode: number | null;
  signal?: number;
  output: string;
}

export interface SpawnOpts {
  cols?: number;
  rows?: number;
  cwd?: string;
  shell?: string;
}

export interface WriteMeta {
  source?: TerminalWriteSource;
  conversationId?: string;
  runId?: string;
}

export interface AcquireMeta {
  runId?: string;
  conversationId?: string;
  executorMode?: string;
}
```

---

## TerminalSessionController (`src/main/core/terminal/TerminalSessionController.ts`)

Manages a `Map<string, LiveSession | ArchivedSession>` where sessions have full state.

### Constants
- `DEFAULT_SHELL = process.env.SHELL || '/bin/bash'`
- `DEFAULT_CWD = os.homedir()`
- `DEFAULT_COLS = 120`, `DEFAULT_ROWS = 30`
- `MAX_OUTPUT_BUFFER = 256 * 1024` (256KB)

### Methods

| Method | Description |
|--------|-------------|
| `isAvailable()` | Returns true if node-pty loaded successfully |
| `spawn(id, opts?)` | Creates PTY process, wires onData/onExit, emits sessionState |
| `write(id, data, meta?)` | Enforces access control, forwards to proc.write() |
| `resize(id, cols, rows)` | Calls proc.resize() |
| `kill(id)` | Kills PTY, archives session, emits exit + sessionState |
| `list()` | Returns array of all session snapshots |
| `getSnapshot(id)` | Returns serializable TerminalSessionState |
| `acquire(id, owner, meta?)` | Transfers ownership to agent, mode → agent_owned |
| `release(id)` | Returns ownership to user, mode → user_owned |
| `requestTakeover(id, requester)` | Sets mode → handoff_pending, emits sessionState |
| `appendOutput(id, data)` | Writes to buffer + emits TERMINAL_DATA (no PTY required) |

### Access Control
`write()` checks: if mode is `agent_owned` and source is `user`, reject. If mode is `observe_only`, reject all writes. Only the current owner can write.

### Events
- `data` — `{ id: string, data: string }`
- `exit` — `{ id: string, code: number, signal?: number }`
- `sessionState` — `TerminalSessionState`

Node-pty is loaded with `require('node-pty')` inside a try/catch. If it fails to load (e.g., native module not rebuilt), `isAvailable()` returns false and all spawns return null gracefully.

---

## IPC Registration (`src/main/registerTerminalIpc.ts`)

```typescript
export function registerTerminalIpc(
  controller: TerminalSessionController,
  win: BrowserWindow
): void {
  ipcMain.handle(IPC.TERMINAL_IS_AVAILABLE, () => controller.isAvailable())
  ipcMain.handle(IPC.TERMINAL_SPAWN, (_, id, opts) => controller.spawn(id, opts))
  ipcMain.handle(IPC.TERMINAL_WRITE, (_, id, data, meta) => controller.write(id, data, meta))
  ipcMain.handle(IPC.TERMINAL_RESIZE, (_, id, cols, rows) => controller.resize(id, cols, rows))
  ipcMain.handle(IPC.TERMINAL_KILL, (_, id) => controller.kill(id))
  ipcMain.handle(IPC.TERMINAL_LIST, () => controller.list())
  ipcMain.handle(IPC.TERMINAL_GET_SNAPSHOT, (_, id) => controller.getSnapshot(id))
  ipcMain.handle(IPC.TERMINAL_ACQUIRE, (_, id, owner, meta) => controller.acquire(id, owner, meta))
  ipcMain.handle(IPC.TERMINAL_RELEASE, (_, id) => controller.release(id))
  ipcMain.handle(IPC.TERMINAL_REQUEST_TAKEOVER, (_, id, req) => controller.requestTakeover(id, req))
  ipcMain.handle(IPC.TERMINAL_SPAWN_CLAUDE_CODE, () => ({ sessionId: null }))

  const send = (ch: string, p: unknown) => {
    if (!win.isDestroyed()) win.webContents.send(ch, p)
  }
  controller.on('data', p => send(IPC_EVENTS.TERMINAL_DATA, p))
  controller.on('exit', p => send(IPC_EVENTS.TERMINAL_EXIT, p))
  controller.on('sessionState', p => send(IPC_EVENTS.TERMINAL_SESSION_STATE, p))
}
```

---

## Preload Changes (`src/main/preload.ts`)

Replace all 10 terminal stubs with real calls using the existing `subscribe` helper:

```typescript
terminal: {
  isAvailable: () => ipcRenderer.invoke(IPC.TERMINAL_IS_AVAILABLE),
  spawn: (id, opts) => ipcRenderer.invoke(IPC.TERMINAL_SPAWN, id, opts),
  write: (id, data, meta) => ipcRenderer.invoke(IPC.TERMINAL_WRITE, id, data, meta),
  resize: (id, cols, rows) => ipcRenderer.invoke(IPC.TERMINAL_RESIZE, id, cols, rows),
  kill: (id) => ipcRenderer.invoke(IPC.TERMINAL_KILL, id),
  list: () => ipcRenderer.invoke(IPC.TERMINAL_LIST),
  getSnapshot: (id) => ipcRenderer.invoke(IPC.TERMINAL_GET_SNAPSHOT, id),
  acquire: (id, owner, meta) => ipcRenderer.invoke(IPC.TERMINAL_ACQUIRE, id, owner, meta),
  release: (id) => ipcRenderer.invoke(IPC.TERMINAL_RELEASE, id),
  requestTakeover: (id, req) => ipcRenderer.invoke(IPC.TERMINAL_REQUEST_TAKEOVER, id, req),
  onData: subscribe(IPC_EVENTS.TERMINAL_DATA),
  onExit: subscribe(IPC_EVENTS.TERMINAL_EXIT),
  onEvent: subscribe(IPC_EVENTS.TERMINAL_EVENT),
  onSessionState: subscribe(IPC_EVENTS.TERMINAL_SESSION_STATE),
}
```

---

## Data Flows

### User typing in terminal
```
TerminalPanel.term.onData
  → api.terminal.write(id, data, { source: 'user' })
  → IPC → controller.write() → proc.write() → PTY
  → proc.onData → emit 'data' → TERMINAL_DATA
  → TerminalPanel.term.write(data)
```

### AI acquiring terminal and streaming output
```
controller.acquire(id, 'clawdia_agent', { runId, conversationId })
  → mode = 'agent_owned' → emit sessionState
  → TerminalPanel disables input, shows "Agent running" badge

controller.appendOutput(id, chunk)
  → buffer += chunk → emit 'data' → TERMINAL_DATA
  → TerminalPanel.term.write(chunk)  [user sees live]

controller.release(id)
  → mode = 'user_owned' → emit sessionState
  → TerminalPanel re-enables input
```

### User requesting takeover
```
User clicks "Request takeover" in TerminalPanel
  → api.terminal.requestTakeover(id, 'user')
  → controller: mode = 'handoff_pending' → emit sessionState
  → TerminalPanel shows pending state
  → AI checks mode before next write, sees handoff_pending, calls release()
  → mode = 'user_owned' → user gets control
```

---

## Coexistence with shell_exec

`shell_exec` in `shellTools.ts` is **unchanged**. It continues running silently and returning results to the AI chat loop. The PTY terminal is a separate, opt-in visible session. No changes to `anthropicChat.ts`, `geminiChat.ts`, or `openaiChat.ts`.

---

## Error Handling

- node-pty load failure: caught in try/catch at module load time; `isAvailable()` returns false; `spawn()` returns null; TerminalPanel shows "Terminal not available"
- PTY process crash: `onExit` fires, session archived, `exitCode` stored, UI shows exit code
- Write to dead session: checked before `proc.write()`, returns false gracefully
- Output buffer overflow: oldest content trimmed when buffer exceeds 256KB

---

## Tech Stack

- `node-pty` ^1.1.0 — native PTY spawning
- `xterm` ^5.3.0 — already installed, terminal renderer
- `@xterm/addon-fit` ^0.11.0 — already installed, auto-sizing
- Electron EventEmitter — session event bus
- TypeScript strict mode — matches existing codebase config

# Multi-Tab Split Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-session `TerminalPanel.tsx` with a multi-tab, vertically-split terminal panel where every pane is a fully independent PTY session.

**Architecture:** All changes are confined to `src/renderer/components/TerminalPanel.tsx`, which is rewritten as a container component owning tab/split state. The file also contains three co-located sub-components: `TerminalTabBar`, `TerminalPane`, and `TerminalSplitContainer`. No main-process or IPC files are touched — the backend already supports multiple named sessions.

**Tech Stack:** React 19, xterm.js v5.3.0, @xterm/addon-fit, TypeScript, Tailwind CSS (existing patterns), `window.clawdia.terminal` preload API.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/renderer/components/TerminalPanel.tsx` | **Full rewrite** | Container + all sub-components (TerminalTabBar, TerminalPane, TerminalSplitContainer) |

No other files change.

---

## Preload API Reference (do not change these files)

```typescript
// window.clawdia.terminal
api.terminal.isAvailable(): Promise<boolean>
api.terminal.spawn(id: string, opts?: { cols?: number; rows?: number }): Promise<{ id: string } | null>
api.terminal.write(id: string, data: string, meta?: { source?: string; conversationId?: string }): Promise<void>
api.terminal.resize(id: string, cols: number, rows: number): Promise<void>
api.terminal.kill(id: string): Promise<void>
api.terminal.getSnapshot(id: string): Promise<TerminalSessionState | null>
api.terminal.acquire(id: string, owner: string, meta?: any): Promise<void>
api.terminal.release(id: string): Promise<void>
api.terminal.requestTakeover(id: string, requester: string): Promise<boolean>
api.terminal.onData(cb: (payload: { id: string; data: string }) => void): () => void
api.terminal.onExit(cb: (payload: { id: string; code: number; signal?: number }) => void): () => void
api.terminal.onSessionState(cb: (payload: any) => void): () => void
```

`TerminalSessionState` shape (from main process types):
```typescript
interface TerminalSessionState {
  sessionId: string;
  owner: 'user' | 'clawdia_agent' | 'system';
  mode: 'user_owned' | 'agent_owned' | 'observe_only' | 'handoff_pending';
  connected: boolean;
  agentControlled: boolean;
  runId: string | null;
  conversationId: string | null;
  exitCode: number | null;
  signal?: number;
  output: string;
}
```

---

## Task 1: Scaffold the new TerminalPanel with one tab (no split yet)

**Files:**
- Modify: `src/renderer/components/TerminalPanel.tsx`

This task replaces the current file with the new container + types + TerminalTabBar stub. No xterm logic yet — just the state shape and tab bar UI. After this task the panel renders a tab bar with one tab and a placeholder area where the terminal will go.

- [ ] **Step 1: Replace TerminalPanel.tsx with the new scaffold**

```tsx
import React, { useState } from 'react';
import 'xterm/css/xterm.css';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TerminalTab {
  id: string;        // unique UI identifier
  sessionId: string; // PTY session ID sent to backend
  title: string;     // display label e.g. "Terminal 1"
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTab(index: number): TerminalTab {
  const ts = Date.now();
  return {
    id: `tab-${ts}`,
    sessionId: `terminal-tab-${ts}`,
    title: `Terminal ${index}`,
  };
}

// ─── TerminalTabBar ───────────────────────────────────────────────────────────

interface TerminalTabBarProps {
  tabs: TerminalTab[];
  activeTabId: string;
  splitActive: boolean;
  splitIsObserving: boolean;
  onSelectTab: (id: string) => void;
  onAddTab: () => void;
  onCloseTab: (id: string) => void;
  onToggleSplit: () => void;
  onToggleObserve: () => void;
}

function TerminalTabBar({
  tabs,
  activeTabId,
  splitActive,
  splitIsObserving,
  onSelectTab,
  onAddTab,
  onCloseTab,
  onToggleSplit,
  onToggleObserve,
}: TerminalTabBarProps) {
  return (
    <div className="flex h-9 flex-shrink-0 items-center border-b border-white/[0.06] bg-[#0d0d10] px-2 gap-1">
      {/* Tab pills */}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          onClick={() => onSelectTab(tab.id)}
          className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium cursor-pointer select-none transition-colors ${
            tab.id === activeTabId
              ? 'bg-white/[0.10] text-text-primary'
              : 'text-text-secondary hover:bg-white/[0.06] hover:text-text-primary'
          }`}
        >
          <span>{tab.title}</span>
          {tabs.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              className="ml-1 rounded p-0.5 hover:bg-white/[0.12] text-text-secondary hover:text-text-primary leading-none"
              title="Close tab"
            >
              ×
            </button>
          )}
        </div>
      ))}

      {/* Add tab */}
      <button
        onClick={onAddTab}
        className="rounded px-1.5 py-1 text-[13px] leading-none text-text-secondary hover:bg-white/[0.06] hover:text-text-primary transition-colors"
        title="New terminal tab"
      >
        +
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Observe button — only when split active */}
      {splitActive && (
        <button
          onClick={onToggleObserve}
          className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
            splitIsObserving
              ? 'bg-sky-400/20 text-sky-300'
              : 'text-text-secondary hover:bg-white/[0.06] hover:text-text-primary'
          }`}
          title={splitIsObserving ? 'Stop observing — switch to independent shell' : 'Observe active tab session (read-only)'}
        >
          {splitIsObserving ? 'Observing' : 'Observe'}
        </button>
      )}

      {/* Split toggle */}
      <button
        onClick={onToggleSplit}
        className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
          splitActive
            ? 'bg-white/[0.10] text-text-primary'
            : 'text-text-secondary hover:bg-white/[0.06] hover:text-text-primary'
        }`}
        title={splitActive ? 'Close split pane' : 'Split terminal (top/bottom)'}
      >
        {splitActive ? '⊟ Split' : '⊟ Split'}
      </button>
    </div>
  );
}

// ─── TerminalPanel (container) ────────────────────────────────────────────────

interface TerminalPanelProps {
  visible: boolean;
  conversationId?: string | null;
}

export default function TerminalPanel({ visible, conversationId }: TerminalPanelProps) {
  const api = window.clawdia;

  const [tabs, setTabs] = useState<TerminalTab[]>(() => [makeTab(1)]);
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    const first = makeTab(1);
    return first.id; // will be overwritten below — tabs initializer runs first
  });
  const [splitSessionId, setSplitSessionId] = useState<string | null>(null);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [splitIsObserving, setSplitIsObserving] = useState(false);

  // Sync activeTabId to first tab on mount
  React.useEffect(() => {
    setActiveTabId(tabs[0].id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  const handleAddTab = () => {
    const tab = makeTab(tabs.length + 1);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  };

  const handleCloseTab = (id: string) => {
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex((t) => t.id === id);
    const tab = tabs[idx];
    void api?.terminal?.kill(tab.sessionId);
    const next = tabs[idx + 1] ?? tabs[idx - 1];
    setTabs((prev) => prev.filter((t) => t.id !== id));
    if (id === activeTabId) setActiveTabId(next.id);
    // Close split if it was observing the closed tab
    if (splitIsObserving && id === activeTabId) {
      setSplitSessionId(null);
      setSplitIsObserving(false);
    }
  };

  const handleToggleSplit = () => {
    if (splitSessionId !== null) {
      void api?.terminal?.kill(splitSessionId);
      setSplitSessionId(null);
      setSplitIsObserving(false);
    } else {
      const newId = `terminal-split-${Date.now()}`;
      setSplitSessionId(newId);
      setSplitRatio(0.5);
      setSplitIsObserving(false);
    }
  };

  const handleToggleObserve = () => {
    if (splitIsObserving) {
      // Revert to independent shell
      const newId = `terminal-split-${Date.now()}`;
      setSplitSessionId(newId);
      setSplitIsObserving(false);
    } else {
      // Kill the current split session, switch to observe mode (no PTY)
      if (splitSessionId) void api?.terminal?.kill(splitSessionId);
      setSplitSessionId(activeTab.sessionId); // observe the active tab
      setSplitIsObserving(true);
    }
  };

  if (!visible) return null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#0d0d10]">
      <TerminalTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        splitActive={splitSessionId !== null}
        splitIsObserving={splitIsObserving}
        onSelectTab={setActiveTabId}
        onAddTab={handleAddTab}
        onCloseTab={handleCloseTab}
        onToggleSplit={handleToggleSplit}
        onToggleObserve={handleToggleObserve}
      />
      {/* Terminal content placeholder — replaced in Task 2 */}
      <div className="flex flex-1 items-center justify-center text-text-secondary text-xs">
        Terminal pane coming in Task 2
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the app renders without errors**

Start the app (or hot-reload if already running) and open the terminal pane. You should see:
- A tab bar with "Terminal 1" tab
- A + button and a "⊟ Split" button
- A placeholder text area below

No console errors expected.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/TerminalPanel.tsx
git commit -m "feat(terminal): scaffold multi-tab container with TerminalTabBar"
```

---

## Task 2: Implement TerminalPane — the xterm.js pane

**Files:**
- Modify: `src/renderer/components/TerminalPanel.tsx`

This task adds the `TerminalPane` component — extracted from the original `TerminalPanel.tsx`. It owns one xterm.js instance for one `sessionId`. It spawns the PTY on mount and cleans up on unmount. It also renders the status header bar (ownership badge, agent indicator, restart/takeover buttons).

- [ ] **Step 1: Add constants and the sliceRecentOutput helper above TerminalTabBar**

Insert this block immediately after the `import` statements and before the `TerminalTab` interface:

```tsx
const TERMINAL_THEME = {
  background: '#0d0d10',
  foreground: '#e4e4e7',
  cursor: '#e4e4e7',
  cursorAccent: '#0d0d10',
  selectionBackground: '#ffffff30',
  selectionForeground: undefined,
  black: '#1a1a2e',
  red: '#ff6b6b',
  green: '#69db7c',
  yellow: '#ffd43b',
  blue: '#74c0fc',
  magenta: '#da77f2',
  cyan: '#66d9e8',
  white: '#e4e4e7',
  brightBlack: '#4a4a5a',
  brightRed: '#ff8787',
  brightGreen: '#8ce99a',
  brightYellow: '#ffe066',
  brightBlue: '#a5d8ff',
  brightMagenta: '#e599f7',
  brightCyan: '#99e9f2',
  brightWhite: '#ffffff',
};

const MAX_HYDRATE_CHARS = 64_000;

type XTermTerminal = import('xterm').Terminal;
type FitAddon = import('@xterm/addon-fit').FitAddon;

function sliceRecentOutput(output: string): string {
  if (!output || output.length <= MAX_HYDRATE_CHARS) return output;
  const sliced = output.slice(-MAX_HYDRATE_CHARS);
  const newlineIdx = sliced.indexOf('\n');
  return newlineIdx >= 0 ? sliced.slice(newlineIdx + 1) : sliced;
}
```

- [ ] **Step 2: Add the TerminalPane component after the sliceRecentOutput helper, before TerminalTabBar**

```tsx
interface TerminalPaneProps {
  sessionId: string;
  conversationId?: string | null;
  isObserving?: boolean; // read-only observe mode — no PTY spawn
  onSpawnError?: (sessionId: string) => void;
}

function TerminalPane({ sessionId, conversationId, isObserving = false, onSpawnError }: TerminalPaneProps) {
  const api = window.clawdia;
  const containerRef = React.useRef<HTMLDivElement>(null);
  const termRef = React.useRef<XTermTerminal | null>(null);
  const fitAddonRef = React.useRef<FitAddon | null>(null);
  const cleanupRef = React.useRef<(() => void) | null>(null);
  const sessionModeRef = React.useRef<string>('user_owned');

  const [isConnected, setIsConnected] = React.useState(false);
  const [spawnError, setSpawnError] = React.useState(false);
  const [agentControlled, setAgentControlled] = React.useState(false);
  const [sessionOwner, setSessionOwner] = React.useState<string>('user');
  const [sessionMode, setSessionMode] = React.useState<string>('user_owned');
  const [activeRun, setActiveRun] = React.useState<string | null>(null);
  const [takeoverRequestedBy, setTakeoverRequestedBy] = React.useState<string | null>(null);

  React.useEffect(() => {
    sessionModeRef.current = sessionMode;
  }, [sessionMode]);

  React.useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    cleanupRef.current?.();
    cleanupRef.current = null;
    termRef.current = null;
    fitAddonRef.current = null;

    const init = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (disposed || !containerRef.current) return;

      const term = new Terminal({
        theme: TERMINAL_THEME,
        fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", "Cascadia Code", Menlo, monospace',
        fontSize: 13,
        lineHeight: 1.4,
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: 10_000,
        allowTransparency: true,
        macOptionIsMeta: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      termRef.current = term;
      fitAddonRef.current = fitAddon;

      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();

      // Observe mode: just attach to events, no spawn
      if (isObserving) {
        const snapshot = await api.terminal.getSnapshot(sessionId).catch(() => null);
        if (snapshot?.output) term.write(sliceRecentOutput(snapshot.output));
        setIsConnected(!!snapshot?.connected);
      } else {
        // Spawn the PTY
        let result: { id: string } | null = null;
        try {
          const snapshot = await api.terminal.getSnapshot(sessionId).catch(() => null);
          if (snapshot?.connected) {
            result = { id: sessionId };
            if (snapshot.output) term.write(sliceRecentOutput(snapshot.output));
          } else {
            result = await api.terminal.spawn(sessionId, dims ? { cols: dims.cols, rows: dims.rows } : undefined);
          }
        } catch {
          result = null;
        }

        if (!result) {
          setSpawnError(true);
          onSpawnError?.(sessionId);
          term.writeln('\r\n\x1b[31m[Failed to start terminal session. Click Retry.]\x1b[0m');
          return;
        }

        const snapshot = await api.terminal.getSnapshot(sessionId).catch(() => null);
        if (snapshot?.output) term.write(sliceRecentOutput(snapshot.output));
        setIsConnected(!!snapshot?.connected);
        setAgentControlled(!!snapshot?.agentControlled);
        setSessionOwner(snapshot?.owner ?? 'user');
        setSessionMode(snapshot?.mode ?? 'user_owned');
        setActiveRun(snapshot?.runId ?? null);
        setTakeoverRequestedBy(null);
      }

      // Wire input (disabled in observe or agent_owned/handoff modes)
      const inputDisposable = term.onData((data: string) => {
        if (isObserving) return;
        const mode = sessionModeRef.current;
        if (mode === 'agent_owned' || mode === 'observe_only' || mode === 'handoff_pending') return;
        void api.terminal.write(sessionId, data, { source: 'user', conversationId: conversationId ?? undefined });
      });

      // Data stream
      const unsubData = api.terminal.onData((payload) => {
        if (payload.id !== sessionId || !termRef.current) return;
        termRef.current.write(payload.data);
        setIsConnected(true);
      });

      // Exit event
      const unsubExit = api.terminal.onExit((payload) => {
        if (payload.id !== sessionId || !termRef.current) return;
        termRef.current.writeln(`\r\n\x1b[90m[Process exited with code ${payload.code}]\x1b[0m`);
        setIsConnected(false);
        setAgentControlled(false);
        requestAnimationFrame(() => termRef.current?.scrollToBottom());
      });

      // Session state
      const unsubSessionState = api.terminal.onSessionState((payload: any) => {
        if (payload.id !== sessionId && payload.sessionId !== sessionId) return;
        setIsConnected(payload.connected);
        setAgentControlled(!!payload.agentControlled);
        setSessionOwner(payload.owner ?? 'user');
        setSessionMode(payload.mode ?? 'user_owned');
        setActiveRun(payload.runId ?? null);
        setTakeoverRequestedBy(payload.takeoverRequestedBy ?? null);
      });

      // Resize observer
      let resizeRaf: number | null = null;
      const resizeHandler = () => {
        if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = null;
          if (!fitAddonRef.current) return;
          fitAddonRef.current.fit();
          const nextDims = fitAddonRef.current.proposeDimensions();
          if (nextDims) void api.terminal.resize(sessionId, nextDims.cols, nextDims.rows);
          termRef.current?.scrollToBottom();
        });
      };

      const resizeObserver = new ResizeObserver(resizeHandler);
      resizeObserver.observe(containerRef.current!);
      requestAnimationFrame(() => { resizeHandler(); term.scrollToBottom(); });

      cleanupRef.current = () => {
        inputDisposable.dispose();
        unsubData();
        unsubExit();
        unsubSessionState();
        if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
        resizeObserver.disconnect();
        term.dispose();
        termRef.current = null;
        fitAddonRef.current = null;
      };
    };

    void init();

    return () => {
      disposed = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  // Re-run only when sessionId or observing mode changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, isObserving]);

  const handleRestart = React.useCallback(async () => {
    setSpawnError(false);
    await api?.terminal?.kill(sessionId);
    setIsConnected(false);
    setAgentControlled(false);
    setSessionOwner('user');
    setSessionMode('user_owned');
    setActiveRun(null);
    setTakeoverRequestedBy(null);
    if (termRef.current) {
      termRef.current.clear();
      termRef.current.writeln('\x1b[90m[Restarting terminal...]\x1b[0m\r\n');
    }
    const dims = fitAddonRef.current?.proposeDimensions();
    const result = await api?.terminal?.spawn(sessionId, dims ? { cols: dims.cols, rows: dims.rows } : undefined);
    if (result) setIsConnected(true);
    else setSpawnError(true);
  }, [api, sessionId]);

  const handleRequestTakeover = React.useCallback(async () => {
    if (!api?.terminal) return;
    const ok = await api.terminal.requestTakeover(sessionId, 'user');
    if (ok) {
      const approved = window.confirm('Request terminal takeover from the running agent?');
      if (approved) {
        await api.terminal.acquire(sessionId, 'user', { mode: 'user_owned', conversationId: conversationId ?? undefined });
      }
    }
  }, [api, conversationId, sessionId]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-h-0">
      {/* Status bar */}
      <div className="flex h-7 flex-shrink-0 items-center justify-between border-b border-white/[0.04] bg-[#0d0d10] px-3">
        <div className="flex items-center gap-2">
          {isConnected && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" title="Connected" />}
          {isObserving && (
            <span className="rounded bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">Observe</span>
          )}
          {agentControlled && (
            <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400/80">Agent running</span>
          )}
          {sessionOwner !== 'user' && (
            <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">{sessionOwner}</span>
          )}
          {activeRun && (
            <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
              run {activeRun.slice(0, 8)}
            </span>
          )}
          {takeoverRequestedBy && (
            <span className="rounded bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
              takeover requested by {takeoverRequestedBy}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {sessionMode === 'agent_owned' && !isObserving && (
            <button
              onClick={handleRequestTakeover}
              className="rounded px-2 py-1 text-[10px] font-medium text-sky-200 transition-colors hover:bg-sky-400/10"
              title="Request terminal takeover"
            >
              Request takeover
            </button>
          )}
          {!isObserving && (
            <button
              onClick={handleRestart}
              className="rounded p-1 text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-text-primary"
              title="Restart terminal"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 2v6h-6" />
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M3 22v-6h6" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Input disabled overlay */}
      {(sessionMode === 'agent_owned' || sessionMode === 'handoff_pending' || sessionMode === 'observe_only' || isObserving) && (
        <div className="pointer-events-none absolute inset-x-0 z-10 border-b border-white/[0.06] bg-[#0d0d10]/90 px-3 py-1.5 text-[11px] text-text-secondary">
          {isObserving
            ? 'Observe only — input disabled.'
            : sessionMode === 'agent_owned'
              ? 'Agent running. Terminal input is disabled.'
              : sessionMode === 'handoff_pending'
                ? 'Takeover pending. Terminal input is paused.'
                : 'Observe only.'}
        </div>
      )}

      {/* xterm container */}
      <div className="relative flex-1 overflow-hidden min-h-0">
        <div ref={containerRef} style={{ width: '100%', height: '100%', padding: '4px 0 0 8px' }} />
      </div>

      {/* Spawn error retry */}
      {spawnError && (
        <div className="flex items-center justify-center gap-3 border-t border-white/[0.06] py-2">
          <span className="text-[11px] text-red-400/80">Failed to start terminal session.</span>
          <button
            onClick={handleRestart}
            className="rounded px-2 py-1 text-[10px] font-medium text-text-primary bg-white/[0.06] hover:bg-white/[0.12] transition-colors"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Replace the placeholder div in TerminalPanel with a single TerminalPane**

In the `TerminalPanel` return, replace the placeholder `<div>` with:

```tsx
<div className="flex flex-1 flex-col overflow-hidden min-h-0">
  <TerminalPane
    sessionId={activeTab.sessionId}
    conversationId={conversationId}
  />
</div>
```

- [ ] **Step 4: Verify single-tab terminal works**

Open the terminal pane. You should see:
- Tab bar with "Terminal 1"
- A working shell (bash) below the tab bar
- Typing works, output renders, the connection dot is green
- No console errors

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/TerminalPanel.tsx
git commit -m "feat(terminal): implement TerminalPane with xterm.js and PTY lifecycle"
```

---

## Task 3: Add isAvailable guard and wire multiple tabs

**Files:**
- Modify: `src/renderer/components/TerminalPanel.tsx`

This task adds the `node-pty` availability check (if node-pty isn't loaded, show "Terminal Unavailable") and verifies that adding tabs actually spawns independent sessions.

- [ ] **Step 1: Add isAvailable state and check to TerminalPanel**

Add to `TerminalPanel` component state, after the `splitIsObserving` state:

```tsx
const [isAvailable, setIsAvailable] = React.useState<boolean | null>(null);

React.useEffect(() => {
  let cancelled = false;
  api?.terminal?.isAvailable()
    .then((available) => { if (!cancelled) setIsAvailable(available); })
    .catch(() => { if (!cancelled) setIsAvailable(false); });
  return () => { cancelled = true; };
}, [api]);
```

- [ ] **Step 2: Add early return for unavailable state in TerminalPanel**

Add this block immediately before the `if (!visible) return null;` guard:

```tsx
if (isAvailable === false) {
  return (
    <div className={`flex flex-1 items-center justify-center bg-[#0d0d10] text-text-secondary ${visible ? '' : 'hidden'}`}>
      <div className="space-y-2 text-center">
        <div className="text-sm font-medium text-text-primary">Terminal Unavailable</div>
        <div className="max-w-xs text-xs">
          `node-pty` is not installed or failed to load. Run `npm install` and rebuild Electron native modules.
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify tab switching spawns independent sessions**

Open the terminal pane:
1. In Terminal 1, run `echo "hello from tab 1"`
2. Click "+" to open Terminal 2
3. In Terminal 2, run `echo "hello from tab 2"`
4. Switch back to Terminal 1 — its shell is still alive and shows its own output
5. Switch back to Terminal 2 — its shell is still alive with its own history

Each tab should have a fully independent PTY. No output should bleed between tabs.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/TerminalPanel.tsx
git commit -m "feat(terminal): add isAvailable guard and multi-tab independent PTY sessions"
```

---

## Task 4: Implement TerminalSplitContainer with draggable divider

**Files:**
- Modify: `src/renderer/components/TerminalPanel.tsx`

This task adds the split-pane layout. Add the `TerminalSplitContainer` component and wire it into `TerminalPanel`.

- [ ] **Step 1: Add TerminalSplitContainer component before TerminalPanel**

```tsx
interface TerminalSplitContainerProps {
  topSessionId: string;
  bottomSessionId: string | null; // null = no split
  splitRatio: number;             // 0.0–1.0
  splitIsObserving: boolean;
  conversationId?: string | null;
  onSplitRatioChange: (ratio: number) => void;
}

const MIN_PANE_PX = 80;

function TerminalSplitContainer({
  topSessionId,
  bottomSessionId,
  splitRatio,
  splitIsObserving,
  conversationId,
  onSplitRatioChange,
}: TerminalSplitContainerProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const isDragging = React.useRef(false);

  const handleDividerMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const totalHeight = rect.height;
      const offsetY = ev.clientY - rect.top;
      const minRatio = MIN_PANE_PX / totalHeight;
      const maxRatio = 1 - MIN_PANE_PX / totalHeight;
      const ratio = Math.min(maxRatio, Math.max(minRatio, offsetY / totalHeight));
      onSplitRatioChange(ratio);
    };

    const onMouseUp = () => {
      isDragging.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [onSplitRatioChange]);

  if (!bottomSessionId) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden min-h-0">
        <TerminalPane sessionId={topSessionId} conversationId={conversationId} />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-1 flex-col overflow-hidden min-h-0">
      {/* Top pane */}
      <div style={{ height: `${splitRatio * 100}%` }} className="flex flex-col overflow-hidden min-h-0">
        <TerminalPane sessionId={topSessionId} conversationId={conversationId} />
      </div>

      {/* Draggable divider */}
      <div
        onMouseDown={handleDividerMouseDown}
        className="flex-shrink-0 h-1 bg-white/[0.08] hover:bg-sky-400/40 cursor-row-resize transition-colors"
        title="Drag to resize"
      />

      {/* Bottom pane */}
      <div style={{ height: `${(1 - splitRatio) * 100}%` }} className="flex flex-col overflow-hidden min-h-0">
        <TerminalPane
          sessionId={bottomSessionId}
          conversationId={conversationId}
          isObserving={splitIsObserving}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace the single TerminalPane in TerminalPanel with TerminalSplitContainer**

In `TerminalPanel`'s return, replace the `<div className="flex flex-1...">` wrapping TerminalPane with:

```tsx
<TerminalSplitContainer
  topSessionId={activeTab.sessionId}
  bottomSessionId={splitSessionId}
  splitRatio={splitRatio}
  splitIsObserving={splitIsObserving}
  conversationId={conversationId}
  onSplitRatioChange={setSplitRatio}
/>
```

- [ ] **Step 3: Verify split works end-to-end**

1. Open the terminal pane
2. Click "⊟ Split" — a second shell appears below, with a divider between them
3. In the top pane, run `echo top` — output appears only in the top pane
4. In the bottom pane, run `echo bottom` — output appears only in the bottom pane
5. Drag the divider up and down — both panes resize smoothly, minimum height respected (neither collapses to zero)
6. Click "⊟ Split" again — bottom pane closes, top pane expands to full height
7. No console errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/TerminalPanel.tsx
git commit -m "feat(terminal): add TerminalSplitContainer with draggable top/bottom divider"
```

---

## Task 5: Wire observe mode and cleanup on unmount

**Files:**
- Modify: `src/renderer/components/TerminalPanel.tsx`

This task validates observe mode and adds the unmount cleanup so all sessions are killed when `TerminalPanel` is hidden/removed.

- [ ] **Step 1: Add unmount cleanup to TerminalPanel**

Add this `useEffect` to `TerminalPanel` (after the `isAvailable` effect):

```tsx
// Kill all sessions when panel unmounts
const tabsRef = React.useRef(tabs);
const splitSessionIdRef = React.useRef(splitSessionId);
React.useEffect(() => { tabsRef.current = tabs; }, [tabs]);
React.useEffect(() => { splitSessionIdRef.current = splitSessionId; }, [splitSessionId]);

React.useEffect(() => {
  return () => {
    tabsRef.current.forEach((tab) => {
      void api?.terminal?.kill(tab.sessionId);
    });
    if (splitSessionIdRef.current) {
      void api?.terminal?.kill(splitSessionIdRef.current);
    }
  };
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [api]);
```

- [ ] **Step 2: Verify observe mode**

1. Open the terminal pane and split it (two independent shells)
2. In the top pane, run `watch date` (or any continuous output command)
3. Click the "Observe" button in the tab bar
4. The bottom pane should now show the same output as the top pane in real-time
5. The bottom pane's status bar shows "Observe" badge
6. Typing in the bottom pane area does nothing (input is disabled)
7. Click "Observing" again — bottom pane reverts to an independent shell, `watch date` no longer appears in it

- [ ] **Step 3: Verify tab close kills session**

1. Add a second tab, run a command in it
2. Close the tab (× button)
3. Open a new terminal to the same session ID — it should not exist (you'd get a fresh shell if spawned again, not the old one)
4. Confirm the first tab's shell is still alive and unaffected

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/TerminalPanel.tsx
git commit -m "feat(terminal): add observe mode wiring and unmount session cleanup"
```

---

## Task 6: Fix tab title numbering and polish

**Files:**
- Modify: `src/renderer/components/TerminalPanel.tsx`

Currently `makeTab` uses `tabs.length + 1` for the title counter which can produce duplicate numbers after closing tabs. This task fixes the counter and polishes the UI edge cases.

- [ ] **Step 1: Add a tab counter ref to TerminalPanel and fix makeTab call**

Replace the `makeTab` helper function with an approach that takes an explicit counter:

```tsx
function makeTab(counter: number): TerminalTab {
  const ts = Date.now();
  return {
    id: `tab-${ts}`,
    sessionId: `terminal-tab-${ts}`,
    title: `Terminal ${counter}`,
  };
}
```

In `TerminalPanel`, add a counter ref after the state declarations:

```tsx
const tabCounterRef = React.useRef(1);
```

Update the `useState` initializer for `tabs` and the `activeTabId` sync to use the counter:

```tsx
const [tabs, setTabs] = useState<TerminalTab[]>(() => {
  const first = makeTab(1);
  return [first];
});
const [activeTabId, setActiveTabId] = useState<string>(() => {
  // re-derive from tabs initial value
  return `tab-${/* we'll fix below */0}`;
});
```

Actually the cleanest fix is to initialize both in one shot:

```tsx
const initialTab = React.useMemo(() => makeTab(1), []);
const [tabs, setTabs] = React.useState<TerminalTab[]>([initialTab]);
const [activeTabId, setActiveTabId] = React.useState<string>(initialTab.id);
const tabCounterRef = React.useRef(2); // next tab will be "Terminal 2"
```

Remove the `useEffect` that was syncing `activeTabId` to `tabs[0].id` (no longer needed).

Update `handleAddTab`:

```tsx
const handleAddTab = () => {
  const tab = makeTab(tabCounterRef.current++);
  setTabs((prev) => [...prev, tab]);
  setActiveTabId(tab.id);
};
```

- [ ] **Step 2: Disable split button when node-pty is unavailable (already handled by isAvailable guard, but verify)**

Confirm that if `isAvailable` is `false`, the unavailable message shows and no tab bar or split controls render.

- [ ] **Step 3: Verify title numbering**

1. Open terminal — "Terminal 1"
2. Add tab — "Terminal 2"
3. Add tab — "Terminal 3"
4. Close "Terminal 2"
5. Add tab — "Terminal 4" (not "Terminal 3" again)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/TerminalPanel.tsx
git commit -m "fix(terminal): stable tab counter, remove stale activeTabId sync effect"
```

---

## Final State — Complete TerminalPanel.tsx

After all tasks, the file contains (in order):
1. Imports
2. `TERMINAL_THEME` constant
3. `MAX_HYDRATE_CHARS` constant + `XTermTerminal`/`FitAddon` type aliases
4. `sliceRecentOutput` helper
5. `TerminalTab` interface
6. `makeTab` helper
7. `TerminalPane` component (xterm.js logic, status bar, restart/takeover)
8. `TerminalTabBar` component (tab pills, +, Split, Observe buttons)
9. `TerminalSplitContainer` component (flex column, draggable divider)
10. `TerminalPanel` default export (container, owns all state)

No other files are modified.

---

## Spec Coverage Check

| Spec requirement | Covered by |
|-----------------|-----------|
| Tab pills with ×, + button | Task 1 (TerminalTabBar) |
| Cannot close last tab | Task 1 (handleCloseTab guard) |
| Split button toggles top/bottom panes | Task 4 (TerminalSplitContainer) |
| Draggable divider, min 80px per pane | Task 4 |
| Each pane is independent PTY | Task 2 (TerminalPane spawns own session) |
| Session IDs: terminal-tab-{ts}, terminal-split-{ts} | Task 1 (makeTab), Task 1 (handleToggleSplit) |
| Observe button (split active only) | Task 1 (TerminalTabBar), Task 5 |
| Observe = read-only, no PTY spawn | Task 2 (isObserving prop path) |
| Revert observe → new independent shell | Task 1 (handleToggleObserve) |
| node-pty unavailable message | Task 3 |
| Spawn error + Retry button | Task 2 |
| PTY exit notice in pane | Task 2 (unsubExit handler) |
| Agent-owned badge, disabled input, takeover button | Task 2 |
| Kill all sessions on unmount | Task 5 |
| No persistence across restarts | (no persistence code added — by omission) |
| Legacy 'main-terminal' ID retired | Task 1 (makeTab uses terminal-tab-{ts}) |

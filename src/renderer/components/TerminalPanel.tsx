import React from 'react';
import 'xterm/css/xterm.css';

const TERMINAL_THEME = {
  background: '#000000',
  foreground: '#e4e4e7',
  cursor: '#e4e4e7',
  cursorAccent: '#000000',
  selectionBackground: '#ffffff30',
  selectionForeground: undefined,
  black: '#111111',
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
const DEFAULT_TERMINAL_FONT_SIZE = 13;
const MIN_TERMINAL_FONT_SIZE = 10;
const MAX_TERMINAL_FONT_SIZE = 24;

type XTermTerminal = import('xterm').Terminal;
type FitAddon = import('@xterm/addon-fit').FitAddon;

function sliceRecentOutput(output: string): string {
  if (!output || output.length <= MAX_HYDRATE_CHARS) return output;
  const sliced = output.slice(-MAX_HYDRATE_CHARS);
  const newlineIdx = sliced.indexOf('\n');
  return newlineIdx >= 0 ? sliced.slice(newlineIdx + 1) : sliced;
}

// ─── TerminalPane ─────────────────────────────────────────────────────────────

interface TerminalPaneProps {
  paneId: string;
  sessionId: string;
  conversationId?: string | null;
  isObserving?: boolean; // read-only observe mode — no PTY spawn
  onSpawnError?: (sessionId: string) => void;
  fontSize: number;
  onFontSizeChange: (paneId: string, nextFontSize: number) => void;
  onClose?: () => void;
  closeTitle?: string;
}

interface TerminalContextMenuState {
  x: number;
  y: number;
}

function TerminalPane({
  paneId,
  sessionId,
  conversationId,
  isObserving = false,
  onSpawnError,
  fontSize,
  onFontSizeChange,
  onClose,
  closeTitle = 'Close terminal',
}: TerminalPaneProps) {
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
  const [contextMenu, setContextMenu] = React.useState<TerminalContextMenuState | null>(null);

  React.useEffect(() => {
    sessionModeRef.current = sessionMode;
  }, [sessionMode]);

  const applyFontSize = React.useCallback((nextFontSize: number) => {
    const clamped = Math.max(MIN_TERMINAL_FONT_SIZE, Math.min(MAX_TERMINAL_FONT_SIZE, nextFontSize));
    onFontSizeChange(paneId, clamped);
  }, [onFontSizeChange, paneId]);

  const handleZoomIn = React.useCallback(() => {
    applyFontSize(fontSize + 1);
  }, [applyFontSize, fontSize]);

  const handleZoomOut = React.useCallback(() => {
    applyFontSize(fontSize - 1);
  }, [applyFontSize, fontSize]);

  const handleZoomReset = React.useCallback(() => {
    applyFontSize(DEFAULT_TERMINAL_FONT_SIZE);
  }, [applyFontSize]);

  const canPaste = !isObserving && sessionMode !== 'agent_owned' && sessionMode !== 'observe_only' && sessionMode !== 'handoff_pending';

  const closeContextMenu = React.useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleCopy = React.useCallback(async () => {
    const selection = termRef.current?.getSelection() ?? '';
    if (!selection) return;
    await navigator.clipboard.writeText(selection);
    closeContextMenu();
  }, [closeContextMenu]);

  const handlePaste = React.useCallback(async () => {
    if (!canPaste) return;
    const text = await navigator.clipboard.readText();
    if (!text) return;
    await api?.terminal?.write(sessionId, text, { source: 'user', conversationId: conversationId ?? undefined });
    closeContextMenu();
  }, [api, canPaste, closeContextMenu, conversationId, sessionId]);

  const handleSelectAll = React.useCallback(() => {
    termRef.current?.selectAll();
    closeContextMenu();
  }, [closeContextMenu]);

  const handleClear = React.useCallback(() => {
    termRef.current?.clear();
    closeContextMenu();
  }, [closeContextMenu]);

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
        fontSize,
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
        if (disposed) { term.dispose(); return; }
        if (snapshot?.output) term.write(sliceRecentOutput(snapshot.output));
        setIsConnected(!!snapshot?.connected);
      } else {
        // Spawn the PTY
        let result: { id: string } | null = null;
        try {
          const snapshot = await api.terminal.getSnapshot(sessionId).catch(() => null);
          if (disposed) { term.dispose(); return; }
          if (snapshot?.connected) {
            result = { id: sessionId };
            if (snapshot.output) term.write(sliceRecentOutput(snapshot.output));
          } else {
            result = await api.terminal.spawn(sessionId, dims ? { cols: dims.cols, rows: dims.rows } : undefined);
            if (disposed) { term.dispose(); return; }
          }
        } catch {
          result = null;
        }

        if (!result) {
          setSpawnError(true);
          onSpawnError?.(sessionId);
          term.writeln('\r\n\x1b[31m[Failed to start terminal session. Click Retry.]\x1b[0m');
          cleanupRef.current = () => {
            term.dispose();
            termRef.current = null;
            fitAddonRef.current = null;
          };
          return;
        }

        const snapshot = await api.terminal.getSnapshot(sessionId).catch(() => null);
        if (disposed) { term.dispose(); return; }
        if (snapshot?.output) term.write(sliceRecentOutput(snapshot.output));
        setIsConnected(!!snapshot?.connected);
        setAgentControlled(!!snapshot?.agentControlled);
        setSessionOwner(snapshot?.owner ?? 'user');
        setSessionMode(snapshot?.mode ?? 'user_owned');
        setActiveRun(snapshot?.runId ?? null);
        setTakeoverRequestedBy(null);
      }

      if (conversationId) {
        await api.terminal.acquire(sessionId, 'user', {
          mode: 'user_owned',
          conversationId,
        }).catch(() => false);
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
        sessionModeRef.current = payload.mode ?? 'user_owned';
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
      let initialRaf: number | null = null;
      initialRaf = requestAnimationFrame(() => { initialRaf = null; resizeHandler(); term.scrollToBottom(); });

      cleanupRef.current = () => {
        inputDisposable.dispose();
        unsubData();
        unsubExit();
        unsubSessionState();
        if (initialRaf !== null) cancelAnimationFrame(initialRaf);
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
  }, [isObserving, sessionId]);

  React.useEffect(() => {
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term || !fitAddon) return;
    term.options.fontSize = fontSize;
    fitAddon.fit();
    const dims = fitAddon.proposeDimensions();
    if (dims) void api?.terminal?.resize(sessionId, dims.cols, dims.rows);
    term.scrollToBottom();
  }, [api, fontSize, sessionId]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (event.deltaY < 0) handleZoomIn();
      else if (event.deltaY > 0) handleZoomOut();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.altKey) return;

      const key = event.key;
      if (key === '=' || key === '+') {
        event.preventDefault();
        handleZoomIn();
        return;
      }
      if (key === '-' || key === '_') {
        event.preventDefault();
        handleZoomOut();
        return;
      }
      if (key === '0') {
        event.preventDefault();
        handleZoomReset();
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('keydown', handleKeyDown, true);
    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [handleZoomIn, handleZoomOut, handleZoomReset]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY });
    };

    container.addEventListener('contextmenu', handleContextMenu);
    return () => {
      container.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  React.useEffect(() => {
    if (!contextMenu) return;

    const handlePointerDown = () => setContextMenu(null);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('scroll', handlePointerDown, true);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('scroll', handlePointerDown, true);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [contextMenu]);

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
      <div className="flex h-7 flex-shrink-0 items-center justify-between border-b border-white/[0.04] bg-[#000000] px-3">
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
          <div className="flex items-center gap-1 rounded border border-white/[0.06] bg-white/[0.03] px-1.5 py-1">
            <button
              onClick={handleZoomOut}
              className="rounded px-1.5 text-[13px] leading-none text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-text-primary"
              title="Zoom out"
            >
              -
            </button>
            <button
              onClick={handleZoomReset}
              className="rounded px-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-text-primary"
              title="Reset zoom"
            >
              {fontSize}px
            </button>
            <button
              onClick={handleZoomIn}
              className="rounded px-1.5 text-[13px] leading-none text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-text-primary"
              title="Zoom in"
            >
              +
            </button>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded px-2 py-1 text-[14px] leading-none text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-text-primary"
              title={closeTitle}
            >
              ×
            </button>
          )}
          {sessionMode === 'agent_owned' && !isObserving && (
            <button
              onClick={handleRequestTakeover}
              className="rounded px-2.5 py-1 text-[12px] font-medium text-sky-200 transition-colors hover:bg-sky-400/10"
              title="Request terminal takeover"
            >
              Request takeover
            </button>
          )}
          {!isObserving && (
            <button
              onClick={handleRestart}
              className="rounded p-1.5 text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-text-primary"
              title="Restart terminal"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
        <div className="pointer-events-none absolute inset-x-0 z-10 border-b border-white/[0.06] bg-[#000000]/90 px-3 py-1.5 text-[11px] text-text-secondary">
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

      {contextMenu && (
        <div
          className="fixed z-50 min-w-[148px] overflow-hidden rounded border border-white/[0.08] bg-[#0a0a0a] py-1 shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => { void handleCopy(); }}
            className="block w-full px-3 py-1.5 text-left text-[12px] text-text-primary transition-colors hover:bg-white/[0.06]"
          >
            Copy
          </button>
          <button
            onClick={() => { void handlePaste(); }}
            disabled={!canPaste}
            className="block w-full px-3 py-1.5 text-left text-[12px] text-text-primary transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:text-text-secondary disabled:hover:bg-transparent"
          >
            Paste
          </button>
          <button
            onClick={handleSelectAll}
            className="block w-full px-3 py-1.5 text-left text-[12px] text-text-primary transition-colors hover:bg-white/[0.06]"
          >
            Select all
          </button>
          <button
            onClick={handleClear}
            className="block w-full px-3 py-1.5 text-left text-[12px] text-text-primary transition-colors hover:bg-white/[0.06]"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface TerminalTab {
  id: string;        // unique UI identifier
  sessionId: string; // PTY session ID sent to backend
  title: string;     // display label e.g. "Terminal 1"
  splitSessionId: string | null;
  splitRatio: number;
  splitIsObserving: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTab(index: number): TerminalTab {
  const ts = Date.now();
  return {
    id: `tab-${ts}`,
    sessionId: `terminal-tab-${ts}`,
    title: `Terminal ${index}`,
    splitSessionId: null,
    splitRatio: 0.5,
    splitIsObserving: false,
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
    <div className="flex h-10 flex-shrink-0 items-center border-b border-white/[0.06] bg-[#000000] px-2 gap-1">
      {/* Tab pills */}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          onClick={() => onSelectTab(tab.id)}
          className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[13px] font-medium cursor-pointer select-none transition-colors ${
            tab.id === activeTabId
              ? 'bg-white/[0.10] text-text-primary'
              : 'text-text-secondary hover:bg-white/[0.06] hover:text-text-primary'
          }`}
        >
          <span>{tab.title}</span>
          {tabs.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              className="ml-1 rounded p-0.5 hover:bg-white/[0.12] text-text-secondary hover:text-text-primary leading-none text-[14px]"
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
        className="rounded px-2 py-1.5 text-[15px] leading-none text-text-secondary hover:bg-white/[0.06] hover:text-text-primary transition-colors"
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
          className={`rounded px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
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
        className={`rounded px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
          splitActive
            ? 'bg-white/[0.10] text-text-primary'
            : 'text-text-secondary hover:bg-white/[0.06] hover:text-text-primary'
        }`}
        title={splitActive ? 'Close split pane' : 'Split terminal (top/bottom)'}
      >
        {splitActive ? '⊟ Unsplit' : '⊟ Split'}
      </button>
    </div>
  );
}

// ─── TerminalSplitContainer ───────────────────────────────────────────────────

interface TerminalSplitContainerProps {
  topSessionId: string;
  bottomSessionId: string | null; // null = no split
  splitRatio: number;             // 0.0–1.0
  splitIsObserving: boolean;
  conversationId?: string | null;
  getFontSize: (paneId: string) => number;
  onFontSizeChange: (paneId: string, nextFontSize: number) => void;
  onCloseTop?: () => void;
  onCloseBottom?: () => void;
  onSplitRatioChange: (ratio: number) => void;
}

const MIN_PANE_PX = 80;

function TerminalSplitContainer({
  topSessionId,
  bottomSessionId,
  splitRatio,
  splitIsObserving,
  conversationId,
  getFontSize,
  onFontSizeChange,
  onCloseTop,
  onCloseBottom,
  onSplitRatioChange,
}: TerminalSplitContainerProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const isDragging = React.useRef(false);

  const activeDragListenersRef = React.useRef<{
    move: ((e: MouseEvent) => void) | null;
    up: (() => void) | null;
  }>({ move: null, up: null });

  // Clean up drag listeners on unmount
  React.useEffect(() => {
    return () => {
      if (activeDragListenersRef.current.move) {
        window.removeEventListener('mousemove', activeDragListenersRef.current.move);
      }
      if (activeDragListenersRef.current.up) {
        window.removeEventListener('mouseup', activeDragListenersRef.current.up);
      }
    };
  }, []);

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
      activeDragListenersRef.current.move = null;
      activeDragListenersRef.current.up = null;
    };

    activeDragListenersRef.current.move = onMouseMove;
    activeDragListenersRef.current.up = onMouseUp;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [onSplitRatioChange]);

  if (!bottomSessionId) {
    return (
      <div ref={containerRef} className="flex flex-1 flex-col overflow-hidden min-h-0">
        <TerminalPane
          paneId={`primary:${topSessionId}`}
          sessionId={topSessionId}
          conversationId={conversationId}
          fontSize={getFontSize(`primary:${topSessionId}`)}
          onFontSizeChange={onFontSizeChange}
          onClose={onCloseTop}
          closeTitle="Close terminal tab"
        />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-1 flex-col overflow-hidden min-h-0">
      {/* Top pane */}
      <div style={{ height: `${splitRatio * 100}%` }} className="flex flex-col overflow-hidden min-h-0">
        <TerminalPane
          paneId={`primary:${topSessionId}`}
          sessionId={topSessionId}
          conversationId={conversationId}
          fontSize={getFontSize(`primary:${topSessionId}`)}
          onFontSizeChange={onFontSizeChange}
          onClose={onCloseTop}
          closeTitle="Close terminal tab"
        />
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
          paneId={splitIsObserving ? `split-observe:${bottomSessionId}` : `split-shell:${bottomSessionId}`}
          sessionId={bottomSessionId}
          conversationId={conversationId}
          isObserving={splitIsObserving}
          fontSize={getFontSize(splitIsObserving ? `split-observe:${bottomSessionId}` : `split-shell:${bottomSessionId}`)}
          onFontSizeChange={onFontSizeChange}
          onClose={onCloseBottom}
          closeTitle={splitIsObserving ? 'Close observed pane' : 'Close split terminal'}
        />
      </div>
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

  const initialTab = React.useMemo(() => makeTab(1), []);
  const [tabs, setTabs] = React.useState<TerminalTab[]>([initialTab]);
  const [activeTabId, setActiveTabId] = React.useState<string>(initialTab.id);
  const tabCounterRef = React.useRef(2); // next tab will be "Terminal 2"
  const [isAvailable, setIsAvailable] = React.useState<boolean | null>(null);
  const [terminalFontSizes, setTerminalFontSizes] = React.useState<Record<string, number>>({});

  React.useEffect(() => {
    let cancelled = false;
    api?.terminal?.isAvailable()
      .then((available) => { if (!cancelled) setIsAvailable(available); })
      .catch(() => { if (!cancelled) setIsAvailable(false); });
    return () => { cancelled = true; };
  }, [api]);

  // Kill all sessions when panel unmounts
  const tabsRef = React.useRef(tabs);
  React.useEffect(() => { tabsRef.current = tabs; }, [tabs]);

  React.useEffect(() => {
    return () => {
      tabsRef.current.forEach((tab) => {
        void api?.terminal?.kill(tab.sessionId);
        if (tab.splitSessionId && !tab.splitIsObserving) void api?.terminal?.kill(tab.splitSessionId);
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  const updateTab = React.useCallback((tabId: string, updater: (tab: TerminalTab) => TerminalTab) => {
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? updater(tab) : tab)));
  }, []);

  const createFreshTab = React.useCallback(() => makeTab(tabCounterRef.current++), []);

  const getFontSize = React.useCallback((sessionId: string) => {
    return terminalFontSizes[sessionId] ?? DEFAULT_TERMINAL_FONT_SIZE;
  }, [terminalFontSizes]);

  const handleFontSizeChange = React.useCallback((sessionId: string, nextFontSize: number) => {
    setTerminalFontSizes((prev) => {
      const clamped = Math.max(MIN_TERMINAL_FONT_SIZE, Math.min(MAX_TERMINAL_FONT_SIZE, nextFontSize));
      if ((prev[sessionId] ?? DEFAULT_TERMINAL_FONT_SIZE) === clamped) return prev;
      return { ...prev, [sessionId]: clamped };
    });
  }, []);

  const handleAddTab = React.useCallback(() => {
    const tab = createFreshTab();
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, [createFreshTab]);

  const handleCloseTab = React.useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return prev;

      const tab = prev[idx];
      void api?.terminal?.kill(tab.sessionId);
      if (tab.splitSessionId && !tab.splitIsObserving) void api?.terminal?.kill(tab.splitSessionId);

      if (prev.length === 1) {
        const replacement = createFreshTab();
        setActiveTabId(replacement.id);
        return [replacement];
      }

      const next = prev[idx + 1] ?? prev[idx - 1];
      if (id === activeTabId) setActiveTabId(next.id);
      return prev.filter((t) => t.id !== id);
    });
  }, [activeTabId, api, createFreshTab]);

  const handleCloseSplit = React.useCallback(() => {
    if (!activeTab?.splitSessionId) return;
    if (!activeTab.splitIsObserving) void api?.terminal?.kill(activeTab.splitSessionId);
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      splitSessionId: null,
      splitIsObserving: false,
      splitRatio: 0.5,
    }));
  }, [activeTab, api, updateTab]);

  const handleToggleSplit = React.useCallback(() => {
    if (!activeTab) return;
    if (activeTab.splitSessionId !== null) {
      handleCloseSplit();
      return;
    }

    const newId = `terminal-split-${Date.now()}`;
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      splitSessionId: newId,
      splitRatio: 0.5,
      splitIsObserving: false,
    }));
  }, [activeTab, handleCloseSplit, updateTab]);

  const handleToggleObserve = React.useCallback(() => {
    if (!activeTab) return;

    if (activeTab.splitIsObserving) {
      const newId = `terminal-split-${Date.now()}`;
      updateTab(activeTab.id, (tab) => ({
        ...tab,
        splitSessionId: newId,
        splitIsObserving: false,
      }));
      return;
    }

    if (activeTab.splitSessionId) void api?.terminal?.kill(activeTab.splitSessionId);
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      splitSessionId: tab.sessionId,
      splitIsObserving: true,
    }));
  }, [activeTab, api, updateTab]);

  if (isAvailable === null) return null;

  if (isAvailable === false) {
    return (
      <div className={`flex flex-1 items-center justify-center bg-[#000000] text-text-secondary ${visible ? '' : 'hidden'}`}>
        <div className="space-y-2 text-center">
          <div className="text-sm font-medium text-text-primary">Terminal Unavailable</div>
          <div className="max-w-xs text-xs">
            node-pty is not installed or failed to load. Run npm install and rebuild Electron native modules.
          </div>
        </div>
      </div>
    );
  }

  if (!visible) return null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#000000]">
      <TerminalTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        splitActive={activeTab.splitSessionId !== null}
        splitIsObserving={activeTab.splitIsObserving}
        onSelectTab={setActiveTabId}
        onAddTab={handleAddTab}
        onCloseTab={handleCloseTab}
        onToggleSplit={handleToggleSplit}
        onToggleObserve={handleToggleObserve}
      />
      <TerminalSplitContainer
        topSessionId={activeTab.sessionId}
        bottomSessionId={activeTab.splitSessionId}
        splitRatio={activeTab.splitRatio}
        splitIsObserving={activeTab.splitIsObserving}
        conversationId={conversationId}
        getFontSize={getFontSize}
        onFontSizeChange={handleFontSizeChange}
        onCloseTop={() => handleCloseTab(activeTab.id)}
        onCloseBottom={handleCloseSplit}
        onSplitRatioChange={(ratio) => {
          updateTab(activeTab.id, (tab) => ({ ...tab, splitRatio: ratio }));
        }}
      />
    </div>
  );
}

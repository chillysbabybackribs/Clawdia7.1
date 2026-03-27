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

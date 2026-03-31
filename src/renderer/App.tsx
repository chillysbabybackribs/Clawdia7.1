import React, { useState, useCallback, useEffect } from 'react';
import AppChrome from './components/AppChrome';
import ChatPanel from './components/ChatPanel';
import BrowserPanel from './components/BrowserPanel';
import ConversationsView from './components/ConversationsView';
import SettingsView from './components/SettingsView';
import WelcomeScreen from './components/WelcomeScreen';
import ProcessesPanel from './components/ProcessesPanel';
import EditorPanel from './components/EditorPanel';
import TerminalPanel from './components/TerminalPanel';
import CreateAgentPanel from './components/agents/CreateAgentPanel';
import AgentDetailPanel from './components/agents/AgentDetailPanel';
import { makeTab, addTab, closeTab, switchTab, type ConversationTab } from './tabLogic';

export type View = 'chat' | 'conversations' | 'settings' | 'processes' | 'agent-create' | 'agent-detail';

type ReplayBufferItem = { type: string; data: any };
type RightPaneMode = 'none' | 'browser' | 'editor' | 'terminal';
type EditorTab = { id: string; filePath: string };

interface UiSessionState {
  tabs?: ConversationTab[];
  activeTabId?: string;
  activeView: View;
  rightPaneMode?: RightPaneMode;
  browserVisible?: boolean;
  // legacy field — kept for backwards compatibility on first restore
  activeConversationId?: string | null;
}

export default function App() {
  const [activeView, setActiveView] = useState<View>('chat');
  const [displayedView, setDisplayedView] = useState<View>('chat');
  const [viewTransitionStage, setViewTransitionStage] = useState<'idle' | 'exit' | 'enter'>('idle');
  const [historyMode, setHistoryMode] = useState(false);
  const [rightPaneMode, setRightPaneMode] = useState<RightPaneMode>('browser');
  // Per-tab panel state — keyed by tab ID so each tab's ChatPanel stays mounted with its own state
  const [tabPanelState, setTabPanelState] = useState<Record<string, { chatKey: number; loadConversationId: string | null; replayBuffer: ReplayBufferItem[] | null }>>({});
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null); // null = bridge/settings still loading
  const [editorTabs, setEditorTabs] = useState<EditorTab[]>([]);
  const [activeEditorTabId, setActiveEditorTabId] = useState<string | null>(null);
  const [editorDirtyByTabId, setEditorDirtyByTabId] = useState<Record<string, boolean>>({});
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [tabs, setTabs] = useState<ConversationTab[]>(() => [makeTab(null)]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id);
  // Set of conversationIds that currently have a running agent — used for tab indicators.
  const [runningConvIds, setRunningConvIds] = useState<Set<string>>(new Set());
  const browserVisible = rightPaneMode === 'browser';
  const editorOpen = rightPaneMode === 'editor';
  const terminalOpen = rightPaneMode === 'terminal';
  const activeEditorTab = editorTabs.find((tab) => tab.id === activeEditorTabId) || null;

  // Per-tab panel state helpers
  const getTabPanel = useCallback((tabId: string) => {
    return tabPanelState[tabId] ?? { chatKey: 0, loadConversationId: null, replayBuffer: null };
  }, [tabPanelState]);

  const setTabPanel = useCallback((tabId: string, updater: (prev: { chatKey: number; loadConversationId: string | null; replayBuffer: ReplayBufferItem[] | null }) => { chatKey: number; loadConversationId: string | null; replayBuffer: ReplayBufferItem[] | null }) => {
    setTabPanelState(prev => {
      const current = prev[tabId] ?? { chatKey: 0, loadConversationId: null, replayBuffer: null };
      return { ...prev, [tabId]: updater(current) };
    });
  }, []);

  // Convenience alias: active tab's conversation ID (used by TerminalPanel)
  const loadConversationId = getTabPanel(activeTabId).loadConversationId;

  useEffect(() => {
    if (activeView === displayedView) return;

    let enterTimer: number | null = null;
    const swapTimer = window.setTimeout(() => {
      setDisplayedView(activeView);
      setViewTransitionStage('enter');
      enterTimer = window.setTimeout(() => {
        setViewTransitionStage('idle');
      }, 180);
    }, 120);

    setViewTransitionStage('exit');

    return () => {
      window.clearTimeout(swapTimer);
      if (enterTimer !== null) window.clearTimeout(enterTimer);
    };
  }, [activeView, displayedView]);

  // Check for API key on mount
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let lookupAttempt = 0;

    const resolveHasApiKey = async () => {
      const api = (window as any).clawdia;
      if (!api) {
        timer = window.setTimeout(resolveHasApiKey, 100);
        return;
      }

      try {
        const keys = await api.settings.getProviderKeys() as Record<string, string>;
        if (cancelled) return;

        const hasKey = Object.values(keys || {}).some(Boolean);
        if (hasKey) {
          setHasApiKey(true);
          return;
        }

        lookupAttempt += 1;
        if (lookupAttempt < 5) {
          timer = window.setTimeout(resolveHasApiKey, 250);
          return;
        }

        setHasApiKey(false);
      } catch {
        if (cancelled) return;
        lookupAttempt += 1;
        if (lookupAttempt < 5) {
          timer = window.setTimeout(resolveHasApiKey, 250);
          return;
        }
        setHasApiKey(false);
      }
    };

    resolveHasApiKey();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!hasApiKey) return;
    const api = (window as any).clawdia;
    if (!api?.settings) {
      setSessionHydrated(true);
      return;
    }

    const fallbackTimer = window.setTimeout(() => {
      setSessionHydrated(true);
    }, 500);

    api.settings.get('uiSession')
      .then((session: UiSessionState | null) => {
        if (session?.activeView) setActiveView(session.activeView);
        if (session?.rightPaneMode) {
          setRightPaneMode(session.rightPaneMode);
        } else if (typeof session?.browserVisible === 'boolean') {
          setRightPaneMode(session.browserVisible ? 'browser' : 'none');
        }
        if (session?.tabs && session.tabs.length > 0) {
          setTabs(session.tabs);
          const restoredActiveTabId = session.activeTabId ?? session.tabs[0].id;
          setActiveTabId(restoredActiveTabId);
          // Restore per-tab panel state for all tabs that have a conversation
          setTabPanelState(() => {
            const state: Record<string, { chatKey: number; loadConversationId: string | null; replayBuffer: ReplayBufferItem[] | null }> = {};
            for (const t of session.tabs!) {
              state[t.id] = { chatKey: 0, loadConversationId: t.conversationId ?? null, replayBuffer: null };
            }
            return state;
          });
        } else if (session?.activeConversationId) {
          setTabs(current => {
            const updated = current.map((t, i) => i === 0 ? { ...t, conversationId: session.activeConversationId ?? null } : t);
            setTabPanelState({ [updated[0].id]: { chatKey: 0, loadConversationId: session.activeConversationId ?? null, replayBuffer: null } });
            return updated;
          });
        }
      })
      .finally(() => {
        window.clearTimeout(fallbackTimer);
        setSessionHydrated(true);
      });
  }, [hasApiKey]);

  useEffect(() => {
    if (!sessionHydrated || !hasApiKey) return;
    (window as any).clawdia?.settings?.set('uiSession', {
      tabs,
      activeTabId,
      activeView,
      rightPaneMode,
      browserVisible: rightPaneMode === 'browser',
    });
  }, [sessionHydrated, hasApiKey, tabs, activeTabId, activeView, rightPaneMode]);

  // Push live UI state to main so agent tools (ui_state) can read it.
  useEffect(() => {
    if (!sessionHydrated) return;
    const api = (window as any).clawdia;
    if (!api?.uiState?.push) return;

    const activeTab = tabs.find(t => t.id === activeTabId) ?? null;
    const push = async () => {
      let provider = 'unknown';
      let model = 'unknown';
      let terminalSessionIds: string[] = [];
      let browserUrl: string | null = null;
      try {
        provider = (await api.settings.getProvider?.()) ?? 'unknown';
        model = (await api.settings.getModel?.()) ?? 'unknown';
      } catch { /* ignore */ }
      try {
        const sessions = await api.terminal.list?.();
        terminalSessionIds = (sessions ?? []).map((s: any) => s.id);
      } catch { /* ignore */ }
      try {
        if (rightPaneMode === 'browser') {
          const state = await api.browser.getExecutionMode?.();
          browserUrl = state ?? null;
        }
      } catch { /* ignore */ }

      const viewMap: Record<string, string> = {
        'agent-create': 'agents',
        'agent-detail': 'agents',
      };

      await api.uiState.push({
        activeRightPanel: rightPaneMode === 'none' ? null : rightPaneMode as 'browser' | 'terminal' | 'editor',
        activeView: (viewMap[activeView] ?? activeView) as any,
        activeConversationId: activeTab?.conversationId ?? null,
        openTabIds: tabs.map(t => t.id),
        sidebarDrawer: null,
        provider,
        model,
        terminalSessionIds,
        browserVisible: rightPaneMode === 'browser',
        browserUrl,
        updatedAt: Date.now(),
      });
    };
    push();
  }, [sessionHydrated, tabs, activeTabId, activeView, rightPaneMode]);

  useEffect(() => {
    const browser = (window as any).clawdia?.browser;
    if (!browser) return;
    if (rightPaneMode === 'browser') {
      browser.show();
    } else {
      browser.hide();
      browser.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  }, [rightPaneMode]);

  // Track which conversations have a running agent so TabStrip can show indicators.
  useEffect(() => {
    const api = (window as any).clawdia;
    if (!api?.chat) return;

    // Any stream text event means an agent is running for that conversation.
    const unsubText = api.chat.onStreamText((payload: { delta: string; conversationId: string }) => {
      if (!payload?.conversationId) return;
      setRunningConvIds(prev => {
        if (prev.has(payload.conversationId)) return prev;
        const next = new Set(prev);
        next.add(payload.conversationId);
        return next;
      });
    });

    // When a stream ends (ok or error), remove that conversation from the running set.
    const unsubEnd = api.chat.onStreamEnd((data: any) => {
      if (!data?.conversationId) return;
      setRunningConvIds(prev => {
        if (!prev.has(data.conversationId)) return prev;
        const next = new Set(prev);
        next.delete(data.conversationId);
        return next;
      });
    });

    return () => { unsubText?.(); unsubEnd?.(); };
  }, []);

  const handleWelcomeComplete = useCallback(() => {
    setSessionHydrated(true);
    setHasApiKey(true);
  }, []);

  const handleNewChat = useCallback(async () => {
    const api = (window as any).clawdia;
    // Use chat.create() so agents running in other tabs are not aborted.
    // The current tab just gets a fresh blank conversation.
    const created = api ? await api.chat.create() : null;
    setTabs(current =>
      current.map(t => t.id === activeTabId ? { ...t, conversationId: created?.id ?? null, title: undefined } : t)
    );
    setTabPanel(activeTabId, prev => ({ chatKey: prev.chatKey + 1, loadConversationId: created?.id ?? null, replayBuffer: null }));
    setHistoryMode(false);
    setActiveView('chat');
  }, [activeTabId, setTabPanel]);

  const handleLoadConversation = useCallback(async (id: string, buffer?: ReplayBufferItem[] | null) => {
    if (!id) return;
    setTabs(current =>
      current.map(t => t.id === activeTabId ? { ...t, conversationId: id } : t)
    );
    setTabPanel(activeTabId, prev => ({ chatKey: prev.chatKey + 1, loadConversationId: id, replayBuffer: buffer || null }));
    setSelectedProcessId(null);
    setHistoryMode(false);
    setActiveView('chat');
  }, [activeTabId, setTabPanel]);

  const handleNewTab = useCallback(async () => {
    const api = (window as any).clawdia;
    // Use chat.create() — does NOT abort agents running in other tabs.
    const created = api ? await api.chat.create() : null;
    const newTab = makeTab(created?.id ?? null);
    setTabs(current => {
      const result = addTab(current, newTab);
      setActiveTabId(result.activeTabId);
      return result.tabs;
    });
    setTabPanel(newTab.id, () => ({ chatKey: 0, loadConversationId: created?.id ?? null, replayBuffer: null }));
    setActiveView('chat');
  }, [setTabPanel]);

  const handleCloseTab = useCallback((tabId: string) => {
    setTabs(currentTabs => {
      const result = closeTab(currentTabs, tabId, activeTabId);
      if (result.activeTabId !== activeTabId) {
        setActiveTabId(result.activeTabId);
      }
      return result.tabs;
    });
    // Clean up panel state for the closed tab
    setTabPanelState(prev => {
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, [activeTabId]);

  const handleSwitchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    setActiveView('chat');
  }, []);

  const handleReorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    setTabs(current => {
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const handleConversationTitleResolved = useCallback((tabId: string, title: string) => {
    setTabs(current =>
      current.map(t => t.id === tabId ? { ...t, title } : t)
    );
  }, []);

  const handleOpenConversation = useCallback((id: string) => {
    const existing = tabs.find(t => t.conversationId === id);
    if (existing) {
      handleSwitchTab(existing.id);
    } else {
      const newTab = makeTab(id);
      setTabs(current => {
        const result = addTab(current, newTab);
        setActiveTabId(result.activeTabId);
        return result.tabs;
      });
      setTabPanel(newTab.id, () => ({ chatKey: 0, loadConversationId: id, replayBuffer: null }));
      setHistoryMode(false);
      setActiveView('chat');
    }
  }, [tabs, handleSwitchTab, setTabPanel]);

  const handleOpenProcess = useCallback((processId: string) => {
    setSelectedProcessId(processId);
    setActiveView('processes');
  }, []);

  const handleToggleBrowser = useCallback(() => {
    setRightPaneMode((mode) => (mode === 'browser' ? 'none' : 'browser'));
  }, []);

  const handleHideBrowser = useCallback(() => {
    setRightPaneMode((mode) => (mode === 'browser' ? 'none' : mode));
  }, []);

  const handleShowBrowser = useCallback(() => {
    setRightPaneMode('browser');
  }, []);

  const handleToggleTerminal = useCallback(() => {
    setRightPaneMode((mode) => {
      if (mode === 'terminal') {
        (window as any).clawdia?.browser.show();
        return 'browser';
      }
      (window as any).clawdia?.browser.hide();
      return 'terminal';
    });
  }, []);

  const handleOpenEditorFile = useCallback((filePath: string) => {
    setEditorTabs((currentTabs) => {
      const existing = currentTabs.find((tab) => tab.filePath === filePath);
      if (existing) {
        setActiveEditorTabId(existing.id);
        return currentTabs;
      }
      const nextTab = {
        id: `editor-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        filePath,
      };
      setActiveEditorTabId(nextTab.id);
      return [...currentTabs, nextTab];
    });
    (window as any).clawdia?.browser.hide();
    setRightPaneMode('editor');
  }, []);

  const handleSelectEditorTab = useCallback((tabId: string) => {
    setActiveEditorTabId(tabId);
    (window as any).clawdia?.browser.hide();
    setRightPaneMode('editor');
  }, []);

  const handleCloseEditorTab = useCallback((tabId: string) => {
    if (editorDirtyByTabId[tabId]) {
      const confirmed = window.confirm('You have unsaved editor changes. Close this tab and discard them?');
      if (!confirmed) return;
    }
    setEditorTabs((currentTabs) => {
      const nextTabs = currentTabs.filter((tab) => tab.id !== tabId);
      setEditorDirtyByTabId((currentDirty) => {
        const nextDirty = { ...currentDirty };
        delete nextDirty[tabId];
        return nextDirty;
      });
      if (nextTabs.length === 0) {
        setActiveEditorTabId(null);
        (window as any).clawdia?.browser.show();
        setRightPaneMode('browser');
        return nextTabs;
      }
      setActiveEditorTabId((currentActiveTabId) => {
        if (currentActiveTabId !== tabId) return currentActiveTabId;
        const closedIndex = currentTabs.findIndex((tab) => tab.id === tabId);
        const fallbackTab = nextTabs[Math.max(0, Math.min(closedIndex, nextTabs.length - 1))];
        return fallbackTab?.id || nextTabs[0].id;
      });
      return nextTabs;
    });
  }, [editorDirtyByTabId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 'n') { e.preventDefault(); handleNewChat(); }
      if (ctrl && e.key === 'l') { e.preventDefault(); handleNewChat(); }
      if (ctrl && e.key === ',') { e.preventDefault(); setActiveView(v => v === 'settings' ? 'chat' : 'settings'); }
      if (ctrl && e.key === 'h') { e.preventDefault(); setActiveView(v => v === 'conversations' ? 'chat' : 'conversations'); }
      if (ctrl && e.key === 'b') { e.preventDefault(); handleToggleBrowser(); }
      if (e.key === 'Escape' && activeView !== 'chat') setActiveView('chat');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleNewChat, handleToggleBrowser, activeView]);

  useEffect(() => {
    const api = (window as any).clawdia;
    if (!api?.editor?.onOpenFile) return;
    return api.editor.onOpenFile((payload: { filePath: string }) => {
      if (payload?.filePath) handleOpenEditorFile(payload.filePath);
    });
  }, [handleOpenEditorFile]);

  useEffect(() => {
    const api = (window as any).clawdia;
    if (!api?.editor?.setState) return;
    api.editor.setState({
      mode: rightPaneMode,
      tabs: editorTabs.map((tab) => ({
        id: tab.id,
        filePath: tab.filePath,
        isActive: tab.id === activeEditorTabId,
        isDirty: !!editorDirtyByTabId[tab.id],
      })),
      activeTabId: activeEditorTabId,
      activeFilePath: activeEditorTab?.filePath || null,
    }).catch(() => {});
  }, [activeEditorTab, activeEditorTabId, editorDirtyByTabId, editorTabs, rightPaneMode]);

  if (hasApiKey === null) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-surface-0 text-text-secondary">
        <div style={{ color: '#fff', fontSize: 24 }}>Starting…</div>
      </div>
    );
  }

  if (!hasApiKey) {
    return (
      <div className="flex h-screen w-screen flex-col overflow-hidden rounded-[10px] border-[2px] border-white/[0.10] bg-surface-0">
        <AppChrome />
        <div className="flex min-h-0 flex-1">
          <div
            className="relative flex h-full min-w-0 flex-col"
            style={{
              flex: browserVisible ? '35 0 0' : '1 0 0',
              background: '#0b0b0f',
              ...(browserVisible ? {
                borderRight: '2px solid rgba(255,255,255,0.09)',
                boxShadow: 'inset -2px 0 12px rgba(0,0,0,0.35), 2px 0 8px rgba(0,0,0,0.3)',
              } : {}),
            }}
          >
            <WelcomeScreen onComplete={handleWelcomeComplete} />
          </div>

          {browserVisible && (
            <div
              className="flex h-full min-w-0 flex-col border-l-[2px] border-white/[0.06] shadow-[inset_2px_0_8px_rgba(0,0,0,0.3),-2px_0_12px_rgba(0,0,0,0.4)]"
              style={{ flex: '65 0 0' }}
            >
              <BrowserPanel />
            </div>
          )}
        </div>
      </div>
    );
  }

  const renderPrimaryView = () => {
    if (displayedView === 'chat') {
      return (
        <>
          {tabs.map(tab => {
            const panel = getTabPanel(tab.id);
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className="flex min-h-0 w-full min-w-0 flex-1 self-stretch"
                style={{ display: isActive ? 'flex' : 'none' }}
              >
                <ChatPanel
                  key={`${tab.id}-${panel.chatKey}`}
                  tabId={tab.id}
                  historyMode={historyMode}
                  onToggleHistory={() => setHistoryMode((current) => !current)}
                  browserVisible={browserVisible}
                  onToggleBrowser={handleToggleBrowser}
                  onHideBrowser={handleHideBrowser}
                  onShowBrowser={handleShowBrowser}
                  terminalOpen={terminalOpen}
                  onToggleTerminal={handleToggleTerminal}
                  onOpenSettings={() => setActiveView('settings')}
                  onOpenPendingApproval={handleOpenProcess}
                  loadConversationId={panel.loadConversationId}
                  replayBuffer={panel.replayBuffer}
                  tabs={tabs}
                  activeTabId={activeTabId}
                  runningConvIds={runningConvIds}
                  onNewTab={handleNewTab}
                  onCloseTab={handleCloseTab}
                  onSwitchTab={handleSwitchTab}
                  onReorderTabs={handleReorderTabs}
                  onOpenConversation={handleOpenConversation}
                  onConversationTitleResolved={handleConversationTitleResolved}
                />
              </div>
            );
          })}
        </>
      );
    }

    if (displayedView === 'conversations') {
      return (
        <ConversationsView
          onBack={() => setActiveView('chat')}
          onLoadConversation={handleLoadConversation}
        />
      );
    }

    if (displayedView === 'processes') {
      return (
        <ProcessesPanel
          onBack={() => setActiveView('chat')}
          initialRunId={selectedProcessId}
          onAttach={(conversationId, buffer) => {
            handleLoadConversation(conversationId, buffer);
          }}
        />
      );
    }

    if (displayedView === 'settings') {
      return <SettingsView onBack={() => setActiveView('chat')} />;
    }

    if (displayedView === 'agent-create') {
      return (
        <CreateAgentPanel
          onBack={() => setActiveView('chat')}
          onCreated={(agent) => {
            setSelectedAgentId(agent.id);
            setActiveView('agent-detail');
          }}
        />
      );
    }

    if (displayedView === 'agent-detail') {
      return (
        <AgentDetailPanel
          agentId={selectedAgentId}
          onBack={() => setActiveView('chat')}
          onDeleted={() => {
            setSelectedAgentId(null);
            setActiveView('chat');
          }}
        />
      );
    }

    return null;
  };

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden rounded-[10px] border-[2px] border-white/[0.10]"
      style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.8), 0 2px 8px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)' }}
    >
      <AppChrome
        showChatControls={activeView === 'chat' || activeView === 'settings'}
        historyOpen={historyMode}
        terminalOpen={terminalOpen}
        settingsOpen={activeView === 'settings'}
        onToggleHistory={() => {
          setActiveView('chat');
          setHistoryMode((current) => !current);
        }}
        onToggleTerminal={() => {
          setActiveView('chat');
          handleToggleTerminal();
        }}
        onOpenSettings={() => setActiveView((current) => current === 'settings' ? 'chat' : 'settings')}
      />
      <div className="flex min-h-0 flex-1">
        <div
          className="relative flex h-full min-w-0 flex-col"
          style={{
            flex: rightPaneMode === 'none' ? '1 0 0' : '35 0 0',
            background: '#0b0b0f',
            ...(rightPaneMode !== 'none' ? {
              borderRight: '2px solid rgba(255,255,255,0.09)',
              boxShadow: 'inset -2px 0 12px rgba(0,0,0,0.35), 2px 0 8px rgba(0,0,0,0.3)',
            } : {}),
          }}
        >
          <div
            className={`flex min-h-0 w-full min-w-0 flex-1 self-stretch transition-all duration-180 ease-out ${
              viewTransitionStage === 'exit'
                ? 'translate-y-1 opacity-0'
                : viewTransitionStage === 'enter'
                  ? 'translate-y-0 opacity-100'
                  : 'translate-y-0 opacity-100'
            }`}
          >
            {renderPrimaryView()}
          </div>
        </div>

        {editorOpen && (
          <div
            className="flex h-full min-w-0 flex-col border-l-[2px] border-white/[0.06]"
            style={{ flex: '65 0 0' }}
          >
            <EditorPanel
              tabs={editorTabs}
              activeTabId={activeEditorTabId}
              onSelectTab={handleSelectEditorTab}
              onCloseTab={handleCloseEditorTab}
              onDirtyStateChange={(tabId, dirty) => {
                setEditorDirtyByTabId((current) => {
                  if (current[tabId] === dirty) return current;
                  return { ...current, [tabId]: dirty };
                });
              }}
            />
          </div>
        )}

        <div
          className={`${terminalOpen ? 'flex' : 'hidden'} h-full min-w-0 flex-col border-l-[2px] border-white/[0.06]`}
          style={{ flex: '65 0 0' }}
        >
          <TerminalPanel visible={terminalOpen} conversationId={loadConversationId} />
        </div>

        {browserVisible && !editorOpen && !terminalOpen && (
          <div
            className="flex h-full min-w-0 flex-col border-l-[2px] border-white/[0.06] shadow-[inset_2px_0_8px_rgba(0,0,0,0.3),-2px_0_12px_rgba(0,0,0,0.4)]"
            style={{ flex: '65 0 0' }}
          >
            <BrowserPanel />
          </div>
        )}
      </div>
    </div>
  );
}

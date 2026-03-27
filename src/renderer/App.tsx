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
  const [rightPaneMode, setRightPaneMode] = useState<RightPaneMode>('browser');
  const [chatKey, setChatKey] = useState(0);
  const [loadConversationId, setLoadConversationId] = useState<string | null>(null);
  const [replayBuffer, setReplayBuffer] = useState<ReplayBufferItem[] | null>(null);
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null); // null = loading
  const [editorTabs, setEditorTabs] = useState<EditorTab[]>([]);
  const [activeEditorTabId, setActiveEditorTabId] = useState<string | null>(null);
  const [editorDirtyByTabId, setEditorDirtyByTabId] = useState<Record<string, boolean>>({});
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [tabs, setTabs] = useState<ConversationTab[]>(() => [makeTab(null)]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id);
  const browserVisible = rightPaneMode === 'browser';
  const editorOpen = rightPaneMode === 'editor';
  const terminalOpen = rightPaneMode === 'terminal';
  const activeEditorTab = editorTabs.find((tab) => tab.id === activeEditorTabId) || null;

  // Check for API key on mount
  useEffect(() => {
    const api = (window as any).clawdia;
    if (!api) return;
    api.settings.getProviderKeys().then((keys: Record<string, string>) => {
      setHasApiKey(Object.values(keys || {}).some(Boolean));
    });
  }, []);

  useEffect(() => {
    if (!hasApiKey) return;
    const api = (window as any).clawdia;
    if (!api?.settings) {
      setSessionHydrated(true);
      return;
    }

    api.settings.get('uiSession')
      .then((session: UiSessionState | null) => {
        if (session?.activeView) setActiveView(session.activeView);
        if (session?.rightPaneMode) {
          setRightPaneMode(session.rightPaneMode);
        } else if (typeof session?.browserVisible === 'boolean') {
          setRightPaneMode(session.browserVisible ? 'browser' : 'none');
        }
        // Restore full tab array (new format)
        if (session?.tabs && session.tabs.length > 0) {
          setTabs(session.tabs);
          const restoredActiveTabId = session.activeTabId ?? session.tabs[0].id;
          setActiveTabId(restoredActiveTabId);
          const activeTab = session.tabs.find(t => t.id === restoredActiveTabId) ?? session.tabs[0];
          if (activeTab.conversationId) {
            setLoadConversationId(activeTab.conversationId);
          }
        } else if (session?.activeConversationId) {
          // Legacy single-conversation restore
          setLoadConversationId(session.activeConversationId);
          setTabs(current =>
            current.map((t, i) => i === 0 ? { ...t, conversationId: session.activeConversationId ?? null } : t)
          );
        }
      })
      .finally(() => setSessionHydrated(true));
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

  useEffect(() => {
    if (rightPaneMode !== 'browser') {
      (window as any).clawdia?.browser.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  }, [rightPaneMode]);

  const handleNewChat = useCallback(async () => {
    const api = (window as any).clawdia;
    if (api) await api.chat.new();
    setTabs(current =>
      current.map(t => t.id === activeTabId ? { ...t, conversationId: null } : t)
    );
    setLoadConversationId(null);
    setReplayBuffer(null);
    setChatKey(k => k + 1);
    setActiveView('chat');
  }, [activeTabId]);

  const handleLoadConversation = useCallback(async (id: string, buffer?: ReplayBufferItem[] | null) => {
    if (!id) return;
    setTabs(current =>
      current.map(t => t.id === activeTabId ? { ...t, conversationId: id } : t)
    );
    setLoadConversationId(id);
    setReplayBuffer(buffer || null);
    setSelectedProcessId(null);
    setChatKey(k => k + 1);
    setActiveView('chat');
  }, [activeTabId]);

  const handleNewTab = useCallback(async () => {
    const api = (window as any).clawdia;
    if (api) await api.chat.new();
    const newTab = makeTab(null);
    setTabs(current => {
      const result = addTab(current, newTab);
      setActiveTabId(result.activeTabId);
      return result.tabs;
    });
    setLoadConversationId(null);
    setReplayBuffer(null);
    setChatKey(k => k + 1);
    setActiveView('chat');
  }, []);

  const handleCloseTab = useCallback((tabId: string) => {
    setTabs(currentTabs => {
      const result = closeTab(currentTabs, tabId, activeTabId);
      if (result.activeTabId !== activeTabId) {
        const nextTab = result.tabs.find(t => t.id === result.activeTabId);
        if (nextTab?.conversationId) {
          setLoadConversationId(nextTab.conversationId);
          setChatKey(k => k + 1);
        } else {
          setLoadConversationId(null);
          setChatKey(k => k + 1);
        }
        setActiveTabId(result.activeTabId);
      }
      return result.tabs;
    });
  }, [activeTabId]);

  const handleSwitchTab = useCallback((tabId: string) => {
    const result = switchTab(tabs, tabId);
    setActiveTabId(result.activeTabId);
    const tab = tabs.find(t => t.id === tabId);
    if (tab?.conversationId) {
      setLoadConversationId(tab.conversationId);
      setReplayBuffer(null);
      setChatKey(k => k + 1);
    } else {
      setLoadConversationId(null);
      setReplayBuffer(null);
      setChatKey(k => k + 1);
    }
    setActiveView('chat');
  }, [tabs]);

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
      setLoadConversationId(id);
      setReplayBuffer(null);
      setChatKey(k => k + 1);
      setActiveView('chat');
    }
  }, [tabs, handleSwitchTab]);

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

  const handleWelcomeComplete = useCallback(() => {
    setHasApiKey(true);
  }, []);

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

  // Still loading — show nothing (prevents flash)
  if (hasApiKey === null) {
    return <div className="h-screen w-screen bg-surface-0" />;
  }

  // No API key — show welcome/onboarding
  if (!hasApiKey) {
    return (
      <div className="flex h-screen w-screen flex-col overflow-hidden rounded-[10px] border-[2px] border-white/[0.04] bg-surface-0">
        <AppChrome />
        <div className="flex min-h-0 flex-1">
          <WelcomeScreen onComplete={handleWelcomeComplete} />
        </div>
      </div>
      );
  }

  if (!sessionHydrated) {
    return <div className="h-screen w-screen bg-surface-0" />;
  }

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden rounded-[10px] border-[2px] border-white/[0.10]"
      style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.8), 0 2px 8px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)' }}
    >
      <AppChrome />
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
          {activeView === 'chat' && (
            <ChatPanel
              key={chatKey}
              browserVisible={browserVisible}
              onToggleBrowser={handleToggleBrowser}
              onHideBrowser={handleHideBrowser}
              onShowBrowser={handleShowBrowser}
              terminalOpen={terminalOpen}
              onToggleTerminal={handleToggleTerminal}
              onOpenSettings={() => setActiveView('settings')}
              onOpenPendingApproval={handleOpenProcess}
              loadConversationId={loadConversationId}
              replayBuffer={replayBuffer}
              tabs={tabs}
              activeTabId={activeTabId}
              onNewTab={handleNewTab}
              onCloseTab={handleCloseTab}
              onSwitchTab={handleSwitchTab}
              onOpenConversation={handleOpenConversation}
              onConversationTitleResolved={handleConversationTitleResolved}
            />
          )}
          {activeView === 'conversations' && (
            <ConversationsView
              onBack={() => setActiveView('chat')}
              onLoadConversation={handleLoadConversation}
            />
          )}
          {activeView === 'processes' && (
            <ProcessesPanel
              onBack={() => setActiveView('chat')}
              initialRunId={selectedProcessId}
              onAttach={(conversationId, buffer) => {
                handleLoadConversation(conversationId, buffer);
              }}
            />
          )}
          {activeView === 'settings' && (
            <SettingsView onBack={() => setActiveView('chat')} />
          )}
          {activeView === 'agent-create' && (
            <CreateAgentPanel
              onBack={() => setActiveView('chat')}
              onCreated={(agent) => {
                setSelectedAgentId(agent.id);
                setActiveView('agent-detail');
              }}
            />
          )}
          {activeView === 'agent-detail' && (
            <AgentDetailPanel
              agentId={selectedAgentId}
              onBack={() => setActiveView('chat')}
              onDeleted={() => {
                setSelectedAgentId(null);
                setActiveView('chat');
              }}
            />
          )}
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

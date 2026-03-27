// src/renderer/tabLogic.ts

export interface ConversationTab {
  id: string;
  conversationId: string | null;
  title?: string;
}

export function makeTab(conversationId: string | null): ConversationTab {
  return {
    id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    conversationId,
  };
}

export function addTab(
  tabs: ConversationTab[],
  newTab: ConversationTab,
): { tabs: ConversationTab[]; activeTabId: string } {
  return {
    tabs: [...tabs, newTab],
    activeTabId: newTab.id,
  };
}

export function closeTab(
  tabs: ConversationTab[],
  tabId: string,
  activeTabId: string,
): { tabs: ConversationTab[]; activeTabId: string } {
  if (tabs.length <= 1) {
    return { tabs, activeTabId };
  }
  const closedIndex = tabs.findIndex(t => t.id === tabId);
  const nextTabs = tabs.filter(t => t.id !== tabId);
  let nextActiveTabId = activeTabId;
  if (activeTabId === tabId) {
    const fallbackIndex = Math.max(0, Math.min(closedIndex, nextTabs.length - 1));
    nextActiveTabId = nextTabs[fallbackIndex].id;
  }
  return { tabs: nextTabs, activeTabId: nextActiveTabId };
}

export function switchTab(
  _tabs: ConversationTab[],
  tabId: string,
): { activeTabId: string } {
  return { activeTabId: tabId };
}

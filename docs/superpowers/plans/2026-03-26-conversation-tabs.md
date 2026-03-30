# Conversation Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a thin numbered tab strip above the chat header so users can maintain multiple simultaneous conversations.

**Architecture:** Tab state (`tabs: ConversationTab[]`, `activeTabId`) lives in `App.tsx`. The tab strip is rendered inside `ChatPanel.tsx` as its first child, above the existing `<header>`. Pure renderer change — no IPC modifications.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Vitest (unit tests for tab logic)

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `src/renderer/App.tsx` | Modify | Add `ConversationTab` type, `tabs`/`activeTabId` state, `handleNewTab`/`handleCloseTab`/`handleSwitchTab` handlers, pass to `ChatPanel` |
| `src/renderer/components/ChatPanel.tsx` | Modify | Add tab props to `ChatPanelProps`, render `<TabStrip>` above `<header>` |
| `src/renderer/components/TabStrip.tsx` | Create | New component — pure presentational, renders the strip |
| `tests/renderer/tabLogic.test.ts` | Create | Unit tests for tab state transitions (no DOM needed) |

---

### Task 1: Write tab logic unit tests (failing)

**Files:**
- Create: `tests/renderer/tabLogic.test.ts`

The tab handlers in `App.tsx` will be extracted into a pure helper so they're testable without React. We test the helper first (TDD), then implement.

- [ ] **Step 1: Create the test file**

```typescript
// tests/renderer/tabLogic.test.ts
import { describe, it, expect } from 'vitest';
import {
  makeTab,
  addTab,
  closeTab,
  switchTab,
  type ConversationTab,
} from '../../src/renderer/tabLogic';

describe('makeTab', () => {
  it('creates a tab with a unique id and given conversationId', () => {
    const tab = makeTab('conv-1');
    expect(tab.id).toMatch(/^tab-/);
    expect(tab.conversationId).toBe('conv-1');
  });

  it('creates a tab with null conversationId when none given', () => {
    const tab = makeTab(null);
    expect(tab.conversationId).toBeNull();
  });
});

describe('addTab', () => {
  it('appends a new tab and returns it as active', () => {
    const existing: ConversationTab[] = [makeTab('conv-1')];
    const newTab = makeTab('conv-2');
    const result = addTab(existing, newTab);
    expect(result.tabs).toHaveLength(2);
    expect(result.tabs[1].conversationId).toBe('conv-2');
    expect(result.activeTabId).toBe(newTab.id);
  });
});

describe('closeTab', () => {
  it('removes the tab by id', () => {
    const t1 = makeTab('conv-1');
    const t2 = makeTab('conv-2');
    const t3 = makeTab('conv-3');
    const result = closeTab([t1, t2, t3], t2.id, t2.id);
    expect(result.tabs).toHaveLength(2);
    expect(result.tabs.find(t => t.id === t2.id)).toBeUndefined();
  });

  it('activates the previous tab when closing the active tab', () => {
    const t1 = makeTab('conv-1');
    const t2 = makeTab('conv-2');
    const result = closeTab([t1, t2], t2.id, t2.id);
    expect(result.activeTabId).toBe(t1.id);
  });

  it('activates the next tab when closing the first tab', () => {
    const t1 = makeTab('conv-1');
    const t2 = makeTab('conv-2');
    const result = closeTab([t1, t2], t1.id, t1.id);
    expect(result.activeTabId).toBe(t2.id);
  });

  it('does not change activeTabId when closing a non-active tab', () => {
    const t1 = makeTab('conv-1');
    const t2 = makeTab('conv-2');
    const result = closeTab([t1, t2], t2.id, t1.id);
    expect(result.activeTabId).toBe(t1.id);
  });

  it('refuses to close the last tab', () => {
    const t1 = makeTab('conv-1');
    const result = closeTab([t1], t1.id, t1.id);
    expect(result.tabs).toHaveLength(1);
    expect(result.activeTabId).toBe(t1.id);
  });
});

describe('switchTab', () => {
  it('returns the new activeTabId', () => {
    const t1 = makeTab('conv-1');
    const t2 = makeTab('conv-2');
    const result = switchTab([t1, t2], t2.id);
    expect(result.activeTabId).toBe(t2.id);
  });
});
```

- [ ] **Step 2: Run tests — expect them to fail (module not found)**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx vitest run tests/renderer/tabLogic.test.ts
```

Expected: FAIL — `Cannot find module '../../src/renderer/tabLogic'`

---

### Task 2: Implement tabLogic.ts (make tests pass)

**Files:**
- Create: `src/renderer/tabLogic.ts`

- [ ] **Step 1: Create the pure logic module**

```typescript
// src/renderer/tabLogic.ts

export interface ConversationTab {
  id: string;
  conversationId: string | null;
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
```

- [ ] **Step 2: Run tests — expect them to pass**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx vitest run tests/renderer/tabLogic.test.ts
```

Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
cd /home/dp/Desktop/clawdia7.0 && git add src/renderer/tabLogic.ts tests/renderer/tabLogic.test.ts && git commit -m "feat: add tab logic pure helpers with tests"
```

---

### Task 3: Create the TabStrip component

**Files:**
- Create: `src/renderer/components/TabStrip.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/renderer/components/TabStrip.tsx
import React from 'react';
import type { ConversationTab } from '../tabLogic';

interface TabStripProps {
  tabs: ConversationTab[];
  activeTabId: string;
  onSwitch: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: () => void;
}

export default function TabStrip({ tabs, activeTabId, onSwitch, onClose, onNew }: TabStripProps) {
  return (
    <div className="flex items-end px-2 h-6 flex-shrink-0 bg-surface-0 relative">
      {/* bottom border of the strip — active tab will sit above this */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-border-subtle" />

      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        const isOnly = tabs.length === 1;

        return (
          <div
            key={tab.id}
            onClick={() => { if (!isActive) onSwitch(tab.id); }}
            className={[
              'relative flex items-center gap-1 px-2.5 h-[22px] rounded-t cursor-pointer select-none text-[11px] transition-colors',
              isActive
                ? 'bg-surface-1 border border-b-0 border-white/[0.10] text-text-primary z-10'
                : 'text-text-muted hover:text-text-secondary group',
            ].join(' ')}
          >
            <span>{index + 1}</span>
            {!isOnly && (
              <span
                onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                className={[
                  'leading-none transition-colors cursor-pointer',
                  isActive
                    ? 'text-text-muted hover:text-text-primary'
                    : 'text-transparent group-hover:text-text-muted hover:!text-text-primary',
                ].join(' ')}
                title="Close tab"
              >
                ×
              </span>
            )}
          </div>
        );
      })}

      <button
        onClick={onNew}
        className="relative z-10 flex items-center justify-center w-5 h-[22px] text-text-muted hover:text-text-primary text-[14px] leading-none cursor-pointer transition-colors"
        title="New conversation"
      >
        +
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles — no errors**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors on `TabStrip.tsx` (there may be pre-existing errors elsewhere — that's fine)

- [ ] **Step 3: Commit**

```bash
cd /home/dp/Desktop/clawdia7.0 && git add src/renderer/components/TabStrip.tsx && git commit -m "feat: add TabStrip component"
```

---

### Task 4: Wire tab state into App.tsx

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Add imports and state to App.tsx**

At the top of `App.tsx`, add the import after the existing imports:

```typescript
import { makeTab, addTab, closeTab, switchTab, type ConversationTab } from './tabLogic';
import TabStrip from './components/TabStrip';
```

Then inside the `App()` function, after line 39 (`const [sessionHydrated, setSessionHydrated] = useState(false);`), add:

```typescript
const [tabs, setTabs] = useState<ConversationTab[]>(() => [makeTab(null)]);
const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id);
```

- [ ] **Step 2: Add the three tab handlers to App.tsx**

Add these three handlers after `handleNewChat` (after line 98):

```typescript
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
```

- [ ] **Step 3: Keep active tab's conversationId in sync**

When `handleLoadConversation` is called (e.g. from ConversationsView), update the active tab's conversationId so switching back to it works. Replace the existing `handleLoadConversation` (lines 100-107) with:

```typescript
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
```

Also update `handleNewChat` to reset the active tab's conversationId:

```typescript
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
```

- [ ] **Step 4: Pass tab props to ChatPanel**

In the JSX where `<ChatPanel>` is rendered (around line 261), add the three new props:

```tsx
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
/>
```

- [ ] **Step 5: Verify TypeScript — no new errors**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -40
```

Expected: TypeScript errors about `tabs`, `activeTabId`, `onNewTab`, `onCloseTab`, `onSwitchTab` not existing on `ChatPanelProps` — these get fixed in Task 5.

- [ ] **Step 6: Commit**

```bash
cd /home/dp/Desktop/clawdia7.0 && git add src/renderer/App.tsx && git commit -m "feat: add conversation tab state and handlers to App"
```

---

### Task 5: Wire TabStrip into ChatPanel.tsx

**Files:**
- Modify: `src/renderer/components/ChatPanel.tsx`

- [ ] **Step 1: Add tab props to ChatPanelProps interface**

Find the `ChatPanelProps` interface (lines 19-30) and add the new props:

```typescript
interface ChatPanelProps {
  browserVisible: boolean;
  onToggleBrowser: () => void;
  onHideBrowser: () => void;
  onShowBrowser: () => void;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  onOpenSettings: () => void;
  onOpenPendingApproval?: (processId: string) => void;
  loadConversationId?: string | null;
  replayBuffer?: Array<{ type: string; data: any }> | null;
  tabs: import('../tabLogic').ConversationTab[];
  activeTabId: string;
  onNewTab: () => void;
  onCloseTab: (tabId: string) => void;
  onSwitchTab: (tabId: string) => void;
}
```

- [ ] **Step 2: Destructure the new props in the ChatPanel function signature**

Find the ChatPanel function definition. It starts at approximately line 32 (after the banner components). The function signature destructures props — add the new ones:

```typescript
export default function ChatPanel({
  browserVisible,
  onToggleBrowser,
  onHideBrowser,
  onShowBrowser,
  terminalOpen,
  onToggleTerminal,
  onOpenSettings,
  onOpenPendingApproval,
  loadConversationId,
  replayBuffer,
  tabs,
  activeTabId,
  onNewTab,
  onCloseTab,
  onSwitchTab,
}: ChatPanelProps) {
```

- [ ] **Step 3: Import TabStrip at the top of ChatPanel.tsx**

Add after the existing imports:

```typescript
import TabStrip from './TabStrip';
```

- [ ] **Step 4: Render TabStrip as first child of the root div**

Find the return statement's root div (line ~1093):

```tsx
return (
  <div className="flex flex-col h-full">
    <header className="drag-region ...">
```

Insert `<TabStrip>` before the `<header>`:

```tsx
return (
  <div className="flex flex-col h-full">
    <TabStrip
      tabs={tabs}
      activeTabId={activeTabId}
      onSwitch={onSwitchTab}
      onClose={onCloseTab}
      onNew={onNewTab}
    />
    <header className="drag-region flex items-center gap-2 px-4 h-[44px] flex-shrink-0 bg-surface-1 border-b border-border-subtle shadow-[inset_0_-1px_6px_rgba(0,0,0,0.2),0_2px_8px_rgba(0,0,0,0.3)] relative z-10">
```

- [ ] **Step 5: Verify TypeScript — no errors on new files**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors on `ChatPanel.tsx`, `TabStrip.tsx`, `App.tsx`, or `tabLogic.ts`

- [ ] **Step 6: Run the test suite to confirm nothing is broken**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx vitest run
```

Expected: all tests PASS (including the new tabLogic tests)

- [ ] **Step 7: Commit**

```bash
cd /home/dp/Desktop/clawdia7.0 && git add src/renderer/components/ChatPanel.tsx && git commit -m "feat: render TabStrip in ChatPanel above header"
```

---

### Task 6: Initialize first tab with restored conversationId

**Files:**
- Modify: `src/renderer/App.tsx`

Currently `tabs` is initialized with `makeTab(null)`. When the session is hydrated and `loadConversationId` is restored from settings, the active tab's `conversationId` stays `null`. This task syncs them.

- [ ] **Step 1: Update the session hydration effect**

Find the `useEffect` that calls `api.settings.get('uiSession')` (around lines 54-73). After `setLoadConversationId(session.activeConversationId)`, also sync the initial tab:

```typescript
api.settings.get('uiSession')
  .then((session: UiSessionState | null) => {
    if (session?.activeView) setActiveView(session.activeView);
    if (session?.rightPaneMode) {
      setRightPaneMode(session.rightPaneMode);
    } else if (typeof session?.browserVisible === 'boolean') {
      setRightPaneMode(session.browserVisible ? 'browser' : 'none');
    }
    if (session?.activeConversationId) {
      setLoadConversationId(session.activeConversationId);
      setTabs(current =>
        current.map((t, i) => i === 0 ? { ...t, conversationId: session.activeConversationId } : t)
      );
    }
  })
  .finally(() => setSessionHydrated(true));
```

- [ ] **Step 2: Verify TypeScript — no errors**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -20
```

Expected: clean output (no errors)

- [ ] **Step 3: Run all tests**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx vitest run
```

Expected: all PASS

- [ ] **Step 4: Commit**

```bash
cd /home/dp/Desktop/clawdia7.0 && git add src/renderer/App.tsx && git commit -m "feat: sync restored conversationId into initial tab on hydration"
```

---

### Task 7: Manual smoke test

- [ ] **Step 1: Start the dev server**

```bash
cd /home/dp/Desktop/clawdia7.0 && npm run dev
```

- [ ] **Step 2: Verify the tab strip appears**

Open the app. You should see a thin strip above the chat header containing `[1] +`.

- [ ] **Step 3: Verify new tab**

Click `+`. A second tab `[2]` should appear and become active. The chat should reset to an empty state.

- [ ] **Step 4: Verify switching**

Click tab `[1]`. The previous conversation should load.

- [ ] **Step 5: Verify close**

With 2+ tabs open, click `×` on a tab. It should close and the adjacent tab should become active. With only 1 tab, no `×` should be visible.

- [ ] **Step 6: Stop dev server and do final commit if any fixes were needed**

```bash
# Ctrl+C to stop dev server
cd /home/dp/Desktop/clawdia7.0 && git add -p && git commit -m "fix: smoke test corrections"
# (only if changes were needed)
```

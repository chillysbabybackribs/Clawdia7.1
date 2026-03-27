# Chat History Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist chat tabs across app restarts and add an inline history browser (date-grouped, accessible via a new icon in the bottom bar) that opens past conversations into tabs smartly.

**Architecture:** Tab state (`ConversationTab[]` + `activeTabId`) is serialized into the existing electron-store `uiSession` key on every change and restored on startup. The history browser is a new `HistoryBrowser` component that renders inside `ChatPanel`'s message list area when `historyMode` is true, driven by the existing `api.chat.list()` IPC call. Smart tab opening lives in `App.tsx` as `handleOpenConversation`.

**Tech Stack:** React (useState, useEffect, useCallback), TypeScript, Electron IPC (existing), electron-store (existing `api.settings.get/set`)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/renderer/tabLogic.ts` | Modify | Add `title?: string` to `ConversationTab` |
| `src/main/registerIpc.ts` | Modify | Add `title` field to `CHAT_LOAD` response |
| `src/renderer/App.tsx` | Modify | Persist full tab array in `uiSession`; restore on hydration; add `handleOpenConversation`; update active tab title on load; pass `onOpenConversation` to `ChatPanel` |
| `src/renderer/components/TabStrip.tsx` | Modify | Display `tab.title ?? 'New Chat'` instead of `Chat N` |
| `src/renderer/components/HistoryBrowser.tsx` | Create | Grouped conversation list with close, error, and open logic |
| `src/renderer/components/ChatPanel.tsx` | Modify | Add `historyMode` state; history icon button; conditional render; `disabled` InputBar; accept `onOpenConversation` prop |

---

### Task 1: Add `title` to `ConversationTab` and `CHAT_LOAD` response

**Files:**
- Modify: `src/renderer/tabLogic.ts`
- Modify: `src/main/registerIpc.ts`

- [ ] **Step 1: Update `ConversationTab` interface**

In `src/renderer/tabLogic.ts`, change:

```ts
export interface ConversationTab {
  id: string;
  conversationId: string | null;
}
```

to:

```ts
export interface ConversationTab {
  id: string;
  conversationId: string | null;
  title?: string;
}
```

- [ ] **Step 2: Add `title` to `CHAT_LOAD` response**

In `src/main/registerIpc.ts`, the `CHAT_LOAD` handler (around line 379) currently returns:

```ts
return {
  messages,
  mode: 'chat' as const,
  claudeTerminalStatus: 'idle' as const,
};
```

Change it to include the conversation title:

```ts
const conv = getConversation(id);
return {
  messages,
  mode: conv?.mode ?? ('chat' as const),
  claudeTerminalStatus: 'idle' as const,
  title: conv?.title ?? null,
};
```

Note: `getConversation` is already imported at line 17 of `registerIpc.ts`. The existing `CHAT_GET_MODE` handler also calls it, so this is safe.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/tabLogic.ts src/main/registerIpc.ts
git commit -m "feat(chat-history): add title to ConversationTab and CHAT_LOAD response"
```

---

### Task 2: Update `TabStrip` to display tab titles

**Files:**
- Modify: `src/renderer/components/TabStrip.tsx:31`

- [ ] **Step 1: Replace positional label with title**

In `src/renderer/components/TabStrip.tsx`, find line 31:

```tsx
<span>Chat {index + 1}</span>
```

Replace with:

```tsx
<span>{tab.title ?? 'New Chat'}</span>
```

- [ ] **Step 2: Verify build compiles**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors (or only pre-existing unrelated errors).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/TabStrip.tsx
git commit -m "feat(chat-history): show conversation title in tab strip"
```

---

### Task 3: Persist and restore full tab array in `App.tsx`

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Update `UiSessionState` interface**

In `App.tsx`, find the `UiSessionState` interface (around line 21):

```ts
interface UiSessionState {
  activeConversationId: string | null;
  activeView: View;
  rightPaneMode?: RightPaneMode;
  browserVisible?: boolean;
}
```

Replace with:

```ts
interface UiSessionState {
  tabs?: ConversationTab[];
  activeTabId?: string;
  activeView: View;
  rightPaneMode?: RightPaneMode;
  browserVisible?: boolean;
  // legacy field — kept for backwards compatibility on first restore
  activeConversationId?: string | null;
}
```

Also add the import for `ConversationTab` at the top of the import from `./tabLogic` — it's already imported: `import { makeTab, addTab, closeTab, switchTab, type ConversationTab } from './tabLogic';` ✓

- [ ] **Step 2: Update hydration `useEffect` to restore tabs**

Find the hydration effect (around line 57) that calls `api.settings.get('uiSession')`. Replace it entirely:

```ts
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
```

- [ ] **Step 3: Update save `useEffect` to persist full tab array**

Find the save effect (around line 83):

```ts
useEffect(() => {
  if (!sessionHydrated || !hasApiKey) return;
  (window as any).clawdia?.settings?.set('uiSession', {
    activeConversationId: loadConversationId,
    activeView,
    rightPaneMode,
    browserVisible: rightPaneMode === 'browser',
  });
}, [sessionHydrated, hasApiKey, loadConversationId, activeView, rightPaneMode]);
```

Replace with:

```ts
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
```

- [ ] **Step 4: Update active tab title when a conversation loads**

In `App.tsx`, find `handleLoadConversation` (around line 111). After `setLoadConversationId(id)`, we need to update the tab title. The title comes back in the `CHAT_LOAD` response, but that call happens inside `ChatPanel`. The cleanest approach: add an `onConversationTitleResolved` callback prop to `ChatPanel` that fires once the load completes with the title.

Add a new callback in `App.tsx`:

```ts
const handleConversationTitleResolved = useCallback((tabId: string, title: string) => {
  setTabs(current =>
    current.map(t => t.id === tabId ? { ...t, title } : t)
  );
}, []);
```

Pass it to `ChatPanel`:
```tsx
<ChatPanel
  ...
  activeTabId={activeTabId}
  onConversationTitleResolved={handleConversationTitleResolved}
  ...
/>
```

- [ ] **Step 5: Add `handleOpenConversation`**

Add this function in `App.tsx` (after `handleSwitchTab`):

```ts
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
```

Pass it to `ChatPanel`:
```tsx
onOpenConversation={handleOpenConversation}
```

- [ ] **Step 6: TypeScript check**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(chat-history): persist and restore full tab array via uiSession"
```

---

### Task 4: Create `HistoryBrowser` component

**Files:**
- Create: `src/renderer/components/HistoryBrowser.tsx`

- [ ] **Step 1: Create the component**

Create `src/renderer/components/HistoryBrowser.tsx` with this content:

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import type { ConversationTab } from '../../renderer/tabLogic';

interface ConvItem {
  id: string;
  title: string;
  updatedAt: string;
}

interface HistoryBrowserProps {
  currentTabs: ConversationTab[];
  onSelectConversation: (id: string) => void;
  onClose: () => void;
}

type DateGroup = 'Today' | 'Yesterday' | 'Last 7 days' | 'Older';

function getDateGroup(isoDate: string): DateGroup {
  const diff = Date.now() - new Date(isoDate).getTime();
  const days = diff / (1000 * 60 * 60 * 24);
  if (days < 1) return 'Today';
  if (days < 2) return 'Yesterday';
  if (days < 7) return 'Last 7 days';
  return 'Older';
}

function formatDate(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

const GROUP_ORDER: DateGroup[] = ['Today', 'Yesterday', 'Last 7 days', 'Older'];

export default function HistoryBrowser({ currentTabs, onSelectConversation, onClose }: HistoryBrowserProps) {
  const [conversations, setConversations] = useState<ConvItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const api = (window as any).clawdia;
    try {
      const list = await api.chat.list();
      setConversations(list || []);
    } catch {
      setError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openTabIds = new Set(currentTabs.map(t => t.conversationId).filter(Boolean));

  const grouped = GROUP_ORDER.reduce<Record<DateGroup, ConvItem[]>>(
    (acc, g) => { acc[g] = []; return acc; },
    {} as Record<DateGroup, ConvItem[]>
  );
  for (const c of conversations) {
    grouped[getDateGroup(c.updatedAt)].push(c);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <span className="text-[13px] font-semibold text-text-primary tracking-wide">Chat History</span>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-7 h-7 rounded-md text-text-muted hover:text-text-primary hover:bg-white/[0.06] transition-all cursor-pointer text-[16px] leading-none"
          title="Close history"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {loading && (
          <div className="flex items-center justify-center h-24 text-[13px] text-text-muted">
            Loading…
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center justify-center h-24 gap-2">
            <span className="text-[13px] text-text-muted">Failed to load history.</span>
            <button
              onClick={load}
              className="text-[12px] text-text-secondary underline hover:text-text-primary cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && conversations.length === 0 && (
          <div className="flex items-center justify-center h-24 text-[13px] text-text-muted">
            No conversations yet.
          </div>
        )}

        {!loading && !error && GROUP_ORDER.map(group => {
          const items = grouped[group];
          if (items.length === 0) return null;
          return (
            <div key={group} className="mb-4">
              <div className="px-1 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted opacity-60">
                {group}
              </div>
              {items.map(conv => {
                const isOpen = openTabIds.has(conv.id);
                return (
                  <button
                    key={conv.id}
                    onClick={() => { onSelectConversation(conv.id); onClose(); }}
                    className="w-full flex items-center justify-between px-3 py-[9px] rounded-lg text-left cursor-pointer transition-all hover:bg-white/[0.05] group"
                  >
                    <span
                      className="text-[13px] text-text-primary truncate flex-1 mr-3"
                      style={{ opacity: isOpen ? 0.5 : 1 }}
                    >
                      {conv.title || 'Untitled'}
                    </span>
                    <span className="text-[11px] text-text-muted flex-shrink-0 opacity-60">
                      {isOpen ? 'open' : formatDate(conv.updatedAt)}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/HistoryBrowser.tsx
git commit -m "feat(chat-history): add HistoryBrowser component with date-grouped conversations"
```

---

### Task 5: Wire `HistoryBrowser` into `ChatPanel`

**Files:**
- Modify: `src/renderer/components/ChatPanel.tsx`

- [ ] **Step 1: Add new props to `ChatPanelProps`**

Find the `ChatPanelProps` interface (around line 29). Add:

```ts
onOpenConversation: (id: string) => void;
onConversationTitleResolved: (tabId: string, title: string) => void;
```

- [ ] **Step 2: Destructure new props in the component function**

Find the destructuring of `ChatPanel` props (around line 460). Add:

```ts
onOpenConversation,
onConversationTitleResolved,
```

- [ ] **Step 3: Add `historyMode` state**

Near the top of `ChatPanel`'s state declarations, add:

```ts
const [historyMode, setHistoryMode] = useState(false);
```

- [ ] **Step 4: Call `onConversationTitleResolved` after load**

Inside the `useEffect` that calls `api.chat.load(loadConversationId)` (around line 733), after `setLoadedConversationId(loadConversationId)`, add:

```ts
if (result.title && activeTabId) {
  onConversationTitleResolved(activeTabId, result.title);
}
```

The full `.then` block becomes:

```ts
api.chat.load(loadConversationId).then((result: any) => {
  replayedBufferRef.current = null;
  assistantMsgIdRef.current = null;
  feedRef.current = [];
  setStreamMap({});
  setWorkflowPlanDraft('');
  setIsWorkflowPlanStreaming(false);
  setIsStreaming(false);
  setShimmerText('');
  thinkingQueueRef.current = [];
  thinkingBatchRef.current = [];
  clearThinkingAdvanceTimer();
  setMessages(result.messages || []);
  setLoadedConversationId(loadConversationId);
  setConversationMode(result.mode || 'chat');
  setClaudeStatus(result.claudeTerminalStatus || 'idle');
  if (result.title && activeTabId) {
    onConversationTitleResolved(activeTabId, result.title);
  }
  requestAnimationFrame(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  });
}).catch(() => {});
```

- [ ] **Step 5: Add history icon button to the icons row**

Find the icons row (around line 1102):

```tsx
{/* Icons row — terminal + settings */}
<div
  className="drag-region flex items-center justify-end gap-1 px-2 h-[44px] flex-shrink-0 relative z-10"
  ...
>
  <button onClick={onToggleTerminal} ...>...</button>
  <button onClick={onOpenSettings} ...>...</button>
</div>
```

Add the history button **before** the terminal button:

```tsx
<button
  onClick={() => setHistoryMode(m => !m)}
  title={historyMode ? 'Close history' : 'Chat history'}
  className={`no-drag flex items-center justify-center w-8 h-8 rounded-lg transition-all cursor-pointer ${
    historyMode
      ? 'bg-white/[0.08] text-text-primary'
      : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.06]'
  }`}
>
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
</button>
```

- [ ] **Step 6: Conditionally render `HistoryBrowser` vs message list**

Find the message list scroll div (around line 1132):

```tsx
<div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth">
  ...
</div>
```

Wrap it in a conditional and add the import:

At the top of `ChatPanel.tsx`, add the import:
```tsx
import HistoryBrowser from './HistoryBrowser';
```

Replace the scroll div with:
```tsx
{historyMode ? (
  <div className="flex-1 overflow-hidden">
    <HistoryBrowser
      currentTabs={tabs}
      onSelectConversation={onOpenConversation}
      onClose={() => setHistoryMode(false)}
    />
  </div>
) : (
  <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth">
    <div className="flex flex-col gap-4 px-4 pt-5 pb-8 max-w-[720px]">
      {/* existing message content unchanged */}
    </div>
  </div>
)}
```

Keep all existing message list content inside the existing div unchanged.

- [ ] **Step 7: Disable `InputBar` in history mode**

Find where `InputBar` is rendered in `ChatPanel` (search for `<InputBar`). Add a `disabled` prop:

First add `disabled?: boolean` to `InputBarProps` in `InputBar.tsx`:

In `src/renderer/components/InputBar.tsx`, add to `InputBarProps`:
```ts
disabled?: boolean;
```

And destructure it:
```ts
disabled = false,
```

Then in the textarea element, add:
```tsx
disabled={disabled || isStreaming}
```

And on the send button wrapper, add `pointer-events-none opacity-40` when `disabled`:
```tsx
className={`... ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
```

Back in `ChatPanel.tsx`, pass the prop:
```tsx
<InputBar
  ...
  disabled={historyMode}
/>
```

- [ ] **Step 8: TypeScript check**

```bash
cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/components/ChatPanel.tsx src/renderer/components/InputBar.tsx
git commit -m "feat(chat-history): wire HistoryBrowser into ChatPanel with history icon"
```

---

### Task 6: Close history mode when switching tabs

**Files:**
- Modify: `src/renderer/components/ChatPanel.tsx`

When the user switches tabs (via `TabStrip`), `ChatPanel` is re-mounted due to `key={chatKey}` in `App.tsx`, so `historyMode` resets to `false` automatically. No extra work needed.

However, verify this is the case:

- [ ] **Step 1: Verify `ChatPanel` key reset on tab switch**

In `App.tsx`, confirm `handleSwitchTab` calls `setChatKey(k => k + 1)`:

```ts
const handleSwitchTab = useCallback((tabId: string) => {
  const result = switchTab(tabs, tabId);
  setActiveTabId(result.activeTabId);
  const tab = tabs.find(t => t.id === tabId);
  if (tab?.conversationId) {
    setLoadConversationId(tab.conversationId);
    setReplayBuffer(null);
    setChatKey(k => k + 1);   // ← this re-mounts ChatPanel, resetting historyMode
  } else {
    setLoadConversationId(null);
    setReplayBuffer(null);
    setChatKey(k => k + 1);
  }
  setActiveView('chat');
}, [tabs]);
```

This is already present at line 163 of `App.tsx`. No code change needed.

- [ ] **Step 2: Commit note**

No code change — verified by inspection. Continue to Task 7.

---

### Task 7: End-to-end smoke test

**Files:** No code changes — manual verification steps.

- [ ] **Step 1: Build and launch**

```bash
cd /home/dp/Desktop/clawdia7.0 && npm run dev
```

- [ ] **Step 2: Verify tab persistence**
  1. Open the app
  2. Create 2-3 conversations by sending at least one message in each
  3. Note the tab titles — they should show the conversation title, not "Chat 1", "Chat 2"
  4. Quit the app (`Ctrl+Q` or window close)
  5. Relaunch — the same tabs should be restored with their titles and conversation history visible

- [ ] **Step 3: Verify history browser**
  1. Click the clock icon in the bottom icon bar (left of terminal icon)
  2. The message list area should replace with the history browser showing conversations grouped by date
  3. The input bar should be visually greyed out and non-interactive
  4. Click a conversation — if already open in a tab, it should switch to that tab; otherwise open in a new tab
  5. History mode should close after selecting a conversation
  6. Clicking the clock icon again (or ×) should close history mode

- [ ] **Step 4: Verify error state**
  1. If you can simulate a failed `api.chat.list()` (e.g., temporarily break the IPC handler), the history browser should show "Failed to load history." with a Retry button

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Tab survival across restarts (Tasks 1, 3)
- ✅ Tab titles from conversation data (Tasks 1, 5)
- ✅ History icon in bottom icon bar (Task 5)
- ✅ History replaces message list area (Task 5)
- ✅ Input bar stays but disabled (Task 5)
- ✅ Date-grouped conversation list (Task 4)
- ✅ Smart tab opening: switch or new (Task 3, `handleOpenConversation`)
- ✅ Error handling: malformed session → fallback (Task 3 hydration)
- ✅ Error handling: failed list call → retry button (Task 4)
- ✅ Close via × or icon re-click (Tasks 4, 5)

**Type consistency:**
- `ConversationTab.title?: string` defined in Task 1, used in Tasks 2, 3, 4
- `onOpenConversation(id: string)` defined in Task 3, passed in Task 5
- `onConversationTitleResolved(tabId: string, title: string)` defined in Task 3, called in Task 5
- `result.title` comes from `CHAT_LOAD` response updated in Task 1
- `HistoryBrowserProps.currentTabs: ConversationTab[]` matches type from Task 1

**No placeholders:** All steps contain complete code.

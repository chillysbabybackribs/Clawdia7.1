# Chat History Persistence — Design Spec
**Date:** 2026-03-27
**Status:** Approved

---

## Overview

Add two capabilities to Clawdia's chat UI:
1. **Tab persistence** — open tabs survive app restarts, restored with their conversations and titles
2. **History browser** — a history icon in the bottom icon bar replaces the message list with a date-grouped conversation browser; selecting a conversation opens it smartly (switch to existing tab or open new tab)

---

## Architecture

### 1. Tab Persistence

**Where:** `App.tsx` + `tabLogic.ts` + `src/shared/types.ts` (or tabLogic interface)

**What changes:**

- `ConversationTab` interface gains an optional `title?: string` field
- The `uiSession` object stored in electron-store (via `api.settings.set/get`) expands from:
  ```ts
  { activeConversationId, activeView, rightPaneMode }
  ```
  to:
  ```ts
  { tabs: ConversationTab[], activeTabId, activeView, rightPaneMode }
  ```
- On startup, the hydration `useEffect` in `App.tsx` reads `tabs` and `activeTabId` from the saved session and restores them (replacing the default single empty tab). If no saved tabs exist, falls back to the current default behavior.
- The save `useEffect` in `App.tsx` writes the full `tabs` array and `activeTabId` on every change, replacing the current single-conversation write.
- Tab titles are populated when a conversation loads: the `CHAT_LOAD` response includes the conversation's `title` from the DB. `App.tsx` updates the active tab's `title` field at that point.
- `TabStrip` uses `tab.title ?? 'New Chat'` for display instead of the current positional "Chat N" label.

**No new IPC channels needed.** Tab state is renderer-only; electron-store is already accessible via `api.settings`.

---

### 2. History Icon in Bottom Bar

**Where:** `ChatPanel.tsx`

**What changes:**

- A new `historyMode: boolean` state is added to `ChatPanel`
- A history icon button (clock/scroll SVG) is added to the left of the terminal + settings buttons in the icons row (lines 1102–1130). It follows the same active-state pattern as the terminal button: highlighted when `historyMode` is true
- When `historyMode` is true:
  - The message list area (`div ref={scrollRef}`) is replaced by `<HistoryBrowser />`
  - The `InputBar` remains rendered but receives a `disabled` prop that greys it out and prevents interaction
- Clicking the history icon again (or the `×` inside `HistoryBrowser`) sets `historyMode = false`
- `ChatPanel` gains a new prop: `onOpenConversation: (id: string) => void` (delegated up from `App.tsx`)

---

### 3. HistoryBrowser Component

**Where:** `src/renderer/components/HistoryBrowser.tsx` (new file)

**Props:**
```ts
interface HistoryBrowserProps {
  currentTabs: ConversationTab[];         // to detect already-open conversations
  onSelectConversation: (id: string) => void;
  onClose: () => void;
}
```

**Behavior:**
- Calls `api.chat.list()` on mount; shows a loading state while fetching
- Groups conversations into date buckets: **Today**, **Yesterday**, **Last 7 days**, **Older**
- Each row shows: conversation title (left) + relative date (right), with a hover highlight
- On row click: calls `onSelectConversation(id)` and `onClose()`
- `onClose` button (×) in the top-right of the browser area closes history mode

**No new IPC.** Uses existing `api.chat.list()` which maps to `CHAT_LIST`.

---

### 4. Smart Tab Opening (`handleOpenConversation` in `App.tsx`)

**Logic:**
1. Check if any tab in `tabs` already has `conversationId === id`
   - Yes → call `handleSwitchTab` to that tab, set `historyMode = false`
   - No → create a new tab pre-loaded with `id` (like `handleNewTab` but with conversationId set), set `historyMode = false`

This callback is passed as `onOpenConversation` into `ChatPanel`, then into `HistoryBrowser` as `onSelectConversation`.

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/renderer/components/HistoryBrowser.tsx` | New history browser component |

## Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/tabLogic.ts` | Add `title?: string` to `ConversationTab` |
| `src/renderer/App.tsx` | Extend `uiSession` persistence; add `handleOpenConversation`; pass new prop to `ChatPanel`; update tab title on load |
| `src/renderer/components/ChatPanel.tsx` | Add `historyMode` state; add history icon button; conditionally render `HistoryBrowser` vs message list; disable `InputBar` in history mode; accept `onOpenConversation` prop |
| `src/renderer/components/TabStrip.tsx` | Use `tab.title ?? 'New Chat'` instead of positional label |

## Files NOT changed

- `src/main/db.ts` — schema already has conversation titles
- `src/main/ipc-channels.ts` — no new IPC needed
- `src/main/registerIpc.ts` — no new IPC needed
- `src/shared/types.ts` — tab type lives in `tabLogic.ts`

---

## Data Flow

```
App restart
  └─ api.settings.get('uiSession')
       └─ tabs[], activeTabId → restored into React state
            └─ active tab's conversationId → CHAT_LOAD → title → tab.title updated

History icon clicked
  └─ historyMode = true
       └─ HistoryBrowser renders in message list area
            └─ api.chat.list() → grouped by date
                 └─ user clicks conversation
                      └─ onSelectConversation(id)
                           └─ App.handleOpenConversation(id)
                                ├─ tab already open? → switchTab
                                └─ no? → new tab with conversationId
                      └─ onClose() → historyMode = false
```

---

## Error Handling

- If `api.chat.list()` fails in `HistoryBrowser`, show an inline error message with a retry button
- If saved `uiSession.tabs` is malformed on restore, fall back to a single empty tab (same as current default)
- If a saved conversation ID no longer exists in the DB (deleted externally), the tab loads with an empty chat — same behavior as today for a tab with a missing conversationId

---

## Out of Scope

- Conversation search/filter in the history browser (can be added later)
- Conversation renaming from the history browser
- Pinned/starred conversations
- Pagination for very large conversation lists

# Conversation Tabs — Design Spec
**Date:** 2026-03-26

## Overview

Add a thin strip of numbered conversation tabs to the top of the chat panel. Tabs let users maintain multiple simultaneous conversations and switch between them without going through the Conversations view. No words — just numbers and close buttons.

---

## Layout

A tab strip of approximately 24px height sits **above** the existing 44px chat `<header>` bar, inside the chat panel's flex column. It touches the top border of the chat panel and has its own bottom border that separates it visually from the header row below.

```
┌─────────────────────────────────────────────┐  ← chat panel top border
│ [1] [2] [3] +                               │  ← tab strip (~24px)
├─────────────────────────────────────────────┤  ← strip/header divider
│ (drag region)         [terminal] [settings] │  ← existing header (44px)
├─────────────────────────────────────────────┤
│                                             │
│  chat messages                              │
│                                             │
└─────────────────────────────────────────────┘
```

The existing `<header>` and all its controls are **unchanged**.

---

## Tab Anatomy

Each tab contains:
- A **number** (1-based index, e.g. `1`, `2`, `3`)
- A **`×` close icon** (hidden on hover for inactive tabs; always visible on active tab)
- No label text

**Active tab style (Option A — filled card):**
- Background matches the header surface color (`bg-surface-1`)
- Top, left, right border: `border-white/[0.10]`
- No bottom border (visually merges with the header row below)
- Text color: `text-text-primary`
- `z-index` above the strip bottom border so the gap trick works

**Inactive tab style:**
- No background fill
- Dim border or no border
- Text color: `text-text-muted`
- `×` icon hidden by default, visible on hover

**`+` button:**
- Sits immediately right of the last tab
- Same vertical alignment as tabs
- Single `+` character or small icon
- Text color: `text-text-muted`, hover: `text-text-primary`
- Calls `handleNewTab()` on click

---

## State Management

State lives entirely in the **renderer** (`App.tsx`). No IPC changes required.

```typescript
interface ConversationTab {
  id: string;           // stable tab identity: `tab-${Date.now()}-${Math.random()}`
  conversationId: string | null;  // null until a conversation is created/loaded
}
```

**App.tsx additions:**
- `tabs: ConversationTab[]` — list of open tabs (min 1)
- `activeTabId: string` — which tab is active

**Handlers:**
- `handleNewTab()` — calls `window.clawdia.chat.new()`, appends a new tab with the returned `conversationId`, sets it active
- `handleCloseTab(tabId)` — removes tab; if it was active, activates the previous tab (or next if it was first); last tab cannot be closed (no `×` shown)
- `handleSwitchTab(tabId)` — calls `handleLoadConversation(tab.conversationId)` and sets `activeTabId`

**Initialization:** On app load, the single existing tab wraps the current `loadConversationId`.

---

## Component Changes

### `App.tsx`
- Add `tabs` and `activeTabId` state
- Replace bare `loadConversationId` management with tab-aware handlers
- Pass `tabs`, `activeTabId`, `onNewTab`, `onCloseTab`, `onSwitchTab` down to `ChatPanel`

### `ChatPanel.tsx`
- Accept new props: `tabs`, `activeTabId`, `onNewTab`, `onCloseTab`, `onSwitchTab`
- Render a `<div>` tab strip as the **first child** of the root `flex flex-col h-full` container, before `<header>`
- Tab strip uses `flex items-end px-2` with `h-6` (24px)

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Only 1 tab open | No `×` shown on that tab |
| Close active tab | Previous tab becomes active; if none, next tab |
| New tab while streaming | Switching tab pauses/leaves stream in background tab's state |
| App restart | Tabs are not persisted — always starts with 1 tab |

---

## Out of Scope

- Tab persistence across app restarts
- Drag-to-reorder tabs
- Tab titles / conversation names
- Keyboard shortcuts for tab switching (can be added later)

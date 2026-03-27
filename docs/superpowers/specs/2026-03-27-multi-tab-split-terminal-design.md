# Multi-Tab Split Terminal — Design Spec

**Date:** 2026-03-27
**Status:** Approved
**Scope:** `src/renderer/components/TerminalPanel.tsx` only — no changes to main process, IPC, or `TerminalSessionController`

---

## Overview

Replace the current single-session `TerminalPanel.tsx` with a multi-tab, vertically-split terminal panel. Each terminal is a fully independent PTY session — separate shell, separate CWD, separate history. The backend already supports multiple named sessions; this feature is entirely a UI-layer change.

---

## Component Structure

`TerminalPanel.tsx` becomes a container component that owns all tab and split state. Three sub-components are extracted:

### `TerminalTabBar`
Tab strip rendered at the top of the terminal pane.

- Tab pills: each shows a title ("Terminal 1", "Terminal 2", etc.) and an × close button. Active tab is highlighted.
- **+ button**: opens a new independent shell tab
- **Split button** (right side of tab bar): toggles split pane. When no split is active, spawns a new shell in the bottom pane. When split is active, closes and kills the bottom session.
- **Observe button** (visible only when split is active): converts the bottom pane to observe mode, mirroring the active tab's session read-only. Clicking again reverts to independent shell.
- Tabs are not reorderable.
- Cannot close the last tab.

### `TerminalPane`
A single xterm.js instance bound to one session ID. This is the current `TerminalPanel` logic stripped of tab/split concerns. Responsibilities:
- Spawns its PTY session on mount, kills it on unmount
- Owns its own xterm.js Terminal instance and FitAddon
- Has its own ResizeObserver for responsive sizing
- Displays ownership badges, disabled-input state, agent-controlled indicator, takeover button — all scoped to its own session

### `TerminalSplitContainer`
Renders as a flex column:
- When no split: renders single `TerminalPane` at 100% height
- When split active: renders top `TerminalPane` + 4px draggable horizontal divider + bottom `TerminalPane`
- Divider drag updates `splitRatio` in real-time via `mousemove`
- Minimum height per pane: 80px (prevents collapsing to zero)
- Default split ratio: 0.5

---

## State (held in `TerminalPanel`)

```typescript
interface TerminalTab {
  id: string;          // unique tab ID
  sessionId: string;   // PTY session ID, e.g. 'terminal-tab-1743100000000'
  title: string;       // display name, e.g. 'Terminal 1'
}

// Component state:
tabs: TerminalTab[]
activeTabId: string
splitSessionId: string | null   // null = no split active
splitRatio: number               // 0.0–1.0, default 0.5
```

Per-tab session state (ownership, mode, runId, conversationId) moves into `TerminalPane` — each pane manages its own session state independently.

---

## Session ID Naming

- Tab sessions: `terminal-tab-{Date.now()}`
- Split session: `terminal-split-{Date.now()}`

The legacy `'main-terminal'` session ID is retired. On first mount, `TerminalPanel` creates one tab with a `terminal-tab-{timestamp}` ID.

---

## Session Lifecycle

| Event | Action |
|-------|--------|
| Tab created | `api.terminal.spawn(sessionId)` |
| Tab closed | `api.terminal.kill(sessionId)`, remove from tabs array |
| Split opened | Generate `terminal-split-{ts}`, `api.terminal.spawn(splitSessionId)` |
| Split closed | `api.terminal.kill(splitSessionId)`, set `splitSessionId = null` |
| `TerminalPanel` unmounts | Kill all active sessions |

---

## Split Pane Layout

```
┌────────────────────────────────────┐
│  [Terminal 1] [Terminal 2] [+] [⊟] │  ← TerminalTabBar
├────────────────────────────────────┤
│                                    │
│         Top TerminalPane           │  ← active tab session
│         (splitRatio * height)      │
│                                    │
├──────── draggable divider ─────────┤  ← 4px, row-resize cursor
│                                    │
│        Bottom TerminalPane         │  ← split session (independent)
│      ((1-splitRatio) * height)     │
│                                    │
└────────────────────────────────────┘
```

Split is **top/bottom only** (vertical stacking). No side-by-side layout.

---

## Observe Mode

When the Observe button is active, the bottom pane subscribes to the active tab's session ID in read-only mode (`observe_only`). It receives the same `TERMINAL_DATA` events but does not write. It does not own its own PTY session while observing.

Converting back to independent shell: kills the observe subscription, spawns a new `terminal-split-{ts}` session.

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| node-pty unavailable | Show "Terminal not available" — no tabs or split rendered |
| Session spawn fails | Inline error in the pane with a "Retry" button |
| PTY exits unexpectedly | Pane shows exit notice with code; "Press any key to restart" |
| Split pane observe source exits | Bottom pane shows dead state with restart prompt |
| Closing last tab | Blocked — button disabled |
| Agent-owned session | Ownership badge, disabled input, takeover button — scoped per pane |

---

## State Persistence

None. On app launch, `TerminalPanel` always starts with a single fresh tab. `splitRatio` always defaults to 0.5 on each new split. PTY sessions cannot be meaningfully resumed after restart.

---

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/components/TerminalPanel.tsx` | Full rewrite — becomes container, extracts sub-components |

**No changes to:**
- `src/main/core/terminal/TerminalSessionController.ts`
- `src/main/registerTerminalIpc.ts`
- `src/main/ipc-channels.ts`
- `src/main/preload.ts`
- `src/shared/types.ts`
- Any other file

---

## Out of Scope

- Tab reordering
- Persisting tab layout across restarts
- Side-by-side (horizontal) split
- More than one split pane at a time
- Keyboard shortcuts for tab/split management

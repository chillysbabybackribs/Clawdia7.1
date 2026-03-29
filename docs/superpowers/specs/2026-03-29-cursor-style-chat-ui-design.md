# Cursor-Style Chat UI Redesign

**Date:** 2026-03-29
**Status:** Approved

## Overview

Redesign the Clawdia chat UI across all conversation modes (chat, claude_terminal, codex_terminal) to match the Cursor IDE's Claude Code chat panel aesthetic. This covers message layout, tool call visualization, input bar premium update, and streaming indicators.

## Section 1: Message Layout

### User Messages
- Remove right-alignment (`items-end`) — left-align all messages
- Replace bubble style (`rounded-2xl rounded-br-md bg-neutral-700/60`) with full-width dark rounded box
- New styling: `bg-white/[0.04]` background, `border border-white/[0.06]`, `rounded-xl`, `px-4 py-3`
- Remove `max-w-[85%]` constraint — full width
- White text, `whitespace-pre-wrap`
- Attachments render above text inside the box
- Keep timestamp and copy button below

### Assistant Messages
- Keep left-aligned, no bubble, no background (already matches Cursor)
- Remove `max-w-[92%]` — let content fill available width
- Markdown rendering via MarkdownRenderer unchanged

### Container
- Remove `max-w-[720px]` from the message scroll container
- Let messages fill panel width with comfortable padding (`px-5`)
- Keep `gap-4` between messages

### Files Changed
- `src/renderer/components/ChatPanel.tsx` — `UserMessage` component, `AssistantMessage` component, scroll container div

## Section 2: Tool Call Blocks

### Visual Design
Each tool call renders as a header line + expandable card:

**Header line:**
- 8px filled circle (green=success, amber+pulse=running, red=error)
- Bold tool name mapped from internal names:
  - `shell_exec` → "Bash"
  - `file_read` → "Read"
  - `file_write` → "Write"
  - `file_edit` → "Edit"
  - `directory_tree` → "List"
  - `browser_navigate` → "Navigate"
  - `browser_search` → "Search"
  - Other names displayed as-is with first letter capitalized
- Gray description text (from `detail` field)
- Click header to collapse/expand card

**Expandable card (default: expanded):**
- Subtle border `border-white/[0.06]`, dark background `bg-white/[0.02]`, `rounded-lg`
- **IN** section: muted gray "IN" label, monospace font, shows command/input
- Thin separator line `border-white/[0.04]`
- **OUT** section: muted gray "OUT" label, monospace font, shows output
- Output truncated to ~15 lines with "Show more" toggle
- When collapsed, only header line visible

### Data Flow Changes

**Type changes (`src/shared/types.ts`):**
```typescript
export interface ToolCall {
  id: string;
  name: string;
  status: 'running' | 'success' | 'error';
  detail?: string;        // short description for header
  input?: string;         // NEW: full command/input
  output?: string;        // NEW: full result/output
  durationMs?: number;
  previewHints?: MessageLinkPreview[];
  rating?: 'up' | 'down' | null;
  ratingNote?: string;
}
```

**Agent type changes (`src/main/agent/types.ts`):**
- Add `input?: string` and `output?: string` to `ToolActivity` interface

**IPC emitter updates — send full data:**
- `src/main/anthropicChat.ts` — include full tool input args and result content
- `src/main/openaiChat.ts` — include full tool arguments and result
- `src/main/geminiChat.ts` — include full function call args and result
- `src/main/agent/dispatch.ts` — include full `block.input` and result from `ToolCallRecord`

### Files Changed
- `src/shared/types.ts` — extend ToolCall
- `src/main/agent/types.ts` — extend ToolActivity
- `src/main/anthropicChat.ts` — full input/output in IPC events
- `src/main/openaiChat.ts` — full input/output in IPC events
- `src/main/geminiChat.ts` — full input/output in IPC events
- `src/main/agent/dispatch.ts` — full input/output in onToolActivity
- `src/renderer/components/ToolActivity.tsx` — complete rewrite with Cursor-style blocks

## Section 3: InputBar Premium Update

### Model Selector Dropdown
- Monochrome dark color scheme: `bg-surface-2` dropdown background
- Remove colored tier dots — replace with text-only tier labels in `text-text-tertiary` (e.g., "deep", "fast")
- Clean text list: model name in `text-text-primary`, tier in `text-text-tertiary`
- Selected model shown as small monochrome text in input bar
- Hover states: `bg-white/[0.06]`, no colored backgrounds
- Border: `border-white/[0.08]`

### Claude Code & Codex Toggles
- Replace text badges with icon buttons (20x20)
- Claude Code icon: terminal prompt `>_` icon — `text-amber-400` when active, `text-text-muted` when inactive
- Codex icon: desktop/monitor icon — `text-emerald-400` when active, `text-text-muted` when inactive
- Tooltip on hover showing "Claude Code" / "Codex"
- Click behavior unchanged (toggle mode)

### Send Button
- Monochrome style: white outline circle when ready, `text-text-muted` when disabled
- During streaming: square stop icon (matching Cursor)

### Files Changed
- `src/renderer/components/InputBar.tsx` — restyle model selector, replace mode badges, update send/stop button

## Section 4: Streaming Indicator

### Replace InlineShimmer
- Remove the `thinking-shimmer-line` horizontal gradient bar above the text
- Replace blue pulsing dot with a 4-pointed sparkle/star icon (`✱`) in `text-text-secondary`
- Keep shimmer text animation with subtler gradient sweep
- Text content (e.g., "Crafting...", "Vibing...") comes from existing `shimmerText` state — no backend changes

### Layout
```
✱  Crafting...
```
- Sparkle icon + space + shimmer-animated text
- Single line, no gradient bar above

### Files Changed
- `src/renderer/components/ChatPanel.tsx` — `InlineShimmer` component
- `src/renderer/index.css` — update shimmer animation styles

## Section 5: Input Bar Streaming State

- Placeholder text during streaming: "Queue another message..."
- Send button becomes rounded square stop icon during streaming
- Keep existing pause/resume/add-context controls

### Files Changed
- `src/renderer/components/InputBar.tsx` — placeholder text, stop button styling

## What Stays Unchanged

- MarkdownRenderer component and markdown prose CSS
- Streaming architecture (feed items, RAF batching, throttled rendering)
- Per-mode empty states (ClawdiaEmptyState, CodexEmptyState, ClaudeCodeEmptyState)
- Tab strip component
- Approval banners
- History browser
- All backend agent logic, LLM streaming, tool execution
- Database schema and persistence
- Conversation modes and mode switching logic

## File Change Summary

| File | Scope |
|------|-------|
| `src/shared/types.ts` | Add `input`, `output` to ToolCall |
| `src/main/agent/types.ts` | Add `input`, `output` to ToolActivity |
| `src/main/anthropicChat.ts` | Full tool data in IPC events |
| `src/main/openaiChat.ts` | Full tool data in IPC events |
| `src/main/geminiChat.ts` | Full tool data in IPC events |
| `src/main/agent/dispatch.ts` | Full tool data in onToolActivity |
| `src/renderer/components/ToolActivity.tsx` | Complete rewrite — Cursor-style blocks |
| `src/renderer/components/ChatPanel.tsx` | UserMessage, AssistantMessage, InlineShimmer, container layout |
| `src/renderer/components/InputBar.tsx` | Model selector, mode icons, send/stop button, placeholder |
| `src/renderer/index.css` | Shimmer animation updates, tool block styles |
| `tailwind.config.cjs` | Minor additions if needed |

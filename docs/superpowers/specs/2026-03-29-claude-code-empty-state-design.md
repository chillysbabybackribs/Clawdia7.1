# Claude Code Empty State — Design Spec

**Date:** 2026-03-29
**Status:** Approved
**Scope:** `ClaudeCodeEmptyState` component in `src/renderer/components/ChatPanel.tsx`

---

## What We're Building

Replace the current left-aligned text-heavy empty state for Claude Code with a centered, visually branded layout that mirrors the aesthetic of the official Claude Code app.

---

## Visual Design

### Layout

- Full-width centered column, vertically centered in the available chat area
- Three zones stacked top → middle → bottom:
  1. **Wordmark** — top, centered
  2. **Robot + suggestions** — center, flex-1, vertically centered
  3. **Input bar** — unchanged (existing `InputBar` component handles this)

### Wordmark (top)

- Row: Anthropic asterisk SVG icon + "Claude Code" text
  - Asterisk: 8-spoke star drawn with `<svg>` lines, color `#cc785c`, ~24×24px
  - "Claude Code": `font-size: 20px`, `font-weight: 600`, `color: rgba(255,255,255,0.92)`, `letter-spacing: -0.02em`, sans-serif
- Below the row, centered: `powered by Clawdia`
  - Font: JetBrains Mono (existing `font-mono` class)
  - Size: ~9.5px, `letter-spacing: 0.2em`, `text-transform: uppercase`
  - Color: `rgba(204,120,92,0.45)` — muted orange, clearly secondary

### Pixel Robot Mascot (center)

- SVG pixel-art robot, 72×72px display size, `image-rendering: pixelated`
- Color: `#cc785c` (matches accent), body on `#111010` background
- Geometry (16×16 viewBox):
  - Antenna: 7,0 → 2×2
  - Head: 4,2 → 8×5
  - Eyes: 5,3 → 2×2 and 9,3 → 2×2, fill `#111010`
  - Mouth: 5,6 → 6×1, fill `#111010`
  - Body: 3,5 → 10×8
  - Arms: 0,6 → 3×2 and 13,6 → 3×2
  - Legs: 4,13 → 2×3 and 10,13 → 2×3
- No animation

### Suggestion Items (below robot)

- 4 clickable items, centered column, `max-width: 400px`, full width within that
- Each item:
  - `font-size: 13px`, `text-align: center`, `color: rgba(255,255,255,0.42)`
  - Background: `rgba(255,255,255,0.03)` — soft wrap, no border, `border-radius: 8px`
  - Padding: `8px 16px`
  - Gap between items: `6px`
  - Hover: background → `rgba(204,120,92,0.08)`, color → `rgba(204,120,92,0.9)`
  - `transition: background 0.15s, color 0.15s`
  - `onClick`: calls `onSend(text)` to populate + submit the input bar

### Hint Bar

- **Omitted.** No "Prefer the terminal experience?" bar.

---

## Suggestion Content

```
Review this codebase and suggest architectural improvements.
Write tests for the current module and fix any failures.
Refactor this file to follow consistent naming conventions.
Find and fix the bug causing the failing test.
```

(Same as current — only the visual treatment changes.)

---

## Implementation

### File to modify

`src/renderer/components/ChatPanel.tsx` — `ClaudeCodeEmptyState` function (lines ~856–941)

### What changes

- Remove: left-aligned title block, divider, description paragraph, `—` dash prompts, "How it works" collapsible
- Add: centered wordmark (asterisk SVG + text + mono sub-label), pixel robot SVG, centered suggestion items with soft bg wrapper
- Keep: `onSend` prop and click behavior on suggestions
- Keep: existing `accent` color variable (`#cc785c` / `#f4a35a` — confirm which is in use)

### What does NOT change

- `CodexEmptyState` component — untouched
- `InputBar` — untouched
- All other chat panel logic — untouched
- CSS/Tailwind config — no new classes needed; uses existing `font-mono` and inline styles

---

## Accent Color Note

Current code uses `#f4a35a` as `accent` in `ClaudeCodeEmptyState`. The mockup used `#cc785c`. Confirm which to use during implementation — pick whichever matches the rest of the app's orange accent token.

---

## Out of Scope

- Codex empty state redesign (separate task)
- Animation on the robot
- "How it works" section (removed)
- Any changes to the input bar or tab strip

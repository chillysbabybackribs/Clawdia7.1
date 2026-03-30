# Premium UI Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Clawdia's UI from flat/undivided to a rugged-yet-premium dark workspace aesthetic with structural depth, recessed surfaces, and weighted borders — without touching BrowserPanel.

**Architecture:** Pure CSS/className changes across 4 component files and the root App wrapper. No new components, no logic changes. Each task is self-contained and independently verifiable by running the dev server.

**Tech Stack:** React + Tailwind CSS (with inline style strings for values outside Tailwind's default scale), Electron

---

## File Map

| File | Change |
|------|--------|
| `src/renderer/App.tsx` | Upgrade outer window border opacity + add outer glow shadow |
| `src/renderer/components/AppChrome.tsx` | Recessed dark bg, 2px bottom border + shadows, bordered title badge |
| `src/renderer/components/ChatPanel.tsx` | Recessed dark toolbar bg + heavier bottom border/shadow |
| `src/renderer/components/InputBar.tsx` | Recessed dark bg, 2px top border + inset shadow, plain-text model selector |
| `src/renderer/components/ToolActivity.tsx` | Replace ToolCard bordered wrappers + colored status dots with plain dimmed text lines |

---

### Task 1: Upgrade outer window border in App.tsx

**Files:**
- Modify: `src/renderer/App.tsx:253`

The outer `<div>` at line 253 currently uses `border-white/[0.04]`. Upgrade to `border-white/[0.10]` and add an outer glow box-shadow.

- [ ] **Step 1: Open `src/renderer/App.tsx` and find the main return div at line 253**

Current code (line 253):
```tsx
<div className="flex h-screen w-screen flex-col overflow-hidden rounded-[10px] border-[2px] border-white/[0.04]">
```

- [ ] **Step 2: Replace with upgraded border + glow shadow**

New code:
```tsx
<div className="flex h-screen w-screen flex-col overflow-hidden rounded-[10px] border-[2px] border-white/[0.10]" style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.8), 0 2px 8px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)' }}>
```

- [ ] **Step 3: Start the dev server and visually verify**

```bash
npm run dev
```

Expected: The app window has a more visible border (brighter white edge) and a deeper outer shadow.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: upgrade outer window border opacity and glow shadow"
```

---

### Task 2: Upgrade AppChrome title bar

**Files:**
- Modify: `src/renderer/components/AppChrome.tsx`

Replace the plain `bg-surface-1` header with a recessed darker surface (`#09090c`), heavier 2px bottom border with drop shadow, and wrap the title text in a bordered badge.

- [ ] **Step 1: Open `src/renderer/components/AppChrome.tsx` and read the current header className**

Current (line 7):
```tsx
<header className="drag-region flex h-[34px] flex-shrink-0 items-center border-b border-border-subtle bg-surface-1 px-3 shadow-[inset_0_-1px_6px_rgba(0,0,0,0.16)]">
```

- [ ] **Step 2: Replace the header element with upgraded surface + shadow**

New header (replace lines 7 to end of closing `</header>`):
```tsx
<header
  className="drag-region flex h-[36px] flex-shrink-0 items-center px-3 relative"
  style={{
    background: '#09090c',
    borderBottom: '2px solid rgba(255,255,255,0.10)',
    boxShadow: '0 2px 10px rgba(0,0,0,0.6), inset 0 -1px 0 rgba(255,255,255,0.03)',
  }}
>
  <div className="flex-1" />

  <div
    className="text-[11px] font-medium uppercase tracking-[0.16em]"
    style={{
      color: '#6e6e82',
      border: '1px solid rgba(255,255,255,0.10)',
      padding: '3px 12px',
      borderRadius: '4px',
      background: 'rgba(255,255,255,0.02)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 4px rgba(0,0,0,0.4)',
    }}
  >
    Clawdia Workspace
  </div>

  <div className="flex-1" />

  <div className="no-drag flex items-center gap-0.5">
    <button
      onClick={() => api?.window.minimize()}
      className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-secondary"
      title="Minimize"
    >
      <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <line x1="2" y1="5" x2="8" y2="5" />
      </svg>
    </button>
    <button
      onClick={() => api?.window.maximize()}
      className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-secondary"
      title="Maximize"
    >
      <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="6" height="6" />
      </svg>
    </button>
    <button
      onClick={() => api?.window.close()}
      className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-red-500/80 hover:text-white"
      title="Close"
    >
      <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <line x1="2" y1="2" x2="8" y2="8" />
        <line x1="8" y1="2" x2="2" y2="8" />
      </svg>
    </button>
  </div>
</header>
```

- [ ] **Step 3: Visually verify in dev server**

Expected: Title bar is noticeably darker than content area, has a visible 2px bottom edge, and "CLAWDIA WORKSPACE" sits inside a subtle bordered box.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/AppChrome.tsx
git commit -m "feat: recessed title bar with bordered workspace badge"
```

---

### Task 3: Upgrade ChatPanel toolbar row

**Files:**
- Modify: `src/renderer/components/ChatPanel.tsx:1107`

The icons row (terminal + settings buttons) currently uses `bg-surface-1` and a subtle `border-border-subtle`. Upgrade to a recessed dark surface matching the title bar, with a heavier 2px bottom border.

- [ ] **Step 1: Find the toolbar div at line 1107 in ChatPanel.tsx**

Current code (line 1107):
```tsx
<div className="drag-region flex items-center justify-end gap-1 px-2 h-[44px] flex-shrink-0 bg-surface-1 border-b border-border-subtle shadow-[inset_0_-1px_6px_rgba(0,0,0,0.2),0_2px_8px_rgba(0,0,0,0.3)] relative z-10">
```

- [ ] **Step 2: Replace with upgraded surface + border**

New code:
```tsx
<div
  className="drag-region flex items-center justify-end gap-1 px-2 h-[44px] flex-shrink-0 relative z-10"
  style={{
    background: '#09090c',
    borderBottom: '2px solid rgba(255,255,255,0.08)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.4), inset 0 -1px 0 rgba(255,255,255,0.025)',
  }}
>
```

- [ ] **Step 3: Visually verify in dev server**

Expected: The toolbar row above the chat messages has the same dark recessed look as the title bar, with a visible 2px dividing line separating it from the message area.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ChatPanel.tsx
git commit -m "feat: recessed chat toolbar with structural 2px border"
```

---

### Task 4: Upgrade left pane divider and background in App.tsx

**Files:**
- Modify: `src/renderer/App.tsx:256-259`

The left pane (chat) div currently has no background and uses `border-white/[0.06]` on the right border. Add a background of `#0b0b0f` and upgrade the right border to 2px with depth shadows.

- [ ] **Step 1: Find the left pane div in App.tsx around line 256**

Current code (lines 256-259):
```tsx
<div
  className="relative flex h-full min-w-0 flex-col"
  style={{ flex: rightPaneMode === 'none' ? '1 0 0' : '35 0 0' }}
>
```

- [ ] **Step 2: Add background and right-border styling**

New code:
```tsx
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
```

- [ ] **Step 3: Visually verify in dev server**

Expected: The chat pane has a slightly lighter background than the title bar (creating the recessed-header / lit-workspace effect), and has a visible 2px right border separating it from the browser/editor pane with a shadow depth effect.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: add recessed surface and structural right border to chat pane"
```

---

### Task 5: Upgrade InputBar surface and model selector

**Files:**
- Modify: `src/renderer/components/InputBar.tsx:194`

The InputBar wrapper currently uses `px-4 pb-4 pt-2` with no explicit background. Add a recessed dark bg, 2px top border with inset shadow. The model selector buttons (`currentModel?.label` and `Claude Code`) keep their existing click handlers but lose their hover-bg rounded-lg container styling — they become plain text labels separated by a thin divider.

- [ ] **Step 1: Find the outermost return div at line 194 in InputBar.tsx**

Current code (line 194):
```tsx
<div className="px-4 pb-4 pt-2">
```

- [ ] **Step 2: Replace with upgraded surface wrapper**

New code:
```tsx
<div
  className="px-4 pb-4 pt-3"
  style={{
    background: '#0d0d12',
    borderTop: '2px solid rgba(255,255,255,0.07)',
    boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.3)',
  }}
>
```

- [ ] **Step 3: Find the model selector button at line 309**

Current code (lines 309-317):
```tsx
<button
  onClick={() => setModelOpen((v) => !v)}
  className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] font-medium text-text-tertiary hover:text-text-secondary hover:bg-white/[0.05] transition-all cursor-pointer"
>
  {currentModel?.label || 'Select model'}
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="opacity-50">
    <polyline points="6 9 12 15 18 9" />
  </svg>
</button>
```

- [ ] **Step 4: Replace model selector button with plain text style (keep onClick and dropdown)**

New code:
```tsx
<button
  onClick={() => setModelOpen((v) => !v)}
  className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
>
  {currentModel?.label || 'Select model'}
  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="opacity-40">
    <polyline points="6 9 12 15 18 9" />
  </svg>
</button>
```

- [ ] **Step 5: Find the Claude Code button at line 358**

Current code (lines 358-376):
```tsx
<button
  onClick={onToggleClaudeMode}
  disabled={claudeModeDisabled}
  className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] font-medium transition-all ${
    claudeMode
      ? 'bg-amber-400/12 text-amber-300 hover:bg-amber-400/18'
      : claudeModeDisabled
        ? 'text-text-tertiary/35 cursor-default'
        : 'text-text-tertiary hover:text-text-secondary hover:bg-white/[0.05]'
  }`}
  title={claudeModeDisabled ? 'Create or open a conversation first' : 'Toggle Claude terminal mode for this conversation'}
>
  <span>Claude Code</span>
  {claudeMode && (
    <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
      {claudeStatus}
    </span>
  )}
</button>
```

- [ ] **Step 6: Add a thin vertical divider between the two selectors, and make Claude Code plain text**

Insert a divider span between the model button and Claude Code button, and strip the rounded-lg hover-bg from the Claude Code button. Find the `<div className="flex items-center gap-1.5 no-drag relative">` (line 278) and inside the non-streaming branch, replace both buttons as follows — find the section starting at `<button onClick={() => setModelOpen...` and ending after the Claude Code button closing tag.

Replace the entire non-streaming inner content (the two selector buttons, keeping the model dropdown `{modelOpen && ...}` intact and the send button intact):

```tsx
<button
  onClick={() => setModelOpen((v) => !v)}
  className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
>
  {currentModel?.label || 'Select model'}
  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="opacity-40">
    <polyline points="6 9 12 15 18 9" />
  </svg>
</button>

{modelOpen && (
  <div className="absolute bottom-full right-0 mb-2 py-1.5 bg-[#2a2a33]/95 backdrop-blur-md border border-white/[0.10] rounded-xl shadow-xl shadow-black/50 min-w-[210px] animate-fade-in z-50">
    {PROVIDERS.map((prov) => {
      const provModels = MODEL_REGISTRY.filter((m) => m.provider === prov.id);
      return (
        <div key={prov.id}>
          <div className="px-3.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/30">
            {prov.label}
          </div>
          {provModels.map((model) => {
            const isSelected = model.provider === provider && model.id === models[modelIdx]?.id;
            return (
              <button
                key={model.id}
                onClick={() => {
                  setProvider(model.provider);
                  const nextModels = getModelsForProvider(model.provider);
                  const idx = nextModels.findIndex((m) => m.id === model.id);
                  setModelIdx(idx >= 0 ? idx : 0);
                  setModelOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-[13px] transition-all cursor-pointer ${
                  isSelected ? 'text-white bg-white/[0.08]' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.05]'
                }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${model.tier === 'deep' ? 'bg-amber-400' : model.tier === 'balanced' ? 'bg-[#8ab4f8]' : 'bg-emerald-400'}`} />
                <span>{model.label}</span>
                {isSelected && (
                  <svg className="ml-auto text-[#8ab4f8] flex-shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                )}
              </button>
            );
          })}
        </div>
      );
    })}
  </div>
)}

<div style={{ width: '1px', height: '10px', background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />

<button
  onClick={onToggleClaudeMode}
  disabled={claudeModeDisabled}
  className={`flex items-center gap-1 text-[11px] transition-colors ${
    claudeMode
      ? 'text-amber-300 cursor-pointer'
      : claudeModeDisabled
        ? 'text-text-tertiary/35 cursor-default'
        : 'text-text-tertiary hover:text-text-secondary cursor-pointer'
  }`}
  title={claudeModeDisabled ? 'Create or open a conversation first' : 'Toggle Claude terminal mode for this conversation'}
>
  <span>Claude Code</span>
  {claudeMode && (
    <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
      {claudeStatus}
    </span>
  )}
</button>

<button
  onClick={handleSend}
  disabled={!canSend}
  title="Send (Enter)"
  className={`
    flex items-center justify-center w-9 h-9 rounded-full transition-all cursor-pointer
    ${canSend
      ? 'bg-white text-[#18181c] hover:bg-white/90 shadow-sm shadow-black/20'
      : 'bg-white/[0.10] text-white/30 cursor-default'
    }
  `}
>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
</button>
```

- [ ] **Step 7: Visually verify in dev server**

Expected: The input area has a darker recessed surface separated from the chat by a visible 2px top edge. The bottom row shows model name as plain text, a thin divider, then "Claude Code" as plain text — no rounded button backgrounds.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/InputBar.tsx
git commit -m "feat: recessed input bar surface, plain-text model selector with divider"
```

---

### Task 6: Replace ToolActivity cards with plain text lines

**Files:**
- Modify: `src/renderer/components/ToolActivity.tsx`

The `ToolCard` component renders a bordered card (`bg-[#0f0f13] border border-white/[0.06]`) with colored status indicators (blue spinning border, green checkmark SVG, red X SVG). Replace the entire `ToolCard` component with a plain dimmed text line. The `toolHeader` function and `ToolActivity` export are kept — only the visual treatment changes.

- [ ] **Step 1: Replace the ToolCard component (lines 62-169) with a plain text version**

Replace the entire `ToolCard` function with:
```tsx
function ToolCard({ tool }: { tool: ToolCall }) {
  const header = toolHeader(tool);
  return (
    <div
      className="text-[11px] leading-[1.6] truncate"
      style={{ color: '#3e3e50' }}
    >
      {header}
    </div>
  );
}
```

- [ ] **Step 2: Remove now-unused imports and refs**

The `useState`, `useRef`, and `useEffect` imports are only used by the old `ToolCard`. The new version uses none of them. Also remove `commandLine` function (no longer needed) and the `streamLines` prop from the `ToolCard` call in `ToolActivity`.

Update the import at line 1:
```tsx
import React from 'react';
import type { ToolCall } from '../../shared/types';
```

Remove the `commandLine` function entirely (lines 47-56).

Update `ToolActivity` export to not pass `streamLines`:
```tsx
export default function ToolActivity({ tools }: ToolActivityProps) {
  if (tools.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {tools.map(tool => (
        <ToolCard
          key={tool.id}
          tool={tool}
        />
      ))}
    </div>
  );
}
```

Update the `ToolActivityProps` interface — remove `streamMap` and `onRateTool` since they're no longer used:
```tsx
interface ToolActivityProps {
  tools: ToolCall[];
  streamMap?: ToolStreamMap;
  messageId?: string;
  onRateTool?: (toolId: string, rating: 'up' | 'down' | null, note?: string) => void;
}
```

> Note: Keep `ToolStreamMap` export and the props interface fields (even if unused) to avoid breaking the import in ChatPanel.tsx which imports `{ type ToolStreamMap }`.

- [ ] **Step 3: Visually verify in dev server**

Run a chat message that triggers tool calls. Expected: Tool activity shows as small, dim text lines beneath the AI response — no bordered cards, no colored spinning/checkmark dots.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ToolActivity.tsx
git commit -m "feat: replace tool activity cards with plain dimmed text lines"
```

---

## Done

After all 6 tasks, run the app and verify the full picture:
- Title bar: dark recessed with bordered "CLAWDIA WORKSPACE" badge
- Chat toolbar: same dark recessed surface, 2px bottom border
- Chat pane: slightly lighter `#0b0b0f` background, 2px right border with depth shadow when browser pane visible
- Input bar: dark recessed with 2px top border, plain-text model selector + divider
- Tool calls: plain dim text lines, no cards or colored dots
- Browser pane: completely unchanged

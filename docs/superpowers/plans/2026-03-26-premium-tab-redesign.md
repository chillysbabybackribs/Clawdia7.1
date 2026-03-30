# Premium Tab Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign conversation tabs (TabStrip), browser tabs (BrowserPanel), and AppChrome brand text to use a 46px underline-style tab with blue `#4a9eff` accent throughout.

**Architecture:** All changes are pure Tailwind/inline-style edits to three existing files — no new files, no shared constants, no logic changes. Each task is independent and can be applied in any order.

**Tech Stack:** React, Tailwind CSS (inline classes), TypeScript

---

### Task 1: Redesign TabStrip — conversation tabs

**Files:**
- Modify: `src/renderer/components/TabStrip.tsx`

- [ ] **Step 1: Open the file and understand the current structure**

  Read `src/renderer/components/TabStrip.tsx`. The component renders:
  - Outer container `div` with `h-6 flex items-end px-2 bg-surface-1 relative`
  - An absolutely-positioned bottom border `div`
  - One `div` per tab with raised-card active styling
  - A `+` new-tab button

- [ ] **Step 2: Replace the entire component with the new underline design**

  Replace the full content of `src/renderer/components/TabStrip.tsx` with:

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
      <div className="flex items-center px-2 h-[46px] flex-shrink-0 bg-surface-1 border-b border-white/[0.06]">
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const isOnly = tabs.length === 1;

          return (
            <div
              key={tab.id}
              onClick={() => { if (!isActive) onSwitch(tab.id); }}
              className={[
                'relative flex items-center gap-[7px] px-[18px] h-full cursor-pointer select-none text-[15px] font-medium transition-colors',
                isActive
                  ? 'text-text-primary border-b-[2.5px] border-[#4a9eff]'
                  : 'text-white/30 hover:text-white/60 border-b-[2.5px] border-transparent group',
              ].join(' ')}
            >
              {isActive && (
                <span className="w-2 h-2 rounded-full bg-[#4a9eff] flex-shrink-0" />
              )}
              <span>Chat {index + 1}</span>
              {!isOnly && (
                <span
                  onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                  className={[
                    'text-[15px] leading-none transition-colors cursor-pointer',
                    isActive
                      ? 'text-white/25 hover:text-text-primary'
                      : 'text-transparent group-hover:text-white/25 hover:!text-text-primary',
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
          className="flex items-center justify-center h-full px-[10px] text-[20px] text-text-muted hover:text-text-primary leading-none cursor-pointer transition-colors"
          title="New conversation"
        >
          +
        </button>
      </div>
    );
  }
  ```

- [ ] **Step 3: Verify in the app**

  Run: `npm run dev` (or check if already running)
  Expected:
  - Tab strip is visibly taller (46px)
  - Active tab shows a blue underline + blue dot, "Chat 1" label
  - Inactive tabs are dimmed, no background fill
  - `+` button is proportional to the new height
  - No layout breakage in the rest of the app

- [ ] **Step 4: Commit**

  ```bash
  git add src/renderer/components/TabStrip.tsx
  git commit -m "feat(ui): redesign TabStrip — underline tabs, 46px, blue accent"
  ```

---

### Task 2: Redesign BrowserPanel — browser tabs

**Files:**
- Modify: `src/renderer/components/BrowserPanel.tsx`

- [ ] **Step 1: Locate the tab strip container**

  In `src/renderer/components/BrowserPanel.tsx`, find line ~239:
  ```tsx
  <div className="drag-region flex items-center h-[40px] bg-surface-1 border-b border-border-subtle px-2 gap-1 flex-shrink-0 overflow-hidden">
  ```
  Change `h-[40px]` to `h-[46px]`:
  ```tsx
  <div className="drag-region flex items-center h-[46px] bg-surface-1 border-b border-border-subtle px-2 gap-1 flex-shrink-0 overflow-hidden">
  ```

- [ ] **Step 2: Redesign each browser tab**

  Find line ~244 — the individual tab `div`:
  ```tsx
  className={`no-drag group flex items-center gap-2 h-[32px] px-3 rounded-xl cursor-pointer transition-all duration-100 max-w-[210px] min-w-[120px] flex-shrink-0 ${tab.isActive ? 'bg-surface-3 text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_8px_18px_rgba(0,0,0,0.18)]' : 'text-text-tertiary hover:text-text-secondary hover:bg-white/[0.03]'}`}
  ```
  Replace with:
  ```tsx
  className={`no-drag group flex items-center gap-2 h-full px-[16px] cursor-pointer transition-all duration-100 max-w-[210px] min-w-[120px] flex-shrink-0 text-[14px] ${tab.isActive ? 'text-text-primary border-b-[2.5px] border-[#4a9eff]' : 'text-text-tertiary hover:text-text-secondary hover:bg-white/[0.03] border-b-[2.5px] border-transparent'}`}
  ```

- [ ] **Step 3: Update the new tab (+) button**

  Find line ~268:
  ```tsx
  <button onClick={handleNewTab} className="no-drag flex items-center justify-center w-7 h-7 rounded-xl text-text-muted hover:text-text-secondary hover:bg-white/[0.04] transition-colors cursor-pointer flex-shrink-0" title="New tab">
  ```
  Replace with:
  ```tsx
  <button onClick={handleNewTab} className="no-drag flex items-center justify-center h-full px-[10px] text-text-muted hover:text-text-secondary hover:bg-white/[0.04] transition-colors cursor-pointer flex-shrink-0" title="New tab">
  ```

- [ ] **Step 4: Verify in the app**

  Navigate to the Browser panel in the app.
  Expected:
  - Browser tab strip is 46px tall
  - Active tab has blue underline, no background fill
  - Inactive tabs are transparent with hover highlight
  - Tab text is 14px
  - `+` button scales with the strip height
  - Favicon, title, and close button still render correctly

- [ ] **Step 5: Commit**

  ```bash
  git add src/renderer/components/BrowserPanel.tsx
  git commit -m "feat(ui): redesign browser tabs — underline style, 46px, blue accent"
  ```

---

### Task 3: Update AppChrome brand text color

**Files:**
- Modify: `src/renderer/components/AppChrome.tsx`

- [ ] **Step 1: Locate the brand text color**

  In `src/renderer/components/AppChrome.tsx`, find line ~15:
  ```tsx
  <div className="flex items-baseline gap-1.5" style={{ color: '#7a3b10' }}>
  ```

- [ ] **Step 2: Change the color to blue accent**

  ```tsx
  <div className="flex items-baseline gap-1.5" style={{ color: '#4a9eff' }}>
  ```

- [ ] **Step 3: Verify in the app**

  Expected: "CLAWDIA" and "WORKSPACE" text in the title bar is now `#4a9eff` blue, matching the tab underline and dot.

- [ ] **Step 4: Commit**

  ```bash
  git add src/renderer/components/AppChrome.tsx
  git commit -m "feat(ui): update AppChrome brand color to blue accent #4a9eff"
  ```

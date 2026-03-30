# UI Typography & Input Scale-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Increase font sizes, border visibility, and input padding in InputBar.tsx to make the app more comfortable to use.

**Architecture:** All changes are confined to a single file — `src/renderer/components/InputBar.tsx`. No new files, no CSS changes, no shared constants needed. Every value is an inline Tailwind class or inline style string.

**Tech Stack:** React, Tailwind CSS (inline classes), TypeScript

---

### Task 1: Scale up textarea font, padding, and input container padding

**Files:**
- Modify: `src/renderer/components/InputBar.tsx`

- [ ] **Step 1: Open the file and locate the three targets**

  Line 195: outer container `className="px-4 pb-4 pt-3"`
  Line 332: inner row `className="flex items-center px-3 py-2 gap-2"`
  Line 342: textarea `className="flex-1 bg-transparent text-text-primary text-[16px] placeholder:text-text-tertiary px-2 py-2 resize-none outline-none max-h-[200px] leading-[1.6]"`

- [ ] **Step 2: Apply the changes**

  In `src/renderer/components/InputBar.tsx`:

  Line 195 — change outer container padding:
  ```tsx
  // Before
  className="px-4 pb-4 pt-3"
  // After
  className="px-5 pb-5 pt-4"
  ```

  Line 332 — change inner row padding:
  ```tsx
  // Before
  className="flex items-center px-3 py-2 gap-2"
  // After
  className="flex items-center px-4 py-3 gap-2"
  ```

  Line 342 — change textarea font size and padding:
  ```tsx
  // Before
  className="flex-1 bg-transparent text-text-primary text-[16px] placeholder:text-text-tertiary px-2 py-2 resize-none outline-none max-h-[200px] leading-[1.6]"
  // After
  className="flex-1 bg-transparent text-text-primary text-[21px] placeholder:text-text-tertiary px-3 py-3 resize-none outline-none max-h-[200px] leading-[1.6]"
  ```

- [ ] **Step 3: Verify the app renders without errors**

  Run: `npm run dev` (or however the app starts — check package.json)
  Expected: App launches, input area visibly larger, no console errors

- [ ] **Step 4: Commit**

  ```bash
  git add src/renderer/components/InputBar.tsx
  git commit -m "feat(ui): increase textarea font to 21px and input padding"
  ```

---

### Task 2: Scale up border width and opacity

**Files:**
- Modify: `src/renderer/components/InputBar.tsx`

- [ ] **Step 1: Locate the border classes**

  Line 282–284 — the `focused`/unfocused conditional class string:
  ```tsx
  ${focused
    ? 'border-white/[0.12] shadow-[inset_0_1px_6px_rgba(0,0,0,0.3),0_-2px_10px_rgba(0,0,0,0.35),0_0_0_1px_rgba(255,255,255,0.04)]'
    : 'border-white/[0.06] hover:border-white/[0.09] shadow-[inset_0_1px_4px_rgba(0,0,0,0.2),0_-2px_8px_rgba(0,0,0,0.25)]'
  }
  ```

- [ ] **Step 2: Apply the border changes**

  Change the conditional class string on lines 282–284:
  ```tsx
  // Before
  ${focused
    ? 'border-white/[0.12] shadow-[inset_0_1px_6px_rgba(0,0,0,0.3),0_-2px_10px_rgba(0,0,0,0.35),0_0_0_1px_rgba(255,255,255,0.04)]'
    : 'border-white/[0.06] hover:border-white/[0.09] shadow-[inset_0_1px_4px_rgba(0,0,0,0.2),0_-2px_8px_rgba(0,0,0,0.25)]'
  }

  // After
  ${focused
    ? 'border-[1.5px] border-white/[0.22] shadow-[inset_0_1px_6px_rgba(0,0,0,0.3),0_-2px_10px_rgba(0,0,0,0.35),0_0_0_1px_rgba(255,255,255,0.04)]'
    : 'border-[1.5px] border-white/[0.12] hover:border-white/[0.16] shadow-[inset_0_1px_4px_rgba(0,0,0,0.2),0_-2px_8px_rgba(0,0,0,0.25)]'
  }
  ```

- [ ] **Step 3: Verify in the app**

  Run: `npm run dev`
  Expected: Input box has a noticeably more defined border, stronger on focus

- [ ] **Step 4: Commit**

  ```bash
  git add src/renderer/components/InputBar.tsx
  git commit -m "feat(ui): increase input border width to 1.5px and opacity"
  ```

---

### Task 3: Scale up button sizes and UI label font sizes

**Files:**
- Modify: `src/renderer/components/InputBar.tsx`

- [ ] **Step 1: Locate and update the model selector button font size**

  Line 206 — model selector trigger button:
  ```tsx
  // Before
  className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
  // After
  className="flex items-center gap-1 text-[14px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
  ```

- [ ] **Step 2: Update model dropdown menu item font size**

  Line 235 — each model option button in the dropdown:
  ```tsx
  // Before
  className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-[13px] transition-all cursor-pointer ${...}`}
  // After
  className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-[15px] transition-all cursor-pointer ${...}`}
  ```

- [ ] **Step 3: Update the Claude Code toggle button font size**

  Line 258 — Claude mode toggle button:
  ```tsx
  // Before
  className={`flex items-center gap-1 text-[11px] transition-colors ${...}`}
  // After
  className={`flex items-center gap-1 text-[14px] transition-colors ${...}`}
  ```

- [ ] **Step 4: Scale up the send button**

  Line 394 — send button:
  ```tsx
  // Before
  flex items-center justify-center w-9 h-9 rounded-full transition-all cursor-pointer
  // After
  flex items-center justify-center w-10 h-10 rounded-full transition-all cursor-pointer
  ```

- [ ] **Step 5: Scale up the attachment button**

  Line 350 — attachment button:
  ```tsx
  // Before
  `flex items-center justify-center w-8 h-8 rounded-lg transition-all no-drag ${...}`
  // After
  `flex items-center justify-center w-9 h-9 rounded-lg transition-all no-drag ${...}`
  ```

- [ ] **Step 6: Scale up the streaming control buttons (pause/resume/stop/add-context)**

  Line 365 — pause/resume button:
  ```tsx
  // Before
  className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all cursor-pointer ${...}`}
  // After
  className={`flex items-center justify-center w-9 h-9 rounded-lg transition-all cursor-pointer ${...}`}
  ```

  Line 377 — add context button (while streaming):
  ```tsx
  // Before
  className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#8ab4f8]/15 text-[#8ab4f8] hover:bg-[#8ab4f8]/25 transition-all cursor-pointer"
  // After
  className="flex items-center justify-center w-9 h-9 rounded-lg bg-[#8ab4f8]/15 text-[#8ab4f8] hover:bg-[#8ab4f8]/25 transition-all cursor-pointer"
  ```

  Line 384 — stop button:
  ```tsx
  // Before
  className="flex items-center justify-center w-8 h-8 rounded-lg bg-red-500/12 text-red-400 hover:bg-red-500/20 transition-all cursor-pointer"
  // After
  className="flex items-center justify-center w-9 h-9 rounded-lg bg-red-500/12 text-red-400 hover:bg-red-500/20 transition-all cursor-pointer"
  ```

- [ ] **Step 7: Verify in the app**

  Run: `npm run dev`
  Expected: Model label, Claude Code label, and dropdown items all larger; buttons slightly larger; layout still clean

- [ ] **Step 8: Commit**

  ```bash
  git add src/renderer/components/InputBar.tsx
  git commit -m "feat(ui): scale up button sizes and UI label fonts"
  ```

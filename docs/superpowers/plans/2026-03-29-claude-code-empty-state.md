# Claude Code Empty State Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current left-aligned, text-heavy `ClaudeCodeEmptyState` component with a centered, visually branded layout mirroring the official Claude Code app — asterisk wordmark, pixel robot mascot, soft-wrapped centered suggestions.

**Architecture:** Single component replacement inside `ChatPanel.tsx`. No new files, no new dependencies. All styling via inline styles and existing Tailwind classes. The `onSend` prop and click behavior are preserved exactly.

**Tech Stack:** React, TypeScript, Tailwind CSS, inline SVG

---

### Task 1: Replace `ClaudeCodeEmptyState` in `ChatPanel.tsx`

**Files:**
- Modify: `src/renderer/components/ChatPanel.tsx` lines 856–941

- [ ] **Step 1: Open the file and locate the component**

  The function starts at line 856. Confirm by searching for:
  ```
  function ClaudeCodeEmptyState(
  ```
  It ends at line 941 (closing `}`). The entire function body will be replaced.

- [ ] **Step 2: Replace the component**

  Replace lines 856–941 with the following. The `onSend` prop signature is unchanged.

  ```tsx
  function ClaudeCodeEmptyState({
    onSend,
  }: {
    onSend: (text: string) => void;
  }) {
    const examples = [
      'Review this codebase and suggest architectural improvements.',
      'Write tests for the current module and fix any failures.',
      'Refactor this file to follow consistent naming conventions.',
      'Find and fix the bug causing the failing test.',
    ];

    const accent = '#f4a35a';

    return (
      <div className="flex flex-col items-center justify-center h-full w-full py-8 text-white select-none">

        {/* Wordmark */}
        <div className="flex flex-col items-center gap-[5px] mb-10">
          <div className="flex items-center gap-[9px]">
            {/* Anthropic asterisk */}
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <g stroke="#f4a35a" strokeWidth="2.2" strokeLinecap="round">
                <line x1="12" y1="2" x2="12" y2="22"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                <line x1="19.07" y1="4.93" x2="4.93" y2="19.07"/>
              </g>
            </svg>
            <span style={{ fontSize: 20, fontWeight: 600, color: 'rgba(255,255,255,0.92)', letterSpacing: '-0.02em' }}>
              Claude Code
            </span>
          </div>
          <span className="font-mono" style={{ fontSize: 9.5, letterSpacing: '0.2em', textTransform: 'uppercase', color: `${accent}73` }}>
            powered by Clawdia
          </span>
        </div>

        {/* Pixel robot mascot */}
        <svg
          width="72"
          height="72"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
          style={{ imageRendering: 'pixelated', marginBottom: 28 }}
        >
          {/* Antenna */}
          <rect x="7" y="0" width="2" height="2" fill={accent}/>
          {/* Head */}
          <rect x="4" y="2" width="8" height="5" fill={accent}/>
          {/* Eyes */}
          <rect x="5" y="3" width="2" height="2" fill="#0e0e12"/>
          <rect x="9" y="3" width="2" height="2" fill="#0e0e12"/>
          {/* Mouth */}
          <rect x="5" y="6" width="6" height="1" fill="#0e0e12"/>
          {/* Body */}
          <rect x="3" y="5" width="10" height="8" fill={accent}/>
          {/* Arms */}
          <rect x="0" y="6" width="3" height="2" fill={accent}/>
          <rect x="13" y="6" width="3" height="2" fill={accent}/>
          {/* Legs */}
          <rect x="4" y="13" width="2" height="3" fill={accent}/>
          <rect x="10" y="13" width="2" height="3" fill={accent}/>
        </svg>

        {/* Suggestions */}
        <div className="flex flex-col items-center gap-[6px] w-full" style={{ maxWidth: 400 }}>
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onSend(example)}
              className="w-full text-center focus:outline-none"
              style={{
                fontSize: 13,
                color: 'rgba(255,255,255,0.42)',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 8,
                padding: '8px 16px',
                transition: 'background 0.15s, color 0.15s',
                cursor: 'pointer',
                border: 'none',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = `${accent}14`;
                (e.currentTarget as HTMLButtonElement).style.color = `${accent}e6`;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.03)';
                (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.42)';
              }}
            >
              {example}
            </button>
          ))}
        </div>

      </div>
    );
  }
  ```

- [ ] **Step 3: Verify the file compiles**

  Run:
  ```bash
  cd /home/dp/Desktop/clawdia7.0 && npx tsc --noEmit 2>&1 | head -30
  ```
  Expected: no errors related to `ClaudeCodeEmptyState`. Any pre-existing errors elsewhere are fine to ignore.

- [ ] **Step 4: Visual check**

  Launch the app (or hot-reload if already running). Switch the chat panel to Claude Code mode. Confirm:
  - Centered asterisk + "Claude Code" wordmark at top
  - "powered by Clawdia" mono sub-label below wordmark
  - Pixel robot centered in the space
  - 4 suggestion items with soft bg wrap, no border
  - Hover on a suggestion: background tints orange, text brightens to orange
  - Clicking a suggestion fires `onSend` (populates + submits the input bar)
  - `CodexEmptyState` is completely unchanged

- [ ] **Step 5: Commit**

  ```bash
  git add src/renderer/components/ChatPanel.tsx
  git commit -m "feat(chat): redesign Claude Code empty state — centered wordmark, pixel robot, soft suggestions"
  ```

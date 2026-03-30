# Premium UI Upgrade — Design Spec
**Date:** 2026-03-26

## Overview

Upgrade Clawdia's UI from flat/undivided to a rugged-yet-premium dark workspace aesthetic. Keep the existing color palette, font stack, and blue accent (#1A73E8). The browser pane (BrowserPanel) is explicitly out of scope — leave it exactly as-is.

## Design Direction

**Rugged Premium:** Visible structural weight (thick borders, depth shadows) combined with refined details (recessed surfaces, tight typographic control). Panels feel physically distinct and built to last.

## Changes by Component

### 1. AppChrome (title bar)

**Surface:** Recessed — darker than content (`#09090c`)
**Divider:** `border-bottom: 2px solid rgba(255,255,255,0.10)` + drop shadow `0 2px 10px rgba(0,0,0,0.6)` + inner highlight `inset 0 -1px 0 rgba(255,255,255,0.03)`
**Title text:** Wrap "CLAWDIA WORKSPACE" in a bordered badge:
- `border: 1px solid rgba(255,255,255,0.10)`
- `padding: 3px 12px`, `border-radius: 4px`
- `background: rgba(255,255,255,0.02)`
- `box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 4px rgba(0,0,0,0.4)`
- Color: `#6e6e82`

### 2. Chat toolbar row (date + settings buttons in ChatPanel)

**Surface:** Same recessed dark as title bar (`#09090c`)
**Divider:** `border-bottom: 2px solid rgba(255,255,255,0.08)` + `box-shadow: 0 2px 8px rgba(0,0,0,0.4), inset 0 -1px 0 rgba(255,255,255,0.025)`

### 3. Left/chat pane outer border

**Divider from browser:** `border-right: 2px solid rgba(255,255,255,0.09)` + `box-shadow: inset -2px 0 12px rgba(0,0,0,0.35), 2px 0 8px rgba(0,0,0,0.3)`
**Pane background:** `#0b0b0f` (slightly lighter than title bar, creating the recessed-header / lit-workspace effect)

### 4. Input bar (InputBar component)

**Surface:** `#0d0d12`
**Top divider:** `border-top: 2px solid rgba(255,255,255,0.07)` + `box-shadow: inset 0 2px 8px rgba(0,0,0,0.3)`
**Input field:** Keep existing styling, no changes needed beyond what surfaces provide
**Model selector row:** Plain text labels (`Gemini 2.5 Pro` · `Claude Code`) separated by a thin `1px rgba(255,255,255,0.08)` vertical divider — no badges, no borders, no colored dots

### 5. Tool activity lines (in ChatPanel message stream)

Remove box wrappers and colored status dots from tool call display. Tool lines render as plain dimmed text only (`color: #3e3e50`, `font-size: 10px`).

### 6. App outer border

Upgrade from `border-white/[0.04]` to `border-white/[0.10]` (matches the heavier structural language).
Add outer glow: `box-shadow: 0 8px 40px rgba(0,0,0,0.8), 0 2px 8px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)`

## Out of Scope

- **BrowserPanel** — untouched entirely (tabs, URL bar, content area, navigation controls)
- Accent color — stays #1A73E8
- Font stack — unchanged (DM Sans / JetBrains Mono)
- Message bubble styles — unchanged
- Status line shimmer — unchanged
- Settings, conversations, processes views — unchanged for now

## Files to Modify

1. `src/renderer/components/AppChrome.tsx` — title bar surface + bordered badge
2. `src/renderer/components/ChatPanel.tsx` — toolbar surface + tool activity line rendering
3. `src/renderer/components/InputBar.tsx` — input bar surface + model selector row
4. `src/renderer/App.tsx` — outer window border + shadow upgrade
5. `src/renderer/index.css` — any shared surface tokens if needed

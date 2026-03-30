# Clawdia UI Coordinate Map
Validated via live screenshots. All coordinates are absolute pixels on the 2560×1080 HDMI display.
Window: `39845892`, position `0,0`, size `2560×1080`.

---

## Zones

```
y=0-18    AppChrome (titlebar, full width)
y=18-64   TabStrip (left) + Browser tab bar (right, x>425)
y=64-108  Icons row: zoom/history/terminal/settings (left) + Browser nav/URL bar (right)
y=108-940 Chat message area (left) + Browser content (right)
y=940-970 InputBar toolbar: model selector, Claude Code, Codex toggles
y=970-1060 InputBar: textarea + attach + send/stop/pause
```

---

## AppChrome — y=0-18, full width

| Element | x (approx) | y | Notes |
|---|---|---|---|
| CLAWDIA WORKSPACE label | 44 | 9 | drag region |
| Clock | 1280 | 9 | center, display only |
| VPN button | 2430 | 9 | green=connected, grey=off |
| Minimize `_` | 2480 | 9 | |
| Maximize `□` | 2510 | 9 | |
| Close `×` | 2540 | 9 | |

---

## Chat TabStrip — y=18-64, x=0-425

| Element | x | y | Notes |
|---|---|---|---|
| Tab (inactive/ghost) | ~60 | 41 | click to switch |
| Tab (active) | ~195 | 41 | has `×` close button |
| `×` close active tab | ~280 | 41 | only visible when >1 tab |
| `+` new tab | ~320 | 41 | calls `api.chat.create()` |

**Tab rename:** Not implemented — no UI or IPC stub exists.

---

## Browser tab bar — y=18-64, x=425-2560

| Element | x | y | Notes |
|---|---|---|---|
| Browser tab 1 | ~685 | 41 | active browser tab |
| Browser tab 2 | ~870 | 41 | |
| Browser `+` new tab | ~1010 | 41 | |

---

## Icons row — y=64-108

### Left panel icons (right-aligned, x=454-575)

| Element | x | y | title attr | Action |
|---|---|---|---|---|
| `−` zoom out | 454 | 86 | "Zoom out chat" | `handleChatZoomOut()` −10% |
| `100%` zoom reset | 480 | 86 | "Reset chat zoom" | `handleChatZoomReset()` → 100% |
| `+` zoom in | 506 | 86 | "Zoom in chat" | `handleChatZoomIn()` +10% |
| `⊙` history | 531 | 86 | "Chat history" / "Close history" | toggles `historyMode` |
| `⊡` terminal | 553 | 86 | "Open terminal" / "Close terminal" | `onToggleTerminal()` |
| `⚙` settings | 575 | 86 | "Settings" | `onOpenSettings()` → SettingsView |

**Keyboard shortcuts (when chat focused):**
- `Ctrl/Cmd +` → zoom in
- `Ctrl/Cmd -` → zoom out
- `Ctrl/Cmd 0` → zoom reset
- `Ctrl+Scroll` → zoom
- `Ctrl+H` → history view
- `Ctrl+,` → settings
- `Ctrl+B` → toggle browser pane
- `Escape` → back to chat

### Browser controls (right panel, x=608+)

| Element | x | y | Notes |
|---|---|---|---|
| `<` back | 608 | 86 | browser back |
| `>` forward | 633 | 86 | browser forward |
| `×` stop/reload | 653 | 86 | |
| URL bar | 672 | 86 | starts here |
| `VISIBLE` toggle | 2515 | 86 | show/hide browser pane |

---

## InputBar toolbar — y=935-965, x=0-425

| Element | x | y | title attr | Action |
|---|---|---|---|---|
| Model selector `Claude Opus 4.6 ▾` | 45 | 948 | — | opens model dropdown |
| `\|` divider | 130 | 948 | — | visual only |
| `>_` Claude Code (amber=on) | 151 | 948 | "Toggle Claude Code" | `onToggleClaudeMode()` |
| `\|` divider | 168 | 948 | — | visual only |
| `⊡` Codex (green=on) | 183 | 948 | "Toggle Codex" | `onToggleCodexMode()` |

**Model dropdown** (opens above toolbar when clicked):
- Grouped by provider: Anthropic, OpenAI, etc.
- Selecting a model calls `api.settings.setProvider()` + `api.settings.setModel()`

---

## InputBar textarea — y=965-1060, x=0-425

| Element | x | y | title attr | Action |
|---|---|---|---|---|
| Textarea | 26 | 990 | — | type message, Enter to send |
| Paperclip `⊂` attach | 493 | 990 | "Attach file" | opens file dialog |
| Send `→` | 518 | 990 | "Send (Enter)" | `onSend()` |
| Pause `⏸` (streaming only) | 493 | 990 | "Pause" | `onPause()` |
| Resume `▶` (paused only) | 493 | 990 | "Resume" | `onResume()` |
| `+` add context (streaming+text) | 505 | 990 | "Add context" | `onAddContext()` |
| Stop `■` (streaming only) | 518 | 990 | "Stop (Esc)" | `onStop()` / Esc key |

**File attach accepts:** `image/*, .pdf, .txt, .md, .mdx, .json, .csv, .doc, .docx, .xls, .xlsx, .ppt, .pptx, .zip`
- Images: shown as thumbnail preview, sent as dataUrl
- Text files ≤512KB: read as text, truncated at 12,000 chars
- Other: sent as file reference with name+size

---

## Right pane modes

Toggled by icons row terminal button or keyboard shortcuts. State stored in `rightPaneMode`.

| Mode | Content | How to activate |
|---|---|---|
| `browser` | Embedded Chromium | `Ctrl+B` or VISIBLE button |
| `terminal` | TerminalPanel | `⊡` terminal icon in icons row |
| `editor` | EditorPanel (multi-tab) | `api.editor.onOpenFile` IPC event |
| `none` | Left pane full width | toggle browser off |

---

## Missing / not implemented

| Feature | Status |
|---|---|
| Tab rename | No UI, no IPC stub |
| Zoom via IPC | Local React state only — no `api.chat.zoom` |
| Browser tab list from renderer | BrowserPanel internal only |

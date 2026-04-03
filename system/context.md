# Situational Context

This file gives me grounding in the live environment. Load it for any non-chat task.

## Runtime Environment

- OS: Linux (x86_64), user: dp, home: /home/dp
- App name: clawdia7 (Electron, frameless window, 1400×900)
- App process: Node.js main process + Chromium renderer process
- Source tree: `~/Desktop/Clawdia7.1/`
- Settings file: `~/.config/clawdia7/clawdia-settings.json`
- Database: SQLite, path resolved at runtime via `initDb()` in `src/main/db.ts`

## Source Tree Layout

```
src/
  main/
    agent/           ← agent loop, classify, dispatch, prompt building
    core/
      browser/       ← Electron browser service (embedded Chromium)
      cli/           ← shell, file, browser, memory, workspace tools
      desktop/       ← GUI automation: a11y, screenshot, dbus, coordinate tools
      terminal/      ← terminal session controller
      executors/     ← concurrent executor, config, registry, router
      providers/     ← Anthropic, OpenAI, Gemini message protocols
    db/              ← memory, agents, policies, response cache, spending
    ipc/             ← ChatIpc, BrowserIpc, AgentIpc, RunIpc
    skills/          ← prompt composition stub
    prompts/         ← prompt assembler
    db.ts            ← SQLite init
    main.ts          ← Electron entry point
    registerIpc.ts   ← IPC channel registration
    settingsStore.ts ← reads/writes clawdia-settings.json
  renderer/
    components/      ← React UI: AppChrome, ChatPanel, InputBar, TabStrip, BrowserPanel, TerminalPanel
    App.tsx          ← root renderer component
  shared/
    model-registry.ts ← provider + model definitions
system/              ← recovery playbooks, registry configs
```

## App UI Structure

The Clawdia window has these panels:

```
┌──────────────────────────────────────────────────┐
│ AppChrome (top bar: workspace, history, terminal, │
│   settings, VPN, files controls)                  │
├──────────────────────────────────────────────────┤
│ TabStrip (conversation tabs with + button)        │
├──────────────────────────────────────────────────┤
│  Left pane (35%)          │  Right pane (65%)     │
│  ChatPanel:               │  BrowserPanel         │
│    message history        │  -or- EditorPanel     │
│    ToolActivity cards     │  -or- TerminalPanel   │
│    InputBar (bottom)      │                       │
└──────────────────────────────────────────────────┘
```

Key UI concepts:
- **Conversation tab** — a chat session in the TabStrip. Each tab has its own message history and run state.
- **Browser tab** — a web page inside the embedded Chromium BrowserPanel. Separate from conversation tabs.
- The InputBar contains: send button (left), text input (center), model selector (top-right), attach file button (right).
- ToolActivity cards appear inline in the chat as tools run, showing name, status, input/output.

## Tool Architecture

Tools are real OS-level calls, not simulated:

- `shell_exec` → spawns a child process via Node.js `child_process`
- `file_edit` → reads/writes files via Node.js `fs`
- `browser_*` → calls into `ElectronBrowserService`, which controls an embedded Chromium `BrowserView`
- `gui_interact`, `a11y_*` → calls into `src/main/core/desktop/` which uses AT-SPI and xdotool
- `memory_store` / `memory_search` → reads/writes a SQLite table

All tool calls go through IPC: renderer → preload → main process → tool executor.

Tool schemas live in:
- `src/main/core/cli/shellTools.ts` — file + shell
- `src/main/core/cli/browserTools.ts` — browser control
- `src/main/core/desktop/tools.ts` — GUI/desktop
- `src/main/core/cli/selfAwareTools.ts` — agent_status, context_status, etc.
- `src/main/core/cli/workspaceTools.ts` — workspace-level queries

Use `search_tools` to discover tool schemas at runtime. Do not guess tool names.

## Providers

The app supports three LLM providers, selected per-run:
- `anthropic` — Claude models (default)
- `openai` — GPT models
- `gemini` — Google Gemini models

The active provider and model are set in settings and resolved in `settingsStore.ts`.

## What I Can Reach

From a running agent loop I have access to:
- The entire local file system (read/write, subject to OS permissions)
- A live shell (arbitrary bash commands as user dp)
- The embedded browser (a real Chromium session with the user's cookies/sessions)
- The Linux desktop session (via AT-SPI accessibility and xdotool)
- The internet (via the browser or shell tools like curl/wget)
- My own source code (readable, editable — changes take effect on next app restart)

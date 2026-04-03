# Clawdia 7.1

AI-powered desktop workspace built on Electron. Embeds Claude Code and Codex as managed subprocesses, exposes an MCP HTTP bridge for tool access, and runs a native agent loop with browser, desktop, terminal, and file tools.

## Commands

```bash
npm run dev          # Dev mode with HMR (main + renderer + electron, all three concurrently)
npm run safe-dev     # Build then run stable (use this when HMR causes issues)
npm run build        # Compile main (tsc) + renderer (vite)
npm test             # Run vitest test suite
npm run test:watch   # Vitest in watch mode
npm run package      # Build + package as AppImage
```

## Gotchas

- **Native modules must be Electron-rebuilt** — `better-sqlite3` and `node-pty` are native. `npm install` does this automatically via `postinstall`. If you get native module errors, run `npm run rebuild:native` manually.
- **`--no-sandbox` is required** — Electron on Linux needs this flag. It's already baked into all npm scripts.
- **MCP config is ephemeral** — at runtime, `mcpBridge.ts` writes per-conversation MCP config to `~/.tmp/clawdia-claude-mcp-*.json`. These are temp files, not committed.
- **Settings are not in the repo** — user settings live at `~/.config/clawdia7/clawdia-settings.json`. The repo has no `.env` or committed config.
- **`system/context.md` is the agent's self-model** — the internal agent loop loads this for environment grounding. Edit it to update what the agent knows about its runtime environment.
- **Renderer runs at port 5174** — Vite dev server. `dev:electron` waits for it via `wait-on` before launching Electron.
- **HMR SIGSEGV on reload is normal** — Electron on Linux segfaults when the main process hot-reloads with native modules loaded. Use `npm run safe-dev` for stable runs; the SIGSEGV in `npm run dev` is cosmetic and the window recovers.
- **`search_tools` stays in browser/desktop profiles** — browser and desktop profiles include `search_tools` for CDP/system tool discovery. Do not remove it; the agent needs it at runtime to discover tools not eagerly loaded.
- **Mock `dispatch` must include `elapsedMs`** — `agentLoop.ts` reads `dispatchResult.elapsedMs?.[idx]`. Test mocks should return `{ results, discoveredTools: [], elapsedMs: [] }` to avoid surprises.
- **React 19 + vitest jsdom: `React.act` missing** — fixed by `define: { 'process.env.NODE_ENV': '"test"' }` in `vitest.config.ts`. Prevents Vite from statically replacing `NODE_ENV` with `"production"` in node_modules so React loads its dev build which exports `act`. Do not remove this define.
- **`sessionContinuity` payload shapes** — `browser_navigate` events store `{url, title}`, `ui_state_observed` stores `{activeRightPanel, browserUrl, ...}`. Neither uses a `text` field — extract facts by `event.kind`.

## Architecture

```
src/
  main/                      # Electron main process
    agent/                   # Agent loop: classify → dispatch → respond
      agentLoop.ts           # Core multi-turn execution loop
      classify.ts            # Intent classification
      dispatch.ts            # Tool call routing to executors
      promptBuilder.ts       # System prompt assembly
      policy-engine.ts       # Policy enforcement
      recoveryGuidance.ts    # Error recovery strategies
      spending-budget.ts     # Token/cost budget tracking
    core/
      browser/               # Embedded Chromium (ElectronBrowserService)
      cli/                   # Tool definitions + executors
        toolRegistry.ts      # Central registry — ALL_TOOLS, searchTools()
        shellTools.ts        # file_edit, shell_exec, file_list_directory
        browserTools.ts      # browser_navigate, browser_click, etc.
        cdpTools.ts          # Low-level CDP mouse/key/touch/storage
        systemTools.ts       # OS-level: secret store, fetch, shortcuts
        selfAwareTools.ts    # agent_status, context_status
        workspaceTools.ts    # Workspace-level queries
        terminalTools.ts     # Terminal session tools
        memoryTools.ts       # memory_store, memory_search, memory_forget
      desktop/               # GUI automation (AT-SPI, xdotool, DBus)
        guiExecutor.ts       # gui_interact dispatcher
        dbus.ts              # dbus_control
      terminal/              # PTY terminal session controller
      executors/             # Executor system
        ExecutorRegistry.ts  # Executor definitions + capabilities
        ExecutorRouter.ts    # Routing + concurrency enforcement
        ExecutorConfigStore.ts # Typed per-executor config with schemas
        ConcurrentExecutor.ts  # Planner → Workers → Synthesizer pipeline
    ipc/                     # IPC handlers
      ChatIpc.ts             # Main chat routing — reads conv.mode → executor
      BrowserIpc.ts          # Browser panel IPC
      AgentIpc.ts            # Agent state IPC
      RunIpc.ts              # Run lifecycle IPC
    claudeCodeClient.ts      # Claude Code CLI subprocess manager
    codexCliClient.ts        # Codex CLI subprocess manager
    mcpBridge.ts             # MCP HTTP server (tool bridge for CLI agents)
    db.ts                    # SQLite init
    main.ts                  # Electron entry point
    registerIpc.ts           # IPC channel registration
    settingsStore.ts         # Reads/writes clawdia-settings.json

  renderer/                  # React frontend (Vite, port 5174 in dev)
    components/
      ChatPanel.tsx          # Message history + streaming display
      InputBar.tsx           # Text input, model selector, attach
      TabStrip.tsx           # Conversation tab management
      BrowserPanel.tsx       # Embedded Chromium view
      TerminalPanel.tsx      # Terminal emulator UI
      ToolActivity.tsx       # Inline tool execution cards

  shared/
    model-registry.ts        # All providers + model definitions
    types.ts                 # Shared types

system/                      # Agent runtime config (not compiled)
  context.md                 # Agent self-model — environment grounding
  registry/superpowers.json  # Skill/superpower definitions
  recovery/                  # Recovery playbooks
  domains/                   # Domain guidance (browser, coding, desktop, fs)

skills/                      # Declarative skill definitions (matched at runtime)
agents/                      # Agent presets (code-reviewer, developer-assistant)
```

## Executor System

Conversation mode (stored in DB) determines which executor runs:

| DB `mode` | Executor | What runs |
|---|---|---|
| `chat` | `agentLoop` | Internal agent loop with all tools |
| `claude_terminal` | `claudeCode` | Claude Code CLI subprocess |
| `codex_terminal` | `codex` | OpenAI Codex CLI subprocess |
| `concurrent` | `concurrent` | Planner → parallel workers → synthesizer |

Routing happens in `ChatIpc.ts` → `ExecutorRouter.ts`. Each executor is exclusive per conversation (one run at a time).

## Adding a New Tool

1. Define the tool schema in the appropriate `src/main/core/cli/*.ts` file (Anthropic tool format)
2. Add the executor function in the same file
3. Register the tool array in `toolRegistry.ts` → `ALL_TOOLS`
4. Add the tool name to the relevant `Set` in `dispatch.ts` and wire it to its executor
5. If the tool should be exposed via MCP bridge, register it in `mcpBridge.ts`

## Adding a New Executor

1. Implement the executor class/function in `src/main/core/executors/`
2. Add its `ExecutorDefinition` to `ExecutorRegistry.ts` → `DEFINITIONS`
3. Add `CONV_MODE_TO_EXECUTOR` and `EXECUTOR_TO_CONV_MODE` entries in `ExecutorRegistry.ts`
4. Add routing case in `ExecutorRouter.ts`
5. Add typed config schema in `ExecutorConfigStore.ts`
6. Handle the new mode in `ChatIpc.ts`

## MCP Bridge

`mcpBridge.ts` runs an HTTP MCP server at `127.0.0.1:<random-port>/<token>`. Each conversation gets its own token for isolation. Claude Code receives config via a temp JSON file; Codex receives it via CLI args.

Tools exposed: all `clawdia_browser_*`, `clawdia_cdp_*`, `clawdia_system_*`, `clawdia_gui_interact`, `clawdia_dbus_control`, `clawdia_terminal_*`.

## Key DB Columns

| Column | Purpose |
|---|---|
| `mode` | Executor routing: `chat`, `claude_terminal`, `codex_terminal`, `concurrent` |
| `claude_code_session_id` | Persisted for `claude --resume` |
| `codex_chat_thread_id` | Persisted for Codex thread continuity |

## Testing

```bash
npm test                    # Full suite
npm run test:watch          # Watch mode
npm run rebuild:test:native # Rebuild native modules for test environment (if tests crash on import)
```

Tests live in `tests/main/` and `tests/renderer/`. Use `vitest` — no Jest.

## Agent Tool Routing

When handling user requests that involve OS or desktop actions, choose the right tool tier:

| Task type | Use |
|---|---|
| Single OS command (launch app, open file, kill process) | `Bash` directly — instant |
| Managed in-app terminal session (write/read later) | `clawdia_terminal_spawn` directly |
| Click a specific GUI element | `clawdia_gui_interact` directly |
| Multi-step, exploratory, or multi-tool work | `clawdia-task-executor` sub-agent |

**Do not route single-command desktop actions through a sub-agent.** Sub-agents add ~45s overhead for work that should take ~1s.

## Prerequisites

- Node.js >= 20
- `claude` CLI on PATH (for Claude Code executor)
- `codex` CLI on PATH (for Codex executor)
- AT-SPI2 + xdotool installed (for desktop automation tools)
- API keys configured in `~/.config/clawdia7/clawdia-settings.json`

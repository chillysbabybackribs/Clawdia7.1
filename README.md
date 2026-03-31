# Clawdia 7.1

AI-powered desktop workspace with multi-provider chat, an embedded browser, terminal emulator, and full OS-level tool access. Built on Electron with a React/TypeScript frontend and a modular agent backend.

Integrates **Claude Code** and **OpenAI Codex** as first-class execution engines — each running as a managed subprocess with session persistence, MCP tool bridging, and a concurrent execution mode that runs both in parallel with AI-powered synthesis.

## Features

- **Multi-provider LLM chat** — switch between Anthropic (Claude), OpenAI (GPT), and Google Gemini models on the fly
- **Claude Code integration** — spawn the Claude Code CLI as a managed subprocess with streaming JSON output, session resumption, and full MCP tool access to Clawdia's browser, desktop, and DBus capabilities
- **Codex integration** — spawn OpenAI's Codex CLI with thread persistence, activity tracking, and MCP bridging for Clawdia's tool suite
- **Concurrent execution** — run Claude Code and Codex in parallel against the same task using a Planner -> Workers -> Synthesizer pipeline with dependency-aware scheduling
- **MCP bridge** — HTTP-based Model Context Protocol server that exposes Clawdia's 19+ browser tools, GUI automation, and DBus control to external CLI agents
- **Embedded Chromium browser** — browse the web inside the app with file preview, review, and publish modes
- **Integrated terminal** — PTY-backed terminal sessions with spawn, write, resize, and multiplexing
- **OS-level tool system** — real shell execution, file I/O, GUI automation (AT-SPI / xdotool), and DBus control
- **Agent framework** — classify-dispatch loop with prompt building, recovery guidance, spending budgets, and policy enforcement
- **Executor system** — pluggable executor registry with routing, configuration, concurrency policies, and runtime state tracking
- **Skills & superpowers** — declarative skill definitions (code review, browser grounding, repo audit, coding execution) matched to messages at runtime
- **Conversation management** — tabbed conversations with independent message history, streaming, and run state
- **Desktop automation** — accessibility tree inspection, screenshot capture, smart focus, and screen mapping
- **Memory system** — SQLite-backed memory store and search for persistent context across sessions
- **Files drawer** — quick-access directory browser with search
- **Monaco editor** — embedded code editor panel

---

## Claude Code Integration

Clawdia spawns the [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI (`claude`) as a managed subprocess, giving you a full agentic coding environment inside the app.

### How It Works

```
User message (mode: claude_terminal)
    │
    ▼
ChatIpc routes to claudeCode executor
    │
    ▼
claudeCodeClient.ts spawns:
  claude --output-format stream-json \
         --resume <session_id> \
         --mcp-config <clawdia-mcp-config.json> \
         --permission-mode <acceptEdits|bypassPermissions>
    │
    ▼
Streaming JSON parsed → text chunks, tool activities, session ID
    │
    ▼
Session ID persisted in DB → resumed on next message
```

### Key Capabilities

| Capability | Detail |
|-----------|--------|
| **Streaming** | Real-time text and tool activity via `--output-format stream-json` |
| **Session persistence** | `claude_code_session_id` stored per conversation in SQLite; resumed with `--resume` |
| **MCP tools** | Clawdia writes a temporary MCP config (`~/.tmp/clawdia-claude-mcp-*.json`) pointing Claude Code at the local MCP bridge — giving it access to browser control, GUI automation, and DBus |
| **Attachments** | Images/files written to temp paths and appended to the prompt |
| **Permission modes** | Respects `unrestrictedMode` setting → `--permission-mode bypassPermissions` or `acceptEdits` |
| **Stale session recovery** | If a session ID fails, the client clears it and retries with a fresh session |

### Implementation Files

- `src/main/claudeCodeClient.ts` — subprocess management, JSON stream parsing, session handling (386 lines)
- `src/main/mcpBridge.ts` — MCP server that Claude Code connects to (657 lines)
- `src/main/ipc/ChatIpc.ts` — routing and IPC integration
- `tests/main/claudeCodeClient.test.ts` — unit tests

---

## Codex Integration

Clawdia spawns [OpenAI Codex](https://openai.com/index/codex/) CLI (`codex`) as a managed subprocess for code generation and editing tasks.

### How It Works

```
User message (mode: codex_terminal)
    │
    ▼
ChatIpc routes to codex executor
    │
    ▼
codexCliClient.ts spawns:
  codex --json \
        -c mcp_servers.clawdia.url="http://127.0.0.1:<port>/mcp/<token>"
    │
    ▼
JSON streaming parsed → text chunks, activity events (started/completed/failed)
    │
    ▼
Thread ID persisted in DB → resumed on next message
```

### Key Capabilities

| Capability | Detail |
|-----------|--------|
| **Streaming** | JSON activity events with `item.started`, `item.completed`, `item.failed` tracking |
| **Thread persistence** | `codex_chat_thread_id` stored per conversation in SQLite |
| **MCP tools** | Codex receives MCP config via CLI args (`-c mcp_servers.clawdia.url=...`) |
| **Inactivity timeout** | 10-minute watchdog kills hanging processes |
| **Activity tracking** | Pending activities tracked with start/complete/fail lifecycle |

### Implementation Files

- `src/main/codexCliClient.ts` — subprocess management, JSON parsing, thread handling (278 lines)
- `src/main/mcpBridge.ts` — shared MCP server
- `src/main/ipc/ChatIpc.ts` — routing and IPC integration
- `tests/main/codexCliClient.test.ts` — unit tests

---

## Concurrent Execution

The concurrent executor runs Claude Code and Codex **in parallel** against the same task, then synthesizes their outputs into a single coherent response.

### Three-Phase Pipeline

```
┌──────────────────────────────────────────────────────────────┐
│  Phase 1: PLANNER                                            │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  agentLoop (1 iteration)                               │  │
│  │  → Analyzes task                                       │  │
│  │  → Produces JSON plan: subtasks + dependencies          │  │
│  │  → Assigns each subtask to claudeCode or codex         │  │
│  └────────────────────────────────────────────────────────┘  │
│                           │                                  │
│  Phase 2: WORKERS (topological execution)                    │
│  ┌─────────────────┐   ┌─────────────────┐                  │
│  │  Claude Code     │   │  Codex           │                 │
│  │  subtask t1      │   │  subtask t2      │  ← parallel    │
│  │  (multi-file     │   │  (focused code   │                 │
│  │   editing)       │   │   generation)    │                 │
│  └────────┬────────┘   └────────┬────────┘                  │
│           │                      │                           │
│           ├──── dependsOn[] ─────┤                           │
│           │                      │                           │
│  ┌────────▼────────────────────▼────────┐                   │
│  │  subtask t3 (depends on t1 + t2)     │  ← sequential    │
│  └──────────────────────────────────────┘                   │
│                           │                                  │
│  Phase 3: SYNTHESIZER                                        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  agentLoop (1 iteration)                               │  │
│  │  → Merges all worker outputs                           │  │
│  │  → Eliminates redundancy                               │  │
│  │  → Resolves conflicts (prefers more complete version)  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Plan Schema

The planner produces structured JSON that drives execution:

```json
{
  "goal": "one-line summary of the overall task",
  "subtasks": [
    {
      "id": "t1",
      "executor": "claudeCode",
      "label": "Refactor auth module",
      "prompt": "full self-contained instruction for this executor",
      "dependsOn": []
    },
    {
      "id": "t2",
      "executor": "codex",
      "label": "Generate test suite",
      "prompt": "full self-contained instruction for this executor",
      "dependsOn": ["t1"]
    }
  ],
  "synthesisHint": "Merge the refactored code with the new tests"
}
```

### Strategies

| Strategy | Behavior |
|----------|----------|
| `parallel` | Both executors work on plan-assigned subtasks simultaneously |
| `claude_primary_codex_review` | Claude Code does primary work; Codex reviews |

### Configuration

```json
// ~/.config/clawdia7/clawdia-settings.json → executorConfigs.concurrent
{
  "enabled": true,
  "strategy": "parallel",
  "synthesize": true,
  "timeoutMs": 300000
}
```

### Implementation Files

- `src/main/core/executors/ConcurrentExecutor.ts` — planner, topological worker runner, synthesizer (559 lines)
- `src/main/ipc/ChatIpc.ts` — concurrent state broadcasting

---

## MCP Bridge

Clawdia runs an HTTP-based [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes its tools to external CLI agents (Claude Code, Codex, or any MCP-compatible client).

### Exposed Tools

| Tool | Description |
|------|-------------|
| `clawdia_browser_navigate` | Navigate the embedded browser to a URL |
| `clawdia_browser_click` | Click an element by CSS selector or coordinates |
| `clawdia_browser_type` | Type text into a focused element |
| `clawdia_browser_screenshot` | Capture a screenshot of the browser viewport |
| `clawdia_browser_extract_text` | Extract text content from the page |
| `clawdia_browser_find_elements` | Find elements matching a CSS selector |
| `clawdia_browser_get_page_state` | Get URL, title, loading state, text excerpt |
| `clawdia_browser_evaluate_js` | Execute JavaScript in the page context |
| `clawdia_browser_scroll` | Scroll the page |
| `clawdia_browser_hover` | Hover over an element |
| `clawdia_browser_select` | Select an option from a dropdown |
| `clawdia_browser_key_press` | Send keyboard events |
| `clawdia_browser_back` / `forward` | Browser navigation history |
| `clawdia_browser_new_tab` / `close_tab` / `switch_tab` / `list_tabs` | Tab management |
| `clawdia_browser_wait_for` | Wait for an element or condition |
| `clawdia_browser_get_element_text` | Get text of a specific element |
| `clawdia_gui_interact` | Linux desktop GUI automation (AT-SPI / xdotool) |
| `clawdia_dbus_control` | Call system DBus services |

### How It Connects

```
                     ┌─────────────────────┐
                     │   Clawdia App        │
                     │                     │
  Claude Code ──────▶│  HTTP MCP Server    │──▶ ElectronBrowserService
  (subprocess)       │  127.0.0.1:<port>   │──▶ GUI Executor
                     │  /mcp/<token>       │──▶ DBus Controller
  Codex ────────────▶│                     │
  (subprocess)       └─────────────────────┘

  Config delivery:
    Claude Code → temp JSON file (~/.tmp/clawdia-claude-mcp-*.json)
    Codex       → CLI args (-c mcp_servers.clawdia.url="...")
```

### Per-Conversation Isolation

Each conversation gets its own MCP token and config path. Sessions are isolated — Claude Code running in one conversation tab cannot interfere with Codex running in another.

### Implementation Files

- `src/main/mcpBridge.ts` — HTTP server, MCP tool registration, per-conversation config generation (657 lines)

---

## Executor System

All execution engines are managed through a unified executor registry with routing, configuration, and runtime state tracking.

### Registered Executors

| Executor | ID | Category | Streaming | Tool Calls | Session Persistence | Default |
|----------|----|----------|-----------|------------|-------------------|---------|
| Agent Loop | `agentLoop` | agent-loop | Yes | Yes | Via DB message history | Enabled (default) |
| Claude Code | `claudeCode` | external-cli | Yes | Yes | `claude_code_session_id` in DB | Enabled |
| Codex | `codex` | external-cli | Yes | Internal | `codex_chat_thread_id` in DB | Enabled |
| Concurrent | `concurrent` | local | Yes | Yes | Per-sub-executor | Disabled (opt-in) |

### Conversation Mode Routing

```
User sends message
    │
    ▼
ChatIpc reads conversation.mode from DB
    │
    ▼
ExecutorRouter.routeExecutor(mode)
    ├── 'chat'            → agentLoop
    ├── 'claude_terminal'  → claudeCode
    ├── 'codex_terminal'   → codex
    └── 'concurrent'       → concurrent
    │
    ▼
Concurrency enforcement: exclusive (one run per conversation)
    │
    ▼
Executor spawned with task tracking, run registration, abort signal
```

### Executor Configuration

Each executor has a typed config stored in `~/.config/clawdia7/clawdia-settings.json`:

```json
{
  "executorConfigs": {
    "agentLoop": {
      "enabled": true,
      "pipelineEnabled": true,
      "maxSessionTurns": 20,
      "maxMappingSessionTurns": 6,
      "timeoutMs": 0
    },
    "claudeCode": {
      "enabled": true,
      "resumeSession": true,
      "skipPermissions": false,
      "timeoutMs": 0
    },
    "codex": {
      "enabled": true,
      "resumeThread": true,
      "timeoutMs": 0
    },
    "concurrent": {
      "enabled": false,
      "strategy": "parallel",
      "synthesize": true,
      "timeoutMs": 300000
    }
  }
}
```

### Implementation Files

- `src/main/core/executors/ExecutorRegistry.ts` — executor definitions and capability metadata
- `src/main/core/executors/ExecutorRouter.ts` — routing, concurrency policy, runtime state
- `src/main/core/executors/ExecutorConfigStore.ts` — per-executor configuration with typed schemas
- `src/main/core/executors/ChatExecutor.ts` — multi-turn agent loop executor with event system
- `src/main/core/executors/ConcurrentExecutor.ts` — three-phase parallel execution

---

## Architecture

```
src/
  main/                         # Electron main process
    agent/                      # Agent loop, classify, dispatch, prompt building
      agentLoop.ts              # Core agent execution loop
      classify.ts               # Intent classification
      dispatch.ts               # Tool dispatch
      promptBuilder.ts          # System prompt construction
      policy-engine.ts          # Policy enforcement
      recoveryGuidance.ts       # Error recovery strategies
      spending-budget.ts        # Token/cost budget tracking
    core/
      browser/                  # Embedded Chromium browser service
      cli/                      # Shell, file, browser, memory, workspace tools
        shellTools.ts           # File + shell tool definitions
        browserTools.ts         # Browser control tools
        selfAwareTools.ts       # Agent introspection tools
        workspaceTools.ts       # Workspace-level queries
        toolRegistry.ts         # Central tool registry
      desktop/                  # GUI automation (AT-SPI, xdotool, DBus)
        a11y.ts                 # Accessibility tree inspection
        screenshot.ts           # Screen capture
        guiExecutor.ts          # GUI action executor
        dbus.ts                 # DBus service control
      terminal/                 # PTY terminal session controller
      executors/                # Executor system
        ExecutorRegistry.ts     # Executor definitions + capabilities
        ExecutorRouter.ts       # Routing + concurrency policy
        ExecutorConfigStore.ts  # Typed per-executor configuration
        ChatExecutor.ts         # Multi-turn agent loop executor
        ConcurrentExecutor.ts   # Planner → Workers → Synthesizer
      providers/                # LLM provider adapters
        anthropicMessageProtocol.ts
        openAIMessageProtocol.ts
        geminiMessageProtocol.ts
        ProviderClient.ts       # Unified provider interface
    claudeCodeClient.ts         # Claude Code CLI subprocess manager
    codexCliClient.ts           # Codex CLI subprocess manager
    mcpBridge.ts                # MCP HTTP server for tool bridging
    db.ts                       # SQLite initialization
    main.ts                     # Electron entry point
    registerIpc.ts              # IPC channel registration
    settingsStore.ts            # Settings read/write
    skills/                     # Skill system
      skillSystem.ts            # Skill parsing + matching
      promptComposition.ts      # Prompt building with matched skills

  renderer/                     # React frontend
    components/
      AppChrome.tsx             # Top bar (clock, VPN, window controls)
      ChatPanel.tsx             # Message history + streaming display
      InputBar.tsx              # Text input, model selector, send button
      TabStrip.tsx              # Conversation tab management
      BrowserPanel.tsx          # Embedded browser view
      TerminalPanel.tsx         # Terminal emulator UI
      EditorPanel.tsx           # Monaco code editor
      SettingsView.tsx          # Settings configuration
      ToolActivity.tsx          # Inline tool execution cards
      Sidebar.tsx               # Navigation sidebar
      RightFilesDrawer.tsx      # File browser drawer
      AgentSidebar.tsx          # Agent configuration panel
      SplitExecutionView.tsx    # Concurrent execution split view
      WelcomeScreen.tsx         # Landing screen
    App.tsx                     # Root renderer component

  shared/                       # Shared between main + renderer
    model-registry.ts           # Provider + model definitions (19+ models)
    types.ts                    # Shared type definitions

system/                         # Capability definitions (runtime)
  context.md                    # Environment grounding
  contracts/                    # Task completion contracts
  domains/                      # Domain-specific guidance
  recovery/                     # Recovery strategies
  registry/                     # Tool/capability registry + superpowers.json
  tasks/                        # Task type definitions

agents/                         # Agent presets (code-reviewer, developer-assistant)
contracts/                      # Completion contracts
domains/                        # Domain guidance (browser, coding, desktop, filesystem)
skills/                         # Skill definitions
  browser-grounding/            # Web navigation grounding
  code-review/                  # Security, performance, test review
  coding-execution/             # Code reading + verification
  repo-audit/                   # Architecture + drift auditing
prompts/                        # System prompts, templates, few-shot examples
```

## Tech Stack

| Layer        | Technology                                    |
|-------------|-----------------------------------------------|
| Runtime     | Electron 39.5, Node.js 20+                   |
| Frontend    | React 19, TypeScript, Tailwind CSS, Vite      |
| Editor      | Monaco Editor                                 |
| Terminal    | xterm.js + node-pty                           |
| Database    | better-sqlite3                                |
| LLM SDKs   | @anthropic-ai/sdk, openai, @google/genai      |
| MCP         | @modelcontextprotocol/sdk 1.28+               |
| CLI Agents  | Claude Code CLI, OpenAI Codex CLI             |
| Build       | electron-builder (AppImage on Linux)           |
| Test        | Vitest, Testing Library                        |

## Prerequisites

- **Node.js** >= 20.0.0
- **npm** (comes with Node.js)
- **Linux** (x86_64) — primary target platform
- System dependencies for native modules: `python3`, `make`, `g++`
- For desktop automation: AT-SPI2 and xdotool

### For Claude Code executor

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and on PATH (`claude`)
- Anthropic API key configured in Clawdia settings

### For Codex executor

- [OpenAI Codex CLI](https://openai.com/index/codex/) installed and on PATH (`codex`)
- OpenAI API key configured in Clawdia settings

### For Concurrent executor

- Both Claude Code and Codex CLIs installed
- Both API keys configured

## Getting Started

```bash
# Clone the repository
git clone https://github.com/chillysbabybackribs/Clawdia7.1.git
cd Clawdia7.1

# Install dependencies (automatically rebuilds native modules)
npm install

# Run in development mode (with hot reload)
npm run dev

# Or run a stable build
npm run safe-dev
```

## Scripts

| Command              | Description                                           |
|---------------------|-------------------------------------------------------|
| `npm run dev`       | Start dev mode with HMR (main + renderer + electron)  |
| `npm run safe-dev`  | Build then start in production mode                   |
| `npm run build`     | Build main process + renderer                         |
| `npm start`         | Start built app in production mode                    |
| `npm run package`   | Build and package as AppImage                         |
| `npm test`          | Run tests (vitest)                                    |
| `npm run test:watch`| Run tests in watch mode                               |

## Configuration

Settings are stored at `~/.config/clawdia7/clawdia-settings.json` and include:

- **Provider selection** — choose between `anthropic`, `openai`, or `gemini`
- **Model selection** — pick a specific model from the active provider
- **API keys** — per-provider API key configuration
- **Executor configs** — per-executor enable/disable, timeouts, strategy, session resumption
- **Unrestricted mode** — bypasses permission prompts for Claude Code

## Providers

Clawdia supports three LLM providers out of the box:

- **Anthropic** — Claude models (default)
- **OpenAI** — GPT models
- **Google Gemini** — Gemini models

Switch providers and models at runtime via the model selector in the input bar.

## Tool System

Tools are real OS-level operations, not simulated:

- **Shell** — spawn child processes, execute commands
- **File** — read, write, edit files and directories
- **Browser** — control the embedded Chromium browser (navigate, click, extract, screenshot)
- **Desktop** — GUI automation via AT-SPI accessibility tree and xdotool
- **DBus** — control system services (media players, notifications, etc.)
- **Memory** — persistent SQLite-backed memory store and search
- **Workspace** — project-level queries and state inspection

All tool calls flow through IPC: renderer -> preload -> main process -> tool executor.

External CLI agents (Claude Code, Codex) access these tools via the MCP bridge HTTP server.

## Database Schema

Key conversation columns for executor integration:

| Column | Purpose |
|--------|---------|
| `mode` | Determines executor: `chat`, `claude_terminal`, `codex_terminal`, `concurrent` |
| `claude_code_session_id` | Persisted session for Claude Code `--resume` |
| `codex_chat_thread_id` | Persisted thread for Codex session continuity |

## License

MIT

## Author

Daniel Parker ([@chillysbabybackribs](https://github.com/chillysbabybackribs))

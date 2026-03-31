# Clawdia 7.1

AI-powered desktop workspace with multi-provider chat, an embedded browser, terminal emulator, and full OS-level tool access. Built on Electron with a React/TypeScript frontend and a modular agent backend.

## Features

- **Multi-provider LLM chat** — switch between Anthropic (Claude), OpenAI (GPT), and Google Gemini models on the fly
- **Embedded Chromium browser** — browse the web inside the app with file preview, review, and publish modes
- **Integrated terminal** — PTY-backed terminal sessions with spawn, write, resize, and multiplexing
- **OS-level tool system** — real shell execution, file I/O, GUI automation (AT-SPI / xdotool), and DBus control
- **Agent framework** — classify-dispatch loop with prompt building, recovery guidance, spending budgets, and policy enforcement
- **Skills & executors** — pluggable skill definitions (code review, browser grounding, repo audit, coding execution) and concurrent executor routing
- **Conversation management** — tabbed conversations with independent message history, streaming, and run state
- **Desktop automation** — accessibility tree inspection, screenshot capture, smart focus, and screen mapping
- **Memory system** — SQLite-backed memory store and search for persistent context across sessions
- **Files drawer** — quick-access directory browser with search
- **Monaco editor** — embedded code editor panel

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
      executors/                # Chat executor system
        ChatExecutor.ts         # Base chat executor
        ConcurrentExecutor.ts   # Parallel execution support
        ExecutorRouter.ts       # Route to appropriate executor
      providers/                # LLM provider adapters
        anthropicMessageProtocol.ts
        openAIMessageProtocol.ts
        geminiMessageProtocol.ts
        ProviderClient.ts       # Unified provider interface
    db.ts                       # SQLite initialization
    main.ts                     # Electron entry point
    registerIpc.ts              # IPC channel registration
    settingsStore.ts            # Settings read/write

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
      WelcomeScreen.tsx         # Landing screen
    App.tsx                     # Root renderer component

  shared/                       # Shared between main + renderer
    model-registry.ts           # Provider + model definitions
    types.ts                    # Shared type definitions

system/                         # Capability definitions (runtime)
  context.md                    # Environment grounding
  contracts/                    # Task completion contracts
  domains/                      # Domain-specific guidance
  recovery/                     # Recovery strategies
  registry/                     # Tool/capability registry
  tasks/                        # Task type definitions

agents/                         # Agent presets
contracts/                      # Completion contracts
domains/                        # Domain guidance (browser, coding, desktop, filesystem)
skills/                         # Skill definitions (code-review, browser-grounding, etc.)
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
| MCP         | @modelcontextprotocol/sdk                      |
| Build       | electron-builder (AppImage on Linux)           |
| Test        | Vitest, Testing Library                        |

## Prerequisites

- **Node.js** >= 20.0.0
- **npm** (comes with Node.js)
- **Linux** (x86_64) — primary target platform
- System dependencies for native modules: `python3`, `make`, `g++`
- For desktop automation: AT-SPI2 and xdotool

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

## Project Structure (Non-Source)

| Directory     | Purpose                                        |
|--------------|------------------------------------------------|
| `agents/`    | Agent preset configurations                    |
| `contracts/` | Task completion criteria definitions            |
| `domains/`   | Domain-specific guidance (browser, code, etc.) |
| `maps/`      | Screen/UI mapping data                         |
| `prompts/`   | System prompts, templates, few-shot examples   |
| `skills/`    | Pluggable skill definitions                    |
| `system/`    | Runtime capability and context files           |
| `tests/`     | Test suites (main, renderer, shared, pilot)    |
| `docs/`      | Documentation                                  |

## License

MIT

## Author

Daniel Parker ([@chillysbabybackribs](https://github.com/chillysbabybackribs))

# Clawdia 7.1

An AI-powered desktop workspace built on Electron. Clawdia combines a multi-provider chat interface with an embedded browser, terminal, code editor, and full OS-level tool access — giving LLMs real agency over your local machine.

<!-- ![Clawdia Screenshot](docs/screenshot.png) -->

## Features

- **Multi-provider chat** — Claude (Anthropic), GPT (OpenAI), and Gemini (Google) with streaming responses and tool-use support
- **Embedded Chromium browser** — a real browser session with your cookies, controllable by the AI agent or by you
- **Integrated terminal** — PTY-backed shell sessions right inside the app
- **Code editor** — Monaco-based editor panel for reviewing and editing files
- **OS-level tool access** — file I/O, shell execution, GUI automation (AT-SPI + xdotool), desktop control
- **Agent loop** — autonomous multi-step task execution with planning, tool dispatch, and recovery
- **Conversation tabs** — multiple parallel chat sessions with independent state
- **Capability file system** — modular identity, domain knowledge, and task-specific process files loaded on demand
- **SQLite-backed storage** — conversations, memory, and run history persisted locally

## Tech Stack

- **Electron 39** (Chromium + Node.js)
- **React 19** + Tailwind CSS (renderer)
- **TypeScript** throughout
- **Vite** for renderer bundling
- **better-sqlite3** for local persistence
- **node-pty** for terminal sessions
- **Monaco Editor** for the code panel

## Prerequisites

- Node.js >= 20
- npm
- Linux (primary target) — may work on macOS/Windows with adjustments

## Getting Started

```bash
# Clone the repo
git clone https://github.com/chillysbabybackribs/Clawdia7.1.git
cd Clawdia7.1

# Install dependencies (rebuilds native modules automatically)
npm install

# Run in development mode (hot-reload renderer + watching main process)
npm run dev
```

Set your API keys in the Settings panel once the app launches, or via environment variables:

```bash
export ANTHROPIC_API_KEY="your-key"
export OPENAI_API_KEY="your-key"
export GEMINI_API_KEY="your-key"
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development mode with hot reload |
| `npm run build` | Build main + renderer |
| `npm start` | Run production build |
| `npm run package` | Package as AppImage (Linux) |
| `npm test` | Run tests (Vitest) |

## Project Structure

```
src/
  main/           # Electron main process
    agent/        # Agent loop, prompt building, dispatch
    core/
      browser/    # Embedded Chromium browser service
      cli/        # Shell, file, browser, memory tools
      desktop/    # GUI automation (AT-SPI, xdotool)
      terminal/   # PTY session controller
    db.ts         # SQLite initialization
    main.ts       # Electron entry point
  renderer/       # React UI
    components/   # ChatPanel, BrowserPanel, TerminalPanel, InputBar, etc.
    App.tsx       # Root component
  shared/         # Shared types and utilities
system/           # Capability file system (identity, domains, registry)
```

## License

[MIT](LICENSE)

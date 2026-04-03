// src/main/core/cli/terminalTools.ts
// Tool definitions and executor for terminal/pty session management.
// Exposes spawn, write, read, list, kill to the chat agent.

import type Anthropic from '@anthropic-ai/sdk';
import type { TerminalSessionController } from '../terminal/TerminalSessionController';

// ── Tool schemas (Anthropic format) ─────────────────────────────────────────

export const TERMINAL_TOOLS: Anthropic.Tool[] = [
  {
    name: 'terminal_spawn',
    description:
      'Spawn a new terminal session (pty). Returns sessionId, pid, and initial state. ' +
      'Use terminal_write to send commands and terminal_read to get buffered output.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sessionId: {
          type: 'string',
          description: 'Unique id for this session (e.g. "calc-session-1")',
        },
        cwd: {
          type: 'string',
          description: 'Working directory (default: home directory)',
        },
        shell: {
          type: 'string',
          description: 'Shell binary (default: $SHELL or /bin/bash)',
        },
        cols: {
          type: 'number',
          description: 'Terminal columns (default: 120)',
        },
        rows: {
          type: 'number',
          description: 'Terminal rows (default: 30)',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'terminal_write',
    description:
      'Write input to a live terminal session. Use "\\n" to submit a command. ' +
      'Example: terminal_write({sessionId: "s1", data: "ls -la\\n"})',
    input_schema: {
      type: 'object' as const,
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session id to write to',
        },
        data: {
          type: 'string',
          description: 'Data to write (e.g. "gnome-calculator\\n")',
        },
      },
      required: ['sessionId', 'data'],
    },
  },
  {
    name: 'terminal_read',
    description:
      'Read buffered output from a terminal session. Returns the full output buffer, ' +
      'session state (pid, exitCode, connected), and whether the process is still running.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session id to read from',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'terminal_list',
    description:
      'List all terminal sessions (live and archived) with their state including pid, exitCode, and owner.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'terminal_kill',
    description: 'Kill a live terminal session by its session id.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session id to kill',
        },
      },
      required: ['sessionId'],
    },
  },
];

export const TERMINAL_TOOL_NAMES = new Set(TERMINAL_TOOLS.map(t => t.name));

// ── Executor ────────────────────────────────────────────────────────────────

export async function executeTerminalTool(
  name: string,
  args: Record<string, unknown>,
  controller: TerminalSessionController,
): Promise<string> {
  try {
    if (name === 'terminal_spawn') {
      const sessionId = args.sessionId as string;
      if (!sessionId) return JSON.stringify({ ok: false, error: 'sessionId is required' });
      const state = controller.spawn(sessionId, {
        cwd: args.cwd as string | undefined,
        shell: args.shell as string | undefined,
        cols: args.cols as number | undefined,
        rows: args.rows as number | undefined,
      });
      if (!state) {
        return JSON.stringify({ ok: false, error: 'Failed to spawn terminal (node-pty unavailable)' });
      }
      return JSON.stringify({
        ok: true,
        sessionId: state.sessionId,
        pid: state.pid,
        connected: state.connected,
      });
    }

    if (name === 'terminal_write') {
      const sessionId = args.sessionId as string;
      const data = args.data as string;
      if (!sessionId || data == null) {
        return JSON.stringify({ ok: false, error: 'sessionId and data are required' });
      }
      const ok = controller.write(sessionId, data, { source: 'clawdia_agent' });
      return JSON.stringify({ ok });
    }

    if (name === 'terminal_read') {
      const sessionId = args.sessionId as string;
      if (!sessionId) return JSON.stringify({ ok: false, error: 'sessionId is required' });
      const snapshot = controller.getSnapshot(sessionId);
      if (!snapshot) {
        return JSON.stringify({ ok: false, error: `No session found with id "${sessionId}"` });
      }
      // Truncate output to last 8KB to avoid blowing up context
      const MAX_OUTPUT = 8192;
      const output = snapshot.output.length > MAX_OUTPUT
        ? '...[truncated]...\n' + snapshot.output.slice(-MAX_OUTPUT)
        : snapshot.output;
      return JSON.stringify({
        ok: true,
        sessionId: snapshot.sessionId,
        pid: snapshot.pid,
        connected: snapshot.connected,
        exitCode: snapshot.exitCode,
        signal: snapshot.signal ?? null,
        output,
      });
    }

    if (name === 'terminal_list') {
      const sessions = controller.list().map(s => ({
        sessionId: s.sessionId,
        pid: s.pid,
        connected: s.connected,
        exitCode: s.exitCode,
        owner: s.owner,
        mode: s.mode,
      }));
      return JSON.stringify({ ok: true, sessions });
    }

    if (name === 'terminal_kill') {
      const sessionId = args.sessionId as string;
      if (!sessionId) return JSON.stringify({ ok: false, error: 'sessionId is required' });
      const ok = controller.kill(sessionId);
      return JSON.stringify({ ok });
    }

    return JSON.stringify({ ok: false, error: `Unknown terminal tool: ${name}` });
  } catch (err) {
    return JSON.stringify({ ok: false, error: (err as Error).message });
  }
}

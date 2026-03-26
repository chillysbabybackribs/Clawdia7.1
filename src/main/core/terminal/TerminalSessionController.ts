import { EventEmitter } from 'events';
import * as os from 'os';
import type {
  SessionOwner,
  SessionMode,
  TerminalSessionState,
  SpawnOpts,
  WriteMeta,
  AcquireMeta,
} from './types';

const DEFAULT_SHELL = process.env.SHELL || '/bin/bash';
const DEFAULT_CWD = os.homedir();
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const MAX_OUTPUT_BUFFER = 256 * 1024; // 256KB

// node-pty loaded lazily so a load failure doesn't crash the whole app
let pty: typeof import('node-pty') | null = null;
try {
  pty = require('node-pty');
} catch {
  console.warn('[terminal] node-pty not available — terminal disabled');
}

interface LiveSession {
  kind: 'live';
  sessionId: string;
  proc: import('node-pty').IPty;
  owner: SessionOwner;
  mode: SessionMode;
  runId: string | null;
  conversationId: string | null;
  output: string;
  cols: number;
  rows: number;
}

interface ArchivedSession {
  kind: 'archived';
  sessionId: string;
  owner: SessionOwner;
  mode: SessionMode;
  runId: string | null;
  conversationId: string | null;
  output: string;
  exitCode: number | null;
  signal?: number;
}

type Session = LiveSession | ArchivedSession;

export class TerminalSessionController extends EventEmitter {
  private sessions = new Map<string, Session>();

  isAvailable(): boolean {
    return pty !== null;
  }

  spawn(id: string, opts?: SpawnOpts): TerminalSessionState | null {
    if (!pty) return null;

    // Kill existing session with same id if present
    const existing = this.sessions.get(id);
    if (existing?.kind === 'live') {
      try { existing.proc.kill(); } catch { /* ignore */ }
    }

    const cols = opts?.cols ?? DEFAULT_COLS;
    const rows = opts?.rows ?? DEFAULT_ROWS;
    const cwd = opts?.cwd ?? DEFAULT_CWD;
    const shell = opts?.shell ?? DEFAULT_SHELL;

    let proc: import('node-pty').IPty;
    try {
      proc = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: {
          ...process.env as Record<string, string>,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        },
      });
    } catch (err) {
      console.error('[terminal] spawn failed:', err);
      return null;
    }

    const session: LiveSession = {
      kind: 'live',
      sessionId: id,
      proc,
      owner: 'user',
      mode: 'user_owned',
      runId: null,
      conversationId: null,
      output: '',
      cols,
      rows,
    };

    this.sessions.set(id, session);

    proc.onData((data) => {
      session.output += data;
      if (session.output.length > MAX_OUTPUT_BUFFER) {
        session.output = session.output.slice(session.output.length - MAX_OUTPUT_BUFFER);
      }
      this.emit('data', { id, data });
    });

    proc.onExit(({ exitCode, signal }) => {
      const archived: ArchivedSession = {
        kind: 'archived',
        sessionId: id,
        owner: session.owner,
        mode: session.mode,
        runId: session.runId,
        conversationId: session.conversationId,
        output: session.output,
        exitCode: exitCode ?? null,
        signal,
      };
      this.sessions.set(id, archived);
      this.emit('exit', { id, code: exitCode ?? 0, signal });
      this.emit('sessionState', this._toState(archived));
    });

    const state = this._toState(session);
    this.emit('sessionState', state);
    return state;
  }

  write(id: string, data: string, meta?: WriteMeta): boolean {
    const session = this.sessions.get(id);
    if (!session || session.kind !== 'live') return false;

    const source = meta?.source ?? 'user';

    // Access control
    if (session.mode === 'observe_only') return false;
    if (session.mode === 'agent_owned' && source === 'user') return false;
    if (session.mode === 'handoff_pending' && source === 'clawdia_agent') return false;

    try {
      session.proc.write(data);
      return true;
    } catch {
      return false;
    }
  }

  resize(id: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(id);
    if (!session || session.kind !== 'live') return false;
    try {
      session.proc.resize(cols, rows);
      session.cols = cols;
      session.rows = rows;
      return true;
    } catch {
      return false;
    }
  }

  kill(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session || session.kind !== 'live') return false;
    try {
      session.proc.kill();
    } catch { /* onExit will fire and archive */ }
    return true;
  }

  list(): TerminalSessionState[] {
    return Array.from(this.sessions.values()).map((s) => this._toState(s));
  }

  getSnapshot(id: string): TerminalSessionState | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    return this._toState(session);
  }

  acquire(id: string, owner: SessionOwner, meta?: AcquireMeta): boolean {
    const session = this.sessions.get(id);
    if (!session || session.kind !== 'live') return false;
    session.owner = owner;
    session.mode = 'agent_owned';
    if (meta?.runId) session.runId = meta.runId;
    if (meta?.conversationId) session.conversationId = meta.conversationId;
    this.emit('sessionState', this._toState(session));
    return true;
  }

  release(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session || session.kind !== 'live') return false;
    session.owner = 'user';
    session.mode = 'user_owned';
    session.runId = null;
    this.emit('sessionState', this._toState(session));
    return true;
  }

  requestTakeover(id: string, requester: string): boolean {
    const session = this.sessions.get(id);
    if (!session || session.kind !== 'live') return false;
    session.mode = 'handoff_pending';
    this.emit('sessionState', this._toState(session));
    return true;
  }

  appendOutput(id: string, data: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.output += data;
    if (session.output.length > MAX_OUTPUT_BUFFER) {
      session.output = session.output.slice(session.output.length - MAX_OUTPUT_BUFFER);
    }
    this.emit('data', { id, data });
    return true;
  }

  private _toState(session: Session): TerminalSessionState {
    if (session.kind === 'archived') {
      return {
        sessionId: session.sessionId,
        owner: session.owner,
        mode: session.mode,
        connected: false,
        agentControlled: false,
        runId: session.runId,
        conversationId: session.conversationId,
        exitCode: session.exitCode,
        signal: session.signal,
        output: session.output,
      };
    }
    return {
      sessionId: session.sessionId,
      owner: session.owner,
      mode: session.mode,
      connected: true,
      agentControlled: session.owner === 'clawdia_agent',
      runId: session.runId,
      conversationId: session.conversationId,
      exitCode: null,
      output: session.output,
    };
  }
}

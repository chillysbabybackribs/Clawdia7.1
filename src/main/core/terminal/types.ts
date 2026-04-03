export type SessionOwner = 'user' | 'clawdia_agent' | 'system';
export type SessionMode = 'user_owned' | 'agent_owned' | 'observe_only' | 'handoff_pending';
export type TerminalWriteSource = 'user' | 'clawdia_agent' | 'system';

export interface TerminalSessionState {
  sessionId: string;
  pid: number | null;
  owner: SessionOwner;
  mode: SessionMode;
  connected: boolean;
  agentControlled: boolean;
  runId: string | null;
  conversationId: string | null;
  exitCode: number | null;
  signal?: number;
  output: string;
}

export interface SpawnOpts {
  cols?: number;
  rows?: number;
  cwd?: string;
  shell?: string;
}

export interface WriteMeta {
  source?: TerminalWriteSource;
  conversationId?: string;
  runId?: string;
}

export interface AcquireMeta {
  runId?: string;
  conversationId?: string;
  mode?: SessionMode;
  executorMode?: string;
}

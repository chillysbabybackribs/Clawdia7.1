import type { AgentBuilderCompileInput, AgentBuilderCompileResult, AgentDefinition, AgentRunHistoryItem, MessageAttachment, PromptDebugSnapshot } from '../shared/types';

declare global {
  interface ClawdiaAPI {
    chat: {
      send: (message: string, attachments?: MessageAttachment[], conversationId?: string | null) => Promise<any>;
      openAttachment: (filePath: string) => Promise<any>;
      stop: () => Promise<any>;
      new: () => Promise<any>;
      list: () => Promise<any>;
      load: (id: string) => Promise<any>;
      getMode: (id: string) => Promise<any>;
      setMode: (id: string, mode: 'chat' | 'claude_terminal' | 'codex_terminal') => Promise<any>;
      getActiveTerminalSession: (conversationId?: string | null) => Promise<{ sessionId: string | null }>;
      delete: (id: string) => Promise<any>;
      onStreamText: (cb: (text: string) => void) => () => void;
      onStreamEnd: (cb: (data: any) => void) => () => void;
      onThinking: (cb: (thought: string) => void) => () => void;
      onPromptDebug: (cb: (payload: PromptDebugSnapshot) => void) => () => void;
      onToolActivity: (cb: (activity: any) => void) => () => void;
      onClaudeStatus: (cb: (payload: { conversationId: string; sessionId: string; status: string; summary: string; lastActivity: string | null }) => void) => () => void;
    };
    browser: {
      navigate: (url: string) => Promise<any>;
      back: () => Promise<any>;
      forward: () => Promise<any>;
      refresh: () => Promise<any>;
      setBounds: (bounds: any) => Promise<any>;
      getExecutionMode: () => Promise<string>;
      listSessions: () => Promise<string[]>;
      clearSession: (domain: string) => Promise<any>;
      onUrlChanged: (cb: (url: string) => void) => () => void;
      onTitleChanged: (cb: (title: string) => void) => () => void;
      onLoading: (cb: (loading: boolean) => void) => () => void;
      onModeChanged: (cb: (payload: { mode: string; reason: string }) => void) => () => void;
    };
    settings: {
      get: (key: string) => Promise<any>;
      set: (key: string, value: any) => Promise<any>;
      getApiKey: () => Promise<string>;
      setApiKey: (key: string) => Promise<any>;
      getModel: () => Promise<string>;
      setModel: (model: string) => Promise<any>;
      getUnrestrictedMode: () => Promise<boolean>;
      setUnrestrictedMode: (enabled: boolean) => Promise<any>;
      getPolicyProfile: () => Promise<string>;
      setPolicyProfile: (profileId: string) => Promise<any>;
      getPerformanceStance: () => Promise<'conservative' | 'standard' | 'aggressive'>;
      setPerformanceStance: (stance: 'conservative' | 'standard' | 'aggressive') => Promise<any>;
    };
    process: {
      list: () => Promise<any>;
      detach: () => Promise<any>;
      attach: (processId: string) => Promise<any>;
      cancel: (processId: string) => Promise<any>;
      dismiss: (processId: string) => Promise<any>;
      onListChanged: (cb: (processes: any[]) => void) => () => void;
    };
    run: {
      list: () => Promise<any>;
      get: (runId: string) => Promise<any>;
      events: (runId: string) => Promise<any>;
      changes: (runId: string) => Promise<any>;
      scorecard: () => Promise<any>;
      approvals: (runId: string) => Promise<any>;
      humanInterventions: (runId: string) => Promise<any>;
      approve: (approvalId: number) => Promise<any>;
      deny: (approvalId: number) => Promise<any>;
      resolveHumanIntervention: (interventionId: number) => Promise<any>;
    };
    agent: {
      list: () => Promise<AgentDefinition[]>;
      get: (id: string) => Promise<AgentDefinition | null>;
      create: (input: Partial<AgentDefinition> & { goal: string }) => Promise<AgentDefinition>;
      compile: (input: AgentBuilderCompileInput) => Promise<AgentBuilderCompileResult>;
      update: (id: string, patch: Partial<AgentDefinition>) => Promise<AgentDefinition | null>;
      delete: (id: string) => Promise<{ ok: boolean }>;
      run: (id: string) => Promise<{ ok: boolean; runId?: string; conversationId?: string; error?: string }>;
      runOnCurrentPage: (id: string) => Promise<{ ok: boolean; runId?: string; conversationId?: string; error?: string }>;
      runOnUrls: (id: string, urls: string[]) => Promise<{ ok: boolean; runId?: string; conversationId?: string; error?: string }>;
      history: (id: string) => Promise<AgentRunHistoryItem[]>;
      test: (id: string) => Promise<{ ok: boolean; runId?: string; conversationId?: string; error?: string }>;
    };
    swarm: {
      onStateChanged: (cb: (state: any) => void) => () => void;
    };
    policy: {
      list: () => Promise<any>;
    };
    window: {
      minimize: () => Promise<void>;
      maximize: () => Promise<void>;
      close: () => Promise<void>;
    };
    terminal: {
      isAvailable: () => Promise<boolean>;
      spawn: (id: string, opts?: { command?: string; args?: string[]; cwd?: string; cols?: number; rows?: number }) => Promise<{ id: string; pid: number } | null>;
      write: (id: string, data: string, meta?: { source?: 'user' | 'clawdia_agent' | 'claude_code' | 'codex' | 'system'; runId?: string; conversationId?: string }) => Promise<boolean>;
      resize: (id: string, cols: number, rows: number) => Promise<boolean>;
      kill: (id: string) => Promise<boolean>;
      list: () => Promise<Array<{ id: string; pid: number; agentControlled: boolean; lastActivity: number; sessionType: 'shell' | 'claude_interactive' | 'claude_task'; owner: 'user' | 'agent' | 'external_agent'; mode: 'user_owned' | 'agent_owned' | 'handoff' | 'observe_only'; runId?: string; conversationId?: string }>>;
      getSnapshot: (id: string) => Promise<{
        id: string;
        output: string;
        connected: boolean;
        agentControlled: boolean;
        lastActivity: number | null;
        exitCode: number | null;
        signal?: number;
        sessionType: 'shell' | 'claude_interactive' | 'claude_task';
        owner: 'user' | 'agent' | 'external_agent';
        mode: 'user_owned' | 'agent_owned' | 'handoff' | 'observe_only';
        runId: string | null;
        conversationId: string | null;
        takeoverRequestedBy: 'user' | 'agent' | 'external_agent' | null;
        activeRun: string | null;
      } | null>;
      acquire: (id: string, owner: 'user' | 'agent' | 'external_agent', meta?: { runId?: string; conversationId?: string; mode?: 'user_owned' | 'agent_owned' | 'handoff' | 'observe_only' }) => Promise<boolean>;
      release: (id: string) => Promise<boolean>;
      requestTakeover: (id: string, requester: 'user' | 'agent' | 'external_agent') => Promise<boolean>;
      spawnClaudeCode: (sessionId: string, task: string, opts?: { cwd?: string; mode?: 'print' | 'interactive' }) => Promise<{ sessionId: string; exitCode: number | null; output: string }>;
      onData: (cb: (payload: { id: string; data: string }) => void) => () => void;
      onExit: (cb: (payload: { id: string; code: number; signal?: number }) => void) => () => void;
      onEvent: (cb: (payload: { type: string; sessionId: string; runId?: string; source: string; timestamp: number; payload: any }) => void) => () => void;
      onSessionState: (cb: (payload: {
        id: string;
        output: string;
        connected: boolean;
        agentControlled: boolean;
        lastActivity: number | null;
        exitCode: number | null;
        signal?: number;
        sessionType: 'shell' | 'claude_interactive' | 'claude_task';
        owner: 'user' | 'agent' | 'external_agent';
        mode: 'user_owned' | 'agent_owned' | 'handoff' | 'observe_only';
        runId: string | null;
        conversationId: string | null;
        takeoverRequestedBy: 'user' | 'agent' | 'external_agent' | null;
        activeRun: string | null;
      }) => void) => () => void;
    };
    uiState: {
      push: (state: {
        activeRightPanel: 'browser' | 'terminal' | 'editor' | null;
        activeView: 'chat' | 'conversations' | 'settings' | 'processes' | 'agents';
        activeConversationId: string | null;
        openTabIds: string[];
        sidebarDrawer: string | null;
        provider: string;
        model: string;
        terminalSessionIds: string[];
        browserVisible: boolean;
        browserUrl: string | null;
        updatedAt: number;
      }) => Promise<void>;
      get: () => Promise<any>;
    };
    tasks: {
      list: () => Promise<any>;
      create: (input: any) => Promise<any>;
      enable: (id: number, enabled: boolean) => Promise<any>;
      delete: (id: number) => Promise<any>;
      runs: (id: number) => Promise<any>;
      runNow: (id: number) => Promise<any>;
      summary: () => Promise<{ runningCount: number; completedCount: number }>;
      onRunStarted: (cb: (payload: { taskId: number; taskName: string; runId: number }) => void) => () => void;
      onRunComplete: (cb: (payload: { taskId: number; taskName: string; result: string; conversationId?: string; error?: string; runId: number; status?: string }) => void) => () => void;
    };
  }

  interface Window {
    clawdia: ClawdiaAPI;
  }
}

export {};

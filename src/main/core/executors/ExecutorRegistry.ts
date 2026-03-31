/**
 * ExecutorRegistry — defines and registers the three supported executors.
 *
 * Each executor is a first-class citizen with explicit capabilities and constraints.
 * This replaces the scattered `conv.mode === 'claude_terminal'` conditionals with
 * a structured, queryable registry.
 */

// ─── Executor IDs ─────────────────────────────────────────────────────────────

export type ExecutorId = 'agentLoop' | 'claudeCode' | 'codex' | 'concurrent';

/** Conversation mode strings stored in the DB → executor mapping */
export const CONV_MODE_TO_EXECUTOR: Record<string, ExecutorId> = {
  chat: 'agentLoop',
  claude_terminal: 'claudeCode',
  codex_terminal: 'codex',
  concurrent: 'concurrent',
};

export const EXECUTOR_TO_CONV_MODE: Record<ExecutorId, string> = {
  agentLoop: 'chat',
  claudeCode: 'claude_terminal',
  codex: 'codex_terminal',
  concurrent: 'concurrent',
};

// ─── Executor Definition ──────────────────────────────────────────────────────

export interface ExecutorDefinition {
  /** Stable identifier */
  id: ExecutorId;
  /** Human-readable display name */
  displayName: string;
  /** Short description shown in UI */
  description: string;
  /** Category for grouping in settings */
  category: 'local' | 'external-cli' | 'agent-loop';
  /** Whether this executor streams text tokens in real time */
  supportsStreaming: boolean;
  /** Whether this executor can call tools */
  supportsToolCalls: boolean;
  /** Whether the session can be resumed after an app restart */
  supportsSessionPersistence: boolean;
  /** Whether more than one run may be in-flight for the same executor across conversations */
  supportsConcurrentRuns: boolean;
  /** Whether two runs of this executor may run for the same conversation simultaneously */
  allowsSameConversationConcurrency: boolean;
  /** Whether this executor is available for automatic routing */
  eligibleForAutoRouting: boolean;
  /** Whether this executor is enabled by default */
  defaultEnabled: boolean;
  /** Known requirements that must be satisfied before this executor can run */
  requirements: string[];
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const DEFINITIONS: Record<ExecutorId, ExecutorDefinition> = {
  agentLoop: {
    id: 'agentLoop',
    displayName: 'Agent Loop',
    description: 'Built-in LLM agent with tool dispatch, streaming, and browser integration.',
    category: 'agent-loop',
    supportsStreaming: true,
    supportsToolCalls: true,
    supportsSessionPersistence: true,  // message history persisted in DB
    supportsConcurrentRuns: true,      // different conversations may run in parallel
    allowsSameConversationConcurrency: false,  // one run at a time per conversation
    eligibleForAutoRouting: true,
    defaultEnabled: true,
    requirements: ['anthropic | openai | gemini API key in settings'],
  },

  claudeCode: {
    id: 'claudeCode',
    displayName: 'Claude Code',
    description: 'Spawns the Claude Code CLI as a subprocess for agentic coding tasks.',
    category: 'external-cli',
    supportsStreaming: true,
    supportsToolCalls: true,   // Claude Code handles tool calls internally
    supportsSessionPersistence: true,  // session_id persisted in conversation row
    supportsConcurrentRuns: true,
    allowsSameConversationConcurrency: false,
    eligibleForAutoRouting: false,  // requires explicit user selection
    defaultEnabled: true,
    requirements: ['claude CLI installed and on PATH', 'Anthropic API key'],
  },

  codex: {
    id: 'codex',
    displayName: 'Codex',
    description: 'Spawns the OpenAI Codex CLI for code generation and editing tasks.',
    category: 'external-cli',
    supportsStreaming: true,
    supportsToolCalls: false,  // Codex handles this internally via its own tool system
    supportsSessionPersistence: true,  // thread_id persisted in conversation row
    supportsConcurrentRuns: true,
    allowsSameConversationConcurrency: false,
    eligibleForAutoRouting: false,
    defaultEnabled: true,
    requirements: ['codex CLI installed and on PATH', 'OpenAI API key'],
  },

  concurrent: {
    id: 'concurrent',
    displayName: 'Concurrent',
    description: 'Runs Claude Code and Codex in parallel against the same task, then synthesizes results.',
    category: 'local',
    supportsStreaming: true,
    supportsToolCalls: true,   // both sub-executors handle tools internally
    supportsSessionPersistence: false, // no single session to resume — each sub-executor manages its own
    supportsConcurrentRuns: true,
    allowsSameConversationConcurrency: false, // one concurrent run at a time per conversation
    eligibleForAutoRouting: false,  // requires explicit user selection
    defaultEnabled: false,  // opt-in — requires both CLI tools configured
    requirements: [
      'claude CLI installed and on PATH',
      'codex CLI installed and on PATH',
      'Anthropic API key',
      'OpenAI API key',
    ],
  },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns the definition for a given executor id. */
export function getExecutorDefinition(id: ExecutorId): ExecutorDefinition {
  return DEFINITIONS[id];
}

/** Returns all registered executor definitions. */
export function listExecutors(): ExecutorDefinition[] {
  return Object.values(DEFINITIONS);
}

/** Resolves the ExecutorId for a conversation mode string.
 *  Falls back to 'agentLoop' for unknown modes. */
export function resolveExecutorId(convMode: string): ExecutorId {
  return CONV_MODE_TO_EXECUTOR[convMode] ?? 'agentLoop';
}

/** Returns true if the executor allows concurrent runs across conversations. */
export function supportsParallelConversations(id: ExecutorId): boolean {
  return DEFINITIONS[id].supportsConcurrentRuns;
}

import { getMessages } from './db';
import {
  closePendingAnthropicToolUses,
  prepareAnthropicMessagesForSend,
} from './core/providers/anthropicMessageProtocol';
import {
  initExecutorState,
  updateExecutorState,
  getExecutorState,
  getAllExecutorStates,
  removeExecutorState,
  type ExecutorRuntimeState,
} from './core/executors/ExecutorRouter';
import type { ExecutorId } from './core/executors/ExecutorRegistry';
import { getExecutorConfig, type AgentLoopConfig } from './core/executors/ExecutorConfigStore';

export interface ConvAgent {
  abort: AbortController;
  runId: string | null;
}

/** Fallback defaults — used only if config load fails. */
const DEFAULT_MAX_SESSION_TURNS = 20;
const DEFAULT_MAX_MAPPING_SESSION_TURNS = 6;

/**
 * Encapsulates all per-conversation in-memory state that was previously
 * stored as module-level globals in registerIpc.ts.
 *
 * Centralising this state here:
 * - Makes IPC handlers unit-testable (inject a SessionManager instance)
 * - Eliminates implicit ordering dependencies between handlers
 * - Provides a single place to add session recovery / persistence later
 */
export class SessionManager {
  private sessions = new Map<string, any[]>();
  private convAgents = new Map<string, ConvAgent>();
  private _activeConversationId: string | null = null;
  /** In-memory map of the most recent taskId for each conversation. */
  private convTaskIds = new Map<string, string>();

  // ── Active conversation ────────────────────────────────────────────────────

  get activeConversationId(): string | null {
    return this._activeConversationId;
  }

  set activeConversationId(id: string | null) {
    this._activeConversationId = id;
  }

  // ── Session messages ───────────────────────────────────────────────────────

  hasSession(id: string): boolean {
    return this.sessions.has(id);
  }

  getSession(id: string): any[] | undefined {
    return this.sessions.get(id);
  }

  getOrCreateSession(id: string): any[] {
    if (!this.sessions.has(id)) this.sessions.set(id, []);
    return this.sessions.get(id)!;
  }

  setSession(id: string, messages: any[]): void {
    this.sessions.set(id, messages);
  }

  deleteSession(id: string): void {
    this.sessions.delete(id);
  }

  getActiveConversationIds(): string[] {
    return [...this.sessions.keys()];
  }

  /**
   * Hydrate an in-memory session from DB rows if it hasn't been loaded yet.
   * Safe to call multiple times — no-ops if already present.
   */
  hydrateFromDb(id: string): void {
    if (this.sessions.has(id)) return;
    const rows = getMessages(id);
    const apiMessages: any[] = rows
      .filter((r) => r.role === 'user' || r.role === 'assistant')
      .map((r) => {
        try {
          const parsed = JSON.parse(r.content);
          return { role: r.role, content: parsed.content ?? r.content };
        } catch {
          return { role: r.role, content: r.content };
        }
      });
    this.sessions.set(id, apiMessages);
  }

  // ── Session pruning ────────────────────────────────────────────────────────

  /**
   * Prune a session to at most maxTurns user+assistant pairs.
   * Always cuts at a user-role boundary to avoid orphaned tool_result blocks.
   */
  pruneSession(messages: any[], maxTurns = DEFAULT_MAX_SESSION_TURNS): any[] {
    const maxMessages = maxTurns * 2;
    if (messages.length <= maxMessages) return messages;
    let start = messages.length - maxMessages;
    while (start < messages.length && messages[start].role !== 'user') {
      start++;
    }
    return messages.slice(start);
  }

  pruneSessionInPlace(id: string, maxTurns = DEFAULT_MAX_SESSION_TURNS): any[] {
    const session = this.getOrCreateSession(id);
    const pruned = this.pruneSession(session, maxTurns);
    if (pruned.length < session.length) {
      this.sessions.set(id, pruned);
    }
    return this.sessions.get(id)!;
  }

  /** Read from AgentLoopConfig; falls back to compile-time defaults if config unavailable. */
  get maxSessionTurns(): number {
    try {
      return (getExecutorConfig('agentLoop') as AgentLoopConfig).maxSessionTurns ?? DEFAULT_MAX_SESSION_TURNS;
    } catch {
      return DEFAULT_MAX_SESSION_TURNS;
    }
  }

  /** Read from AgentLoopConfig; falls back to compile-time defaults if config unavailable. */
  get maxMappingSessionTurns(): number {
    try {
      return (getExecutorConfig('agentLoop') as AgentLoopConfig).maxMappingSessionTurns ?? DEFAULT_MAX_MAPPING_SESSION_TURNS;
    } catch {
      return DEFAULT_MAX_MAPPING_SESSION_TURNS;
    }
  }

  // ── Anthropic session repair ───────────────────────────────────────────────

  repairAnthropicSessionInPlace(
    sessionMessages: any[],
    reason: 'user_interrupted' | 'session_recovery',
    caller: string,
  ): void {
    const repaired = prepareAnthropicMessagesForSend(sessionMessages, {
      caller,
      closePendingToolUses: true,
      pendingToolUseReason: reason,
      onRepair: (issues) => {
        console.warn(`[SessionManager] repaired Anthropic session in ${caller}: ${issues.join(' | ')}`);
      },
    });
    if (repaired.repaired) {
      sessionMessages.splice(0, sessionMessages.length, ...repaired.messages);
    }
  }

  repairAnthropicSession(id: string, reason: 'user_interrupted' | 'session_recovery', caller: string): void {
    const session = this.sessions.get(id);
    if (session) this.repairAnthropicSessionInPlace(session, reason, caller);
  }

  closePendingToolUses(id: string, reason: 'user_interrupted' | 'session_recovery'): void {
    const session = this.sessions.get(id);
    if (session) closePendingAnthropicToolUses(session, reason);
  }

  // ── Conv agents ────────────────────────────────────────────────────────────

  hasAgent(id: string): boolean {
    return this.convAgents.has(id);
  }

  getAgent(id: string): ConvAgent | undefined {
    return this.convAgents.get(id);
  }

  getOrCreateAgent(id: string): ConvAgent {
    let agent = this.convAgents.get(id);
    if (!agent) {
      agent = { abort: new AbortController(), runId: null };
      this.convAgents.set(id, agent);
    }
    return agent;
  }

  deleteAgent(id: string): void {
    this.convAgents.delete(id);
  }

  isConversationRunning(id: string): boolean {
    return this.convAgents.has(id);
  }

  abortAgent(id: string): void {
    const agent = this.convAgents.get(id);
    if (agent) {
      agent.abort.abort();
      this.convAgents.delete(id);
    }
  }

  /**
   * Enforce same-conversation exclusivity and start a new execution slot.
   *
   * This is the single authoritative enforcement point for the 'exclusive'
   * same-conversation policy. It:
   *   1. Aborts any currently-running agent for this conversation.
   *   2. Creates a fresh AbortController for the new run.
   *   3. Initializes executor runtime state to 'running'.
   *
   * All CHAT_SEND execution paths must call this instead of calling
   * abortAgent + getOrCreateAgent separately. This prevents future entry
   * points from accidentally skipping the abort step.
   *
   * Returns the new ConvAgent (with a fresh AbortSignal).
   */
  startExclusive(conversationId: string, executorId: ExecutorId): ConvAgent {
    // Step 1: abort any existing run for this conversation (exclusive policy)
    this.abortAgent(conversationId);
    // Step 2: create fresh agent slot
    const agent: ConvAgent = { abort: new AbortController(), runId: null };
    this.convAgents.set(conversationId, agent);
    // Step 3: set runtime state — single source of truth for "what is running"
    initExecutorState(conversationId, executorId);
    updateExecutorState(conversationId, { status: 'running' });
    return agent;
  }

  // ── Executor runtime state ─────────────────────────────────────────────────

  /**
   * Initialize or reset the executor runtime state for a conversation.
   * Called at the start of each execution path in ChatIpc.
   */
  initExecutorState(conversationId: string, executorId: ExecutorId): ExecutorRuntimeState {
    return initExecutorState(conversationId, executorId);
  }

  /**
   * Transition the executor runtime state for a conversation.
   * Used to track idle/running/paused/failed transitions.
   */
  updateExecutorState(
    conversationId: string,
    patch: Partial<Omit<ExecutorRuntimeState, 'lastChangedAt'>>,
  ): ExecutorRuntimeState {
    return updateExecutorState(conversationId, patch);
  }

  /** Get the current executor runtime state for a conversation. */
  getExecutorState(conversationId: string): ExecutorRuntimeState | undefined {
    return getExecutorState(conversationId);
  }

  /** Get all tracked executor states (for diagnostics / settings UI). */
  getAllExecutorStates(): Map<string, ExecutorRuntimeState> {
    return getAllExecutorStates();
  }

  /** Remove executor state when a conversation is deleted. */
  removeExecutorState(conversationId: string): void {
    removeExecutorState(conversationId);
  }

  // ── Task identity ──────────────────────────────────────────────────────────

  /**
   * Store the active taskId for a conversation.
   * Called at the start of each CHAT_SEND execution.
   */
  updateTaskId(conversationId: string, taskId: string): void {
    this.convTaskIds.set(conversationId, taskId);
  }

  /** Get the most recently started taskId for a conversation (in-memory only). */
  getActiveTaskId(conversationId: string): string | null {
    return this.convTaskIds.get(conversationId) ?? null;
  }

  /** Clear the taskId when a conversation is deleted. */
  removeTaskId(conversationId: string): void {
    this.convTaskIds.delete(conversationId);
  }
}

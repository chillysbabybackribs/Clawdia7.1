import { getMessages } from './db';
import {
  closePendingAnthropicToolUses,
  prepareAnthropicMessagesForSend,
} from './core/providers/anthropicMessageProtocol';

export interface ConvAgent {
  abort: AbortController;
  runId: string | null;
}

const MAX_SESSION_TURNS = 20;
const MAX_MAPPING_SESSION_TURNS = 6;

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
  pruneSession(messages: any[], maxTurns = MAX_SESSION_TURNS): any[] {
    const maxMessages = maxTurns * 2;
    if (messages.length <= maxMessages) return messages;
    let start = messages.length - maxMessages;
    while (start < messages.length && messages[start].role !== 'user') {
      start++;
    }
    return messages.slice(start);
  }

  pruneSessionInPlace(id: string, maxTurns = MAX_SESSION_TURNS): any[] {
    const session = this.getOrCreateSession(id);
    const pruned = this.pruneSession(session, maxTurns);
    if (pruned.length < session.length) {
      this.sessions.set(id, pruned);
    }
    return this.sessions.get(id)!;
  }

  get maxSessionTurns(): number {
    return MAX_SESSION_TURNS;
  }

  get maxMappingSessionTurns(): number {
    return MAX_MAPPING_SESSION_TURNS;
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
}

/**
 * Thin accessor for live workspace state that the awareness tools need.
 * Populated by registerIpc.ts at startup — avoids circular imports between
 * the tool layer and the IPC/agent layer.
 */

export interface WorkspaceStateAccessor {
  /** Currently active conversation IDs (tabs that have sent at least one message) */
  getActiveConversationIds: () => string[];
  /** Whether a given conversation has a running agent right now */
  isConversationRunning: (conversationId: string) => boolean;
  /** Raw in-memory session messages for a conversation (may be empty before first send) */
  getSessionMessages: (conversationId: string) => unknown[];
}

let _accessor: WorkspaceStateAccessor | null = null;

export function registerWorkspaceStateAccessor(a: WorkspaceStateAccessor): void {
  _accessor = a;
}

export function getWorkspaceState(): WorkspaceStateAccessor | null {
  return _accessor;
}

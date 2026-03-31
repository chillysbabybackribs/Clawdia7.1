/**
 * ExecutorRouter — policy-based executor selection.
 *
 * Replaces the inline `conv.mode === 'claude_terminal'` / `'codex_terminal'`
 * conditionals in ChatIpc with a clean, queryable routing layer.
 *
 * Routing strategy (in order of priority):
 *   1. Explicit conversation mode stored in DB (user has selected a mode)
 *   2. Fallback to 'agentLoop' if the mode is unknown or the target executor is disabled
 *
 * This is intentionally NOT an autonomous planner. The user's stored mode is
 * authoritative. Auto-routing may be extended here in the future without
 * touching ChatIpc.
 */

import type { ExecutorId } from './ExecutorRegistry';
import { resolveExecutorId, getExecutorDefinition } from './ExecutorRegistry';
import { loadExecutorConfigs } from './ExecutorConfigStore';

// ─── Runtime state ────────────────────────────────────────────────────────────

export type ExecutorRunStatus = 'idle' | 'running' | 'paused' | 'failed';

export interface ExecutorRuntimeState {
  /** Which executor is assigned to this conversation */
  executorId: ExecutorId;
  /** Current execution status */
  status: ExecutorRunStatus;
  /** Active runId (agentLoop) or external session key (claudeCode/codex) */
  runId: string | null;
  /** Whether a persistent session exists that can be resumed */
  hasPersistentSession: boolean;
  /** ISO timestamp of the most recent status change */
  lastChangedAt: string;
}

// ─── Routing result ───────────────────────────────────────────────────────────

export interface RoutingDecision {
  executorId: ExecutorId;
  /** True if the originally requested executor was disabled and we fell back */
  usedFallback: boolean;
  fallbackReason?: string;
}

// ─── Router ───────────────────────────────────────────────────────────────────

/**
 * Resolve which executor should handle a conversation send.
 *
 * @param convMode - The `mode` field from the conversation DB row.
 * @returns A routing decision with the resolved executorId and fallback info.
 */
export function routeExecutor(convMode: string): RoutingDecision {
  const requestedId = resolveExecutorId(convMode);
  const configs = loadExecutorConfigs();
  const config = configs[requestedId];

  if (!config.enabled) {
    // Executor is disabled — fall back to agentLoop
    return {
      executorId: 'agentLoop',
      usedFallback: true,
      fallbackReason: `Executor '${requestedId}' is disabled; falling back to agentLoop`,
    };
  }

  const def = getExecutorDefinition(requestedId);
  if (!def) {
    return {
      executorId: 'agentLoop',
      usedFallback: true,
      fallbackReason: `Unknown executor for mode '${convMode}'; falling back to agentLoop`,
    };
  }

  return { executorId: requestedId, usedFallback: false };
}

/**
 * Enforce same-conversation concurrency policy.
 *
 * All three executors use 'exclusive' policy: a new run aborts any current run
 * for the same conversation before starting. This is already the behaviour in
 * ChatIpc (abortAgent is called before getOrCreateAgent). This function makes
 * that policy explicit and queryable.
 *
 * Returns the policy string for the given executor.
 */
export function getSameConversationPolicy(executorId: ExecutorId): 'exclusive' {
  const configs = loadExecutorConfigs();
  return configs[executorId].sameConversationPolicy;
}

/**
 * Cross-conversation concurrency: all executors support running in different
 * conversations simultaneously. Returns true.
 */
export function allowsCrossConversationConcurrency(_executorId: ExecutorId): true {
  return true;
}

// ─── Runtime state registry (in-memory, per-conversation) ────────────────────

const runtimeStates = new Map<string, ExecutorRuntimeState>();

/** Initialize or reset executor runtime state for a conversation. */
export function initExecutorState(conversationId: string, executorId: ExecutorId): ExecutorRuntimeState {
  const state: ExecutorRuntimeState = {
    executorId,
    status: 'idle',
    runId: null,
    hasPersistentSession: false,
    lastChangedAt: new Date().toISOString(),
  };
  runtimeStates.set(conversationId, state);
  return state;
}

/** Transition the executor runtime state for a conversation. */
export function updateExecutorState(
  conversationId: string,
  patch: Partial<Omit<ExecutorRuntimeState, 'lastChangedAt'>>,
): ExecutorRuntimeState {
  const existing = runtimeStates.get(conversationId) ?? initExecutorState(conversationId, patch.executorId ?? 'agentLoop');
  const next: ExecutorRuntimeState = {
    ...existing,
    ...patch,
    lastChangedAt: new Date().toISOString(),
  };
  runtimeStates.set(conversationId, next);
  return next;
}

/** Get current executor runtime state for a conversation (or undefined if not tracked). */
export function getExecutorState(conversationId: string): ExecutorRuntimeState | undefined {
  return runtimeStates.get(conversationId);
}

/** Get all currently-tracked executor states. Useful for a diagnostics/settings UI. */
export function getAllExecutorStates(): Map<string, ExecutorRuntimeState> {
  return new Map(runtimeStates);
}

/** Remove runtime state when a conversation is deleted. */
export function removeExecutorState(conversationId: string): void {
  runtimeStates.delete(conversationId);
}

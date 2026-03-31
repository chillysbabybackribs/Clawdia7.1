import { createRun, updateRun, appendRunEvent } from './db';
import { reserveEstimate, confirmTransaction, cancelReservation } from './agent/spending-budget';

function uuid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const runTransactions = new Map<string, number>();
const runSequences = new Map<string, number>();

function getNextSeq(runId: string): number {
  const seq = (runSequences.get(runId) || 0) + 1;
  runSequences.set(runId, seq);
  return seq;
}

/**
 * Start a new run for a conversation.
 * @param taskId  Optional — links this run to the parent task identity.
 * Returns the runId — pass it to trackToolCall/completeRun/failRun.
 */
export function startRun(
  conversationId: string,
  provider: string,
  model: string,
  taskId?: string | null,
): string {
  const runId = `run-${uuid()}`;
  const now = new Date().toISOString();

  createRun({
    id: runId,
    conversation_id: conversationId,
    title: 'Assistant Task',
    goal: 'Automated execution',
    status: 'running',
    started_at: now,
    updated_at: now,
    tool_call_count: 0,
    was_detached: 0,
    provider,
    model,
    workflow_stage: 'executing',
    task_id: taskId ?? null,
  });

  // Reserve a 1-cent estimate for the run locally
  const txId = reserveEstimate(runId, provider, 1);
  runTransactions.set(runId, txId);
  runSequences.set(runId, 0);

  return runId;
}

/**
 * Register an externally-generated runId (e.g. from agentLoop or Claude Code)
 * so it exists as a real DB row with task linkage.
 */
export function registerRun(
  runId: string,
  conversationId: string,
  provider: string,
  model: string,
  taskId?: string | null,
): void {
  const now = new Date().toISOString();
  createRun({
    id: runId,
    conversation_id: conversationId,
    title: 'Assistant Task',
    goal: 'Automated execution',
    status: 'running',
    started_at: now,
    updated_at: now,
    tool_call_count: 0,
    was_detached: 0,
    provider,
    model,
    workflow_stage: 'executing',
    task_id: taskId ?? null,
  });
  const txId = reserveEstimate(runId, provider, 1);
  runTransactions.set(runId, txId);
  runSequences.set(runId, 0);
}

/**
 * Record a tool call starting. Returns an eventId for pairing with trackToolResult.
 */
export function trackToolCall(runId: string, toolName: string, argsSummary: string): string {
  const eventId = `evt-${uuid()}`;
  const now = new Date().toISOString();

  appendRunEvent({
    run_id: runId,
    seq: getNextSeq(runId),
    ts: now,
    kind: 'tool_call',
    tool_name: toolName,
    payload_json: JSON.stringify({ toolName, argsSummary, eventId }),
  });

  return eventId;
}

/**
 * Record a tool call result. Pass the eventId returned by trackToolCall.
 */
export function trackToolResult(runId: string, eventId: string, resultSummary: string, durationMs: number): void {
  const now = new Date().toISOString();

  appendRunEvent({
    run_id: runId,
    seq: getNextSeq(runId),
    ts: now,
    kind: 'tool_result',
    payload_json: JSON.stringify({ callEventId: eventId, resultSummary, duration_ms: durationMs }),
  });
}

/**
 * Mark a run as completed with final token and cost counts.
 */
export function completeRun(runId: string, totalTokens: number, estimatedCostUsd: number): void {
  const now = new Date().toISOString();

  updateRun(runId, {
    status: 'completed',
    completed_at: now,
    updated_at: now,
    total_tokens: totalTokens,
    estimated_cost_usd: estimatedCostUsd,
    workflow_stage: 'completed',
  });

  const txId = runTransactions.get(runId);
  if (txId !== undefined) {
    const cents = Math.round(estimatedCostUsd * 100);
    confirmTransaction(txId, Math.max(1, cents));
    runTransactions.delete(runId);
  }
}

/**
 * Mark a run as failed.
 */
export function failRun(runId: string, error: string): void {
  const now = new Date().toISOString();

  updateRun(runId, {
    status: 'failed',
    completed_at: now,
    updated_at: now,
    error,
    workflow_stage: 'failed',
  });

  const txId = runTransactions.get(runId);
  if (txId !== undefined) {
    cancelReservation(txId);
    runTransactions.delete(runId);
  }
}

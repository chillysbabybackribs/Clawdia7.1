import { createRun, updateRun, appendRunEvent } from './db';

function uuid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Start a new run for a conversation.
 * Returns the runId — pass it to trackToolCall/completeRun/failRun.
 */
export function startRun(conversationId: string, provider: string, model: string): string {
  const runId = `run-${uuid()}`;
  createRun({
    id: runId,
    conversation_id: conversationId,
    status: 'running',
    provider,
    model,
    started_at: Date.now(),
  });
  return runId;
}

/**
 * Record a tool call starting. Returns an eventId for pairing with trackToolResult.
 */
export function trackToolCall(runId: string, toolName: string, argsSummary: string): string {
  const eventId = `evt-${uuid()}`;
  appendRunEvent({
    id: eventId,
    run_id: runId,
    type: 'tool_call',
    payload: JSON.stringify({ toolName, argsSummary }),
    created_at: Date.now(),
  });
  return eventId;
}

/**
 * Record a tool call result. Pass the eventId returned by trackToolCall.
 */
export function trackToolResult(runId: string, eventId: string, resultSummary: string, durationMs: number): void {
  appendRunEvent({
    id: `${eventId}-result`,
    run_id: runId,
    type: 'tool_result',
    payload: JSON.stringify({ callEventId: eventId, resultSummary, duration_ms: durationMs }),
    created_at: Date.now(),
  });
}

/**
 * Mark a run as completed with final token and cost counts.
 */
export function completeRun(runId: string, totalTokens: number, estimatedCostUsd: number): void {
  updateRun(runId, {
    status: 'completed',
    completed_at: Date.now(),
    total_tokens: totalTokens,
    estimated_cost_usd: estimatedCostUsd,
  });
}

/**
 * Mark a run as failed.
 */
export function failRun(runId: string, _error: string): void {
  updateRun(runId, {
    status: 'failed',
    completed_at: Date.now(),
  });
}

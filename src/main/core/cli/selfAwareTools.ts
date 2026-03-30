// src/main/core/cli/selfAwareTools.ts
//
// Self-aware tools: the agent inspecting and annotating its own running state.
// These tools read from the DispatchContext that is injected at call time —
// no global state, no coupling to specific runs.

import type Anthropic from '@anthropic-ai/sdk';
import type { DispatchContext } from '../../agent/types';

// ── In-process plan store (per run) ─────────────────────────────────────────
// Keyed by runId. Cleared when a run ends (see selfAwareCleanup).

const planStore = new Map<string, string>();

export function selfAwareCleanup(runId: string): void {
  planStore.delete(runId);
}

// ── Tool schemas ─────────────────────────────────────────────────────────────

export const SELF_AWARE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'agent_status',
    description:
      'Return a snapshot of the current agent run: iteration index, tool call count, ' +
      'token budget consumed, active model, and whether the run has been cancelled. ' +
      'Call this at the start of a complex task to understand your operating context.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'tool_call_history',
    description:
      'Return the ordered list of tool calls made so far in this run, including ' +
      'tool name, abbreviated input, and abbreviated result. Useful for understanding ' +
      'what has already been tried before deciding the next step.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Max number of most-recent calls to return (default 20, max 100)',
        },
      },
      required: [],
    },
  },
  {
    name: 'agent_plan',
    description:
      'Read or write a free-text scratchpad plan scoped to the current run. ' +
      'Use this to persist reasoning, sub-goals, or a checklist across iterations. ' +
      'The plan is only visible to the agent — it is not shown to the user.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['read', 'write', 'append'],
          description: '"read" returns the current plan. "write" replaces it. "append" adds a line.',
        },
        content: {
          type: 'string',
          description: 'Text to write or append (required for write/append actions).',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'agent_checkpoint',
    description:
      'Emit a named milestone marker into the run activity feed. ' +
      'Use this to annotate significant progress points (e.g. "Phase 1 complete", ' +
      '"File written", "User confirmed"). Checkpoints are visible in the tool activity panel.',
    input_schema: {
      type: 'object' as const,
      properties: {
        label: {
          type: 'string',
          description: 'Short label for the checkpoint (max 120 chars).',
        },
        note: {
          type: 'string',
          description: 'Optional longer description of what was accomplished.',
        },
      },
      required: ['label'],
    },
  },
  {
    name: 'context_status',
    description:
      'Return an estimate of the current conversation context size: message count, ' +
      'approximate token usage, and whether history trimming is active. ' +
      'Use this to decide whether to summarise or compact prior results.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

export const SELF_AWARE_TOOL_NAMES = new Set(SELF_AWARE_TOOLS.map(t => t.name));

// ── Executors ────────────────────────────────────────────────────────────────

export function executeSelfAwareTool(
  name: string,
  input: Record<string, unknown>,
  ctx: DispatchContext,
  messages: unknown[],
): string {
  switch (name) {
    case 'agent_status':    return execAgentStatus(ctx);
    case 'tool_call_history': return execToolCallHistory(input, ctx);
    case 'agent_plan':      return execAgentPlan(input, ctx);
    case 'agent_checkpoint': return execAgentCheckpoint(input, ctx);
    case 'context_status':  return execContextStatus(ctx, messages);
    default:
      return JSON.stringify({ ok: false, error: `Unknown self-aware tool: ${name}` });
  }
}

// ── agent_status ─────────────────────────────────────────────────────────────

function execAgentStatus(ctx: DispatchContext): string {
  const { options } = ctx;
  return JSON.stringify({
    ok: true,
    run_id: ctx.runId,
    iteration: ctx.iterationIndex + 1,
    max_iterations: options.maxIterations ?? 50,
    tool_calls_this_run: ctx.toolCallCount,
    model: options.model,
    provider: options.provider,
    cancelled: ctx.signal.aborted,
    has_browser: !!options.browserService,
    unrestricted_mode: options.unrestrictedMode ?? false,
  });
}

// ── tool_call_history ────────────────────────────────────────────────────────

function execToolCallHistory(input: Record<string, unknown>, ctx: DispatchContext): string {
  const limit = Math.min(Number(input.limit ?? 20), 100);
  const calls = ctx.allToolCalls.slice(-limit).map(c => ({
    name: c.name,
    input_summary: JSON.stringify(c.input).slice(0, 150),
    result_summary: c.result.slice(0, 200),
  }));
  return JSON.stringify({
    ok: true,
    total_calls: ctx.allToolCalls.length,
    showing: calls.length,
    calls,
  });
}

// ── agent_plan ───────────────────────────────────────────────────────────────

function execAgentPlan(input: Record<string, unknown>, ctx: DispatchContext): string {
  const action = input.action as string;
  const content = input.content as string | undefined;

  if (action === 'read') {
    const plan = planStore.get(ctx.runId) ?? '';
    return JSON.stringify({ ok: true, plan: plan || '(no plan set)' });
  }

  if (action === 'write') {
    if (!content) return JSON.stringify({ ok: false, error: 'content is required for write' });
    planStore.set(ctx.runId, content);
    return JSON.stringify({ ok: true, written: content.length });
  }

  if (action === 'append') {
    if (!content) return JSON.stringify({ ok: false, error: 'content is required for append' });
    const existing = planStore.get(ctx.runId) ?? '';
    const updated = existing ? `${existing}\n${content}` : content;
    planStore.set(ctx.runId, updated);
    return JSON.stringify({ ok: true, total_length: updated.length });
  }

  return JSON.stringify({ ok: false, error: `Unknown action: ${action}` });
}

// ── agent_checkpoint ─────────────────────────────────────────────────────────

function execAgentCheckpoint(input: Record<string, unknown>, ctx: DispatchContext): string {
  const label = String(input.label ?? '').slice(0, 120);
  const note = input.note ? String(input.note).slice(0, 500) : undefined;

  // Emit through the tool activity channel so it appears in the UI panel
  ctx.options.onToolActivity?.({
    id: `checkpoint-${ctx.runId}-${ctx.iterationIndex}`,
    name: 'agent_checkpoint',
    status: 'success',
    detail: label,
    output: note ? `${label}\n${note}` : label,
  });

  return JSON.stringify({ ok: true, label, note: note ?? null });
}

// ── context_status ────────────────────────────────────────────────────────────

// Rough token estimator: ~4 chars per token
function estimateTokens(messages: unknown[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += JSON.stringify(m).length;
  }
  return Math.round(chars / 4);
}

function execContextStatus(ctx: DispatchContext, messages: unknown[]): string {
  const msgCount = messages.length;
  const estimatedTokens = estimateTokens(messages);
  // History trim kicks in above HISTORY_WINDOW + 1 (11) messages in agentLoop
  const trimActive = msgCount > 11;

  return JSON.stringify({
    ok: true,
    message_count: msgCount,
    estimated_tokens: estimatedTokens,
    trim_active: trimActive,
    trim_window: 10,
    iteration: ctx.iterationIndex + 1,
    tool_calls: ctx.toolCallCount,
  });
}

/**
 * ConcurrentExecutor — Planner → Workers → Synthesizer
 *
 * Architecture:
 *
 *   User sends message
 *       │
 *   Phase 1: Planner (agentLoop, 1 iteration)
 *     - Analyzes the task
 *     - Produces a structured JSON plan: subtasks with executor assignments + dependencies
 *     - Streams its reasoning to the renderer (source: 'planner')
 *       │
 *   Phase 2: Workers (execute per the plan)
 *     - Tasks with no pending dependencies run in parallel
 *     - Tasks with dependsOn[] wait for their dependencies to complete
 *     - Each worker gets a specific scoped prompt from the plan
 *     - Streams to renderer with source: 'claudeCode' | 'codex'
 *       │
 *   Phase 3: Synthesizer (agentLoop, 1 iteration)
 *     - Merges all worker outputs using plan context + synthesisHint
 *     - Streams to renderer with source: 'synthesis'
 */

import { runClaudeCode } from '../../claudeCodeClient';
import { runCodexCli } from '../../codexCliClient';
import { loadSettings } from '../../settingsStore';
import { registerRun, completeRun, failRun } from '../../runTracker';
import { linkRunToTask } from '../../taskTracker';
import { agentLoop } from '../../agent/agentLoop';
import { getConversation, updateConversation } from '../../db';
import type { ToolCall, MessageAttachment, ConcurrentPlan, ConcurrentSubtask } from '../../../shared/types';
import type { ExecutorId } from './ExecutorRegistry';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConcurrentStrategy = 'parallel' | 'claude_primary_codex_review';

export interface ConcurrentRunOptions {
  conversationId: string;
  taskId: string;
  prompt: string;
  attachments?: MessageAttachment[];
  signal: AbortSignal;

  strategy?: ConcurrentStrategy;
  synthesize?: boolean;
  claudeCodeHint?: string;
  codexHint?: string;

  onText: (delta: string, source: 'claudeCode' | 'codex' | 'synthesis' | 'planner') => void;
  onToolActivity?: (activity: ToolCall & { source: 'claudeCode' | 'codex' }) => void;
  onThinking?: (thought: string) => void;
  onStateChanged?: (state: ConcurrentState) => void;
  /** Fires when the planner has finished and execution is about to start */
  onExecutionStart?: (plan: ConcurrentPlan) => void;
  /** Fires when all workers + synthesis are done */
  onExecutionEnd?: () => void;
}

export interface ConcurrentResult {
  finalText: string;
  executorResults: { [subtaskId: string]: ExecutorOutcome };
  synthesized: boolean;
}

export interface ExecutorOutcome {
  executorId: ExecutorId;
  runId: string;
  ok: boolean;
  text: string;
  error?: string;
  durationMs: number;
}

export interface ConcurrentAgentState {
  executorId: 'claudeCode' | 'codex';
  runId: string;
  status: 'running' | 'done' | 'failed';
  startedAt: number;
  completedAt?: number;
  label?: string;
  error?: string;
}

export interface ConcurrentState {
  taskId: string;
  phase: 'planning' | 'executing' | 'synthesizing' | 'done';
  agents: ConcurrentAgentState[];
  synthesizing: boolean;
  startedAt: number;
  completedAt?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRunId(prefix: string): string {
  return `run-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function extractJson(text: string): string {
  // Pull first ```json ... ``` block, or first { ... } block
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const braces = text.match(/\{[\s\S]*\}/);
  if (braces) return braces[0];
  return text.trim();
}

// ─── Phase 1: Planner ─────────────────────────────────────────────────────────

async function runPlanner(
  userPrompt: string,
  settings: ReturnType<typeof loadSettings>,
  signal: AbortSignal,
  onText: (delta: string) => void,
): Promise<ConcurrentPlan> {
  const provider = settings.provider as 'anthropic' | 'openai' | 'gemini';
  const apiKey = settings.providerKeys[provider as keyof typeof settings.providerKeys]?.trim();
  if (!apiKey) throw new Error('No API key configured for planner');

  const { DEFAULT_MODEL_BY_PROVIDER } = await import('../../../shared/model-registry');
  const model = settings.models[provider as keyof typeof settings.models]
    ?? DEFAULT_MODEL_BY_PROVIDER[provider as keyof typeof DEFAULT_MODEL_BY_PROVIDER];

  const plannerPrompt = [
    'You are an orchestration planner. Your job is to break down a task into subtasks for two AI coding agents:',
    '- "claudeCode": Claude Code CLI — best for multi-file editing, shell commands, filesystem operations, refactoring',
    '- "codex": OpenAI Codex CLI — best for focused code generation, targeted analysis, reading and summarising files',
    '',
    'Analyse the task below and produce a JSON execution plan. Think through what can run in parallel vs what must be sequential.',
    'First write a brief plain-text explanation of your plan (2-4 sentences), then output the JSON.',
    '',
    'JSON schema:',
    '{',
    '  "goal": "one-line summary of the overall task",',
    '  "subtasks": [',
    '    {',
    '      "id": "t1",',
    '      "executor": "claudeCode" | "codex",',
    '      "label": "short human-readable name for this subtask",',
    '      "prompt": "the full, specific instruction for this executor",',
    '      "dependsOn": []   // array of subtask ids that must complete first; [] = can run immediately',
    '    }',
    '  ],',
    '  "synthesisHint": "brief instruction for the final step that merges all outputs"',
    '}',
    '',
    'Rules:',
    '- Use 2-4 subtasks total. Do not over-decompose.',
    '- Assign based on executor strengths.',
    '- dependsOn must reference ids defined earlier in the array.',
    '- The prompt for each subtask must be self-contained — the executor gets only that prompt, not the others.',
    '- Output ONLY the explanation + the JSON block. No extra commentary after the JSON.',
    '',
    `Task: ${userPrompt}`,
  ].join('\n');

  let fullText = '';
  const planRunId = makeRunId('plan');

  await agentLoop(plannerPrompt, [], {
    provider,
    apiKey,
    model,
    runId: planRunId,
    maxIterations: 1,
    signal,
    forcedProfile: {
      toolGroup: 'core',
      modelTier: 'standard',
      isGreeting: false,
    },
    onText: (delta: string) => {
      fullText += delta;
      onText(delta);
    },
    onThinking: () => {},
  });

  // Parse the JSON plan out of the response
  const jsonStr = extractJson(fullText);
  try {
    const parsed = JSON.parse(jsonStr) as ConcurrentPlan;
    if (!parsed.subtasks || !Array.isArray(parsed.subtasks)) {
      throw new Error('Plan missing subtasks array');
    }
    return parsed;
  } catch (err) {
    // Fallback: create a simple parallel plan
    return {
      goal: userPrompt.slice(0, 80),
      subtasks: [
        {
          id: 't1',
          executor: 'claudeCode',
          label: 'Claude Code',
          prompt: userPrompt,
          dependsOn: [],
        },
        {
          id: 't2',
          executor: 'codex',
          label: 'Codex',
          prompt: userPrompt,
          dependsOn: [],
        },
      ],
      synthesisHint: 'Merge the two outputs into a single coherent response.',
    };
  }
}

// ─── Phase 2: Topological worker runner ──────────────────────────────────────

interface WorkerResult {
  subtaskId: string;
  outcome: ExecutorOutcome;
}

async function runWorkers(
  plan: ConcurrentPlan,
  opts: ConcurrentRunOptions,
  state: ConcurrentState,
  emitState: () => void,
  convPersistedSession: string | null,
): Promise<Map<string, ExecutorOutcome>> {
  const settings = loadSettings();
  const results = new Map<string, ExecutorOutcome>();
  const completed = new Set<string>();

  // Build a work queue — we'll keep pulling tasks whose deps are all done
  const remaining = [...plan.subtasks];

  while (remaining.length > 0 || results.size < plan.subtasks.length) {
    if (opts.signal.aborted) break;

    // Find all tasks whose dependencies are satisfied and haven't started yet
    const ready = remaining.filter(t =>
      t.dependsOn.every(dep => completed.has(dep))
    );

    if (ready.length === 0) {
      // No tasks are ready — all remaining have unmet deps (shouldn't happen with valid plan)
      break;
    }

    // Remove ready tasks from remaining
    for (const t of ready) {
      remaining.splice(remaining.indexOf(t), 1);
    }

    // Launch all ready tasks in parallel
    const batch = ready.map(subtask => runSingleWorker(subtask, opts, state, emitState, settings, convPersistedSession));
    const settled = await Promise.allSettled(batch);

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        const { subtaskId, outcome } = result.value;
        results.set(subtaskId, outcome);
        completed.add(subtaskId);
      }
    }
  }

  return results;
}

async function runSingleWorker(
  subtask: ConcurrentSubtask,
  opts: ConcurrentRunOptions,
  state: ConcurrentState,
  emitState: () => void,
  settings: ReturnType<typeof loadSettings>,
  convPersistedSession: string | null,
): Promise<WorkerResult> {
  const startedAt = Date.now();
  const runId = makeRunId(subtask.executor === 'claudeCode' ? 'cc' : 'cdx');

  registerRun(
    runId,
    opts.conversationId,
    subtask.executor === 'claudeCode' ? 'anthropic' : 'openai',
    subtask.executor === 'claudeCode' ? 'claude-code' : 'codex',
    opts.taskId,
  );
  linkRunToTask(opts.taskId, runId);

  // Add to state
  const agentState: ConcurrentAgentState = {
    executorId: subtask.executor,
    runId,
    status: 'running',
    startedAt,
    label: subtask.label,
  };
  state.agents.push(agentState);
  emitState();

  try {
    let finalText = '';

    if (subtask.executor === 'claudeCode') {
      const result = await runClaudeCode({
        conversationId: `${opts.conversationId}-cc-${subtask.id}`,
        prompt: subtask.prompt,
        attachments: opts.attachments,
        skipPermissions: settings.unrestrictedMode,
        persistedSessionId: convPersistedSession,
        onText: (delta) => opts.onText(delta, 'claudeCode'),
        onToolActivity: opts.onToolActivity
          ? (activity) => opts.onToolActivity!({ ...activity, source: 'claudeCode' } as ToolCall & { source: 'claudeCode' })
          : undefined,
      });
      finalText = result.finalText;
    } else {
      const result = await runCodexCli({
        conversationId: `${opts.conversationId}-cdx-${subtask.id}`,
        prompt: subtask.prompt,
        onText: (delta) => opts.onText(delta, 'codex'),
        onToolActivity: opts.onToolActivity
          ? (activity) => opts.onToolActivity!({ ...activity, source: 'codex' } as ToolCall & { source: 'codex' })
          : undefined,
      });
      finalText = result.finalText;
    }

    completeRun(runId, 0, 0);
    agentState.status = 'done';
    agentState.completedAt = Date.now();
    emitState();

    return {
      subtaskId: subtask.id,
      outcome: {
        executorId: subtask.executor,
        runId,
        ok: true,
        text: finalText,
        durationMs: Date.now() - startedAt,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failRun(runId, msg);
    agentState.status = 'failed';
    agentState.completedAt = Date.now();
    agentState.error = msg;
    emitState();

    return {
      subtaskId: subtask.id,
      outcome: {
        executorId: subtask.executor,
        runId,
        ok: false,
        text: '',
        error: msg,
        durationMs: Date.now() - startedAt,
      },
    };
  }
}

// ─── Phase 3: Synthesizer ─────────────────────────────────────────────────────

async function synthesizeResults(
  plan: ConcurrentPlan,
  workerResults: Map<string, ExecutorOutcome>,
  settings: ReturnType<typeof loadSettings>,
  signal: AbortSignal,
  onText: (delta: string) => void,
): Promise<string> {
  const provider = settings.provider as 'anthropic' | 'openai' | 'gemini';
  const apiKey = settings.providerKeys[provider as keyof typeof settings.providerKeys]?.trim();
  if (!apiKey) throw new Error('No API key for synthesis');

  const { DEFAULT_MODEL_BY_PROVIDER } = await import('../../../shared/model-registry');
  const model = settings.models[provider as keyof typeof settings.models]
    ?? DEFAULT_MODEL_BY_PROVIDER[provider as keyof typeof DEFAULT_MODEL_BY_PROVIDER];

  const workerOutputs = plan.subtasks
    .map(t => {
      const r = workerResults.get(t.id);
      if (!r) return null;
      return `--- ${t.label} (${t.executor}) ---\n${r.ok ? r.text : `*Failed: ${r.error}*`}`;
    })
    .filter(Boolean)
    .join('\n\n');

  const synthPrompt = [
    `You are synthesizing the outputs of ${plan.subtasks.length} AI agents that worked on parts of a task.`,
    `Overall goal: ${plan.goal}`,
    '',
    `Synthesis guidance: ${plan.synthesisHint}`,
    '',
    'Merge their work into a single coherent, well-structured response. Eliminate redundancy.',
    'If agents produced conflicting output for the same file or section, prefer the more complete version.',
    '',
    workerOutputs,
  ].join('\n');

  const runId = makeRunId('synth');

  const text = await agentLoop(synthPrompt, [], {
    provider,
    apiKey,
    model,
    runId,
    maxIterations: 1,
    signal,
    forcedProfile: {
      toolGroup: 'core',
      modelTier: 'standard',
      isGreeting: false,
    },
    onText,
    onThinking: () => {},
  });

  return text;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runConcurrent(opts: ConcurrentRunOptions): Promise<ConcurrentResult> {
  const {
    conversationId,
    taskId,
    prompt,
    synthesize = true,
    signal,
    onText,
    onThinking,
    onStateChanged,
    onExecutionStart,
    onExecutionEnd,
  } = opts;

  const startedAt = Date.now();
  const settings = loadSettings();
  const conv = getConversation(conversationId);
  const convPersistedSession = conv?.claude_code_session_id ?? null;

  const state: ConcurrentState = {
    taskId,
    phase: 'planning',
    agents: [],
    synthesizing: false,
    startedAt,
  };
  const emitState = () => onStateChanged?.({ ...state, agents: [...state.agents] });
  emitState();

  // ── Phase 1: Plan ────────────────────────────────────────────────────────
  onThinking?.('Planning how to split this task…');

  let plan: ConcurrentPlan;
  try {
    plan = await runPlanner(
      prompt,
      settings,
      signal,
      (delta) => onText(delta, 'planner'),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.completedAt = Date.now();
    state.phase = 'done';
    emitState();
    return {
      finalText: `Planning failed: ${msg}`,
      executorResults: {},
      synthesized: false,
    };
  }

  if (signal.aborted) {
    state.completedAt = Date.now();
    state.phase = 'done';
    emitState();
    return { finalText: '', executorResults: {}, synthesized: false };
  }

  // ── Phase 2: Execute plan ────────────────────────────────────────────────
  state.phase = 'executing';
  emitState();
  onExecutionStart?.(plan);
  onThinking?.('Executing plan…');

  const workerResults = await runWorkers(plan, opts, state, emitState, convPersistedSession);

  // Persist Claude Code session if any CC worker returned one
  // (runClaudeCode returns sessionId on the result object — check first worker's run)
  // This is best-effort; session continuity is advisory in concurrent mode.

  if (signal.aborted) {
    state.completedAt = Date.now();
    state.phase = 'done';
    emitState();
    onExecutionEnd?.();
    return { finalText: '', executorResults: Object.fromEntries(workerResults), synthesized: false };
  }

  // ── Phase 3: Synthesize ──────────────────────────────────────────────────
  let finalText = '';
  let synthesized = false;

  const anyOk = [...workerResults.values()].some(r => r.ok);

  if (synthesize && anyOk && !signal.aborted) {
    state.synthesizing = true;
    state.phase = 'synthesizing';
    emitState();
    onThinking?.('Synthesizing results…');

    try {
      finalText = await synthesizeResults(
        plan,
        workerResults,
        settings,
        signal,
        (delta) => onText(delta, 'synthesis'),
      );
      synthesized = true;
    } catch {
      // Fall back to concatenation
      finalText = plan.subtasks
        .map(t => {
          const r = workerResults.get(t.id);
          if (!r) return '';
          return `## ${t.label}\n\n${r.ok ? r.text : `*Failed: ${r.error}*`}`;
        })
        .filter(Boolean)
        .join('\n\n---\n\n');
    }
  } else {
    finalText = plan.subtasks
      .map(t => {
        const r = workerResults.get(t.id);
        if (!r) return '';
        return `## ${t.label}\n\n${r.ok ? r.text : `*Failed: ${r.error}*`}`;
      })
      .filter(Boolean)
      .join('\n\n---\n\n');
  }

  state.synthesizing = false;
  state.completedAt = Date.now();
  state.phase = 'done';
  emitState();
  onExecutionEnd?.();

  return {
    finalText,
    executorResults: Object.fromEntries(workerResults),
    synthesized,
  };
}

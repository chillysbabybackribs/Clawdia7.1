// src/main/core/PipelineOrchestrator.ts
import { agentLoop } from '../agent/agentLoop';
import { streamLLM } from '../agent/streamLLM';
import { createRun, updateRun } from '../db';
import type { LoopOptions } from '../agent/types';
import type { SwarmState, SwarmAgent } from '../../shared/types';

export interface PipelineRunOptions {
  provider: 'anthropic' | 'openai' | 'gemini';
  apiKey: string;
  model: string;
  conversationId: string;
  signal: AbortSignal;
  browserService: any;
  unrestrictedMode: boolean;
  onStateChanged: (state: SwarmState) => void;
  onText: (delta: string) => void;
}

interface Subtask {
  id: string;
  subtask: string;
  goal: string;
}

const MAX_WORKERS = 5;
const MAX_WORKER_ITERATIONS = 30;

function extractFirstJsonArray(text: string): string | null {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenceMatch?.[1] ?? text;
  const start = source.indexOf('[');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '[') depth++;
    if (ch === ']') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  return null;
}

function extractFirstJsonObject(text: string): string | null {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenceMatch?.[1] ?? text;
  const start = source.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  return null;
}

function normalizePlannerSubtasks(value: unknown): Subtask[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;

      const candidate = item as Record<string, unknown>;
      const id = typeof candidate.id === 'string' && candidate.id.trim()
        ? candidate.id.trim()
        : `sub-${index + 1}`;
      const subtask = typeof candidate.subtask === 'string' && candidate.subtask.trim()
        ? candidate.subtask.trim()
        : typeof candidate.title === 'string' && candidate.title.trim()
          ? candidate.title.trim()
          : typeof candidate.name === 'string' && candidate.name.trim()
            ? candidate.name.trim()
            : '';
      const goal = typeof candidate.goal === 'string' && candidate.goal.trim()
        ? candidate.goal.trim()
        : typeof candidate.task === 'string' && candidate.task.trim()
          ? candidate.task.trim()
          : typeof candidate.description === 'string' && candidate.description.trim()
            ? candidate.description.trim()
            : '';

      if (!subtask || !goal) return null;
      return { id, subtask, goal };
    })
    .filter((item): item is Subtask => Boolean(item));
}

function stripMarkdownEmphasis(value: string): string {
  return value
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .trim();
}

function parsePlannerListLine(line: string, index: number): Subtask | null {
  const cleaned = stripMarkdownEmphasis(line)
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, '')
    .trim();

  if (!cleaned) return null;

  const separatorPatterns = [
    /\s+[-:]\s+/,
    /\s+[–—]\s+/,
    /:\s+/,
  ];

  for (const pattern of separatorPatterns) {
    const parts = cleaned.split(pattern).map(part => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const [subtask, ...goalParts] = parts;
      const goal = goalParts.join(' - ');
      if (subtask && goal) {
        return { id: `sub-${index + 1}`, subtask, goal };
      }
    }
  }

  return {
    id: `sub-${index + 1}`,
    subtask: cleaned.length <= 80 ? cleaned : `${cleaned.slice(0, 77).trimEnd()}...`,
    goal: cleaned,
  };
}

function extractPlannerSubtasksFromList(text: string): Subtask[] {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^(?:[-*+•]|\d+[.)])\s+/.test(line));

  if (lines.length < 2) return [];

  return lines
    .map((line, index) => parsePlannerListLine(line, index))
    .filter((item): item is Subtask => Boolean(item));
}

function parsePlannerSubtasks(text: string): Subtask[] {
  const jsonArray = extractFirstJsonArray(text);
  if (jsonArray) {
    return normalizePlannerSubtasks(JSON.parse(jsonArray));
  }

  const listSubtasks = extractPlannerSubtasksFromList(text);
  if (listSubtasks.length > 0) return listSubtasks;

  const jsonObject = extractFirstJsonObject(text);
  if (!jsonObject) {
    throw new Error('Planner did not return JSON');
  }

  const parsed = JSON.parse(jsonObject) as Record<string, unknown>;
  const candidateArrays = [
    parsed.subtasks,
    parsed.tasks,
    parsed.plan,
    parsed.steps,
    parsed.items,
  ];

  for (const candidate of candidateArrays) {
    const subtasks = normalizePlannerSubtasks(candidate);
    if (subtasks.length > 0) return subtasks;
  }

  throw new Error('Planner JSON did not contain a valid subtask array');
}

export class PipelineOrchestrator {
  private static shouldUsePipelineHeuristic(goal: string): boolean {
    const text = goal.trim();
    const lower = text.toLowerCase();

    if (!text || text.length < 80) return false;
    if (/^(hi|hello|hey|thanks|thank you|bye|goodbye)\b/.test(lower)) return false;

    const hasStructuredList =
      (text.match(/^\s*(?:[-*]|\d+\.)\s+/gm) ?? []).length >= 2;
    const hasMultiTargetCompare =
      /\b(compare|contrast|benchmark|evaluate|rank)\b/.test(lower)
      && /\b(and|vs\.?|versus)\b/.test(lower);
    const hasResearchCue =
      /\b(audit|investigate|research|analyze|analysis|survey|synthesize)\b/.test(lower);
    const hasParallelCue =
      /\b(multiple|several|across|parallel|independent|different|various)\b/.test(lower);
    const hasMultiPartRequest =
      /\b(1\.|2\.|first\b.*second\b|both\b.*and\b)\b/.test(lower);
    const hasManyQuestions = (text.match(/\?/g) ?? []).length >= 2;

    if (hasStructuredList) return true;
    if (hasMultiTargetCompare) return true;
    if (hasResearchCue && (hasParallelCue || hasMultiPartRequest || hasManyQuestions || text.length > 220)) {
      return true;
    }

    return false;
  }

  /**
   * Classify whether the user's goal warrants a multi-agent pipeline.
   * Use a local heuristic so normal chat does not pay an extra model round trip
   * before the first response token can arrive.
   */
  static classifyIntent(goal: string): boolean {
    return PipelineOrchestrator.shouldUsePipelineHeuristic(goal);
  }

  /**
   * Run a full Planner → Workers → Synthesizer pipeline.
   * Returns the synthesizer's final text (structured report).
   */
  static async run(goal: string, opts: PipelineRunOptions): Promise<string> {
    const parentRunId = `run-pipe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    // Create parent run record
    createRun({
      id: parentRunId,
      conversation_id: opts.conversationId,
      title: goal.slice(0, 60),
      goal,
      status: 'running',
      started_at: now,
      updated_at: now,
      tool_call_count: 0,
      was_detached: 0,
      workflow_stage: 'orchestrating',
      parent_run_id: null,
    });

    // Build initial SwarmState with planner agent
    const plannerAgent: SwarmAgent = {
      id: 'planner',
      role: 'coordinator',
      goal: 'Decompose goal into subtasks',
      status: 'running',
      startedAt: Date.now(),
      toolCallCount: 0,
    };

    const state: SwarmState = {
      runId: parentRunId,
      totalAgents: 1, // will be updated once planner finishes
      agents: [plannerAgent],
      startedAt: Date.now(),
    };

    opts.onStateChanged({ ...state, agents: [...state.agents] });

    // ── Stage 1: Planner ──────────────────────────────────────────────────────
    let subtasks: Subtask[] = [];
    try {
      const plannerPrompt =
        'You are a task decomposition assistant. Your only job is to break the user goal into 2–5 independent subtasks and return them as JSON. ' +
        'Do not execute the tasks. Do not explain your reasoning. Do not refuse. Just output the JSON array. ' +
        'Respond ONLY with a JSON array in this exact format: [{"id":"sub-1","subtask":"short name","goal":"what should be accomplished"}]. ' +
        'Maximum 5 subtasks. Minimum 2. Output JSON only — no other text.';

      const { text } = await streamLLM(
        [{ role: 'user', content: goal }],
        plannerPrompt,
        '',
        { toolGroup: 'core', modelTier: 'fast', isGreeting: false },
        { ...opts, onText: () => {}, maxIterations: 1 } as any,
      );

      subtasks = parsePlannerSubtasks(text);
      if (subtasks.length < 2) throw new Error('Planner returned fewer than 2 subtasks');
      subtasks = subtasks.slice(0, MAX_WORKERS);
    } catch (e: any) {
      // Planner failed — mark failed and rethrow so caller can surface error
      plannerAgent.status = 'failed';
      plannerAgent.error = e.message;
      plannerAgent.completedAt = Date.now();
      updateRun(parentRunId, { status: 'failed', workflow_stage: 'failed', updated_at: new Date().toISOString() });
      opts.onStateChanged({ ...state, agents: [...state.agents], completedAt: Date.now() });
      throw e;
    }

    // Planner done — update state with worker agents
    plannerAgent.status = 'done';
    plannerAgent.completedAt = Date.now();

    const workerAgents: SwarmAgent[] = subtasks.map((sub) => ({
      id: sub.id,
      role: 'analyst' as const,
      goal: sub.goal,
      status: 'queued' as const,
      toolCallCount: 0,
    }));

    const synthAgent: SwarmAgent = {
      id: 'synthesizer',
      role: 'synthesizer',
      goal: 'Synthesize worker results into a structured report',
      status: 'queued',
      toolCallCount: 0,
    };

    state.totalAgents = 1 + workerAgents.length + 1; // planner + workers + synthesizer
    state.agents = [plannerAgent, ...workerAgents, synthAgent];
    opts.onStateChanged({ ...state, agents: [...state.agents] });

    // ── Stage 2: Workers (parallel) ───────────────────────────────────────────
    const loopBase: Omit<LoopOptions, 'runId' | 'onText' | 'onToolActivity'> = {
      provider: opts.provider,
      apiKey: opts.apiKey,
      model: opts.model,
      conversationId: opts.conversationId,
      signal: opts.signal,
      unrestrictedMode: opts.unrestrictedMode,
      browserService: opts.browserService,
      maxIterations: MAX_WORKER_ITERATIONS,
      onThinking: () => {},
    };

    const workerResults: Array<{ subtask: string; result: string; ok: boolean }> = [];

    await Promise.all(
      subtasks.map(async (sub, i) => {
        const workerAgent = workerAgents[i];
        const workerRunId = `run-worker-${crypto.randomUUID()}`;
        const workerNow = new Date().toISOString();

        createRun({
          id: workerRunId,
          conversation_id: opts.conversationId,
          title: sub.subtask,
          goal: sub.goal,
          status: 'running',
          started_at: workerNow,
          updated_at: workerNow,
          tool_call_count: 0,
          was_detached: 0,
          workflow_stage: 'executing',
          parent_run_id: parentRunId,
        });

        workerAgent.status = 'running';
        workerAgent.startedAt = Date.now();
        opts.onStateChanged({ ...state, agents: [...state.agents] });

        try {
          const result = await agentLoop(sub.goal, [], {
            ...loopBase,
            runId: workerRunId,
            onText: () => {},
            onToolActivity: () => {
              workerAgent.toolCallCount++;
              opts.onStateChanged({ ...state, agents: [...state.agents] });
            },
          });
          workerAgent.status = 'done';
          workerAgent.completedAt = Date.now();
          workerAgent.result = result.slice(0, 500);
          workerResults.push({ subtask: sub.subtask, result, ok: true });
          updateRun(workerRunId, { status: 'completed', workflow_stage: 'completed', updated_at: new Date().toISOString() });
        } catch (e: any) {
          workerAgent.status = 'failed';
          workerAgent.completedAt = Date.now();
          workerAgent.error = e.message;
          workerResults.push({ subtask: sub.subtask, result: '', ok: false });
          updateRun(workerRunId, { status: 'failed', workflow_stage: 'failed', updated_at: new Date().toISOString() });
        }

        opts.onStateChanged({ ...state, agents: [...state.agents] });
      }),
    );

    if (workerResults.every(r => !r.ok)) {
      updateRun(parentRunId, { status: 'failed', workflow_stage: 'failed', updated_at: new Date().toISOString() });
      state.completedAt = Date.now();
      opts.onStateChanged({ ...state, agents: [...state.agents] });
      throw new Error('All worker agents failed');
    }

    // ── Stage 3: Synthesizer ──────────────────────────────────────────────────
    synthAgent.status = 'running';
    synthAgent.startedAt = Date.now();
    opts.onStateChanged({ ...state, agents: [...state.agents] });

    const successResults = workerResults.filter(r => r.ok);
    const failedSubtasks = workerResults.filter(r => !r.ok).map(r => r.subtask);

    const workerSummary = successResults
      .map((r, i) => `### Subtask ${i + 1}: ${r.subtask}\n\n${r.result}`)
      .join('\n\n---\n\n');

    const failureNote = failedSubtasks.length > 0
      ? `\n\nNote: The following subtasks failed and have no results: ${failedSubtasks.join(', ')}.`
      : '';

    const synthSystemPrompt =
      'You are a research synthesizer. Given the original user goal and results from parallel worker agents, ' +
      'write a clean structured report. Use markdown with titled sections. Always include: ' +
      '## Findings (key discoveries), ## Analysis (what they mean), ## Summary (2–3 sentence takeaway). ' +
      'Add a ## Sources section if any URLs were referenced. Be concise and factual.';

    const synthUserContent =
      `Original goal: ${goal}${failureNote}\n\n` +
      `Worker results:\n\n${workerSummary}`;

    let finalText = '';
    try {
      const { text } = await streamLLM(
        [{ role: 'user', content: synthUserContent }],
        synthSystemPrompt,
        '',
        { toolGroup: 'core', modelTier: 'standard', isGreeting: false },
        { ...opts, onText: (delta: string) => opts.onText(delta), maxIterations: 1 } as any,
      );
      finalText = text;
      synthAgent.status = 'done';
      synthAgent.completedAt = Date.now();
    } catch (e: any) {
      synthAgent.status = 'failed';
      synthAgent.completedAt = Date.now();
      synthAgent.error = e.message;
      updateRun(parentRunId, { status: 'failed', workflow_stage: 'failed', updated_at: new Date().toISOString() });
      opts.onStateChanged({ ...state, agents: [...state.agents], completedAt: Date.now() });
      throw e;
    }

    // Finalize
    updateRun(parentRunId, { status: 'completed', workflow_stage: 'completed', updated_at: new Date().toISOString() });
    state.completedAt = Date.now();
    opts.onStateChanged({ ...state, agents: [...state.agents] });

    return finalText;
  }
}

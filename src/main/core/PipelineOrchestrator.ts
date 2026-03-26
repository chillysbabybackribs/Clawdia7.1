// src/main/core/PipelineOrchestrator.ts
import { agentLoop } from '../agent/agentLoop';
import { streamLLM } from '../agent/streamLLM';
import { createRun, updateRun, addMessage, updateConversation } from '../db';
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
const MAX_WORKER_TOOL_CALLS = 20;
const MAX_WORKER_ITERATIONS = 30;

export class PipelineOrchestrator {
  /**
   * Classify whether the user's goal warrants a multi-agent pipeline.
   * Returns false on any error (fail-safe: fall back to single agent).
   */
  static async classifyIntent(
    goal: string,
    opts: Pick<PipelineRunOptions, 'provider' | 'apiKey' | 'model' | 'signal'>,
  ): Promise<boolean> {
    const systemPrompt =
      'You are a task classifier. Decide if the user goal is complex enough to benefit from being broken into 2–5 independent parallel subtasks. ' +
      'Answer ONLY with JSON: {"pipeline": true|false, "reason": "one sentence"}. ' +
      'Return pipeline:true only if parallel execution genuinely helps (multi-source research, multi-entity analysis, staged work). ' +
      'Return pipeline:false for simple questions, single-step tasks, or greetings.';
    try {
      const { text } = await streamLLM(
        [{ role: 'user', content: goal }],
        systemPrompt,
        '',
        { toolGroup: 'core', modelTier: 'fast', isGreeting: false },
        { ...opts, onText: () => {}, maxIterations: 1 } as any,
      );
      // Extract JSON — model may wrap in markdown fences
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return false;
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.pipeline === true;
    } catch {
      return false;
    }
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
        'You are a task planner. Break the user goal into 2–5 independent parallel subtasks. ' +
        'Each subtask should be self-contained and executable by a separate agent. ' +
        'Respond ONLY with a JSON array: [{"id":"sub-1","subtask":"short name","goal":"what the agent should accomplish"}]. ' +
        'Maximum 5 subtasks. Minimum 2.';

      const { text } = await streamLLM(
        [{ role: 'user', content: goal }],
        plannerPrompt,
        '',
        { toolGroup: 'core', modelTier: 'fast', isGreeting: false },
        { ...opts, onText: () => {}, maxIterations: 1 } as any,
      );

      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('Planner did not return a JSON array');
      subtasks = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(subtasks) || subtasks.length < 2) throw new Error('Planner returned fewer than 2 subtasks');
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
    const loopBase: Omit<LoopOptions, 'runId' | 'onText'> = {
      provider: opts.provider,
      apiKey: opts.apiKey,
      model: opts.model,
      signal: opts.signal,
      unrestrictedMode: opts.unrestrictedMode,
      browserService: opts.browserService,
      maxIterations: MAX_WORKER_ITERATIONS,
      onThinking: () => {},
      onToolActivity: (activity) => {
        // Update toolCallCount on the matching worker agent
        const agent = state.agents.find(a => a.id !== 'planner' && a.id !== 'synthesizer' && a.status === 'running');
        if (agent) agent.toolCallCount++;
        opts.onStateChanged({ ...state, agents: [...state.agents] });
      },
    };

    const workerResults: Array<{ subtask: string; result: string; ok: boolean }> = [];

    await Promise.all(
      subtasks.map(async (sub, i) => {
        const workerAgent = workerAgents[i];
        const workerRunId = `run-worker-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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
        { ...opts, onText: (delta) => { finalText += delta; opts.onText(delta); }, maxIterations: 1 } as any,
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

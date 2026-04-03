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
import { execSync, spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
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
  /** Files this worker touched (read/write/edit), collected from tool activity */
  filesTouched?: string[];
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

// Signals that a task is explicitly linear/sequential and must NOT be planned.
// These suppress the pipeline regardless of other heuristics.
const LINEAR_EXECUTION_SIGNALS = [
  /\bstop immediately\b/i,
  /\bthen stop\b/i,
  /\bstop\s+(when|once|after|on)\s+(done|finished|complete|success)\b/i,
  /\bdo not (ask|clarify|follow up|continue)\b/i,
  /\bno (planning|plan|decompos|synthesis|follow.?up)\b/i,
  /\bjust execute\b/i,
  /\bquiet(ly)? (execute|run|do)\b/i,
  /\bsilently (execute|run|do)\b/i,
  /\bstep by step\b.*\bstop\b/i,
  /\bdone\s*[—-]\s*do not\b/i,
];

// Signals that a bulleted/numbered list is a sequential checklist (linear)
// rather than independent parallel tasks.
const SEQUENTIAL_LIST_SIGNALS = [
  /\bthen\b/i,           // "do X then Y then Z"
  /\bafter\b/i,          // "after step 1, do step 2"
  /\bstop immediately\b/i,
  /\bverify\b/i,         // verify implies a prior step must complete first
  /\bprint.*path\b/i,    // print result of prior action
  /\bcheck.*exist\b/i,   // check the result of a prior action
];

function isLinearExecutionTask(goal: string): boolean {
  for (const pattern of LINEAR_EXECUTION_SIGNALS) {
    if (pattern.test(goal)) return true;
  }
  return false;
}

function isSequentialChecklist(goal: string): boolean {
  const bulletCount = (goal.match(/^\s*(?:[-*]|\d+\.)\s+/gm) ?? []).length;
  if (bulletCount < 2) return false;
  // A list is sequential (not parallel) when it contains order-dependency signals
  return SEQUENTIAL_LIST_SIGNALS.some(p => p.test(goal));
}

function shouldUseConcurrentHeuristic(goal: string): boolean {
  const text = goal.trim();
  const lower = text.toLowerCase();

  if (!text || text.length < 80) return false;
  if (/^(hi|hello|hey|thanks|thank you|bye|goodbye)\b/.test(lower)) return false;

  // Explicit linear/stop signals always bypass the pipeline
  if (isLinearExecutionTask(text)) {
    console.log('[pipeline:classify] DIRECT — linear execution signal detected');
    return false;
  }

  const hasStructuredList =
    (text.match(/^\s*(?:[-*]|\d+\.)\s+/gm) ?? []).length >= 2;

  // A bulleted list that is a sequential checklist is NOT a concurrent task
  if (hasStructuredList && isSequentialChecklist(text)) {
    console.log('[pipeline:classify] DIRECT — structured list is a sequential checklist, not parallel tasks');
    return false;
  }

  const hasMultiTargetCompare =
    /\b(compare|contrast|benchmark|evaluate|rank)\b/.test(lower)
    && /\b(and|vs\.?|versus)\b/.test(lower);

  // Research/audit cue requires BOTH a genuine research keyword AND a parallel
  // structure indicator — length alone is insufficient.
  const hasResearchCue =
    /\b(audit|investigate|research|analyze|analysis|survey|synthesize)\b/.test(lower);
  const hasParallelCue =
    /\b(multiple|several|across|parallel|independent|various)\b/.test(lower);
  const hasMultiPartRequest =
    /\b(1\.|2\.|first\b.*\bsecond\b)\b/.test(lower);
  const hasManyQuestions = (text.match(/\?/g) ?? []).length >= 2;

  if (hasStructuredList) {
    console.log('[pipeline:classify] PIPELINE — unambiguous parallel structured list');
    return true;
  }
  if (hasMultiTargetCompare) {
    console.log('[pipeline:classify] PIPELINE — multi-target comparison');
    return true;
  }
  if (hasResearchCue && (hasParallelCue || hasMultiPartRequest || hasManyQuestions)) {
    console.log('[pipeline:classify] PIPELINE — research cue + parallel/multi-part structure');
    return true;
  }

  return false;
}

export function classifyConcurrentIntent(goal: string): boolean {
  return shouldUseConcurrentHeuristic(goal);
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

// ─── Execution summary ──────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = (ms / 1000).toFixed(1);
  return `${secs}s`;
}

function buildExecutionSummary(
  plan: ConcurrentPlan,
  results: Map<string, ExecutorOutcome>,
  strategy: ConcurrentStrategy | undefined,
  synthesized: boolean,
  totalMs: number,
): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push('**Concurrent Execution Summary**');
  lines.push('');
  lines.push(`| | Worker | Executor | Status | Duration | Files |`);
  lines.push(`|---|--------|----------|--------|----------|-------|`);

  for (const subtask of plan.subtasks) {
    const r = results.get(subtask.id);
    const executor = subtask.executor === 'claudeCode' ? 'Claude Code' : 'Codex';
    if (!r) {
      lines.push(`| | ${subtask.label} | ${executor} | skipped | — | — |`);
      continue;
    }
    const status = r.ok ? 'ok' : 'failed';
    const duration = formatDuration(r.durationMs);
    const files = r.filesTouched?.length ?? 0;
    lines.push(`| ${r.ok ? '&check;' : '&cross;'} | ${subtask.label} | ${executor} | ${status} | ${duration} | ${files} |`);
  }

  lines.push('');
  const stratLabel = strategy === 'claude_primary_codex_review' ? 'primary + review' : (strategy ?? 'parallel');
  lines.push(`Strategy: **${stratLabel}** | Synthesized: **${synthesized ? 'yes' : 'no'}** | Total: **${formatDuration(totalMs)}**`);

  return lines.join('\n');
}

// ─── Tool Activity Bus (cross-worker awareness) ─────────────────────────────

/** Lightweight event bus that collects tool activity from all workers so siblings can see what's happening. */
class ToolActivityBus {
  private entries: { workerId: string; label: string; tool: string; detail: string; ts: number }[] = [];

  push(workerId: string, label: string, tool: string, detail: string): void {
    this.entries.push({ workerId, label, tool, detail, ts: Date.now() });
  }

  /** Returns a concise summary of what other workers have been doing (excludes the caller). */
  siblingActivity(excludeWorkerId: string, limit = 20): string {
    const sibling = this.entries
      .filter(e => e.workerId !== excludeWorkerId)
      .slice(-limit);
    if (sibling.length === 0) return '';
    const lines = sibling.map(e => `- [${e.label}] ${e.detail}`);
    return `\n\n[Sibling agent activity — for awareness only, do not duplicate this work]\n${lines.join('\n')}`;
  }

  /** Returns file paths touched by each worker (for conflict detection). */
  filesTouchedByWorker(): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    for (const e of this.entries) {
      // Extract file paths from common tool names
      const fileMatch = e.detail.match(/(?:file|path|Reading|Writing|Editing|Glob|Grep).*?:\s*(\S+)/i);
      if (fileMatch) {
        if (!map.has(e.workerId)) map.set(e.workerId, new Set());
        map.get(e.workerId)!.add(fileMatch[1]);
      }
    }
    return map;
  }
}

// ─── File Conflict Detection ─────────────────────────────────────────────────

/** Extract file paths from tool activity events by matching known tool patterns. */
function extractFileFromToolActivity(activity: ToolCall): string | null {
  const input = activity.input;
  if (!input) return null;
  try {
    const parsed = typeof input === 'string' ? JSON.parse(input) : input;
    return parsed.file_path ?? parsed.path ?? parsed.file ?? null;
  } catch {
    return null;
  }
}

interface FileConflictReport {
  hasConflicts: boolean;
  conflicts: { file: string; workers: string[] }[];
}

function detectFileConflicts(
  workerFiles: Map<string, Set<string>>,
  plan: ConcurrentPlan,
): FileConflictReport {
  const fileToWorkers = new Map<string, string[]>();
  for (const [workerId, files] of workerFiles) {
    const subtask = plan.subtasks.find(t => t.id === workerId);
    const label = subtask?.label ?? workerId;
    for (const f of files) {
      if (!fileToWorkers.has(f)) fileToWorkers.set(f, []);
      fileToWorkers.get(f)!.push(label);
    }
  }
  const conflicts: { file: string; workers: string[] }[] = [];
  for (const [file, workers] of fileToWorkers) {
    if (workers.length > 1) conflicts.push({ file, workers });
  }
  return { hasConflicts: conflicts.length > 0, conflicts };
}

// ─── Git Worktree Isolation ──────────────────────────────────────────────────

function getRepoRoot(): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function createWorktree(repoRoot: string, runId: string): string | null {
  const worktreePath = path.join(repoRoot, '.clawdia-worktrees', runId);
  const branchName = `clawdia-worker-${runId}`;
  try {
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
    execSync(`git worktree add -b "${branchName}" "${worktreePath}" HEAD`, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return worktreePath;
  } catch {
    return null;
  }
}

function mergeWorktree(repoRoot: string, runId: string, worktreePath: string): { merged: boolean; error?: string } {
  const branchName = `clawdia-worker-${runId}`;
  try {
    // Check if worker made any changes
    const diff = execSync('git diff HEAD --stat', { cwd: worktreePath, encoding: 'utf8' }).trim();
    if (!diff) {
      // No changes — just clean up
      cleanupWorktree(repoRoot, worktreePath, branchName);
      return { merged: true };
    }

    // Commit worker changes in the worktree
    execSync('git add -A && git commit -m "concurrent worker output"', {
      cwd: worktreePath,
      encoding: 'utf8',
      stdio: 'pipe',
      shell: '/bin/bash',
    });

    // Merge worker branch back into the original HEAD
    const result = spawnSync('git', ['merge', '--no-ff', '-m', `Merge concurrent worker ${runId}`, branchName], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    cleanupWorktree(repoRoot, worktreePath, branchName);

    if (result.status !== 0) {
      return { merged: false, error: `Merge conflict: ${result.stderr?.slice(0, 200)}` };
    }
    return { merged: true };
  } catch (err) {
    cleanupWorktree(repoRoot, worktreePath, branchName);
    return { merged: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function cleanupWorktree(repoRoot: string, worktreePath: string, branchName: string): void {
  try { execSync(`git worktree remove "${worktreePath}" --force`, { cwd: repoRoot, stdio: 'pipe' }); } catch { /* ignore */ }
  try { execSync(`git branch -D "${branchName}"`, { cwd: repoRoot, stdio: 'pipe' }); } catch { /* ignore */ }
}

// ─── Phase 1: Planner ─────────────────────────────────────────────────────────

async function runPlanner(
  userPrompt: string,
  settings: ReturnType<typeof loadSettings>,
  strategy: ConcurrentStrategy | undefined,
  signal: AbortSignal,
  onText: (delta: string) => void,
): Promise<ConcurrentPlan> {
  if (strategy === 'claude_primary_codex_review') {
    const explanation = 'Using fixed strategy: Claude Code handles the primary task first, then Codex reviews the result with dependency context.\n';
    onText(explanation);
    return {
      goal: userPrompt.slice(0, 160),
      subtasks: [
        {
          id: 't1',
          executor: 'claudeCode',
          label: 'Claude primary',
          prompt: userPrompt,
          dependsOn: [],
        },
        {
          id: 't2',
          executor: 'codex',
          label: 'Codex review',
          prompt: [
            'Review the upstream worker output against the original user task.',
            'Look for correctness issues, missing edge cases, regressions, unnecessary changes, and missing verification.',
            'Be concrete and actionable. If the upstream output appears strong, say so briefly and focus on residual risks.',
            '',
            `[Original task]\n${userPrompt}`,
          ].join('\n'),
          dependsOn: ['t1'],
        },
      ],
      synthesisHint: 'Integrate the primary output and the review findings into one response. Preserve concrete review findings and avoid redundant narration.',
    };
  }

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

function buildWorkerPrompt(
  subtask: ConcurrentSubtask,
  priorResults: Map<string, ExecutorOutcome>,
): string {
  if (subtask.dependsOn.length === 0) return subtask.prompt;

  const dependencySections = subtask.dependsOn
    .map((depId) => {
      const outcome = priorResults.get(depId);
      if (!outcome) return null;
      return [
        `Dependency: ${depId}`,
        `Executor: ${outcome.executorId}`,
        `Status: ${outcome.ok ? 'ok' : `failed (${outcome.error ?? 'unknown error'})`}`,
        'Output:',
        outcome.ok ? outcome.text : `Failed: ${outcome.error ?? 'unknown error'}`,
      ].join('\n');
    })
    .filter(Boolean)
    .join('\n\n---\n\n');

  if (!dependencySections) return subtask.prompt;

  return [
    subtask.prompt,
    '',
    '[Dependency context]',
    dependencySections,
  ].join('\n');
}

interface WorkerPhaseResult {
  results: Map<string, ExecutorOutcome>;
  activityBus: ToolActivityBus;
  conflictReport: FileConflictReport;
}

async function runWorkers(
  plan: ConcurrentPlan,
  opts: ConcurrentRunOptions,
  state: ConcurrentState,
  emitState: () => void,
  convPersistedSession: string | null,
): Promise<WorkerPhaseResult> {
  const settings = loadSettings();
  const results = new Map<string, ExecutorOutcome>();
  const completed = new Set<string>();
  const activityBus = new ToolActivityBus();

  // Detect git repo for worktree isolation (only when enabled in config)
  const { loadExecutorConfigs } = await import('./ExecutorConfigStore');
  const concurrentConfig = loadExecutorConfigs().concurrent;
  const repoRoot = concurrentConfig.useWorktrees ? getRepoRoot() : null;

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
    const batch = ready.map(subtask => runSingleWorker(
      subtask,
      buildWorkerPrompt(subtask, results),
      opts,
      state,
      emitState,
      settings,
      convPersistedSession,
      activityBus,
      repoRoot,
    ));
    const settled = await Promise.allSettled(batch);

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        const { subtaskId, outcome } = result.value;
        results.set(subtaskId, outcome);
        completed.add(subtaskId);
      }
    }
  }

  // Detect file conflicts across workers
  const workerFiles = activityBus.filesTouchedByWorker();
  const conflictReport = detectFileConflicts(workerFiles, plan);

  return { results, activityBus, conflictReport };
}

async function runSingleWorker(
  subtask: ConcurrentSubtask,
  workerPrompt: string,
  opts: ConcurrentRunOptions,
  state: ConcurrentState,
  emitState: () => void,
  settings: ReturnType<typeof loadSettings>,
  convPersistedSession: string | null,
  activityBus: ToolActivityBus,
  repoRoot: string | null,
): Promise<WorkerResult> {
  const startedAt = Date.now();
  const runId = makeRunId(subtask.executor === 'claudeCode' ? 'cc' : 'cdx');
  const filesTouched = new Set<string>();

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

  // Create worktree if inside a git repo and multiple workers in this batch
  let worktreePath: string | null = null;
  if (repoRoot) {
    worktreePath = createWorktree(repoRoot, runId);
  }

  // Wrap tool activity to feed into the shared bus and track files
  const wrapToolActivity = (activity: ToolCall, source: 'claudeCode' | 'codex') => {
    activityBus.push(subtask.id, subtask.label ?? subtask.id, activity.name ?? 'unknown', activity.detail ?? '');
    const filePath = extractFileFromToolActivity(activity);
    if (filePath) filesTouched.add(filePath);
    opts.onToolActivity?.({ ...activity, source } as ToolCall & { source: 'claudeCode' | 'codex' });
  };

  // Append sibling activity context to the prompt so workers have awareness
  const siblingContext = activityBus.siblingActivity(subtask.id);
  const enrichedPrompt = siblingContext ? workerPrompt + siblingContext : workerPrompt;

  // If worktree was created, prepend a CWD instruction
  const finalPrompt = worktreePath
    ? `IMPORTANT: Work in this directory: ${worktreePath}\nAll file operations should be relative to or within this path.\n\n${enrichedPrompt}`
    : enrichedPrompt;

  try {
    let finalText = '';

    if (subtask.executor === 'claudeCode') {
      const result = await runClaudeCode({
        conversationId: `${opts.conversationId}-cc-${subtask.id}`,
        prompt: finalPrompt,
        attachments: opts.attachments,
        skipPermissions: settings.unrestrictedMode,
        persistedSessionId: convPersistedSession,
        onText: (delta) => opts.onText(delta, 'claudeCode'),
        onToolActivity: (activity) => wrapToolActivity(activity, 'claudeCode'),
      });
      finalText = result.finalText;
    } else {
      const result = await runCodexCli({
        conversationId: `${opts.conversationId}-cdx-${subtask.id}`,
        prompt: finalPrompt,
        onText: (delta) => opts.onText(delta, 'codex'),
        onToolActivity: (activity) => wrapToolActivity(activity, 'codex'),
      });
      finalText = result.finalText;
    }

    // Merge worktree changes back if we used one
    if (worktreePath && repoRoot) {
      const mergeResult = mergeWorktree(repoRoot, runId, worktreePath);
      if (!mergeResult.merged) {
        finalText += `\n\n⚠️ Worktree merge warning: ${mergeResult.error}`;
      }
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
        filesTouched: [...filesTouched],
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failRun(runId, msg);
    agentState.status = 'failed';
    agentState.completedAt = Date.now();
    agentState.error = msg;
    emitState();

    // Clean up worktree on failure
    if (worktreePath && repoRoot) {
      cleanupWorktree(repoRoot, worktreePath, `clawdia-worker-${runId}`);
    }

    return {
      subtaskId: subtask.id,
      outcome: {
        executorId: subtask.executor,
        runId,
        ok: false,
        text: '',
        error: msg,
        durationMs: Date.now() - startedAt,
        filesTouched: [...filesTouched],
      },
    };
  }
}

// ─── Phase 3: Synthesizer ─────────────────────────────────────────────────────

async function synthesizeResults(
  plan: ConcurrentPlan,
  workerResults: Map<string, ExecutorOutcome>,
  conflictReport: FileConflictReport,
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

  // Build conflict warning section for the synthesizer
  let conflictSection = '';
  if (conflictReport.hasConflicts) {
    const lines = conflictReport.conflicts.map(
      c => `- ${c.file} was modified by: ${c.workers.join(', ')}`,
    );
    conflictSection = [
      '',
      '⚠️ FILE CONFLICTS DETECTED — the following files were touched by multiple workers:',
      ...lines,
      'You MUST review these files carefully. Prefer the more complete/correct version and note any discrepancies.',
      '',
    ].join('\n');
  }

  const synthPrompt = [
    `You are synthesizing the outputs of ${plan.subtasks.length} AI agents that worked on parts of a task.`,
    `Overall goal: ${plan.goal}`,
    '',
    `Synthesis guidance: ${plan.synthesisHint}`,
    conflictSection,
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
    strategy,
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
      strategy,
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

  const { results: workerResults, conflictReport } = await runWorkers(plan, opts, state, emitState, convPersistedSession);

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

  // Log file conflicts for visibility
  if (conflictReport.hasConflicts) {
    const conflictFiles = conflictReport.conflicts.map(c => c.file).join(', ');
    onThinking?.(`⚠️ File conflicts detected: ${conflictFiles}`);
  }

  // ── Phase 3: Synthesize ──────────────────────────────────────────────────
  let finalText = '';
  let synthesized = false;

  const anyOk = [...workerResults.values()].some(r => r.ok);

  // Suppress synthesis when the original prompt contains an explicit stop/quiet signal.
  // In that case, return the last successful worker output directly.
  const suppressSynthesis = synthesize && isLinearExecutionTask(prompt);
  if (suppressSynthesis) {
    console.log('[pipeline:synthesize] SUPPRESSED — linear/stop signal in prompt');
  }

  if (synthesize && !suppressSynthesis && anyOk && !signal.aborted) {
    state.synthesizing = true;
    state.phase = 'synthesizing';
    emitState();
    onThinking?.('Synthesizing results…');

    try {
      finalText = await synthesizeResults(
        plan,
        workerResults,
        conflictReport,
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

  // ── Execution summary (streamed so the user sees proof of what ran) ──────
  const totalMs = state.completedAt - startedAt;
  const summaryLines = buildExecutionSummary(plan, workerResults, strategy, synthesized, totalMs);
  onText('\n\n' + summaryLines, 'planner');

  return {
    finalText,
    executorResults: Object.fromEntries(workerResults),
    synthesized,
  };
}

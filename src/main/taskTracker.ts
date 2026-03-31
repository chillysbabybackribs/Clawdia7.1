/**
 * TaskTracker — stable task identity above individual executor runs.
 *
 * A task represents one unit of work initiated by a user message.
 * It lives at the conversation level, above individual executor runs.
 *
 * Relationship:
 *   conversation  1──*  tasks  1──*  runs
 *
 * Each new user send creates a new task. A task may involve multiple runs
 * (e.g. retry after abort) but all runs for a given user action share the
 * same taskId.
 *
 * taskId  ≠  runId:
 *   - taskId  = identity of the work (stable across retries/executors)
 *   - runId   = identity of one executor invocation (ephemeral per execution)
 */

import { createTask, updateTask, getTask, getLatestTaskForConversation, getTasksForConversation, getDb } from './db';
import type { TaskRow } from './db';
import type { ExecutorId } from './core/executors/ExecutorRegistry';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskId = string;
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskState {
  taskId: TaskId;
  conversationId: string;
  goal: string;
  status: TaskStatus;
  executorId: ExecutorId;
  activeRunId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

// ─── ID generation ────────────────────────────────────────────────────────────

function newTaskId(): TaskId {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─── Task creation ────────────────────────────────────────────────────────────

/**
 * Create a new task for a user-initiated work unit.
 *
 * Task creation rule:
 *   Every explicit user CHAT_SEND creates a new task. This is the simplest,
 *   most predictable rule — it does not attempt semantic inference. If a user
 *   sends a follow-up message, that is a new task. Tasks are cheap to create
 *   and the history is retained, so over-creating is preferable to conflating
 *   unrelated work under one taskId.
 *
 * Future callers may pass a taskId to reuse (e.g. explicit retry UI), but
 * that is not wired yet — this first pass always creates fresh.
 */
export function createNewTask(
  conversationId: string,
  goal: string,
  executorId: ExecutorId,
): TaskId {
  const taskId = newTaskId();
  const now = new Date().toISOString();
  const row: TaskRow = {
    id: taskId,
    conversation_id: conversationId,
    goal: goal.slice(0, 500),  // cap stored goal length
    status: 'running',
    executor_id: executorId,
    active_run_id: null,
    last_error: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
  };
  createTask(row);
  return taskId;
}

// ─── Task lifecycle updates ───────────────────────────────────────────────────

/** Associate a runId with the active task (once the executor starts). */
export function linkRunToTask(taskId: TaskId, runId: string): void {
  const now = new Date().toISOString();
  updateTask(taskId, { active_run_id: runId, updated_at: now });
}

/** Mark the task as completed successfully. */
export function completeTask(taskId: TaskId): void {
  const now = new Date().toISOString();
  updateTask(taskId, {
    status: 'completed',
    active_run_id: null,
    updated_at: now,
    completed_at: now,
  });
}

/** Mark the task as failed with an optional error summary. */
export function failTask(taskId: TaskId, error?: string): void {
  const now = new Date().toISOString();
  updateTask(taskId, {
    status: 'failed',
    active_run_id: null,
    last_error: error?.slice(0, 500) ?? null,
    updated_at: now,
    completed_at: now,
  });
}

/** Mark the task as cancelled (user stopped it). */
export function cancelTask(taskId: TaskId): void {
  const now = new Date().toISOString();
  updateTask(taskId, {
    status: 'cancelled',
    active_run_id: null,
    updated_at: now,
    completed_at: now,
  });
}

// ─── Task queries ─────────────────────────────────────────────────────────────

/** Convert a DB TaskRow to the public TaskState shape. */
function rowToState(row: TaskRow): TaskState {
  return {
    taskId: row.id,
    conversationId: row.conversation_id,
    goal: row.goal,
    status: row.status as TaskStatus,
    executorId: row.executor_id as ExecutorId,
    activeRunId: row.active_run_id,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

/** Get a task by id. */
export function getTaskState(taskId: TaskId): TaskState | null {
  const row = getTask(taskId);
  return row ? rowToState(row) : null;
}

/** Get the most recent task for a conversation (active or last completed). */
export function getLatestTask(conversationId: string): TaskState | null {
  const row = getLatestTaskForConversation(conversationId);
  return row ? rowToState(row) : null;
}

/** Get recent tasks for a conversation (most recent first). */
export function getRecentTasks(conversationId: string, limit = 20): TaskState[] {
  return getTasksForConversation(conversationId, limit).map(rowToState);
}

/** Get the taskId that owns a given runId by querying the active_run_id column. */
export function getTaskIdForRun(runId: string): TaskId | null {
  try {
    const row = getDb()
      .prepare(`SELECT id FROM tasks WHERE active_run_id = ? LIMIT 1`)
      .get(runId) as { id: string } | undefined;
    return row?.id ?? null;
  } catch {
    return null;
  }
}

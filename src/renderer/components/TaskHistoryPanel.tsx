/**
 * TaskHistoryPanel — shows recent task history for the active conversation.
 *
 * Renders as a bottom sheet inside the chat layout.
 * Displays the last N tasks with: goal, executor, status, timestamps.
 */

import React, { useEffect, useState, useCallback } from 'react';

interface TaskState {
  taskId: string;
  conversationId: string;
  goal: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  executorId: 'agentLoop' | 'claudeCode' | 'codex' | 'concurrent';
  activeRunId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface TaskHistoryPanelProps {
  conversationId: string | null;
  onClose: () => void;
}

const EXECUTOR_LABEL: Record<string, string> = {
  agentLoop: 'Agent Loop',
  claudeCode: 'Claude Code',
  codex: 'Codex',
  concurrent: 'Concurrent',
};

const STATUS_DOT: Record<string, string> = {
  pending:   'bg-white/30',
  running:   'bg-accent animate-pulse',
  completed: 'bg-emerald-400',
  failed:    'bg-red-400',
  cancelled: 'bg-white/30',
};

const STATUS_LABEL: Record<string, string> = {
  pending:   'pending',
  running:   'running…',
  completed: 'completed',
  failed:    'failed',
  cancelled: 'cancelled',
};

const STATUS_TEXT_COLOR: Record<string, string> = {
  pending:   'text-text-muted',
  running:   'text-accent',
  completed: 'text-emerald-400',
  failed:    'text-red-400',
  cancelled: 'text-text-muted',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function durationMs(start: string, end: string | null): string | null {
  if (!end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export default function TaskHistoryPanel({ conversationId, onClose }: TaskHistoryPanelProps) {
  const [tasks, setTasks] = useState<TaskState[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!conversationId) return;
    const api = (window as any).clawdia;
    if (!api?.taskHistory) return;
    setLoading(true);
    api.taskHistory.list(conversationId, 30)
      .then((result: TaskState[]) => setTasks(result ?? []))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, [conversationId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#18181c] shadow-[0_-18px_50px_rgba(0,0,0,0.42)] animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.08] bg-[#18181c] flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary">Task History</span>
          {tasks.length > 0 && (
            <span className="text-[10px] text-text-muted bg-white/[0.06] px-1.5 py-0.5 rounded-md">
              {tasks.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="text-text-muted hover:text-text-secondary transition-colors cursor-pointer p-1 rounded-md hover:bg-white/[0.05]"
            title="Refresh"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-secondary transition-colors cursor-pointer p-1 rounded-md hover:bg-white/[0.05]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 bg-[#18181c]">
        {loading && tasks.length === 0 && (
          <div className="text-center text-text-muted text-sm py-10">Loading…</div>
        )}

        {!loading && tasks.length === 0 && (
          <div className="text-center py-10">
            <div className="text-text-muted text-sm">No tasks yet</div>
            <div className="text-text-muted/60 text-xs mt-1">Tasks are created each time you send a message</div>
          </div>
        )}

        {tasks.length > 0 && (
          <div className="flex flex-col gap-2">
            {tasks.map((task) => {
              const dur = durationMs(task.createdAt, task.completedAt);
              return (
                <div
                  key={task.taskId}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 flex flex-col gap-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                >
                  {/* Top row: status dot + goal + executor badge */}
                  <div className="flex items-start gap-2.5">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${STATUS_DOT[task.status] ?? 'bg-white/20'}`} />
                    <span className="flex-1 text-sm text-text-primary leading-snug line-clamp-2">
                      {task.goal || '(no goal recorded)'}
                    </span>
                    <span className="flex-shrink-0 text-[10px] text-text-muted bg-black/20 px-1.5 py-0.5 rounded-md ml-1">
                      {EXECUTOR_LABEL[task.executorId] ?? task.executorId}
                    </span>
                  </div>

                  {/* Bottom row: status label + times */}
                  <div className="flex items-center gap-3 pl-[18px] text-[11px]">
                    <span className={STATUS_TEXT_COLOR[task.status] ?? 'text-text-muted'}>
                      {STATUS_LABEL[task.status] ?? task.status}
                    </span>
                    {dur && (
                      <span className="text-text-muted">{dur}</span>
                    )}
                    <span className="text-text-muted ml-auto">{timeAgo(task.createdAt)}</span>
                  </div>

                  {/* Error line */}
                  {task.lastError && (
                    <div className="pl-[18px] text-[11px] text-red-400/80 truncate" title={task.lastError}>
                      {task.lastError}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

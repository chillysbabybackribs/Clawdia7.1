import React, { useState, useEffect, useCallback } from 'react';

const api = (window as any).clawdia;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScheduledTask {
  id: number;
  name: string;
  description: string;
  cronExpr?: string;
  enabled: boolean;
  requiresApproval: boolean;
  prompt: string;
}

interface TaskRun {
  id: number;
  taskId: number;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  startedAt: string;
  completedAt?: string;
  result?: string;
  error?: string;
  conversationId?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CRON_PRESETS = [
  { label: 'Every morning 7am', value: '0 7 * * *' },
  { label: 'Every weekday 7am', value: '0 7 * * 1-5' },
  { label: 'Every Monday 9am', value: '0 9 * * 1' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Custom cron...', value: 'custom' },
];

function cronToHuman(expr: string): string {
  if (expr === '0 7 * * *') return '7:00 AM daily';
  if (expr === '0 7 * * 1-5') return '7:00 AM weekdays';
  if (expr === '0 9 * * 1') return '9:00 AM Mondays';
  if (expr === '0 * * * *') return 'every hour';
  return expr;
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function compactText(text?: string, max = 120): string {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max).trimEnd()}...` : normalized;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function RunDot({ status }: { status: TaskRun['status'] }) {
  if (status === 'failed') return (
    <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#FF5061] flex-shrink-0" />
  );
  if (status === 'running') return (
    <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/60 flex-shrink-0 animate-pulse" />
  );
  if (status === 'skipped') return (
    <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/20 flex-shrink-0" />
  );
  // completed
  return (
    <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/40 flex-shrink-0" />
  );
}

function RunRow({ run, onOpen }: { run: TaskRun; onOpen?: (conversationId: string) => void }) {
  const preview = run.error
    ? run.error.slice(0, 80)
    : run.result
    ? run.result.slice(0, 80)
    : run.status;

  const canOpen = run.status === 'completed' && !!run.conversationId && !!onOpen;

  return (
    <div
      className={`flex items-start gap-2 py-1 ${canOpen ? 'cursor-pointer hover:bg-white/[0.03] -mx-1 px-1 rounded' : ''}`}
      onClick={canOpen && run.conversationId ? (e) => { e.stopPropagation(); onOpen!(run.conversationId!); } : undefined}
      title={canOpen ? 'Open in chat' : undefined}
    >
      <RunDot status={run.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-muted text-[10px] font-mono">{formatRelativeTime(run.startedAt)}</span>
          <span className="text-muted text-[10px] font-mono">{run.status}</span>
          {canOpen && (
            <span className="text-muted text-[9px] opacity-50">→ open</span>
          )}
        </div>
        {preview && (
          <div className="text-[#5e5e6a] text-[10px] truncate leading-tight mt-0.5">{preview}</div>
        )}
      </div>
    </div>
  );
}

// ─── Create Form ──────────────────────────────────────────────────────────────

interface CreateFormProps {
  onCreated: (task: ScheduledTask) => void;
  onCancel: () => void;
}

function CreateForm({ onCreated, onCancel }: CreateFormProps) {
  const [name, setName] = useState('');
  const [schedulePreset, setSchedulePreset] = useState('0 7 * * *');
  const [customCron, setCustomCron] = useState('');
  const [prompt, setPrompt] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cronExpr = schedulePreset === 'custom' ? customCron.trim() : schedulePreset;

  const handleCreate = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    if (!prompt.trim()) { setError('Prompt is required'); return; }
    if (!cronExpr) { setError('Schedule is required'); return; }
    setError(null);
    setCreating(true);
    try {
      const task = await api.tasks.create({
        name: name.trim(),
        prompt: prompt.trim(),
        cronExpr,
        triggerType: 'time',
        requiresApproval: false,
      });
      onCreated(task);
    } catch (err: any) {
      setError(err?.message || 'Failed to create task');
      setCreating(false);
    }
  };

  return (
    <div className="border-b border-border px-3 py-3 space-y-2.5">
      {/* Name */}
      <div>
        <label className="block text-[10px] text-muted uppercase tracking-widest mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Morning Weather Brief"
          className="w-full bg-white/[0.04] border border-border text-primary text-[12px] px-2.5 py-1.5 outline-none focus:border-white/20 placeholder:text-muted font-sans"
        />
      </div>

      {/* Schedule */}
      <div>
        <label className="block text-[10px] text-muted uppercase tracking-widest mb-1">Schedule</label>
        <select
          value={schedulePreset}
          onChange={e => setSchedulePreset(e.target.value)}
          className="w-full bg-white/[0.04] border border-border text-primary text-[12px] px-2.5 py-1.5 outline-none focus:border-white/20 font-sans appearance-none"
        >
          {CRON_PRESETS.map(p => (
            <option key={p.value} value={p.value} className="bg-[#0d0d10]">{p.label}</option>
          ))}
        </select>
        {schedulePreset === 'custom' && (
          <input
            type="text"
            value={customCron}
            onChange={e => setCustomCron(e.target.value)}
            placeholder="0 8 * * 1-5"
            className="mt-1.5 w-full bg-white/[0.04] border border-border text-primary text-[11px] font-mono px-2.5 py-1.5 outline-none focus:border-white/20 placeholder:text-muted"
          />
        )}
      </div>

      {/* Prompt */}
      <div>
        <label className="block text-[10px] text-muted uppercase tracking-widest mb-1">Prompt</label>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="Check the weather forecast and summarize today's conditions..."
          rows={3}
          className="w-full bg-white/[0.04] border border-border text-primary text-[12px] px-2.5 py-1.5 outline-none focus:border-white/20 placeholder:text-muted font-sans resize-none leading-relaxed"
        />
      </div>

      {error && (
        <div className="text-[#FF5061] text-[11px]">{error}</div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-0.5">
        <button
          onClick={onCancel}
          disabled={creating}
          className="text-muted text-[11px] hover:text-primary transition-colors disabled:opacity-40 px-1 py-0.5"
        >
          Cancel
        </button>
        <button
          onClick={handleCreate}
          disabled={creating || !name.trim() || !prompt.trim() || !cronExpr}
          className="text-primary text-[11px] bg-white/[0.06] hover:bg-white/[0.09] px-3 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {creating ? 'Creating...' : 'Create'}
        </button>
      </div>
    </div>
  );
}

// ─── Task Row ─────────────────────────────────────────────────────────────────

interface TaskRowProps {
  task: ScheduledTask;
  expanded: boolean;
  runs: TaskRun[] | undefined;
  onToggleExpand: () => void;
  onOpenConversation: (conversationId: string) => void;
  onEnable: (enabled: boolean) => void;
  onDelete: () => void;
  onRunNow: () => void;
  runningNow: boolean;
}

function TaskRow({
  task,
  expanded,
  runs,
  onToggleExpand,
  onOpenConversation,
  onEnable,
  onDelete,
  onRunNow,
  runningNow,
}: TaskRowProps) {
  const latestCompletedRun = runs?.find((run) => run.status === 'completed' && !!run.conversationId);
  const latestRun = runs?.[0];
  const completedRuns = runs?.filter((run) => run.status === 'completed') || [];
  const promptPreview = compactText(task.prompt, 84);
  const latestRunLabel = runningNow
    ? 'Running now'
    : latestRun
    ? latestRun.status === 'completed'
      ? `Last run ${formatRelativeTime(latestRun.startedAt)}`
      : latestRun.status
    : null;

  const handleRowClick = () => {
    if (latestCompletedRun?.conversationId) {
      onOpenConversation(latestCompletedRun.conversationId);
      return;
    }
    onToggleExpand();
  };

  return (
    <div className="border-b border-border-subtle last:border-b-0">
      {/* Main row */}
      <div
        className="group flex items-start gap-2.5 px-3 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
        onClick={handleRowClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleRowClick();
          }
        }}
        role="button"
        tabIndex={0}
        title={latestCompletedRun?.conversationId ? 'Open latest completed run in chat' : 'Show automation details'}
      >
        {/* Status dot */}
        <div className="flex-shrink-0 flex items-center justify-center w-3 pt-[3px]">
          {runningNow ? (
            <span className="block w-[6px] h-[6px] rounded-full bg-[#64B5FF] animate-pulse shadow-[0_0_10px_rgba(100,181,255,0.7)]" />
          ) : task.enabled ? (
            <span className="block w-[5px] h-[5px] rounded-full bg-[#FF5061]" />
          ) : (
            <span className="block w-[5px] h-[5px] rounded-full bg-white/20" />
          )}
        </div>

        {/* Name + next run */}
        <div className="flex-1 min-w-0">
          <div className="text-primary text-[12px] font-semibold truncate leading-tight tracking-[0.01em]">
            {task.name}
          </div>
          {task.cronExpr && (
            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
              <span className="inline-flex items-center rounded-full border border-white/[0.06] bg-white/[0.03] px-1.5 py-[2px] text-[9px] font-mono text-muted">
                {cronToHuman(task.cronExpr)}
              </span>
              {runningNow && (
                <span className="inline-flex items-center rounded-full border border-[#64B5FF]/30 bg-[#64B5FF]/12 px-1.5 py-[2px] text-[9px] font-mono text-[#9BD1FF]">
                  Running
                </span>
              )}
            </div>
          )}
          {promptPreview && (
            <div className="text-[#676773] text-[10px] leading-[1.35] mt-1.5 line-clamp-2">
              {promptPreview}
            </div>
          )}
          {latestRunLabel && (
            <div className="flex items-center gap-1.5 mt-1.5 min-w-0">
              <RunDot status={runningNow ? 'running' : (latestRun?.status ?? 'completed')} />
              <span className="text-muted text-[9px] font-mono whitespace-nowrap">
                {latestRunLabel}
              </span>
              {completedRuns.length > 1 && (
                <span className="text-muted/60 text-[9px] font-mono whitespace-nowrap">
                  {completedRuns.length} complete
                </span>
              )}
            </div>
          )}
        </div>

        {/* Action buttons — visible on group hover */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pt-[1px]">
          {/* Run now */}
          <button
            onClick={e => { e.stopPropagation(); onRunNow(); }}
            disabled={runningNow}
            title="Run now"
            className="text-muted hover:text-primary transition-colors p-1 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor">
              <path d="M2 1.5L9.5 5.5L2 9.5V1.5Z" />
            </svg>
          </button>

          {/* Pause / Resume */}
          <button
            onClick={e => { e.stopPropagation(); onEnable(!task.enabled); }}
            title={task.enabled ? 'Pause' : 'Resume'}
            className="text-muted hover:text-primary transition-colors p-1"
          >
            {task.enabled ? (
              // Pause icon
              <svg width="10" height="11" viewBox="0 0 10 11" fill="currentColor">
                <rect x="1" y="1.5" width="3" height="8" />
                <rect x="6" y="1.5" width="3" height="8" />
              </svg>
            ) : (
              // Play icon (resume)
              <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor">
                <path d="M2 1.5L9.5 5.5L2 9.5V1.5Z" />
              </svg>
            )}
          </button>

          {/* Delete */}
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            title="Delete"
            className="text-muted hover:text-[#FF5061] transition-colors p-1"
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor">
              <path d="M1 1L8 8M8 1L1 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 pt-0.5 border-t border-border-subtle bg-white/[0.01]" onClick={e => e.stopPropagation()}>
          {task.prompt && (
            <div className="mb-2">
              <div className="text-muted text-[9px] uppercase tracking-widest mb-1">Original task text</div>
              <div className="text-secondary text-[11px] leading-relaxed whitespace-pre-wrap break-words">
                {task.prompt}
              </div>
            </div>
          )}
          {task.description && (
            <p className="text-secondary text-[10px] mb-2 leading-relaxed opacity-70">{task.description}</p>
          )}
          {task.cronExpr && (
            <div className="text-muted text-[10px] font-mono mb-2">{task.cronExpr}</div>
          )}

          {/* Prompt preview */}
          <div className="mb-2">
            <div className="text-muted text-[9px] uppercase tracking-widest mb-1">Prompt</div>
            <div className="text-[#5e5e6a] text-[10px] leading-relaxed line-clamp-3 font-mono break-words whitespace-pre-wrap">
              {task.prompt}
            </div>
          </div>

          {/* Recent runs */}
          {runs === undefined ? (
            <div className="text-muted text-[10px]">Loading runs...</div>
          ) : runs.length === 0 ? (
            <div className="text-muted text-[10px] italic">No runs yet</div>
          ) : (
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="text-muted text-[9px] uppercase tracking-widest">Recent runs</div>
                <div className="text-muted text-[9px] font-mono opacity-70">
                  {completedRuns.length} completed
                </div>
              </div>
              <div className="space-y-0.5">
                {runs.slice(0, 5).map(run => (
                  <RunRow key={run.id} run={run} onOpen={onOpenConversation} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TasksDrawer({ onLoadConversation }: { onLoadConversation: (id: string) => void }) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [taskRuns, setTaskRuns] = useState<Map<number, TaskRun[]>>(new Map());
  const [runningNow, setRunningNow] = useState<Set<number>>(new Set());

  const loadTasks = useCallback(async () => {
    try {
      const list = await api.tasks.list();
      const nextTasks = list || [];
      setTasks(nextTasks);

      const runsByTask = await Promise.all(nextTasks.map(async (task: ScheduledTask) => {
        try {
          const runs = await api.tasks.runs(task.id);
          return [task.id, runs || []] as const;
        } catch {
          return [task.id, []] as const;
        }
      }));
      setTaskRuns(new Map(runsByTask));
    } catch (err) {
      console.error('[TasksDrawer] Failed to load tasks:', err);
      setTasks([]);
      setTaskRuns(new Map());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Refresh runs for any expanded task when a task completes
  useEffect(() => {
    if (!api?.tasks?.onRunStarted || !api?.tasks?.onRunComplete) return;

    const refreshTaskRuns = (taskId: number) => {
      api.tasks.runs(taskId).then((runs: TaskRun[]) => {
        setTaskRuns(prev => new Map(prev).set(taskId, runs || []));
      }).catch(() => {});
    };

    const unsubscribeStarted = api.tasks.onRunStarted((payload: { taskId: number }) => {
      setRunningNow(prev => new Set(prev).add(payload.taskId));
      refreshTaskRuns(payload.taskId);
    });

    const unsubscribeCompleted = api.tasks.onRunComplete((payload: { taskId: number }) => {
      setRunningNow(prev => {
        const next = new Set(prev);
        next.delete(payload.taskId);
        return next;
      });
      refreshTaskRuns(payload.taskId);
    });

    return () => {
      unsubscribeStarted();
      unsubscribeCompleted();
    };
  }, []);

  const loadRuns = useCallback(async (taskId: number) => {
    try {
      const runs = await api.tasks.runs(taskId);
      setTaskRuns(prev => new Map(prev).set(taskId, runs || []));
    } catch {
      setTaskRuns(prev => new Map(prev).set(taskId, []));
    }
  }, []);

  const handleToggleExpand = useCallback((id: number) => {
    setExpandedId(prev => {
      const next = prev === id ? null : id;
      return next;
    });
    // Load runs only when expanding (id not currently expanded = we're opening it)
    if (expandedId !== id && !taskRuns.has(id)) {
      loadRuns(id);
    }
  }, [expandedId, taskRuns, loadRuns]);

  const handleEnable = useCallback(async (id: number, enabled: boolean) => {
    try {
      await api.tasks.enable(id, enabled);
      setTasks(prev => prev.map(t => t.id === id ? { ...t, enabled } : t));
    } catch (err) {
      console.error('[TasksDrawer] Failed to toggle task:', err);
    }
  }, []);

  const handleDelete = useCallback(async (id: number) => {
    try {
      await api.tasks.delete(id);
      setTasks(prev => prev.filter(t => t.id !== id));
      setTaskRuns(prev => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      if (expandedId === id) setExpandedId(null);
    } catch (err) {
      console.error('[TasksDrawer] Failed to delete task:', err);
    }
  }, [expandedId]);

  const handleRunNow = useCallback(async (id: number) => {
    if (runningNow.has(id)) return;
    setRunningNow(prev => new Set(prev).add(id));
    try {
      await api.tasks.runNow(id);
      loadRuns(id);
    } catch (err) {
      console.error('[TasksDrawer] Failed to run task now:', err);
      setRunningNow(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  }, [runningNow, loadRuns]);

  const handleCreated = useCallback((task: ScheduledTask) => {
    setTasks(prev => [...prev, task]);
    setShowCreate(false);
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border flex-shrink-0">
        <span className="text-muted text-[10px] uppercase tracking-widest font-mono">Automations</span>
        <button
          onClick={() => setShowCreate(v => !v)}
          className="text-tertiary hover:text-primary transition-colors text-[16px] leading-none w-5 h-5 flex items-center justify-center"
          title="New automation"
        >
          +
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="flex-shrink-0">
          <CreateForm
            onCreated={handleCreated}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      )}

      {/* Task list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-16">
            <span className="text-muted text-[11px] font-mono">Loading...</span>
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex items-center justify-center h-24">
            <span className="text-muted text-[11px] italic">No automations yet</span>
          </div>
        ) : (
          <div>
            {tasks.map(task => (
              <TaskRow
                key={task.id}
                task={task}
                expanded={expandedId === task.id}
                runs={taskRuns.get(task.id)}
                onToggleExpand={() => handleToggleExpand(task.id)}
                onOpenConversation={onLoadConversation}
                onEnable={(enabled) => handleEnable(task.id, enabled)}
                onDelete={() => handleDelete(task.id)}
                onRunNow={() => handleRunNow(task.id)}
                runningNow={runningNow.has(task.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

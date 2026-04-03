import React, { useState, useEffect, useCallback } from 'react';
import type { ProcessInfo, RunApproval, RunArtifact, RunChange, RunEvent, RunHumanIntervention, RunSummary, WorkflowStage } from '../../shared/types';
import { PROVIDERS, getModelById } from '../../shared/model-registry';

interface ProcessesPanelProps {
  onBack: () => void;
  onAttach: (conversationId: string, buffer?: Array<{ type: string; data: any }> | null) => void;
  initialRunId?: string | null;
}

function StatusBadge({ status }: { status: ProcessInfo['status'] }) {
  const config = {
    running: { color: 'text-blue-400', bg: 'bg-blue-400/10', label: 'Running', pulse: true },
    awaiting_approval: { color: 'text-text-primary', bg: 'bg-white/[0.06]', label: 'Awaiting Approval', pulse: false },
    needs_human: { color: 'text-text-primary', bg: 'bg-white/[0.08]', label: 'Needs Human', pulse: true },
    completed: { color: 'text-[#ff7a00]', bg: 'bg-[#ff7a00]/12', label: 'Done', pulse: false },
    failed: { color: 'text-red-400', bg: 'bg-red-400/10', label: 'Failed', pulse: false },
    cancelled: { color: 'text-text-muted', bg: 'bg-white/[0.04]', label: 'Cancelled', pulse: false },
  }[status];

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-2xs font-medium ${config.color} ${config.bg}`}>
      {config.pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-current" />
        </span>
      )}
      {config.label}
    </span>
  );
}

function formatDuration(startedAt: number, completedAt?: number): string {
  const end = completedAt || Date.now();
  const secs = Math.floor((end - startedAt) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remaining = secs % 60;
  return `${mins}m ${remaining}s`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatEventLabel(event: RunEvent): string {
  switch (event.kind) {
    case 'graph_execution_started': return 'Graph execution started';
    case 'graph_node_started': return `Graph node started: ${event.payload.label || event.payload.nodeId || 'node'}`;
    case 'graph_node_completed': return `Graph node completed: ${event.payload.label || event.payload.nodeId || 'node'}`;
    case 'graph_node_retry_scheduled': return `Graph node retry scheduled: ${event.payload.nodeId || 'node'}`;
    case 'graph_verification_completed': return `Graph verification ${event.payload.passed ? 'passed' : 'completed'}`;
    case 'graph_execution_fallback': return 'Graph execution fell back';
    case 'graph_merge_started': return 'Graph merge started';
    case 'graph_merge_completed': return 'Graph merge completed';
    case 'run_started': return 'Run started';
    case 'run_classified': return `Classified as ${event.payload.toolGroup || 'task'}`;
    case 'model_selected': return `Model selected: ${event.payload.modelId || 'unknown'}`;
    case 'preflight_completed': return `Preflight complete${event.payload.selectedSurface ? ` (${event.payload.selectedSurface})` : ''}`;
    case 'workflow_stage_changed': return `Workflow stage: ${formatWorkflowStage(event.payload.workflowStage) || event.payload.workflowStage || 'updated'}`;
    case 'workflow_plan_created': return 'Execution plan created';
    case 'workflow_plan_failed': return 'Execution plan failed';
    case 'workflow_plan_denied': return 'Execution plan denied';
    case 'thinking': return 'Thinking';
    case 'tool_started': return `${event.toolName || 'Tool'} started`;
    case 'tool_progress': return `${event.toolName || 'Tool'} progress`;
    case 'tool_completed': return `${event.toolName || 'Tool'} completed`;
    case 'tool_failed': return `${event.toolName || 'Tool'} failed`;
    case 'tool_escalated': return 'Tool set escalated';
    case 'context_injected': return 'User context injected';
    case 'run_detached': return 'Detached to background';
    case 'run_attached': return 'Reattached';
    case 'run_paused': return 'Run paused';
    case 'run_resumed': return 'Run resumed';
    case 'approval_requested': return 'Approval requested';
    case 'approval_resolved': return 'Approval resolved';
    case 'human_intervention_requested': return 'Human intervention requested';
    case 'human_intervention_resolved': return 'Human intervention resolved';
    case 'file_lock_acquired': return 'File lock acquired';
    case 'file_lock_conflict': return 'File conflict detected';
    case 'file_lock_released': return 'File lock released';
    case 'browser_mode_changed': return 'Browser mode changed';
    case 'assistant_response': return 'Assistant response produced';
    case 'recovery_started': return 'Recovery started';
    case 'recovery_completed': return 'Recovery completed';
    case 'verification_summary': return 'Verification summary';
    case 'run_completed': return 'Run completed';
    case 'run_failed': return 'Run failed';
    case 'run_cancelled': return 'Run cancelled';
    default: return event.kind.replace(/_/g, ' ');
  }
}

function formatEventDetail(event: RunEvent): string {
  if (event.kind === 'graph_execution_started') {
    const workers = Array.isArray(event.payload.workerNodeIds) ? event.payload.workerNodeIds.length : 0;
    return `${workers} worker node${workers === 1 ? '' : 's'} planned`;
  }
  if (event.kind === 'graph_node_started' || event.kind === 'graph_node_completed') {
    const attempt = event.payload.attempt ? `Attempt ${event.payload.attempt}` : '';
    const tools = Array.isArray(event.payload.toolCalls) && event.payload.toolCalls.length > 0
      ? event.payload.toolCalls.join(', ')
      : '';
    return [attempt, tools].filter(Boolean).join(' · ');
  }
  if (event.kind === 'graph_node_retry_scheduled') {
    const failedChecks = Array.isArray(event.payload.failedChecks) ? event.payload.failedChecks : [];
    return failedChecks.slice(0, 3).map((check: any) => `${check.name}: ${check.detail}`).join(' · ');
  }
  if (event.kind === 'graph_verification_completed') {
    const failedNodeIds = Array.isArray(event.payload.failedNodeIds) ? event.payload.failedNodeIds : [];
    return [
      event.payload.retryRecommended ? 'Retry recommended' : event.payload.passed ? 'All checks passed' : 'Verification failed',
      failedNodeIds.length ? `Failed nodes: ${failedNodeIds.join(', ')}` : '',
      event.payload.afterRetry ? 'After retry' : '',
    ].filter(Boolean).join(' · ');
  }
  if (event.kind === 'graph_execution_fallback') {
    const failedNodeIds = Array.isArray(event.payload.failedNodeIds) ? event.payload.failedNodeIds : [];
    return failedNodeIds.length ? `Failed nodes: ${failedNodeIds.join(', ')}` : 'Graph path returned to the classic loop';
  }
  if (event.kind === 'graph_merge_started' || event.kind === 'graph_merge_completed') {
    return [
      event.payload.mergeNodeId ? `Merge node: ${event.payload.mergeNodeId}` : '',
      event.payload.responseLength ? `${event.payload.responseLength} chars` : '',
    ].filter(Boolean).join(' · ');
  }
  if (event.kind === 'tool_progress') {
    const chunk = String(event.payload.chunk || '').trim();
    return chunk ? chunk.slice(0, 180) : 'Streaming output';
  }
  if (event.kind === 'tool_started' || event.kind === 'tool_completed' || event.kind === 'tool_failed') {
    return String(event.payload.detail || event.payload.resultPreview || '').slice(0, 180);
  }
  if (event.kind === 'run_failed' || event.kind === 'run_completed' || event.kind === 'run_cancelled') {
    return String(event.payload.error || '').slice(0, 180);
  }
  if (event.kind === 'assistant_response') {
    return String(event.payload.text || '').slice(0, 180);
  }
  if (event.kind === 'workflow_plan_created') {
    return String(event.payload.preview || '').slice(0, 180);
  }
  if (event.kind === 'workflow_plan_failed') {
    return String(event.payload.message || '').slice(0, 180);
  }
  if (event.kind === 'workflow_plan_denied') {
    return 'The run stopped before execution because the plan was denied.';
  }
  if (event.kind === 'context_injected') {
    return String(event.payload.text || '').slice(0, 180);
  }
  if (event.kind === 'recovery_started') {
    return String(event.payload.issue || '').slice(0, 180);
  }
  if (event.kind === 'approval_requested' || event.kind === 'approval_resolved') {
    return String(event.payload.summary || event.payload.reason || '').slice(0, 180);
  }
  if (event.kind === 'human_intervention_requested' || event.kind === 'human_intervention_resolved') {
    return String(event.payload.summary || event.payload.instructions || '').slice(0, 180);
  }
  if (event.kind === 'file_lock_conflict') {
    return String(event.payload.summary || event.payload.path || '').slice(0, 180);
  }
  if (event.kind === 'file_lock_acquired' || event.kind === 'file_lock_released') {
    return String(event.payload.path || '').slice(0, 180);
  }
  if (event.kind === 'browser_mode_changed') {
    const mode = String(event.payload.mode || event.payload.to || '').trim();
    const reason = String(event.payload.reason || '').trim();
    return `${mode}${reason ? ` · ${reason}` : ''}`.trim();
  }
  return '';
}

function parseGraphStateArtifact(artifact: RunArtifact): any | null {
  if (artifact.kind !== 'execution_graph_state') return null;
  try {
    return JSON.parse(artifact.body);
  } catch {
    return null;
  }
}

function GraphStateArtifactView({ artifact }: { artifact: RunArtifact }) {
  const snapshot = parseGraphStateArtifact(artifact);
  if (!snapshot) {
    return (
      <pre className="mt-3 overflow-x-auto rounded-lg border border-white/[0.04] bg-[#0a0a0a] px-3 py-2 font-mono text-[11px] leading-[1.55] text-text-secondary whitespace-pre-wrap">
        {artifact.body}
      </pre>
    );
  }

  const statusTone = snapshot.status === 'merged'
    ? 'text-[#ff7a00] bg-[#ff7a00]/12'
    : snapshot.status === 'fallback'
      ? 'text-red-300 bg-red-400/10'
      : 'text-blue-300 bg-blue-400/10';

  return (
    <div className="mt-3 rounded-lg border border-white/[0.04] bg-[#0a0a0a] px-3 py-3">
      <div className="flex flex-wrap items-center gap-2 text-2xs text-text-secondary">
        <span className={`px-2 py-1 rounded-md ${statusTone}`}>{snapshot.status}</span>
        <span className="px-2 py-1 rounded-md bg-white/[0.04]">{snapshot.nodeCount} nodes</span>
        {snapshot.verification && (
          <span className="px-2 py-1 rounded-md bg-white/[0.04]">
            verification: {snapshot.verification.passed ? 'passed' : snapshot.verification.retryRecommended ? 'retrying' : 'failed'}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {(snapshot.nodes || []).map((node: any) => (
          <div key={node.nodeId} className="rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] text-text-primary">{node.label}</div>
                <div className="mt-1 text-2xs text-text-muted">
                  {node.executorKind} · {node.contract} · attempt {node.attempt || 0}
                </div>
              </div>
              <span className="text-2xs px-2 py-0.5 rounded-full bg-white/[0.06] text-text-secondary">
                {node.status}
              </span>
            </div>

            {Array.isArray(node.toolCalls) && node.toolCalls.length > 0 && (
              <div className="mt-2 text-[12px] text-text-secondary break-words">
                Tools: {node.toolCalls.join(', ')}
              </div>
            )}

            {Array.isArray(node.verificationErrors) && node.verificationErrors.length > 0 && (
              <div className="mt-2 text-[12px] text-red-300 whitespace-pre-wrap break-words">
                {node.verificationErrors.join('\n')}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatProviderModel(provider?: string, model?: string): string | null {
  if (!provider && !model) return null;
  const providerLabel = provider ? (PROVIDERS.find((item) => item.id === provider)?.label || provider) : null;
  const modelLabel = model ? (getModelById(model)?.label || model) : null;
  return [providerLabel, modelLabel].filter(Boolean).join(' · ');
}

function formatWorkflowStage(stage?: WorkflowStage): string | null {
  if (!stage) return null;
  return {
    starting: 'Starting',
    planning: 'Planning',
    executing: 'Executing',
    reviewing: 'Reviewing',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  }[stage] || stage;
}

function ProcessCard({
  process,
  onOpenRun,
  onAttach,
  onCancel,
  onDismiss,
}: {
  process: ProcessInfo;
  onOpenRun: () => void;
  onAttach: () => void;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const isActive = process.status === 'running' || process.status === 'awaiting_approval' || process.status === 'needs_human';
  const isDone = !isActive;

  return (
    <div
      className={`
        group rounded-xl border transition-all duration-150
        ${process.isAttached
          ? 'border-blue-500/30 bg-blue-500/[0.04]'
          : 'border-white/[0.04] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.08]'
        }
      `}
    >
      <button
        onClick={onOpenRun}
        className="w-full text-left px-3.5 py-3 cursor-pointer"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] text-text-primary leading-snug line-clamp-2">
            {process.summary}
          </p>
          <StatusBadge status={process.status} />
        </div>

        <div className="flex items-center gap-3 mt-2 text-2xs text-text-muted">
          <span>{formatTime(process.startedAt)}</span>
          <span>·</span>
          {formatProviderModel(process.provider, process.model) && (
            <>
              <span>{formatProviderModel(process.provider, process.model)}</span>
              <span>·</span>
            </>
          )}
          {formatWorkflowStage(process.workflowStage) && (
            <>
              <span>{formatWorkflowStage(process.workflowStage)}</span>
              <span>·</span>
            </>
          )}
          <span>{process.toolCallCount} tools</span>
          <span>·</span>
          <span>{formatDuration(process.startedAt, process.completedAt)}</span>
        </div>

        {process.error && (
          <p className="mt-1.5 text-2xs text-red-400/80 line-clamp-1">{process.error}</p>
        )}
      </button>

      <div className={`flex items-center gap-1 px-3 pb-2.5 ${isDone ? '' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
        {isActive && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); onAttach(); }}
              className="text-2xs px-2 py-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              Open chat
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onCancel(); }}
              className="text-2xs px-2 py-1 rounded-md text-red-400/70 hover:text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </>
        )}
        {isDone && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); onAttach(); }}
              className="text-2xs px-2 py-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              Open chat
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDismiss(); }}
              className="text-2xs px-2 py-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function RunDetail({
  run,
  events,
  changes,
  artifacts,
  approvals,
  humanInterventions,
  onBack,
  onOpenConversation,
  onApprove,
  onDeny,
}: {
  run: RunSummary;
  events: RunEvent[];
  changes: RunChange[];
  artifacts: RunArtifact[];
  approvals: RunApproval[];
  humanInterventions: RunHumanIntervention[];
  onBack: () => void;
  onOpenConversation: () => void;
  onApprove: (approvalId: number) => Promise<void>;
  onDeny: (approvalId: number) => Promise<void>;
}) {
  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 px-4 h-[44px] flex-shrink-0 border-b border-border-subtle">
        <button
          onClick={onBack}
          className="flex items-center justify-center w-7 h-7 rounded-md text-text-muted hover:text-text-secondary hover:bg-white/[0.06] transition-colors cursor-pointer"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="text-[13px] font-semibold tracking-[0.04em] text-text-secondary">Run Detail</span>
        <div className="ml-auto flex items-center gap-2">
          <StatusBadge status={run.status} />
          <button
            onClick={onOpenConversation}
            className="text-2xs px-2.5 py-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            Open chat
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 mb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-text-primary">{run.title}</h2>
              <p className="mt-1 text-xs text-text-secondary leading-relaxed">{run.goal}</p>
            </div>
            <div className="text-right text-2xs text-text-muted">
              <div>{formatDateTime(run.startedAt)}</div>
              <div className="mt-1">{formatDuration(run.startedAt, run.completedAt)}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-4 text-2xs text-text-secondary">
            <span className="px-2 py-1 rounded-md bg-white/[0.04]">{run.toolCallCount} tools</span>
            <span className="px-2 py-1 rounded-md bg-white/[0.04]">{events.length} events</span>
            <span className="px-2 py-1 rounded-md bg-white/[0.04]">{changes.length} changes</span>
            <span className="px-2 py-1 rounded-md bg-white/[0.04]">{artifacts.length} artifacts</span>
            <span className="px-2 py-1 rounded-md bg-white/[0.04]">{approvals.length} approvals</span>
            <span className="px-2 py-1 rounded-md bg-white/[0.04]">{humanInterventions.length} human steps</span>
            {formatProviderModel(run.provider, run.model) && <span className="px-2 py-1 rounded-md bg-white/[0.04]">{formatProviderModel(run.provider, run.model)}</span>}
            {formatWorkflowStage(run.workflowStage) && <span className="px-2 py-1 rounded-md bg-white/[0.04]">{formatWorkflowStage(run.workflowStage)}</span>}
            {run.wasDetached && <span className="px-2 py-1 rounded-md bg-white/[0.04]">Detached</span>}
            {run.error && <span className="px-2 py-1 rounded-md bg-red-400/10 text-red-300">{run.error}</span>}
          </div>
        </div>

        <div className="mb-5">
          <h3 className="text-2xs font-medium text-text-muted uppercase tracking-wider mb-2">Workflow Artifacts</h3>
          <div className="flex flex-col gap-2">
            {artifacts.length === 0 && (
              <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-4 text-sm text-text-muted">
                No workflow artifacts recorded for this run yet.
              </div>
            )}

            {artifacts.map(artifact => (
              <div key={artifact.id} className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3.5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] text-text-primary">{artifact.title}</div>
                    <div className="mt-1 text-2xs text-text-muted">{artifact.kind.replace(/_/g, ' ')}</div>
                  </div>
                  <div className="text-2xs text-text-muted flex-shrink-0">
                    {new Date(artifact.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                  </div>
                </div>

                {artifact.kind === 'execution_graph_state' ? (
                  <GraphStateArtifactView artifact={artifact} />
                ) : (
                  <pre className="mt-3 overflow-x-auto rounded-lg border border-white/[0.04] bg-[#0a0a0a] px-3 py-2 font-mono text-[11px] leading-[1.55] text-text-secondary whitespace-pre-wrap">
                    {artifact.body}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mb-5">
          <h3 className="text-2xs font-medium text-text-muted uppercase tracking-wider mb-2">Human Intervention</h3>
          <div className="flex flex-col gap-2">
            {humanInterventions.length === 0 && (
              <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-4 text-sm text-text-muted">
                No human intervention checkpoints recorded for this run.
              </div>
            )}

            {humanInterventions.map(intervention => (
              <div key={intervention.id} className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3.5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] text-text-primary">{intervention.summary}</div>
                    <div className="mt-1 text-2xs text-text-muted">
                      {intervention.interventionType}{intervention.target ? ` · ${intervention.target}` : ''}
                    </div>
                    {intervention.instructions && (
                      <div className="mt-2 text-[12px] text-text-secondary whitespace-pre-wrap break-words">
                        {intervention.instructions}
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={`text-2xs ${
                      intervention.status === 'pending'
                        ? 'text-text-primary'
                        : intervention.status === 'resolved'
                          ? 'text-text-secondary'
                          : 'text-text-muted'
                    }`}>
                      {intervention.status === 'pending' ? 'Pending' : intervention.status === 'resolved' ? 'Resolved' : 'Dismissed'}
                    </div>
                    <div className="mt-1 text-2xs text-text-muted">
                      {new Date(intervention.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mb-5">
          <h3 className="text-2xs font-medium text-text-muted uppercase tracking-wider mb-2">Approvals</h3>
          <div className="flex flex-col gap-2">
            {approvals.length === 0 && (
              <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-4 text-sm text-text-muted">
                No approval checkpoints recorded for this run.
              </div>
            )}

            {approvals.map(approval => (
              <div key={approval.id} className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3.5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] text-text-primary">{approval.summary}</div>
                    <div className="mt-1 text-2xs text-text-muted">{approval.actionType} · {approval.target}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={`text-2xs ${
                      approval.status === 'pending'
                        ? 'text-text-primary'
                        : approval.status === 'approved'
                          ? 'text-text-secondary'
                          : 'text-text-muted'
                    }`}>
                      {approval.status === 'pending' ? 'Pending' : approval.status === 'approved' ? 'Approved' : 'Denied'}
                    </div>
                    <div className="mt-1 text-2xs text-text-muted">
                      {new Date(approval.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                    </div>
                  </div>
                </div>

                {approval.status === 'pending' && (
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => onApprove(approval.id)}
                      className="text-2xs px-2.5 py-1 rounded-md bg-white/[0.07] text-text-primary hover:bg-white/[0.1] transition-colors cursor-pointer"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => onDeny(approval.id)}
                      className="text-2xs px-2.5 py-1 rounded-md bg-white/[0.04] text-text-secondary hover:bg-white/[0.08] hover:text-text-primary transition-colors cursor-pointer"
                    >
                      Deny
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mb-5">
          <h3 className="text-2xs font-medium text-text-muted uppercase tracking-wider mb-2">Changes</h3>
          <div className="flex flex-col gap-2">
            {changes.length === 0 && (
              <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-4 text-sm text-text-muted">
                No structured file changes captured for this run yet.
              </div>
            )}

            {changes.map(change => (
              <div key={change.id} className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3.5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] text-text-primary">{change.summary}</div>
                    <div className="mt-1 text-2xs text-text-muted">{change.changeType} · {change.target}</div>
                  </div>
                  <div className="text-2xs text-text-muted flex-shrink-0">
                    {new Date(change.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                  </div>
                </div>

                {change.diffText && (
                  <pre className="mt-3 overflow-x-auto rounded-lg border border-white/[0.04] bg-[#0a0a0a] px-3 py-2 font-mono text-[11px] leading-[1.55] text-text-secondary whitespace-pre-wrap">
                    {change.diffText}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-2xs font-medium text-text-muted uppercase tracking-wider mb-2">Timeline</h3>
          <div className="flex flex-col gap-2">
            {events.length === 0 && (
              <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-4 text-sm text-text-muted">
                No durable events recorded for this run yet.
              </div>
            )}

            {events.map(event => {
              const detail = formatEventDetail(event);
              return (
                <div key={event.id} className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3.5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] text-text-primary">{formatEventLabel(event)}</div>
                      <div className="mt-1 text-2xs text-text-muted">
                        {event.phase || 'event'}
                        {event.surface ? ` · ${event.surface}` : ''}
                        {event.toolName ? ` · ${event.toolName}` : ''}
                      </div>
                      {detail && (
                        <div className="mt-2 text-[12px] text-text-secondary whitespace-pre-wrap break-words">
                          {detail}
                        </div>
                      )}
                    </div>
                    <div className="text-2xs text-text-muted flex-shrink-0">
                      {new Date(event.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProcessesPanel({ onBack, onAttach, initialRunId }: ProcessesPanelProps) {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [selectedRun, setSelectedRun] = useState<RunSummary | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<RunEvent[]>([]);
  const [selectedArtifacts, setSelectedArtifacts] = useState<RunArtifact[]>([]);
  const [selectedChanges, setSelectedChanges] = useState<RunChange[]>([]);
  const [selectedApprovals, setSelectedApprovals] = useState<RunApproval[]>([]);
  const [selectedHumanInterventions, setSelectedHumanInterventions] = useState<RunHumanIntervention[]>([]);

  useEffect(() => {
    const api = (window as any).clawdia;
    if (!api) return;

    api.process.list().then(setProcesses).catch(() => {});
    const cleanup = api.process.onListChanged((updated: ProcessInfo[]) => {
      setProcesses(updated);
      if (selectedRun) {
        const match = updated.find((p: ProcessInfo) => p.id === selectedRun.id);
            if (match) {
              setSelectedRun(prev => prev ? {
                ...prev,
                status: match.status,
                startedAt: match.startedAt,
                completedAt: match.completedAt,
                toolCallCount: match.toolCallCount,
                error: match.error,
                wasDetached: match.wasDetached,
                provider: match.provider,
                model: match.model,
                workflowStage: match.workflowStage,
              } : prev);
            }
          }
    });
    return cleanup;
  }, [selectedRun]);

  const loadRunDetail = useCallback(async (runId: string) => {
    const api = (window as any).clawdia;
    if (!api?.run) return;

    const [run, events, artifacts, changes, approvals, humanInterventions] = await Promise.all([
      api.run.get(runId),
      api.run.events(runId),
      api.run.artifacts(runId),
      api.run.changes(runId),
      api.run.approvals(runId),
      api.run.humanInterventions(runId),
    ]);

    if (run) {
      setSelectedRun(run);
      setSelectedEvents(events || []);
      setSelectedArtifacts(artifacts || []);
      setSelectedChanges(changes || []);
      setSelectedApprovals(approvals || []);
      setSelectedHumanInterventions(humanInterventions || []);
    }
  }, []);

  useEffect(() => {
    if (initialRunId) {
      loadRunDetail(initialRunId);
    }
  }, [initialRunId, loadRunDetail]);

  const handleAttach = useCallback(async (proc: ProcessInfo) => {
    const api = (window as any).clawdia;
    if (!api) return;

    if (proc.status === 'running' || proc.status === 'awaiting_approval' || proc.status === 'needs_human') {
      const result = await api.process.attach(proc.id);
      if (result.ok) onAttach(proc.conversationId, result.buffer || null);
      return;
    }

    onAttach(proc.conversationId);
  }, [onAttach]);

  const handleCancel = useCallback(async (processId: string) => {
    const api = (window as any).clawdia;
    if (api) await api.process.cancel(processId);
  }, []);

  const handleDismiss = useCallback(async (processId: string) => {
    const api = (window as any).clawdia;
    if (!api) return;
    await api.process.dismiss(processId);
    setProcesses(prev => prev.filter(p => p.id !== processId));
    if (selectedRun?.id === processId) {
      setSelectedRun(null);
      setSelectedEvents([]);
      setSelectedChanges([]);
      setSelectedApprovals([]);
      setSelectedHumanInterventions([]);
    }
  }, [selectedRun]);

  const handleApprovalDecision = useCallback(async (approvalId: number, decision: 'approve' | 'deny') => {
    const api = (window as any).clawdia;
    if (!api?.run || !selectedRun) return;

    if (decision === 'approve') await api.run.approve(approvalId);
    else await api.run.deny(approvalId);

    await loadRunDetail(selectedRun.id);
  }, [loadRunDetail, selectedRun]);

  const running = processes.filter(p => p.status === 'running' || p.status === 'awaiting_approval' || p.status === 'needs_human');
  const completed = processes.filter(p => p.status !== 'running' && p.status !== 'awaiting_approval' && p.status !== 'needs_human');

  if (selectedRun) {
    return (
      <div className="flex flex-col h-full bg-surface-0">
        <RunDetail
          run={selectedRun}
          events={selectedEvents}
          onBack={() => {
            setSelectedRun(null);
            setSelectedEvents([]);
            setSelectedChanges([]);
            setSelectedApprovals([]);
            setSelectedHumanInterventions([]);
          }}
          onOpenConversation={() => onAttach(selectedRun.conversationId)}
        changes={selectedChanges}
        artifacts={selectedArtifacts}
        approvals={selectedApprovals}
          humanInterventions={selectedHumanInterventions}
          onApprove={(approvalId) => handleApprovalDecision(approvalId, 'approve')}
          onDeny={(approvalId) => handleApprovalDecision(approvalId, 'deny')}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface-0">
      <header className="drag-region flex items-center gap-2 px-4 h-[44px] flex-shrink-0 border-b border-border-subtle">
        <button
          onClick={onBack}
          className="no-drag flex items-center justify-center w-7 h-7 rounded-md text-text-muted hover:text-text-secondary hover:bg-white/[0.06] transition-colors cursor-pointer"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="text-[13px] font-semibold tracking-[0.04em] text-text-secondary">Runs</span>
        {running.length > 0 && (
          <span className="ml-auto text-2xs text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-full">
            {running.length} running
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {processes.length === 0 && (
          <div className="flex flex-col items-center justify-center h-[50vh] text-text-muted">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="opacity-20 mb-3">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            <span className="text-sm text-text-muted/50">No runs yet</span>
            <span className="text-xs text-text-muted/30 mt-1">Send a task, then review it here</span>
          </div>
        )}

        {running.length > 0 && (
          <div className="mb-4">
            <h3 className="text-2xs font-medium text-text-muted uppercase tracking-wider mb-2 px-1">Running</h3>
            <div className="flex flex-col gap-2">
              {running.map(proc => (
                <ProcessCard
                  key={proc.id}
                  process={proc}
                  onOpenRun={() => loadRunDetail(proc.id)}
                  onAttach={() => handleAttach(proc)}
                  onCancel={() => handleCancel(proc.id)}
                  onDismiss={() => handleDismiss(proc.id)}
                />
              ))}
            </div>
          </div>
        )}

        {completed.length > 0 && (
          <div>
            <h3 className="text-2xs font-medium text-text-muted uppercase tracking-wider mb-2 px-1">Completed</h3>
            <div className="flex flex-col gap-2">
              {completed.map(proc => (
                <ProcessCard
                  key={proc.id}
                  process={proc}
                  onOpenRun={() => loadRunDetail(proc.id)}
                  onAttach={() => handleAttach(proc)}
                  onCancel={() => handleCancel(proc.id)}
                  onDismiss={() => handleDismiss(proc.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

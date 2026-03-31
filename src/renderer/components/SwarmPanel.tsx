import React, { useEffect, useState } from 'react';
import type { SwarmState, SwarmAgent, SwarmAgentStatus } from '../../shared/types';

const STATUS_DOT: Record<SwarmAgentStatus, string> = {
  queued:    'bg-white/20',
  running:   'bg-blue-400 animate-pulse',
  done:      'bg-emerald-400',
  failed:    'bg-red-400',
  cancelled: 'bg-white/20',
};

const STATUS_LABEL: Record<SwarmAgentStatus, string> = {
  queued:    'queued',
  running:   'working',
  done:      'done',
  failed:    'failed',
  cancelled: 'cancelled',
};

const STATUS_TEXT: Record<SwarmAgentStatus, string> = {
  queued:    'text-text-muted',
  running:   'text-blue-400',
  done:      'text-emerald-400',
  failed:    'text-red-400',
  cancelled: 'text-text-muted',
};

function AgentRow({ agent }: { agent: SwarmAgent }) {
  const durationMs = agent.completedAt && agent.startedAt
    ? agent.completedAt - agent.startedAt
    : agent.startedAt ? Date.now() - agent.startedAt : null;

  return (
    <div className="flex items-start gap-3 py-2 border-b border-white/[0.04] last:border-0">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[5px] ${STATUS_DOT[agent.status]}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-text-primary capitalize">{agent.role}</span>
          <span className={`text-[10px] uppercase tracking-wider ${STATUS_TEXT[agent.status]}`}>
            {STATUS_LABEL[agent.status]}
          </span>
          {durationMs !== null && agent.status === 'done' && (
            <span className="text-[10px] text-text-muted ml-auto">{(durationMs / 1000).toFixed(1)}s</span>
          )}
          {agent.toolCallCount > 0 && (
            <span className="text-[10px] text-text-muted ml-auto">{agent.toolCallCount} calls</span>
          )}
        </div>
        {agent.goal && (
          <div className="text-[11px] text-text-muted truncate mt-0.5">{agent.goal}</div>
        )}
        {agent.error && (
          <div className="text-[11px] text-red-400 truncate mt-0.5">{agent.error}</div>
        )}
      </div>
    </div>
  );
}

export default function SwarmPanel() {
  const [swarm, setSwarm] = useState<SwarmState | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const off = window.clawdia.swarm.onStateChanged((state: SwarmState) => {
      setSwarm(state);
      setExpanded(true);
      if (state.completedAt) {
        setTimeout(() => setExpanded(false), 4000);
        setTimeout(() => setSwarm(null), 8000);
      }
    });
    return off;
  }, []);

  if (!swarm) return null;

  const done = swarm.agents.filter(a => a.status === 'done' || a.status === 'failed' || a.status === 'cancelled').length;
  const running = swarm.agents.filter(a => a.status === 'running').length;
  const pct = Math.round((done / swarm.totalAgents) * 100);
  const isComplete = !!swarm.completedAt;

  return (
    <div className="mx-3 mb-2 rounded-xl border border-white/[0.08] bg-white/[0.025] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] overflow-hidden">
      {/* Header bar */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/[0.03] transition-colors cursor-pointer"
      >
        {/* Status indicator */}
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isComplete ? 'bg-emerald-400' : 'bg-blue-400 animate-pulse'}`} />

        <span className="text-[11px] uppercase tracking-widest text-text-muted font-mono flex-1 text-left">
          {isComplete
            ? `Swarm complete — ${swarm.totalAgents} agent${swarm.totalAgents !== 1 ? 's' : ''}`
            : `${running} of ${swarm.totalAgents} running`}
        </span>

        {/* Progress bar */}
        <div className="w-20 h-[3px] rounded-full bg-white/[0.08] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${isComplete ? 'bg-emerald-400' : 'bg-blue-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[10px] text-text-muted w-7 text-right font-mono">{pct}%</span>

        {/* Chevron */}
        <svg
          width="10" height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-text-muted flex-shrink-0 transition-transform"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          <polyline points="2,3 5,7 8,3" />
        </svg>
      </button>

      {/* Expanded agent list */}
      {expanded && (
        <div className="px-3 pb-2 max-h-64 overflow-y-auto">
          {swarm.agents.map(agent => (
            <AgentRow key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}

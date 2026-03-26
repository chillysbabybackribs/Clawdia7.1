// src/renderer/components/PipelineBlock.tsx
import { useState, useEffect } from 'react';
import type { SwarmState, SwarmAgent } from '../../shared/types';

function agentStatusDot(status: SwarmAgent['status']): React.ReactElement {
  const style: React.CSSProperties = {
    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
  };
  if (status === 'running') {
    return <span style={{ ...style, background: '#1A73E8', animation: 'pb-pulse 1.5s infinite' }} />;
  }
  if (status === 'done') {
    return <span style={{ ...style, background: 'rgba(255,255,255,0.2)' }} />;
  }
  if (status === 'failed') {
    return <span style={{ ...style, background: 'rgba(200,50,50,0.7)' }} />;
  }
  // queued / cancelled
  return <span style={{ ...style, background: 'rgba(255,255,255,0.08)' }} />;
}

function formatDuration(startedAt?: number, completedAt?: number): string {
  if (!startedAt) return '';
  const ms = (completedAt ?? Date.now()) - startedAt;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function AgentRow({ agent }: { agent: SwarmAgent }) {
  const isActive = agent.status === 'running';
  const isDone = agent.status === 'done';
  const isFailed = agent.status === 'failed';

  const rowStyle: React.CSSProperties = {
    padding: '7px 14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: isActive ? 'rgba(26,115,232,0.05)' : 'transparent',
  };

  const labelColor = isActive ? '#e0e0e4' : isDone ? '#6a6a7a' : isFailed ? '#b05050' : '#3a3a4a';
  const metaColor = isActive ? '#4d96f0' : isDone ? '#6a6a7a' : isFailed ? '#b05050' : '#3a3a4a';

  const meta = isFailed
    ? `failed${agent.error ? ` · ${agent.error.slice(0, 40)}` : ''}`
    : isDone
    ? `done · ${formatDuration(agent.startedAt, agent.completedAt)}${agent.toolCallCount > 0 ? ` · ${agent.toolCallCount} tools` : ''}`
    : isActive
    ? `${agent.toolCallCount > 0 ? `${agent.toolCallCount} tools` : '…'}`
    : 'waiting';

  return (
    <div style={rowStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {agentStatusDot(agent.status)}
        <span style={{ color: labelColor, fontSize: 11 }}>{agent.goal}</span>
      </div>
      <span style={{ color: metaColor, fontSize: 11, flexShrink: 0, marginLeft: 8 }}>{meta}</span>
    </div>
  );
}

export default function PipelineBlock() {
  const [state, setState] = useState<SwarmState | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const off = window.clawdia.swarm.onStateChanged((s: SwarmState) => {
      setState(s);
      if (!s.completedAt) setExpanded(true);
      else setExpanded(false);
    });
    return off;
  }, []);

  if (!state) return null;

  const isComplete = !!state.completedAt;
  const doneCount = state.agents.filter(a => a.status === 'done').length;
  const totalTools = state.agents.reduce((n, a) => n + a.toolCallCount, 0);
  const wallMs = state.completedAt ? state.completedAt - state.startedAt : Date.now() - state.startedAt;

  if (isComplete) {
    // Collapsed completed state
    return (
      <>
        <style>{`@keyframes pb-pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
        <div
          style={{
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 8,
            overflow: 'hidden',
            background: '#0f0f13',
            margin: '4px 0',
            cursor: 'pointer',
          }}
          onClick={() => setExpanded(e => !e)}
        >
          <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'inline-block' }} />
              <span style={{ color: '#6a6a7a', fontSize: 12 }}>Pipeline complete</span>
              <span style={{ color: '#3a3a4a', fontSize: 11 }}>
                · {state.agents.length} agents · {(wallMs / 1000).toFixed(1)}s{totalTools > 0 ? ` · ${totalTools} tools` : ''}
              </span>
            </div>
            <span style={{ color: '#3a3a4a', fontSize: 11 }}>{expanded ? '▾' : '▸'}</span>
          </div>
          {expanded && (
            <div style={{ maxHeight: 148, overflowY: 'auto', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              {state.agents.map(agent => <AgentRow key={agent.id} agent={agent} />)}
            </div>
          )}
        </div>
      </>
    );
  }

  // Running state
  return (
    <>
      <style>{`@keyframes pb-pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
      <div
        style={{
          border: '1px solid rgba(26,115,232,0.25)',
          borderRadius: 8,
          overflow: 'hidden',
          background: '#0f0f13',
          margin: '4px 0',
        }}
      >
        {/* Header */}
        <div
          style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}
          onClick={() => setExpanded(e => !e)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1A73E8', display: 'inline-block', animation: 'pb-pulse 1.5s infinite' }} />
            <span style={{ color: '#e0e0e4', fontSize: 12, fontWeight: 500 }}>Running pipeline</span>
            <span style={{ color: '#5a5a68', fontSize: 11 }}>· {state.agents.length} agents</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#5a5a68', fontSize: 11 }}>{doneCount} / {state.totalAgents} done</span>
            <span style={{ color: '#5a5a68', fontSize: 11 }}>{expanded ? '▾' : '▸'}</span>
          </div>
        </div>

        {/* Agent list */}
        {expanded && (
          <div style={{ maxHeight: 148, overflowY: 'auto' }}>
            {state.agents.map(agent => <AgentRow key={agent.id} agent={agent} />)}
          </div>
        )}
      </div>
    </>
  );
}

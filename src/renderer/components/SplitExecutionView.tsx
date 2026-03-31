/**
 * SplitExecutionView — shown during concurrent worker execution.
 *
 * Splits the chat area into two panes: top (Claude Code stream) and bottom
 * (Codex stream). Each pane scrolls independently. When execution ends, the
 * parent collapses this view back into the single chat feed.
 */

import React, { useEffect, useRef, useCallback } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import type { ConcurrentSubtask } from '../../shared/types';

interface WorkerStream {
  executor: 'claudeCode' | 'codex';
  label: string;
  text: string;
  done: boolean;
  failed: boolean;
}

interface SplitExecutionViewProps {
  streams: WorkerStream[];
  synthesizing: boolean;
}

const EXECUTOR_COLOR: Record<string, string> = {
  claudeCode: 'text-[#f4a35a]',
  codex: 'text-[#9ab8f7]',
};

const EXECUTOR_DOT: Record<string, string> = {
  claudeCode: 'bg-[#f4a35a]',
  codex: 'bg-[#9ab8f7]',
};

function StreamPane({ stream }: { stream: WorkerStream }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUp = useRef(false);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    isUserScrolledUp.current = !atBottom;
  }, []);

  // Auto-scroll to bottom as text streams in
  useEffect(() => {
    if (!isUserScrolledUp.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [stream.text]);

  const dotClass = EXECUTOR_DOT[stream.executor] ?? 'bg-white/30';
  const labelClass = EXECUTOR_COLOR[stream.executor] ?? 'text-text-muted';

  return (
    <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-2 flex-shrink-0 border-b border-white/[0.06]"
        style={{ background: '#111114' }}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass} ${!stream.done && !stream.failed ? 'animate-pulse' : ''}`}
        />
        <span className={`text-[10px] uppercase tracking-widest font-mono ${labelClass}`}>
          {stream.label}
        </span>
        {stream.done && (
          <span className="ml-auto text-[10px] text-emerald-400 font-mono uppercase tracking-wider">done</span>
        )}
        {stream.failed && (
          <span className="ml-auto text-[10px] text-red-400 font-mono uppercase tracking-wider">failed</span>
        )}
        {!stream.done && !stream.failed && (
          <span className="ml-auto text-[10px] text-text-muted font-mono uppercase tracking-wider animate-pulse">working</span>
        )}
      </div>

      {/* Stream content */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 text-text-primary"
        style={{ background: '#0e0e11' }}
      >
        {stream.text ? (
          <MarkdownRenderer content={stream.text} isStreaming={!stream.done && !stream.failed} />
        ) : (
          <div className="text-text-muted text-[12px] font-mono animate-pulse">Waiting for output…</div>
        )}
      </div>
    </div>
  );
}

export default function SplitExecutionView({ streams, synthesizing }: SplitExecutionViewProps) {
  // Partition streams: up to 2 panes side-by-side if widths allow, else stacked
  // We use a vertical split (top/bottom) as specified
  const panes = streams.slice(0, 2);
  const extraStreams = streams.slice(2);

  return (
    <div
      className="flex flex-col min-h-0 flex-1 overflow-hidden"
      style={{
        borderTop: '1px solid rgba(255,255,255,0.08)',
        animation: 'splitViewEnter 0.25s ease-out',
      }}
    >
      <style>{`
        @keyframes splitViewEnter {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Worker panes — divided vertically */}
      <div className="flex flex-col min-h-0 flex-1 divide-y divide-white/[0.06]">
        {panes.map((stream, i) => (
          <StreamPane key={stream.executor + i} stream={stream} />
        ))}
        {extraStreams.map((stream, i) => (
          <StreamPane key={stream.executor + 'extra' + i} stream={stream} />
        ))}
      </div>

      {/* Synthesis banner — shown when synthesis phase starts */}
      {synthesizing && (
        <div
          className="flex items-center gap-2 px-4 py-2 flex-shrink-0 border-t border-white/[0.08]"
          style={{ background: '#111114' }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-pulse flex-shrink-0" />
          <span className="text-[10px] uppercase tracking-widest font-mono text-text-muted">
            Synthesizing results…
          </span>
        </div>
      )}
    </div>
  );
}

export type { WorkerStream };

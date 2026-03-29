import React, { useState } from 'react';
import type { ToolCall } from '../../shared/types';

export interface ToolStreamMap {
  [toolId: string]: string[];
}

interface ToolActivityProps {
  tools: ToolCall[];
  streamMap?: ToolStreamMap;
  messageId?: string;
  onRateTool?: (toolId: string, rating: 'up' | 'down' | null, note?: string) => void;
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  shell_exec: 'Bash',
  bash: 'Bash',
  file_read: 'Read',
  file_write: 'Write',
  file_edit: 'Edit',
  file_list_directory: 'List',
  file_search: 'Search',
  directory_tree: 'List',
  browser_navigate: 'Navigate',
  browser_search: 'Search',
  browser_click: 'Click',
  browser_type: 'Type',
  browser_screenshot: 'Screenshot',
  browser_scroll: 'Scroll',
  browser_extract_text: 'Extract',
  browser_read_page: 'Read Page',
  memory_store: 'Memory',
  memory_search: 'Memory',
  memory_forget: 'Memory',
  gui_interact: 'GUI',
  dbus_control: 'DBus',
  search_tools: 'Search Tools',
};

function getDisplayName(name: string): string {
  return TOOL_DISPLAY_NAMES[name] ?? name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getDescription(tool: ToolCall): string {
  const d = tool.detail || '';
  switch (tool.name) {
    case 'shell_exec':
    case 'bash':
      return d.split(/\s+/).filter(w => !w.startsWith('-') && !w.startsWith('"') && w.length > 1).slice(0, 5).join(' ') || '';
    case 'file_read':
    case 'file_write':
    case 'file_edit':
      return d.split('/').pop() || d;
    case 'browser_navigate':
      return d.replace(/^https?:\/\//, '').slice(0, 60);
    default:
      return d.slice(0, 80);
  }
}

const OUTPUT_LINE_LIMIT = 15;

function ToolBlock({ tool }: { tool: ToolCall }) {
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const displayName = getDisplayName(tool.name);
  const description = getDescription(tool);
  const hasCard = !!(tool.input || tool.output);
  const isRunning = tool.status === 'running';

  const statusColor = isRunning
    ? 'bg-amber-400'
    : tool.status === 'error'
      ? 'bg-red-400'
      : 'bg-emerald-400';

  const outputLines = tool.output?.split('\n') ?? [];
  const isTruncated = !expanded && outputLines.length > OUTPUT_LINE_LIMIT;
  const displayOutput = isTruncated
    ? outputLines.slice(0, OUTPUT_LINE_LIMIT).join('\n')
    : tool.output;

  return (
    <div className="flex flex-col gap-1.5">
      {/* Header */}
      <button
        onClick={() => hasCard && setCollapsed(c => !c)}
        className={`flex items-center gap-2 text-left ${hasCard ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor} ${isRunning ? 'animate-pulse' : ''}`} />
        <span className="text-[13px] font-semibold text-text-primary">{displayName}</span>
        {description && (
          <span className="text-[13px] text-text-secondary truncate">{description}</span>
        )}
        {tool.durationMs != null && tool.durationMs > 0 && (
          <span className="text-[11px] text-text-muted ml-auto flex-shrink-0">
            {tool.durationMs < 1000 ? `${tool.durationMs}ms` : `${(tool.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
      </button>

      {/* Expandable IN/OUT Card */}
      {hasCard && !collapsed && (
        <div className="ml-4 rounded-lg border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          {tool.input && (
            <div className="px-3 py-2">
              <div className="flex gap-3">
                <span className="text-[11px] font-medium text-text-muted uppercase tracking-wide flex-shrink-0 pt-0.5 w-8">IN</span>
                <pre className="text-[12px] font-mono text-text-secondary whitespace-pre-wrap break-all leading-relaxed flex-1 overflow-hidden">{tool.input}</pre>
              </div>
            </div>
          )}
          {tool.input && tool.output && (
            <div className="border-t border-white/[0.04]" />
          )}
          {tool.output && (
            <div className="px-3 py-2">
              <div className="flex gap-3">
                <span className="text-[11px] font-medium text-text-muted uppercase tracking-wide flex-shrink-0 pt-0.5 w-8">OUT</span>
                <div className="flex-1 overflow-hidden">
                  <pre className="text-[12px] font-mono text-text-secondary whitespace-pre-wrap break-all leading-relaxed">{displayOutput || '(no output)'}</pre>
                  {isTruncated && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
                      className="text-[11px] text-accent hover:text-accent-hover mt-1 cursor-pointer"
                    >
                      Show more ({outputLines.length - OUTPUT_LINE_LIMIT} more lines)
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          {isRunning && !tool.output && (
            <div className="px-3 py-2 border-t border-white/[0.04]">
              <div className="flex gap-3">
                <span className="text-[11px] font-medium text-text-muted uppercase tracking-wide flex-shrink-0 pt-0.5 w-8">OUT</span>
                <span className="text-[12px] text-text-muted italic">Running...</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ToolActivity({ tools }: ToolActivityProps) {
  if (tools.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {tools.map(tool => (
        <ToolBlock key={tool.id} tool={tool} />
      ))}
    </div>
  );
}

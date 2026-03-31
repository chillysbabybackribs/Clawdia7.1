import React, { useCallback, useState } from 'react';
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
    case 'browser_screenshot':
      return '';
    default:
      return d.slice(0, 80);
  }
}

const OUTPUT_LINE_LIMIT = 15;
const PREVIEW_CHAR_LIMIT = 140;

function toSingleLinePreview(value: string, maxChars = PREVIEW_CHAR_LIMIT): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '(empty)';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}…`;
}

function tryParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function stringifyPreview(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(stringifyPreview).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .slice(0, 4)
      .map(([key, item]) => `${key}: ${stringifyPreview(item)}`)
      .join(' · ');
  }
  return String(value);
}

function formatUrlPreview(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '');
}

function looksLikeBase64(value: string): boolean {
  return value.length > 120 && /^[A-Za-z0-9+/=]+$/.test(value);
}

function sanitizeForDisplay(value: unknown): unknown {
  if (typeof value === 'string') {
    return looksLikeBase64(value) ? '[base64 data hidden]' : value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeForDisplay);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      if ((key === 'data' || key === 'base64') && typeof item === 'string' && looksLikeBase64(item)) {
        next[key] = '[base64 data hidden]';
        continue;
      }
      next[key] = sanitizeForDisplay(item);
    }
    return next;
  }
  return value;
}

function summarizeToolPayload(label: 'IN' | 'OUT', tool: ToolCall, value: string): string {
  const parsed = tryParseJson(value);
  const obj = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;

  if (obj) {
    if (label === 'IN') {
      if (typeof obj.url === 'string') return formatUrlPreview(obj.url);
      if (typeof obj.query === 'string') return obj.query;
      if (typeof obj.expression === 'string') return toSingleLinePreview(obj.expression, 96);
      if (typeof obj.command === 'string') return obj.command;
      if (typeof obj.path === 'string') return obj.path.split('/').pop() || obj.path;
      if (typeof obj.action === 'string') return stringifyPreview(obj);
    }

    if (label === 'OUT') {
      if (tool.name === 'browser_screenshot') {
        const mimeType = typeof obj.mimeType === 'string' ? obj.mimeType.replace('image/', '').toUpperCase() : 'Image';
        return obj.data ? `${mimeType} screenshot captured` : `${mimeType} screenshot`;
      }
      if (tool.name === 'search_tools' && Array.isArray(obj.tools_loaded)) {
        return `Loaded ${obj.tools_loaded.length} tools`;
      }
      if (typeof obj.data === 'string' && obj.data.trim()) {
        return toSingleLinePreview(obj.data);
      }
      if (typeof obj.title === 'string' && typeof obj.url === 'string') {
        return `${obj.title || '(untitled)'} · ${formatUrlPreview(obj.url)}`;
      }
      if (typeof obj.url === 'string') return formatUrlPreview(obj.url);
      if (obj.ok === true) {
        const summary = stringifyPreview({ ...obj, ok: undefined }).replace(/ok:\s*/g, '').trim();
        return summary ? `OK · ${summary}` : 'OK';
      }
    }

    const generic = stringifyPreview(obj);
    if (generic) return toSingleLinePreview(generic);
  }

  return toSingleLinePreview(value);
}

function formatExpandedValue(value: string): string {
  const parsed = tryParseJson(value);
  if (parsed == null) return value || '(empty)';
  return JSON.stringify(sanitizeForDisplay(parsed), null, 2);
}

function ToolPayloadCopyButton({ text, label }: { text: string; label: 'IN' | 'OUT' }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [text]);

  return (
    <button
      onClick={(event) => {
        event.stopPropagation();
        void handleCopy();
      }}
      title={`Copy ${label} payload`}
      className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-secondary cursor-pointer"
    >
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-status-success">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

function ExpandableRow({
  label,
  tool,
  value,
  defaultOpen = false,
}: {
  label: 'IN' | 'OUT';
  tool: ToolCall;
  value: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const preview = summarizeToolPayload(label, tool, value);
  const expandedValue = formatExpandedValue(value);

  return (
    <div className="border-t border-white/[0.04] first:border-t-0">
      <button
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.03] transition-colors cursor-pointer"
      >
        <span className="w-8 flex-shrink-0 text-[11px] font-medium uppercase tracking-wide text-text-muted">
          {label}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-mono text-text-secondary">
          {preview}
        </span>
        <span className="flex-shrink-0 text-[10px] text-text-muted">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3">
          <div className="ml-[44px] rounded-md bg-black/20 px-3 py-2">
            <div className="mb-2 flex items-center justify-end">
              <ToolPayloadCopyButton text={expandedValue} label={label} />
            </div>
            <pre className="text-[12px] font-mono text-text-secondary whitespace-pre-wrap break-all leading-relaxed overflow-hidden">
              {expandedValue}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolBlock({ tool }: { tool: ToolCall }) {
  const [collapsed, setCollapsed] = useState(true);

  const displayName = getDisplayName(tool.name);
  const hasCard = !!(tool.input || tool.output);
  const isRunning = tool.status === 'running';

  const statusColor = isRunning
    ? 'bg-amber-400'
    : tool.status === 'error'
      ? 'bg-red-400'
      : 'bg-emerald-400';

  const outputLines = tool.output?.split('\n') ?? [];
  const outputValue = outputLines.length > OUTPUT_LINE_LIMIT
    ? `${outputLines.slice(0, OUTPUT_LINE_LIMIT).join('\n')}\n\n[${outputLines.length - OUTPUT_LINE_LIMIT} more lines hidden in compact view]`
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
        {hasCard && (
          <span className="flex-shrink-0 text-[10px] text-text-muted">
            {collapsed ? '▸' : '▾'}
          </span>
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
            <ExpandableRow label="IN" tool={tool} value={tool.input} />
          )}
          {tool.output && (
            <ExpandableRow label="OUT" tool={tool} value={outputValue || '(no output)'} />
          )}
          {isRunning && !tool.output && (
            <ExpandableRow label="OUT" tool={tool} value="Running..." />
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

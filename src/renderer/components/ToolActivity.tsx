import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ToolCall } from '../../shared/types';

export interface ToolStreamMap {
  [toolId: string]: string[];
}

interface ToolActivityProps {
  tools: ToolCall[];
  streamMap?: ToolStreamMap;
  messageId?: string;
  onRateTool?: (toolId: string, rating: 'up' | 'down' | null, note?: string) => void;
  isStreaming?: boolean;
  /** True when text content has already appeared after this tool group in the feed */
  hasTextAfter?: boolean;
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

/** Build a clean one-line label from the tool's input args */
function getCleanLabel(tool: ToolCall): string {
  const displayName = getDisplayName(tool.name);
  const input = tool.input ? tryParseJson(tool.input) : null;
  const args = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;

  if (!args) return displayName;

  switch (tool.name) {
    case 'shell_exec':
    case 'bash': {
      const cmd = typeof args.command === 'string' ? args.command : typeof args.cmd === 'string' ? args.cmd : '';
      if (!cmd) return displayName;
      const tokens = cmd.trim().split(/\s+/).filter(w => !w.startsWith('-') && w.length > 1).slice(0, 4);
      return tokens.join(' ') || cmd.slice(0, 60);
    }
    case 'file_read':
    case 'file_write':
    case 'file_edit': {
      const p = typeof args.path === 'string' ? args.path : typeof args.file_path === 'string' ? args.file_path : '';
      if (!p) return displayName;
      const parts = p.split('/').filter(Boolean);
      return parts.length > 1 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}` : parts[0] || displayName;
    }
    case 'file_list_directory':
    case 'directory_tree': {
      const p = typeof args.path === 'string' ? args.path : '';
      if (!p) return displayName;
      const parts = p.split('/').filter(Boolean);
      return parts[parts.length - 1] || p || displayName;
    }
    case 'browser_navigate': {
      const url = typeof args.url === 'string' ? args.url : '';
      return url ? url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60) : displayName;
    }
    case 'browser_search': {
      const q = typeof args.query === 'string' ? args.query : '';
      return q ? q.slice(0, 60) : displayName;
    }
    case 'browser_click': {
      const sel = typeof args.selector === 'string' ? args.selector : typeof args.element === 'string' ? args.element : '';
      return sel ? sel.slice(0, 60) : displayName;
    }
    case 'browser_type': {
      const text = typeof args.text === 'string' ? args.text : '';
      return text ? `"${text.slice(0, 40)}"` : displayName;
    }
    case 'memory_store':
    case 'memory_search':
    case 'memory_forget': {
      const key = typeof args.key === 'string' ? args.key : typeof args.query === 'string' ? args.query : '';
      return key ? key.slice(0, 60) : displayName;
    }
    case 'file_search': {
      const pattern = typeof args.pattern === 'string' ? args.pattern : typeof args.query === 'string' ? args.query : '';
      return pattern ? pattern.slice(0, 60) : displayName;
    }
    default: {
      const bestStr = Object.values(args).find(v => typeof v === 'string' && v.length > 2 && v.length < 120);
      return typeof bestStr === 'string' ? bestStr.slice(0, 80) : displayName;
    }
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
      className="flex h-7 w-7 items-center justify-center rounded-md text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/50 cursor-pointer"
    >
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/60">
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
        <span className="w-8 flex-shrink-0 text-[10px] font-medium uppercase tracking-wider text-white/25">
          {label}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-mono text-white/45">
          {preview}
        </span>
        <span className="flex-shrink-0 text-[10px] text-white/20">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3">
          <div className="ml-[44px] rounded-md bg-black/25 px-3 py-2">
            <div className="mb-2 flex items-center justify-end">
              <ToolPayloadCopyButton text={expandedValue} label={label} />
            </div>
            <pre className="text-[12px] font-mono text-white/40 whitespace-pre-wrap break-all leading-relaxed overflow-hidden">
              {expandedValue}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolBlock({ tool, isActiveTool = false, isPastTool = false }: { tool: ToolCall; isActiveTool?: boolean; isPastTool?: boolean }) {
  const [open, setOpen] = useState(false);

  const displayName = getDisplayName(tool.name);
  const hasCard = !!(tool.input || tool.output);
  const isRunning = tool.status === 'running';
  const isError = tool.status === 'error';

  const label = getCleanLabel(tool);

  const outputLines = tool.output?.split('\n') ?? [];
  const outputValue = outputLines.length > OUTPUT_LINE_LIMIT
    ? `${outputLines.slice(0, OUTPUT_LINE_LIMIT).join('\n')}\n\n[${outputLines.length - OUTPUT_LINE_LIMIT} more lines hidden in compact view]`
    : tool.output;

  return (
    <div className={`tool-row flex flex-col transition-all duration-300 ${isPastTool ? 'opacity-25' : 'opacity-100'}`}>
      <button
        onClick={() => hasCard && setOpen(o => !o)}
        className={`group flex items-center gap-2 py-[4px] text-left w-full ${hasCard ? 'cursor-pointer' : 'cursor-default'}`}
      >
        {/* Status icon — monochrome */}
        {isRunning ? (
          <span className="w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center">
            <span className="tool-status-dot w-[5px] h-[5px] rounded-full bg-white/40" />
          </span>
        ) : isError ? (
          <span className="w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center text-white/30">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </span>
        ) : (
          <span className="w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center text-white/18">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </span>
        )}

        {/* Verb label */}
        <span className="flex-shrink-0 text-[10px] font-medium text-white/30 uppercase tracking-wider w-10">
          {displayName.length <= 6 ? displayName : displayName.slice(0, 6)}
        </span>

        {/* Clean path/description — shimmer when active (running or holding as last completed) */}
        <span className={`flex-1 min-w-0 text-[12px] font-mono truncate ${
          isError
            ? 'text-white/35'
            : isActiveTool
              ? 'tool-label-shimmer'
              : isPastTool
                ? 'text-white/20'
                : isRunning
                  ? 'text-white/50'
                  : 'text-white/35'
        }`}>
          {label}
        </span>

        {/* Duration */}
        {tool.durationMs != null && tool.durationMs > 0 && (
          <span className="flex-shrink-0 text-[10px] text-white/20 mr-1 font-mono">
            {tool.durationMs < 1000 ? `${tool.durationMs}ms` : `${(tool.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}

        {/* Expand chevron */}
        {hasCard && (
          <span className="flex-shrink-0 text-[10px] text-white/15 group-hover:text-white/40 transition-colors">
            {open ? '▾' : '▸'}
          </span>
        )}
      </button>

      {/* Expandable IN/OUT card */}
      {hasCard && open && (
        <div className="ml-5 mt-1 mb-1 rounded-lg border border-white/[0.05] bg-white/[0.015] overflow-hidden">
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

// How many tool rows are visible at once in the scrollable window.
const VISIBLE_TAIL = 3;

// Finalized summary: shown after streaming ends
function ToolSummary({ tools }: { tools: ToolCall[] }) {
  const [open, setOpen] = useState(false);
  const errorCount = tools.filter(t => t.status === 'error').length;
  const label = `${tools.length} tool call${tools.length === 1 ? '' : 's'}`;

  return (
    <div className="tool-summary flex flex-col">
      <button
        onClick={() => setOpen(o => !o)}
        className="group flex items-center gap-2 py-[4px] text-left w-full cursor-pointer"
      >
        {/* Icon */}
        {errorCount > 0 ? (
          <span className="w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center text-white/30">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </span>
        ) : (
          <span className="w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center text-white/25">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </span>
        )}
        <span className="flex-1 text-[12px] text-white/35">
          {label}{errorCount > 0 ? ` · ${errorCount} error${errorCount === 1 ? '' : 's'}` : ''}
        </span>
        <span className="flex-shrink-0 text-[10px] text-white/20 group-hover:text-white/40 transition-colors">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div className="ml-5 mt-1 mb-1 rounded-lg border border-white/[0.05] bg-white/[0.015] overflow-hidden py-1 px-2 flex flex-col">
          {tools.map(tool => (
            <ToolBlock key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}

// Each tool row is approximately this tall (py-[4px] + 12px font + line-height)
const ROW_HEIGHT_PX = 24;

// Main export
export default function ToolActivity({ tools, isStreaming, hasTextAfter }: ToolActivityProps) {
  if (tools.length === 0) return null;

  // After streaming ends: collapse everything into a single summary row.
  if (!isStreaming) {
    return <ToolSummary tools={tools} />;
  }

  return <LiveToolActivity tools={tools} hasTextAfter={hasTextAfter} />;
}

function LiveToolActivity({ tools, hasTextAfter }: { tools: ToolCall[]; hasTextAfter?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom whenever tools list grows
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tools.length]);

  const lastRunningIdx = tools.reduce((acc, t, i) => t.status === 'running' ? i : acc, -1);

  // Shimmer: active running tool, or last completed tool while waiting for next action
  const activeShimmerIdx = lastRunningIdx >= 0
    ? lastRunningIdx
    : hasTextAfter ? -1 : tools.length - 1;

  const maxHeight = VISIBLE_TAIL * ROW_HEIGHT_PX;

  const reservedHeight = Math.min(tools.length, VISIBLE_TAIL) * ROW_HEIGHT_PX;

  return (
    <div
      className="tool-activity-live"
      ref={scrollRef}
      style={{
        minHeight: `${reservedHeight}px`,
        maxHeight: `${maxHeight}px`,
        overflowY: tools.length > VISIBLE_TAIL ? 'scroll' : 'visible',
        overflowX: 'hidden',
        scrollbarWidth: 'none',
      }}
    >
      {tools.map((tool, i) => (
        <ToolBlock
          key={tool.id}
          tool={tool}
          isActiveTool={i === activeShimmerIdx}
          isPastTool={activeShimmerIdx >= 0 && i === activeShimmerIdx - 1}
        />
      ))}
    </div>
  );
}

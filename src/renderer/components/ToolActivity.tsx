import React from 'react';
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

// ═══════════════════════════════════
// Friendly headers
// ═══════════════════════════════════

function toolHeader(tool: ToolCall): string {
  const d = tool.detail || '';
  switch (tool.name) {
    case 'shell_exec': return `Ran command: ${d.split(/\s+/).filter(w => !w.startsWith('-') && !w.startsWith('/') && !w.startsWith('"') && !w.startsWith("'") && w.length > 1).slice(0, 3).join(', ') || d.slice(0, 40)}`;
    case 'file_read': return `Read file: ${d.split('/').pop() || d}`;
    case 'file_write': return `Wrote file: ${d.split('/').pop() || d}`;
    case 'file_edit': return `Edited file: ${d.split('/').pop() || d}`;
    case 'directory_tree': return `Listed: ${d || 'directory'}`;
    case 'browser_search': return `Searched: ${d}`;
    case 'browser_navigate': return `Navigated: ${d.replace(/^https?:\/\//, '').slice(0, 40)}`;
    case 'browser_read_page': return 'Read page content';
    case 'browser_click': return `Clicked: ${d}`;
    case 'browser_type': return `Typed: ${d}`;
    case 'browser_extract': return `Extracted: ${d.slice(0, 40)}`;
    case 'browser_screenshot': return 'Took screenshot';
    case 'browser_scroll': return `Scrolled ${d}`;
    case 'create_document': return `Created: ${d}`;
    case 'memory_search': return `Memory search: ${d}`;
    case 'memory_store': return `Stored: ${d}`;
    case 'recall_context': return 'Recalled context';
    case 'app_control': return `App: ${d}`;
    case 'gui_interact': return `GUI: ${d}`;
    case 'dbus_control': return `DBus: ${d}`;
    default: return `${tool.name}: ${d.slice(0, 40)}`;
  }
}


// ═══════════════════════════════════
// Single Tool Line
// ═══════════════════════════════════

function ToolCard({ tool }: { tool: ToolCall }) {
  return (
    <div
      className="text-[11px] leading-[1.6] truncate"
      style={{ color: '#3e3e50' }}
    >
      {toolHeader(tool)}
    </div>
  );
}

// ═══════════════════════════════════
// Main Export
// ═══════════════════════════════════

export default function ToolActivity({ tools, streamMap = {} }: ToolActivityProps) {
  if (tools.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {tools.map(tool => (
        <ToolCard
          key={tool.id}
          tool={tool}
        />
      ))}
    </div>
  );
}

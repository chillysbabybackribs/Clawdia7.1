# Cursor-Style Chat UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Clawdia's chat UI to match Cursor's Claude Code panel — full-width user messages, expandable tool call blocks with IN/OUT cards, premium input bar, and sparkle shimmer indicator.

**Architecture:** Six sequential tasks: (1) extend types with tool input/output, (2) update all 4 backend emitters, (3) rewrite ToolActivity.tsx, (4) update ChatPanel message layout + feed integration, (5) restyle InputBar, (6) update InlineShimmer. Each task is independently testable.

**Tech Stack:** TypeScript, React 19, Tailwind CSS, Electron IPC

---

### Task 1: Extend ToolCall and ToolActivity Types

**Files:**
- Modify: `src/shared/types.ts:66-75`
- Modify: `src/main/agent/types.ts:38-44`

- [ ] **Step 1: Add input/output fields to shared ToolCall**

In `src/shared/types.ts`, replace the ToolCall interface:

```typescript
export interface ToolCall {
  id: string;
  name: string;
  status: 'running' | 'success' | 'error';
  detail?: string;
  input?: string;
  output?: string;
  durationMs?: number;
  previewHints?: MessageLinkPreview[];
  rating?: 'up' | 'down' | null;
  ratingNote?: string;
}
```

- [ ] **Step 2: Add input/output fields to agent ToolActivity**

In `src/main/agent/types.ts`, replace the ToolActivity interface:

```typescript
export interface ToolActivity {
  id: string;
  name: string;
  status: 'running' | 'success' | 'error';
  detail?: string;
  input?: string;
  output?: string;
  durationMs?: number;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors (existing errors may remain, but no new ones from type additions since fields are optional)

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/main/agent/types.ts
git commit -m "feat(types): add input/output fields to ToolCall and ToolActivity"
```

---

### Task 2: Send Full Tool Input/Output Through IPC

**Files:**
- Modify: `src/main/agent/dispatch.ts:61-90`
- Modify: `src/main/anthropicChat.ts:380-467`
- Modify: `src/main/openaiChat.ts:206-270`
- Modify: `src/main/geminiChat.ts:200-305`

- [ ] **Step 1: Update dispatch.ts to send full input/output**

In `src/main/agent/dispatch.ts`, update the two `onToolActivity` calls in `executeOne()`.

For the "running" emit (line 64-69), add `input`:

```typescript
  options.onToolActivity?.({
    id: block.id,
    name: block.name,
    status: 'running',
    detail: argsSummary,
    input: JSON.stringify(block.input, null, 2),
  });
```

For the "success/error" emit (line 84-90), add `output`:

```typescript
  options.onToolActivity?.({
    id: block.id,
    name: block.name,
    status: isError ? 'error' : 'success',
    detail: result.slice(0, 200),
    output: result,
    durationMs,
  });
```

- [ ] **Step 2: Update anthropicChat.ts to send full input/output**

In `src/main/anthropicChat.ts`, there are multiple `webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, ...)` calls. Update them:

For all "running" state emits that don't already exist — add one before execution starts. After the policy gate section (after line 431), before the try block, add:

```typescript
      if (!webContents.isDestroyed()) {
        webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
          id: block.id,
          name: block.name,
          status: 'running',
          detail: argsSummary,
          input: JSON.stringify(block.input, null, 2),
        });
      }
```

For the success emit (lines 460-467), add `output`:

```typescript
      if (!webContents.isDestroyed()) {
        webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
          id: block.id,
          name: block.name,
          status: isError ? 'error' : 'success',
          detail: resultContent.slice(0, 200),
          input: JSON.stringify(block.input, null, 2),
          output: resultContent,
          durationMs,
        });
      }
```

- [ ] **Step 3: Update openaiChat.ts to send full input/output**

For the "running" emit (lines 207-212), add `input`:

```typescript
        if (!webContents.isDestroyed()) {
          webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
            id: toolCallId,
            name: tc.name,
            status: 'running',
            detail: tc.args.slice(0, 200),
            input: tc.args,
          });
        }
```

For the "success" emit (lines 264-270), add `output`:

```typescript
        if (!webContents.isDestroyed()) {
          webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
            id: toolCallId,
            name: tc.name,
            status: 'success',
            detail: resultStr.slice(0, 200),
            input: tc.args,
            output: resultStr,
            durationMs,
          });
        }
```

- [ ] **Step 4: Update geminiChat.ts to send full input/output**

For the "running" emit (line 200-204), the `tcObj` already includes `detail`. Update it:

```typescript
const tcObj = {
  id: tcId,
  name: uiName,
  status: 'running' as const,
  detail: typeof detail === 'string' ? detail : JSON.stringify(fc.args).slice(0, 120),
  input: JSON.stringify(fc.args, null, 2),
};
```

For the "success" emit (line 302-304), add `output`:

```typescript
const successTcObj = {
  ...tcObj,
  status: 'success' as const,
  detail: resultStr.substring(0, 500),
  output: resultStr,
};
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/dispatch.ts src/main/anthropicChat.ts src/main/openaiChat.ts src/main/geminiChat.ts
git commit -m "feat(backend): send full tool input/output through IPC events"
```

---

### Task 3: Rewrite ToolActivity.tsx — Cursor-Style Blocks

**Files:**
- Modify: `src/renderer/components/ToolActivity.tsx` (complete rewrite)

- [ ] **Step 1: Rewrite ToolActivity.tsx**

Replace the entire file with the Cursor-style tool block component:

```tsx
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/ToolActivity.tsx
git commit -m "feat(ui): rewrite ToolActivity with Cursor-style expandable IN/OUT blocks"
```

---

### Task 4: Update ChatPanel — Message Layout & Tool Feed Integration

**Files:**
- Modify: `src/renderer/components/ChatPanel.tsx`

This task has 4 sub-changes: (a) push tool calls into feed during streaming, (b) render tool blocks in AssistantMessage, (c) restyle UserMessage, (d) remove max-width container constraint.

- [ ] **Step 1: Update handleToolActivityEvent to push tools into feed**

In `src/renderer/components/ChatPanel.tsx`, replace the `handleToolActivityEvent` callback (currently at line ~1253):

```typescript
  const handleToolActivityEvent = useCallback((activity: ToolCall) => {
    ensureAssistantReplayMessage();

    if (activity.status === 'running') {
      // Freeze any in-progress text item so text + tool don't interleave
      const lastIdx = feedRef.current.length - 1;
      if (lastIdx >= 0 && feedRef.current[lastIdx].kind === 'text') {
        feedRef.current[lastIdx] = { ...feedRef.current[lastIdx], isStreaming: false } as FeedItem;
      }
      // Push tool into feed
      feedRef.current.push({ kind: 'tool', tool: activity });
      scheduleStreamUpdate();
      handleThinkingEvent(toolToShimmerLabel(activity.name, activity.detail));
    } else if (activity.status === 'success' || activity.status === 'error') {
      // Update existing tool in feed with output
      const idx = feedRef.current.findIndex(
        item => item.kind === 'tool' && item.tool.id === activity.id
      );
      if (idx >= 0) {
        feedRef.current[idx] = { kind: 'tool', tool: { ...(feedRef.current[idx] as any).tool, ...activity } };
      } else {
        feedRef.current.push({ kind: 'tool', tool: activity });
      }
      scheduleStreamUpdate();
      setShimmerText('');
    } else if (activity.status === 'awaiting_approval') {
      setShimmerText('Waiting for approval…');
      autoScroll();
    } else if ((activity as any).status === 'needs_human') {
      setShimmerText('Needs your input…');
      autoScroll();
    }
  }, [autoScroll, ensureAssistantReplayMessage, handleThinkingEvent, scheduleStreamUpdate]);
```

- [ ] **Step 2: Update AssistantMessage to render tool blocks inline**

Add `ToolActivity` import at top of ChatPanel.tsx (it's already imported as a type — add the default import):

```typescript
import ToolActivityComponent from './ToolActivity';
```

In the `AssistantMessage` component, update the live streaming render path. Replace the section that maps `textItems` (around lines 593-614) with code that renders both text and tool items from the feed in order:

```tsx
    return (
      <div className="flex justify-start animate-slide-up group">
        <div className="w-full px-1 py-2 text-text-primary flex flex-col gap-3">
          {/* Shimmer — shown while streaming whenever shimmerText is set */}
          {message.isStreaming && shimmerText && (
            streamMode === 'codex_terminal'
              ? <CodexWaitingCard text={shimmerText} />
              : <InlineShimmer text={shimmerText} />
          )}
          {(message.feed ?? []).map((item, idx) => {
            if (item.kind === 'text') {
              if (!item.text.trim()) return null;
              return <MarkdownRenderer key={idx} content={item.text} isStreaming={item.isStreaming === true} />;
            }
            if (item.kind === 'tool') {
              return <ToolActivityComponent key={item.tool.id} tools={[item.tool]} />;
            }
            return null;
          })}
          {!!message.fileRefs?.length && <FileRefList fileRefs={message.fileRefs} />}
          {!!message.linkPreviews?.length && <LinkPreviewList linkPreviews={message.linkPreviews} />}
          {!message.isStreaming && message.content && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[11px] text-text-secondary/70">{message.timestamp}</span>
              <CopyButton text={message.content} />
            </div>
          )}
        </div>
      </div>
    );
```

Also update the historical/DB-loaded fallback render (around lines 624-637) to show tool calls:

```tsx
  return (
    <div className="flex justify-start animate-slide-up group">
      <div className="w-full px-1 py-2 text-text-primary">
        {!!message.toolCalls?.length && (
          <div className="mb-3">
            <ToolActivityComponent tools={message.toolCalls} />
          </div>
        )}
        {hasContent && <MarkdownRenderer content={message.content} isStreaming={false} />}
        {!!message.fileRefs?.length && <FileRefList fileRefs={message.fileRefs} />}
        {!!message.linkPreviews?.length && <LinkPreviewList linkPreviews={message.linkPreviews} />}
        {hasContent && (
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[11px] text-text-secondary/70">{message.timestamp}</span>
            <CopyButton text={message.content} />
          </div>
        )}
      </div>
    </div>
  );
```

- [ ] **Step 3: Restyle UserMessage — full-width dark box**

Replace the UserMessage component (around line 648-665):

```tsx
const UserMessage = React.memo(function UserMessage({ message }: { message: Message }) {
  return (
    <div className="flex flex-col gap-1 animate-slide-up">
      <div className="w-full rounded-xl px-4 py-3 bg-white/[0.04] border border-white/[0.06] text-white">
        {message.attachments && message.attachments.length > 0 && (
          <div className={message.content.trim() ? 'mb-3' : ''}>
            <AttachmentGallery attachments={message.attachments} />
          </div>
        )}
        {message.content.trim() && <div className="text-[1rem] leading-relaxed whitespace-pre-wrap">{message.content}</div>}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-text-secondary/70">{message.timestamp}</span>
        {message.content.trim() && <CopyButton text={message.content} />}
      </div>
    </div>
  );
});
```

- [ ] **Step 4: Remove max-w-[720px] container constraint**

Find the scroll container div (around line 1852-1854). Change:

```
className={`flex max-w-[720px] flex-col px-4 pt-5 pb-8 ...`}
```

To:

```
className={`flex flex-col px-5 pt-5 pb-8 ...`}
```

Remove `max-w-[720px]` and change `px-4` to `px-5`.

- [ ] **Step 5: Remove the terminal transcript special-casing from AssistantMessage streaming path**

Remove the `renderAsTerminalTranscript` block (lines 564-591) — since all modes now use the same unified layout, we no longer need the `TerminalTranscriptCard` path for streaming. The feed-based rendering handles everything.

Actually — keep the `TerminalTranscriptCard` for historical/DB-loaded messages that have `type === 'terminal_transcript'` (line 621-622), but remove it from the live streaming path so new messages always use the feed renderer.

Replace lines 564-591 (the `renderAsTerminalTranscript` check and its if-block) by simply removing the `if (renderAsTerminalTranscript)` branch. The feed-based renderer below it handles everything.

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/ChatPanel.tsx
git commit -m "feat(ui): Cursor-style message layout with inline tool blocks"
```

---

### Task 5: Premium InputBar Update

**Files:**
- Modify: `src/renderer/components/InputBar.tsx`

- [ ] **Step 1: Restyle model selector dropdown — monochrome dark**

Replace the model dropdown section (lines 225-261). Change the dropdown container and item styling:

```tsx
          {modelOpen && (
            <div className="absolute bottom-full left-0 mb-2 py-1.5 bg-surface-2 border border-white/[0.08] rounded-xl shadow-xl shadow-black/50 min-w-[210px] animate-fade-in z-50">
              {PROVIDERS.map((prov) => {
                const provModels = MODEL_REGISTRY.filter((m) => m.provider === prov.id);
                return (
                  <div key={prov.id}>
                    <div className="px-3.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                      {prov.label}
                    </div>
                    {provModels.map((model) => {
                      const isSelected = model.provider === provider && model.id === models[modelIdx]?.id;
                      return (
                        <button
                          key={model.id}
                          onClick={() => {
                            setProvider(model.provider);
                            const nextModels = getModelsForProvider(model.provider);
                            const idx = nextModels.findIndex((m) => m.id === model.id);
                            setModelIdx(idx >= 0 ? idx : 0);
                            setModelOpen(false);
                          }}
                          className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-[13px] transition-all cursor-pointer ${
                            isSelected ? 'text-text-primary bg-white/[0.08]' : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.05]'
                          }`}
                        >
                          <span className="flex-1">{model.label}</span>
                          <span className="text-[10px] text-text-muted uppercase tracking-wide">{model.tier}</span>
                          {isSelected && (
                            <svg className="text-text-secondary flex-shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
```

- [ ] **Step 2: Replace Claude Code text badge with terminal icon**

Replace the Claude Code button (lines 266-284):

```tsx
          <button
            onClick={onToggleClaudeMode}
            disabled={claudeModeDisabled}
            className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
              claudeMode
                ? 'text-amber-400 bg-amber-400/10 cursor-pointer'
                : claudeModeDisabled
                  ? 'text-text-muted/35 cursor-default'
                  : 'text-text-muted hover:text-text-secondary hover:bg-white/[0.05] cursor-pointer'
            }`}
            title={claudeModeDisabled ? 'Create or open a conversation first' : claudeMode ? `Claude Code (${claudeStatus})` : 'Toggle Claude Code'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </button>
```

- [ ] **Step 3: Replace Codex text badge with desktop icon**

Replace the Codex button (lines 288-306):

```tsx
          <button
            onClick={onToggleCodexMode}
            disabled={codexModeDisabled}
            className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
              codexMode
                ? 'text-emerald-400 bg-emerald-400/10 cursor-pointer'
                : codexModeDisabled
                  ? 'text-text-muted/35 cursor-default'
                  : 'text-text-muted hover:text-text-secondary hover:bg-white/[0.05] cursor-pointer'
            }`}
            title={codexModeDisabled ? 'Create or open a conversation first' : codexMode ? `Codex (${codexStatus})` : 'Toggle Codex'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </button>
```

- [ ] **Step 4: Update placeholder text during streaming**

Find the textarea placeholder (line 374). Change:

```
placeholder={isStreaming ? 'Add a follow-up...' : 'Ask me anything...'}
```

To:

```
placeholder={isStreaming ? 'Queue another message...' : 'Ask me anything...'}
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/InputBar.tsx
git commit -m "feat(ui): premium InputBar with monochrome model selector and icon toggles"
```

---

### Task 6: Update InlineShimmer — Sparkle Icon

**Files:**
- Modify: `src/renderer/components/ChatPanel.tsx` (InlineShimmer function, ~line 988)
- Modify: `src/renderer/index.css` (shimmer styles, ~line 164)

- [ ] **Step 1: Replace InlineShimmer component**

In `src/renderer/components/ChatPanel.tsx`, replace the `InlineShimmer` function (around line 988-1003):

```tsx
function InlineShimmer({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-text-secondary text-[14px] flex-shrink-0" aria-hidden>✱</span>
      <span className="inline-shimmer leading-relaxed line-clamp-1 overflow-hidden text-ellipsis">{text}</span>
    </div>
  );
}
```

- [ ] **Step 2: Update shimmer CSS — remove gradient line styles**

In `src/renderer/index.css`, the `.thinking-shimmer-line` class (lines 182-197) is no longer used by InlineShimmer. It may still be used by the TerminalTranscriptCard — leave it for now but it's safe to remove later.

No CSS changes needed — the `.inline-shimmer` class already provides the gradient text animation.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ChatPanel.tsx
git commit -m "feat(ui): sparkle icon shimmer indicator matching Cursor style"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] Run `npx tsc --noEmit` — no type errors
- [ ] Run `npm run build` — builds successfully
- [ ] Launch app and verify:
  - User messages render as full-width dark rounded boxes (not right-aligned bubbles)
  - Tool calls show as green dot + bold name + description with expandable IN/OUT cards
  - Model selector is monochrome dark with text tier labels
  - Claude Code and Codex toggles are small icons (terminal and monitor)
  - Streaming shows sparkle `✱` icon with shimmer text
  - Placeholder says "Queue another message..." during streaming
  - All three conversation modes (chat, claude_terminal, codex_terminal) use the same layout

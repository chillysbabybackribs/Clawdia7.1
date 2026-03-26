import React, { useState, useRef, useEffect, useCallback } from 'react';
import type {
  Message,
  ToolCall,
  FeedItem,
  ProcessInfo,
  RunApproval,
  RunHumanIntervention,
  MessageAttachment,
  MessageFileRef,
  MessageLinkPreview,
} from '../../shared/types';
import InputBar from './InputBar';
import { type ToolStreamMap } from './ToolActivity';
import MarkdownRenderer from './MarkdownRenderer';
import SwarmPanel from './SwarmPanel';
import TabStrip from './TabStrip';
import type { ConversationTab } from '../tabLogic';


interface ChatPanelProps {
  browserVisible: boolean;
  onToggleBrowser: () => void;
  onHideBrowser: () => void;
  onShowBrowser: () => void;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  onOpenSettings: () => void;
  onOpenPendingApproval?: (processId: string) => void;
  loadConversationId?: string | null;
  replayBuffer?: Array<{ type: string; data: any }> | null;
  tabs: ConversationTab[];
  activeTabId: string;
  onNewTab: () => void;
  onCloseTab: (tabId: string) => void;
  onSwitchTab: (tabId: string) => void;
}

function ApprovalBanner({
  approval,
  onApprove,
  onDeny,
  onOpenReview,
}: {
  approval: RunApproval;
  onApprove: () => void;
  onDeny: () => void;
  onOpenReview: () => void;
}) {
  const isWorkflowPlan = approval.actionType === 'workflow_plan';
  const planText = typeof approval.request?.plan === 'string' ? approval.request.plan : '';
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-text-primary">{isWorkflowPlan ? 'Plan approval required' : 'Approval required'}</div>
          <div className="mt-1 text-[13px] text-text-primary">{approval.summary}</div>
          <div className="mt-1 text-2xs text-text-muted break-all">
            {approval.actionType} · {approval.target}
          </div>
          {isWorkflowPlan && planText && (
            <div className="mt-3 rounded-xl border border-white/[0.04] bg-[#0f0f13] px-4 py-3">
              <MarkdownRenderer content={planText} />
            </div>
          )}
        </div>
        <button
          onClick={onOpenReview}
          className="text-2xs px-2.5 py-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-colors cursor-pointer flex-shrink-0"
        >
          Open review
        </button>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={onApprove}
          className="text-2xs px-2.5 py-1 rounded-md bg-white/[0.07] text-text-primary hover:bg-white/[0.1] transition-colors cursor-pointer"
        >
          Approve
        </button>
        <button
          onClick={onDeny}
          className="text-2xs px-2.5 py-1 rounded-md bg-white/[0.04] text-text-secondary hover:bg-white/[0.08] hover:text-text-primary transition-colors cursor-pointer"
        >
          Deny
        </button>
      </div>
    </div>
  );
}

function HumanInterventionBanner({
  intervention,
  onResume,
  onCancelRun,
  onOpenReview,
}: {
  intervention: RunHumanIntervention;
  onResume: () => void;
  onCancelRun: () => void;
  onOpenReview: () => void;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.14] bg-white/[0.04] px-4 py-3 shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_0_18px_rgba(255,255,255,0.08)] animate-pulse">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-text-primary">Needs human intervention</div>
          <div className="mt-1 text-[13px] text-text-primary">{intervention.summary}</div>
          {intervention.instructions && (
            <div className="mt-2 text-[12px] leading-relaxed text-text-secondary whitespace-pre-wrap">
              {intervention.instructions}
            </div>
          )}
          <div className="mt-2 text-2xs text-text-muted break-all">
            {intervention.interventionType}{intervention.target ? ` · ${intervention.target}` : ''}
          </div>
        </div>
        <button
          onClick={onOpenReview}
          className="text-2xs px-2.5 py-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-colors cursor-pointer flex-shrink-0"
        >
          Open review
        </button>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={onResume}
          className="text-2xs px-2.5 py-1 rounded-md bg-white/[0.07] text-text-primary hover:bg-white/[0.1] transition-colors cursor-pointer"
        >
          Resume
        </button>
        <button
          onClick={onCancelRun}
          className="text-2xs px-2.5 py-1 rounded-md bg-white/[0.04] text-text-secondary hover:bg-white/[0.08] hover:text-text-primary transition-colors cursor-pointer"
        >
          Cancel run
        </button>
      </div>
    </div>
  );
}


/** Copy button with checkmark feedback */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback for older Electron versions
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
      onClick={handleCopy}
      title="Copy response"
      className={`
        flex items-center justify-center w-7 h-7 rounded-md transition-all duration-200 cursor-pointer
        ${copied
          ? 'text-status-success'
          : 'text-text-muted/0 group-hover:text-text-muted hover:!text-text-secondary hover:bg-white/[0.06]'
        }
      `}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentGallery({ attachments }: { attachments: MessageAttachment[] }) {
  if (attachments.length === 0) return null;
  const images = attachments.filter((attachment) => attachment.kind === 'image' && attachment.dataUrl);
  const files = attachments.filter((attachment) => attachment.kind !== 'image' || !attachment.dataUrl);
  const openAttachment = async (attachment: MessageAttachment) => {
    if (!attachment.path) return;
    await (window as any).clawdia?.chat.openAttachment(attachment.path);
  };

  return (
    <div className="flex flex-col gap-2">
      {images.length > 0 && (
        <div className="flex flex-col gap-2">
          {images.map((attachment) => (
            <button
              key={attachment.id}
              type="button"
              onClick={() => openAttachment(attachment)}
              disabled={!attachment.path}
              className={`overflow-hidden rounded-2xl border border-white/[0.10] bg-white/[0.03] max-w-[420px] text-left transition-colors ${
                attachment.path ? 'cursor-pointer hover:bg-white/[0.05]' : 'cursor-default'
              }`}
            >
              <img src={attachment.dataUrl} alt={attachment.name} className="block w-full max-h-[320px] object-cover" />
              <div className="px-3 py-2.5 border-t border-white/[0.06]">
                <div className="text-[12px] text-text-primary truncate">{attachment.name}</div>
                <div className="mt-0.5 text-[11px] text-text-secondary/80">{formatAttachmentSize(attachment.size)}</div>
              </div>
            </button>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-col gap-2">
          {files.map((attachment) => (
            <button
              key={attachment.id}
              type="button"
              onClick={() => openAttachment(attachment)}
              disabled={!attachment.path}
              className={`rounded-xl border border-white/[0.10] bg-white/[0.03] px-3 py-2.5 max-w-[420px] text-left transition-colors ${
                attachment.path ? 'cursor-pointer hover:bg-white/[0.05]' : 'cursor-default'
              }`}
            >
              <div className="text-[12px] text-text-primary break-all">{attachment.name}</div>
              <div className="mt-0.5 text-[11px] text-text-secondary/80">{formatAttachmentSize(attachment.size)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FileRefList({ fileRefs }: { fileRefs: MessageFileRef[] }) {
  if (fileRefs.length === 0) return null;

  const openFile = async (resolvedPath: string) => {
    await (window as any).clawdia?.editor?.openFile?.(resolvedPath);
  };

  return (
    <div className="mt-3 flex flex-col gap-2">
      {fileRefs.map((fileRef) => (
        <button
          key={`${fileRef.rawText}:${fileRef.resolvedPath}`}
          type="button"
          onClick={() => void openFile(fileRef.resolvedPath)}
          className="chat-file-ref cursor-pointer rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-left transition-colors hover:bg-white/[0.06]"
          title={fileRef.resolvedPath}
        >
          <div className="text-[11px] uppercase tracking-[0.08em] text-text-tertiary">Open file</div>
          <div className="mt-1 break-all font-mono text-[12px] leading-5 text-text-secondary">{fileRef.rawText}</div>
        </button>
      ))}
    </div>
  );
}

function LinkPreviewList({ linkPreviews }: { linkPreviews: MessageLinkPreview[] }) {
  if (linkPreviews.length === 0) return null;

  const openLink = async (url: string) => {
    await (window as any).clawdia?.browser?.navigate?.(url);
  };

  return (
    <div className="mt-3 flex flex-col gap-2">
      {linkPreviews.map((preview) => (
        <button
          key={preview.id}
          type="button"
          onClick={() => void openLink(preview.url)}
          className="chat-link-preview cursor-pointer rounded-xl border border-white/[0.08] bg-white/[0.03] text-left transition-colors hover:bg-white/[0.06]"
          title={preview.url}
        >
          <div className="flex items-stretch gap-3 p-3">
            {preview.imageUrl ? (
              <img
                src={preview.imageUrl}
                alt={preview.title}
                className="h-[64px] w-[92px] flex-shrink-0 rounded-lg object-cover"
              />
            ) : (
              <div className="flex h-[64px] w-[92px] flex-shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                Link
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-[13px] font-medium leading-5 text-text-primary">{preview.title}</div>
              <div className="mt-1 text-[11px] text-text-secondary/80">{preview.hostname}</div>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

const AssistantMessage = React.memo(function AssistantMessage({ message, shimmerText }: { message: Message; shimmerText?: string }) {
  // Live path: active streaming message (feed may be empty while shimmer is showing)
  if (message.isStreaming || (message.feed && message.feed.length > 0)) {
    const textItems: Array<{ text: string; isStreaming?: boolean; idx: number }> = [];
    for (let i = 0; i < (message.feed?.length ?? 0); i++) {
      const item = message.feed![i];
      if (item.kind === 'text') {
        if (!item.text.trim()) continue;
        textItems.push({ text: item.text, isStreaming: item.isStreaming, idx: i });
      }
    }

    const hasText = textItems.length > 0;
    if (!hasText && !shimmerText) return null;

    return (
      <div className="flex justify-start animate-slide-up group">
        <div className="max-w-[92%] px-1 py-2 text-text-primary flex flex-col gap-3">
          {/* Shimmer — shown only while streaming and no text has arrived yet */}
          {message.isStreaming && shimmerText && !hasText && (
            <InlineShimmer text={shimmerText} />
          )}
          {textItems.map(g => (
            <MarkdownRenderer key={g.idx} content={g.text} isStreaming={g.isStreaming === true} />
          ))}
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
  }

  // Fallback: DB-loaded historical messages
  const hasContent = !!message.content?.trim();
  if (!hasContent) return null;
  return (
    <div className="flex justify-start animate-slide-up group">
      <div className="max-w-[92%] px-1 py-2 text-text-primary">
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
}, (prev, next) => {
  // Skip re-render for finished messages — their data never changes
  if (!prev.message.isStreaming && !next.message.isStreaming) {
    return prev.message.id === next.message.id;
  }
  // Always re-render the actively streaming message
  return false;
});

const UserMessage = React.memo(function UserMessage({ message }: { message: Message }) {
  return (
    <div className="flex flex-col items-end gap-1 animate-slide-up">
      <div className="max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 bg-neutral-700/60 text-white backdrop-blur-sm">
        {message.attachments && message.attachments.length > 0 && (
          <div className={message.content.trim() ? 'mb-3' : ''}>
            <AttachmentGallery attachments={message.attachments} />
          </div>
        )}
        {message.content.trim() && <div className="text-[1rem] leading-relaxed whitespace-pre-wrap">{message.content}</div>}
      </div>
      <div className="flex items-center gap-2 mr-1">
        <span className="text-[11px] text-text-secondary/70">{message.timestamp}</span>
        {message.content.trim() && <CopyButton text={message.content} />}
      </div>
    </div>
  );
});

function extractHostname(detail: string): string | null {
  const match = detail?.match(/https?:\/\/([^/\s]+)/);
  return match ? match[1].replace(/^www\./, '') : null;
}

function toolToShimmerLabel(name: string, detail?: string): string {
  if (name === 'browser_navigate') {
    const host = extractHostname(detail ?? '');
    return host ? `Navigating to ${host}…` : 'Navigating…';
  }
  const labels: Record<string, string> = {
    browser_click:     'Clicking…',
    browser_extract:   'Extracting page content…',
    browser_read:      'Reading page…',
    browser_type:      'Typing…',
    browser_batch:     'Running browser sequence…',
    browser_scroll:    'Scrolling…',
    shell_exec:        'Running command…',
    file_read:         'Reading file…',
    file_write:        'Writing file…',
    file_edit:         'Editing file…',
    directory_tree:    'Scanning directory…',
    fs_quote_lookup:   'Searching files…',
    fs_folder_summary: 'Summarising folder…',
    agent_spawn:       'Spawning agent…',
    memory_read:       'Recalling memory…',
    memory_write:      'Saving to memory…',
  };
  return labels[name] ?? 'Working…';
}

function InlineShimmer({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2 py-0.5">
      <div
        className="thinking-shimmer-line h-[2px] w-full max-w-md rounded-full"
        aria-hidden
      />
      <div className="flex items-start gap-2.5">
        <span
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent/85 shadow-[0_0_12px_rgba(99,102,241,0.45)] animate-pulse"
          aria-hidden
        />
        <span className="inline-shimmer leading-relaxed">{text}</span>
      </div>
    </div>
  );
}

export default function ChatPanel({
  browserVisible,
  onToggleBrowser,
  onHideBrowser,
  onShowBrowser,
  terminalOpen,
  onToggleTerminal,
  onOpenSettings,
  onOpenPendingApproval,
  loadConversationId,
  replayBuffer,
  tabs,
  activeTabId,
  onNewTab,
  onCloseTab,
  onSwitchTab,
}: ChatPanelProps) {
  const MIN_THINKING_VISIBLE_MS = 2400;
  const THINKING_PAIR_WINDOW_MS = 1400;
  const MAX_THINKING_BATCH_LINES = 2;
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [shimmerText, setShimmerText] = useState<string>('');
  const [streamMap, setStreamMap] = useState<ToolStreamMap>({});
  const [pendingApprovalRunId, setPendingApprovalRunId] = useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<RunApproval[]>([]);
  const [pendingHumanRunId, setPendingHumanRunId] = useState<string | null>(null);
  const [pendingHumanInterventions, setPendingHumanInterventions] = useState<RunHumanIntervention[]>([]);
  const [conversationMode, setConversationMode] = useState<'chat' | 'claude_terminal'>('chat');
  const [claudeStatus, setClaudeStatus] = useState<'idle' | 'starting' | 'ready' | 'working' | 'errored' | 'stopped'>('idle');
  const [workflowPlanDraft, setWorkflowPlanDraft] = useState('');
  const [isWorkflowPlanStreaming, setIsWorkflowPlanStreaming] = useState(false);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Flat append-only feed — each item appended once, never moved
  const feedRef = useRef<FeedItem[]>([]);
  const assistantMsgIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingUpdateRef = useRef(false);
  const isUserScrolledUpRef = useRef(false);
  const replayedBufferRef = useRef<string | null>(null);
  const thinkingQueueRef = useRef<Array<{ text: string; at: number }>>([]);
  const thinkingBatchRef = useRef<Array<{ text: string; at: number }>>([]);
  const thinkingVisibleUntilRef = useRef(0);
  const thinkingAppendWindowUntilRef = useRef(0);
  const thinkingAdvanceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToBottom = useCallback((behavior: 'auto' | 'smooth' = 'auto') => {
    if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior });
  }, []);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    isUserScrolledUpRef.current = (scrollHeight - scrollTop - clientHeight) > 100;
  }, []);

  const autoScroll = useCallback(() => {
    if (!isUserScrolledUpRef.current) scrollToBottom();
  }, [scrollToBottom]);

  const clearThinkingAdvanceTimer = useCallback(() => {
    if (thinkingAdvanceTimeoutRef.current) {
      clearTimeout(thinkingAdvanceTimeoutRef.current);
      thinkingAdvanceTimeoutRef.current = null;
    }
  }, []);

  const scheduleThinkingAdvance = useCallback(() => {
    clearThinkingAdvanceTimer();
    if (thinkingQueueRef.current.length === 0) return;
    const delay = Math.max(0, thinkingVisibleUntilRef.current - Date.now());
    thinkingAdvanceTimeoutRef.current = setTimeout(() => {
      const nextBatch: Array<{ text: string; at: number }> = [];
      const first = thinkingQueueRef.current.shift();
      if (!first) return;
      nextBatch.push(first);
      while (
        thinkingQueueRef.current.length > 0
        && nextBatch.length < MAX_THINKING_BATCH_LINES
        && thinkingQueueRef.current[0].at - nextBatch[0].at <= THINKING_PAIR_WINDOW_MS
      ) {
        nextBatch.push(thinkingQueueRef.current.shift()!);
      }
      thinkingBatchRef.current = nextBatch;
      thinkingVisibleUntilRef.current = Date.now() + MIN_THINKING_VISIBLE_MS;
      thinkingAppendWindowUntilRef.current = Date.now() + THINKING_PAIR_WINDOW_MS;
      setShimmerText(nextBatch.map((item) => item.text).join('\n'));
      autoScroll();
      if (thinkingQueueRef.current.length > 0) scheduleThinkingAdvance();
    }, delay);
  }, [autoScroll, clearThinkingAdvanceTimer]);

  const flushStreamUpdate = useCallback(() => {
    if (!assistantMsgIdRef.current) return;
    const feed = [...feedRef.current];
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === assistantMsgIdRef.current);
      if (idx === -1) return prev;
      const updated = [...prev];
      updated[idx] = { ...updated[idx], feed, isStreaming: true };
      return updated;
    });
    pendingUpdateRef.current = false;
    requestAnimationFrame(() => autoScroll());
  }, [autoScroll]);

  const scheduleStreamUpdate = useCallback(() => {
    if (pendingUpdateRef.current) return;
    pendingUpdateRef.current = true;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      flushStreamUpdate();
    });
  }, [flushStreamUpdate]);

  const ensureAssistantReplayMessage = useCallback(() => {
    if (assistantMsgIdRef.current) return assistantMsgIdRef.current;
    const assistantId = `assistant-replay-${Date.now()}`;
    assistantMsgIdRef.current = assistantId;
    setMessages(prev => [...prev, {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      isStreaming: true,
    }]);
    setIsStreaming(true);
    setShimmerText('');
    return assistantId;
  }, []);

  const handleStreamTextChunk = useCallback((chunk: string) => {
    ensureAssistantReplayMessage();
    if (chunk.includes('__RESET__')) {
      while (feedRef.current.length > 0 && feedRef.current[feedRef.current.length - 1].kind === 'text') {
        feedRef.current.pop();
      }
      scheduleStreamUpdate();
      return;
    }

    const lastIdx = feedRef.current.length - 1;
    if (lastIdx >= 0 && feedRef.current[lastIdx].kind === 'text') {
      const last = feedRef.current[lastIdx] as { kind: 'text'; text: string; isStreaming?: boolean };
      feedRef.current[lastIdx] = { kind: 'text', text: last.text + chunk, isStreaming: true };
    } else {
      feedRef.current.push({ kind: 'text', text: chunk, isStreaming: true });
    }
    scheduleStreamUpdate();
  }, [ensureAssistantReplayMessage, scheduleStreamUpdate]);

  const handleThinkingEvent = useCallback((thought: string) => {
    if (!thought) return; // empty = post-LLM clear signal; let stream-end handle it
    const isGeneric =
      thought === 'Thinking...'
      || thought.startsWith('[Reasoning:')
      || thought.startsWith('[Reasoning ')
      || thought.startsWith('Paused');
    if (isGeneric) return;
    const next = { text: thought.trim(), at: Date.now() };
    if (!next.text) return;

    const canAppendToCurrent =
      thinkingBatchRef.current.length > 0
      && Date.now() <= thinkingAppendWindowUntilRef.current
      && thinkingBatchRef.current.length < MAX_THINKING_BATCH_LINES;

    if (canAppendToCurrent) {
      const lastText = thinkingBatchRef.current[thinkingBatchRef.current.length - 1]?.text;
      if (lastText !== next.text) {
        thinkingBatchRef.current = [...thinkingBatchRef.current, next];
        thinkingVisibleUntilRef.current = Math.max(thinkingVisibleUntilRef.current, Date.now() + 1800);
        thinkingAppendWindowUntilRef.current = Date.now() + THINKING_PAIR_WINDOW_MS;
        setShimmerText(thinkingBatchRef.current.map((item) => item.text).join('\n'));
      }
      autoScroll();
      return;
    }

    if (thinkingBatchRef.current.length === 0 && !shimmerText) {
      thinkingBatchRef.current = [next];
      thinkingVisibleUntilRef.current = Date.now() + MIN_THINKING_VISIBLE_MS;
      thinkingAppendWindowUntilRef.current = Date.now() + THINKING_PAIR_WINDOW_MS;
      setShimmerText(next.text);
      autoScroll();
      return;
    }

    thinkingQueueRef.current.push(next);
    scheduleThinkingAdvance();
    autoScroll();
  }, [autoScroll, scheduleThinkingAdvance, shimmerText]);

  const handleWorkflowPlanTextEvent = useCallback((chunk: string) => {
    setWorkflowPlanDraft(prev => prev + chunk);
    setIsWorkflowPlanStreaming(true);
    requestAnimationFrame(() => autoScroll());
  }, [autoScroll]);

  const handleWorkflowPlanResetEvent = useCallback(() => {
    setWorkflowPlanDraft('');
    setIsWorkflowPlanStreaming(true);
  }, []);

  const handleWorkflowPlanEndEvent = useCallback(() => {
    setIsWorkflowPlanStreaming(false);
  }, []);

  const handleToolActivityEvent = useCallback((activity: { name: string; status: string; detail?: string }) => {
    ensureAssistantReplayMessage();

    if (activity.status === 'running') {
      // Freeze any in-progress text item so text + shimmer don't interleave
      const lastIdx = feedRef.current.length - 1;
      if (lastIdx >= 0 && feedRef.current[lastIdx].kind === 'text') {
        feedRef.current[lastIdx] = { ...feedRef.current[lastIdx], isStreaming: false } as FeedItem;
      }
      scheduleStreamUpdate();
      handleThinkingEvent(toolToShimmerLabel(activity.name, activity.detail));
    } else if (activity.status === 'awaiting_approval') {
      setShimmerText('Waiting for approval…');
      autoScroll();
    } else if (activity.status === 'needs_human') {
      setShimmerText('Needs your input…');
      autoScroll();
    }
  }, [autoScroll, ensureAssistantReplayMessage, handleThinkingEvent, scheduleStreamUpdate]);

  const handleToolStreamEvent = useCallback((payload: { toolId: string; toolName: string; chunk: string }) => {
    setStreamMap(prev => {
      const existing = prev[payload.toolId] ?? [];
      const next = existing.length >= 200
        ? [...existing.slice(-199), payload.chunk]
        : [...existing, payload.chunk];
      return { ...prev, [payload.toolId]: next };
    });
  }, []);

  const handleStreamEndEvent = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    flushStreamUpdate();
    if (assistantMsgIdRef.current) {
      const finalFeed = [...feedRef.current].map(item =>
        item.kind === 'text' ? { ...item, isStreaming: false } : item
      ) as FeedItem[];
      setMessages(prev => prev.map(m =>
        m.id === assistantMsgIdRef.current
          ? {
              ...m,
              feed: finalFeed,
              content: finalFeed.filter(i => i.kind === 'text').map(i => (i as any).text).join('\n\n'),
              toolCalls: finalFeed.filter(i => i.kind === 'tool').map(i => (i as any).tool),
              isStreaming: false,
            }
          : m,
      ));
    }
    setIsStreaming(false);
    setShimmerText('');
    thinkingQueueRef.current = [];
    thinkingBatchRef.current = [];
    clearThinkingAdvanceTimer();
    assistantMsgIdRef.current = null;
  }, [clearThinkingAdvanceTimer, flushStreamUpdate]);

  useEffect(() => {
    if (!loadConversationId) return;
    const api = (window as any).clawdia;
    if (!api) return;

    // If a replay buffer is provided we're attaching to a live/recently-live
    // process. The buffer is the authoritative source of truth for what happened
    // in the current run — skip loading DB messages (which are incomplete
    // mid-stream) and let the replay effect reconstruct the view.
    if (replayBuffer && replayBuffer.length > 0) {
      replayedBufferRef.current = null;
      assistantMsgIdRef.current = null;
      feedRef.current = [];
      setStreamMap({});
      setWorkflowPlanDraft('');
      setIsWorkflowPlanStreaming(false);
      setIsStreaming(false);
      setShimmerText('');
      thinkingQueueRef.current = [];
      thinkingBatchRef.current = [];
      clearThinkingAdvanceTimer();
      setMessages([]);
      setLoadedConversationId(loadConversationId);
      api.chat.getMode(loadConversationId).then((conversation: any) => {
        setConversationMode(conversation?.mode || 'chat');
        setClaudeStatus(conversation?.claudeTerminalStatus || 'idle');
      }).catch(() => {});
      return;
    }

    api.chat.load(loadConversationId).then((result: any) => {
      replayedBufferRef.current = null;
      assistantMsgIdRef.current = null;
      feedRef.current = [];
      setStreamMap({});
      setWorkflowPlanDraft('');
      setIsWorkflowPlanStreaming(false);
      setIsStreaming(false);
      setShimmerText('');
      thinkingQueueRef.current = [];
      thinkingBatchRef.current = [];
      clearThinkingAdvanceTimer();
      setMessages(result.messages || []);
      setLoadedConversationId(loadConversationId);
      setConversationMode(result.mode || 'chat');
      setClaudeStatus(result.claudeTerminalStatus || 'idle');
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    }).catch(() => {});
  }, [loadConversationId, replayBuffer]);

  useEffect(() => () => clearThinkingAdvanceTimer(), [clearThinkingAdvanceTimer]);

  useEffect(() => {
    if (!replayBuffer || replayBuffer.length === 0 || !loadConversationId || loadedConversationId !== loadConversationId) return;
    const replayKey = `${loadConversationId}:${replayBuffer.length}:${JSON.stringify(replayBuffer[replayBuffer.length - 1])}`;
    if (replayedBufferRef.current === replayKey) return;
    replayedBufferRef.current = replayKey;

    feedRef.current = [];
    setStreamMap({});
    setShimmerText('');
    setIsStreaming(true);

    const replay = async () => {
      let sawStreamEnd = false;
      for (const item of replayBuffer) {
        if (item.type === 'chat:stream:text') handleStreamTextChunk(item.data);
        if (item.type === 'chat:workflow-plan:text') handleWorkflowPlanTextEvent(item.data);
        if (item.type === 'chat:workflow-plan:end') handleWorkflowPlanEndEvent();
        if (item.type === 'chat:thinking') handleThinkingEvent(item.data);
        if (item.type === 'chat:tool-activity') handleToolActivityEvent(item.data);
        if (item.type === 'chat:tool-stream') handleToolStreamEvent(item.data);
        if (item.type === 'chat:stream:end') { handleStreamEndEvent(); sawStreamEnd = true; }
      }
      if (assistantMsgIdRef.current) {
        flushStreamUpdate();
      }
      // If the process is still running (no stream:end in buffer), stay in
      // streaming mode so live events continue to render correctly.
      if (!sawStreamEnd && assistantMsgIdRef.current) {
        setIsStreaming(true);
      }
    };

    void replay();
  }, [
    replayBuffer,
    loadConversationId,
    loadedConversationId,
    handleStreamTextChunk,
    handleWorkflowPlanTextEvent,
    handleWorkflowPlanEndEvent,
    handleThinkingEvent,
    handleToolActivityEvent,
    handleToolStreamEvent,
    handleStreamEndEvent,
    flushStreamUpdate,
  ]);

  useEffect(() => {
    const api = (window as any).clawdia;
    if (!api?.process || !api?.run) return;

    const syncPendingApproval = async (processes: ProcessInfo[]) => {
      const attachedProcess = processes.find((proc) => proc.isAttached);

      const attachedBlocked = processes.find((proc) => proc.isAttached && proc.status === 'awaiting_approval');
      if (!attachedBlocked) {
        setPendingApprovalRunId(null);
        setPendingApprovals([]);
        if (!isWorkflowPlanStreaming) setWorkflowPlanDraft('');
      } else {
        setPendingApprovalRunId(attachedBlocked.id);
        const approvals = await api.run.approvals(attachedBlocked.id);
        const pending = (approvals || []).filter((approval: RunApproval) => approval.status === 'pending');
        setPendingApprovals(pending);
        const workflowApproval = pending.find((approval: RunApproval) => approval.actionType === 'workflow_plan');
        if (workflowApproval?.request?.plan) {
          setWorkflowPlanDraft(String(workflowApproval.request.plan));
          setIsWorkflowPlanStreaming(false);
        }
      }

      const attachedNeedsHuman = processes.find((proc) => proc.isAttached && proc.status === 'needs_human');
      if (!attachedNeedsHuman) {
        setPendingHumanRunId(null);
        setPendingHumanInterventions([]);
      } else {
        setPendingHumanRunId(attachedNeedsHuman.id);
        const interventions = await api.run.humanInterventions(attachedNeedsHuman.id);
        setPendingHumanInterventions((interventions || []).filter((item: RunHumanIntervention) => item.status === 'pending'));
      }
    };

    api.process.list().then(syncPendingApproval).catch(() => {});
    const cleanup = api.process.onListChanged((processes: ProcessInfo[]) => {
      syncPendingApproval(processes).catch(() => {});
    });
    return cleanup;
  }, [isWorkflowPlanStreaming]);

  useEffect(() => {
    const api = (window as any).clawdia;
    if (!api) return;
    const cleanups: (() => void)[] = [];

    cleanups.push(api.chat.onStreamText(handleStreamTextChunk));

    cleanups.push(api.chat.onThinking(handleThinkingEvent));
    if (api.chat.onWorkflowPlanText) {
      cleanups.push(api.chat.onWorkflowPlanText(handleWorkflowPlanTextEvent));
    }
    if (api.chat.onWorkflowPlanReset) {
      cleanups.push(api.chat.onWorkflowPlanReset(handleWorkflowPlanResetEvent));
    }
    if (api.chat.onWorkflowPlanEnd) {
      cleanups.push(api.chat.onWorkflowPlanEnd(handleWorkflowPlanEndEvent));
    }

    cleanups.push(api.chat.onToolActivity(handleToolActivityEvent));

    if (api.chat.onToolStream) {
      cleanups.push(api.chat.onToolStream(handleToolStreamEvent));
    }

    cleanups.push(api.chat.onStreamEnd(handleStreamEndEvent));
    if (api.chat.onClaudeStatus) {
      cleanups.push(api.chat.onClaudeStatus((payload: { conversationId: string; status: 'idle' | 'starting' | 'ready' | 'working' | 'errored' | 'stopped' }) => {
        if (payload.conversationId === loadedConversationId) {
          setClaudeStatus(payload.status);
        }
      }));
    }

    return () => {
      cleanups.forEach(fn => fn());
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [handleStreamEndEvent, handleStreamTextChunk, handleThinkingEvent, handleWorkflowPlanResetEvent, handleWorkflowPlanTextEvent, handleWorkflowPlanEndEvent, handleToolActivityEvent, handleToolStreamEvent, loadedConversationId]);

  const handleToggleClaudeMode = useCallback(async () => {
    const api = (window as any).clawdia;
    if (!api) return;
    let conversationId = loadedConversationId || loadConversationId;
    if (!conversationId) {
      const created = await api.chat.new();
      if (!created?.id) return;
      conversationId = created.id;
      setLoadedConversationId(created.id);
      setMessages([]);
      setConversationMode('chat');
      setClaudeStatus('idle');
    }
    const nextMode = conversationMode === 'claude_terminal' ? 'chat' : 'claude_terminal';
    const result = await api.chat.setMode(conversationId, nextMode);
    if (result?.error) return;
    if (nextMode === 'claude_terminal' && !terminalOpen) {
      onToggleTerminal();
    }
    setConversationMode(nextMode);
    setClaudeStatus(result.claudeTerminalStatus || (nextMode === 'claude_terminal' ? 'idle' : 'stopped'));
  }, [conversationMode, loadConversationId, loadedConversationId, onToggleTerminal, terminalOpen]);

  const handleSend = useCallback(async (text: string, attachments: MessageAttachment[] = []) => {
    const api = (window as any).clawdia;
    if (!api) return;

    isUserScrolledUpRef.current = false;

    const userMsg: Message = {
      id: `user-${Date.now()}`, role: 'user', content: text, attachments,
      timestamp: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    };
    setMessages(prev => [...prev, userMsg]);
    setTimeout(() => scrollToBottom('smooth'), 50);

    const assistantId = `assistant-${Date.now()}`;
    assistantMsgIdRef.current = assistantId;
    feedRef.current = [];
    setStreamMap({});
    setWorkflowPlanDraft('');
    setIsWorkflowPlanStreaming(false);

    setTimeout(() => {
      setMessages(prev => [...prev, {
        id: assistantId, role: 'assistant', content: '',
        timestamp: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        isStreaming: true,
      }]);
      setIsStreaming(true);
    }, 100);

    try {
      const result = await api.chat.send(text, attachments);

      const finalFeed = [...feedRef.current].map(item =>
        item.kind === 'text' ? { ...item, isStreaming: false } : item
      ) as FeedItem[];
      const finalContent = result.response ||
        finalFeed.filter(i => i.kind === 'text').map(i => (i as any).text).join('\n\n') || '';
      const finalTools = finalFeed.filter(i => i.kind === 'tool').map(i => (i as any).tool) as ToolCall[];

      if (result.error) {
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, content: `⚠️ ${result.error}`, isStreaming: false, feed: [], toolCalls: [] } : m
        ));
      } else {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? {
                ...m,
                content: finalContent,
                toolCalls: finalTools,
                feed: finalFeed,
                isStreaming: false,
                fileRefs: result.fileRefs,
                linkPreviews: result.linkPreviews,
              }
            : m
        ));
      }

      setIsStreaming(false);
      setShimmerText('');
      setWorkflowPlanDraft('');
      setIsWorkflowPlanStreaming(false);
      assistantMsgIdRef.current = null;
      isUserScrolledUpRef.current = false;
      requestAnimationFrame(() => scrollToBottom('smooth'));
    } catch (err: any) {
      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, content: `⚠️ ${err.message || 'Unknown error'}`, isStreaming: false } : m
      ));
      setIsStreaming(false);
      setShimmerText('');
      setWorkflowPlanDraft('');
      setIsWorkflowPlanStreaming(false);
      assistantMsgIdRef.current = null;
    }
  }, [scrollToBottom]);

  const handleStop = useCallback(() => {
    (window as any).clawdia?.chat.stop();
    setIsStreaming(false);
    setIsPaused(false);
    setShimmerText('');
  }, []);

  const handlePause = useCallback(() => {
    (window as any).clawdia?.chat.pause();
    setIsPaused(true);
  }, []);

  const handleResume = useCallback(() => {
    (window as any).clawdia?.chat.resume();
    setIsPaused(false);
  }, []);

  const handleRateTool = useCallback((messageId: string, toolId: string, rating: 'up' | 'down' | null, note?: string) => {
    const api = (window as any).clawdia;
    if (!api) return;
    const applyRating = (tc: ToolCall) => {
      if (tc.id !== toolId) return tc;
      const updated = { ...tc, rating };
      if (note !== undefined) updated.ratingNote = note;
      if (rating === null) { updated.rating = null; updated.ratingNote = undefined; }
      if (rating === 'up') { updated.ratingNote = undefined; }
      return updated;
    };
    // Update local state immediately for responsive UI
    setMessages(prev => prev.map(m => {
      if (m.id !== messageId) return m;
      const updates: Partial<Message> = {};
      if (m.toolCalls) updates.toolCalls = m.toolCalls.map(applyRating);
      if (m.feed) updates.feed = m.feed.map(item =>
        item.kind === 'tool' ? { kind: 'tool', tool: applyRating(item.tool) } : item
      ) as FeedItem[];
      return { ...m, ...updates };
    }));
    // Persist to database
    api.chat.rateTool(messageId, toolId, rating, note);
  }, []);

  const handleAddContext = useCallback((text: string) => {
    (window as any).clawdia?.chat.addContext(text);
    // Show it in the chat as a visual indicator
    const contextMsg: Message = {
      id: `context-${Date.now()}`,
      role: 'user',
      content: `💬 ${text}`,
      timestamp: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    };
    setMessages(prev => [...prev, contextMsg]);
    requestAnimationFrame(() => scrollToBottom('smooth'));
  }, [scrollToBottom]);

  const handleApprovalDecision = useCallback(async (decision: 'approve' | 'revise' | 'deny') => {
    const api = (window as any).clawdia;
    const approval = pendingApprovals[0];
    if (!api?.run || !approval) return;

    if (decision === 'approve') await api.run.approve(approval.id);
    else if (decision === 'revise') await api.run.revise(approval.id);
    else await api.run.deny(approval.id);

    if (pendingApprovalRunId) {
      const approvals = await api.run.approvals(pendingApprovalRunId);
      const pending = (approvals || []).filter((item: RunApproval) => item.status === 'pending');
      setPendingApprovals(pending);
      const workflowApproval = pending.find((item: RunApproval) => item.actionType === 'workflow_plan');
      if (!workflowApproval) {
        setWorkflowPlanDraft('');
        setIsWorkflowPlanStreaming(false);
      }
    }
  }, [pendingApprovalRunId, pendingApprovals]);

  const handleHumanResume = useCallback(async () => {
    const api = (window as any).clawdia;
    const intervention = pendingHumanInterventions[0];
    if (!api?.run || !intervention) return;

    await api.run.resolveHumanIntervention(intervention.id);

    if (pendingHumanRunId) {
      const interventions = await api.run.humanInterventions(pendingHumanRunId);
      setPendingHumanInterventions((interventions || []).filter((item: RunHumanIntervention) => item.status === 'pending'));
    }
  }, [pendingHumanInterventions, pendingHumanRunId]);

  const handleCancelRun = useCallback(() => {
    (window as any).clawdia?.chat.stop();
    setPendingHumanRunId(null);
    setPendingHumanInterventions([]);
  }, []);

  const workflowPlanApproval = pendingApprovals.find((approval) => approval.actionType === 'workflow_plan');
  const visiblePlanText = workflowPlanApproval?.request?.plan
    ? String(workflowPlanApproval.request.plan)
    : workflowPlanDraft;
  const nonWorkflowApproval = pendingApprovals.find((approval) => approval.actionType !== 'workflow_plan');

  return (
    <div className="flex flex-col h-full">
      {/* Icons row — terminal + settings */}
      <div
        className="drag-region flex items-center justify-end gap-1 px-2 h-[44px] flex-shrink-0 relative z-10"
        style={{
          background: '#09090c',
          borderBottom: '2px solid rgba(255,255,255,0.08)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.4), inset 0 -1px 0 rgba(255,255,255,0.025)',
        }}
      >
        <button
          onClick={onToggleTerminal}
          title={terminalOpen ? 'Close terminal' : 'Open terminal'}
          className={`no-drag flex items-center justify-center w-8 h-8 rounded-lg transition-all cursor-pointer ${
            terminalOpen
              ? 'bg-white/[0.08] text-text-primary'
              : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.06]'
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
            <path d="m7 9 3 3-3 3" />
            <path d="M12 15h5" />
          </svg>
        </button>
        <button onClick={onOpenSettings} title="Settings" className="no-drag flex items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-all cursor-pointer">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      {/* Tab strip row — tabs + new tab button */}
      <TabStrip
        tabs={tabs}
        activeTabId={activeTabId}
        onSwitch={onSwitchTab}
        onClose={onCloseTab}
        onNew={onNewTab}
      />

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth">
        <div className="flex flex-col gap-4 px-4 pt-5 pb-8 max-w-[720px]">
          {messages.map(msg =>
            msg.role === 'assistant'
              ? <AssistantMessage key={msg.id} message={msg} shimmerText={msg.isStreaming ? shimmerText : undefined} />
              : <UserMessage key={msg.id} message={msg} />
          )}
          {pendingApprovalRunId && nonWorkflowApproval && (
            <div className="flex justify-start animate-slide-up">
              <div className="max-w-[92%] px-1 py-1 text-text-primary">
                <ApprovalBanner
                  approval={nonWorkflowApproval}
                  onApprove={() => handleApprovalDecision('approve')}
                  onDeny={() => handleApprovalDecision('deny')}
                  onOpenReview={() => onOpenPendingApproval?.(pendingApprovalRunId)}
                />
              </div>
            </div>
          )}
          <div className="h-2" />
        </div>
      </div>

      <SwarmPanel />

      <InputBar
        onSend={handleSend}
        isStreaming={isStreaming}
        isPaused={isPaused}
        onStop={handleStop}
        onPause={handlePause}
        onResume={handleResume}
        onAddContext={handleAddContext}
        claudeMode={conversationMode === 'claude_terminal'}
        claudeStatus={claudeStatus}
        onToggleClaudeMode={handleToggleClaudeMode}
        claudeModeDisabled={false}
      />

    </div>
  );
}

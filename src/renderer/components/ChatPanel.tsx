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
  PromptDebugSnapshot,
} from '../../shared/types';
import InputBar from './InputBar';
import ToolActivityComponent from './ToolActivity';
import { type ToolStreamMap } from './ToolActivity';
import MarkdownRenderer from './MarkdownRenderer';
import SwarmPanel from './SwarmPanel';
import TabStrip from './TabStrip';
import PipelineBlock from './PipelineBlock';
import HistoryBrowser from './HistoryBrowser';

type StreamEndPayload = {
  ok?: boolean;
  isPipelineStart?: boolean;
  pipelineMessageId?: string;
  error?: string;
  cancelled?: boolean;
};

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
  tabs: import('../tabLogic').ConversationTab[];
  activeTabId: string;
  onNewTab: () => void;
  onCloseTab: (tabId: string) => void;
  onSwitchTab: (tabId: string) => void;
  onOpenConversation: (id: string) => void;
  onConversationTitleResolved: (tabId: string, title: string) => void;
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

function codexStageIndex(text?: string): 0 | 1 | 2 {
  const value = (text || '').toLowerCase();
  if (value.includes('draft')) return 2;
  if (value.includes('inspect') || value.includes('analyz') || value.includes('plan')) return 1;
  return 0;
}

function CodexWaitingCard({ text }: { text: string }) {
  const stages = ['Boot', 'Inspect', 'Draft'];
  const activeStage = codexStageIndex(text);

  return (
    <div className="max-w-[520px] py-1">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="codex-orb" aria-hidden />
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200/80">Codex</div>
            <div className="mt-1 text-[12px] text-white/58">Working inside your Clawdia workspace</div>
          </div>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-100/65">
          live
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        {stages.map((stage, idx) => {
          const isActive = idx === activeStage;
          const isComplete = idx < activeStage;
          return (
            <div
              key={stage}
              className={`font-mono text-[10px] uppercase tracking-[0.18em] transition-colors ${
                isActive
                  ? 'text-emerald-100'
                  : isComplete
                    ? 'text-white/72'
                    : 'text-white/38'
              }`}
            >
              {stage}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-start gap-3">
        <div className="codex-scan-bars mt-0.5" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[13px] leading-6 text-emerald-50/92">{text}</div>
          <div className="mt-1 text-[12px] text-white/42">Terminal-native execution, chat-native presentation.</div>
        </div>
      </div>
    </div>
  );
}

function tokenizeTranscriptLine(line: string): Array<{ text: string; kind: 'text' | 'code' | 'path' }> {
  const pattern = /(`[^`]+`|(?:\/[\w.@-]+)+(?:[:#]\d+(?::\d+)?)?|\b[\w.-]+\.(?:ts|tsx|js|jsx|json|md|css|html|sh|yml|yaml|sql|py|go|rs)(?:[:#]\d+(?::\d+)?)?)/g;
  const tokens: Array<{ text: string; kind: 'text' | 'code' | 'path' }> = [];
  let lastIndex = 0;

  for (const match of line.matchAll(pattern)) {
    const start = match.index ?? 0;
    const value = match[0];
    if (start > lastIndex) tokens.push({ text: line.slice(lastIndex, start), kind: 'text' });
    if (value.startsWith('`') && value.endsWith('`')) {
      tokens.push({ text: value.slice(1, -1), kind: 'code' });
    } else {
      tokens.push({ text: value, kind: 'path' });
    }
    lastIndex = start + value.length;
  }

  if (lastIndex < line.length) tokens.push({ text: line.slice(lastIndex), kind: 'text' });
  return tokens.length > 0 ? tokens : [{ text: line, kind: 'text' }];
}

function renderTranscriptTokens(line: string, keyPrefix: string) {
  return tokenizeTranscriptLine(line).map((token, idx) => {
    if (token.kind === 'code') {
      return (
        <code key={`${keyPrefix}-code-${idx}`} className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.92em] text-[#f0f4f8]">
          {token.text}
        </code>
      );
    }
    if (token.kind === 'path') {
      return (
        <span key={`${keyPrefix}-path-${idx}`} className="font-mono text-[0.95em] text-[#9fd3ff]">
          {token.text}
        </span>
      );
    }
    return <React.Fragment key={`${keyPrefix}-text-${idx}`}>{token.text}</React.Fragment>;
  });
}

function classifyTranscriptLine(line: string): 'blank' | 'command' | 'bullet' | 'numbered' | 'status' | 'heading' | 'body' {
  if (!line.trim()) return 'blank';
  if (/^\$ /.test(line) || /^> /.test(line)) return 'command';
  if (/^(\-|\*|•)\s+/.test(line)) return 'bullet';
  if (/^\d+\.\s+/.test(line)) return 'numbered';
  if (/^(Verification|Note|Notes|Status|Result|Results|Error|Warning|Warnings|Updated|Changed):/.test(line)) return 'status';
  if (/^[A-Z][A-Za-z0-9 /()+-]{1,80}:$/.test(line.trim())) return 'heading';
  return 'body';
}

function TerminalTranscriptCard({
  message,
  showStreamingStatus,
  onOpenTerminal,
}: {
  message: Message;
  showStreamingStatus: boolean;
  onOpenTerminal: () => void;
}) {
  const isStreaming = showStreamingStatus;
  const [elapsedSec, setElapsedSec] = useState(0);
  const lines = message.content.split(/\r?\n/);

  useEffect(() => {
    if (!isStreaming) {
      setElapsedSec(0);
      return;
    }

    const startedAt = Date.now();
    setElapsedSec(0);
    const interval = window.setInterval(() => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isStreaming, message.id]);

  const elapsedLabel = elapsedSec < 60
    ? `${elapsedSec}s`
    : `${Math.floor(elapsedSec / 60)}m ${String(elapsedSec % 60).padStart(2, '0')}s`;

  return (
    <div className="flex justify-start animate-slide-up group">
      <div className="max-w-[92%] px-1 py-2 text-text-primary">
        <div className="flex flex-col gap-1.5">
          {lines.map((line, idx) => {
            const kind = classifyTranscriptLine(line);
            if (kind === 'blank') return <div key={`${message.id}-blank-${idx}`} className="h-2" />;
            if (kind === 'heading') {
              return (
                <div key={`${message.id}-heading-${idx}`} className="pt-1 text-[14px] font-semibold tracking-[-0.01em] text-white/92">
                  {renderTranscriptTokens(line, `${message.id}-heading-${idx}`)}
                </div>
              );
            }
            if (kind === 'status') {
              return (
                <div key={`${message.id}-status-${idx}`} className="text-[14px] leading-7 text-white/82">
                  <span className="font-medium text-[#c8f7d2]">
                    {renderTranscriptTokens(line, `${message.id}-status-${idx}`)}
                  </span>
                </div>
              );
            }
            if (kind === 'command') {
              return (
                <div key={`${message.id}-command-${idx}`} className="font-mono text-[13px] leading-7 text-[#e6edf3]">
                  <span className="mr-2 text-[#7ee787]">{line[0]}</span>
                  {renderTranscriptTokens(line.slice(2), `${message.id}-command-${idx}`)}
                </div>
              );
            }
            if (kind === 'bullet' || kind === 'numbered') {
              const markerMatch = kind === 'bullet'
                ? line.match(/^(\-|\*|•)\s+(.*)$/)
                : line.match(/^(\d+\.)\s+(.*)$/);
              const marker = markerMatch?.[1] ?? '';
              const body = markerMatch?.[2] ?? line;
              return (
                <div key={`${message.id}-list-${idx}`} className="flex items-start gap-3 text-[14px] leading-7 text-white/82">
                  <span className="mt-[1px] min-w-[20px] font-mono text-white/44">{marker}</span>
                  <div className="min-w-0 flex-1">{renderTranscriptTokens(body, `${message.id}-list-${idx}`)}</div>
                </div>
              );
            }
            return (
              <div key={`${message.id}-body-${idx}`} className="text-[14px] leading-7 text-white/82">
                {renderTranscriptTokens(line, `${message.id}-body-${idx}`)}
              </div>
            );
          })}
          {isStreaming && !message.content && (
            <div className="font-mono text-[13px] leading-7 text-white/44">Waiting for output…</div>
          )}
        </div>
        {isStreaming && (
          <div className="mt-4 flex w-[36rem] max-w-full items-center gap-3">
            <div className="thinking-shimmer-line h-[2px] min-w-0 flex-1 rounded-full" aria-hidden />
            <div className="flex flex-shrink-0 items-center gap-2 text-[11px] text-text-secondary/78">
              <span className="inline-shimmer">Still working…</span>
              <span className="font-mono text-white/42">{elapsedLabel}</span>
            </div>
            <div className="thinking-shimmer-line h-[2px] min-w-0 flex-1 rounded-full" aria-hidden />
          </div>
        )}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[11px] text-text-secondary/70">{message.timestamp}</span>
          {!isStreaming && message.content && <CopyButton text={message.content} />}
          <button
            onClick={onOpenTerminal}
            className="rounded px-1.5 py-0.5 text-[11px] text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-text-primary"
          >
            Open terminal
          </button>
        </div>
      </div>
    </div>
  );
}

const AssistantMessage = React.memo(function AssistantMessage({
  message,
  shimmerText,
  streamMode,
  onOpenTerminal,
}: {
  message: Message;
  shimmerText?: string;
  streamMode?: 'chat' | 'claude_terminal' | 'codex_terminal';
  onOpenTerminal: () => void;
}) {
  // Live path: active streaming message (feed may be empty while shimmer is showing)
  if (message.isStreaming || (message.feed && message.feed.length > 0)) {
    const hasContent = (message.feed ?? []).some(item =>
      (item.kind === 'text' && item.text.trim()) || item.kind === 'tool'
    );
    if (!hasContent && !shimmerText) return null;

    return (
      <div className="flex justify-start animate-slide-up group">
        <div className="w-full px-1 py-2 text-text-primary flex flex-col gap-3">
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
  }

  // Fallback: DB-loaded historical messages
  const hasContent = !!message.content?.trim();
  if (!hasContent && !message.toolCalls?.length) return null;
  if (message.type === 'terminal_transcript') {
    return <TerminalTranscriptCard message={message} showStreamingStatus={false} onOpenTerminal={onOpenTerminal} />;
  }
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

function CodexEmptyState({
  onSend,
}: {
  onSend: (text: string) => void;
}) {
  const examples = [
    'Launch Photoshop and prepare example.png for printing at 24x36.',
    'Use my Twitch session and set up OBS to start a stream.',
    'Open my browser, navigate a signed-in site, and collect the information I need.',
    'Inspect this project on disk and implement a fix.',
  ];

  return (
    <div className="flex items-start px-1 pt-6 pb-10 text-left text-white">
      <div className="w-full">

        {/* Title block */}
        <div className="mb-1">
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] mb-2" style={{ color: '#9ab8f7cc' }}>
            Codex
          </div>
          <h1 className="font-mono text-[22px] font-bold leading-[1.2] tracking-[-0.02em] text-white/90">
            powered by Clawdia
          </h1>
        </div>

        {/* Divider */}
        <div className="mt-4 mb-5 h-px w-12" style={{ backgroundColor: '#9ab8f730' }} />

        {/* Description */}
        <p className="text-[13.5px] leading-[1.75] text-white/58">
          Uses your desktop apps, browser sessions, authenticated sites, and local files to complete tasks across your machine.
        </p>

        {/* Examples */}
        <div className="mt-6">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/30">
            Try asking
          </div>
          <div className="flex flex-col gap-1.5">
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => onSend(example)}
                className="group flex w-fit max-w-full items-baseline gap-2.5 text-left focus:outline-none"
              >
                <span className="font-mono text-[13px] text-white/20 transition-colors group-hover:text-[#9ab8f7]/60 select-none leading-none">—</span>
                <span className="text-[15px] leading-[1.65] transition-colors border-b border-transparent group-hover:border-[#9ab8f7]/20" style={{ color: '#9ab8f7cc' }} onMouseEnter={e => (e.currentTarget.style.color = '#9ab8f7')} onMouseLeave={e => (e.currentTarget.style.color = '#9ab8f7cc')}>
                  {example}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* How it works */}
        <details className="mt-6 w-full group/det">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/28 transition-colors hover:text-white/60 select-none w-fit">
            <span className="font-mono text-[11px] inline-block group-open/det:[content:'▾']">▸</span>
            <span>How it works</span>
          </summary>
          <div className="mt-4 flex flex-col gap-3 pl-4 border-l border-white/8">
            {[
              'For desktop tasks, Codex uses the Clawdia engine to launch apps, move through UI, open files, and perform multi-step actions.',
              'For browser tasks, Codex operates inside the Clawdia browser using authenticated sessions from persisted cookies.',
              'For local work, Codex inspects files, traces codebases, and combines filesystem actions with browser and desktop workflows.',
            ].map((para) => (
              <p key={para} className="text-[12.5px] leading-[1.7] text-white/42">{para}</p>
            ))}
          </div>
        </details>

      </div>
    </div>
  );
}

function ClawdiaEmptyState({
  onSend,
}: {
  onSend: (text: string) => void;
}) {
  const accent = '#e2e8f0';
  const accentDim = 'rgba(226,232,240,0.7)';
  const accentBg = 'rgba(226,232,240,0.08)';

  const sections = [
    {
      label: 'Desktop automation',
      examples: [
        'Open Photoshop, load my file, export it as a 300dpi PDF, and close it.',
        'Launch OBS, set up my stream scene, and go live on my Twitch session.',
        'Navigate the app menu to find the export option and fill in the dialog.',
      ],
    },
    {
      label: 'Browser + authenticated sessions',
      examples: [
        'Log into my dashboard using my saved session and pull this week\'s data.',
        'Go through my open tabs, find duplicates, and summarize what each one is.',
        'Use my signed-in account to grab all my invoices from this month.',
      ],
    },
    {
      label: 'Desktop + browser combined',
      examples: [
        'Open my email in the browser, read the brief, then create the file on disk.',
        'Watch what\'s on my screen right now and tell me what needs attention.',
      ],
    },
    {
      label: 'Code + terminal',
      examples: [
        'Run my tests, trace what\'s failing, and fix it without me touching anything.',
        'Search this entire codebase for where this bug originates and patch it.',
      ],
    },
    {
      label: 'Cross-system',
      examples: [
        'Learn this app\'s interface, map every button, and tell me what it can do.',
        'Check my running apps, see what\'s using the most memory, and fix it.',
      ],
    },
  ];

  return (
    <div className="flex items-start px-1 pt-6 pb-10 text-left text-white">
      <div className="w-full">

        {/* Title block */}
        <div className="mb-1">
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] mb-2" style={{ color: 'rgba(226,232,240,0.5)' }}>
            Clawdia
          </div>
          <h1 className="font-mono text-[22px] font-bold leading-[1.2] tracking-[-0.02em] text-white/90">
            Where models get to work.
          </h1>
        </div>

        {/* Divider */}
        <div className="mt-4 mb-5 h-px w-12" style={{ backgroundColor: accentBg }} />

        {/* Description */}
        <p className="text-[13.5px] leading-[1.75] text-white/58">
          Connect any model to your desktop apps, browser sessions, local files, and terminal — and let it get things done.
        </p>

        {/* Sections */}
        <div className="mt-6 flex flex-col gap-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/30">
            Try asking
          </div>
          {sections.map((section) => (
            <details key={section.label} className="group/sec w-full">
              <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-[14px] font-semibold uppercase tracking-[0.1em] text-white/28 transition-colors hover:text-white/60 select-none w-fit">
                <span className="font-mono text-[11px] inline-block group-open/sec:[content:'▾']">▸</span>
                <span>{section.label}</span>
              </summary>
              <div className="mt-1.5 mb-2 flex flex-col gap-1.5 pl-4 border-l border-white/8">
                {section.examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => onSend(example)}
                    className="group/ex flex w-fit max-w-full items-baseline gap-2.5 text-left focus:outline-none"
                  >
                    <span className="font-mono text-[13px] text-white/20 transition-colors group-hover/ex:text-white/40 select-none leading-none">—</span>
                    <span
                      className="transition-colors border-b border-transparent group-hover/ex:border-white/15"
                      style={{ color: accentDim, fontSize: '15px', lineHeight: '1.65' }}
                      onMouseEnter={e => (e.currentTarget.style.color = accent)}
                      onMouseLeave={e => (e.currentTarget.style.color = accentDim)}
                    >
                      {example}
                    </span>
                  </button>
                ))}
              </div>
            </details>
          ))}
        </div>

      </div>
    </div>
  );
}

function ClaudeCodeEmptyState({
  onSend,
}: {
  onSend: (text: string) => void;
}) {
  const examples = [
    'Review this codebase and suggest architectural improvements.',
    'Write tests for the current module and fix any failures.',
    'Refactor this file to follow consistent naming conventions.',
    'Find and fix the bug causing the failing test.',
  ];

  const accent = '#f4a35a';

  return (
    <div className="flex flex-col items-center justify-center h-full w-full py-8 text-white select-none">

      {/* Wordmark */}
      <div className="flex flex-col items-center gap-[5px] mb-10">
        <div className="flex items-center gap-[9px]">
          {/* Anthropic asterisk */}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <g stroke="#f4a35a" strokeWidth="2.2" strokeLinecap="round">
              <line x1="12" y1="2" x2="12" y2="22"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
              <line x1="19.07" y1="4.93" x2="4.93" y2="19.07"/>
            </g>
          </svg>
          <span style={{ fontSize: 20, fontWeight: 600, color: 'rgba(255,255,255,0.92)', letterSpacing: '-0.02em' }}>
            Claude Code
          </span>
        </div>
        <span className="font-mono" style={{ fontSize: 9.5, letterSpacing: '0.2em', textTransform: 'uppercase', color: `${accent}73` }}>
          powered by Clawdia
        </span>
      </div>

      {/* Pixel robot mascot */}
      <svg
        width="72"
        height="72"
        viewBox="0 0 16 16"
        xmlns="http://www.w3.org/2000/svg"
        style={{ imageRendering: 'pixelated', marginBottom: 28 }}
      >
        {/* Antenna */}
        <rect x="7" y="0" width="2" height="2" fill={accent}/>
        {/* Head */}
        <rect x="4" y="2" width="8" height="5" fill={accent}/>
        {/* Eyes */}
        <rect x="5" y="3" width="2" height="2" fill="#0e0e12"/>
        <rect x="9" y="3" width="2" height="2" fill="#0e0e12"/>
        {/* Mouth */}
        <rect x="5" y="6" width="6" height="1" fill="#0e0e12"/>
        {/* Body */}
        <rect x="3" y="5" width="10" height="8" fill={accent}/>
        {/* Arms */}
        <rect x="0" y="6" width="3" height="2" fill={accent}/>
        <rect x="13" y="6" width="3" height="2" fill={accent}/>
        {/* Legs */}
        <rect x="4" y="13" width="2" height="3" fill={accent}/>
        <rect x="10" y="13" width="2" height="3" fill={accent}/>
      </svg>

      {/* Suggestions */}
      <div className="flex flex-col items-center gap-[6px] w-full" style={{ maxWidth: 400 }}>
        {examples.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onSend(example)}
            className="w-full text-center focus:outline-none"
            style={{
              fontSize: 13,
              color: 'rgba(255,255,255,0.42)',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 8,
              padding: '8px 16px',
              transition: 'background 0.15s, color 0.15s',
              cursor: 'pointer',
              border: 'none',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = `${accent}14`;
              (e.currentTarget as HTMLButtonElement).style.color = `${accent}e6`;
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.03)';
              (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.42)';
            }}
          >
            {example}
          </button>
        ))}
      </div>

    </div>
  );
}

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
    <div className="flex items-center gap-2 py-1">
      <span className="text-text-secondary text-[14px] flex-shrink-0" aria-hidden>✱</span>
      <span className="inline-shimmer leading-relaxed line-clamp-1 overflow-hidden text-ellipsis">{text}</span>
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
  onOpenConversation,
  onConversationTitleResolved,
}: ChatPanelProps) {
  const MIN_THINKING_VISIBLE_MS = 2400;
  const DEFAULT_CHAT_ZOOM = 100;
  const MIN_CHAT_ZOOM = 80;
  const MAX_CHAT_ZOOM = 160;
  const [historyMode, setHistoryMode] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [shimmerText, setShimmerText] = useState<string>('');
  const [streamMap, setStreamMap] = useState<ToolStreamMap>({});
  const [pendingApprovalRunId, setPendingApprovalRunId] = useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<RunApproval[]>([]);
  const [pendingHumanRunId, setPendingHumanRunId] = useState<string | null>(null);
  const [pendingHumanInterventions, setPendingHumanInterventions] = useState<RunHumanIntervention[]>([]);
  const [conversationMode, setConversationMode] = useState<'chat' | 'claude_terminal' | 'codex_terminal'>('chat');
  const [claudeStatus, setClaudeStatus] = useState<'idle' | 'starting' | 'ready' | 'working' | 'errored' | 'stopped'>('idle');
  const [workflowPlanDraft, setWorkflowPlanDraft] = useState('');
  const [isWorkflowPlanStreaming, setIsWorkflowPlanStreaming] = useState(false);
  const [loadedConversationId, setLoadedConversationId] = useState<string | null>(null);
  const [promptDebug, setPromptDebug] = useState<PromptDebugSnapshot | null>(null);
  const [promptDebugOpen, setPromptDebugOpen] = useState(true);
  const [activeStreamMode, setActiveStreamMode] = useState<'chat' | 'claude_terminal' | 'codex_terminal'>('chat');
  const [chatZoom, setChatZoom] = useState(DEFAULT_CHAT_ZOOM);
  const activeStreamModeRef = useRef<'chat' | 'claude_terminal' | 'codex_terminal'>('chat');
  const chatRootRef = useRef<HTMLDivElement>(null);
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

  const applyChatZoom = useCallback((nextZoom: number) => {
    setChatZoom(Math.max(MIN_CHAT_ZOOM, Math.min(MAX_CHAT_ZOOM, nextZoom)));
  }, []);

  const handleChatZoomIn = useCallback(() => {
    applyChatZoom(chatZoom + 10);
  }, [applyChatZoom, chatZoom]);

  const handleChatZoomOut = useCallback(() => {
    applyChatZoom(chatZoom - 10);
  }, [applyChatZoom, chatZoom]);

  const handleChatZoomReset = useCallback(() => {
    applyChatZoom(DEFAULT_CHAT_ZOOM);
  }, [applyChatZoom]);

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

  useEffect(() => {
    activeStreamModeRef.current = activeStreamMode;
  }, [activeStreamMode]);

  useEffect(() => {
    const root = chatRootRef.current;
    if (!root || historyMode) return;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (event.deltaY < 0) handleChatZoomIn();
      else if (event.deltaY > 0) handleChatZoomOut();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.altKey) return;

      if (event.key === '=' || event.key === '+') {
        event.preventDefault();
        handleChatZoomIn();
        return;
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        handleChatZoomOut();
        return;
      }
      if (event.key === '0') {
        event.preventDefault();
        handleChatZoomReset();
      }
    };

    root.addEventListener('wheel', handleWheel, { passive: false });
    root.addEventListener('keydown', handleKeyDown, true);
    return () => {
      root.removeEventListener('wheel', handleWheel);
      root.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [handleChatZoomIn, handleChatZoomOut, handleChatZoomReset, historyMode]);

  const handleStreamTextChunk = useCallback((chunk: string) => {
    ensureAssistantReplayMessage();
    // Clear shimmer when real text arrives so they don't overlap
    setShimmerText('');
    if (chunk.includes('__RESET__')) {
      while (feedRef.current.length > 0 && feedRef.current[feedRef.current.length - 1].kind === 'text') {
        feedRef.current.pop();
      }
      scheduleStreamUpdate();
      return;
    }

    const lastIdx = feedRef.current.length - 1;
    const shouldSeparateTerminalChunks =
      activeStreamModeRef.current === 'claude_terminal' || activeStreamModeRef.current === 'codex_terminal';

    if (!shouldSeparateTerminalChunks && lastIdx >= 0 && feedRef.current[lastIdx].kind === 'text') {
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

    // Sanitize: single line only, strip markdown artifacts, cap length
    let clean = thought.trim().split(/[\n\r]/)[0].replace(/^[-*>#]+\s*/, '').trim();
    if (clean.length > 80) clean = clean.slice(0, 77) + '…';
    if (!clean) return;

    const next = { text: clean, at: Date.now() };

    // Dedupe identical consecutive thoughts
    const lastText = thinkingBatchRef.current[thinkingBatchRef.current.length - 1]?.text;
    if (lastText === next.text) return;

    // Replace previous thought — keeps shimmer to a single clean line,
    // preventing paragraph buildup from batched thinking deltas.
    thinkingBatchRef.current = [next];
    thinkingVisibleUntilRef.current = Date.now() + MIN_THINKING_VISIBLE_MS;
    thinkingQueueRef.current = []; // latest thought wins
    clearThinkingAdvanceTimer();
    setShimmerText(next.text);
    autoScroll();
  }, [autoScroll, clearThinkingAdvanceTimer]);

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
    } else if ((activity as any).status === 'awaiting_approval') {
      setShimmerText('Waiting for approval…');
      autoScroll();
    } else if ((activity as any).status === 'needs_human') {
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

  const handleStreamEndEvent = useCallback((data?: StreamEndPayload) => {
    if (data?.isPipelineStart && data?.pipelineMessageId) {
      const pipelineMsg: Message = {
        id: data.pipelineMessageId,
        role: 'assistant',
        type: 'pipeline',
        content: '',
        timestamp: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      };
      setMessages(prev => [...prev, pipelineMsg]);
      return;
    }
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
    setActiveStreamMode('chat');
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
      if (result.title && activeTabId) {
        onConversationTitleResolved(activeTabId, result.title);
      }
      setConversationMode(result.mode || 'chat');
      setClaudeStatus(result.claudeTerminalStatus || 'idle');
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    }).catch(() => {});
  }, [loadConversationId, replayBuffer, activeTabId, onConversationTitleResolved]);

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
        if (item.type === 'chat:stream:end') { handleStreamEndEvent(item.data); sawStreamEnd = true; }
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
    if (api.chat.onPromptDebug) {
      cleanups.push(api.chat.onPromptDebug((payload: PromptDebugSnapshot) => {
        setPromptDebug(payload);
      }));
    }
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
    setConversationMode(nextMode);
    setClaudeStatus(result.claudeTerminalStatus || (nextMode === 'claude_terminal' ? 'idle' : 'stopped'));
  }, [conversationMode, loadConversationId, loadedConversationId]);

  const handleToggleCodexMode = useCallback(async () => {
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
    const nextMode = conversationMode === 'codex_terminal' ? 'chat' : 'codex_terminal';
    const result = await api.chat.setMode(conversationId, nextMode);
    if (result?.error) return;
    setConversationMode(nextMode);
    setClaudeStatus(result.claudeTerminalStatus || (nextMode === 'codex_terminal' ? 'idle' : 'stopped'));
  }, [conversationMode, loadConversationId, loadedConversationId]);

  const handleSend = useCallback(async (text: string, attachments: MessageAttachment[] = []) => {
    const api = (window as any).clawdia;
    if (!api) return;

    isUserScrolledUpRef.current = false;
    setPromptDebug(null);

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
    setActiveStreamMode(conversationMode);

    setTimeout(() => {
      setMessages(prev => [...prev, {
        id: assistantId,
        role: 'assistant',
        type: conversationMode === 'chat' ? 'chat' : 'terminal_transcript',
        content: '',
        timestamp: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        isStreaming: true,
      }]);
      setIsStreaming(true);
    }, 100);

    try {
      if (conversationMode !== 'chat') setClaudeStatus('working');
      const result = await api.chat.send(text, attachments);

      const finalFeed = [...feedRef.current].map(item =>
        item.kind === 'text' ? { ...item, isStreaming: false } : item
      ) as FeedItem[];
      const finalContent = result.response ||
        finalFeed.filter(i => i.kind === 'text').map(i => (i as any).text).join('\n\n') || '';
      const finalTools = finalFeed.filter(i => i.kind === 'tool').map(i => (i as any).tool) as ToolCall[];

      if (result.error) {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? {
                ...m,
                type: conversationMode === 'chat' ? m.type : 'terminal_transcript',
                content: `⚠️ ${result.error}`,
                isStreaming: false,
                feed: [],
                toolCalls: [],
              }
            : m
        ));
      } else {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? {
                ...m,
                type: conversationMode === 'chat' ? m.type : 'terminal_transcript',
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
      if (conversationMode !== 'chat') setClaudeStatus('idle');
      assistantMsgIdRef.current = null;
      setActiveStreamMode('chat');
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
      if (conversationMode !== 'chat') setClaudeStatus('errored');
      assistantMsgIdRef.current = null;
      setActiveStreamMode('chat');
    }
  }, [conversationMode, scrollToBottom]);

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
  const showCodexEmptyState =
    conversationMode === 'codex_terminal'
    && messages.length === 0
    && !isStreaming
    && !historyMode;
  const showClaudeCodeEmptyState =
    conversationMode === 'claude_terminal'
    && messages.length === 0
    && !isStreaming
    && !historyMode;
  const showClawdiaEmptyState =
    conversationMode === 'chat'
    && messages.length === 0
    && !isStreaming
    && !historyMode;

  return (
    <div ref={chatRootRef} className="flex flex-col h-full">
      <TabStrip
        tabs={tabs}
        activeTabId={activeTabId}
        onSwitch={onSwitchTab}
        onClose={onCloseTab}
        onNew={onNewTab}
      />
      {/* Icons row — terminal + settings */}
      <div
        className="drag-region flex items-center justify-end gap-1 px-2 h-[44px] flex-shrink-0 relative z-10"
        style={{
          background: '#09090c',
        }}
      >
        <div className="no-drag mr-1 flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.03] px-1 py-0.5">
          <button
            onClick={handleChatZoomOut}
            title="Zoom out chat"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[12px] text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-text-primary"
          >
            -
          </button>
          <button
            onClick={handleChatZoomReset}
            title="Reset chat zoom"
            className="rounded-md px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-text-primary"
          >
            {chatZoom}%
          </button>
          <button
            onClick={handleChatZoomIn}
            title="Zoom in chat"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[12px] text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-text-primary"
          >
            +
          </button>
        </div>
        <button
          onClick={() => setHistoryMode(m => !m)}
          title={historyMode ? 'Close history' : 'Chat history'}
          className={`no-drag flex items-center justify-center w-8 h-8 rounded-lg transition-all cursor-pointer ${
            historyMode
              ? 'bg-white/[0.08] text-text-primary'
              : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.06]'
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </button>
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

      {historyMode ? (
        <div className="flex-1 overflow-hidden">
          <HistoryBrowser
            currentTabs={tabs}
            onSelectConversation={onOpenConversation}
            onClose={() => setHistoryMode(false)}
          />
        </div>
      ) : (
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth">
          <div
            className={`flex flex-col px-5 pt-5 pb-8 ${showCodexEmptyState || showClaudeCodeEmptyState || showClawdiaEmptyState ? '' : 'gap-4'}`}
            style={{ zoom: chatZoom / 100 }}
          >
            {showClawdiaEmptyState && (
              <ClawdiaEmptyState onSend={(text) => { void handleSend(text); }} />
            )}
            {showCodexEmptyState && (
              <CodexEmptyState onSend={(text) => { void handleSend(text); }} />
            )}
            {showClaudeCodeEmptyState && (
              <ClaudeCodeEmptyState onSend={(text) => { void handleSend(text); }} />
            )}
            {messages.map(msg =>
              msg.type === 'pipeline'
              ? <PipelineBlock key={msg.id} />
              : msg.role === 'assistant'
              ? (
                <AssistantMessage
                  key={msg.id}
                  message={msg}
                  shimmerText={msg.isStreaming ? shimmerText : undefined}
                  streamMode={msg.isStreaming ? activeStreamMode : conversationMode}
                  onOpenTerminal={() => {
                    if (!terminalOpen) onToggleTerminal();
                  }}
                />
              )
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
      )}

      <SwarmPanel />

      {promptDebug && (
        <div className="pointer-events-none fixed bottom-24 right-4 z-[60] w-[520px] max-w-[calc(100vw-2rem)]">
          <div className="pointer-events-auto rounded-2xl border border-white/[0.12] bg-[#0b0c10]/95 shadow-[0_18px_48px_rgba(0,0,0,0.38)] backdrop-blur-md">
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
              <div className="min-w-0">
                <div className="text-[12px] font-medium uppercase tracking-[0.12em] text-text-tertiary">Prompt Injection Debug</div>
                <div className="mt-1 text-[12px] text-text-secondary">
                  {promptDebug.provider} · {promptDebug.model} · iteration {promptDebug.iteration}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPromptDebugOpen((open) => !open)}
                className="rounded-md px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-text-primary"
              >
                {promptDebugOpen ? 'Hide' : 'Show'}
              </button>
            </div>
            {promptDebugOpen && (
              <div className="max-h-[60vh] overflow-auto p-4">
                <div className="mb-4">
                  <div className="mb-2 text-[11px] uppercase tracking-[0.1em] text-text-tertiary">Tools</div>
                  <div className="text-[12px] leading-6 text-text-secondary">
                    {promptDebug.toolNames.join(', ') || 'none'}
                  </div>
                </div>
                <div className="mb-4">
                  <div className="mb-2 text-[11px] uppercase tracking-[0.1em] text-text-tertiary">System Prompt</div>
                  <pre className="whitespace-pre-wrap break-words rounded-xl border border-white/[0.06] bg-black/30 p-3 font-mono text-[11px] leading-5 text-text-primary">
                    {promptDebug.systemPrompt}
                  </pre>
                </div>
                <div>
                  <div className="mb-2 text-[11px] uppercase tracking-[0.1em] text-text-tertiary">Messages</div>
                  <div className="flex flex-col gap-3">
                    {promptDebug.messages.map((message, index) => (
                      <div key={`${message.role}-${index}`} className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
                        <div className="mb-2 text-[11px] uppercase tracking-[0.1em] text-text-tertiary">{message.role}</div>
                        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-text-primary">
                          {message.content}
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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
        codexMode={conversationMode === 'codex_terminal'}
        codexStatus={claudeStatus}
        onToggleCodexMode={handleToggleCodexMode}
        codexModeDisabled={false}
        disabled={historyMode}
      />

    </div>
  );
}

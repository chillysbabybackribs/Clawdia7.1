import { BrowserWindow, ipcMain, shell } from 'electron';
import Anthropic from '@anthropic-ai/sdk';
import { IPC, IPC_EVENTS } from '../ipc-channels';
import { DEFAULT_MODEL_BY_PROVIDER, resolveModelForTier } from '../../shared/model-registry';
import type { Message, MessageAttachment, PromptDebugSnapshot, FeedItem, ToolCall, ConcurrentFeedSource } from '../../shared/types';
import { agentLoop, compressConversationHistory } from '../agent/agentLoop';
import { classify, isAppMappingRequest, isContinuationRequest, extractAppMappingTarget } from '../agent/classify';
import { cancelLoop, pauseLoop, resumeLoop, addContext } from '../agent/loopControl';
import { loadSettings } from '../settingsStore';
import {
  createConversation,
  listConversations,
  getConversation,
  updateConversation,
  deleteConversation,
  addMessage,
  getMessages,
  getRuns,
  getRunEvents,
  updateRun,
  upsertStreamingResponse,
  deleteStreamingResponse,
} from '../db';
import { runClaudeCode } from '../claudeCodeClient';
import { runCodexCli } from '../codexCliClient';
import type { SessionManager } from '../SessionManager';
import type { ElectronBrowserService } from '../core/browser/ElectronBrowserService';
import type { TerminalSessionController } from '../core/terminal/TerminalSessionController';
import { routeExecutor } from '../core/executors/ExecutorRouter';
import { runConcurrent, classifyConcurrentIntent } from '../core/executors/ConcurrentExecutor';
import { getExecutorConfig } from '../core/executors/ExecutorConfigStore';
import type { ConcurrentConfig } from '../core/executors/ExecutorConfigStore';
import {
  createNewTask,
  linkRunToTask,
  completeTask,
  failTask,
  cancelTask,
} from '../taskTracker';
import { registerRun, completeRun, failRun } from '../runTracker';
import {
  formatSessionRecallBlock,
  recallLatestSessionContinuity,
  recordAssistantOutcome,
  recordUserIntent,
  shouldTriggerSessionRecall,
} from '../sessionContinuity';

// ── Post-run tool pair collapse ───────────────────────────────────────────────
// After a turn completes, strip all intermediate tool_use/tool_result pairs
// that were appended during the run (from runStartIndex onward), leaving only
// the final assistant text response. This keeps working memory (the answer)
// without accumulating scaffolding (the how) across turns.
//
// The final assistant message is already in sessionMessages at this point
// (agentLoop appends it before returning). We replace the entire run segment
// with just that final message.
//
// Anthropic protocol note: we remove complete pairs together, so no orphaned
// tool_use or tool_result blocks remain. The final assistant message is plain
// text, so no repair is needed.
function collapseRunToolPairs(sessionMessages: any[], runStartIndex: number): void {
  if (runStartIndex >= sessionMessages.length) return;

  const runSegment = sessionMessages.slice(runStartIndex);

  // Find the last plain-text assistant message in the segment (the final answer).
  // A plain-text assistant message has content as a string, or an array with
  // only text blocks (no tool_use blocks).
  let finalAssistantIdx = -1;
  for (let i = runSegment.length - 1; i >= 0; i--) {
    const msg = runSegment[i];
    if (msg?.role !== 'assistant') continue;
    const hasToolUse = Array.isArray(msg.content)
      ? msg.content.some((b: any) => b?.type === 'tool_use')
      : false;
    if (!hasToolUse) {
      finalAssistantIdx = i;
      break;
    }
  }

  if (finalAssistantIdx === -1) return; // No plain assistant message found — leave untouched.

  const finalMsg = runSegment[finalAssistantIdx];
  // Replace everything from runStartIndex onward with just the final message.
  sessionMessages.splice(runStartIndex, sessionMessages.length - runStartIndex, finalMsg);
}

// ── Formatting helpers ────────────────────────────────────────────────────────
let registered = false;
let browserServiceRef: ElectronBrowserService | null = null;
let terminalControllerRef: TerminalSessionController | undefined;

async function generateAndPushTitle(
  conversationId: string,
  userMessage: string,
  assistantMessage: string,
  sendEvent: (channel: string, payload: unknown) => void,
): Promise<void> {
  const conv = getConversation(conversationId);
  if (!conv || (conv.title && conv.title !== 'New conversation')) return;

  try {
    const settings = loadSettings();
    const apiKey = settings.providerKeys?.anthropic?.trim() || '';
    if (!apiKey) return;

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [{
        role: 'user',
        content: `Write a short title (4-6 words, no punctuation) for a chat that starts with:\nUser: ${userMessage.slice(0, 300)}\nAssistant: ${assistantMessage.slice(0, 300)}\n\nReply with only the title, nothing else.`,
      }],
    });

    const title = response.content[0]?.type === 'text'
      ? response.content[0].text.trim().replace(/^["']|["']$/g, '').slice(0, 60)
      : null;

    if (!title) return;

    updateConversation(conversationId, { title });
    sendEvent(IPC_EVENTS.CHAT_TITLE_UPDATED, { conversationId, title });
  } catch {
    // Title generation is best-effort; silently ignore failures.
  }
}

function formatPromptBlock(title: string, lines: string[]): string {
  return [
    '\r\n',
    `\x1b[36m=== ${title} ===\x1b[0m`,
    ...lines,
    `\x1b[36m=== END ${title} ===\x1b[0m`,
    '',
  ].join('\r\n');
}

export function formatPromptDebugForTerminal(snapshot: PromptDebugSnapshot): string {
  const messageLines = snapshot.messages.flatMap((message, index) => ([
    `[#${index + 1}] ${message.role}`,
    message.content || '(empty)',
  ]));
  return formatPromptBlock(`PromptDebug ${snapshot.provider}/${snapshot.model} iteration ${snapshot.iteration}`, [
    `tools=${snapshot.toolNames.join(', ') || 'none'}`,
    '--- SYSTEM PROMPT ---',
    snapshot.systemPrompt || '(empty)',
    '--- MESSAGES ---',
    ...messageLines,
  ]);
}

export function formatSystemPromptForTerminal(provider: string, model: string, prompt: string): string {
  return formatPromptBlock(`SystemPrompt ${provider}/${model}`, [prompt || '(empty)']);
}

export function formatExternalPromptForTerminal(label: string, prompt: string): string {
  return formatPromptBlock(`${label} Prompt`, [prompt || '(empty)']);
}

// ── Feed helpers ──────────────────────────────────────────────────────────────

function appendFeedText(feed: FeedItem[], chunk: string, source?: ConcurrentFeedSource): void {
  if (!chunk) return;
  const last = feed[feed.length - 1];
  if (last?.kind === 'text' && last.isStreaming && last.source === source) {
    last.text += chunk;
    return;
  }
  feed.push({ kind: 'text', text: chunk, isStreaming: true, source });
}

function upsertFeedTool(feed: FeedItem[], activity: ToolCall): void {
  const last = feed[feed.length - 1];
  if (activity.status === 'running') {
    if (last?.kind === 'text' && last.isStreaming) last.isStreaming = false;
    feed.push({ kind: 'tool', tool: activity });
    return;
  }
  const idx = feed.findIndex((item) => item.kind === 'tool' && item.tool.id === activity.id);
  if (idx >= 0) {
    const existingTool = (feed[idx] as Extract<FeedItem, { kind: 'tool' }>).tool;
    feed[idx] = { kind: 'tool', tool: { ...existingTool, ...activity } };
    return;
  }
  feed.push({ kind: 'tool', tool: activity });
}

function finalizeFeed(feed: FeedItem[]): FeedItem[] {
  return feed.map((item) => item.kind === 'text' ? { ...item, isStreaming: false } : item);
}

function applySessionRecallIfNeeded(
  userText: string,
  conversationId: string,
  priorMessageCount: number,
): string {
  if (priorMessageCount > 0) return userText;
  if (!shouldTriggerSessionRecall(userText)) return userText;
  const recall = recallLatestSessionContinuity(conversationId);
  if (!recall) return userText;
  return `${formatSessionRecallBlock(recall)}\n\n[Current request]\n${userText}`;
}

// ── Message content helpers ───────────────────────────────────────────────────

function findLastUserText(messages: any[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== 'user') continue;
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      const text = msg.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n').trim();
      if (text) return text;
    }
    if (Array.isArray(msg.parts)) {
      const text = msg.parts.map((p: any) => p?.text ?? '').join('\n').trim();
      if (text) return text;
    }
  }
  return null;
}

function buildContinuationForcedProfile(text: string, sessionMessages: any[]) {
  if (!isContinuationRequest(text)) return undefined;
  for (let i = sessionMessages.length - 1; i >= 0; i--) {
    const msg = sessionMessages[i];
    if (msg?.role !== 'user') continue;
    const priorText = findLastUserText([msg]);
    if (!priorText || isContinuationRequest(priorText)) continue;
    if (!isAppMappingRequest(priorText)) continue;
    return {
      specialMode: 'app_mapping' as const,
      toolGroup: 'desktop' as const,
      isContinuation: true,
      mappingTarget: extractAppMappingTarget(priorText),
    };
  }
  return { isContinuation: true };
}

function userTextFromContent(content: Anthropic.MessageParam['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b) => {
      if (b.type === 'text') return b.text;
      if (b.type === 'image') return '[Image]';
      return '';
    }).filter(Boolean).join('\n');
  }
  return '';
}

function assistantTextFromContent(content: Anthropic.MessageParam['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is Anthropic.TextBlockParam => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
  return '';
}

function toUiMessages(params: Anthropic.MessageParam[]): Message[] {
  const out: Message[] = [];
  let i = 0;
  const ts = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  for (const p of params) {
    if (p.role === 'user') {
      out.push({ id: `hist-u-${i++}`, role: 'user', content: userTextFromContent(p.content), timestamp: ts() });
    } else if (p.role === 'assistant') {
      out.push({ id: `hist-a-${i++}`, role: 'assistant', content: assistantTextFromContent(p.content), timestamp: ts() });
    }
  }
  return out;
}

// ── ChatIpc registration ──────────────────────────────────────────────────────

export function registerChatIpc(
  sessionManager: SessionManager,
  browserService: ElectronBrowserService,
  terminalController: TerminalSessionController | undefined,
): void {
  browserServiceRef = browserService;
  terminalControllerRef = terminalController;

  function getMainWindow(): BrowserWindow | undefined {
    return BrowserWindow.getAllWindows()[0];
  }

  const currentBrowserService = (): ElectronBrowserService => {
    if (!browserServiceRef) throw new Error('Browser service not initialized');
    return browserServiceRef;
  };

  function send(channel: string, payload: unknown): void {
    const w = getMainWindow();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }

  function findConversationTerminalSessionId(conversationId: string): string | null {
    if (!terminalControllerRef) return null;
    const sessionsForConversation = terminalControllerRef
      .list()
      .filter((s) => s.conversationId === conversationId);
    const live = sessionsForConversation.find((s) => s.connected);
    return live?.sessionId ?? sessionsForConversation[0]?.sessionId ?? null;
  }

  function appendPromptTail(conversationId: string, text: string): void {
    if (!terminalControllerRef || !text.trim()) return;
    const sessionId = findConversationTerminalSessionId(conversationId);
    if (!sessionId) return;
    terminalControllerRef.appendOutput(sessionId, text);
  }

  function ensureConversation(): string {
    if (!sessionManager.activeConversationId) {
      const id = `conv-${Date.now()}`;
      sessionManager.activeConversationId = id;
      sessionManager.setSession(id, []);
    }
    return sessionManager.activeConversationId!;
  }

  function repairSession(sessionMessages: any[], reason: 'user_interrupted' | 'session_recovery', caller: string): void {
    sessionManager.repairAnthropicSessionInPlace(sessionMessages, reason, caller);
  }

  if (registered) return;
  registered = true;

  // ── Window ──────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.WINDOW_MINIMIZE, () => getMainWindow()?.minimize());
  ipcMain.handle(IPC.WINDOW_MAXIMIZE, () => {
    const w = getMainWindow();
    if (!w) return;
    if (w.isMaximized()) w.unmaximize(); else w.maximize();
  });
  ipcMain.handle(IPC.WINDOW_CLOSE, () => getMainWindow()?.close());

  // ── Conversation lifecycle ──────────────────────────────────────────────────
  ipcMain.handle(IPC.CHAT_NEW, () => {
    if (sessionManager.activeConversationId) {
      sessionManager.abortAgent(sessionManager.activeConversationId);
    }
    const now = new Date().toISOString();
    const id = `conv-${Date.now()}`;
    createConversation({ id, title: 'New conversation', mode: 'chat', created_at: now, updated_at: now });
    sessionManager.activeConversationId = id;
    sessionManager.setSession(id, []);
    return { id };
  });

  ipcMain.handle(IPC.CHAT_CREATE, () => {
    const now = new Date().toISOString();
    const id = `conv-${Date.now()}`;
    createConversation({ id, title: 'New conversation', mode: 'chat', created_at: now, updated_at: now });
    sessionManager.setSession(id, []);
    return { id };
  });

  ipcMain.handle(IPC.CHAT_LIST, () => {
    return listConversations().map((row) => ({
      id: row.id,
      title: row.title,
      updatedAt: new Date(row.updated_at).toISOString(),
      mode: row.mode,
    }));
  });

  ipcMain.handle(IPC.CHAT_LOAD, (_e, id: string) => {
    sessionManager.hydrateFromDb(id);

    const rows = getMessages(id);
    const messages: Message[] = rows.map((r) => {
      try { return JSON.parse(r.content) as Message; }
      catch {
        return {
          id: r.id,
          role: r.role as 'user' | 'assistant',
          content: r.content,
          timestamp: new Date(r.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        };
      }
    });

    const conv = getConversation(id);
    const runs = getRuns(id);
    const lastRun = runs[0];
    const interruptedRun = lastRun?.status === 'failed' && !lastRun.completed_at
      ? { goal: lastRun.goal ?? null, runId: lastRun.id }
      : null;
    return {
      messages,
      mode: conv?.mode ?? ('chat' as const),
      claudeTerminalStatus: 'idle' as const,
      title: conv?.title ?? null,
      isRunning: sessionManager.isConversationRunning(id),
      interruptedRun,
    };
  });

  ipcMain.handle(IPC.CHAT_GET_MODE, (_e, id: string) => {
    const conv = getConversation(id);
    const mode = conv?.mode ?? 'chat';
    return { mode, claudeTerminalStatus: 'idle' as const };
  });

  ipcMain.handle(IPC.CHAT_SET_MODE, (_e, id: string, mode: string) => {
    if (id) {
      if (!getConversation(id)) {
        const now = new Date().toISOString();
        createConversation({ id, title: 'New conversation', mode, created_at: now, updated_at: now });
      } else {
        updateConversation(id, { mode });
      }
    }
    return { ok: true, mode, claudeTerminalStatus: mode === 'chat' ? 'stopped' as const : 'idle' as const };
  });

  ipcMain.handle(IPC.CHAT_GET_ACTIVE_TERMINAL_SESSION, (_e, conversationId?: string | null) => ({
    sessionId: conversationId ? findConversationTerminalSessionId(conversationId) : null,
  }));

  ipcMain.handle(IPC.CHAT_DELETE, (_e, id: string) => {
    deleteConversation(id);
    sessionManager.deleteSession(id);
    sessionManager.removeExecutorState(id);
    sessionManager.removeTaskId(id);
    if (sessionManager.activeConversationId === id) sessionManager.activeConversationId = null;
    // Release the conversation-scoped browser tab so it doesn't persist after deletion.
    currentBrowserService().releaseTab(id).catch(() => {});
  });

  ipcMain.handle(IPC.CHAT_OPEN_ATTACHMENT, (_e, filePath: string) => {
    if (filePath && typeof filePath === 'string') shell.openPath(filePath).catch(() => {});
  });

  // ── Run list / events ───────────────────────────────────────────────────────
  ipcMain.handle(IPC.RUN_LIST, (_e, conversationId: string) => getRuns(conversationId));
  ipcMain.handle(IPC.RUN_EVENTS, (_e, runId: string) => getRunEvents(runId));

  // ── Send ────────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.CHAT_SEND, async (_event, payload: { text: string; attachments?: MessageAttachment[]; conversationId?: string | null; provider?: string; model?: string }) => {
    const { text, attachments, conversationId, provider: payloadProvider, model: payloadModel } = payload || { text: '' };

    // Define sendEvent first so it's available for error paths in setup.
    const sendEvent = (channel: string, payload: unknown) => {
      const w = getMainWindow();
      if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
    };

    let id: string;
    let priorMessageCount = 0;
    try {
      if (conversationId) {
        id = conversationId;
        sessionManager.hydrateFromDb(id);
      } else {
        ensureConversation();
        id = sessionManager.activeConversationId!;
      }

      if (!getConversation(id)) {
        const now = new Date().toISOString();
        createConversation({ id, title: 'New conversation', mode: 'chat', created_at: now, updated_at: now });
      }

      priorMessageCount = getMessages(id).length;

      const userMsgId = `msg-u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const userMsgTs = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const nowTs = new Date().toISOString();
      const userMsg: Message = { id: userMsgId, role: 'user', content: text, timestamp: userMsgTs, attachments };
      addMessage({ id: userMsgId, conversation_id: id, role: 'user', content: JSON.stringify(userMsg), created_at: nowTs });
      updateConversation(id, { updated_at: nowTs });
      recordUserIntent(id, text);
    } catch (setupErr: unknown) {
      const msg = setupErr instanceof Error ? setupErr.message : String(setupErr);
      console.error('[ChatIpc] setup error before executor start:', msg);
      // id may be unset; fall back to a placeholder so the renderer can correlate.
      const errConvId = conversationId ?? 'unknown';
      sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: msg, conversationId: errConvId });
      return { response: '', error: msg, conversationId: errConvId };
    }

    // ── Executor routing ────────────────────────────────────────────────────
    const conv = getConversation(id);
    const effectiveText = applySessionRecallIfNeeded(text, id, priorMessageCount);
    let { executorId, usedFallback, fallbackReason } = routeExecutor(conv?.mode ?? 'chat');
    if (usedFallback && fallbackReason) {
      console.warn(`[ChatIpc] executor routing fallback: ${fallbackReason}`);
    }
    // Auto-upgrade to concurrent when: the user hasn't explicitly chosen an
    // executor (resolved to agentLoop), concurrent is opted-in via config,
    // and the heuristic detects a genuinely parallel task.
    if (executorId === 'agentLoop' && getExecutorConfig('concurrent').enabled && classifyConcurrentIntent(text)) {
      executorId = 'concurrent';
      console.log('[ChatIpc] auto-routing to concurrent executor via heuristic');
    }
    // startExclusive enforces same-conversation exclusivity: aborts any prior
    // run, creates a fresh AbortController, and initialises runtime state to
    // 'running' — all as one atomic operation.
    const convAgent = sessionManager.startExclusive(id, executorId);
    sessionManager.activeConversationId = id;

    // ── Task identity ───────────────────────────────────────────────────────
    // Each explicit user send creates a new task. This is the simplest stable
    // rule — no semantic inference, no ambiguity about continuation.
    const taskId = createNewTask(id, text, executorId);
    sessionManager.updateTaskId(id, taskId);

    // ── Claude Code path ────────────────────────────────────────────────────
    if (executorId === 'claudeCode') {
      sendEvent(IPC_EVENTS.CHAT_THINKING, { thought: 'Claude Code is thinking…', conversationId: id });
      appendPromptTail(id, formatExternalPromptForTerminal('Claude Code', effectiveText));

      // Load persisted session id so resume survives app restarts.
      const persistedSessionId = conv?.claude_code_session_id ?? null;

      // Claude Code generates its own internal run IDs; we create a DB-tracked
      // run here so the task ↔ run linkage is consistent across all executors.
      const ccRunId = `run-cc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      registerRun(ccRunId, id, 'anthropic', 'claude-code', taskId);
      linkRunToTask(taskId, ccRunId);
      sessionManager.updateExecutorState(id, { runId: ccRunId });

      try {
        const { finalText, sessionId: newSessionId } = await runClaudeCode({
          conversationId: id,
          prompt: effectiveText,
          attachments,
          skipPermissions: loadSettings().unrestrictedMode,
          persistedSessionId,
          signal: convAgent.abort.signal,
          onText: (delta) => sendEvent(IPC_EVENTS.CHAT_STREAM_TEXT, { delta, conversationId: id }),
          onToolActivity: (activity) => sendEvent(IPC_EVENTS.CHAT_TOOL_ACTIVITY, { ...activity, conversationId: id }),
        });
        sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: true, conversationId: id });

        // Persist the session id durably so the next run (even after restart) can resume.
        if (newSessionId && newSessionId !== persistedSessionId) {
          updateConversation(id, { claude_code_session_id: newSessionId });
        }

        completeRun(ccRunId, 0, 0);
        completeTask(taskId);
        sessionManager.updateExecutorState(id, {
          status: 'idle',
          runId: null,
          hasPersistentSession: Boolean(newSessionId ?? persistedSessionId),
        });

        if (finalText) {
          const assistantMsgId = `msg-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const assistantMsgTs = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const assistantMsg: Message = { id: assistantMsgId, role: 'assistant', content: finalText, timestamp: assistantMsgTs };
          const nowStr = new Date().toISOString();
          addMessage({ id: assistantMsgId, conversation_id: id, role: 'assistant', content: JSON.stringify(assistantMsg), created_at: nowStr });
          updateConversation(id, { updated_at: nowStr });
          recordAssistantOutcome(id, finalText);
          void generateAndPushTitle(id, text, finalText, sendEvent);
        }
        return { response: finalText, conversationId: id };
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));

        // If we had a persisted session id and the run failed, the session may
        // be stale/invalid.  Clear it so the next run starts fresh rather than
        // repeatedly failing on the same bad id.
        if (persistedSessionId) {
          updateConversation(id, { claude_code_session_id: null });
        }

        failRun(ccRunId, err.message);
        failTask(taskId, err.message);
        sessionManager.updateExecutorState(id, { status: 'failed', runId: null, hasPersistentSession: false });
        sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message, conversationId: id });
        return { response: '', error: err.message, conversationId: id };
      }
    }

    // ── Concurrent path (Planner → Workers → Synthesizer) ─────────────────
    if (executorId === 'concurrent') {
      sendEvent(IPC_EVENTS.CHAT_THINKING, { thought: 'Planning concurrent execution…', conversationId: id });
      appendPromptTail(id, formatExternalPromptForTerminal('Concurrent', effectiveText));

      const concurrentConfig = getExecutorConfig('concurrent') as ConcurrentConfig;
      const assistantFeed: FeedItem[] = [];
      const assistantToolCalls = new Map<string, ToolCall>();

      // Apply the wall-clock timeout from config (0 = no limit).
      const timeoutMs = concurrentConfig.timeoutMs;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let timeoutController: AbortController | null = null;
      let concurrentSignal = convAgent.abort.signal;
      if (timeoutMs > 0) {
        timeoutController = new AbortController();
        timeoutHandle = setTimeout(() => timeoutController!.abort(), timeoutMs);
        // Chain: abort if either user aborts or timeout fires.
        concurrentSignal = AbortSignal.any
          ? AbortSignal.any([convAgent.abort.signal, timeoutController.signal])
          : convAgent.abort.signal; // fallback: user abort only (Node < 20.3)
        convAgent.abort.signal.addEventListener('abort', () => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          timeoutController!.abort();
        }, { once: true });
      }

      try {
        const result = await runConcurrent({
          conversationId: id,
          taskId,
          prompt: effectiveText,
          attachments,
          signal: concurrentSignal,
          strategy: concurrentConfig.strategy,
          synthesize: concurrentConfig.synthesize,
          onText: (delta, source) => {
            appendFeedText(assistantFeed, delta, source);
            sendEvent(IPC_EVENTS.CHAT_STREAM_TEXT, { delta, conversationId: id, source });
          },
          onToolActivity: (activity) => {
            assistantToolCalls.set(activity.id, activity);
            upsertFeedTool(assistantFeed, activity);
            sendEvent(IPC_EVENTS.CHAT_TOOL_ACTIVITY, { ...activity, conversationId: id });
          },
          onThinking: (thought) => {
            sendEvent(IPC_EVENTS.CHAT_THINKING, { thought, conversationId: id });
          },
          onStateChanged: (state) => {
            sendEvent(IPC_EVENTS.SWARM_STATE_CHANGED, { ...state, conversationId: id });
          },
          onExecutionStart: (plan) => {
            sendEvent(IPC_EVENTS.CONCURRENT_EXECUTION_START, { plan, conversationId: id });
          },
          onExecutionEnd: () => {
            sendEvent(IPC_EVENTS.CONCURRENT_EXECUTION_END, { conversationId: id });
          },
        });

        sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: true, conversationId: id });
        completeTask(taskId);
        sessionManager.updateExecutorState(id, { status: 'idle', runId: null });

        if (result.finalText) {
          const assistantMsgId = `msg-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const assistantMsgTs = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const assistantMsg: Message = {
            id: assistantMsgId,
            role: 'assistant',
            content: result.finalText,
            timestamp: assistantMsgTs,
            feed: finalizeFeed(assistantFeed),
            toolCalls: Array.from(assistantToolCalls.values()),
          };
          const nowStr = new Date().toISOString();
          addMessage({ id: assistantMsgId, conversation_id: id, role: 'assistant', content: JSON.stringify(assistantMsg), created_at: nowStr });
          updateConversation(id, { updated_at: nowStr });
          recordAssistantOutcome(id, result.finalText);
        }
        return { response: result.finalText, conversationId: id };
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (err.name === 'AbortError' || err.message === 'AbortError') {
          cancelTask(taskId);
          sessionManager.updateExecutorState(id, { status: 'idle', runId: null });
          sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: false, cancelled: true, conversationId: id });
          return { response: '', error: 'Stopped', conversationId: id };
        }
        failTask(taskId, err.message);
        sessionManager.updateExecutorState(id, { status: 'failed', runId: null });
        sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message, conversationId: id });
        return { response: '', error: err.message, conversationId: id };
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    }

    // ── Codex path ──────────────────────────────────────────────────────────
    if (executorId === 'codex') {
      sendEvent(IPC_EVENTS.CHAT_THINKING, { thought: 'Codex is thinking…', conversationId: id });
      appendPromptTail(id, formatExternalPromptForTerminal('Codex', effectiveText));

      const codexRunId = `run-cdx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      registerRun(codexRunId, id, 'openai', 'codex', taskId);
      linkRunToTask(taskId, codexRunId);
      sessionManager.updateExecutorState(id, { runId: codexRunId });
      const assistantFeed: FeedItem[] = [];
      const assistantToolCalls = new Map<string, ToolCall>();

      try {
        const { finalText } = await runCodexCli({
          conversationId: id,
          prompt: effectiveText,
          signal: convAgent.abort.signal,
          onText: (delta) => {
            appendFeedText(assistantFeed, delta);
            sendEvent(IPC_EVENTS.CHAT_STREAM_TEXT, { delta, conversationId: id });
          },
          onToolActivity: (activity) => {
            assistantToolCalls.set(activity.id, activity);
            upsertFeedTool(assistantFeed, activity);
            sendEvent(IPC_EVENTS.CHAT_TOOL_ACTIVITY, { ...activity, conversationId: id });
          },
          onEvent: (event) => {
            const thoughtMap: Record<string, string> = {
              'response.queued': 'Codex is thinking…',
              'response.in_progress': 'Codex is working…',
              'item.started': 'Codex is running a tool…',
            };
            const thought = thoughtMap[event.type];
            if (thought) sendEvent(IPC_EVENTS.CHAT_THINKING, { thought, conversationId: id });
          },
        });
        sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: true, conversationId: id });
        completeRun(codexRunId, 0, 0);
        completeTask(taskId);
        // Codex manages its own thread persistence internally; no session id is
        // stored in Clawdia's DB, so hasPersistentSession remains false.
        sessionManager.updateExecutorState(id, { status: 'idle', runId: null, hasPersistentSession: false });
        if (finalText) {
          const assistantMsgId = `msg-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const assistantMsgTs = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const assistantMsg: Message = {
            id: assistantMsgId,
            role: 'assistant',
            content: finalText,
            timestamp: assistantMsgTs,
            feed: finalizeFeed(assistantFeed),
            toolCalls: Array.from(assistantToolCalls.values()),
          };
          const nowStr = new Date().toISOString();
          addMessage({ id: assistantMsgId, conversation_id: id, role: 'assistant', content: JSON.stringify(assistantMsg), created_at: nowStr });
          updateConversation(id, { updated_at: nowStr });
          recordAssistantOutcome(id, finalText);
          void generateAndPushTitle(id, text, finalText, sendEvent);
        }
        return { response: finalText, conversationId: id };
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (convAgent.abort.signal.aborted) {
          cancelTask(taskId);
          sessionManager.updateExecutorState(id, { status: 'idle', runId: null });
          sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: false, cancelled: true, conversationId: id });
          return { response: '', error: 'Stopped', conversationId: id };
        }
        failRun(codexRunId, err.message);
        failTask(taskId, err.message);
        sessionManager.updateExecutorState(id, { status: 'failed', runId: null });
        sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message, conversationId: id });
        return { response: '', error: err.message, conversationId: id };
      }
    }

    // ── Standard LLM path ──────────────────────────────────────────────────
    const settings = loadSettings();
    // Provider: prefer the value sent from the UI (user's live selection) over the saved default.
    const resolvedProvider = (payloadProvider === 'anthropic' || payloadProvider === 'openai' || payloadProvider === 'gemini')
      ? payloadProvider
      : settings.provider;
    if (resolvedProvider !== 'anthropic' && resolvedProvider !== 'gemini' && resolvedProvider !== 'openai') {
      const errMsg = 'Select a provider in Settings to use chat.';
      sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: errMsg, conversationId: id });
      return { response: '', error: errMsg, conversationId: id };
    }
    const apiKey = settings.providerKeys[resolvedProvider as keyof typeof settings.providerKeys]?.trim();
    if (!apiKey) {
      const errMsg = `Add a ${resolvedProvider} API key in Settings.`;
      sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: errMsg, conversationId: id });
      return { response: '', error: errMsg, conversationId: id };
    }

    // Model: if the UI sent an explicit model, use it directly (skip tier resolution).
    // Otherwise fall back to the saved model for the provider.
    const configuredModel = payloadModel
      ?? settings.models[resolvedProvider as keyof typeof settings.models]
      ?? DEFAULT_MODEL_BY_PROVIDER[resolvedProvider as keyof typeof DEFAULT_MODEL_BY_PROVIDER];
    const settings_provider = resolvedProvider as 'anthropic' | 'openai' | 'gemini';

    const maxTurns = isAppMappingRequest(text) ? sessionManager.maxMappingSessionTurns : sessionManager.maxSessionTurns;
    let sessionMessages = sessionManager.pruneSessionInPlace(id, maxTurns);
    if (settings_provider === 'anthropic') {
      repairSession(sessionMessages, 'session_recovery', 'ChatIpc.sessionRecovery');
      sessionManager.closePendingToolUses(id, 'session_recovery');
    }

    const continuationForcedProfile = buildContinuationForcedProfile(text, sessionMessages);
    const taskProfile = classify(text, continuationForcedProfile ?? undefined);
    // If the user explicitly picked a model from the UI, respect it exactly.
    // Only apply tier-based resolution when falling back to saved settings.
    const model = payloadModel
      ? configuredModel
      : resolveModelForTier(taskProfile.modelTier, settings_provider, configuredModel);
    let result: { response: string; error?: string } = { response: '', error: 'Unknown failure' };

    {
      const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      convAgent.runId = runId;
      // Register the agentLoop run in DB (previously not persisted for Anthropic path).
      registerRun(runId, id, settings_provider, configuredModel, taskId);
      linkRunToTask(taskId, runId);
      sessionManager.updateExecutorState(id, { runId, status: 'running' });
      const runStartIndex = sessionMessages.length; // capture before agentLoop appends anything
      const assistantFeed: FeedItem[] = [];
      const assistantToolCalls = new Map<string, ToolCall>();

      const streamingId = `stream-${runId}`;
      let streamingBuffer = '';
      let streamingFlushTimer: ReturnType<typeof setTimeout> | null = null;
      const flushStreamingBuffer = () => {
        if (streamingBuffer) upsertStreamingResponse(streamingId, id, runId, streamingBuffer);
        streamingFlushTimer = null;
      };
      const scheduleFlush = () => {
        if (!streamingFlushTimer) streamingFlushTimer = setTimeout(flushStreamingBuffer, 1500);
      };

      try {
        const response = await agentLoop(effectiveText, sessionMessages, {
          provider: settings_provider,
          apiKey,
          model,
          runId,
          conversationId: id,
          signal: convAgent.abort.signal,
          forcedProfile: continuationForcedProfile,
          unrestrictedMode: settings.unrestrictedMode,
          browserService: currentBrowserService(),
          terminalController: terminalControllerRef,
          attachments,
          onText: (delta) => {
            streamingBuffer += delta;
            appendFeedText(assistantFeed, delta);
            scheduleFlush();
            sendEvent(IPC_EVENTS.CHAT_STREAM_TEXT, { delta, conversationId: id });
          },
          onThinking: (t) => sendEvent(IPC_EVENTS.CHAT_THINKING, { thought: t, conversationId: id }),
          onPromptDebug: (snapshot: PromptDebugSnapshot) => {
            appendPromptTail(id, formatPromptDebugForTerminal(snapshot));
            sendEvent(IPC_EVENTS.CHAT_PROMPT_DEBUG, { ...snapshot, conversationId: id });
          },
          onToolActivity: (activity) => {
            const normalizedActivity: ToolCall = { ...activity };
            assistantToolCalls.set(normalizedActivity.id, {
              ...(assistantToolCalls.get(normalizedActivity.id) ?? {}),
              ...normalizedActivity,
            });
            upsertFeedTool(assistantFeed, normalizedActivity);
            sendEvent(IPC_EVENTS.CHAT_TOOL_ACTIVITY, { ...activity, conversationId: id });
          },
          onSystemPrompt: (prompt) => {
            appendPromptTail(id, formatSystemPromptForTerminal(settings_provider, model, prompt));
            updateRun(runId, { system_prompt: prompt });
          },
          onContextPressure: (pressure) => {
            sendEvent(IPC_EVENTS.CHAT_CONTEXT_PRESSURE, { ...pressure, conversationId: id });
          },
        });
        result = { response };
        collapseRunToolPairs(sessionMessages, runStartIndex);
        completeRun(runId, 0, 0);
        completeTask(taskId);
        sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: true, conversationId: id });
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (err.name === 'AbortError' || err.message === 'AbortError') {
          if (settings_provider === 'anthropic') {
            repairSession(sessionMessages, 'user_interrupted', 'ChatIpc.agentAbort');
          }
          // After repair, strip any trailing plain user message that was pushed by
          // the interrupted agentLoop but never received an assistant response.
          // Without this, the next send pushes another user message producing two
          // consecutive user turns which breaks the Anthropic protocol.
          {
            const last = sessionMessages[sessionMessages.length - 1];
            if (last?.role === 'user') {
              const content = last.content;
              const isToolResults = Array.isArray(content) && content.length > 0 &&
                content.every((b: any) => b?.type === 'tool_result');
              if (!isToolResults) {
                sessionMessages.pop();
              }
            }
          }
          // Preserve any partial text streamed before the abort so it gets persisted.
          result = { response: streamingBuffer, error: 'Stopped' };
          failRun(runId, 'Cancelled by user');
          cancelTask(taskId);
          sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: false, cancelled: true, conversationId: id });
        } else {
          result = { response: '', error: err.message };
          failRun(runId, err.message);
          failTask(taskId, err.message);
          sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message, conversationId: id });
        }
      } finally {
        if (streamingFlushTimer) { clearTimeout(streamingFlushTimer); streamingFlushTimer = null; }
        deleteStreamingResponse(streamingId);
        sessionManager.deleteAgent(id);
        sessionManager.updateExecutorState(id, {
          status: result?.error ? 'failed' : 'idle',
          runId: null,
        });
      }

      // Persist assistant message whenever there is any response content —
      // including partial responses from aborted runs so conversation history
      // is not silently lost on stop.
      const responseContent = result!.response;
      if (responseContent) {
        const assistantMsgId = `msg-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const assistantMsgTs = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const finalizedFeed = finalizeFeed(assistantFeed);
        const assistantMsg: Message = {
          id: assistantMsgId,
          role: 'assistant',
          content: responseContent,
          timestamp: assistantMsgTs,
          feed: finalizedFeed,
          toolCalls: Array.from(assistantToolCalls.values()),
        };
        const nowStr = new Date().toISOString();
        addMessage({ id: assistantMsgId, conversation_id: id, role: 'assistant', content: JSON.stringify(assistantMsg), created_at: nowStr });
        updateConversation(id, { updated_at: nowStr });
        recordAssistantOutcome(id, responseContent);
        void generateAndPushTitle(id, text, responseContent, sendEvent);
      }
    }

    return { ...result!, conversationId: id };
  });

  // ── Stop / Pause / Resume / Context ────────────────────────────────────────
  ipcMain.handle(IPC.CHAT_STOP, (_e, conversationId?: string) => {
    const targetId = conversationId ?? sessionManager.activeConversationId;
    if (!targetId) return;
    const agent = sessionManager.getAgent(targetId);
    if (agent) {
      agent.abort.abort();
      if (agent.runId) cancelLoop(agent.runId);
      sessionManager.deleteAgent(targetId);
    }
    sessionManager.updateExecutorState(targetId, { status: 'idle', runId: null });
    // Cancel the active task for this conversation if one exists.
    const activeTaskId = sessionManager.getActiveTaskId(targetId);
    if (activeTaskId) cancelTask(activeTaskId);
    const sessionMessages = sessionManager.getSession(targetId);
    if (sessionMessages) {
      repairSession(sessionMessages, 'user_interrupted', 'ChatIpc.chatStop');
      // Strip any trailing plain user message left by the interrupted run.
      // The agentLoop pushes the user message before the first LLM call, so if
      // the run was stopped before an assistant responded, the session ends with
      // an orphaned user turn. Removing it prevents consecutive user messages on
      // the next send.
      const last = sessionMessages[sessionMessages.length - 1];
      if (last?.role === 'user') {
        const content = last.content;
        const isToolResults = Array.isArray(content) && content.length > 0 &&
          content.every((b: any) => b?.type === 'tool_result');
        if (!isToolResults) {
          sessionMessages.pop();
        }
      }
    }
  });

  ipcMain.handle(IPC.CHAT_PAUSE, (_e, conversationId?: string) => {
    const targetId = conversationId ?? sessionManager.activeConversationId;
    if (!targetId) return;
    const agent = sessionManager.getAgent(targetId);
    if (agent?.runId) pauseLoop(agent.runId);
  });

  ipcMain.handle(IPC.CHAT_RESUME, (_e, conversationId?: string) => {
    const targetId = conversationId ?? sessionManager.activeConversationId;
    if (!targetId) return;
    const agent = sessionManager.getAgent(targetId);
    if (agent?.runId) resumeLoop(agent.runId);
  });

  ipcMain.handle(IPC.CHAT_ADD_CONTEXT, (_e, text: string, conversationId?: string) => {
    const targetId = conversationId ?? sessionManager.activeConversationId;
    if (!targetId) return;
    const agent = sessionManager.getAgent(targetId);
    if (agent?.runId) addContext(agent.runId, text);
  });

  ipcMain.handle(IPC.CHAT_RATE_TOOL, () => {});

  // ── Manual compression ──────────────────────────────────────────────────────
  // Works both during an active run (mutates the live messages array the agent
  // is iterating — it picks up seamlessly on the next iteration) and when idle.
  // Haiku is always Anthropic, so we always use the Anthropic key regardless
  // of which provider the user has active for chat.
  ipcMain.handle(IPC.CHAT_COMPRESS, async (_e, conversationId?: string) => {
    const targetId = conversationId ?? sessionManager.activeConversationId;
    if (!targetId) return { ok: false, error: 'No active conversation' };
    const sessionMessages = sessionManager.getSession(targetId);
    if (!sessionMessages || sessionMessages.length === 0) return { ok: false, error: 'No session messages to compress' };
    const settings = loadSettings();
    const anthropicKey = settings.providerKeys['anthropic']?.trim();
    if (!anthropicKey) return { ok: false, error: 'Anthropic API key required for compression' };
    const result = await compressConversationHistory(sessionMessages, anthropicKey);
    return { ok: true, ...result };
  });
}

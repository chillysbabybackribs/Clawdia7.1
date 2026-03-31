import { BrowserWindow, ipcMain, shell } from 'electron';
import Anthropic from '@anthropic-ai/sdk';
import { IPC, IPC_EVENTS } from '../ipc-channels';
import { DEFAULT_MODEL_BY_PROVIDER, resolveModelForTier } from '../../shared/model-registry';
import type { Message, MessageAttachment, PromptDebugSnapshot, FeedItem, ToolCall, ConcurrentFeedSource } from '../../shared/types';
import { agentLoop } from '../agent/agentLoop';
import { PipelineOrchestrator } from '../core/PipelineOrchestrator';
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
import { runConcurrent } from '../core/executors/ConcurrentExecutor';
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

// ── Formatting helpers ────────────────────────────────────────────────────────

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
  function getMainWindow(): BrowserWindow | undefined {
    return BrowserWindow.getAllWindows()[0];
  }

  function send(channel: string, payload: unknown): void {
    const w = getMainWindow();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }

  function findConversationTerminalSessionId(conversationId: string): string | null {
    if (!terminalController) return null;
    const sessionsForConversation = terminalController
      .list()
      .filter((s) => s.conversationId === conversationId);
    const live = sessionsForConversation.find((s) => s.connected);
    return live?.sessionId ?? sessionsForConversation[0]?.sessionId ?? null;
  }

  function appendPromptTail(conversationId: string, text: string): void {
    if (!terminalController || !text.trim()) return;
    const sessionId = findConversationTerminalSessionId(conversationId);
    if (!sessionId) return;
    terminalController.appendOutput(sessionId, text);
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
    return {
      messages,
      mode: conv?.mode ?? ('chat' as const),
      claudeTerminalStatus: 'idle' as const,
      title: conv?.title ?? null,
      isRunning: sessionManager.isConversationRunning(id),
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
    browserService.releaseTab(id).catch(() => {});
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

    let id: string;
    if (conversationId) {
      id = conversationId;
      sessionManager.hydrateFromDb(id);
    } else {
      ensureConversation();
      id = sessionManager.activeConversationId!;
    }

    if (!getConversation(id)) {
      const now = new Date().toISOString();
      createConversation({ id, title: text.slice(0, 60) || 'New conversation', mode: 'chat', created_at: now, updated_at: now });
    }

    const userMsgId = `msg-u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const userMsgTs = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const nowTs = new Date().toISOString();
    const conversationTitle = text.trim().slice(0, 60) || 'New conversation';
    const userMsg: Message = { id: userMsgId, role: 'user', content: text, timestamp: userMsgTs, attachments };
    addMessage({ id: userMsgId, conversation_id: id, role: 'user', content: JSON.stringify(userMsg), created_at: nowTs });
    updateConversation(id, { updated_at: nowTs, title: conversationTitle });

    const sendEvent = (channel: string, payload: unknown) => {
      const w = getMainWindow();
      if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
    };

    // ── Executor routing ────────────────────────────────────────────────────
    const conv = getConversation(id);
    const { executorId, usedFallback, fallbackReason } = routeExecutor(conv?.mode ?? 'chat');
    if (usedFallback && fallbackReason) {
      console.warn(`[ChatIpc] executor routing fallback: ${fallbackReason}`);
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
      appendPromptTail(id, formatExternalPromptForTerminal('Claude Code', text));

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
          prompt: text,
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
      appendPromptTail(id, formatExternalPromptForTerminal('Concurrent', text));

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
          prompt: text,
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
      appendPromptTail(id, formatExternalPromptForTerminal('Codex', text));

      const codexRunId = `run-cdx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      registerRun(codexRunId, id, 'openai', 'codex', taskId);
      linkRunToTask(taskId, codexRunId);
      sessionManager.updateExecutorState(id, { runId: codexRunId });
      const assistantFeed: FeedItem[] = [];
      const assistantToolCalls = new Map<string, ToolCall>();

      try {
        const { finalText } = await runCodexCli({
          conversationId: id,
          prompt: text,
          onText: (delta) => {
            appendFeedText(assistantFeed, delta);
            sendEvent(IPC_EVENTS.CHAT_STREAM_TEXT, { delta, conversationId: id });
          },
          onToolActivity: (activity) => {
            assistantToolCalls.set(activity.id, activity);
            upsertFeedTool(assistantFeed, activity);
            sendEvent(IPC_EVENTS.CHAT_TOOL_ACTIVITY, { ...activity, conversationId: id });
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
        }
        return { response: finalText, conversationId: id };
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
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
      return { response: '', error: 'Select a provider in Settings to use chat.' };
    }
    const apiKey = settings.providerKeys[resolvedProvider as keyof typeof settings.providerKeys]?.trim();
    if (!apiKey) return { response: '', error: `Add a ${resolvedProvider} API key in Settings.` };

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
    const usePipeline = !isAppMappingRequest(text) && !(continuationForcedProfile?.specialMode === 'app_mapping') && PipelineOrchestrator.classifyIntent(text);

    let result: { response: string; error?: string } = { response: '', error: 'Unknown failure' };

    if (usePipeline) {
      const pipelineMsgId = `msg-pipe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: true, pipelineMessageId: pipelineMsgId, isPipelineStart: true, conversationId: id });
      try {
        const response = await PipelineOrchestrator.run(text, {
          provider: settings_provider,
          apiKey,
          model,
          conversationId: id,   // already present — also routed to worker loops below
          signal: convAgent.abort.signal,
          browserService,
          unrestrictedMode: settings.unrestrictedMode,
          onStateChanged: (state) => sendEvent(IPC_EVENTS.SWARM_STATE_CHANGED, { ...state, conversationId: id }),
          onText: (delta) => sendEvent(IPC_EVENTS.CHAT_STREAM_TEXT, { delta, conversationId: id }),
        });
        result = { response };
        completeTask(taskId);
        sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: true, conversationId: id });
        if (response) {
          const assistantMsgId = `msg-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const assistantMsgTs = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const assistantMsg: Message = { id: assistantMsgId, role: 'assistant', content: response, timestamp: assistantMsgTs };
          const nowStr = new Date().toISOString();
          addMessage({ id: assistantMsgId, conversation_id: id, role: 'assistant', content: JSON.stringify(assistantMsg), created_at: nowStr });
          updateConversation(id, { updated_at: nowStr, title: text.slice(0, 60) || 'New conversation' });
          const session = sessionManager.getOrCreateSession(id);
          session.push({ role: 'user', content: text });
          session.push({ role: 'assistant', content: response });
        }
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        result = { response: '', error: err.message };
        if (err.name === 'AbortError' || err.message === 'AbortError') {
          cancelTask(taskId);
          sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: false, cancelled: true, conversationId: id });
        } else {
          failTask(taskId, err.message);
          sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message, conversationId: id });
        }
      } finally {
        sessionManager.deleteAgent(id);
        sessionManager.updateExecutorState(id, { status: result?.error ? 'failed' : 'idle', runId: null });
      }
    } else {
      const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      convAgent.runId = runId;
      // Register the agentLoop run in DB (previously not persisted for Anthropic path).
      registerRun(runId, id, settings_provider, configuredModel, taskId);
      linkRunToTask(taskId, runId);
      sessionManager.updateExecutorState(id, { runId, status: 'running' });
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
        const response = await agentLoop(text, sessionMessages, {
          provider: settings_provider,
          apiKey,
          model,
          runId,
          conversationId: id,
          signal: convAgent.abort.signal,
          forcedProfile: continuationForcedProfile,
          unrestrictedMode: settings.unrestrictedMode,
          browserService,
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
        });
        result = { response };
        completeRun(runId, 0, 0);
        completeTask(taskId);
        sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: true, conversationId: id });
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (err.name === 'AbortError' || err.message === 'AbortError') {
          if (settings_provider === 'anthropic') {
            repairSession(sessionMessages, 'user_interrupted', 'ChatIpc.agentAbort');
          }
          result = { response: '', error: 'Stopped' };
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
        sessionManager.deleteAgent(id);
        sessionManager.updateExecutorState(id, {
          status: result?.error ? 'failed' : 'idle',
          runId: null,
        });
      }

      if (result!.response && !result!.error) {
        const assistantMsgId = `msg-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const assistantMsgTs = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const finalizedFeed = finalizeFeed(assistantFeed);
        const assistantMsg: Message = {
          id: assistantMsgId,
          role: 'assistant',
          content: result!.response,
          timestamp: assistantMsgTs,
          feed: finalizedFeed,
          toolCalls: Array.from(assistantToolCalls.values()),
        };
        const nowStr = new Date().toISOString();
        addMessage({ id: assistantMsgId, conversation_id: id, role: 'assistant', content: JSON.stringify(assistantMsg), created_at: nowStr });
        updateConversation(id, { updated_at: nowStr, title: text.slice(0, 60) || 'New conversation' });
        deleteStreamingResponse(streamingId);
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
    if (sessionMessages) repairSession(sessionMessages, 'user_interrupted', 'ChatIpc.chatStop');
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
}

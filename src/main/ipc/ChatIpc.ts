import { BrowserWindow, ipcMain, shell } from 'electron';
import Anthropic from '@anthropic-ai/sdk';
import { IPC, IPC_EVENTS } from '../ipc-channels';
import { DEFAULT_MODEL_BY_PROVIDER, resolveModelForTier } from '../../shared/model-registry';
import type { Message, MessageAttachment, PromptDebugSnapshot, FeedItem, ToolCall } from '../../shared/types';
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

function appendFeedText(feed: FeedItem[], chunk: string): void {
  if (!chunk) return;
  const last = feed[feed.length - 1];
  if (last?.kind === 'text' && last.isStreaming) {
    last.text += chunk;
    return;
  }
  feed.push({ kind: 'text', text: chunk, isStreaming: true });
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
  ipcMain.handle(IPC.CHAT_SEND, async (_event, payload: { text: string; attachments?: MessageAttachment[]; conversationId?: string | null }) => {
    const { text, attachments, conversationId } = payload || { text: '' };

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
    const userMsg: Message = { id: userMsgId, role: 'user', content: text, timestamp: userMsgTs, attachments };
    addMessage({ id: userMsgId, conversation_id: id, role: 'user', content: JSON.stringify(userMsg), created_at: nowTs });
    updateConversation(id, { updated_at: nowTs });

    const sendEvent = (channel: string, payload: unknown) => {
      const w = getMainWindow();
      if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
    };

    // ── Claude Code path ────────────────────────────────────────────────────
    const conv = getConversation(id);
    if (conv?.mode === 'claude_terminal') {
      sendEvent(IPC_EVENTS.CHAT_THINKING, { thought: 'Claude Code is thinking…', conversationId: id });
      appendPromptTail(id, formatExternalPromptForTerminal('Claude Code', text));

      // Load persisted session id so resume survives app restarts.
      const persistedSessionId = conv.claude_code_session_id ?? null;

      try {
        const { finalText, sessionId: newSessionId } = await runClaudeCode({
          conversationId: id,
          prompt: text,
          attachments,
          skipPermissions: loadSettings().unrestrictedMode,
          persistedSessionId,
          onText: (delta) => sendEvent(IPC_EVENTS.CHAT_STREAM_TEXT, { delta, conversationId: id }),
          onToolActivity: (activity) => sendEvent(IPC_EVENTS.CHAT_TOOL_ACTIVITY, { ...activity, conversationId: id }),
        });
        sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: true, conversationId: id });

        // Persist the session id durably so the next run (even after restart) can resume.
        if (newSessionId && newSessionId !== persistedSessionId) {
          updateConversation(id, { claude_code_session_id: newSessionId });
        }

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

        sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message, conversationId: id });
        return { response: '', error: err.message, conversationId: id };
      }
    }

    // ── Codex path ──────────────────────────────────────────────────────────
    if (conv?.mode === 'codex_terminal') {
      sendEvent(IPC_EVENTS.CHAT_THINKING, { thought: 'Codex is thinking…', conversationId: id });
      appendPromptTail(id, formatExternalPromptForTerminal('Codex', text));
      try {
        const { finalText } = await runCodexCli({
          conversationId: id,
          prompt: text,
          onText: (delta) => sendEvent(IPC_EVENTS.CHAT_STREAM_TEXT, { delta, conversationId: id }),
        });
        sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: true, conversationId: id });
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
        sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message, conversationId: id });
        return { response: '', error: err.message, conversationId: id };
      }
    }

    // ── Standard LLM path ──────────────────────────────────────────────────
    const settings = loadSettings();
    if (settings.provider !== 'anthropic' && settings.provider !== 'gemini' && settings.provider !== 'openai') {
      return { response: '', error: 'Select a provider in Settings to use chat.' };
    }
    const apiKey = settings.providerKeys[settings.provider as keyof typeof settings.providerKeys]?.trim();
    if (!apiKey) return { response: '', error: `Add a ${settings.provider} API key in Settings.` };

    const configuredModel = settings.models[settings.provider as keyof typeof settings.models]
      ?? DEFAULT_MODEL_BY_PROVIDER[settings.provider as keyof typeof DEFAULT_MODEL_BY_PROVIDER];
    const settings_provider = settings.provider as 'anthropic' | 'openai' | 'gemini';

    const maxTurns = isAppMappingRequest(text) ? sessionManager.maxMappingSessionTurns : sessionManager.maxSessionTurns;
    let sessionMessages = sessionManager.pruneSessionInPlace(id, maxTurns);
    if (settings_provider === 'anthropic') {
      repairSession(sessionMessages, 'session_recovery', 'ChatIpc.sessionRecovery');
      sessionManager.closePendingToolUses(id, 'session_recovery');
    }

    sessionManager.abortAgent(id);
    const convAgent = sessionManager.getOrCreateAgent(id);
    sessionManager.activeConversationId = id;

    const continuationForcedProfile = buildContinuationForcedProfile(text, sessionMessages);
    const taskProfile = classify(text, continuationForcedProfile ?? undefined);
    const model = resolveModelForTier(taskProfile.modelTier, settings_provider, configuredModel);
    const usePipeline = !isAppMappingRequest(text) && !(continuationForcedProfile?.specialMode === 'app_mapping') && PipelineOrchestrator.classifyIntent(text);

    let result: { response: string; error?: string };

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
        sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message, conversationId: id });
      } finally {
        sessionManager.deleteAgent(id);
      }
    } else {
      const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      convAgent.runId = runId;
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
        sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: true, conversationId: id });
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (err.name === 'AbortError' || err.message === 'AbortError') {
          if (settings_provider === 'anthropic') {
            repairSession(sessionMessages, 'user_interrupted', 'ChatIpc.agentAbort');
          }
          result = { response: '', error: 'Stopped' };
          sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: false, cancelled: true, conversationId: id });
        } else {
          result = { response: '', error: err.message };
          sendEvent(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message, conversationId: id });
        }
      } finally {
        if (streamingFlushTimer) { clearTimeout(streamingFlushTimer); streamingFlushTimer = null; }
        sessionManager.deleteAgent(id);
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

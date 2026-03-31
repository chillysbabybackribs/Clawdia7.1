import { BrowserWindow, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';
import { ElectronBrowserService } from './core/browser/ElectronBrowserService';
import { IPC, IPC_EVENTS } from './ipc-channels';
import { DEFAULT_MODEL_BY_PROVIDER } from '../shared/model-registry';
import type { Message } from '../shared/types';
import type { MessageAttachment } from '../shared/types';
import type { PromptDebugSnapshot } from '../shared/types';
import type { FeedItem, ToolCall } from '../shared/types';
import type { AgentDefinition, AgentBuilderCompileInput } from '../shared/types';
import { agentLoop } from './agent/agentLoop';
import { PipelineOrchestrator } from './core/PipelineOrchestrator';
import { classify, isAppMappingRequest, isContinuationRequest, extractAppMappingTarget } from './agent/classify';
import { resolveModelForTier } from '../shared/model-registry';
import { cancelLoop, pauseLoop, resumeLoop, addContext } from './agent/loopControl';
import { loadSettings, patchSettings, type AppSettings } from './settingsStore';
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
  getDb,
  upsertStreamingResponse,
  deleteStreamingResponse,
  getOrphanedStreamingResponses,
} from './db';
import { listPolicyProfiles } from './db/policies';
import {
  createAgent,
  getAgent,
  listAgents,
  updateAgent,
  deleteAgent,
} from './db/agents';
import { listActiveBudgets, insertTransaction, sumPeriodSpend } from './db/spending';
import { evaluatePolicy } from './agent/policy-engine';
import { a11yListApps } from './core/desktop/a11y';
import { smartFocus } from './core/desktop/smartFocus';
import { getRemainingBudgets, checkBudget } from './agent/spending-budget';
import { runClaudeCode } from './claudeCodeClient';
import { runCodexCli } from './codexCliClient';
import { attachClawdiaMcpBridge } from './mcpBridge';
import { registerWorkspaceStateAccessor } from './core/cli/workspaceState';
import { setUIState } from './core/cli/uiStateAccessor';
import { TerminalSessionController } from './core/terminal/TerminalSessionController';
import {
  closePendingAnthropicToolUses,
  prepareAnthropicMessagesForSend,
} from './core/providers/anthropicMessageProtocol';

function repairAnthropicSessionInPlace(sessionMessages: any[], reason: 'user_interrupted' | 'session_recovery', caller: string): void {
  const repaired = prepareAnthropicMessagesForSend(sessionMessages, {
    caller,
    closePendingToolUses: true,
    pendingToolUseReason: reason,
    onRepair: (issues) => {
      console.warn(`[registerIpc] repaired Anthropic session in ${caller}: ${issues.join(' | ')}`);
    },
  });
  if (repaired.repaired) {
    sessionMessages.splice(0, sessionMessages.length, ...repaired.messages);
  }
}

function getMainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0];
}

const sessions = new Map<string, any[]>();
let activeConversationId: string | null = null;

// Per-conversation agent controllers — allows multiple tabs to run agents in parallel.
interface ConvAgent {
  abort: AbortController;
  runId: string | null;
}
const convAgents = new Map<string, ConvAgent>();

// Expose live state to the workspace awareness tools without circular imports.
registerWorkspaceStateAccessor({
  getActiveConversationIds: () => [...sessions.keys()],
  isConversationRunning: (id) => convAgents.has(id),
  getSessionMessages: (id) => sessions.get(id) ?? [],
});

function getOrCreateConvAgent(conversationId: string): ConvAgent {
  let agent = convAgents.get(conversationId);
  if (!agent) {
    agent = { abort: new AbortController(), runId: null };
    convAgents.set(conversationId, agent);
  }
  return agent;
}

const MAX_SESSION_TURNS = 20; // max user+assistant turn PAIRS to keep
const MAX_MAPPING_SESSION_TURNS = 6;

/**
 * Prune a session to the last MAX_SESSION_TURNS pairs.
 * Always cuts at a user-role boundary to avoid orphaned tool_result blocks.
 */
function pruneSession(messages: any[], maxTurns = MAX_SESSION_TURNS): any[] {
  const maxMessages = maxTurns * 2;
  if (messages.length <= maxMessages) return messages;
  let start = messages.length - maxMessages;
  // Walk forward until we land on a user message
  while (start < messages.length && messages[start].role !== 'user') {
    start++;
  }
  return messages.slice(start);
}

function getOrCreateSession(id: string): any[] {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id)!;
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

function formatPromptDebugForTerminal(snapshot: PromptDebugSnapshot): string {
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

function formatSystemPromptForTerminal(provider: string, model: string, prompt: string): string {
  return formatPromptBlock(`SystemPrompt ${provider}/${model}`, [prompt || '(empty)']);
}

function formatExternalPromptForTerminal(label: string, prompt: string): string {
  return formatPromptBlock(`${label} Prompt`, [prompt || '(empty)']);
}

function ensureConversation(): string {
  if (!activeConversationId) {
    activeConversationId = `conv-${Date.now()}`;
    sessions.set(activeConversationId, []);
  }
  return activeConversationId;
}

function findLastUserText(messages: any[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== 'user') continue;
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      const text = msg.content
        .filter((b: any) => b?.type === 'text')
        .map((b: any) => b.text)
        .join('\n')
        .trim();
      if (text) return text;
    }
    if (Array.isArray(msg.parts)) {
      const text = msg.parts
        .map((p: any) => p?.text ?? '')
        .join('\n')
        .trim();
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
    return content
      .map((b) => {
        if (b.type === 'text') return b.text;
        if (b.type === 'image') return '[Image]';
        return '';
      })
      .filter(Boolean)
      .join('\n');
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
      out.push({
        id: `hist-u-${i++}`,
        role: 'user',
        content: userTextFromContent(p.content),
        timestamp: ts(),
      });
    } else if (p.role === 'assistant') {
      out.push({
        id: `hist-a-${i++}`,
        role: 'assistant',
        content: assistantTextFromContent(p.content),
        timestamp: ts(),
      });
    }
  }
  return out;
}

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
    if (last?.kind === 'text' && last.isStreaming) {
      last.isStreaming = false;
    }
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

export function registerIpc(
  browserService: ElectronBrowserService,
  terminalController?: TerminalSessionController,
): void {
  attachClawdiaMcpBridge(browserService);

  const findConversationTerminalSessionId = (conversationId: string): string | null => {
    if (!terminalController) return null;
    const sessionsForConversation = terminalController
      .list()
      .filter((session) => session.conversationId === conversationId);
    const live = sessionsForConversation.find((session) => session.connected);
    return live?.sessionId ?? sessionsForConversation[0]?.sessionId ?? null;
  };

  const appendPromptTail = (conversationId: string, text: string): void => {
    if (!terminalController || !text.trim()) return;
    const sessionId = findConversationTerminalSessionId(conversationId);
    if (!sessionId) return;
    terminalController.appendOutput(sessionId, text);
  };

  ipcMain.handle(IPC.WINDOW_MINIMIZE, () => {
    getMainWindow()?.minimize();
  });
  ipcMain.handle(IPC.WINDOW_MAXIMIZE, () => {
    const w = getMainWindow();
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  ipcMain.handle(IPC.WINDOW_CLOSE, () => {
    getMainWindow()?.close();
  });

  ipcMain.handle(IPC.SETTINGS_GET, (_e, key: keyof AppSettings) => {
    const s = loadSettings();
    return s[key] ?? null;
  });

  ipcMain.handle(IPC.SETTINGS_SET, (_e, key: keyof AppSettings, value: unknown) => {
    patchSettings({ [key]: value } as Partial<AppSettings>);
  });

  ipcMain.handle(IPC.SETTINGS_GET_PROVIDER_KEYS, () => loadSettings().providerKeys);

  ipcMain.handle(IPC.SETTINGS_GET_PROVIDER, () => loadSettings().provider);

  ipcMain.handle(IPC.SETTINGS_SET_PROVIDER, (_e, provider: AppSettings['provider']) => {
    patchSettings({ provider });
  });

  ipcMain.handle(IPC.API_KEY_GET, (_e, provider?: string) => {
    if (!provider) return null;
    return loadSettings().providerKeys[provider as keyof AppSettings['providerKeys']] ?? '';
  });

  ipcMain.handle(IPC.API_KEY_SET, (_e, provider: string, key: string) => {
    const cur = loadSettings();
    patchSettings({
      providerKeys: { ...cur.providerKeys, [provider]: key },
    });
  });

  ipcMain.handle(IPC.MODEL_GET, (_e, provider?: string) => {
    if (!provider) return null;
    const s = loadSettings();
    return s.models[provider as keyof typeof s.models] ?? DEFAULT_MODEL_BY_PROVIDER[provider as keyof typeof DEFAULT_MODEL_BY_PROVIDER];
  });

  ipcMain.handle(IPC.MODEL_SET, (_e, provider: string, model: string) => {
    const cur = loadSettings();
    patchSettings({ models: { ...cur.models, [provider]: model } });
  });

  ipcMain.handle('settings:get-unrestricted-mode', () => loadSettings().unrestrictedMode);
  ipcMain.handle('settings:set-unrestricted-mode', (_e, v: boolean) => patchSettings({ unrestrictedMode: v }));

  ipcMain.handle('settings:get-policy-profile', () => loadSettings().policyProfile);
  ipcMain.handle('settings:set-policy-profile', (_e, v: string) => patchSettings({ policyProfile: v }));

  ipcMain.handle('settings:get-performance-stance', () => loadSettings().performanceStance);
  ipcMain.handle('settings:set-performance-stance', (_e, v: AppSettings['performanceStance']) =>
    patchSettings({ performanceStance: v }),
  );

  ipcMain.handle(IPC.POLICY_LIST, () => listPolicyProfiles());

  // CHAT_NEW: aborts only the currently active conversation's agent (the one in the same tab),
  // then resets that tab to a new conversation. Does NOT abort agents in other tabs.
  ipcMain.handle(IPC.CHAT_NEW, () => {
    if (activeConversationId) {
      const agent = convAgents.get(activeConversationId);
      if (agent) {
        agent.abort.abort();
        convAgents.delete(activeConversationId);
      }
    }
    const now = new Date().toISOString();
    const id = `conv-${Date.now()}`;
    createConversation({ id, title: 'New conversation', mode: 'chat', created_at: now, updated_at: now });
    activeConversationId = id;
    sessions.set(id, []);
    return { id };
  });

  // CHAT_CREATE: creates a new conversation without aborting any running agent.
  // Used when opening a new tab while another tab has a running agent.
  ipcMain.handle(IPC.CHAT_CREATE, () => {
    const now = new Date().toISOString();
    const id = `conv-${Date.now()}`;
    createConversation({ id, title: 'New conversation', mode: 'chat', created_at: now, updated_at: now });
    sessions.set(id, []);
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
    // Do NOT update the global activeConversationId here — multiple tabs can
    // load different conversations and we must not let one tab's load clobber
    // another tab's active conversation for send/stop/pause routing.

    // Hydrate in-memory session from DB if not already loaded
    if (!sessions.has(id)) {
      const rows = getMessages(id);
      const apiMessages: any[] = rows
        .filter((r) => r.role === 'user' || r.role === 'assistant')
        .map((r) => {
          try {
            const parsed = JSON.parse(r.content);
            return { role: r.role, content: parsed.content ?? r.content };
          } catch {
            return { role: r.role, content: r.content };
          }
        });
      sessions.set(id, apiMessages);
    }

    const rows = getMessages(id);
    const messages: Message[] = rows.map((r) => {
      try {
        return JSON.parse(r.content) as Message;
      } catch {
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
      isRunning: convAgents.has(id),
    };
  });

  ipcMain.handle(IPC.CHAT_GET_MODE, (_e, id: string) => {
    const conv = getConversation(id);
    const mode = conv?.mode ?? 'chat';
    return { mode, claudeTerminalStatus: 'idle' as const };
  });
  ipcMain.handle(IPC.CHAT_SET_MODE, (_e, id: string, mode: string) => {
    if (id) {
      // If the conversation doesn't exist in DB yet, create it so the mode isn't lost
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

  ipcMain.handle(IPC.CHAT_SEND, async (event, payload: { text: string; attachments?: MessageAttachment[]; conversationId?: string | null }) => {
    const { text, attachments, conversationId } = payload || { text: '' };

    // Resolve which conversation this send belongs to. Prefer the explicit
    // conversationId from the renderer (multi-tab safe). Only fall back to
    // the legacy global if nothing was passed (single-tab backwards compat).
    let id: string;
    if (conversationId) {
      id = conversationId;
      if (!sessions.has(id)) {
        // Hydrate from DB so prior history is available to the LLM even if CHAT_LOAD was never called
        const rows = getMessages(id);
        const apiMessages: any[] = rows
          .filter((r) => r.role === 'user' || r.role === 'assistant')
          .map((r) => {
            try {
              const parsed = JSON.parse(r.content);
              return { role: r.role, content: parsed.content ?? r.content };
            } catch {
              return { role: r.role, content: r.content };
            }
          });
        sessions.set(id, apiMessages);
      }
    } else {
      ensureConversation();
      id = activeConversationId!;
    }

    // Ensure conversation exists in DB (handles legacy in-memory-only convs)
    if (!getConversation(id)) {
      const now = new Date().toISOString();
      createConversation({ id, title: text.slice(0, 60) || 'New conversation', mode: 'chat', created_at: now, updated_at: now });
    }

    // Persist user message
    const userMsgId = `msg-u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const userMsgTs = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const nowTs = new Date().toISOString();
    const userMsg: Message = { id: userMsgId, role: 'user', content: text, timestamp: userMsgTs, attachments };
    addMessage({ id: userMsgId, conversation_id: id, role: 'user', content: JSON.stringify(userMsg), created_at: nowTs });
    updateConversation(id, { updated_at: nowTs });

    // Helper: broadcast events tagged with conversationId.
    // Defined early so claude_terminal/codex paths can also use it.
    const winEarly = getMainWindow();
    const sendEarly = (channel: string, payload: unknown) => {
      if (winEarly && !winEarly.isDestroyed()) winEarly.webContents.send(channel, payload);
    };

    // ── Claude Code path — uses claude CLI with user's account (no API key needed) ──
    const conv = getConversation(id);
    if (conv?.mode === 'claude_terminal') {
      sendEarly(IPC_EVENTS.CHAT_THINKING, { thought: 'Claude Code is thinking…', conversationId: id });
      appendPromptTail(id, formatExternalPromptForTerminal('Claude Code', text));

      try {
        const { finalText } = await runClaudeCode({
          conversationId: id,
          prompt: text,
          skipPermissions: loadSettings().unrestrictedMode,
          onText: (delta) => {
            sendEarly(IPC_EVENTS.CHAT_STREAM_TEXT, { delta, conversationId: id });
          },
        });

        sendEarly(IPC_EVENTS.CHAT_STREAM_END, { ok: true, conversationId: id });

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
        sendEarly(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message, conversationId: id });
        return { response: '', error: err.message, conversationId: id };
      }
    }
    // ── End Claude Code path ──────────────────────────────────────────────────

    // ── Codex path — uses codex CLI with OpenAI API key ──────────────────────
    if (conv?.mode === 'codex_terminal') {
      sendEarly(IPC_EVENTS.CHAT_THINKING, { thought: 'Codex is thinking…', conversationId: id });
      appendPromptTail(id, formatExternalPromptForTerminal('Codex', text));

      try {
        const { finalText } = await runCodexCli({
          conversationId: id,
          prompt: text,
          onText: (delta) => {
            sendEarly(IPC_EVENTS.CHAT_STREAM_TEXT, { delta, conversationId: id });
          },
        });

        sendEarly(IPC_EVENTS.CHAT_STREAM_END, { ok: true, conversationId: id });

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
        sendEarly(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message, conversationId: id });
        return { response: '', error: err.message, conversationId: id };
      }
    }
    // ── End Codex path ───────────────────────────────────────────────────────

    const settings = loadSettings();
    if (settings.provider !== 'anthropic' && settings.provider !== 'gemini' && settings.provider !== 'openai') {
      return { response: '', error: 'Select a provider in Settings to use chat.' };
    }
    const apiKey = settings.providerKeys[settings.provider as keyof typeof settings.providerKeys]?.trim();
    if (!apiKey) {
      return { response: '', error: `Add a ${settings.provider} API key in Settings.` };
    }
    const configuredModel = settings.models[settings.provider as keyof typeof settings.models] ?? DEFAULT_MODEL_BY_PROVIDER[settings.provider as keyof typeof DEFAULT_MODEL_BY_PROVIDER];

    const settings_provider = settings.provider as 'anthropic' | 'openai' | 'gemini';

    let sessionMessages = getOrCreateSession(id);
    const maxTurns = isAppMappingRequest(text) ? MAX_MAPPING_SESSION_TURNS : MAX_SESSION_TURNS;
    const pruned = pruneSession(sessionMessages, maxTurns);
    if (pruned.length < sessionMessages.length) {
      sessions.set(id, pruned);
      sessionMessages = pruned;
    }
    if (settings_provider === 'anthropic') {
      repairAnthropicSessionInPlace(sessionMessages, 'session_recovery', 'registerIpc.sessionRecovery');
      closePendingAnthropicToolUses(sessionMessages, 'session_recovery');
    }

    // Abort any existing agent for THIS conversation only (re-send in same tab).
    // Agents running in other conversations (other tabs) are unaffected.
    const existingAgent = convAgents.get(id);
    if (existingAgent) {
      existingAgent.abort.abort();
      convAgents.delete(id);
    }
    const convAgent = getOrCreateConvAgent(id);
    activeConversationId = id;

    // Broadcast stream events tagged with conversationId so each ChatPanel
    // can filter to its own conversation, even when multiple tabs are running.
    const win = getMainWindow();
    const send = (channel: string, payload: unknown) => {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    };

    const continuationForcedProfile = buildContinuationForcedProfile(text, sessionMessages);

    // Classify the request to get modelTier, then resolve the best model.
    // 'fast' tasks (quick/simple/brief) route to the provider's cheapest model.
    // 'powerful' tasks (browser, desktop, deep research) use the user's config.
    // 'standard' tasks use the provider's balanced model.
    const taskProfile = classify(text, continuationForcedProfile ?? undefined);
    const model = resolveModelForTier(taskProfile.modelTier, settings_provider, configuredModel);

    // Check if this goal warrants a multi-agent pipeline
    const usePipeline = !isAppMappingRequest(text) && !(continuationForcedProfile?.specialMode === 'app_mapping') && PipelineOrchestrator.classifyIntent(text);

    let result: { response: string; error?: string };

    if (usePipeline) {
      // ── Multi-agent pipeline path ─────────────────────────────────────────
      const pipelineMsgId = `msg-pipe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      send(IPC_EVENTS.CHAT_STREAM_END, { ok: true, pipelineMessageId: pipelineMsgId, isPipelineStart: true, conversationId: id });

      try {
        const response = await PipelineOrchestrator.run(text, {
          provider: settings_provider,
          apiKey,
          model,
          conversationId: id,
          signal: convAgent.abort.signal,
          browserService,
          unrestrictedMode: settings.unrestrictedMode,
          onStateChanged: (state) => {
            send(IPC_EVENTS.SWARM_STATE_CHANGED, { ...state, conversationId: id });
          },
          onText: (delta) => {
            send(IPC_EVENTS.CHAT_STREAM_TEXT, { delta, conversationId: id });
          },
        });

        result = { response };
        send(IPC_EVENTS.CHAT_STREAM_END, { ok: true, conversationId: id });

        if (response) {
          const assistantMsgId = `msg-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const assistantMsgTs = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const assistantMsg: Message = { id: assistantMsgId, role: 'assistant', content: response, timestamp: assistantMsgTs };
          const nowStr = new Date().toISOString();
          addMessage({ id: assistantMsgId, conversation_id: id, role: 'assistant', content: JSON.stringify(assistantMsg), created_at: nowStr });
          updateConversation(id, { updated_at: nowStr, title: text.slice(0, 60) || 'New conversation' });

          const session = sessions.get(id) ?? [];
          session.push({ role: 'user', content: text });
          session.push({ role: 'assistant', content: response });
          sessions.set(id, session);
        }
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        result = { response: '', error: err.message };
        send(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message, conversationId: id });
      } finally {
        convAgents.delete(id);
      }
    } else {
      // ── Single agent path ─────────────────────────────────────────────────
      const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      convAgent.runId = runId;
      const assistantFeed: FeedItem[] = [];
      const assistantToolCalls = new Map<string, ToolCall>();

      // Streaming checkpoint: write accumulated text to DB periodically so
      // a crash doesn't lose the entire in-progress response.
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
          signal: convAgent.abort.signal,
          forcedProfile: continuationForcedProfile,
          unrestrictedMode: settings.unrestrictedMode,
          browserService,
          attachments,
          onText: (delta) => {
            streamingBuffer += delta;
            appendFeedText(assistantFeed, delta);
            scheduleFlush();
            send(IPC_EVENTS.CHAT_STREAM_TEXT, { delta, conversationId: id });
          },
          onThinking: (t) => {
            send(IPC_EVENTS.CHAT_THINKING, { thought: t, conversationId: id });
          },
          onPromptDebug: (snapshot: PromptDebugSnapshot) => {
            appendPromptTail(id, formatPromptDebugForTerminal(snapshot));
            send(IPC_EVENTS.CHAT_PROMPT_DEBUG, { ...snapshot, conversationId: id });
          },
          onToolActivity: (activity) => {
            const normalizedActivity: ToolCall = { ...activity };
            assistantToolCalls.set(normalizedActivity.id, {
              ...(assistantToolCalls.get(normalizedActivity.id) ?? {}),
              ...normalizedActivity,
            });
            upsertFeedTool(assistantFeed, normalizedActivity);
            send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, { ...activity, conversationId: id });
          },
          onSystemPrompt: (prompt) => {
            appendPromptTail(id, formatSystemPromptForTerminal(settings_provider, model, prompt));
            updateRun(runId, { system_prompt: prompt });
          },
        });
        result = { response };
        send(IPC_EVENTS.CHAT_STREAM_END, { ok: true, conversationId: id });
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (err.name === 'AbortError' || err.message === 'AbortError') {
          if (settings_provider === 'anthropic') {
            repairAnthropicSessionInPlace(sessionMessages, 'user_interrupted', 'registerIpc.agentAbort');
          }
          result = { response: '', error: 'Stopped' };
          send(IPC_EVENTS.CHAT_STREAM_END, { ok: false, cancelled: true, conversationId: id });
        } else {
          result = { response: '', error: err.message };
          send(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message, conversationId: id });
        }
      } finally {
        if (streamingFlushTimer) { clearTimeout(streamingFlushTimer); streamingFlushTimer = null; }
        convAgents.delete(id);
      }

      // Persist assistant message and clear streaming checkpoint
      if (result.response && !result.error) {
        const assistantMsgId = `msg-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const assistantMsgTs = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const finalizedFeed = finalizeFeed(assistantFeed);
        const assistantMsg: Message = {
          id: assistantMsgId,
          role: 'assistant',
          content: result.response,
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

    return { ...result, conversationId: id };
  });

  // CHAT_STOP: accepts an optional conversationId. If provided, stops only that
  // conversation's agent. If omitted (legacy), stops the most recently active one.
  ipcMain.handle(IPC.CHAT_STOP, (_e, conversationId?: string) => {
    const targetId = conversationId ?? activeConversationId;
    if (!targetId) return;
    const agent = convAgents.get(targetId);
    if (agent) {
      agent.abort.abort();
      if (agent.runId) cancelLoop(agent.runId);
      convAgents.delete(targetId);
    }
    const sessionMessages = sessions.get(targetId);
    if (sessionMessages) {
      repairAnthropicSessionInPlace(sessionMessages, 'user_interrupted', 'registerIpc.chatStop');
    }
  });

  ipcMain.handle(IPC.CHAT_PAUSE, (_e, conversationId?: string) => {
    const targetId = conversationId ?? activeConversationId;
    if (!targetId) return;
    const agent = convAgents.get(targetId);
    if (agent?.runId) pauseLoop(agent.runId);
  });
  ipcMain.handle(IPC.CHAT_RESUME, (_e, conversationId?: string) => {
    const targetId = conversationId ?? activeConversationId;
    if (!targetId) return;
    const agent = convAgents.get(targetId);
    if (agent?.runId) resumeLoop(agent.runId);
  });
  ipcMain.handle(IPC.CHAT_ADD_CONTEXT, (_e, text: string, conversationId?: string) => {
    const targetId = conversationId ?? activeConversationId;
    if (!targetId) return;
    const agent = convAgents.get(targetId);
    if (agent?.runId) addContext(agent.runId, text);
  });
  ipcMain.handle(IPC.CHAT_RATE_TOOL, () => { });

  ipcMain.handle(IPC.RUN_LIST, (_e, conversationId: string) => {
    return getRuns(conversationId);
  });

  ipcMain.handle(IPC.RUN_EVENTS, (_e, runId: string) => {
    return getRunEvents(runId);
  });
  ipcMain.handle(IPC.CHAT_DELETE, (_e, id: string) => {
    deleteConversation(id);
    sessions.delete(id);
    if (activeConversationId === id) activeConversationId = null;
  });
  // (CHAT_OPEN_ATTACHMENT and TASKS_SUMMARY are registered at the end of this function)

  const sendToRenderer = (channel: string, payload: unknown): void => {
    const w = getMainWindow();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };

  ipcMain.handle(IPC.BROWSER_NAVIGATE, (_e, url: string) => browserService.navigate(url));
  ipcMain.handle(IPC.BROWSER_BACK, () => browserService.back());
  ipcMain.handle(IPC.BROWSER_FORWARD, () => browserService.forward());
  ipcMain.handle(IPC.BROWSER_REFRESH, () => browserService.refresh());
  ipcMain.handle(IPC.BROWSER_SET_BOUNDS, (_e, bounds: { x: number; y: number; width: number; height: number }) => {
    browserService.setBounds(bounds);
  });
  ipcMain.handle(IPC.BROWSER_GET_EXECUTION_MODE, () => browserService.getExecutionMode());
  ipcMain.handle(IPC.BROWSER_TAB_NEW, (_e, url?: string) => browserService.newTab(url));
  ipcMain.handle(IPC.BROWSER_TAB_LIST, () => browserService.listTabs());
  ipcMain.handle(IPC.BROWSER_TAB_SWITCH, (_e, id: string) => browserService.switchTab(id));
  ipcMain.handle(IPC.BROWSER_TAB_CLOSE, (_e, id: string) => browserService.closeTab(id));
  ipcMain.handle(IPC.BROWSER_HISTORY_MATCH, (_e, prefix: string) => browserService.matchHistory(prefix));
  ipcMain.handle(IPC.BROWSER_HIDE, () => browserService.hide());
  ipcMain.handle(IPC.BROWSER_SHOW, () => browserService.show());
  ipcMain.handle(IPC.BROWSER_LIST_SESSIONS, () => browserService.listSessions());
  ipcMain.handle(IPC.BROWSER_CLEAR_SESSION, (_e, domain: string) => browserService.clearSession(domain));

  browserService.on('urlChanged', (url) => sendToRenderer(IPC_EVENTS.BROWSER_URL_CHANGED, url));
  browserService.on('titleChanged', (title) => sendToRenderer(IPC_EVENTS.BROWSER_TITLE_CHANGED, title));
  browserService.on('loadingChanged', (loading) => sendToRenderer(IPC_EVENTS.BROWSER_LOADING, loading));
  browserService.on('tabsChanged', (tabs) => sendToRenderer(IPC_EVENTS.BROWSER_TABS_CHANGED, tabs));
  browserService.on('modeChanged', (payload) => sendToRenderer(IPC_EVENTS.BROWSER_MODE_CHANGED, payload));

  // ── Desktop ─────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.DESKTOP_LIST_APPS, async () => {
    const res = await a11yListApps();
    return res.apps ?? [];
  });

  ipcMain.handle(IPC.DESKTOP_FOCUS_APP, async (_e, app: string) => {
    const res = await smartFocus(app);
    return res.focused;
  });

  // ── Spending ────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.WALLET_GET_REMAINING_BUDGETS, () => {
    return getRemainingBudgets();
  });

  // ── Agents ──────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.AGENT_LIST, () => {
    return listAgents();
  });

  ipcMain.handle(IPC.AGENT_GET, (_e, id: string) => {
    return getAgent(id);
  });

  ipcMain.handle(IPC.AGENT_CREATE, (_e, input: Partial<import('../shared/types').AgentDefinition> & { goal: string }) => {
    const now = new Date().toISOString();
    const agent: import('../shared/types').AgentDefinition = {
      id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: input.name || 'Untitled Agent',
      description: input.description || '',
      agentType: input.agentType || 'general',
      status: 'draft',
      goal: input.goal ?? '',
      blueprint: input.blueprint,
      successDescription: input.successDescription,
      resourceScope: input.resourceScope || {},
      operationMode: input.operationMode || 'read_only',
      mutationPolicy: input.mutationPolicy || 'no_mutation',
      approvalPolicy: input.approvalPolicy || 'always_ask',
      launchModes: input.launchModes || ['manual'],
      defaultLaunchMode: input.defaultLaunchMode || 'manual',
      config: input.config || {},
      outputMode: input.outputMode || 'chat_message',
      outputTarget: input.outputTarget,
      schedule: input.schedule || null,
      lastTestStatus: 'untested',
      createdAt: now,
      updatedAt: now,
    };
    createAgent(agent);
    return agent;
  });

  ipcMain.handle(IPC.AGENT_UPDATE, (_e, id: string, patch: Partial<import('../shared/types').AgentDefinition>) => {
    return updateAgent(id, patch);
  });

  ipcMain.handle(IPC.AGENT_DELETE, (_e, id: string) => {
    deleteAgent(id);
    return { ok: true };
  });

  ipcMain.handle(IPC.AGENT_HISTORY, (_e, _agentId: string) => {
    return [];
  });

  ipcMain.handle(IPC.AGENT_RUN, async (_e, id: string) => {
    const agentDef = getAgent(id);
    if (!agentDef) return { ok: false, error: 'Agent not found' };
    const settings = loadSettings();
    const provider = settings.provider as 'anthropic' | 'openai' | 'gemini';
    const apiKey = settings.providerKeys[provider]?.trim();
    if (!apiKey) return { ok: false, error: 'No API key configured' };
    const model = settings.models[provider] ?? DEFAULT_MODEL_BY_PROVIDER[provider];
    const abort = new AbortController();
    const convId = `conv-agent-${Date.now()}`;
    const now = new Date().toISOString();
    createConversation({ id: convId, title: agentDef.name, mode: 'chat', created_at: now, updated_at: now });
    try {
      await PipelineOrchestrator.run(agentDef.goal, {
        provider, apiKey, model,
        conversationId: convId,
        signal: abort.signal,
        browserService,
        unrestrictedMode: settings.unrestrictedMode,
        onStateChanged: (state) => {
          getMainWindow()?.webContents.send(IPC_EVENTS.SWARM_STATE_CHANGED, state);
        },
        onText: () => {},
      });
      return { ok: true, conversationId: convId };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // ── Agent: Run on Current Page ──────────────────────────────────────────────
  ipcMain.handle(IPC.AGENT_RUN_CURRENT_PAGE, async (_e, id: string) => {
    const agentDef = getAgent(id);
    if (!agentDef) return { ok: false, error: 'Agent not found' };
    const settings = loadSettings();
    const provider = settings.provider as 'anthropic' | 'openai' | 'gemini';
    const apiKey = settings.providerKeys[provider]?.trim();
    if (!apiKey) return { ok: false, error: 'No API key configured' };
    const model = settings.models[provider] ?? DEFAULT_MODEL_BY_PROVIDER[provider];

    // Get current page context from the browser
    let pageUrl = '';
    let pageTitle = '';
    try {
      const tabs = await browserService.listTabs();
      const activeTab = tabs.find((t: any) => t.active);
      if (activeTab) {
        pageUrl = activeTab.url || '';
        pageTitle = activeTab.title || '';
      }
    } catch { /* browser may not be available */ }

    if (!pageUrl) return { ok: false, error: 'No active browser page found' };

    const abort = new AbortController();
    const convId = `conv-agent-${Date.now()}`;
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    createConversation({ id: convId, title: `${agentDef.name} — ${pageTitle || pageUrl}`, mode: 'chat', created_at: now, updated_at: now });

    const goal = `${agentDef.goal}\n\nContext: Run this agent on the currently open browser page.\nPage URL: ${pageUrl}\nPage Title: ${pageTitle}`;

    try {
      const sessionMessages = getOrCreateSession(convId);
      await agentLoop(goal, sessionMessages, {
        provider, apiKey, model, runId,
        signal: abort.signal,
        browserService,
        unrestrictedMode: settings.unrestrictedMode,
        onText: (delta) => {
          getMainWindow()?.webContents.send(IPC_EVENTS.CHAT_STREAM_TEXT, delta);
        },
        onThinking: (t) => {
          getMainWindow()?.webContents.send(IPC_EVENTS.CHAT_THINKING, t);
        },
        onToolActivity: (activity) => {
          getMainWindow()?.webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, activity);
        },
      });
      return { ok: true, runId, conversationId: convId };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // ── Agent: Run on URLs ─────────────────────────────────────────────────────
  ipcMain.handle(IPC.AGENT_RUN_URLS, async (_e, id: string, urls: string[]) => {
    const agentDef = getAgent(id);
    if (!agentDef) return { ok: false, error: 'Agent not found' };
    if (!urls || urls.length === 0) return { ok: false, error: 'No URLs provided' };
    const settings = loadSettings();
    const provider = settings.provider as 'anthropic' | 'openai' | 'gemini';
    const apiKey = settings.providerKeys[provider]?.trim();
    if (!apiKey) return { ok: false, error: 'No API key configured' };
    const model = settings.models[provider] ?? DEFAULT_MODEL_BY_PROVIDER[provider];

    const abort = new AbortController();
    const convId = `conv-agent-${Date.now()}`;
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    createConversation({ id: convId, title: `${agentDef.name} — ${urls.length} URL(s)`, mode: 'chat', created_at: now, updated_at: now });

    const urlList = urls.map((u, i) => `${i + 1}. ${u}`).join('\n');
    const goal = `${agentDef.goal}\n\nProcess the following URLs:\n${urlList}`;

    try {
      const sessionMessages = getOrCreateSession(convId);
      await agentLoop(goal, sessionMessages, {
        provider, apiKey, model, runId,
        signal: abort.signal,
        browserService,
        unrestrictedMode: settings.unrestrictedMode,
        onText: (delta) => {
          getMainWindow()?.webContents.send(IPC_EVENTS.CHAT_STREAM_TEXT, delta);
        },
        onThinking: (t) => {
          getMainWindow()?.webContents.send(IPC_EVENTS.CHAT_THINKING, t);
        },
        onToolActivity: (activity) => {
          getMainWindow()?.webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, activity);
        },
      });
      return { ok: true, runId, conversationId: convId };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // ── Agent: Test ────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.AGENT_TEST, async (_e, id: string) => {
    const agentDef = getAgent(id);
    if (!agentDef) return { ok: false, error: 'Agent not found' };
    const settings = loadSettings();
    const provider = settings.provider as 'anthropic' | 'openai' | 'gemini';
    const apiKey = settings.providerKeys[provider]?.trim();
    if (!apiKey) return { ok: false, error: 'No API key configured' };
    const model = settings.models[provider] ?? DEFAULT_MODEL_BY_PROVIDER[provider];

    const abort = new AbortController();
    const convId = `conv-agent-test-${Date.now()}`;
    const runId = `run-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    createConversation({ id: convId, title: `[Test] ${agentDef.name}`, mode: 'chat', created_at: now, updated_at: now });

    // Build a test-specific goal with dry-run constraints
    const testGoal = `[DRY RUN / TEST MODE] You are testing the following agent definition. Validate that each step is achievable, the tools are accessible, and the scope is correct. Do NOT make any real modifications — only read and verify.\n\nAgent: ${agentDef.name}\nGoal: ${agentDef.goal}\n${agentDef.blueprint ? `Steps:\n${agentDef.blueprint.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : ''}\n\nReport: Is this agent ready to run? List any issues found.`;

    try {
      const sessionMessages = getOrCreateSession(convId);
      const result = await agentLoop(testGoal, sessionMessages, {
        provider, apiKey, model, runId,
        signal: abort.signal,
        browserService,
        unrestrictedMode: settings.unrestrictedMode,
        onText: (delta) => {
          getMainWindow()?.webContents.send(IPC_EVENTS.CHAT_STREAM_TEXT, delta);
        },
        onThinking: (t) => {
          getMainWindow()?.webContents.send(IPC_EVENTS.CHAT_THINKING, t);
        },
        onToolActivity: (activity) => {
          getMainWindow()?.webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, activity);
        },
      });

      // Update agent with test result
      const passed = !result.toLowerCase().includes('fail') && !result.toLowerCase().includes('error') && !result.toLowerCase().includes('cannot');
      updateAgent(id, {
        lastTestStatus: passed ? 'passed' : 'failed',
        lastTestSummary: result.slice(0, 500),
      });

      return { ok: true, runId, conversationId: convId };
    } catch (e: any) {
      updateAgent(id, { lastTestStatus: 'failed', lastTestSummary: e.message });
      return { ok: false, error: e.message };
    }
  });

  // ── Agent: Compile (LLM-powered blueprint generation) ─────────────────────
  ipcMain.handle(IPC.AGENT_COMPILE, async (_e, input: AgentBuilderCompileInput) => {
    const settings = loadSettings();
    const provider = settings.provider as 'anthropic' | 'openai' | 'gemini';
    const apiKey = settings.providerKeys[provider]?.trim();
    if (!apiKey) return { ok: false, definition: null, error: 'No API key configured' };
    const model = settings.models[provider] ?? DEFAULT_MODEL_BY_PROVIDER[provider];

    const compilePrompt = `You are an agent architect. Given the user's goal, generate a structured agent blueprint as JSON.

Respond ONLY with a JSON object in this exact format:
{
  "name": "concise agent name",
  "description": "one-line description",
  "agentType": "web_data|spreadsheet|email|files|research|general",
  "outputMode": "preview|csv|json|spreadsheet|chat_message|file_output",
  "outputTarget": "optional file path or destination",
  "resourceScope": {
    "browserDomains": ["domain.com"],
    "urls": [],
    "folders": [],
    "files": [],
    "apps": []
  },
  "blueprint": {
    "objective": "what this agent achieves",
    "inputs": ["what it needs from the user"],
    "scope": ["what resources it accesses"],
    "constraints": ["guardrails and limits"],
    "steps": ["step 1", "step 2", "step 3"],
    "output": { "mode": "csv", "summary": "outputs a CSV of extracted data" },
    "successCriteria": ["how we know it worked"],
    "assumptions": ["what we assume is true"],
    "openQuestions": ["things to clarify"]
  },
  "questions": ["clarifying questions for the user, if any"],
  "warnings": ["potential issues or risks"]
}`;

    const userInput = input.refinement
      ? `Original goal: ${input.goal}\n\nRefinement: ${input.refinement}\n\n${input.currentBlueprint ? `Current blueprint: ${JSON.stringify(input.currentBlueprint)}` : ''}`
      : input.goal;

    try {
      const { streamLLM } = await import('./agent/streamLLM');
      const { text } = await streamLLM(
        [{ role: 'user', content: userInput }],
        compilePrompt,
        '',
        { toolGroup: 'core', modelTier: 'standard', isGreeting: false },
        {
          provider, apiKey, model,
          runId: `compile-${Date.now()}`,
          onText: () => {},
          maxIterations: 1,
        } as any,
      );

      // Parse the JSON response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { ok: false, definition: null, error: 'Model did not return valid JSON' };

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        ok: true,
        ...parsed,
        model,
      };
    } catch (e: any) {
      return { ok: false, definition: null, error: e.message };
    }
  });

  // ── Filesystem ──────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.FS_READ_DIR, async (_e, dirPath: string) => {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
        path: path.join(dirPath, e.name),
      }));
    } catch (err: any) {
      return [];
    }
  });

  ipcMain.handle(IPC.FS_READ_FILE, async (_e, filePath: string) => {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return content;
    } catch {
      return null;
    }
  });

  ipcMain.handle(IPC.FS_WRITE_FILE, async (_e, filePath: string, content: string) => {
    try {
      await fs.promises.writeFile(filePath, content, 'utf-8');
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // ── Editor ─────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.EDITOR_OPEN_FILE, (_e, filePath: string) => {
    getMainWindow()?.webContents.send(IPC_EVENTS.EDITOR_OPEN_FILE, { filePath });
  });

  ipcMain.handle(IPC.EDITOR_WATCH_FILE, (_e, filePath: string) => {
    try {
      const watcher = fs.watch(filePath, () => {
        getMainWindow()?.webContents.send(IPC_EVENTS.EDITOR_FILE_CHANGED, { filePath });
      });
      // Store watcher so it can be cleaned up
      (ipcMain as any).__editorWatcher = watcher;
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle(IPC.EDITOR_UNWATCH_FILE, () => {
    const watcher = (ipcMain as any).__editorWatcher;
    if (watcher) { watcher.close(); (ipcMain as any).__editorWatcher = null; }
  });

  ipcMain.handle(IPC.EDITOR_SET_STATE, (_e, state: any) => {
    (ipcMain as any).__editorState = state;
  });

  ipcMain.handle(IPC.EDITOR_GET_STATE, () => {
    return (ipcMain as any).__editorState ?? null;
  });

  // ── Chat: Open Attachment ─────────────────────────────────────────────────
  ipcMain.handle(IPC.CHAT_OPEN_ATTACHMENT, (_e, filePath: string) => {
    if (filePath && typeof filePath === 'string') {
      shell.openPath(filePath).catch(() => {});
    }
  });

  // ── Desktop: Kill App ──────────────────────────────────────────────────────
  ipcMain.handle(IPC.DESKTOP_KILL_APP, async (_e, pid: number) => {
    try {
      process.kill(pid, 'SIGTERM');
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // ── Wallet / Spending ──────────────────────────────────────────────────────
  ipcMain.handle(IPC.WALLET_GET_BUDGETS, () => {
    return listActiveBudgets();
  });

  ipcMain.handle(IPC.WALLET_GET_TRANSACTIONS, (_e, args?: { limit?: number }) => {
    try {
      const db = require('./db').getDb();
      const limit = args?.limit ?? 50;
      return db.prepare('SELECT * FROM spending_transactions ORDER BY created_at DESC LIMIT ?').all(limit);
    } catch {
      return [];
    }
  });

  ipcMain.handle(IPC.WALLET_SET_BUDGET, (_e, input: { period: string; limitUsd: number; resetDay?: number }) => {
    try {
      const db = require('./db').getDb();
      db.prepare(`
        INSERT INTO spending_budgets (period, limit_usd, reset_day)
        VALUES (?, ?, ?)
        ON CONFLICT(period) DO UPDATE SET limit_usd = excluded.limit_usd, reset_day = excluded.reset_day, is_active = 1
      `).run(input.period, input.limitUsd, input.resetDay ?? 1);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle(IPC.WALLET_DISABLE_BUDGET, (_e, period: string) => {
    try {
      const db = require('./db').getDb();
      db.prepare('UPDATE spending_budgets SET is_active = 0 WHERE period = ?').run(period);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // ── Process Management ─────────────────────────────────────────────────────
  ipcMain.handle(IPC.PROCESS_LIST, () => {
    // Return active agent run processes
    const runs = getRuns('');  // empty string → get all
    return runs.filter(r => r.status === 'running').map(r => ({
      id: r.id,
      title: r.title,
      status: r.status,
      startedAt: r.started_at,
    }));
  });

  ipcMain.handle(IPC.PROCESS_CANCEL, (_e, processId: string) => {
    // Cancel an active agent run
    cancelLoop(processId);
    return { ok: true };
  });

  ipcMain.handle(IPC.PROCESS_DISMISS, (_e, processId: string) => {
    updateRun(processId, { status: 'dismissed' });
    return { ok: true };
  });

  // ── Run Tracking ───────────────────────────────────────────────────────────
  // Note: RUN_LIST and RUN_EVENTS already registered above; these are the
  // remaining run-related handlers.
  ipcMain.handle(IPC.RUN_GET, (_e, runId: string) => {
    try {
      const db = require('./db').getDb();
      return db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) ?? null;
    } catch { return null; }
  });

  ipcMain.handle(IPC.RUN_ARTIFACTS, (_e, runId: string) => {
    try {
      const events = getRunEvents(runId);
      return events.filter((e: any) => e.event_type === 'artifact');
    } catch { return []; }
  });

  ipcMain.handle(IPC.RUN_CHANGES, (_e, runId: string) => {
    try {
      const events = getRunEvents(runId);
      return events.filter((e: any) => e.event_type === 'file_change');
    } catch { return []; }
  });

  ipcMain.handle(IPC.RUN_SCORECARD, () => {
    try {
      const db = require('./db').getDb();
      const total = (db.prepare('SELECT COUNT(*) as n FROM runs').get() as any)?.n ?? 0;
      const completed = (db.prepare("SELECT COUNT(*) as n FROM runs WHERE status = 'completed'").get() as any)?.n ?? 0;
      const failed = (db.prepare("SELECT COUNT(*) as n FROM runs WHERE status = 'failed'").get() as any)?.n ?? 0;
      return { total, completed, failed, successRate: total > 0 ? (completed / total * 100).toFixed(1) : '0' };
    } catch { return null; }
  });

  // ── Tasks Summary ──────────────────────────────────────────────────────────
  ipcMain.handle(IPC.TASKS_SUMMARY, () => ({ runningCount: 0, completedCount: 0 }));

  // ══════════════════════════════════════════════════════════════════════════
  // Remaining IPC handlers — lightweight stubs for features not yet backed
  // by full subsystems.
  // ══════════════════════════════════════════════════════════════════════════

  // ── Terminal helpers not owned by registerTerminalIpc ────────────────────
  ipcMain.handle(IPC.TERMINAL_SPAWN_CLAUDE_CODE, async (_e: any, sessionId: string, task: string, opts?: any) => {
    try {
      const { finalText: result } = await runClaudeCode({
        conversationId: sessionId,
        prompt: task,
        onText: () => {},
      });
      return { sessionId, exitCode: 0, output: result };
    } catch (err: any) {
      return { sessionId, exitCode: 1, output: err.message };
    }
  });

  // ── Identity (settings-backed key-value store) ────────────────────────────
  // Profile and accounts stored in a JSON settings file for now
  const identityPath = path.join(require('electron').app.getPath('userData'), 'identity.json');

  function loadIdentity(): any {
    try { return JSON.parse(fs.readFileSync(identityPath, 'utf-8')); }
    catch { return { profile: null, accounts: [], credentials: [] }; }
  }
  function saveIdentity(data: any): void {
    fs.writeFileSync(identityPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  ipcMain.handle(IPC.IDENTITY_PROFILE_GET, () => loadIdentity().profile ?? null);
  ipcMain.handle(IPC.IDENTITY_PROFILE_SET, (_e: any, input: any) => {
    const id = loadIdentity(); id.profile = input; saveIdentity(id);
  });
  ipcMain.handle(IPC.IDENTITY_ACCOUNTS_LIST, () => loadIdentity().accounts ?? []);
  ipcMain.handle(IPC.IDENTITY_ACCOUNT_ADD, (_e: any, input: any) => {
    const id = loadIdentity();
    id.accounts = id.accounts || [];
    id.accounts.push(input);
    saveIdentity(id);
  });
  ipcMain.handle(IPC.IDENTITY_ACCOUNT_DELETE, (_e: any, serviceName: string) => {
    const id = loadIdentity();
    id.accounts = (id.accounts || []).filter((a: any) => a.serviceName !== serviceName);
    saveIdentity(id);
  });
  ipcMain.handle(IPC.IDENTITY_CREDENTIALS_LIST, () => {
    // Return credentials with values redacted
    return (loadIdentity().credentials ?? []).map((c: any) => ({
      ...c, valuePlain: undefined, hasValue: true,
    }));
  });
  ipcMain.handle(IPC.IDENTITY_CREDENTIAL_ADD, (_e: any, label: string, type: string, service: string, valuePlain: string) => {
    const id = loadIdentity();
    id.credentials = id.credentials || [];
    id.credentials.push({ label, type, service, valuePlain, createdAt: new Date().toISOString() });
    saveIdentity(id);
  });
  ipcMain.handle(IPC.IDENTITY_CREDENTIAL_DELETE, (_e: any, label: string, service: string) => {
    const id = loadIdentity();
    id.credentials = (id.credentials || []).filter((c: any) => !(c.label === label && c.service === service));
    saveIdentity(id);
  });

  // ── Calendar (stub — reads from local .ics or returns empty) ──────────────
  ipcMain.handle(IPC.CALENDAR_LIST, (_e: any, _from?: string, _to?: string) => {
    // Future: parse ~/.local/share/gnome-calendar or similar
    return [];
  });

  // ── Tasks (stub — scheduled agent runs, not yet backed by cron) ───────────
  const tasksPath = path.join(require('electron').app.getPath('userData'), 'tasks.json');

  function loadTasks(): any[] {
    try { return JSON.parse(fs.readFileSync(tasksPath, 'utf-8')); }
    catch { return []; }
  }
  function saveTasks(tasks: any[]): void {
    fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2), 'utf-8');
  }

  ipcMain.handle(IPC.TASKS_LIST, () => loadTasks());
  ipcMain.handle(IPC.TASKS_CREATE, (_e: any, input: any) => {
    const tasks = loadTasks();
    const task = { ...input, id: Date.now(), enabled: true, createdAt: new Date().toISOString(), runs: [] };
    tasks.push(task);
    saveTasks(tasks);
    return task;
  });
  ipcMain.handle(IPC.TASKS_ENABLE, (_e: any, id: number, enabled: boolean) => {
    const tasks = loadTasks();
    const t = tasks.find((t: any) => t.id === id);
    if (t) { t.enabled = enabled; saveTasks(tasks); }
  });
  ipcMain.handle(IPC.TASKS_DELETE, (_e: any, id: number) => {
    saveTasks(loadTasks().filter((t: any) => t.id !== id));
  });
  ipcMain.handle(IPC.TASKS_RUNS, (_e: any, id: number) => {
    const task = loadTasks().find((t: any) => t.id === id);
    return task?.runs ?? [];
  });
  ipcMain.handle(IPC.TASKS_RUN_NOW, (_e: any, _id: number) => {
    // Future: actually trigger an agent run for the task
    return { ok: true, message: 'Task execution not yet implemented' };
  });

  // ── Wallet / Payment Methods (stub — no real payment backend) ─────────────
  const walletPath = path.join(require('electron').app.getPath('userData'), 'wallet.json');

  function loadWallet(): any {
    try { return JSON.parse(fs.readFileSync(walletPath, 'utf-8')); }
    catch { return { paymentMethods: [] }; }
  }
  function saveWallet(data: any): void {
    fs.writeFileSync(walletPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  ipcMain.handle(IPC.WALLET_GET_PAYMENT_METHODS, () => loadWallet().paymentMethods ?? []);
  ipcMain.handle(IPC.WALLET_ADD_MANUAL_CARD, (_e: any, input: any) => {
    const w = loadWallet();
    w.paymentMethods.push({ ...input, id: Date.now(), source: 'manual', createdAt: new Date().toISOString() });
    saveWallet(w);
  });
  ipcMain.handle(IPC.WALLET_IMPORT_BROWSER_CARDS, () => {
    // Future: use browser session to detect saved cards
    return [];
  });
  ipcMain.handle(IPC.WALLET_CONFIRM_IMPORT, (_e: any, candidates: any[]) => {
    const w = loadWallet();
    for (const c of candidates) {
      w.paymentMethods.push({ ...c, id: Date.now(), source: 'imported', createdAt: new Date().toISOString() });
    }
    saveWallet(w);
  });
  ipcMain.handle(IPC.WALLET_SET_PREFERRED, (_e: any, id: number) => {
    const w = loadWallet();
    for (const pm of w.paymentMethods) { pm.isPreferred = pm.id === id; }
    saveWallet(w);
  });
  ipcMain.handle(IPC.WALLET_SET_BACKUP, (_e: any, id: number) => {
    const w = loadWallet();
    for (const pm of w.paymentMethods) { pm.isBackup = pm.id === id; }
    saveWallet(w);
  });
  ipcMain.handle(IPC.WALLET_REMOVE_CARD, (_e: any, id: number) => {
    const w = loadWallet();
    w.paymentMethods = w.paymentMethods.filter((pm: any) => pm.id !== id);
    saveWallet(w);
  });
  // ── Process Management (remaining) ────────────────────────────────────────
  ipcMain.handle(IPC.PROCESS_DETACH, () => { /* no-op for now */ });
  ipcMain.handle(IPC.PROCESS_ATTACH, (_e: any, _processId: string) => { /* no-op */ });

  // ── Run Management (remaining) ────────────────────────────────────────────
  ipcMain.handle(IPC.RUN_APPROVALS, (_e: any, _runId: string) => []);
  ipcMain.handle(IPC.RUN_APPROVE, (_e: any, _approvalId: number) => {});
  ipcMain.handle(IPC.RUN_REVISE, (_e: any, _approvalId: number) => {});
  ipcMain.handle(IPC.RUN_DENY, (_e: any, _approvalId: number) => {});
  ipcMain.handle(IPC.RUN_HUMAN_INTERVENTIONS, (_e: any, _runId: string) => []);
  ipcMain.handle(IPC.RUN_RESOLVE_HUMAN_INTERVENTION, (_e: any, _interventionId: number) => {});

  // ── VPN ───────────────────────────────────────────────────────────────────
  const VPN_IFACE = 'proton-denver';
  const VPN_CONF = '/etc/wireguard/proton-denver.conf';

  function vpnStatus(): Promise<boolean> {
    return new Promise((resolve) => {
      // `wg show` requires root; use `ip link show` which works without elevated privileges
      execFile('ip', ['link', 'show', VPN_IFACE], (_err, stdout) => {
        resolve(stdout.includes('UP'));
      });
    });
  }

  ipcMain.handle(IPC.VPN_STATUS, async () => {
    return vpnStatus();
  });

  ipcMain.handle(IPC.VPN_TOGGLE, async () => {
    const connected = await vpnStatus();
    return new Promise<boolean>((resolve, reject) => {
      const args = connected ? ['down', VPN_IFACE] : ['up', VPN_CONF];
      execFile('wg-quick', args, (err) => {
        if (err) reject(err);
        else resolve(!connected);
      });
    });
  });

  // UI state — renderer pushes its live layout; agent tools read via getUIState()
  ipcMain.handle(IPC.UI_STATE_PUSH, (_event, state: any) => {
    setUIState({ ...state, updatedAt: Date.now() });
  });

  ipcMain.handle(IPC.UI_STATE_GET, () => {
    const { getUIState } = require('./core/cli/uiStateAccessor');
    return getUIState();
  });
}

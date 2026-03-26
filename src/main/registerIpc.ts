import { BrowserWindow, ipcMain } from 'electron';
import Anthropic from '@anthropic-ai/sdk';
import { ElectronBrowserService } from './core/browser/ElectronBrowserService';
import { IPC, IPC_EVENTS } from './ipc-channels';
import { DEFAULT_MODEL_BY_PROVIDER } from '../shared/model-registry';
import type { Message } from '../shared/types';
import type { MessageAttachment } from '../shared/types';
import { agentLoop } from './agent/agentLoop';
import { PipelineOrchestrator } from './core/PipelineOrchestrator';
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
} from './db';
import { listPolicyProfiles } from './db/policies';
import {
  createAgent,
  getAgent,
  listAgents,
  updateAgent,
  deleteAgent,
} from './db/agents';
import { evaluatePolicy } from './agent/policy-engine';
import { a11yListApps } from './core/desktop/a11y';
import { smartFocus } from './core/desktop/smartFocus';
import { getRemainingBudgets } from './agent/spending-budget';
import { runClaudeCode } from './claudeCodeClient';

function getMainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0];
}

const sessions = new Map<string, any[]>();
let activeConversationId: string | null = null;
let chatAbort: AbortController | null = null;
let activeRunId: string | null = null;

const MAX_SESSION_TURNS = 20; // max user+assistant turn PAIRS to keep

/**
 * Prune a session to the last MAX_SESSION_TURNS pairs.
 * Always cuts at a user-role boundary to avoid orphaned tool_result blocks.
 */
function pruneSession(messages: any[]): any[] {
  const maxMessages = MAX_SESSION_TURNS * 2;
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

function ensureConversation(): string {
  if (!activeConversationId) {
    activeConversationId = `conv-${Date.now()}`;
    sessions.set(activeConversationId, []);
  }
  return activeConversationId;
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

export function registerIpc(browserService: ElectronBrowserService): void {
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

  ipcMain.handle(IPC.CHAT_NEW, () => {
    chatAbort?.abort();
    const now = new Date().toISOString();
    const id = `conv-${Date.now()}`;
    createConversation({ id, title: 'New conversation', mode: 'chat', created_at: now, updated_at: now });
    activeConversationId = id;
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
    activeConversationId = id;

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

    return {
      messages,
      mode: 'chat' as const,
      claudeTerminalStatus: 'idle' as const,
    };
  });

  ipcMain.handle(IPC.CHAT_GET_MODE, (_e, id: string) => {
    const conv = getConversation(id);
    const mode = conv?.mode ?? 'chat';
    return { mode, claudeTerminalStatus: 'idle' as const };
  });
  ipcMain.handle(IPC.CHAT_SET_MODE, (_e, id: string, mode: string) => {
    if (id) updateConversation(id, { mode });
    return { ok: true, mode };
  });
  ipcMain.handle(IPC.CHAT_GET_ACTIVE_TERMINAL_SESSION, () => ({ sessionId: null }));

  ipcMain.handle(IPC.CHAT_SEND, async (event, payload: { text: string; attachments?: MessageAttachment[] }) => {
    const { text, attachments } = payload || { text: '' };
    const settings = loadSettings();
    if (settings.provider !== 'anthropic' && settings.provider !== 'gemini' && settings.provider !== 'openai') {
      return { response: '', error: 'Select a provider in Settings to use chat.' };
    }
    const apiKey = settings.providerKeys[settings.provider as keyof typeof settings.providerKeys]?.trim();
    if (!apiKey) {
      return { response: '', error: `Add a ${settings.provider} API key in Settings.` };
    }
    const model = settings.models[settings.provider as keyof typeof settings.models] ?? DEFAULT_MODEL_BY_PROVIDER[settings.provider as keyof typeof DEFAULT_MODEL_BY_PROVIDER];

    ensureConversation();
    const id = activeConversationId!;

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

    // ── Claude Code path ──────────────────────────────────────────────────────
    const conv = getConversation(id);
    if (conv?.mode === 'claude_terminal') {
      try {
        const { finalText } = await runClaudeCode({
          conversationId: id,
          prompt: text,
          onText: (delta) => {
            if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_STREAM_TEXT, delta);
          },
        });

        if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_STREAM_END, { ok: true });

        if (finalText) {
          const assistantMsgId = `msg-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const assistantMsgTs = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const assistantMsg: Message = { id: assistantMsgId, role: 'assistant', content: finalText, timestamp: assistantMsgTs };
          const nowStr = new Date().toISOString();
          addMessage({ id: assistantMsgId, conversation_id: id, role: 'assistant', content: JSON.stringify(assistantMsg), created_at: nowStr });
          updateConversation(id, { updated_at: nowStr });
        }

        return { response: finalText };
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message });
        return { response: '', error: err.message };
      }
    }
    // ── End Claude Code path ──────────────────────────────────────────────────

    let sessionMessages = getOrCreateSession(id);
    const pruned = pruneSession(sessionMessages);
    if (pruned.length < sessionMessages.length) {
      sessions.set(id, pruned);
      sessionMessages = pruned;
    }

    chatAbort?.abort();
    chatAbort = new AbortController();

    const settings_provider = settings.provider as 'anthropic' | 'openai' | 'gemini';

    // Check if this goal warrants a multi-agent pipeline
    const usePipeline = await PipelineOrchestrator.classifyIntent(text, {
      provider: settings_provider,
      apiKey,
      model,
      signal: chatAbort!.signal,
    });

    let result: { response: string; error?: string };

    if (usePipeline) {
      // ── Multi-agent pipeline path ─────────────────────────────────────────
      // Insert a synthetic pipeline message into the conversation so PipelineBlock renders
      const pipelineMsgId = `msg-pipe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_STREAM_END, { ok: true, pipelineMessageId: pipelineMsgId, isPipelineStart: true });

      try {
        const response = await PipelineOrchestrator.run(text, {
          provider: settings_provider,
          apiKey,
          model,
          conversationId: id,
          signal: chatAbort!.signal,
          browserService,
          unrestrictedMode: settings.unrestrictedMode,
          onStateChanged: (state) => {
            if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.SWARM_STATE_CHANGED, state);
          },
          onText: (delta) => {
            if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_STREAM_TEXT, delta);
          },
        });

        result = { response };
        if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_STREAM_END, { ok: true });

        // Persist synthesizer output as assistant message
        if (response) {
          const assistantMsgId = `msg-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const assistantMsgTs = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          const assistantMsg: Message = { id: assistantMsgId, role: 'assistant', content: response, timestamp: assistantMsgTs };
          const nowStr = new Date().toISOString();
          addMessage({ id: assistantMsgId, conversation_id: id, role: 'assistant', content: JSON.stringify(assistantMsg), created_at: nowStr });
          updateConversation(id, { updated_at: nowStr, title: text.slice(0, 60) || 'New conversation' });

          // Update session so follow-up messages have pipeline context
          const session = sessions.get(id) ?? [];
          session.push({ role: 'user', content: text });
          session.push({ role: 'assistant', content: response });
          sessions.set(id, session);
        }
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        result = { response: '', error: err.message };
        if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message });
      } finally {
        activeRunId = null;
      }
    } else {
      // ── Single agent path (unchanged) ────────────────────────────────────
      const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      activeRunId = runId;

      try {
        const response = await agentLoop(text, sessionMessages, {
          provider: settings_provider,
          apiKey,
          model,
          runId,
          signal: chatAbort!.signal,
          unrestrictedMode: settings.unrestrictedMode,
          browserService,
          onText: (delta) => {
            if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_STREAM_TEXT, delta);
          },
          onThinking: (t) => {
            if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_THINKING, t);
          },
          onToolActivity: (activity) => {
            if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, activity);
          },
        });
        result = { response };
        if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_STREAM_END, { ok: true });
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (err.name === 'AbortError' || err.message === 'AbortError') {
          result = { response: '', error: 'Stopped' };
          if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_STREAM_END, { ok: false, cancelled: true });
        } else {
          result = { response: '', error: err.message };
          if (!event.sender.isDestroyed()) event.sender.send(IPC_EVENTS.CHAT_STREAM_END, { ok: false, error: err.message });
        }
      } finally {
        activeRunId = null;
      }

      // Persist assistant message
      if (result.response && !result.error) {
        const assistantMsgId = `msg-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const assistantMsgTs = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const assistantMsg: Message = { id: assistantMsgId, role: 'assistant', content: result.response, timestamp: assistantMsgTs };
        const nowStr = new Date().toISOString();
        addMessage({ id: assistantMsgId, conversation_id: id, role: 'assistant', content: JSON.stringify(assistantMsg), created_at: nowStr });
        updateConversation(id, { updated_at: nowStr, title: text.slice(0, 60) || 'New conversation' });
      }
    }

    return result;
  });

  ipcMain.handle(IPC.CHAT_STOP, () => {
    chatAbort?.abort();
    chatAbort = null;
    if (activeRunId) cancelLoop(activeRunId);
  });

  ipcMain.handle(IPC.CHAT_PAUSE, () => {
    if (activeRunId) pauseLoop(activeRunId);
  });
  ipcMain.handle(IPC.CHAT_RESUME, () => {
    if (activeRunId) resumeLoop(activeRunId);
  });
  ipcMain.handle(IPC.CHAT_ADD_CONTEXT, (_e, text: string) => {
    if (activeRunId) addContext(activeRunId, text);
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
  ipcMain.handle(IPC.CHAT_OPEN_ATTACHMENT, () => { });

  ipcMain.handle(IPC.TASKS_SUMMARY, () => ({ runningCount: 0, completedCount: 0 }));

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

  ipcMain.handle(IPC.AGENT_RUN_CURRENT_PAGE, () => {
    return { ok: false, error: 'Agent execution not yet implemented' };
  });

  ipcMain.handle(IPC.AGENT_RUN_URLS, () => {
    return { ok: false, error: 'Agent execution not yet implemented' };
  });

  ipcMain.handle(IPC.AGENT_TEST, () => {
    return { ok: false, error: 'Agent testing not yet implemented' };
  });

  ipcMain.handle(IPC.AGENT_COMPILE, () => {
    return { ok: false, definition: null, error: 'Agent compilation not yet implemented' };
  });
}

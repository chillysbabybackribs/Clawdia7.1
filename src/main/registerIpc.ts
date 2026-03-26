import { BrowserWindow, ipcMain } from 'electron';
import Anthropic from '@anthropic-ai/sdk';
import { ElectronBrowserService } from './core/browser/ElectronBrowserService';
import { IPC, IPC_EVENTS } from './ipc-channels';
import { DEFAULT_MODEL_BY_PROVIDER } from '../shared/model-registry';
import type { Message } from '../shared/types';
import type { MessageAttachment } from '../shared/types';
import { streamAnthropicChat } from './anthropicChat';
import { streamGeminiChat } from './geminiChat';
import { streamOpenAIChat } from './openaiChat';
import { loadSettings, patchSettings, type AppSettings } from './settingsStore';

function getMainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0];
}

const sessions = new Map<string, any[]>();
let activeConversationId: string | null = null;
let chatAbort: AbortController | null = null;

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

  ipcMain.handle(IPC.POLICY_LIST, () => []);

  ipcMain.handle(IPC.CHAT_NEW, () => {
    chatAbort?.abort();
    activeConversationId = `conv-${Date.now()}`;
    sessions.set(activeConversationId, []);
    return { id: activeConversationId };
  });

  ipcMain.handle(IPC.CHAT_LIST, () => []);

  ipcMain.handle(IPC.CHAT_LOAD, (_e, id: string) => {
    activeConversationId = id;
    const msg = getOrCreateSession(id);
    return {
      messages: toUiMessages(msg),
      mode: 'chat' as const,
      claudeTerminalStatus: 'idle' as const,
    };
  });

  ipcMain.handle(IPC.CHAT_GET_MODE, (_e, _id: string) => ({
    mode: 'chat' as const,
    claudeTerminalStatus: 'idle' as const,
  }));
  ipcMain.handle(IPC.CHAT_SET_MODE, () => ({ ok: true }));
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
    let sessionMessages = getOrCreateSession(id);
    // Prune to sliding window before building request
    const pruned = pruneSession(sessionMessages);
    if (pruned.length < sessionMessages.length) {
      sessions.set(id, pruned);
      sessionMessages = pruned;
    }

    chatAbort?.abort();
    chatAbort = new AbortController();

    if (settings.provider === 'gemini') {
      return streamGeminiChat({
        webContents: event.sender,
        apiKey,
        modelRegistryId: model,
        userText: text,
        attachments,
        sessionMessages,
        signal: chatAbort.signal,
        browserService,
      });
    }

    if (settings.provider === 'openai') {
      return streamOpenAIChat({
        webContents: event.sender,
        apiKey,
        modelRegistryId: model,
        userText: text,
        attachments,
        sessionMessages,
        signal: chatAbort.signal,
        browserService,
      });
    }

    return streamAnthropicChat({
      webContents: event.sender,
      apiKey,
      modelRegistryId: model,
      userText: text,
      attachments,
      sessionMessages,
      signal: chatAbort.signal,
      browserService,
    });
  });

  ipcMain.handle(IPC.CHAT_STOP, () => {
    chatAbort?.abort();
    chatAbort = null;
  });

  ipcMain.handle(IPC.CHAT_PAUSE, () => { });
  ipcMain.handle(IPC.CHAT_RESUME, () => { });
  ipcMain.handle(IPC.CHAT_ADD_CONTEXT, () => { });
  ipcMain.handle(IPC.CHAT_RATE_TOOL, () => { });
  ipcMain.handle(IPC.CHAT_DELETE, () => { });
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
}

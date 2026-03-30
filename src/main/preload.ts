import { contextBridge, ipcRenderer } from 'electron';
import { IPC, IPC_EVENTS } from './ipc-channels';

const noop = () => {};
const preloadStatusKey = '__clawdiaPreload';

function onEvent<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_: Electron.IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

function mapBrowserTab(tab: any) {
  return {
    ...tab,
    isActive: Boolean(tab?.active),
  };
}

function subscribe<T>(channel: string, mapPayload: (payload: T) => unknown = (payload) => payload) {
  return (cb: (payload: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: T) => cb(mapPayload(payload));
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

try {
  console.log('[preload] bootstrap start');

  contextBridge.exposeInMainWorld('clawdia', {
    chat: {
    send: (message: string, attachments?: any[], conversationId?: string | null) =>
      ipcRenderer.invoke(IPC.CHAT_SEND, { text: message, attachments, conversationId }),
    openAttachment: (filePath: string) => ipcRenderer.invoke(IPC.CHAT_OPEN_ATTACHMENT, filePath),
    stop: (conversationId?: string) => ipcRenderer.invoke(IPC.CHAT_STOP, conversationId),
    pause: (conversationId?: string) => ipcRenderer.invoke(IPC.CHAT_PAUSE, conversationId),
    resume: (conversationId?: string) => ipcRenderer.invoke(IPC.CHAT_RESUME, conversationId),
    addContext: (text: string, conversationId?: string) => ipcRenderer.invoke(IPC.CHAT_ADD_CONTEXT, text, conversationId),
    rateTool: (_messageId: string, _toolId: string, _rating: any, _note?: string) =>
      ipcRenderer.invoke(IPC.CHAT_RATE_TOOL),
    new: () => ipcRenderer.invoke(IPC.CHAT_NEW),
    create: () => ipcRenderer.invoke(IPC.CHAT_CREATE),
    list: () => ipcRenderer.invoke(IPC.CHAT_LIST),
    load: (id: string) => ipcRenderer.invoke(IPC.CHAT_LOAD, id),
    getMode: (id: string) => ipcRenderer.invoke(IPC.CHAT_GET_MODE, id),
    setMode: (id: string, mode: string) => ipcRenderer.invoke(IPC.CHAT_SET_MODE, id, mode),
    getActiveTerminalSession: (conversationId?: string | null) =>
      ipcRenderer.invoke(IPC.CHAT_GET_ACTIVE_TERMINAL_SESSION, conversationId),
    delete: (id: string) => ipcRenderer.invoke(IPC.CHAT_DELETE, id),
    // All stream event callbacks now receive { conversationId, ...data } envelopes
    // so ChatPanel can filter to its own conversation.
    onStreamText: (cb: (payload: { delta: string; conversationId: string }) => void) => onEvent(IPC_EVENTS.CHAT_STREAM_TEXT, cb),
    onStreamEnd: (cb: (data: any) => void) => onEvent(IPC_EVENTS.CHAT_STREAM_END, cb),
    onWorkflowPlanReset: (cb: () => void) => onEvent(IPC_EVENTS.CHAT_WORKFLOW_PLAN_RESET, cb),
    onWorkflowPlanText: (cb: (text: string) => void) => onEvent<string>(IPC_EVENTS.CHAT_WORKFLOW_PLAN_TEXT, cb),
    onWorkflowPlanEnd: (cb: () => void) => onEvent(IPC_EVENTS.CHAT_WORKFLOW_PLAN_END, cb),
    onThinking: (cb: (payload: { thought: string; conversationId: string }) => void) => onEvent(IPC_EVENTS.CHAT_THINKING, cb),
    onPromptDebug: (cb: (payload: any) => void) => onEvent(IPC_EVENTS.CHAT_PROMPT_DEBUG, cb),
    onToolActivity: (cb: (activity: any) => void) => onEvent(IPC_EVENTS.CHAT_TOOL_ACTIVITY, cb),
    onToolStream: (cb: (payload: any) => void) => onEvent(IPC_EVENTS.CHAT_TOOL_STREAM, cb),
    onClaudeStatus: (cb: (payload: any) => void) => onEvent(IPC_EVENTS.CHAT_CLAUDE_STATUS, cb),
  },

  browser: {
    navigate: (url: string) => ipcRenderer.invoke(IPC.BROWSER_NAVIGATE, url),
    back: () => ipcRenderer.invoke(IPC.BROWSER_BACK),
    forward: () => ipcRenderer.invoke(IPC.BROWSER_FORWARD),
    refresh: () => ipcRenderer.invoke(IPC.BROWSER_REFRESH),
    setBounds: (bounds: unknown) => ipcRenderer.invoke(IPC.BROWSER_SET_BOUNDS, bounds),
    getExecutionMode: () => ipcRenderer.invoke(IPC.BROWSER_GET_EXECUTION_MODE),
    newTab: (url?: string) => ipcRenderer.invoke(IPC.BROWSER_TAB_NEW, url).then(mapBrowserTab),
    listTabs: () =>
      ipcRenderer.invoke(IPC.BROWSER_TAB_LIST).then((tabs: unknown) => (Array.isArray(tabs) ? tabs : []).map(mapBrowserTab)),
    switchTab: (id: string) => ipcRenderer.invoke(IPC.BROWSER_TAB_SWITCH, id),
    closeTab: (id: string) => ipcRenderer.invoke(IPC.BROWSER_TAB_CLOSE, id),
    matchHistory: (prefix: string) => ipcRenderer.invoke(IPC.BROWSER_HISTORY_MATCH, prefix),
    hide: () => ipcRenderer.invoke(IPC.BROWSER_HIDE),
    show: () => ipcRenderer.invoke(IPC.BROWSER_SHOW),
    listSessions: () => ipcRenderer.invoke(IPC.BROWSER_LIST_SESSIONS),
    clearSession: (domain: string) => ipcRenderer.invoke(IPC.BROWSER_CLEAR_SESSION, domain),
    extensions: {
      list: () => ipcRenderer.invoke(IPC.BROWSER_EXT_LIST),
      install: (dirPath?: string) => ipcRenderer.invoke(IPC.BROWSER_EXT_INSTALL, dirPath),
      remove: (id: string) => ipcRenderer.invoke(IPC.BROWSER_EXT_REMOVE, id),
    },
    onUrlChanged: subscribe<string>(IPC_EVENTS.BROWSER_URL_CHANGED),
    onTitleChanged: subscribe<string>(IPC_EVENTS.BROWSER_TITLE_CHANGED),
    onLoading: subscribe<boolean>(IPC_EVENTS.BROWSER_LOADING),
    onTabsChanged: subscribe<unknown[]>(IPC_EVENTS.BROWSER_TABS_CHANGED, (tabs) => (Array.isArray(tabs) ? tabs : []).map(mapBrowserTab)),
    onModeChanged: subscribe(IPC_EVENTS.BROWSER_MODE_CHANGED),
  },

  settings: {
    get: (key: string) => ipcRenderer.invoke(IPC.SETTINGS_GET, key),
    set: (key: string, value: unknown) => ipcRenderer.invoke(IPC.SETTINGS_SET, key, value),
    getApiKey: (provider?: string) => ipcRenderer.invoke(IPC.API_KEY_GET, provider),
    setApiKey: (provider: string, key: string) => ipcRenderer.invoke(IPC.API_KEY_SET, provider, key),
    getModel: (provider?: string) => ipcRenderer.invoke(IPC.MODEL_GET, provider),
    setModel: (provider: string, model: string) => ipcRenderer.invoke(IPC.MODEL_SET, provider, model),
    getProvider: () => ipcRenderer.invoke(IPC.SETTINGS_GET_PROVIDER),
    setProvider: (provider: string) => ipcRenderer.invoke(IPC.SETTINGS_SET_PROVIDER, provider),
    getProviderKeys: () => ipcRenderer.invoke(IPC.SETTINGS_GET_PROVIDER_KEYS),
    getUnrestrictedMode: () => ipcRenderer.invoke('settings:get-unrestricted-mode'),
    setUnrestrictedMode: (enabled: boolean) => ipcRenderer.invoke('settings:set-unrestricted-mode', enabled),
    getPolicyProfile: () => ipcRenderer.invoke('settings:get-policy-profile'),
    setPolicyProfile: (profileId: string) => ipcRenderer.invoke('settings:set-policy-profile', profileId),
    getPerformanceStance: () => ipcRenderer.invoke('settings:get-performance-stance'),
    setPerformanceStance: (stance: string) => ipcRenderer.invoke('settings:set-performance-stance', stance),
  },

  process: {
    list: () => ipcRenderer.invoke(IPC.PROCESS_LIST),
    detach: () => ipcRenderer.invoke(IPC.PROCESS_DETACH),
    attach: (processId: string) => ipcRenderer.invoke(IPC.PROCESS_ATTACH, processId),
    cancel: (processId: string) => ipcRenderer.invoke(IPC.PROCESS_CANCEL, processId),
    dismiss: (processId: string) => ipcRenderer.invoke(IPC.PROCESS_DISMISS, processId),
    onListChanged: (cb: (processes: any[]) => void) => onEvent(IPC_EVENTS.PROCESS_LIST_CHANGED, cb),
  },

  run: {
    list: (conversationId?: string) => ipcRenderer.invoke(IPC.RUN_LIST, conversationId ?? ''),
    get: (runId: string) => ipcRenderer.invoke(IPC.RUN_GET, runId),
    events: (runId: string) => ipcRenderer.invoke(IPC.RUN_EVENTS, runId),
    artifacts: (runId: string) => ipcRenderer.invoke(IPC.RUN_ARTIFACTS, runId),
    changes: (runId: string) => ipcRenderer.invoke(IPC.RUN_CHANGES, runId),
    scorecard: () => ipcRenderer.invoke(IPC.RUN_SCORECARD),
    approvals: (runId: string) => ipcRenderer.invoke(IPC.RUN_APPROVALS, runId),
    humanInterventions: (runId: string) => ipcRenderer.invoke(IPC.RUN_HUMAN_INTERVENTIONS, runId),
    approve: (approvalId: number) => ipcRenderer.invoke(IPC.RUN_APPROVE, approvalId),
    revise: (approvalId: number) => ipcRenderer.invoke(IPC.RUN_REVISE, approvalId),
    deny: (approvalId: number) => ipcRenderer.invoke(IPC.RUN_DENY, approvalId),
    resolveHumanIntervention: (interventionId: number) => ipcRenderer.invoke(IPC.RUN_RESOLVE_HUMAN_INTERVENTION, interventionId),
  },

  agent: {
    list: () => ipcRenderer.invoke(IPC.AGENT_LIST),
    get: (id: string) => ipcRenderer.invoke(IPC.AGENT_GET, id),
    create: (input: any) => ipcRenderer.invoke(IPC.AGENT_CREATE, input),
    compile: (input: any) => ipcRenderer.invoke(IPC.AGENT_COMPILE, input),
    update: (id: string, patch: any) => ipcRenderer.invoke(IPC.AGENT_UPDATE, id, patch),
    delete: (id: string) => ipcRenderer.invoke(IPC.AGENT_DELETE, id),
    run: (id: string) => ipcRenderer.invoke(IPC.AGENT_RUN, id),
    runOnCurrentPage: (id: string) => ipcRenderer.invoke(IPC.AGENT_RUN_CURRENT_PAGE, id),
    runOnUrls: (id: string, urls: string[]) => ipcRenderer.invoke(IPC.AGENT_RUN_URLS, id, urls),
    history: (id: string) => ipcRenderer.invoke(IPC.AGENT_HISTORY, id),
    test: (id: string) => ipcRenderer.invoke(IPC.AGENT_TEST, id),
  },

  calendar: {
    list: (from?: string, to?: string) => ipcRenderer.invoke(IPC.CALENDAR_LIST, from, to),
    onEventsChanged: (cb: (events: any[]) => void) => onEvent(IPC_EVENTS.CALENDAR_EVENTS_CHANGED, cb),
  },

  swarm: {
    onStateChanged: (cb: (state: any) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, state: any) => cb(state);
      ipcRenderer.on(IPC_EVENTS.SWARM_STATE_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC_EVENTS.SWARM_STATE_CHANGED, handler);
    },
  },

  identity: {
    getProfile: () => ipcRenderer.invoke(IPC.IDENTITY_PROFILE_GET),
    setProfile: (input: any) => ipcRenderer.invoke(IPC.IDENTITY_PROFILE_SET, input),
    listAccounts: () => ipcRenderer.invoke(IPC.IDENTITY_ACCOUNTS_LIST),
    addAccount: (input: any) => ipcRenderer.invoke(IPC.IDENTITY_ACCOUNT_ADD, input),
    deleteAccount: (serviceName: string) => ipcRenderer.invoke(IPC.IDENTITY_ACCOUNT_DELETE, serviceName),
    listCredentials: () => ipcRenderer.invoke(IPC.IDENTITY_CREDENTIALS_LIST),
    addCredential: (label: string, type: string, service: string, valuePlain: string) => ipcRenderer.invoke(IPC.IDENTITY_CREDENTIAL_ADD, label, type, service, valuePlain),
    deleteCredential: (label: string, service: string) => ipcRenderer.invoke(IPC.IDENTITY_CREDENTIAL_DELETE, label, service),
    onAccountsChanged: (cb: () => void) => onEvent(IPC_EVENTS.IDENTITY_ACCOUNTS_CHANGED, cb),
  },

  policy: {
    list: () => ipcRenderer.invoke(IPC.POLICY_LIST),
  },

  window: {
    minimize: () => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.invoke(IPC.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.invoke(IPC.WINDOW_CLOSE),
  },

  vpn: {
    status: (): Promise<boolean> => ipcRenderer.invoke(IPC.VPN_STATUS),
    toggle: (): Promise<boolean> => ipcRenderer.invoke(IPC.VPN_TOGGLE),
  },

  fs: {
    readDir: (dirPath: string) => ipcRenderer.invoke(IPC.FS_READ_DIR, dirPath),
    readFile: (filePath: string) => ipcRenderer.invoke(IPC.FS_READ_FILE, filePath),
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke(IPC.FS_WRITE_FILE, filePath, content),
  },

  editor: {
    openFile: (filePath: string) => ipcRenderer.invoke(IPC.EDITOR_OPEN_FILE, filePath),
    watchFile: (filePath: string) => ipcRenderer.invoke(IPC.EDITOR_WATCH_FILE, filePath),
    unwatchFile: () => ipcRenderer.invoke(IPC.EDITOR_UNWATCH_FILE),
    setState: (state: any) => ipcRenderer.invoke(IPC.EDITOR_SET_STATE, state),
    getState: () => ipcRenderer.invoke(IPC.EDITOR_GET_STATE),
    onOpenFile: (cb: (payload: { filePath: string }) => void) => onEvent(IPC_EVENTS.EDITOR_OPEN_FILE, cb),
    onFileChanged: (cb: (payload: { filePath: string }) => void) => onEvent(IPC_EVENTS.EDITOR_FILE_CHANGED, cb),
  },

  terminal: {
    isAvailable: () => ipcRenderer.invoke(IPC.TERMINAL_IS_AVAILABLE),
    spawn: (id: string, opts?: any) => ipcRenderer.invoke(IPC.TERMINAL_SPAWN, id, opts),
    write: (id: string, data: string, meta?: any) => ipcRenderer.invoke(IPC.TERMINAL_WRITE, id, data, meta),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke(IPC.TERMINAL_RESIZE, id, cols, rows),
    kill: (id: string) => ipcRenderer.invoke(IPC.TERMINAL_KILL, id),
    list: () => ipcRenderer.invoke(IPC.TERMINAL_LIST),
    getSnapshot: (id: string) => ipcRenderer.invoke(IPC.TERMINAL_GET_SNAPSHOT, id),
    acquire: (id: string, owner: string, meta?: any) => ipcRenderer.invoke(IPC.TERMINAL_ACQUIRE, id, owner, meta),
    release: (id: string) => ipcRenderer.invoke(IPC.TERMINAL_RELEASE, id),
    requestTakeover: (id: string, requester: string) => ipcRenderer.invoke(IPC.TERMINAL_REQUEST_TAKEOVER, id, requester),
    spawnClaudeCode: (sessionId: string, task: string, opts?: any) =>
      ipcRenderer.invoke(IPC.TERMINAL_SPAWN_CLAUDE_CODE, sessionId, task, opts),
    onData: subscribe<{ id: string; data: string }>(IPC_EVENTS.TERMINAL_DATA),
    onExit: subscribe<{ id: string; code: number; signal?: number }>(IPC_EVENTS.TERMINAL_EXIT),
    onEvent: subscribe<any>(IPC_EVENTS.TERMINAL_EVENT),
    onSessionState: subscribe<any>(IPC_EVENTS.TERMINAL_SESSION_STATE),
  },

  desktop: {
    listApps: () => ipcRenderer.invoke(IPC.DESKTOP_LIST_APPS),
    focusApp: (windowId: string) => ipcRenderer.invoke(IPC.DESKTOP_FOCUS_APP, windowId),
    killApp: (pid: number) => ipcRenderer.invoke(IPC.DESKTOP_KILL_APP, pid),
  },

  wallet: {
    getPaymentMethods: () => ipcRenderer.invoke(IPC.WALLET_GET_PAYMENT_METHODS),
    addManualCard: (input: any) => ipcRenderer.invoke(IPC.WALLET_ADD_MANUAL_CARD, input),
    importBrowserCards: () => ipcRenderer.invoke(IPC.WALLET_IMPORT_BROWSER_CARDS),
    confirmImport: (candidates: any[]) => ipcRenderer.invoke(IPC.WALLET_CONFIRM_IMPORT, candidates),
    setPreferred: (id: number) => ipcRenderer.invoke(IPC.WALLET_SET_PREFERRED, id),
    setBackup: (id: number) => ipcRenderer.invoke(IPC.WALLET_SET_BACKUP, id),
    removeCard: (id: number) => ipcRenderer.invoke(IPC.WALLET_REMOVE_CARD, id),
    getBudgets: () => ipcRenderer.invoke(IPC.WALLET_GET_BUDGETS),
    setBudget: (input: any) => ipcRenderer.invoke(IPC.WALLET_SET_BUDGET, input),
    disableBudget: (period: string) => ipcRenderer.invoke(IPC.WALLET_DISABLE_BUDGET, period),
    getTransactions: (args?: { limit?: number }) => ipcRenderer.invoke(IPC.WALLET_GET_TRANSACTIONS, args),
    getRemainingBudgets: () => ipcRenderer.invoke(IPC.WALLET_GET_REMAINING_BUDGETS),
    onPurchaseComplete: (cb: (payload: any) => void) => onEvent(IPC_EVENTS.SPENDING_PURCHASE_COMPLETE, cb),
    onLowBalance: (cb: (payload: any) => void) => onEvent(IPC_EVENTS.SPENDING_LOW_BALANCE, cb),
    onBudgetExceeded: (cb: (payload: any) => void) => onEvent(IPC_EVENTS.SPENDING_BUDGET_EXCEEDED, cb),
  },

  tasks: {
    list: () => ipcRenderer.invoke(IPC.TASKS_LIST),
    create: (input: any) => ipcRenderer.invoke(IPC.TASKS_CREATE, input),
    enable: (id: number, enabled: boolean) => ipcRenderer.invoke(IPC.TASKS_ENABLE, id, enabled),
    delete: (id: number) => ipcRenderer.invoke(IPC.TASKS_DELETE, id),
    runs: (id: number) => ipcRenderer.invoke(IPC.TASKS_RUNS, id),
    runNow: (id: number) => ipcRenderer.invoke(IPC.TASKS_RUN_NOW, id),
    summary: () => ipcRenderer.invoke(IPC.TASKS_SUMMARY),
    onRunStarted: (cb: (payload: any) => void) => onEvent(IPC_EVENTS.TASK_RUN_STARTED, cb),
    onRunComplete: (cb: (payload: any) => void) => onEvent(IPC_EVENTS.TASK_RUN_COMPLETE, cb),
  },

  uiState: {
    /** Push current UI layout state from renderer → main (called on every meaningful state change) */
    push: (state: any) => ipcRenderer.invoke(IPC.UI_STATE_PUSH, state),
    /** Pull the last-known UI state from main (rarely needed; push is the primary flow) */
    get: () => ipcRenderer.invoke(IPC.UI_STATE_GET),
  },

    videoExtractor: {
      checkYtdlp: () => ipcRenderer.invoke('check-ytdlp'),
      installYtdlp: () => ipcRenderer.invoke('install-ytdlp'),
      openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
      getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
      startDownload: (opts: {
        url: string;
        outputDir: string;
        quality: string;
        format: string;
        audio: string;
      }) => ipcRenderer.invoke('start-download', opts),
      onProgress: (cb: (data: { percent: number | null; line: string }) => void) => {
        const handler = (_: any, data: any) => cb(data);
        ipcRenderer.on('download-progress', handler);
        return () => ipcRenderer.removeListener('download-progress', handler);
      },
      onComplete: (cb: (data: { filePath: string }) => void) => {
        const handler = (_: any, data: any) => cb(data);
        ipcRenderer.on('download-complete', handler);
        return () => ipcRenderer.removeListener('download-complete', handler);
      },
      onError: (cb: (data: { message: string }) => void) => {
        const handler = (_: any, data: any) => cb(data);
        ipcRenderer.on('download-error', handler);
        return () => ipcRenderer.removeListener('download-error', handler);
      },
      onInstallProgress: (cb: (data: { line: string }) => void) => {
        const handler = (_: any, data: any) => cb(data);
        ipcRenderer.on('install-ytdlp-progress', handler);
        return () => ipcRenderer.removeListener('install-ytdlp-progress', handler);
      },
      searchAndExtractUrl: (opts: { query: string }) => ipcRenderer.invoke('search-and-extract-url', opts),
    },
  });

  contextBridge.exposeInMainWorld(preloadStatusKey, {
    loaded: true,
    stage: 'bridge-exposed',
  });
  console.log('[preload] bridge exposed');
} catch (error) {
  const message = error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error);
  console.error('[preload] failed to expose bridge:', message);
  try {
    contextBridge.exposeInMainWorld(preloadStatusKey, {
      loaded: false,
      stage: 'error',
      error: message,
    });
  } catch {
    // Ignore secondary preload errors.
  }
}

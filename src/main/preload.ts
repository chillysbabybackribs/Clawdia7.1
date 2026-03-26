import { contextBridge, ipcRenderer } from 'electron';
import { IPC, IPC_EVENTS } from './ipc-channels';

const noop = () => {};

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

contextBridge.exposeInMainWorld('clawdia', {
  chat: {
    send: (message: string, attachments?: any[]) =>
      ipcRenderer.invoke(IPC.CHAT_SEND, { text: message, attachments }),
    openAttachment: (_filePath: string) => Promise.resolve(),
    stop: () => ipcRenderer.invoke(IPC.CHAT_STOP),
    pause: () => ipcRenderer.invoke(IPC.CHAT_PAUSE),
    resume: () => ipcRenderer.invoke(IPC.CHAT_RESUME),
    addContext: (_text: string) => ipcRenderer.invoke(IPC.CHAT_ADD_CONTEXT),
    rateTool: (_messageId: string, _toolId: string, _rating: any, _note?: string) =>
      ipcRenderer.invoke(IPC.CHAT_RATE_TOOL),
    new: () => ipcRenderer.invoke(IPC.CHAT_NEW),
    list: () => ipcRenderer.invoke(IPC.CHAT_LIST),
    load: (id: string) => ipcRenderer.invoke(IPC.CHAT_LOAD, id),
    getMode: (id: string) => ipcRenderer.invoke(IPC.CHAT_GET_MODE, id),
    setMode: (id: string, mode: string) => ipcRenderer.invoke(IPC.CHAT_SET_MODE, id, mode),
    getActiveTerminalSession: (_conversationId?: string | null) =>
      ipcRenderer.invoke(IPC.CHAT_GET_ACTIVE_TERMINAL_SESSION),
    delete: (id: string) => ipcRenderer.invoke(IPC.CHAT_DELETE, id),
    onStreamText: (cb: (text: string) => void) => onEvent<string>(IPC_EVENTS.CHAT_STREAM_TEXT, cb),
    onStreamEnd: (cb: (data: any) => void) => onEvent(IPC_EVENTS.CHAT_STREAM_END, cb),
    onWorkflowPlanReset: (cb: () => void) => onEvent(IPC_EVENTS.CHAT_WORKFLOW_PLAN_RESET, cb),
    onWorkflowPlanText: (cb: (text: string) => void) => onEvent<string>(IPC_EVENTS.CHAT_WORKFLOW_PLAN_TEXT, cb),
    onWorkflowPlanEnd: (cb: () => void) => onEvent(IPC_EVENTS.CHAT_WORKFLOW_PLAN_END, cb),
    onThinking: (cb: (thought: string) => void) => onEvent<string>(IPC_EVENTS.CHAT_THINKING, cb),
    onToolActivity: (_cb: (activity: any) => void) => noop,
    onToolStream: (_cb: (payload: any) => void) => noop,
    onClaudeStatus: (_cb: (payload: any) => void) => noop,
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
    list: () => Promise.resolve([]),
    detach: () => Promise.resolve(),
    attach: (_processId: string) => Promise.resolve(),
    cancel: (_processId: string) => Promise.resolve(),
    dismiss: (_processId: string) => Promise.resolve(),
    onListChanged: (_cb: (processes: any[]) => void) => noop,
  },

  run: {
    list: () => Promise.resolve([]),
    get: (_runId: string) => Promise.resolve(null),
    events: (_runId: string) => Promise.resolve([]),
    artifacts: (_runId: string) => Promise.resolve([]),
    changes: (_runId: string) => Promise.resolve([]),
    scorecard: () => Promise.resolve(null),
    approvals: (_runId: string) => Promise.resolve([]),
    humanInterventions: (_runId: string) => Promise.resolve([]),
    approve: (_approvalId: number) => Promise.resolve(),
    revise: (_approvalId: number) => Promise.resolve(),
    deny: (_approvalId: number) => Promise.resolve(),
    resolveHumanIntervention: (_interventionId: number) => Promise.resolve(),
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
    list: (_from?: string, _to?: string) => Promise.resolve([]),
    onEventsChanged: (_cb: (events: any[]) => void) => noop,
  },

  swarm: {
    onStateChanged: (_cb: (state: any) => void) => noop,
  },

  identity: {
    getProfile: () => Promise.resolve(null),
    setProfile: (_input: any) => Promise.resolve(),
    listAccounts: () => Promise.resolve([]),
    addAccount: (_input: any) => Promise.resolve(),
    deleteAccount: (_serviceName: string) => Promise.resolve(),
    listCredentials: () => Promise.resolve([]),
    addCredential: (_label: string, _type: string, _service: string, _valuePlain: string) => Promise.resolve(),
    deleteCredential: (_label: string, _service: string) => Promise.resolve(),
    onAccountsChanged: (_cb: () => void) => noop,
  },

  policy: {
    list: () => ipcRenderer.invoke(IPC.POLICY_LIST),
  },

  window: {
    minimize: () => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.invoke(IPC.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.invoke(IPC.WINDOW_CLOSE),
  },

  fs: {
    readDir: (_dirPath: string) => Promise.resolve([]),
    readFile: (_filePath: string) => Promise.resolve(null),
    writeFile: (_filePath: string, _content: string) => Promise.resolve(),
  },

  editor: {
    openFile: (_filePath: string) => Promise.resolve(),
    watchFile: (_filePath: string) => Promise.resolve(),
    unwatchFile: () => Promise.resolve(),
    setState: (_state: any) => Promise.resolve(),
    getState: () => Promise.resolve(null),
    onOpenFile: (_cb: (payload: { filePath: string }) => void) => noop,
    onFileChanged: (_cb: (payload: { filePath: string }) => void) => noop,
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
    spawnClaudeCode: (_sessionId: string, _task: string, _opts?: any) =>
      Promise.resolve({ sessionId: null as string | null, exitCode: null, output: '' }),
    onData: subscribe<{ id: string; data: string }>(IPC_EVENTS.TERMINAL_DATA),
    onExit: subscribe<{ id: string; code: number; signal?: number }>(IPC_EVENTS.TERMINAL_EXIT),
    onEvent: subscribe<any>(IPC_EVENTS.TERMINAL_EVENT),
    onSessionState: subscribe<any>(IPC_EVENTS.TERMINAL_SESSION_STATE),
  },

  desktop: {
    listApps: () => Promise.resolve([]),
    focusApp: (_windowId: string) => Promise.resolve(),
    killApp: (_pid: number) => Promise.resolve(),
  },

  wallet: {
    getPaymentMethods: () => Promise.resolve([]),
    addManualCard: (_input: any) => Promise.resolve(),
    importBrowserCards: () => Promise.resolve([]),
    confirmImport: (_candidates: any[]) => Promise.resolve(),
    setPreferred: (_id: number) => Promise.resolve(),
    setBackup: (_id: number) => Promise.resolve(),
    removeCard: (_id: number) => Promise.resolve(),
    getBudgets: () => Promise.resolve([]),
    setBudget: (_input: any) => Promise.resolve(),
    disableBudget: (_period: string) => Promise.resolve(),
    getTransactions: (_args?: { limit?: number }) => Promise.resolve([]),
    getRemainingBudgets: () => Promise.resolve([]),
    onPurchaseComplete: (_cb: (payload: any) => void) => noop,
    onLowBalance: (_cb: (payload: any) => void) => noop,
    onBudgetExceeded: (_cb: (payload: any) => void) => noop,
  },

  tasks: {
    list: () => Promise.resolve([]),
    create: (_input: any) => Promise.resolve(null),
    enable: (_id: number, _enabled: boolean) => Promise.resolve(),
    delete: (_id: number) => Promise.resolve(),
    runs: (_id: number) => Promise.resolve([]),
    runNow: (_id: number) => Promise.resolve(),
    summary: () => ipcRenderer.invoke(IPC.TASKS_SUMMARY),
    onRunStarted: (_cb: (payload: any) => void) => noop,
    onRunComplete: (_cb: (payload: any) => void) => noop,
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

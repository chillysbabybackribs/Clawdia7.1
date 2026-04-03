import { BrowserWindow, ipcMain } from 'electron';
import { execFile } from 'child_process';
import { IPC, IPC_EVENTS } from '../ipc-channels';
import { a11yListApps } from '../core/desktop/a11y';
import { smartFocus } from '../core/desktop/smartFocus';
import { getUIState, setUIState } from '../core/cli/uiStateAccessor';
import { openFileInBrowser, type BrowserOpenMode } from '../core/browser/fileOpen';
import type { ElectronBrowserService } from '../core/browser/ElectronBrowserService';
import { recordBrowserNavigation, recordUIStateObservation } from '../sessionContinuity';

const VPN_IFACE = 'proton-denver';
const VPN_CONF = '/etc/wireguard/proton-denver.conf';
let registered = false;
let browserServiceRef: ElectronBrowserService | null = null;
let detachBrowserEvents: (() => void) | null = null;

function vpnStatus(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('ip', ['link', 'show', VPN_IFACE], (_err, stdout) => {
      resolve(stdout.includes('UP'));
    });
  });
}

export function registerBrowserIpc(browserService: ElectronBrowserService): void {
  browserServiceRef = browserService;

  function sendToRenderer(channel: string, payload: unknown): void {
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }

  const service = (): ElectronBrowserService => {
    if (!browserServiceRef) throw new Error('Browser service not initialized');
    return browserServiceRef;
  };

  async function activeConversationId(): Promise<string | null> {
    return await service().getActiveTabOwner() ?? getUIState()?.activeConversationId ?? null;
  }

  detachBrowserEvents?.();
  const offUrlChanged = browserService.on('urlChanged', (url) => {
    sendToRenderer(IPC_EVENTS.BROWSER_URL_CHANGED, url);
    void activeConversationId().then((conversationId) => {
      if (conversationId) recordBrowserNavigation(conversationId, url);
    });
  });
  const offTitleChanged = browserService.on('titleChanged', (title) => {
    sendToRenderer(IPC_EVENTS.BROWSER_TITLE_CHANGED, title);
    const browserUrl = getUIState()?.browserUrl ?? null;
    void activeConversationId().then((conversationId) => {
      if (conversationId && browserUrl) recordBrowserNavigation(conversationId, browserUrl, title);
    });
  });
  const offLoadingChanged = browserService.on('loadingChanged', (loading) => sendToRenderer(IPC_EVENTS.BROWSER_LOADING, loading));
  const offTabsChanged = browserService.on('tabsChanged', (tabs) => sendToRenderer(IPC_EVENTS.BROWSER_TABS_CHANGED, tabs));
  const offModeChanged = browserService.on('modeChanged', (payload) => sendToRenderer(IPC_EVENTS.BROWSER_MODE_CHANGED, payload));
  detachBrowserEvents = () => {
    offUrlChanged();
    offTitleChanged();
    offLoadingChanged();
    offTabsChanged();
    offModeChanged();
  };

  if (registered) return;
  registered = true;

  // ── Browser navigation ──────────────────────────────────────────────────────
  ipcMain.handle(IPC.BROWSER_NAVIGATE, (_e, url: string) => service().navigate(url));
  ipcMain.handle(IPC.BROWSER_BACK, () => service().back());
  ipcMain.handle(IPC.BROWSER_FORWARD, () => service().forward());
  ipcMain.handle(IPC.BROWSER_REFRESH, () => service().refresh());
  ipcMain.handle(IPC.BROWSER_SET_BOUNDS, (_e, bounds: { x: number; y: number; width: number; height: number }) => {
    service().setBounds(bounds);
  });
  ipcMain.handle(IPC.BROWSER_GET_EXECUTION_MODE, () => service().getExecutionMode());
  ipcMain.handle(IPC.BROWSER_TAB_NEW, (_e, url?: string) => service().newTab(url));
  ipcMain.handle(IPC.BROWSER_TAB_LIST, () => service().listTabs());
  ipcMain.handle(IPC.BROWSER_TAB_SWITCH, (_e, id: string) => service().switchTab(id));
  ipcMain.handle(IPC.BROWSER_TAB_CLOSE, (_e, id: string) => service().closeTab(id));
  ipcMain.handle(IPC.BROWSER_HISTORY_MATCH, (_e, prefix: string) => service().matchHistory(prefix));
  ipcMain.handle(IPC.BROWSER_HIDE, () => service().hide());
  ipcMain.handle(IPC.BROWSER_SHOW, () => service().show());
  ipcMain.handle(IPC.BROWSER_LIST_SESSIONS, () => service().listSessions());
  ipcMain.handle(IPC.BROWSER_CLEAR_SESSION, (_e, domain: string) => service().clearSession(domain));
  ipcMain.handle(IPC.BROWSER_FOCUS_CONVERSATION, (_e, conversationId: string) =>
    service().focusConversation(conversationId));
  ipcMain.handle(IPC.BROWSER_RELEASE_CONVERSATION_TAB, (_e, conversationId: string) =>
    service().releaseTab(conversationId).catch(() => {}));

  ipcMain.handle(IPC.BROWSER_OPEN_FILE, (
    _e,
    filePath: string,
    opts?: { mode?: BrowserOpenMode; conversationId?: string },
  ) => openFileInBrowser(filePath, opts ?? {}, service()));
  // ── Desktop ─────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.DESKTOP_LIST_APPS, async () => {
    const res = await a11yListApps();
    return res.apps ?? [];
  });

  ipcMain.handle(IPC.DESKTOP_FOCUS_APP, async (_e, app: string) => {
    const res = await smartFocus(app);
    return res.focused;
  });

  ipcMain.handle(IPC.DESKTOP_KILL_APP, async (_e, pid: number) => {
    try {
      process.kill(pid, 'SIGTERM');
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // ── VPN ─────────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.VPN_STATUS, async () => vpnStatus());

  ipcMain.handle(IPC.VPN_TOGGLE, async () => {
    const connected = await vpnStatus();
    return new Promise<boolean>((resolve, reject) => {
      const args = connected ? ['down', VPN_IFACE] : ['up', VPN_CONF];
      execFile('wg-quick', args, (err) => {
        if (err) reject(err); else resolve(!connected);
      });
    });
  });

  // ── UI State ────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.UI_STATE_PUSH, (_event, state: any) => {
    setUIState({ ...state, updatedAt: Date.now() });
    if (state?.activeConversationId) {
      recordUIStateObservation(state.activeConversationId, {
        activeView: state.activeView ?? 'chat',
        activeRightPanel: state.activeRightPanel ?? null,
        browserVisible: Boolean(state.browserVisible),
        browserUrl: typeof state.browserUrl === 'string' ? state.browserUrl : null,
        provider: state.provider ?? 'unknown',
        model: state.model ?? 'unknown',
      });
    }
  });

  ipcMain.handle(IPC.UI_STATE_GET, () => {
    const { getUIState } = require('../core/cli/uiStateAccessor');
    return getUIState();
  });
}

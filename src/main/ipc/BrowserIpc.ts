import { BrowserWindow, ipcMain } from 'electron';
import { execFile } from 'child_process';
import { IPC, IPC_EVENTS } from '../ipc-channels';
import { a11yListApps } from '../core/desktop/a11y';
import { smartFocus } from '../core/desktop/smartFocus';
import { setUIState } from '../core/cli/uiStateAccessor';
import { openFileInBrowser, type BrowserOpenMode } from '../core/browser/fileOpen';
import type { ElectronBrowserService } from '../core/browser/ElectronBrowserService';

const VPN_IFACE = 'proton-denver';
const VPN_CONF = '/etc/wireguard/proton-denver.conf';

function vpnStatus(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('ip', ['link', 'show', VPN_IFACE], (_err, stdout) => {
      resolve(stdout.includes('UP'));
    });
  });
}

export function registerBrowserIpc(browserService: ElectronBrowserService): void {
  function sendToRenderer(channel: string, payload: unknown): void {
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }

  // ── Browser navigation ──────────────────────────────────────────────────────
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
  ipcMain.handle(IPC.BROWSER_FOCUS_CONVERSATION, (_e, conversationId: string) =>
    browserService.focusConversation(conversationId));

  ipcMain.handle(IPC.BROWSER_OPEN_FILE, (
    _e,
    filePath: string,
    opts?: { mode?: BrowserOpenMode; conversationId?: string },
  ) => openFileInBrowser(filePath, opts ?? {}, browserService));

  // ── Browser events ──────────────────────────────────────────────────────────
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
  });

  ipcMain.handle(IPC.UI_STATE_GET, () => {
    const { getUIState } = require('../core/cli/uiStateAccessor');
    return getUIState();
  });
}

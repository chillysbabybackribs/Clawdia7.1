import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { ElectronBrowserService } from './core/browser/ElectronBrowserService';
import { TerminalSessionController } from './core/terminal/TerminalSessionController';
import { registerIpc } from './registerIpc';
import { registerTerminalIpc } from './registerTerminalIpc';
import { registerVideoExtractorIpc } from './ipc/videoExtractor';
import { ExtensionManager } from './core/browser/extensions/ExtensionManager';
import { registerExtensionsIpc } from './core/browser/extensions/registerExtensionsIpc';
import { initDb } from './db';
import { setFocusStealNotifier } from './core/desktop/smartFocus';
import { VirtualDisplay } from './core/desktop/virtualDisplay';
import { IPC } from './ipc-channels';

const isDev = process.env.NODE_ENV === 'development';
const isLinux = process.platform === 'linux';

// Ensure consistent userData path across dev and production builds.
// Without this, dev mode uses 'Electron' as the app name and writes settings
// to ~/.config/Electron, while production uses the package name 'clawdia7'.
app.setName('clawdia7');

if (isLinux) {
  // Some Linux/X11 environments expose visuals that Chromium's EGL path rejects.
  // Force software compositing early so startup does not depend on GPU init.
  app.disableHardwareAcceleration();
  // The embedded BrowserView intentionally touches WebGL for fingerprint spoofing.
  // On Linux software rendering paths, Chromium now requires an explicit opt-in.
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.webContents.on('did-start-loading', () => {
    console.log('[renderer] did-start-loading');
  });
  win.webContents.on('dom-ready', () => {
    console.log('[renderer] dom-ready');
  });
  win.webContents.on('did-finish-load', () => {
    console.log('[renderer] did-finish-load');
  });
  win.webContents.on('did-stop-loading', () => {
    console.log('[renderer] did-stop-loading');
  });
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer:console:${level}] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] render-process-gone', details);
  });
  win.webContents.on('unresponsive', () => {
    console.error('[renderer] unresponsive');
  });

  return win;
}

function loadWindowContent(win: BrowserWindow): void {
  if (isDev) {
    win.loadURL('http://127.0.0.1:5174');
  } else {
    win.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  }
}

async function createAppWindow(userDataPath: string): Promise<void> {
  const win = createWindow();
  const browserService = new ElectronBrowserService(win, userDataPath);
  const terminalController = new TerminalSessionController();
  await browserService.init();

  // Wire up the desktop focus-steal warning so the renderer can show a toast
  // before the agent takes OS focus away from the user's current window.
  setFocusStealNotifier((targetWindow) => {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.DESKTOP_FOCUS_STEAL_WARNING, { targetWindow });
    }
  });

  registerIpc(browserService, terminalController);
  registerTerminalIpc(terminalController, win);
  registerVideoExtractorIpc(win, browserService);
  loadWindowContent(win);
}

app.whenReady().then(async () => {
  if (!initDb()) {
    console.error('[main] Database initialization failed during startup; runtime DB calls will attempt lazy re-initialization.');
  }
  const userDataPath = app.getPath('userData');
  const extManager = new ExtensionManager(userDataPath);
  // Load persisted extensions before any BrowserView is created
  await extManager.init();
  registerExtensionsIpc(extManager);
  await createAppWindow(userDataPath);
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createAppWindow(userDataPath);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // Stop the virtual X display so Xvfb doesn't linger as an orphan process.
  VirtualDisplay.getInstance().stop();
});

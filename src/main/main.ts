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

app.whenReady().then(async () => {
  initDb();
  const win = createWindow();
  const browserService = new ElectronBrowserService(win, app.getPath('userData'));
  const extManager = new ExtensionManager(app.getPath('userData'));
  // Load persisted extensions before any BrowserView is created
  await extManager.init();
  const terminalController = new TerminalSessionController();
  registerIpc(browserService, terminalController);
  registerTerminalIpc(terminalController, win);
  registerVideoExtractorIpc(win, browserService);
  registerExtensionsIpc(extManager);
  loadWindowContent(win);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const nextWin = createWindow();
      const nextBrowserService = new ElectronBrowserService(nextWin, app.getPath('userData'));
      const nextTerminalController = new TerminalSessionController();
      registerIpc(nextBrowserService, nextTerminalController);
      registerTerminalIpc(nextTerminalController, nextWin);
      registerVideoExtractorIpc(nextWin, nextBrowserService);
      loadWindowContent(nextWin);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

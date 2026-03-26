import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { ElectronBrowserService } from './core/browser/ElectronBrowserService';
import { TerminalSessionController } from './core/terminal/TerminalSessionController';
import { registerIpc } from './registerIpc';
import { registerTerminalIpc } from './registerTerminalIpc';

const isDev = process.env.NODE_ENV === 'development';

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

  if (isDev) {
    win.loadURL('http://127.0.0.1:5174');
  } else {
    win.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  }
  return win;
}

app.whenReady().then(() => {
  const win = createWindow();
  const browserService = new ElectronBrowserService(win, app.getPath('userData'));
  void browserService.init();
  const terminalController = new TerminalSessionController();
  registerIpc(browserService);
  registerTerminalIpc(terminalController, win);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

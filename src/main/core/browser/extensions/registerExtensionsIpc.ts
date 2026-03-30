import { ipcMain, dialog, BrowserWindow } from 'electron';
import { IPC } from '../../../ipc-channels';
import { ExtensionManager } from './ExtensionManager';

export function registerExtensionsIpc(extManager: ExtensionManager): void {
  ipcMain.handle(IPC.BROWSER_EXT_LIST, () => extManager.list());

  ipcMain.handle(IPC.BROWSER_EXT_INSTALL, async (_e, dirPath?: string) => {
    // If no path provided, open a folder picker dialog attached to the main window
    let targetPath = dirPath;
    if (!targetPath) {
      const win = BrowserWindow.getAllWindows()[0];
      const result = await dialog.showOpenDialog(win, {
        title: 'Select Extension Folder',
        properties: ['openDirectory'],
        buttonLabel: 'Install Extension',
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      targetPath = result.filePaths[0];
    }
    return extManager.install(targetPath);
  });

  ipcMain.handle(IPC.BROWSER_EXT_REMOVE, (_e, id: string) => extManager.remove(id));
}

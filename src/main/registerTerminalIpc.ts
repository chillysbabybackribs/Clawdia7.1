import { ipcMain, BrowserWindow } from 'electron';
import { IPC, IPC_EVENTS } from './ipc-channels';
import { TerminalSessionController } from './core/terminal/TerminalSessionController';
import type { SessionOwner } from './core/terminal/types';

let registered = false;

export function registerTerminalIpc(
  controller: TerminalSessionController,
  win: BrowserWindow,
): void {
  // Register IPC handlers once only — duplicate registration throws in Electron
  if (!registered) {
    registered = true;

    ipcMain.handle(IPC.TERMINAL_IS_AVAILABLE, () => controller.isAvailable());

    ipcMain.handle(IPC.TERMINAL_SPAWN, (_e, id: string, opts?: any) =>
      controller.spawn(id, opts),
    );

    ipcMain.handle(IPC.TERMINAL_WRITE, (_e, id: string, data: string, meta?: any) =>
      controller.write(id, data, meta),
    );

    ipcMain.handle(IPC.TERMINAL_RESIZE, (_e, id: string, cols: number, rows: number) =>
      controller.resize(id, cols, rows),
    );

    ipcMain.handle(IPC.TERMINAL_KILL, (_e, id: string) => controller.kill(id));

    ipcMain.handle(IPC.TERMINAL_LIST, () => controller.list());

    ipcMain.handle(IPC.TERMINAL_GET_SNAPSHOT, (_e, id: string) =>
      controller.getSnapshot(id),
    );

    ipcMain.handle(IPC.TERMINAL_ACQUIRE, (_e, id: string, owner: SessionOwner, meta?: any) =>
      controller.acquire(id, owner, meta),
    );

    ipcMain.handle(IPC.TERMINAL_RELEASE, (_e, id: string) => controller.release(id));

    ipcMain.handle(IPC.TERMINAL_REQUEST_TAKEOVER, (_e, id: string, requester: string) =>
      controller.requestTakeover(id, requester),
    );


  }

  // Wire controller events to this window's renderer — cleaned up when window closes
  const onData = (payload: unknown) => {
    if (!win.isDestroyed()) win.webContents.send(IPC_EVENTS.TERMINAL_DATA, payload);
  };
  const onExit = (payload: unknown) => {
    if (!win.isDestroyed()) win.webContents.send(IPC_EVENTS.TERMINAL_EXIT, payload);
  };
  const onSessionState = (payload: unknown) => {
    if (!win.isDestroyed()) win.webContents.send(IPC_EVENTS.TERMINAL_SESSION_STATE, payload);
  };

  controller.on('data', onData);
  controller.on('exit', onExit);
  controller.on('sessionState', onSessionState);

  win.on('closed', () => {
    controller.off('data', onData);
    controller.off('exit', onExit);
    controller.off('sessionState', onSessionState);
  });
}

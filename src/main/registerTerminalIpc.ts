import { ipcMain, BrowserWindow } from 'electron';
import { IPC, IPC_EVENTS } from './ipc-channels';
import { TerminalSessionController } from './core/terminal/TerminalSessionController';
import type { SessionOwner } from './core/terminal/types';

export function registerTerminalIpc(
  controller: TerminalSessionController,
  win: BrowserWindow,
): void {
  const send = (channel: string, payload: unknown): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };

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

  // Stub — Claude Code integration not implemented yet
  ipcMain.handle(IPC.TERMINAL_SPAWN_CLAUDE_CODE, () => ({ sessionId: null }));

  // Push events from controller → renderer
  controller.on('data', (payload) => send(IPC_EVENTS.TERMINAL_DATA, payload));
  controller.on('exit', (payload) => send(IPC_EVENTS.TERMINAL_EXIT, payload));
  controller.on('sessionState', (payload) => send(IPC_EVENTS.TERMINAL_SESSION_STATE, payload));
}

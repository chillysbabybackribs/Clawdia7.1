import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { IPC } from '../ipc-channels';
import { getRunEvents, getDb } from '../db';
import { listActiveBudgets } from '../db/spending';
import { cancelLoop } from '../agent/loopControl';
import { runClaudeCode } from '../claudeCodeClient';
import type { TerminalSessionController } from '../core/terminal/TerminalSessionController';

let registered = false;

export function registerRunIpc(_terminalController?: TerminalSessionController): void {
  if (registered) return;
  registered = true;

  // ── Run queries ─────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.RUN_GET, (_e, runId: string) => {
    try { return getDb().prepare('SELECT * FROM runs WHERE id = ?').get(runId) ?? null; }
    catch { return null; }
  });

  ipcMain.handle(IPC.RUN_ARTIFACTS, (_e, runId: string) => {
    try { return getRunEvents(runId).filter((e: any) => e.kind === 'artifact'); }
    catch { return []; }
  });

  ipcMain.handle(IPC.RUN_CHANGES, (_e, runId: string) => {
    try { return getRunEvents(runId).filter((e: any) => e.kind === 'file_change'); }
    catch { return []; }
  });

  ipcMain.handle(IPC.RUN_SCORECARD, () => {
    try {
      const db = getDb();
      const total = (db.prepare('SELECT COUNT(*) as n FROM runs').get() as any)?.n ?? 0;
      const completed = (db.prepare("SELECT COUNT(*) as n FROM runs WHERE status = 'completed'").get() as any)?.n ?? 0;
      const failed = (db.prepare("SELECT COUNT(*) as n FROM runs WHERE status = 'failed'").get() as any)?.n ?? 0;
      return { total, completed, failed, successRate: total > 0 ? (completed / total * 100).toFixed(1) : '0' };
    } catch { return null; }
  });

  // ── Run approvals / interventions (stubs) ───────────────────────────────────
  ipcMain.handle(IPC.RUN_APPROVALS, (_e, _runId: string) => []);
  ipcMain.handle(IPC.RUN_APPROVE, (_e, _approvalId: number) => {});
  ipcMain.handle(IPC.RUN_REVISE, (_e, _approvalId: number) => {});
  ipcMain.handle(IPC.RUN_DENY, (_e, _approvalId: number) => {});
  ipcMain.handle(IPC.RUN_HUMAN_INTERVENTIONS, (_e, _runId: string) => []);
  ipcMain.handle(IPC.RUN_RESOLVE_HUMAN_INTERVENTION, (_e, _interventionId: number) => {});

  // ── Process management ──────────────────────────────────────────────────────
  ipcMain.handle(IPC.PROCESS_LIST, () => {
    const runs = getDb()
      .prepare(`SELECT * FROM runs ORDER BY started_at DESC LIMIT 200`)
      .all() as Array<any>;
    return runs.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      status: r.status,
      summary: r.title || r.goal || 'Assistant Task',
      startedAt: Date.parse(r.started_at),
      completedAt: r.completed_at ? Date.parse(r.completed_at) : undefined,
      toolCallCount: r.tool_call_count ?? 0,
      toolCompletedCount: r.tool_completed_count ?? 0,
      toolFailedCount: r.tool_failed_count ?? 0,
      error: r.error ?? undefined,
      isAttached: false,
      wasDetached: Boolean(r.was_detached),
      provider: r.provider ?? undefined,
      model: r.model ?? undefined,
      workflowStage: r.workflow_stage ?? undefined,
    }));
  });

  ipcMain.handle(IPC.PROCESS_CANCEL, (_e, processId: string) => {
    cancelLoop(processId);
    return { ok: true };
  });

  ipcMain.handle(IPC.PROCESS_DISMISS, (_e, processId: string) => {
    return { ok: true };
  });

  ipcMain.handle(IPC.PROCESS_DETACH, () => { /* no-op */ });
  ipcMain.handle(IPC.PROCESS_ATTACH, (_e: any, _processId: string) => { /* no-op */ });

  // ── Spending ────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.WALLET_GET_REMAINING_BUDGETS, () => {
    const { getRemainingBudgets } = require('../agent/spending-budget');
    return getRemainingBudgets();
  });

  ipcMain.handle(IPC.WALLET_GET_BUDGETS, () => listActiveBudgets());

  ipcMain.handle(IPC.WALLET_GET_TRANSACTIONS, (_e, args?: { limit?: number }) => {
    try {
      const limit = args?.limit ?? 50;
      return getDb().prepare('SELECT * FROM spending_transactions ORDER BY created_at DESC LIMIT ?').all(limit);
    } catch { return []; }
  });

  ipcMain.handle(IPC.WALLET_SET_BUDGET, (_e, input: { period: string; limitUsd: number; resetDay?: number }) => {
    try {
      getDb().prepare(`
        INSERT INTO spending_budgets (period, limit_usd, reset_day)
        VALUES (?, ?, ?)
        ON CONFLICT(period) DO UPDATE SET limit_usd = excluded.limit_usd, reset_day = excluded.reset_day, is_active = 1
      `).run(input.period, input.limitUsd, input.resetDay ?? 1);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle(IPC.WALLET_DISABLE_BUDGET, (_e, period: string) => {
    try {
      getDb().prepare('UPDATE spending_budgets SET is_active = 0 WHERE period = ?').run(period);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // ── Wallet / Payment Methods ────────────────────────────────────────────────
  const walletPath = path.join(require('electron').app.getPath('userData'), 'wallet.json');

  async function loadWallet(): Promise<any> {
    try { return JSON.parse(await fs.promises.readFile(walletPath, 'utf-8')); }
    catch { return { paymentMethods: [] }; }
  }

  async function saveWallet(data: any): Promise<void> {
    await fs.promises.writeFile(walletPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  ipcMain.handle(IPC.WALLET_GET_PAYMENT_METHODS, async () => (await loadWallet()).paymentMethods ?? []);
  ipcMain.handle(IPC.WALLET_ADD_MANUAL_CARD, async (_e: any, input: any) => {
    const w = await loadWallet();
    w.paymentMethods.push({ ...input, id: Date.now(), source: 'manual', createdAt: new Date().toISOString() });
    await saveWallet(w);
  });
  ipcMain.handle(IPC.WALLET_IMPORT_BROWSER_CARDS, () => []);
  ipcMain.handle(IPC.WALLET_CONFIRM_IMPORT, async (_e: any, candidates: any[]) => {
    const w = await loadWallet();
    for (const c of candidates) {
      w.paymentMethods.push({ ...c, id: Date.now(), source: 'imported', createdAt: new Date().toISOString() });
    }
    await saveWallet(w);
  });
  ipcMain.handle(IPC.WALLET_SET_PREFERRED, async (_e: any, id: number) => {
    const w = await loadWallet();
    for (const pm of w.paymentMethods) pm.isPreferred = pm.id === id;
    await saveWallet(w);
  });
  ipcMain.handle(IPC.WALLET_SET_BACKUP, async (_e: any, id: number) => {
    const w = await loadWallet();
    for (const pm of w.paymentMethods) pm.isBackup = pm.id === id;
    await saveWallet(w);
  });
  ipcMain.handle(IPC.WALLET_REMOVE_CARD, async (_e: any, id: number) => {
    const w = await loadWallet();
    w.paymentMethods = w.paymentMethods.filter((pm: any) => pm.id !== id);
    await saveWallet(w);
  });

  // ── Tasks ───────────────────────────────────────────────────────────────────
  const tasksPath = path.join(require('electron').app.getPath('userData'), 'tasks.json');

  async function loadTasks(): Promise<any[]> {
    try { return JSON.parse(await fs.promises.readFile(tasksPath, 'utf-8')); }
    catch { return []; }
  }

  async function saveTasks(tasks: any[]): Promise<void> {
    await fs.promises.writeFile(tasksPath, JSON.stringify(tasks, null, 2), 'utf-8');
  }

  ipcMain.handle(IPC.TASKS_SUMMARY, () => ({ runningCount: 0, completedCount: 0 }));
  ipcMain.handle(IPC.TASKS_LIST, async () => loadTasks());
  ipcMain.handle(IPC.TASKS_CREATE, async (_e: any, input: any) => {
    const tasks = await loadTasks();
    const task = { ...input, id: Date.now(), enabled: true, createdAt: new Date().toISOString(), runs: [] };
    tasks.push(task);
    await saveTasks(tasks);
    return task;
  });
  ipcMain.handle(IPC.TASKS_ENABLE, async (_e: any, id: number, enabled: boolean) => {
    const tasks = await loadTasks();
    const t = tasks.find((t: any) => t.id === id);
    if (t) { t.enabled = enabled; await saveTasks(tasks); }
  });
  ipcMain.handle(IPC.TASKS_DELETE, async (_e: any, id: number) => {
    await saveTasks((await loadTasks()).filter((t: any) => t.id !== id));
  });
  ipcMain.handle(IPC.TASKS_RUNS, async (_e: any, id: number) => {
    const task = (await loadTasks()).find((t: any) => t.id === id);
    return task?.runs ?? [];
  });
  ipcMain.handle(IPC.TASKS_RUN_NOW, (_e: any, _id: number) => ({ ok: true, message: 'Task execution not yet implemented' }));

  // ── Identity ────────────────────────────────────────────────────────────────
  const identityPath = path.join(require('electron').app.getPath('userData'), 'identity.json');

  async function loadIdentity(): Promise<any> {
    try { return JSON.parse(await fs.promises.readFile(identityPath, 'utf-8')); }
    catch { return { profile: null, accounts: [], credentials: [] }; }
  }

  async function saveIdentity(data: any): Promise<void> {
    await fs.promises.writeFile(identityPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  ipcMain.handle(IPC.IDENTITY_PROFILE_GET, async () => (await loadIdentity()).profile ?? null);
  ipcMain.handle(IPC.IDENTITY_PROFILE_SET, async (_e: any, input: any) => {
    const id = await loadIdentity(); id.profile = input; await saveIdentity(id);
  });
  ipcMain.handle(IPC.IDENTITY_ACCOUNTS_LIST, async () => (await loadIdentity()).accounts ?? []);
  ipcMain.handle(IPC.IDENTITY_ACCOUNT_ADD, async (_e: any, input: any) => {
    const id = await loadIdentity();
    id.accounts = id.accounts || [];
    id.accounts.push(input);
    await saveIdentity(id);
  });
  ipcMain.handle(IPC.IDENTITY_ACCOUNT_DELETE, async (_e: any, serviceName: string) => {
    const id = await loadIdentity();
    id.accounts = (id.accounts || []).filter((a: any) => a.serviceName !== serviceName);
    await saveIdentity(id);
  });
  ipcMain.handle(IPC.IDENTITY_CREDENTIALS_LIST, async () => {
    return ((await loadIdentity()).credentials ?? []).map((c: any) => ({ ...c, valuePlain: undefined, hasValue: true }));
  });
  ipcMain.handle(IPC.IDENTITY_CREDENTIAL_ADD, async (_e: any, label: string, type: string, service: string, valuePlain: string) => {
    const id = await loadIdentity();
    id.credentials = id.credentials || [];
    id.credentials.push({ label, type, service, valuePlain, createdAt: new Date().toISOString() });
    await saveIdentity(id);
  });
  ipcMain.handle(IPC.IDENTITY_CREDENTIAL_DELETE, async (_e: any, label: string, service: string) => {
    const id = await loadIdentity();
    id.credentials = (id.credentials || []).filter((c: any) => !(c.label === label && c.service === service));
    await saveIdentity(id);
  });

  // ── Filesystem ───────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.FS_READ_DIR, async (_e, dirPath: string) => {
    try {
      const resolved = dirPath.startsWith('~')
        ? require('os').homedir() + dirPath.slice(1)
        : dirPath;
      const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        path: path.join(resolved, e.name),
      }));
    } catch { return []; }
  });

  ipcMain.handle(IPC.FS_READ_FILE, async (_e, filePath: string) => {
    try { return await fs.promises.readFile(filePath, 'utf-8'); }
    catch { return null; }
  });

  ipcMain.handle(IPC.FS_WRITE_FILE, async (_e, filePath: string, content: string) => {
    try { await fs.promises.writeFile(filePath, content, 'utf-8'); return { ok: true }; }
    catch (err: any) { return { ok: false, error: err.message }; }
  });

  // ── Editor ───────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.EDITOR_OPEN_FILE, (_e, filePath: string) => {
    const w = require('electron').BrowserWindow.getAllWindows()[0];
    if (w) w.webContents.send('editor:open-file', { filePath });
  });

  ipcMain.handle(IPC.EDITOR_WATCH_FILE, (_e, filePath: string) => {
    try {
      const watcher = fs.watch(filePath, () => {
        const w = require('electron').BrowserWindow.getAllWindows()[0];
        if (w) w.webContents.send('editor:file-changed', { filePath });
      });
      (ipcMain as any).__editorWatcher = watcher;
      return { ok: true };
    } catch { return { ok: false }; }
  });

  ipcMain.handle(IPC.EDITOR_UNWATCH_FILE, () => {
    const watcher = (ipcMain as any).__editorWatcher;
    if (watcher) { watcher.close(); (ipcMain as any).__editorWatcher = null; }
  });

  ipcMain.handle(IPC.EDITOR_SET_STATE, (_e, state: any) => {
    (ipcMain as any).__editorState = state;
  });

  ipcMain.handle(IPC.EDITOR_GET_STATE, () => (ipcMain as any).__editorState ?? null);

  // ── Terminal helpers (not owned by registerTerminalIpc) ─────────────────────
  ipcMain.handle(IPC.TERMINAL_SPAWN_CLAUDE_CODE, async (_e: any, sessionId: string, task: string) => {
    try {
      const { finalText: result } = await runClaudeCode({
        conversationId: sessionId,
        prompt: task,
        onText: () => {},
      });
      return { sessionId, exitCode: 0, output: result };
    } catch (err: any) {
      return { sessionId, exitCode: 1, output: err.message };
    }
  });
}

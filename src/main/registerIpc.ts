import { ipcMain } from 'electron';
import { ElectronBrowserService } from './core/browser/ElectronBrowserService';
import { IPC } from './ipc-channels';
import { DEFAULT_MODEL_BY_PROVIDER } from '../shared/model-registry';
import { loadSettings, patchSettings, type AppSettings } from './settingsStore';
import { listPolicyProfiles } from './db/policies';
import { attachClawdiaMcpBridge } from './mcpBridge';
import { registerWorkspaceStateAccessor } from './core/cli/workspaceState';
import { TerminalSessionController } from './core/terminal/TerminalSessionController';
import { SessionManager } from './SessionManager';
import { registerChatIpc } from './ipc/ChatIpc';
import { registerBrowserIpc } from './ipc/BrowserIpc';
import { registerAgentIpc } from './ipc/AgentIpc';
import { registerRunIpc } from './ipc/RunIpc';
import { listExecutors } from './core/executors/ExecutorRegistry';
import { getExecutorConfig, patchExecutorConfig, loadExecutorConfigs } from './core/executors/ExecutorConfigStore';
import type { ExecutorId } from './core/executors/ExecutorRegistry';
import { getTaskState, getLatestTask, getRecentTasks } from './taskTracker';
import {
  dismissSessionContinuitySuggestion,
  peekLatestSessionContinuity,
  recallLatestSessionContinuity,
} from './sessionContinuity';

const sessionManager = new SessionManager();
let registered = false;

// Expose live state to the workspace awareness tools without circular imports.
registerWorkspaceStateAccessor({
  getActiveConversationIds: () => sessionManager.getActiveConversationIds(),
  isConversationRunning: (id) => sessionManager.isConversationRunning(id),
  getSessionMessages: (id) => sessionManager.getSession(id) ?? [],
});

export function registerIpc(
  browserService: ElectronBrowserService,
  terminalController?: TerminalSessionController,
): void {
  attachClawdiaMcpBridge(browserService, terminalController);
  registerChatIpc(sessionManager, browserService, terminalController);
  registerBrowserIpc(browserService);
  registerAgentIpc(sessionManager, browserService);
  registerRunIpc(terminalController);
  if (registered) return;
  registered = true;

  // ── Settings ─────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.SETTINGS_GET, (_e, key: keyof AppSettings) => {
    const s = loadSettings();
    return s[key] ?? null;
  });

  ipcMain.handle(IPC.SETTINGS_SET, (_e, key: keyof AppSettings, value: unknown) => {
    patchSettings({ [key]: value } as Partial<AppSettings>);
  });

  ipcMain.handle(IPC.SETTINGS_GET_PROVIDER_KEYS, () => loadSettings().providerKeys);
  ipcMain.handle(IPC.SETTINGS_GET_PROVIDER, () => loadSettings().provider);
  ipcMain.handle(IPC.SETTINGS_SET_PROVIDER, (_e, provider: AppSettings['provider']) => patchSettings({ provider }));

  ipcMain.handle(IPC.API_KEY_GET, (_e, provider?: string) => {
    if (!provider) return null;
    return loadSettings().providerKeys[provider as keyof AppSettings['providerKeys']] ?? '';
  });

  ipcMain.handle(IPC.API_KEY_SET, (_e, provider: string, key: string) => {
    const cur = loadSettings();
    patchSettings({ providerKeys: { ...cur.providerKeys, [provider]: key } });
  });

  ipcMain.handle(IPC.MODEL_GET, (_e, provider?: string) => {
    if (!provider) return null;
    const s = loadSettings();
    return s.models[provider as keyof typeof s.models]
      ?? DEFAULT_MODEL_BY_PROVIDER[provider as keyof typeof DEFAULT_MODEL_BY_PROVIDER];
  });

  ipcMain.handle(IPC.MODEL_SET, (_e, provider: string, model: string) => {
    const cur = loadSettings();
    patchSettings({ models: { ...cur.models, [provider]: model } });
  });

  ipcMain.handle('settings:get-unrestricted-mode', () => loadSettings().unrestrictedMode);
  ipcMain.handle('settings:set-unrestricted-mode', (_e, v: boolean) => patchSettings({ unrestrictedMode: v }));
  ipcMain.handle('settings:get-policy-profile', () => loadSettings().policyProfile);
  ipcMain.handle('settings:set-policy-profile', (_e, v: string) => patchSettings({ policyProfile: v }));
  ipcMain.handle('settings:get-performance-stance', () => loadSettings().performanceStance);
  ipcMain.handle('settings:set-performance-stance', (_e, v: AppSettings['performanceStance']) =>
    patchSettings({ performanceStance: v }),
  );

  ipcMain.handle(IPC.POLICY_LIST, () => listPolicyProfiles());

  // ── Executor registry / config / state ────────────────────────────────────────
  ipcMain.handle(IPC.EXECUTOR_LIST, () => listExecutors());

  ipcMain.handle(IPC.EXECUTOR_CONFIG_GET, (_e, id?: ExecutorId) => {
    if (id) return getExecutorConfig(id);
    return loadExecutorConfigs();
  });

  ipcMain.handle(IPC.EXECUTOR_CONFIG_PATCH, (_e, id: ExecutorId, patch: Record<string, unknown>) => {
    patchExecutorConfig(id, patch as any);
    return { ok: true };
  });

  ipcMain.handle(IPC.EXECUTOR_STATE_GET, (_e, conversationId: string) =>
    sessionManager.getExecutorState(conversationId) ?? null,
  );

  ipcMain.handle(IPC.EXECUTOR_STATE_LIST, () => {
    const all = sessionManager.getAllExecutorStates();
    // Serialize Map to plain object for IPC
    const result: Record<string, unknown> = {};
    for (const [convId, state] of all) result[convId] = state;
    return result;
  });

  // ── Task identity + tracking ──────────────────────────────────────────────────
  ipcMain.handle(IPC.TASK_GET, (_e, taskId: string) => getTaskState(taskId) ?? null);

  ipcMain.handle(IPC.TASK_GET_LATEST, (_e, conversationId: string) => {
    // Prefer in-memory active task id; fall back to DB lookup for persistence after restart.
    const inMemoryId = sessionManager.getActiveTaskId(conversationId);
    if (inMemoryId) return getTaskState(inMemoryId) ?? getLatestTask(conversationId);
    return getLatestTask(conversationId);
  });

  ipcMain.handle(IPC.TASK_LIST, (_e, conversationId: string, limit?: number) =>
    getRecentTasks(conversationId, limit ?? 20),
  );

  ipcMain.handle(IPC.SESSION_PEEK_LATEST, (_e, excludeConversationId?: string | null) =>
    peekLatestSessionContinuity(excludeConversationId ?? null),
  );

  ipcMain.handle(IPC.SESSION_RECALL, (_e, excludeConversationId?: string | null) =>
    recallLatestSessionContinuity(excludeConversationId ?? null),
  );

  ipcMain.handle(IPC.SESSION_DISMISS, (_e, sessionId: string) => {
    dismissSessionContinuitySuggestion(sessionId);
    return { ok: true };
  });
}

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

const sessionManager = new SessionManager();

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
  attachClawdiaMcpBridge(browserService);

  // ── Domain handlers ──────────────────────────────────────────────────────────
  registerChatIpc(sessionManager, browserService, terminalController);
  registerBrowserIpc(browserService);
  registerAgentIpc(sessionManager, browserService);
  registerRunIpc(terminalController);

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
}

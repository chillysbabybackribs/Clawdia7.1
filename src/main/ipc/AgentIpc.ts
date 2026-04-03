import { BrowserWindow, ipcMain } from 'electron';
import { IPC, IPC_EVENTS } from '../ipc-channels';
import { DEFAULT_MODEL_BY_PROVIDER } from '../../shared/model-registry';
import type { AgentDefinition, AgentBuilderCompileInput } from '../../shared/types';
import { agentLoop } from '../agent/agentLoop';
import { runConcurrent } from '../core/executors/ConcurrentExecutor';
import { loadSettings } from '../settingsStore';
import { createConversation } from '../db';
import { createAgent, getAgent, listAgents, updateAgent, deleteAgent } from '../db/agents';
import { createNewTask, completeTask, failTask, cancelTask } from '../taskTracker';
import type { SessionManager } from '../SessionManager';
import type { ElectronBrowserService } from '../core/browser/ElectronBrowserService';

let registered = false;
let browserServiceRef: ElectronBrowserService | null = null;

export function registerAgentIpc(
  sessionManager: SessionManager,
  browserService: ElectronBrowserService,
): void {
  browserServiceRef = browserService;

  function getMainWindow(): BrowserWindow | undefined {
    return BrowserWindow.getAllWindows()[0];
  }

  const service = (): ElectronBrowserService => {
    if (!browserServiceRef) throw new Error('Browser service not initialized');
    return browserServiceRef;
  };

  if (registered) return;
  registered = true;

  function resolveProviderConfig() {
    const settings = loadSettings();
    const provider = settings.provider as 'anthropic' | 'openai' | 'gemini';
    const apiKey = settings.providerKeys[provider]?.trim();
    const model = settings.models[provider] ?? DEFAULT_MODEL_BY_PROVIDER[provider];
    return { settings, provider, apiKey, model };
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.AGENT_LIST, () => listAgents());

  ipcMain.handle(IPC.AGENT_GET, (_e, id: string) => getAgent(id));

  ipcMain.handle(IPC.AGENT_CREATE, (_e, input: Partial<AgentDefinition> & { goal: string }) => {
    const now = new Date().toISOString();
    const agent: AgentDefinition = {
      id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: input.name || 'Untitled Agent',
      description: input.description || '',
      agentType: input.agentType || 'general',
      status: 'draft',
      goal: input.goal ?? '',
      blueprint: input.blueprint,
      successDescription: input.successDescription,
      resourceScope: input.resourceScope || {},
      operationMode: input.operationMode || 'read_only',
      mutationPolicy: input.mutationPolicy || 'no_mutation',
      approvalPolicy: input.approvalPolicy || 'always_ask',
      launchModes: input.launchModes || ['manual'],
      defaultLaunchMode: input.defaultLaunchMode || 'manual',
      config: input.config || {},
      outputMode: input.outputMode || 'chat_message',
      outputTarget: input.outputTarget,
      schedule: input.schedule || null,
      lastTestStatus: 'untested',
      createdAt: now,
      updatedAt: now,
    };
    createAgent(agent);
    return agent;
  });

  ipcMain.handle(IPC.AGENT_UPDATE, (_e, id: string, patch: Partial<AgentDefinition>) => updateAgent(id, patch));

  ipcMain.handle(IPC.AGENT_DELETE, (_e, id: string) => {
    deleteAgent(id);
    return { ok: true };
  });

  ipcMain.handle(IPC.AGENT_HISTORY, (_e, _agentId: string) => []);

  // ── Run ─────────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.AGENT_RUN, async (_e, id: string) => {
    const agentDef = getAgent(id);
    if (!agentDef) return { ok: false, error: 'Agent not found' };
    const { provider, apiKey, model, settings } = resolveProviderConfig();
    if (!apiKey) return { ok: false, error: 'No API key configured' };

    const abort = new AbortController();
    const convId = `conv-agent-${Date.now()}`;
    const taskId = createNewTask(convId, agentDef.goal, 'concurrent');
    const now = new Date().toISOString();
    createConversation({ id: convId, title: agentDef.name, mode: 'chat', created_at: now, updated_at: now });

    try {
      await runConcurrent({
        conversationId: convId,
        taskId,
        prompt: agentDef.goal,
        signal: abort.signal,
        onThinking: () => {},
        onStateChanged: (state) => getMainWindow()?.webContents.send(IPC_EVENTS.SWARM_STATE_CHANGED, state),
        onText: () => {},
      });
      completeTask(taskId);
      return { ok: true, conversationId: convId };
    } catch (e: any) {
      if (e?.name === 'AbortError' || e?.message === 'AbortError') {
        cancelTask(taskId);
      } else {
        failTask(taskId, e?.message ?? String(e));
      }
      return { ok: false, error: e.message };
    }
  });

  // ── Run on Current Page ──────────────────────────────────────────────────────
  ipcMain.handle(IPC.AGENT_RUN_CURRENT_PAGE, async (_e, id: string) => {
    const agentDef = getAgent(id);
    if (!agentDef) return { ok: false, error: 'Agent not found' };
    const { provider, apiKey, model, settings } = resolveProviderConfig();
    if (!apiKey) return { ok: false, error: 'No API key configured' };

    let pageUrl = '';
    let pageTitle = '';
    try {
      const tabs = await service().listTabs();
      const activeTab = tabs.find((t: any) => t.active);
      if (activeTab) { pageUrl = activeTab.url || ''; pageTitle = activeTab.title || ''; }
    } catch { /* browser may not be available */ }

    if (!pageUrl) return { ok: false, error: 'No active browser page found' };

    const abort = new AbortController();
    const convId = `conv-agent-${Date.now()}`;
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    createConversation({ id: convId, title: `${agentDef.name} — ${pageTitle || pageUrl}`, mode: 'chat', created_at: now, updated_at: now });

    const goal = `${agentDef.goal}\n\nContext: Run this agent on the currently open browser page.\nPage URL: ${pageUrl}\nPage Title: ${pageTitle}`;

    try {
      const sessionMessages = sessionManager.getOrCreateSession(convId);
      await agentLoop(goal, sessionMessages, {
        provider, apiKey, model, runId,
        conversationId: convId,
        signal: abort.signal,
        browserService: service(),
        unrestrictedMode: settings.unrestrictedMode,
        onText: (delta) => getMainWindow()?.webContents.send(IPC_EVENTS.CHAT_STREAM_TEXT, delta),
        onThinking: (t) => getMainWindow()?.webContents.send(IPC_EVENTS.CHAT_THINKING, t),
        onToolActivity: (activity) => getMainWindow()?.webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, activity),
      });
      return { ok: true, runId, conversationId: convId };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // ── Run on URLs ──────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.AGENT_RUN_URLS, async (_e, id: string, urls: string[]) => {
    const agentDef = getAgent(id);
    if (!agentDef) return { ok: false, error: 'Agent not found' };
    if (!urls || urls.length === 0) return { ok: false, error: 'No URLs provided' };
    const { provider, apiKey, model, settings } = resolveProviderConfig();
    if (!apiKey) return { ok: false, error: 'No API key configured' };

    const abort = new AbortController();
    const convId = `conv-agent-${Date.now()}`;
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    createConversation({ id: convId, title: `${agentDef.name} — ${urls.length} URL(s)`, mode: 'chat', created_at: now, updated_at: now });

    const urlList = urls.map((u, i) => `${i + 1}. ${u}`).join('\n');
    const goal = `${agentDef.goal}\n\nProcess the following URLs:\n${urlList}`;

    try {
      const sessionMessages = sessionManager.getOrCreateSession(convId);
      await agentLoop(goal, sessionMessages, {
        provider, apiKey, model, runId,
        conversationId: convId,
        signal: abort.signal,
        browserService: service(),
        unrestrictedMode: settings.unrestrictedMode,
        onText: (delta) => getMainWindow()?.webContents.send(IPC_EVENTS.CHAT_STREAM_TEXT, delta),
        onThinking: (t) => getMainWindow()?.webContents.send(IPC_EVENTS.CHAT_THINKING, t),
        onToolActivity: (activity) => getMainWindow()?.webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, activity),
      });
      return { ok: true, runId, conversationId: convId };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // ── Test ─────────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.AGENT_TEST, async (_e, id: string) => {
    const agentDef = getAgent(id);
    if (!agentDef) return { ok: false, error: 'Agent not found' };
    const { provider, apiKey, model, settings } = resolveProviderConfig();
    if (!apiKey) return { ok: false, error: 'No API key configured' };

    const abort = new AbortController();
    const convId = `conv-agent-test-${Date.now()}`;
    const runId = `run-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    createConversation({ id: convId, title: `[Test] ${agentDef.name}`, mode: 'chat', created_at: now, updated_at: now });

    const testGoal = `[DRY RUN / TEST MODE] You are testing the following agent definition. Validate that each step is achievable, the tools are accessible, and the scope is correct. Do NOT make any real modifications — only read and verify.\n\nAgent: ${agentDef.name}\nGoal: ${agentDef.goal}\n${agentDef.blueprint ? `Steps:\n${agentDef.blueprint.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : ''}\n\nReport: Is this agent ready to run? List any issues found.`;

    try {
      const sessionMessages = sessionManager.getOrCreateSession(convId);
      const result = await agentLoop(testGoal, sessionMessages, {
        provider, apiKey, model, runId,
        conversationId: convId,
        signal: abort.signal,
        browserService: service(),
        unrestrictedMode: settings.unrestrictedMode,
        onText: (delta) => getMainWindow()?.webContents.send(IPC_EVENTS.CHAT_STREAM_TEXT, delta),
        onThinking: (t) => getMainWindow()?.webContents.send(IPC_EVENTS.CHAT_THINKING, t),
        onToolActivity: (activity) => getMainWindow()?.webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, activity),
      });

      const passed = !result.toLowerCase().includes('fail') && !result.toLowerCase().includes('error') && !result.toLowerCase().includes('cannot');
      updateAgent(id, {
        lastTestStatus: passed ? 'passed' : 'failed',
        lastTestSummary: result.slice(0, 500),
      });
      return { ok: true, runId, conversationId: convId };
    } catch (e: any) {
      updateAgent(id, { lastTestStatus: 'failed', lastTestSummary: e.message });
      return { ok: false, error: e.message };
    }
  });

  // ── Compile ──────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.AGENT_COMPILE, async (_e, input: AgentBuilderCompileInput) => {
    const { provider, apiKey, model } = resolveProviderConfig();
    if (!apiKey) return { ok: false, definition: null, error: 'No API key configured' };

    const compilePrompt = `You are an agent architect. Given the user's goal, generate a structured agent blueprint as JSON.

Respond ONLY with a JSON object in this exact format:
{
  "name": "concise agent name",
  "description": "one-line description",
  "agentType": "web_data|spreadsheet|email|files|research|general",
  "outputMode": "preview|csv|json|spreadsheet|chat_message|file_output",
  "outputTarget": "optional file path or destination",
  "resourceScope": {
    "browserDomains": ["domain.com"],
    "urls": [],
    "folders": [],
    "files": [],
    "apps": []
  },
  "blueprint": {
    "objective": "what this agent achieves",
    "inputs": ["what it needs from the user"],
    "scope": ["what resources it accesses"],
    "constraints": ["guardrails and limits"],
    "steps": ["step 1", "step 2", "step 3"],
    "output": { "mode": "csv", "summary": "outputs a CSV of extracted data" },
    "successCriteria": ["how we know it worked"],
    "assumptions": ["what we assume is true"],
    "openQuestions": ["things to clarify"]
  },
  "questions": ["clarifying questions for the user, if any"],
  "warnings": ["potential issues or risks"]
}`;

    const userInput = input.refinement
      ? `Original goal: ${input.goal}\n\nRefinement: ${input.refinement}\n\n${input.currentBlueprint ? `Current blueprint: ${JSON.stringify(input.currentBlueprint)}` : ''}`
      : input.goal;

    try {
      const { streamLLM } = await import('../agent/streamLLM');
      const { text } = await streamLLM(
        [{ role: 'user', content: userInput }],
        compilePrompt,
        '',
        { toolGroup: 'core', modelTier: 'standard', isGreeting: false },
        {
          provider, apiKey, model,
          runId: `compile-${Date.now()}`,
          onText: () => {},
          maxIterations: 1,
        } as any,
      );

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { ok: false, definition: null, error: 'Model did not return valid JSON' };

      const parsed = JSON.parse(jsonMatch[0]);
      return { ok: true, ...parsed, model };
    } catch (e: any) {
      return { ok: false, definition: null, error: e.message };
    }
  });
}

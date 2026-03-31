import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock settingsStore before importing the module under test ─────────────────

let storedSettings: Record<string, unknown> = {};

vi.mock('../../../../src/main/settingsStore', () => ({
  loadSettings: vi.fn(() => ({ ...storedSettings })),
  saveSettings: vi.fn((s: Record<string, unknown>) => { storedSettings = { ...s }; }),
}));

import { loadSettings, saveSettings } from '../../../../src/main/settingsStore';
import {
  loadExecutorConfigs,
  getExecutorConfig,
  patchExecutorConfig,
} from '../../../../src/main/core/executors/ExecutorConfigStore';

beforeEach(() => {
  storedSettings = {};
  vi.clearAllMocks();
});

describe('loadExecutorConfigs', () => {
  it('returns fully-populated defaults when no executorConfigs stored', () => {
    const configs = loadExecutorConfigs();

    expect(configs.agentLoop.enabled).toBe(true);
    expect(configs.agentLoop.sameConversationPolicy).toBe('exclusive');
    expect(configs.agentLoop.timeoutMs).toBe(0);
    expect(configs.agentLoop.pipelineEnabled).toBe(true);
    expect(configs.agentLoop.maxSessionTurns).toBe(20);
    expect(configs.agentLoop.maxMappingSessionTurns).toBe(6);

    expect(configs.claudeCode.enabled).toBe(true);
    expect(configs.claudeCode.resumeSession).toBe(true);
    expect(configs.claudeCode.skipPermissions).toBe(false);
    expect(configs.claudeCode.displayOrder).toBe(1);

    expect(configs.codex.enabled).toBe(true);
    expect(configs.codex.resumeThread).toBe(true);
    expect(configs.codex.displayOrder).toBe(2);

    expect(configs.concurrent.enabled).toBe(false);
    expect(configs.concurrent.displayOrder).toBe(3);
    expect(configs.concurrent.timeoutMs).toBe(300000);
    expect(configs.concurrent.strategy).toBe('parallel');
    expect(configs.concurrent.synthesize).toBe(true);
  });

  it('merges stored values over defaults', () => {
    storedSettings = {
      executorConfigs: {
        agentLoop: { enabled: false, maxSessionTurns: 5 },
        codex: { resumeThread: false },
      },
    };

    const configs = loadExecutorConfigs();

    // Overridden values
    expect(configs.agentLoop.enabled).toBe(false);
    expect(configs.agentLoop.maxSessionTurns).toBe(5);
    expect(configs.codex.resumeThread).toBe(false);

    // Non-overridden defaults survive
    expect(configs.agentLoop.pipelineEnabled).toBe(true);
    expect(configs.agentLoop.maxMappingSessionTurns).toBe(6);
    expect(configs.claudeCode.enabled).toBe(true);
    expect(configs.concurrent.enabled).toBe(false);
  });

  it('handles partial stored object (missing executor keys)', () => {
    storedSettings = { executorConfigs: { claudeCode: { skipPermissions: true } } };

    const configs = loadExecutorConfigs();
    expect(configs.claudeCode.skipPermissions).toBe(true);
    // Other executors still get full defaults
    expect(configs.agentLoop.enabled).toBe(true);
    expect(configs.codex.enabled).toBe(true);
    expect(configs.concurrent.strategy).toBe('parallel');
  });
});

describe('getExecutorConfig', () => {
  it('returns config for a specific executor', () => {
    const cfg = getExecutorConfig('agentLoop');
    expect(cfg.enabled).toBe(true);
    expect(cfg.sameConversationPolicy).toBe('exclusive');
  });

  it('returns codex config', () => {
    const cfg = getExecutorConfig('codex');
    expect(cfg.resumeThread).toBe(true);
  });

  it('returns concurrent config', () => {
    const cfg = getExecutorConfig('concurrent');
    expect(cfg.enabled).toBe(false);
    expect(cfg.strategy).toBe('parallel');
    expect(cfg.synthesize).toBe(true);
  });
});

describe('patchExecutorConfig', () => {
  it('persists a partial patch without losing other fields', () => {
    patchExecutorConfig('agentLoop', { enabled: false });

    expect(saveSettings).toHaveBeenCalledOnce();
    const saved = (saveSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved.executorConfigs.agentLoop.enabled).toBe(false);
    // Other agentLoop fields should survive
    expect(saved.executorConfigs.agentLoop.pipelineEnabled).toBe(true);
    expect(saved.executorConfigs.agentLoop.maxSessionTurns).toBe(20);
  });

  it('patches claudeCode skipPermissions', () => {
    patchExecutorConfig('claudeCode', { skipPermissions: true });

    const saved = (saveSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved.executorConfigs.claudeCode.skipPermissions).toBe(true);
    expect(saved.executorConfigs.claudeCode.resumeSession).toBe(true);
  });

  it('does not mutate other executors when patching one', () => {
    patchExecutorConfig('codex', { resumeThread: false });

    const saved = (saveSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved.executorConfigs.agentLoop.enabled).toBe(true);
    expect(saved.executorConfigs.claudeCode.enabled).toBe(true);
    expect(saved.executorConfigs.codex.resumeThread).toBe(false);
    expect(saved.executorConfigs.concurrent.enabled).toBe(false);
  });

  it('patches concurrent settings without losing defaults', () => {
    patchExecutorConfig('concurrent', { enabled: true, synthesize: false });

    const saved = (saveSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved.executorConfigs.concurrent.enabled).toBe(true);
    expect(saved.executorConfigs.concurrent.synthesize).toBe(false);
    expect(saved.executorConfigs.concurrent.strategy).toBe('parallel');
    expect(saved.executorConfigs.concurrent.timeoutMs).toBe(300000);
  });
});

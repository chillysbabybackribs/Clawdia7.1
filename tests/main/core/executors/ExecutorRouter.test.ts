import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock dependencies ─────────────────────────────────────────────────────────

let mockConfigs: Record<string, { enabled: boolean; sameConversationPolicy: 'exclusive'; timeoutMs: number }> = {};

vi.mock('../../../../src/main/settingsStore', () => ({
  loadSettings: vi.fn(() => ({})),
  saveSettings: vi.fn(),
}));

vi.mock('../../../../src/main/core/executors/ExecutorConfigStore', () => ({
  loadExecutorConfigs: vi.fn(() => mockConfigs),
}));

import { loadExecutorConfigs } from '../../../../src/main/core/executors/ExecutorConfigStore';

import {
  routeExecutor,
  getSameConversationPolicy,
  allowsCrossConversationConcurrency,
  initExecutorState,
  updateExecutorState,
  getExecutorState,
  getAllExecutorStates,
  removeExecutorState,
} from '../../../../src/main/core/executors/ExecutorRouter';

function enabledConfigs() {
  return {
    agentLoop: { enabled: true, sameConversationPolicy: 'exclusive' as const, timeoutMs: 0, pipelineEnabled: true, maxSessionTurns: 20, maxMappingSessionTurns: 6, displayOrder: 0 },
    claudeCode: { enabled: true, sameConversationPolicy: 'exclusive' as const, timeoutMs: 0, resumeSession: true, skipPermissions: false, displayOrder: 1 },
    codex: { enabled: true, sameConversationPolicy: 'exclusive' as const, timeoutMs: 0, resumeThread: true, displayOrder: 2 },
  };
}

beforeEach(() => {
  mockConfigs = enabledConfigs();
  vi.clearAllMocks();
  (loadExecutorConfigs as ReturnType<typeof vi.fn>).mockImplementation(() => mockConfigs);
});

// ─── routeExecutor ────────────────────────────────────────────────────────────

describe('routeExecutor', () => {
  it('routes chat mode to agentLoop', () => {
    const result = routeExecutor('chat');
    expect(result.executorId).toBe('agentLoop');
    expect(result.usedFallback).toBe(false);
  });

  it('routes claude_terminal to claudeCode', () => {
    const result = routeExecutor('claude_terminal');
    expect(result.executorId).toBe('claudeCode');
    expect(result.usedFallback).toBe(false);
  });

  it('routes codex_terminal to codex', () => {
    const result = routeExecutor('codex_terminal');
    expect(result.executorId).toBe('codex');
    expect(result.usedFallback).toBe(false);
  });

  it('falls back to agentLoop for unknown mode', () => {
    const result = routeExecutor('unknown_mode');
    // unknown → resolveExecutorId returns agentLoop, which is enabled → no fallback
    expect(result.executorId).toBe('agentLoop');
    expect(result.usedFallback).toBe(false);
  });

  it('falls back to agentLoop when requested executor is disabled', () => {
    mockConfigs = {
      ...enabledConfigs(),
      claudeCode: { ...enabledConfigs().claudeCode, enabled: false },
    };
    (loadExecutorConfigs as ReturnType<typeof vi.fn>).mockReturnValue(mockConfigs);

    const result = routeExecutor('claude_terminal');
    expect(result.executorId).toBe('agentLoop');
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toMatch(/claudeCode.*disabled/);
  });

  it('falls back to agentLoop when codex is disabled', () => {
    mockConfigs = {
      ...enabledConfigs(),
      codex: { ...enabledConfigs().codex, enabled: false },
    };
    (loadExecutorConfigs as ReturnType<typeof vi.fn>).mockReturnValue(mockConfigs);

    const result = routeExecutor('codex_terminal');
    expect(result.executorId).toBe('agentLoop');
    expect(result.usedFallback).toBe(true);
  });

  it('does not set usedFallback when routed normally', () => {
    expect(routeExecutor('chat').usedFallback).toBe(false);
    expect(routeExecutor('claude_terminal').usedFallback).toBe(false);
    expect(routeExecutor('codex_terminal').usedFallback).toBe(false);
  });
});

// ─── getSameConversationPolicy ────────────────────────────────────────────────

describe('getSameConversationPolicy', () => {
  it('returns exclusive for all executors', () => {
    expect(getSameConversationPolicy('agentLoop')).toBe('exclusive');
    expect(getSameConversationPolicy('claudeCode')).toBe('exclusive');
    expect(getSameConversationPolicy('codex')).toBe('exclusive');
  });
});

// ─── allowsCrossConversationConcurrency ───────────────────────────────────────

describe('allowsCrossConversationConcurrency', () => {
  it('always returns true', () => {
    expect(allowsCrossConversationConcurrency('agentLoop')).toBe(true);
    expect(allowsCrossConversationConcurrency('claudeCode')).toBe(true);
    expect(allowsCrossConversationConcurrency('codex')).toBe(true);
  });
});

// ─── Runtime state management ─────────────────────────────────────────────────

describe('initExecutorState', () => {
  it('creates initial idle state', () => {
    const state = initExecutorState('conv-abc', 'agentLoop');
    expect(state.executorId).toBe('agentLoop');
    expect(state.status).toBe('idle');
    expect(state.runId).toBeNull();
    expect(state.hasPersistentSession).toBe(false);
    expect(typeof state.lastChangedAt).toBe('string');
  });

  it('stores state retrievable via getExecutorState', () => {
    initExecutorState('conv-init-1', 'claudeCode');
    const state = getExecutorState('conv-init-1');
    expect(state?.executorId).toBe('claudeCode');
    expect(state?.status).toBe('idle');
  });

  it('overwrites existing state', () => {
    initExecutorState('conv-overwrite', 'agentLoop');
    updateExecutorState('conv-overwrite', { status: 'running', runId: 'run-1' });
    initExecutorState('conv-overwrite', 'codex');
    const state = getExecutorState('conv-overwrite');
    expect(state?.executorId).toBe('codex');
    expect(state?.status).toBe('idle');
    expect(state?.runId).toBeNull();
  });
});

describe('updateExecutorState', () => {
  it('transitions status from idle to running', () => {
    initExecutorState('conv-update-1', 'agentLoop');
    const next = updateExecutorState('conv-update-1', { status: 'running', runId: 'run-42' });
    expect(next.status).toBe('running');
    expect(next.runId).toBe('run-42');
    expect(next.executorId).toBe('agentLoop');
  });

  it('updates lastChangedAt on each call', () => {
    initExecutorState('conv-ts', 'agentLoop');
    const first = updateExecutorState('conv-ts', { status: 'running' });
    const second = updateExecutorState('conv-ts', { status: 'idle' });
    // Both are valid ISO strings; second should be >= first
    expect(new Date(second.lastChangedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.lastChangedAt).getTime(),
    );
  });

  it('creates state via agentLoop fallback if conversation not initialized', () => {
    const state = updateExecutorState('conv-new', { status: 'running', runId: 'r1' });
    expect(state.status).toBe('running');
    expect(state.runId).toBe('r1');
    // Default executor when not specified
    expect(state.executorId).toBe('agentLoop');
  });

  it('sets hasPersistentSession', () => {
    initExecutorState('conv-persist', 'claudeCode');
    const state = updateExecutorState('conv-persist', { hasPersistentSession: true });
    expect(state.hasPersistentSession).toBe(true);
  });
});

describe('getExecutorState', () => {
  it('returns undefined for unknown conversation', () => {
    expect(getExecutorState('conv-does-not-exist-xyz')).toBeUndefined();
  });
});

describe('getAllExecutorStates', () => {
  it('returns a copy (not the internal map)', () => {
    initExecutorState('conv-all-1', 'agentLoop');
    const snapshot = getAllExecutorStates();
    expect(snapshot.has('conv-all-1')).toBe(true);
    // Mutating the copy should not affect internal state
    snapshot.delete('conv-all-1');
    expect(getExecutorState('conv-all-1')).toBeDefined();
  });
});

describe('removeExecutorState', () => {
  it('removes state for a conversation', () => {
    initExecutorState('conv-remove', 'agentLoop');
    removeExecutorState('conv-remove');
    expect(getExecutorState('conv-remove')).toBeUndefined();
  });

  it('is a no-op for unknown conversation', () => {
    expect(() => removeExecutorState('conv-never-existed')).not.toThrow();
  });
});

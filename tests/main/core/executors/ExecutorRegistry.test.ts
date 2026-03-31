import { describe, it, expect } from 'vitest';
import {
  CONV_MODE_TO_EXECUTOR,
  EXECUTOR_TO_CONV_MODE,
  getExecutorDefinition,
  listExecutors,
  resolveExecutorId,
  supportsParallelConversations,
} from '../../../../src/main/core/executors/ExecutorRegistry';

describe('CONV_MODE_TO_EXECUTOR', () => {
  it('maps known modes to correct executor IDs', () => {
    expect(CONV_MODE_TO_EXECUTOR['chat']).toBe('agentLoop');
    expect(CONV_MODE_TO_EXECUTOR['claude_terminal']).toBe('claudeCode');
    expect(CONV_MODE_TO_EXECUTOR['codex_terminal']).toBe('codex');
    expect(CONV_MODE_TO_EXECUTOR['concurrent']).toBe('concurrent');
  });
});

describe('EXECUTOR_TO_CONV_MODE', () => {
  it('maps executor IDs back to conv mode strings', () => {
    expect(EXECUTOR_TO_CONV_MODE['agentLoop']).toBe('chat');
    expect(EXECUTOR_TO_CONV_MODE['claudeCode']).toBe('claude_terminal');
    expect(EXECUTOR_TO_CONV_MODE['codex']).toBe('codex_terminal');
    expect(EXECUTOR_TO_CONV_MODE['concurrent']).toBe('concurrent');
  });

  it('is the inverse of CONV_MODE_TO_EXECUTOR', () => {
    for (const [mode, id] of Object.entries(CONV_MODE_TO_EXECUTOR)) {
      expect(EXECUTOR_TO_CONV_MODE[id]).toBe(mode);
    }
  });
});

describe('resolveExecutorId', () => {
  it('resolves known modes', () => {
    expect(resolveExecutorId('chat')).toBe('agentLoop');
    expect(resolveExecutorId('claude_terminal')).toBe('claudeCode');
    expect(resolveExecutorId('codex_terminal')).toBe('codex');
    expect(resolveExecutorId('concurrent')).toBe('concurrent');
  });

  it('falls back to agentLoop for unknown modes', () => {
    expect(resolveExecutorId('unknown_mode')).toBe('agentLoop');
    expect(resolveExecutorId('')).toBe('agentLoop');
    expect(resolveExecutorId('some_future_mode')).toBe('agentLoop');
  });
});

describe('getExecutorDefinition', () => {
  it('returns definition for agentLoop', () => {
    const def = getExecutorDefinition('agentLoop');
    expect(def.id).toBe('agentLoop');
    expect(def.category).toBe('agent-loop');
    expect(def.supportsStreaming).toBe(true);
    expect(def.supportsToolCalls).toBe(true);
    expect(def.defaultEnabled).toBe(true);
    expect(def.allowsSameConversationConcurrency).toBe(false);
  });

  it('returns definition for claudeCode', () => {
    const def = getExecutorDefinition('claudeCode');
    expect(def.id).toBe('claudeCode');
    expect(def.category).toBe('external-cli');
    expect(def.supportsStreaming).toBe(true);
    expect(def.eligibleForAutoRouting).toBe(false);
    expect(def.defaultEnabled).toBe(true);
  });

  it('returns definition for codex', () => {
    const def = getExecutorDefinition('codex');
    expect(def.id).toBe('codex');
    expect(def.category).toBe('external-cli');
    expect(def.supportsToolCalls).toBe(false);
    expect(def.eligibleForAutoRouting).toBe(false);
    expect(def.defaultEnabled).toBe(true);
  });

  it('returns definition for concurrent', () => {
    const def = getExecutorDefinition('concurrent');
    expect(def.id).toBe('concurrent');
    expect(def.category).toBe('local');
    expect(def.supportsToolCalls).toBe(true);
    expect(def.supportsSessionPersistence).toBe(false);
    expect(def.eligibleForAutoRouting).toBe(false);
    expect(def.defaultEnabled).toBe(false);
  });

  it('every definition has required string fields', () => {
    for (const id of ['agentLoop', 'claudeCode', 'codex', 'concurrent'] as const) {
      const def = getExecutorDefinition(id);
      expect(typeof def.displayName).toBe('string');
      expect(def.displayName.length).toBeGreaterThan(0);
      expect(typeof def.description).toBe('string');
      expect(Array.isArray(def.requirements)).toBe(true);
    }
  });
});

describe('listExecutors', () => {
  it('returns all registered executors', () => {
    const list = listExecutors();
    expect(list).toHaveLength(4);
    const ids = list.map(d => d.id);
    expect(ids).toContain('agentLoop');
    expect(ids).toContain('claudeCode');
    expect(ids).toContain('codex');
    expect(ids).toContain('concurrent');
  });
});

describe('supportsParallelConversations', () => {
  it('returns true for all executors (all support concurrent runs)', () => {
    expect(supportsParallelConversations('agentLoop')).toBe(true);
    expect(supportsParallelConversations('claudeCode')).toBe(true);
    expect(supportsParallelConversations('codex')).toBe(true);
    expect(supportsParallelConversations('concurrent')).toBe(true);
  });
});

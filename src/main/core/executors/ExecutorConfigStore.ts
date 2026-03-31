/**
 * ExecutorConfigStore — per-executor configuration.
 *
 * Stored alongside the existing AppSettings file so there is one settings
 * location on disk. The store is loaded lazily and merged with defaults on
 * first access so missing fields are always populated.
 *
 * Design constraints:
 *  - Only fields grounded in the real codebase are included.
 *  - No speculative knobs or future-facing flags.
 *  - Extends AppSettings in-file: no separate settings file on disk.
 */

import type { ExecutorId } from './ExecutorRegistry';
import { loadSettings, saveSettings } from '../../settingsStore';

// ─── Shared config (applies to every executor) ────────────────────────────────

export interface SharedExecutorConfig {
  /** Whether this executor is available for selection */
  enabled: boolean;
  /** Display order in settings UI (lower = first) */
  displayOrder: number;
  /**
   * Concurrency policy for same-conversation runs.
   * 'exclusive' = abort any running execution before starting a new one (default).
   * This is enforced per-executor at the ChatIpc dispatch layer.
   */
  sameConversationPolicy: 'exclusive';
  /** Wall-clock timeout in milliseconds (0 = no limit) */
  timeoutMs: number;
}

// ─── agentLoop-specific config ────────────────────────────────────────────────

export interface AgentLoopConfig extends SharedExecutorConfig {
  /** Whether the pipeline orchestrator may be used for routing complex requests */
  pipelineEnabled: boolean;
  /** Maximum number of session turns kept in memory */
  maxSessionTurns: number;
  /** Maximum session turns for app-mapping mode */
  maxMappingSessionTurns: number;
}

// ─── claudeCode-specific config ───────────────────────────────────────────────

export interface ClaudeCodeConfig extends SharedExecutorConfig {
  /**
   * Whether to resume an existing Claude Code session when one is stored.
   * When false, always starts a fresh session.
   */
  resumeSession: boolean;
  /**
   * Whether to pass --dangerously-skip-permissions to the CLI.
   * Derived from unrestrictedMode at runtime — stored here for explicitness.
   */
  skipPermissions: boolean;
}

// ─── codex-specific config ────────────────────────────────────────────────────

export interface CodexConfig extends SharedExecutorConfig {
  /** Whether to resume an existing Codex thread when one is stored */
  resumeThread: boolean;
}

// ─── concurrent-specific config ───────────────────────────────────────────────

export interface ConcurrentConfig extends SharedExecutorConfig {
  /** Strategy for splitting work. 'parallel' sends the same prompt to both. */
  strategy: 'parallel' | 'claude_primary_codex_review';
  /** Whether to run a synthesis LLM call to merge results. */
  synthesize: boolean;
}

// ─── Composite type ───────────────────────────────────────────────────────────

export interface AllExecutorConfigs {
  agentLoop: AgentLoopConfig;
  claudeCode: ClaudeCodeConfig;
  codex: CodexConfig;
  concurrent: ConcurrentConfig;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

function defaultConfigs(): AllExecutorConfigs {
  return {
    agentLoop: {
      enabled: true,
      displayOrder: 0,
      sameConversationPolicy: 'exclusive',
      timeoutMs: 0,
      pipelineEnabled: true,
      maxSessionTurns: 20,
      maxMappingSessionTurns: 6,
    },
    claudeCode: {
      enabled: true,
      displayOrder: 1,
      sameConversationPolicy: 'exclusive',
      timeoutMs: 0,
      resumeSession: true,
      skipPermissions: false,
    },
    codex: {
      enabled: true,
      displayOrder: 2,
      sameConversationPolicy: 'exclusive',
      timeoutMs: 0,
      resumeThread: true,
    },
    concurrent: {
      enabled: false,   // opt-in — requires both CLIs configured
      displayOrder: 3,
      sameConversationPolicy: 'exclusive',
      timeoutMs: 300_000, // 5 min wall clock for both executors + synthesis
      strategy: 'parallel',
      synthesize: true,
    },
  };
}

// ─── Load / save ──────────────────────────────────────────────────────────────

/**
 * Load per-executor config from the shared settings file.
 * Always returns a fully-populated object (merged with defaults).
 */
export function loadExecutorConfigs(): AllExecutorConfigs {
  const settings = loadSettings() as any;
  const stored: Partial<AllExecutorConfigs> = settings.executorConfigs ?? {};
  const defaults = defaultConfigs();
  return {
    agentLoop: { ...defaults.agentLoop, ...stored.agentLoop },
    claudeCode: { ...defaults.claudeCode, ...stored.claudeCode },
    codex: { ...defaults.codex, ...stored.codex },
    concurrent: { ...defaults.concurrent, ...stored.concurrent },
  };
}

/** Load config for a specific executor. */
export function getExecutorConfig(id: ExecutorId): AllExecutorConfigs[typeof id] {
  return loadExecutorConfigs()[id];
}

/** Persist a partial update for a specific executor. */
export function patchExecutorConfig<K extends ExecutorId>(
  id: K,
  patch: Partial<AllExecutorConfigs[K]>,
): void {
  const settings = loadSettings() as any;
  const current = loadExecutorConfigs();
  const updated: AllExecutorConfigs = {
    ...current,
    [id]: { ...current[id], ...patch },
  };
  saveSettings({ ...settings, executorConfigs: updated });
}

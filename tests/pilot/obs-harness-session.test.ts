import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OBSRuntimeState, StepResult } from '../../src/pilot/obs/obs-types';

const workflow = vi.hoisted(() => ({
  runOBSWorkflow: vi.fn(),
}));

vi.mock('../../src/pilot/obs/obs-workflow', () => workflow);

import { runHarness } from '../../src/pilot/obs/obs-harness';

function result(step: string): StepResult {
  return {
    step,
    ok: true,
    confidence: 1,
    retries: 0,
    escalated: false,
    failType: null,
    locatorUsed: 'a11y',
    durationMs: 1,
    workerTokens: 0,
    verifierTokens: 0,
  };
}

describe('runHarness session reuse', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('reuses a single runtime state across runs when enabled', async () => {
    const seen: OBSRuntimeState[] = [];
    workflow.runOBSWorkflow.mockImplementation(async ({ runtimeState }: { runtimeState?: OBSRuntimeState } = {}) => {
      if (runtimeState) {
        runtimeState.obsReady = true;
        runtimeState.knownScenes = ['PilotScene'];
        seen.push(runtimeState);
      }
      return [
        result('launchOBS'),
        result('detectMainWindow'),
        result('createScene'),
        result('selectScene'),
        result('openSettings'),
        result('closeSettings'),
      ];
    });

    await runHarness({ runCount: 2, logPath: '/tmp/obs-harness-session-test.jsonl', reuseSession: true });

    expect(workflow.runOBSWorkflow).toHaveBeenCalledTimes(2);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it('creates a fresh runtime state per run when reuse is disabled', async () => {
    const seen: OBSRuntimeState[] = [];
    workflow.runOBSWorkflow.mockImplementation(async ({ runtimeState }: { runtimeState?: OBSRuntimeState } = {}) => {
      if (runtimeState) seen.push(runtimeState);
      return [
        result('launchOBS'),
        result('detectMainWindow'),
        result('createScene'),
        result('selectScene'),
        result('openSettings'),
        result('closeSettings'),
      ];
    });

    await runHarness({ runCount: 2, logPath: '/tmp/obs-harness-cold-test.jsonl', reuseSession: false });

    expect(workflow.runOBSWorkflow).toHaveBeenCalledTimes(2);
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
  });
});

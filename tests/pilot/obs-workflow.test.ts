import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StepResult } from '../../src/pilot/obs/obs-types';

const adapter = vi.hoisted(() => ({
  launchOBS: vi.fn(),
  detectMainWindow: vi.fn(),
  createScene: vi.fn(),
  selectScene: vi.fn(),
  addSource: vi.fn(),
  setMicMuted: vi.fn(),
  setTransition: vi.fn(),
  openSettings: vi.fn(),
  closeSettings: vi.fn(),
  verifyMainState: vi.fn(),
}));

vi.mock('../../src/pilot/obs/obs-adapter', () => adapter);

import { runOBSWorkflow } from '../../src/pilot/obs/obs-workflow';

function result(step: string, ok: boolean): StepResult {
  return {
    step,
    ok,
    confidence: ok ? 1 : 0,
    retries: 0,
    escalated: false,
    failType: ok ? null : 'verify_failed',
    locatorUsed: 'a11y',
    durationMs: 1,
    workerTokens: 0,
    verifierTokens: 0,
  };
}

describe('runOBSWorkflow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    adapter.launchOBS.mockResolvedValue(result('launchOBS', true));
    adapter.detectMainWindow.mockResolvedValue(result('detectMainWindow', true));
    adapter.createScene.mockResolvedValue(result('createScene', true));
    adapter.selectScene.mockResolvedValue(result('selectScene', true));
    adapter.addSource.mockResolvedValue(result('addSource', true));
    adapter.setMicMuted.mockResolvedValue(result('setMicMuted', true));
    adapter.setTransition.mockResolvedValue(result('setTransition', true));
    adapter.openSettings.mockResolvedValue(result('openSettings', true));
    adapter.closeSettings.mockResolvedValue(result('closeSettings', true));
    adapter.verifyMainState.mockResolvedValue(result('verifyMainState', true));
  });

  it('halts immediately after a failed gate step', async () => {
    adapter.createScene.mockResolvedValue(result('createScene', false));

    const results = await runOBSWorkflow();

    expect(results.map((r) => r.step)).toEqual([
      'launchOBS',
      'detectMainWindow',
      'createScene',
    ]);
    expect(adapter.selectScene).not.toHaveBeenCalled();
    expect(adapter.verifyMainState).not.toHaveBeenCalled();
  });

  it('continues after a non-gate failure', async () => {
    adapter.addSource.mockResolvedValue(result('addSource', false));

    const results = await runOBSWorkflow();

    expect(results).toHaveLength(10);
    expect(adapter.setMicMuted).toHaveBeenCalledOnce();
    expect(adapter.verifyMainState).toHaveBeenCalledOnce();
  });
});

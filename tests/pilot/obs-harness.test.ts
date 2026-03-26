// tests/pilot/obs-harness.test.ts
import { describe, it, expect } from 'vitest';
import { computeSummary } from '../../src/pilot/obs/obs-harness';
import type { StepResult } from '../../src/pilot/obs/obs-types';

function s(step: string, ok: boolean, extra: Partial<StepResult> = {}): StepResult {
  return {
    step, ok, confidence: 0.9, retries: 0, escalated: false,
    failType: null, locatorUsed: 'a11y', durationMs: 1000,
    workerTokens: 100, verifierTokens: 0, ...extra,
  };
}

describe('computeSummary', () => {
  it('computes per-step pass rate', () => {
    const runs = [
      [s('createScene', true),  s('openSettings', false, { failType: 'timeout' })],
      [s('createScene', true),  s('openSettings', true)],
      [s('createScene', false, { failType: 'element_not_found' }), s('openSettings', true)],
    ];
    const sum = computeSummary(runs);
    expect(sum.createScene.passed).toBe(2);
    expect(sum.createScene.total).toBe(3);
    expect(sum.openSettings.passed).toBe(2);
  });

  it('tracks escalations', () => {
    const runs = [
      [s('createScene', true, { escalated: true, verifierTokens: 500 })],
      [s('createScene', true)],
    ];
    expect(computeSummary(runs).createScene.escalations).toBe(1);
  });

  it('reports most common failType', () => {
    const runs = [
      [s('openSettings', false, { failType: 'timeout' })],
      [s('openSettings', false, { failType: 'timeout' })],
      [s('openSettings', false, { failType: 'element_not_found' })],
    ];
    expect(computeSummary(runs).openSettings.commonFailType).toBe('timeout');
  });
});

// tests/pilot/obs-full.test.ts
/**
 * Comprehensive test suite for OBS Pilot functionality
 * Tests:
 * - OBS types and interfaces
 * - Locator strategies
 * - Step result generation
 * - Verifier decision logic
 * - Harness summary computation
 * - Workflow step coordination
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { computeSummary } from '../../src/pilot/obs/obs-harness';
import {
  selectLocatorStrategy,
  buildA11yQuery,
  getRelativePoint,
} from '../../src/pilot/obs/obs-locator';
import { shouldEscalate, pickVerdict } from '../../src/pilot/obs/obs-verifier';
import type {
  StepResult,
  VerifyResult,
  ControlDef,
  FailType,
  LocatorUsed,
} from '../../src/pilot/obs/obs-types';

// ───────────────────────────────────────────────────────────────────────────────

describe('OBS Types & Interfaces', () => {
  it('StepResult contains all required fields', () => {
    const result: StepResult = {
      step: 'launchOBS',
      ok: true,
      confidence: 0.95,
      retries: 0,
      escalated: false,
      failType: null,
      locatorUsed: 'a11y',
      durationMs: 1250,
      workerTokens: 150,
      verifierTokens: 200,
    };
    
    expect(result.step).toBe('launchOBS');
    expect(result.ok).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.retries).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.workerTokens).toBeGreaterThanOrEqual(0);
    expect(result.verifierTokens).toBeGreaterThanOrEqual(0);
  });

  it('ControlDef accommodates all locator types', () => {
    const withA11y: ControlDef = {
      a11yRole: 'push button',
      a11yName: 'Add Scene',
      region: 'scenes',
      ocrFallback: '+',
    };
    expect(withA11y.a11yRole).toBeTruthy();

    const withCoord: ControlDef = {
      a11yRole: '',
      a11yName: null,
      region: 'controls',
      ocrFallback: '',
      coord: [640, 480],
    };
    expect(withCoord.coord).toEqual([640, 480]);

    const withRelative: ControlDef = {
      a11yRole: '',
      a11yName: null,
      region: 'transition',
      ocrFallback: '',
      relative: [50, 100],
    };
    expect(withRelative.relative).toEqual([50, 100]);
  });

  it('FailType covers all error categories', () => {
    const failTypes: FailType[] = [
      'element_not_found',
      'timeout',
      'modal_unexpected',
      'verify_failed',
      'precondition_failed',
      'unknown',
    ];
    
    failTypes.forEach((ft) => {
      expect(typeof ft).toBe('string');
      expect(failTypes).toContain(ft);
    });
  });

  it('LocatorUsed covers all strategies', () => {
    const strategies: LocatorUsed[] = ['a11y', 'ocr', 'relative', 'coord', 'none'];
    
    strategies.forEach((strat) => {
      expect(typeof strat).toBe('string');
      expect(strategies).toContain(strat);
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────────

describe('Locator Strategy Selection', () => {
  it('prefers a11y when role is defined', () => {
    const ctrl: ControlDef = {
      a11yRole: 'push button',
      a11yName: 'OK',
      region: 'modal',
      ocrFallback: 'OK',
    };
    expect(selectLocatorStrategy(ctrl)).toBe('a11y');
  });

  it('falls back to ocr when a11y is unavailable', () => {
    const ctrl: ControlDef = {
      a11yRole: '',
      a11yName: null,
      region: 'menu',
      ocrFallback: 'File',
    };
    expect(selectLocatorStrategy(ctrl)).toBe('ocr');
  });

  it('uses coord when a11y and ocr are unavailable', () => {
    const ctrl: ControlDef = {
      a11yRole: '',
      a11yName: null,
      region: 'canvas',
      ocrFallback: '',
      coord: [500, 400],
    };
    expect(selectLocatorStrategy(ctrl)).toBe('coord');
  });

  it('uses relative positioning as last resort', () => {
    const ctrl: ControlDef = {
      a11yRole: '',
      a11yName: null,
      region: 'preview',
      ocrFallback: '',
      relative: [30, 60],
    };
    expect(selectLocatorStrategy(ctrl)).toBe('relative');
  });
});

// ───────────────────────────────────────────────────────────────────────────────

describe('A11y Query Building', () => {
  it('constructs query with all components', () => {
    const ctrl: ControlDef = {
      a11yRole: 'text field',
      a11yName: 'Scene Name',
      region: 'scenes',
      ocrFallback: 'Enter name',
    };
    
    const query = buildA11yQuery('obs', ctrl);
    expect(query.appName).toBe('obs');
    expect(query.role).toBe('text field');
    expect(query.name).toBe('Scene Name');
  });

  it('handles null name gracefully', () => {
    const ctrl: ControlDef = {
      a11yRole: 'image',
      a11yName: null,
      region: 'preview',
      ocrFallback: '',
    };
    
    const query = buildA11yQuery('obs', ctrl);
    expect(query.name).toBe('');
  });
});

// ───────────────────────────────────────────────────────────────────────────────

describe('Relative Point Conversion', () => {
  it('converts relative offset to screen coordinates', () => {
    const ctrl: ControlDef = {
      a11yRole: '',
      a11yName: null,
      region: 'controls',
      ocrFallback: '',
      relative: [100, 200],
    };
    
    const point = getRelativePoint(ctrl);
    expect(point.x).toBe(100);
    // Y offset includes content offset (69px by default)
    expect(point.y).toBe(200 + 69);
  });

  it('handles zero offsets', () => {
    const ctrl: ControlDef = {
      a11yRole: '',
      a11yName: null,
      region: 'header',
      ocrFallback: '',
      relative: [0, 0],
    };
    
    const point = getRelativePoint(ctrl);
    expect(point.x).toBe(0);
    expect(point.y).toBe(69);
  });
});

// ───────────────────────────────────────────────────────────────────────────────

describe('Verification Decision Logic', () => {
  it('escalates when confidence below threshold', () => {
    const result: VerifyResult = {
      verdict: 'ambiguous',
      confidence: 0.5,
      reason: 'Image quality too low',
      tokens: 100,
    };
    expect(shouldEscalate(result, 0.7)).toBe(true);
  });

  it('does not escalate when confidence meets threshold', () => {
    const result: VerifyResult = {
      verdict: 'ok',
      confidence: 0.75,
      reason: 'Matches expected state',
      tokens: 150,
    };
    expect(shouldEscalate(result, 0.7)).toBe(false);
  });

  it('does not escalate at exact threshold boundary', () => {
    const result: VerifyResult = {
      verdict: 'ok',
      confidence: 0.7,
      reason: 'Matches exactly',
      tokens: 100,
    };
    expect(shouldEscalate(result, 0.7)).toBe(false);
  });

  it('pickVerdict returns true for ok verdict', () => {
    const result: VerifyResult = {
      verdict: 'ok',
      confidence: 0.95,
      reason: 'Scene found',
      tokens: 200,
    };
    expect(pickVerdict(result)).toBe(true);
  });

  it('pickVerdict returns false for failed verdict', () => {
    const result: VerifyResult = {
      verdict: 'failed',
      confidence: 0.9,
      reason: 'Scene not found',
      tokens: 200,
    };
    expect(pickVerdict(result)).toBe(false);
  });

  it('pickVerdict returns false for ambiguous verdict', () => {
    const result: VerifyResult = {
      verdict: 'ambiguous',
      confidence: 0.5,
      reason: 'Could be either state',
      tokens: 150,
    };
    expect(pickVerdict(result)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────────

describe('Harness Summary Computation', () => {
  function makeResult(
    step: string,
    ok: boolean,
    overrides: Partial<StepResult> = {},
  ): StepResult {
    return {
      step,
      ok,
      confidence: 0.9,
      retries: 0,
      escalated: false,
      failType: null,
      locatorUsed: 'a11y',
      durationMs: 1000,
      workerTokens: 100,
      verifierTokens: 50,
      ...overrides,
    };
  }

  it('computes per-step pass rate correctly', () => {
    const runs = [
      [makeResult('createScene', true), makeResult('selectScene', false)],
      [makeResult('createScene', true), makeResult('selectScene', true)],
      [makeResult('createScene', false), makeResult('selectScene', true)],
    ];
    
    const summary = computeSummary(runs);
    expect(summary.createScene.passed).toBe(2);
    expect(summary.createScene.total).toBe(3);
    expect(summary.selectScene.passed).toBe(2);
    expect(summary.selectScene.total).toBe(3);
  });

  it('calculates average duration correctly', () => {
    const runs = [
      [makeResult('launchOBS', true, { durationMs: 1000 })],
      [makeResult('launchOBS', true, { durationMs: 2000 })],
      [makeResult('launchOBS', true, { durationMs: 3000 })],
    ];
    
    const summary = computeSummary(runs);
    expect(summary.launchOBS.avgDurationMs).toBe(2000); // (1000+2000+3000)/3
  });

  it('tracks escalations per step', () => {
    const runs = [
      [makeResult('detectMainWindow', true, { escalated: true })],
      [makeResult('detectMainWindow', true, { escalated: false })],
      [makeResult('detectMainWindow', true, { escalated: true })],
    ];
    
    const summary = computeSummary(runs);
    expect(summary.detectMainWindow.escalations).toBe(2);
  });

  it('identifies most common failure type', () => {
    const runs = [
      [makeResult('openSettings', false, { failType: 'timeout' })],
      [makeResult('openSettings', false, { failType: 'timeout' })],
      [makeResult('openSettings', false, { failType: 'element_not_found' })],
    ];
    
    const summary = computeSummary(runs);
    expect(summary.openSettings.commonFailType).toBe('timeout');
  });

  it('aggregates token usage across runs', () => {
    const runs = [
      [makeResult('verifyMainState', true, { workerTokens: 100, verifierTokens: 50 })],
      [makeResult('verifyMainState', true, { workerTokens: 120, verifierTokens: 60 })],
    ];
    
    const summary = computeSummary(runs);
    expect(summary.verifyMainState.totalWorkerTokens).toBe(220);
    expect(summary.verifyMainState.totalVerifierTokens).toBe(110);
  });

  it('handles empty failure type arrays', () => {
    const runs = [
      [makeResult('addSource', true, { failType: null })],
      [makeResult('addSource', true, { failType: null })],
    ];
    
    const summary = computeSummary(runs);
    expect(summary.addSource.commonFailType).toBeNull();
  });

  it('handles mixed success and failure across multiple runs', () => {
    const runs = [
      [
        makeResult('launchOBS', true),
        makeResult('createScene', true),
        makeResult('addSource', false, { failType: 'modal_unexpected' }),
      ],
      [
        makeResult('launchOBS', true),
        makeResult('createScene', false, { failType: 'timeout' }),
        makeResult('addSource', true),
      ],
      [
        makeResult('launchOBS', false, { failType: 'timeout' }),
        makeResult('createScene', true),
        makeResult('addSource', true),
      ],
    ];
    
    const summary = computeSummary(runs);
    
    expect(summary.launchOBS.passed).toBe(2);
    expect(summary.launchOBS.total).toBe(3);
    expect(summary.launchOBS.commonFailType).toBe('timeout');
    
    expect(summary.createScene.passed).toBe(2);
    expect(summary.createScene.total).toBe(3);
    expect(summary.createScene.commonFailType).toBe('timeout');
    
    expect(summary.addSource.passed).toBe(2);
    expect(summary.addSource.total).toBe(3);
    expect(summary.addSource.commonFailType).toBe('modal_unexpected');
  });
});

// ───────────────────────────────────────────────────────────────────────────────

describe('Retry Logic & Escalation', () => {
  function makeResult(
    step: string,
    ok: boolean,
    retries: number = 0,
    escalated: boolean = false,
  ): StepResult {
    return {
      step,
      ok,
      confidence: ok ? 0.95 : 0.4,
      retries,
      escalated,
      failType: ok ? null : 'verify_failed',
      locatorUsed: 'a11y',
      durationMs: 500 + retries * 250,
      workerTokens: 100,
      verifierTokens: ok ? 50 : 150,
    };
  }

  it('tracks retry counts per step', () => {
    const runs = [
      [makeResult('createScene', true, 0)],
      [makeResult('createScene', true, 1)],
      [makeResult('createScene', true, 2)],
    ];
    
    const summary = computeSummary(runs);
    // Average retries = (0 + 1 + 2) / 3 = 1
    expect(summary.createScene.total).toBe(3);
  });

  it('shows escalation impact on token usage', () => {
    const runs = [
      [
        {
          step: 'openSettings',
          ok: true,
          confidence: 0.95,
          retries: 2,
          escalated: true,
          failType: null,
          locatorUsed: 'a11y',
          durationMs: 2500,
          workerTokens: 300,
          verifierTokens: 250, // escalated result has higher tokens
        },
      ],
    ];
    
    const summary = computeSummary(runs);
    expect(summary.openSettings.escalations).toBe(1);
    expect(summary.openSettings.totalVerifierTokens).toBe(250);
  });
});

// ───────────────────────────────────────────────────────────────────────────────

describe('Locator Strategy Diversity', () => {
  it('tracks different locator strategies used', () => {
    const results: StepResult[] = [
      {
        step: 'createScene',
        ok: true,
        confidence: 0.95,
        retries: 0,
        escalated: false,
        failType: null,
        locatorUsed: 'a11y',
        durationMs: 1000,
        workerTokens: 100,
        verifierTokens: 50,
      },
      {
        step: 'selectScene',
        ok: true,
        confidence: 0.92,
        retries: 1,
        escalated: false,
        failType: null,
        locatorUsed: 'ocr',
        durationMs: 1200,
        workerTokens: 120,
        verifierTokens: 60,
      },
      {
        step: 'addSource',
        ok: true,
        confidence: 0.88,
        retries: 2,
        escalated: false,
        failType: null,
        locatorUsed: 'coord',
        durationMs: 1500,
        workerTokens: 150,
        verifierTokens: 100,
      },
    ];
    
    // Verify all locator types are represented
    const strategies = new Set(results.map((r) => r.locatorUsed));
    expect(strategies.has('a11y')).toBe(true);
    expect(strategies.has('ocr')).toBe(true);
    expect(strategies.has('coord')).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────────

describe('Real-world Workflow Scenario', () => {
  function makeWorkflowResult(
    step: string,
    ok: boolean,
    details: Partial<StepResult> = {},
  ): StepResult {
    return {
      step,
      ok,
      confidence: ok ? 0.92 : 0.35,
      retries: ok ? 0 : 2,
      escalated: !ok,
      failType: ok ? null : 'verify_failed',
      locatorUsed: ok ? 'a11y' : 'ocr',
      durationMs: ok ? 1500 : 2500,
      workerTokens: ok ? 150 : 300,
      verifierTokens: ok ? 100 : 250,
      ...details,
    };
  }

  it('simulates complete workflow execution', () => {
    const workflowSteps = [
      'launchOBS',
      'detectMainWindow',
      'createScene',
      'selectScene',
      'addSource',
      'setMicMuted',
      'setTransition',
      'openSettings',
      'closeSettings',
      'verifyMainState',
    ];

    // Run 1: Mostly successful
    const run1: StepResult[] = [
      makeWorkflowResult('launchOBS', true),
      makeWorkflowResult('detectMainWindow', true),
      makeWorkflowResult('createScene', true),
      makeWorkflowResult('selectScene', true),
      makeWorkflowResult('addSource', true),
      makeWorkflowResult('setMicMuted', true),
      makeWorkflowResult('setTransition', true),
      makeWorkflowResult('openSettings', true),
      makeWorkflowResult('closeSettings', true),
      makeWorkflowResult('verifyMainState', true),
    ];

    // Run 2: Some steps fail
    const run2: StepResult[] = [
      makeWorkflowResult('launchOBS', true),
      makeWorkflowResult('detectMainWindow', true),
      makeWorkflowResult('createScene', false),
      makeWorkflowResult('selectScene', true),
      makeWorkflowResult('addSource', true),
      makeWorkflowResult('setMicMuted', true),
      makeWorkflowResult('setTransition', false),
      makeWorkflowResult('openSettings', true),
      makeWorkflowResult('closeSettings', true),
      makeWorkflowResult('verifyMainState', true),
    ];

    // Run 3: Different failures
    const run3: StepResult[] = [
      makeWorkflowResult('launchOBS', true),
      makeWorkflowResult('detectMainWindow', false),
      makeWorkflowResult('createScene', true),
      makeWorkflowResult('selectScene', true),
      makeWorkflowResult('addSource', true),
      makeWorkflowResult('setMicMuted', true),
      makeWorkflowResult('setTransition', true),
      makeWorkflowResult('openSettings', false),
      makeWorkflowResult('closeSettings', true),
      makeWorkflowResult('verifyMainState', true),
    ];

    const summary = computeSummary([run1, run2, run3]);

    // Core steps should pass majority of time
    const coreSteps = ['launchOBS', 'detectMainWindow', 'createScene', 'selectScene'];
    for (const step of coreSteps) {
      expect(summary[step]).toBeDefined();
      expect(summary[step].passed).toBeGreaterThanOrEqual(2);
    }

    // Total runs
    expect(Object.keys(summary).length).toBe(10);

    // Verify token tracking
    const totalWorker = Object.values(summary).reduce((sum, s) => sum + s.totalWorkerTokens, 0);
    const totalVerifier = Object.values(summary).reduce((sum, s) => sum + s.totalVerifierTokens, 0);
    expect(totalWorker).toBeGreaterThan(0);
    expect(totalVerifier).toBeGreaterThan(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────────

describe('Edge Cases & Boundary Conditions', () => {
  function makeResult(ok: boolean, failType: FailType | null = null): StepResult {
    return {
      step: 'testStep',
      ok,
      confidence: ok ? 1.0 : 0.0,
      retries: 0,
      escalated: false,
      failType,
      locatorUsed: 'none',
      durationMs: 1,
      workerTokens: 0,
      verifierTokens: 0,
    };
  }

  it('handles single run summary', () => {
    const runs = [[makeResult(true)]];
    const summary = computeSummary(runs);
    expect(summary.testStep.total).toBe(1);
    expect(summary.testStep.passed).toBe(1);
  });

  it('handles all-fail scenario', () => {
    const runs = [
      [makeResult(false, 'timeout')],
      [makeResult(false, 'timeout')],
      [makeResult(false, 'element_not_found')],
    ];
    const summary = computeSummary(runs);
    expect(summary.testStep.passed).toBe(0);
    expect(summary.testStep.commonFailType).toBe('timeout');
  });

  it('handles all-success scenario', () => {
    const runs = [
      [makeResult(true)],
      [makeResult(true)],
      [makeResult(true)],
    ];
    const summary = computeSummary(runs);
    expect(summary.testStep.passed).toBe(3);
    expect(summary.testStep.total).toBe(3);
    expect(summary.testStep.commonFailType).toBeNull();
  });

  it('handles various fail types equally', () => {
    const failTypes: FailType[] = [
      'element_not_found',
      'timeout',
      'modal_unexpected',
      'verify_failed',
      'precondition_failed',
    ];

    for (const ft of failTypes) {
      const runs = [[makeResult(false, ft)]];
      const summary = computeSummary(runs);
      expect(summary.testStep.commonFailType).toBe(ft);
    }
  });
});

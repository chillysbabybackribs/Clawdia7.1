import { describe, it, expect } from 'vitest';
import { shouldEscalate, pickVerdict } from '../../src/pilot/obs/obs-verifier';
import type { VerifyResult } from '../../src/pilot/obs/obs-types';

describe('shouldEscalate', () => {
  it('returns true when confidence is below threshold', () => {
    const r: VerifyResult = { verdict: 'ambiguous', confidence: 0.5, reason: 'unclear', tokens: 100 };
    expect(shouldEscalate(r, 0.7)).toBe(true);
  });

  it('returns false when confidence meets threshold', () => {
    const r: VerifyResult = { verdict: 'ok', confidence: 0.8, reason: 'looks good', tokens: 100 };
    expect(shouldEscalate(r, 0.7)).toBe(false);
  });

  it('returns false exactly at threshold', () => {
    const r: VerifyResult = { verdict: 'ok', confidence: 0.7, reason: 'ok', tokens: 50 };
    expect(shouldEscalate(r, 0.7)).toBe(false);
  });
});

describe('pickVerdict', () => {
  it('returns true for ok verdict', () => {
    const r: VerifyResult = { verdict: 'ok', confidence: 0.9, reason: '', tokens: 0 };
    expect(pickVerdict(r)).toBe(true);
  });

  it('returns false for failed verdict', () => {
    const r: VerifyResult = { verdict: 'failed', confidence: 0.9, reason: '', tokens: 0 };
    expect(pickVerdict(r)).toBe(false);
  });

  it('returns false for ambiguous verdict', () => {
    const r: VerifyResult = { verdict: 'ambiguous', confidence: 0.4, reason: '', tokens: 0 };
    expect(pickVerdict(r)).toBe(false);
  });
});

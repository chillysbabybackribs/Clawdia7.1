import { describe, expect, it } from 'vitest';

import { classify } from '../../../src/main/agent/classify';

describe('classify', () => {
  it('routes generic research requests to the browser profile', () => {
    const result = classify('can you research AI');
    expect(result.toolGroup).toBe('browser');
    expect(result.modelTier).toBe('powerful');
  });

  it('keeps coding requests on the coding profile', () => {
    const result = classify('debug this typescript test failure');
    expect(result.toolGroup).toBe('coding');
  });
});

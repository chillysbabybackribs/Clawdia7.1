import { describe, expect, it } from 'vitest';

import { classify } from '../../../src/main/agent/classify';

describe('classify', () => {
  it('routes ambiguous research to full (safe fallback with search_tools)', () => {
    const result = classify('can you research AI');
    expect(result.toolGroup).toBe('full');
  });

  it('routes explicit web research to browser', () => {
    const result = classify('research this topic online');
    expect(result.toolGroup).toBe('browser');
    expect(result.modelTier).toBe('powerful');
  });

  it('keeps coding requests on the coding profile', () => {
    const result = classify('debug this typescript test failure');
    expect(result.toolGroup).toBe('coding');
  });
});

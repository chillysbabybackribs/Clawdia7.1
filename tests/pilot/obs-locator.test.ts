// tests/pilot/obs-locator.test.ts
import { describe, it, expect } from 'vitest';
import { selectLocatorStrategy, buildA11yQuery, getRelativePoint } from '../../src/pilot/obs/obs-locator';
import type { ControlDef } from '../../src/pilot/obs/obs-types';

describe('selectLocatorStrategy', () => {
  it('returns a11y when a11yRole is set', () => {
    const ctrl: ControlDef = { a11yRole: 'push button', a11yName: 'Add', region: 'scenes', ocrFallback: '+' };
    expect(selectLocatorStrategy(ctrl)).toBe('a11y');
  });

  it('returns ocr when a11yRole is empty string', () => {
    const ctrl: ControlDef = { a11yRole: '', a11yName: null, region: 'scenes', ocrFallback: '+' };
    expect(selectLocatorStrategy(ctrl)).toBe('ocr');
  });

  it('returns relative when a11y and ocr are unavailable', () => {
    const ctrl: ControlDef = {
      a11yRole: '',
      a11yName: null,
      region: 'controls',
      ocrFallback: '',
      relative: [10, 20],
    };
    expect(selectLocatorStrategy(ctrl)).toBe('relative');
  });
});

describe('buildA11yQuery', () => {
  it('builds query with name', () => {
    const ctrl: ControlDef = { a11yRole: 'push button', a11yName: 'Add', region: 'scenes', ocrFallback: '+' };
    const q = buildA11yQuery('obs', ctrl);
    expect(q.appName).toBe('obs');
    expect(q.role).toBe('push button');
    expect(q.name).toBe('Add');
  });

  it('uses empty string for null name', () => {
    const ctrl: ControlDef = { a11yRole: 'text', a11yName: null, region: 'addScene', ocrFallback: '' };
    const q = buildA11yQuery('obs', ctrl);
    expect(q.name).toBe('');
  });
});

describe('getRelativePoint', () => {
  it('converts a relative point into screen coordinates', () => {
    const ctrl: ControlDef = {
      a11yRole: '',
      a11yName: null,
      region: 'controls',
      ocrFallback: '',
      relative: [100, 200],
    };
    expect(getRelativePoint(ctrl)).toEqual({ x: 100, y: 269 });
  });
});

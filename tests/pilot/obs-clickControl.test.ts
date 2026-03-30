import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlDef } from '../../src/pilot/obs/obs-types';

const deps = vi.hoisted(() => ({
  executeGuiInteract: vi.fn(),
  captureScreen: vi.fn(),
  runOcr: vi.fn(),
  a11yDoAction: vi.fn(),
  wait: vi.fn(),
}));

vi.mock('../../src/main/core/desktop', () => ({
  executeGuiInteract: deps.executeGuiInteract,
}));

vi.mock('../../src/main/core/desktop/screenshot', () => ({
  captureScreen: deps.captureScreen,
  runOcr: deps.runOcr,
}));

vi.mock('../../src/main/core/desktop/a11y', () => ({
  a11yDoAction: deps.a11yDoAction,
}));

vi.mock('../../src/main/core/desktop/shared', () => ({
  wait: deps.wait,
}));

import { clickControl } from '../../src/pilot/obs/obs-locator';

describe('clickControl', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    deps.a11yDoAction.mockResolvedValue({ success: false });
    deps.captureScreen.mockResolvedValue({ path: '/tmp/test.png' });
    deps.runOcr.mockResolvedValue({ targets: [], rawText: '', summary: '' });
    deps.executeGuiInteract.mockResolvedValue('ok');
    deps.wait.mockResolvedValue(undefined);
  });

  it('skips OCR for single-character fallbacks and clicks coordinates directly', async () => {
    const ctrl: ControlDef = {
      a11yRole: '',
      a11yName: null,
      region: 'scenes',
      ocrFallback: '+',
      coord: [22, 1033],
    };

    const result = await clickControl(ctrl);

    expect(result).toEqual({ ok: true, strategy: 'coord' });
    expect(deps.captureScreen).not.toHaveBeenCalled();
    expect(deps.runOcr).not.toHaveBeenCalled();
    expect(deps.executeGuiInteract).toHaveBeenCalledWith({ action: 'click', x: 22, y: 1033 });
  });

  it('uses relative coordinates when no other locator works', async () => {
    const ctrl: ControlDef = {
      a11yRole: '',
      a11yName: null,
      region: 'controls',
      ocrFallback: '',
      relative: [100, 200],
    };

    const result = await clickControl(ctrl);

    expect(result).toEqual({ ok: true, strategy: 'relative' });
    expect(deps.executeGuiInteract).toHaveBeenCalledWith({ action: 'click', x: 100, y: 269 });
  });
});

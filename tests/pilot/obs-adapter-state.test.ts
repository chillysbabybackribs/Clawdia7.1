import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  executeGuiInteract: vi.fn(),
  a11yFind: vi.fn(),
  a11yDoAction: vi.fn(),
  a11yGetTree: vi.fn(),
  a11ySetValue: vi.fn(),
  wait: vi.fn(),
  run: vi.fn(),
  verify: vi.fn(),
  clickControl: vi.fn(),
  screenshotBase64: vi.fn(),
}));

vi.mock('../../src/main/core/desktop', () => ({
  executeGuiInteract: deps.executeGuiInteract,
}));

vi.mock('../../src/main/core/desktop/a11y', () => ({
  a11yFind: deps.a11yFind,
  a11yDoAction: deps.a11yDoAction,
  a11yGetTree: deps.a11yGetTree,
  a11ySetValue: deps.a11ySetValue,
}));

vi.mock('../../src/main/core/desktop/shared', () => ({
  wait: deps.wait,
  run: deps.run,
}));

vi.mock('../../src/pilot/obs/obs-verifier', () => ({
  verify: deps.verify,
}));

vi.mock('../../src/pilot/obs/obs-locator', () => ({
  clickControl: deps.clickControl,
  screenshotBase64: deps.screenshotBase64,
}));

import {
  addSource,
  createScene,
  launchOBS,
  openSettings,
  setMicMuted,
  setTransition,
} from '../../src/pilot/obs/obs-adapter';
import { createOBSRuntimeState } from '../../src/pilot/obs/obs-state';

describe('obs adapter runtime-state skips', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('skips launch when OBS is already marked ready', async () => {
    const state = createOBSRuntimeState();
    state.obsReady = true;

    const result = await launchOBS(state);

    expect(result.ok).toBe(true);
    expect(result.step).toBe('launchOBS');
    expect(result.locatorUsed).toBe('none');
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.executeGuiInteract).not.toHaveBeenCalled();
  });

  it('skips createScene when the scene is already known', async () => {
    const state = createOBSRuntimeState();
    state.knownScenes = ['PilotScene'];

    const result = await createScene('PilotScene', state);

    expect(result.ok).toBe(true);
    expect(result.step).toBe('createScene');
    expect(state.currentScene).toBe('PilotScene');
    expect(deps.clickControl).not.toHaveBeenCalled();
  });

  it('treats an already-existing OBS scene as success even with fresh runtime state', async () => {
    const state = createOBSRuntimeState();
    deps.a11yFind.mockResolvedValue({ found: true, ambiguous: false, match: { name: 'PilotScene' } });

    const result = await createScene('PilotScene', state);

    expect(result.ok).toBe(true);
    expect(result.step).toBe('createScene');
    expect(result.locatorUsed).toBe('a11y');
    expect(state.currentScene).toBe('PilotScene');
    expect(state.knownScenes).toContain('PilotScene');
    expect(deps.clickControl).not.toHaveBeenCalled();
  });

  it('treats an already-existing OBS source as success even with fresh runtime state', async () => {
    const state = createOBSRuntimeState();
    deps.a11yFind.mockResolvedValue({ found: true, ambiguous: false, match: { name: 'PilotScreen' } });

    const result = await addSource('monitor_capture', 'PilotScreen', state);

    expect(result.ok).toBe(true);
    expect(result.step).toBe('addSource');
    expect(result.locatorUsed).toBe('a11y');
    expect(state.knownSources).toContain('PilotScreen');
    expect(deps.clickControl).not.toHaveBeenCalled();
    expect(deps.a11yDoAction).not.toHaveBeenCalled();
  });

  it('skips control mutations when runtime state already matches', async () => {
    const state = createOBSRuntimeState();
    state.settingsOpen = true;
    state.micMuted = true;
    state.transitionName = 'Fade';

    const [settings, muted, transition] = await Promise.all([
      openSettings(state),
      setMicMuted(true, state),
      setTransition('Fade', state),
    ]);

    expect(settings.locatorUsed).toBe('none');
    expect(muted.locatorUsed).toBe('none');
    expect(transition.locatorUsed).toBe('none');
    expect(deps.clickControl).not.toHaveBeenCalled();
    expect(deps.a11yFind).not.toHaveBeenCalled();
    expect(deps.a11ySetValue).not.toHaveBeenCalled();
  });
});

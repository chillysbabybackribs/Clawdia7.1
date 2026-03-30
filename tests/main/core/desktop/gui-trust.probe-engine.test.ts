import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  executeGuiInteract: vi.fn(),
  captureGuiStateFingerprint: vi.fn(),
  wait: vi.fn(),
}));

vi.mock('../../../../src/main/core/desktop/guiExecutor', () => ({
  executeGuiInteract: deps.executeGuiInteract,
}));

vi.mock('../../../../src/main/core/desktop/gui-trust/state-fingerprint', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/main/core/desktop/gui-trust/state-fingerprint')>(
    '../../../../src/main/core/desktop/gui-trust/state-fingerprint',
  );
  return {
    ...actual,
    captureGuiStateFingerprint: deps.captureGuiStateFingerprint,
  };
});

vi.mock('../../../../src/main/core/desktop/shared', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/main/core/desktop/shared')>(
    '../../../../src/main/core/desktop/shared',
  );
  return {
    ...actual,
    wait: deps.wait,
  };
});

import { createEmptyGuiTrustGraph, probeGuiElement } from '../../../../src/main/core/desktop/gui-trust';

describe('gui-trust probe engine', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    deps.executeGuiInteract.mockResolvedValue('Clicked');
    deps.captureGuiStateFingerprint.mockResolvedValue({
      stateId: 'state-after',
      appId: 'gimp',
      createdAt: '2026-03-28T12:01:00.000Z',
      monitor: { name: 'eDP', width: 1920, height: 1080, originX: 0, originY: 0 },
      windowBounds: { x: 0, y: 0, width: 800, height: 600 },
      windowTitle: 'GIMP',
      screenshotPath: '/tmp/after.png',
      screenshotHash: 'after',
      perceptualHash: 'after',
      ocrSummary: ['File menu open'],
      visibleRegionHash: ['after'],
    });
    deps.wait.mockResolvedValue(undefined);
  });

  it('executes a safe probe, verifies a state transition, and records a trust edge', async () => {
    const graph = createEmptyGuiTrustGraph('gimp');
    const session = {
      sessionId: 'session-1',
      app: {
        appId: 'gimp',
        displayName: 'GIMP',
        windowMatchers: ['GIMP'],
        baselineLayout: 'maximized',
        monitorPolicy: 'lock-discovered',
        probePolicyId: 'safe-default',
      },
      createdAt: '2026-03-28T12:00:00.000Z',
      updatedAt: '2026-03-28T12:00:00.000Z',
      monitor: { name: 'eDP', width: 1920, height: 1080, originX: 0, originY: 0 },
      window: {
        windowTitle: 'GIMP',
        appName: 'gimp',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      },
      artifactRoot: '/tmp/gui-trust',
    };
    const beforeState = {
      stateId: 'state-before',
      appId: 'gimp',
      createdAt: '2026-03-28T12:00:00.000Z',
      monitor: { name: 'eDP', width: 1920, height: 1080, originX: 0, originY: 0 },
      windowBounds: { x: 0, y: 0, width: 800, height: 600 },
      windowTitle: 'GIMP',
      screenshotPath: '/tmp/before.png',
      screenshotHash: 'before',
      perceptualHash: 'before',
      ocrSummary: ['File Edit View'],
      visibleRegionHash: ['before'],
    };
    const element = {
      elementId: 'menu-file',
      stateId: 'state-before',
      role: 'menu_item' as const,
      label: 'File',
      bbox: { x: 5, y: 10, width: 30, height: 16 },
      center: { x: 20, y: 18 },
      confidence: 0.84,
      interactableScore: 0.9,
      enabledGuess: true,
      selectedGuess: null,
      anchors: { absolute: { x: 20, y: 18 } },
      neighbors: [],
    };

    const result = await probeGuiElement(session, graph, {
      state: beforeState,
      element,
      expectedSurface: 'menu',
    });

    expect(result.ok).toBe(true);
    expect(result.edge?.successCount).toBe(1);
    expect(graph.edges).toHaveLength(1);
    expect(graph.states.some((state) => state.stateId === 'state-after')).toBe(true);
    expect(deps.executeGuiInteract).toHaveBeenCalledWith(expect.objectContaining({
      action: 'click',
      x: 20,
      y: 18,
      window: 'GIMP',
    }));
  });

  it('skips cautious probes according to the current risk policy', async () => {
    const graph = createEmptyGuiTrustGraph('gimp');
    const session = {
      sessionId: 'session-1',
      app: {
        appId: 'gimp',
        displayName: 'GIMP',
        windowMatchers: ['GIMP'],
        baselineLayout: 'maximized',
        monitorPolicy: 'lock-discovered',
        probePolicyId: 'safe-default',
      },
      createdAt: '2026-03-28T12:00:00.000Z',
      updatedAt: '2026-03-28T12:00:00.000Z',
      monitor: { name: 'eDP', width: 1920, height: 1080, originX: 0, originY: 0 },
      artifactRoot: '/tmp/gui-trust',
    };
    const beforeState = {
      stateId: 'state-before',
      appId: 'gimp',
      createdAt: '2026-03-28T12:00:00.000Z',
      monitor: { name: 'eDP', width: 1920, height: 1080, originX: 0, originY: 0 },
      windowBounds: { x: 0, y: 0, width: 800, height: 600 },
      windowTitle: 'GIMP',
      screenshotPath: '/tmp/before.png',
      screenshotHash: 'before',
      perceptualHash: 'before',
      ocrSummary: ['Save As'],
      visibleRegionHash: ['before'],
    };
    const element = {
      elementId: 'save-as',
      stateId: 'state-before',
      role: 'button' as const,
      label: 'Save As',
      bbox: { x: 100, y: 200, width: 60, height: 20 },
      center: { x: 130, y: 210 },
      confidence: 0.8,
      interactableScore: 0.9,
      enabledGuess: true,
      selectedGuess: null,
      anchors: { absolute: { x: 130, y: 210 } },
      neighbors: [],
    };

    const result = await probeGuiElement(session, graph, {
      state: beforeState,
      element,
    });

    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.riskLevel).toBe('cautious');
    expect(deps.executeGuiInteract).not.toHaveBeenCalled();
  });
});

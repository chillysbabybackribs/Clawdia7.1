import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  inferGuiElements: vi.fn(),
  probeGuiElement: vi.fn(),
  executeGuiInteract: vi.fn(),
}));

vi.mock('../../../../src/main/core/desktop/gui-trust/element-inference', () => ({
  inferGuiElements: deps.inferGuiElements,
}));

vi.mock('../../../../src/main/core/desktop/gui-trust/probe-engine', () => ({
  probeGuiElement: deps.probeGuiElement,
}));

vi.mock('../../../../src/main/core/desktop/guiExecutor', () => ({
  executeGuiInteract: deps.executeGuiInteract,
}));

import { createEmptyGuiTrustGraph, crawlTrustedSurfaces } from '../../../../src/main/core/desktop/gui-trust';

describe('gui-trust crawler', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    deps.executeGuiInteract.mockResolvedValue('Key: Escape');
  });

  it('crawls a top-level state, probes safe elements, and descends into child surfaces', async () => {
    const startState = {
      stateId: 'state-root',
      appId: 'gimp',
      createdAt: '2026-03-28T12:00:00.000Z',
      monitor: { name: 'eDP', width: 1920, height: 1080, originX: 0, originY: 0 },
      windowBounds: { x: 0, y: 0, width: 800, height: 600 },
      windowTitle: 'GIMP',
      screenshotPath: '/tmp/root.png',
      screenshotHash: 'root',
      perceptualHash: 'root',
      ocrSummary: ['File Edit View'],
      visibleRegionHash: ['root'],
    };
    const childState = {
      stateId: 'state-menu',
      appId: 'gimp',
      createdAt: '2026-03-28T12:00:01.000Z',
      monitor: { name: 'eDP', width: 1920, height: 1080, originX: 0, originY: 0 },
      windowBounds: { x: 0, y: 0, width: 800, height: 600 },
      windowTitle: 'GIMP',
      screenshotPath: '/tmp/menu.png',
      screenshotHash: 'menu',
      perceptualHash: 'menu',
      ocrSummary: ['Open Save Export'],
      visibleRegionHash: ['menu'],
    };

    deps.inferGuiElements
      .mockResolvedValueOnce([
        {
          elementId: 'menu-file',
          stateId: 'state-root',
          role: 'menu_item',
          label: 'File',
          bbox: { x: 5, y: 10, width: 30, height: 16 },
          center: { x: 20, y: 18 },
          confidence: 0.84,
          interactableScore: 0.9,
          enabledGuess: true,
          selectedGuess: null,
          anchors: { absolute: { x: 20, y: 18 } },
          neighbors: [],
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          elementId: 'menu-open',
          stateId: 'state-menu',
          role: 'menu_item',
          label: 'Open',
          bbox: { x: 20, y: 45, width: 40, height: 16 },
          center: { x: 40, y: 53 },
          confidence: 0.84,
          interactableScore: 0.9,
          enabledGuess: true,
          selectedGuess: null,
          anchors: { absolute: { x: 40, y: 53 } },
          neighbors: [],
        },
      ])
      .mockResolvedValueOnce([]);

    deps.probeGuiElement
      .mockResolvedValueOnce({
        ok: true,
        action: 'click',
        expectedSurface: 'menu',
        riskLevel: 'safe',
        verify: { ok: true, method: 'state_diff', evidence: ['menu opened'] },
        beforeState: startState,
        afterState: childState,
        edge: {
          edgeId: 'edge-file',
          sourceStateId: 'state-root',
          sourceElementId: 'menu-file',
          action: 'click',
          expectedSurface: 'menu',
          targetStateId: 'state-menu',
          verificationMode: 'state_diff',
          successCount: 1,
          failureCount: 0,
          trustScore: 0.6,
          riskLevel: 'safe',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        action: 'click',
        expectedSurface: 'same_state',
        riskLevel: 'safe',
        verify: { ok: true, method: 'state_diff', evidence: ['selection changed'] },
        beforeState: childState,
        afterState: {
          ...childState,
          stateId: 'state-open-highlight',
          perceptualHash: 'open-highlight',
        },
        edge: {
          edgeId: 'edge-open',
          sourceStateId: 'state-menu',
          sourceElementId: 'menu-open',
          action: 'click',
          expectedSurface: 'same_state',
          targetStateId: 'state-open-highlight',
          verificationMode: 'state_diff',
          successCount: 1,
          failureCount: 0,
          trustScore: 0.6,
          riskLevel: 'safe',
        },
      });

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

    const report = await crawlTrustedSurfaces(session, graph, {
      startState,
      maxDepth: 1,
      maxElementsPerState: 5,
    });

    expect(report.ok).toBe(true);
    expect(report.visitedStateIds).toEqual(expect.arrayContaining(['state-root', 'state-menu']));
    expect(report.probedElementIds).toEqual(expect.arrayContaining(['menu-file', 'menu-open']));
    expect(report.edgeIds).toEqual(expect.arrayContaining(['edge-file', 'edge-open']));
    expect(graph.elements.some((element) => element.elementId === 'menu-open')).toBe(true);
  });
});

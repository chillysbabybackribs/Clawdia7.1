import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OcrResult } from '../../../../src/main/core/desktop/screenshot';
import type { GuiTrustGraph } from '../../../../src/main/core/desktop/gui-trust';

const { runOcrMock } = vi.hoisted(() => ({
  runOcrMock: vi.fn<(_: string, __?: string) => Promise<OcrResult | null>>(),
}));

vi.mock('../../../../src/main/core/desktop/screenshot', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/main/core/desktop/screenshot')>(
    '../../../../src/main/core/desktop/screenshot',
  );
  return {
    ...actual,
    runOcr: runOcrMock,
  };
});

import { inferGuiElements } from '../../../../src/main/core/desktop/gui-trust';

describe('gui-trust element inference', () => {
  beforeEach(() => {
    runOcrMock.mockReset();
  });

  it('splits a menu row into individual menu-item candidates', async () => {
    runOcrMock.mockResolvedValue({
      summary: '',
      rawText: 'File Edit View Help',
      targets: [],
      words: [
        { label: 'File', x: 20, y: 20, bbox: { x: 5, y: 12, width: 28, height: 16 } },
        { label: 'Edit', x: 60, y: 20, bbox: { x: 45, y: 12, width: 30, height: 16 } },
        { label: 'View', x: 104, y: 20, bbox: { x: 88, y: 12, width: 32, height: 16 } },
        { label: 'Help', x: 149, y: 20, bbox: { x: 133, y: 12, width: 32, height: 16 } },
      ],
    });

    const state = {
      stateId: 'state-1',
      appId: 'gimp',
      createdAt: '2026-03-28T12:00:00.000Z',
      monitor: { name: 'eDP', width: 1920, height: 1080, originX: 0, originY: 0 },
      windowBounds: { x: 0, y: 0, width: 800, height: 600 },
      windowTitle: 'GIMP',
      screenshotPath: '/tmp/fake.png',
      screenshotHash: '',
      perceptualHash: '',
      ocrSummary: [],
      visibleRegionHash: [],
    };

    const elements = await inferGuiElements(state);
    const labels = elements.filter((element) => element.role === 'menu_item').map((element) => element.label);

    expect(labels).toEqual(expect.arrayContaining(['File', 'Edit', 'View', 'Help']));
  });

  it('projects seed anchors into the current window when OCR is unavailable', async () => {
    runOcrMock.mockResolvedValue(null);

    const seedGraph: GuiTrustGraph = {
      appId: 'gimp',
      createdAt: '2026-03-28T12:00:00.000Z',
      updatedAt: '2026-03-28T12:00:00.000Z',
      states: [
        {
          stateId: 'seed-state',
          appId: 'gimp',
          createdAt: '2026-03-28T12:00:00.000Z',
          monitor: { name: 'eDP', width: 1920, height: 1080, originX: 0, originY: 0 },
          windowBounds: { x: 100, y: 100, width: 1000, height: 700 },
          windowTitle: 'GIMP Seed',
          screenshotPath: '/tmp/seed.png',
          screenshotHash: '',
          perceptualHash: '',
          ocrSummary: [],
          visibleRegionHash: [],
        },
      ],
      elements: [
        {
          elementId: 'seed:gimp:menu_file',
          stateId: 'seed-state',
          role: 'menu_item',
          label: 'menu_file',
          bbox: { x: 110, y: 120, width: 30, height: 16 },
          center: { x: 125, y: 128 },
          confidence: 0.6,
          interactableScore: 0.8,
          enabledGuess: true,
          selectedGuess: null,
          anchors: {
            absolute: { x: 125, y: 128 },
            windowRelative: { x: 25, y: 28 },
          },
          neighbors: [],
        },
      ],
      edges: [],
      commands: [],
    };

    const state = {
      stateId: 'state-2',
      appId: 'gimp',
      createdAt: '2026-03-28T12:00:00.000Z',
      monitor: { name: 'eDP', width: 1920, height: 1080, originX: 0, originY: 0 },
      windowBounds: { x: 300, y: 200, width: 1000, height: 700 },
      windowTitle: 'GIMP Current',
      screenshotPath: '/tmp/fake.png',
      screenshotHash: '',
      perceptualHash: '',
      ocrSummary: [],
      visibleRegionHash: [],
    };

    const elements = await inferGuiElements(state, { seedGraph });
    const projected = elements.find((element) => element.label === 'menu_file');

    expect(projected).toBeTruthy();
    expect(projected?.center.x).toBe(325);
    expect(projected?.center.y).toBe(228);
  });
});

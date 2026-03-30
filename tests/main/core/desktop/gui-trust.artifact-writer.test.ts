import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  appendStateToGraph,
  createEmptyGuiTrustGraph,
  writeGuiTrustSessionArtifacts,
} from '../../../../src/main/core/desktop/gui-trust';
import type { GuiTrustSession } from '../../../../src/main/core/desktop/gui-trust';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('gui-trust artifact writer', () => {
  it('writes session and graph artifacts to the expected directories', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gui-trust-artifacts-'));
    tempRoots.push(root);

    const session: GuiTrustSession = {
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
      artifactRoot: root,
    };

    const graph = createEmptyGuiTrustGraph('gimp');
    appendStateToGraph(graph, {
      stateId: 'state-1',
      appId: 'gimp',
      createdAt: '2026-03-28T12:00:00.000Z',
      monitor: { name: 'eDP', width: 1920, height: 1080, originX: 0, originY: 0 },
      windowBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      windowTitle: 'GIMP',
      screenshotPath: '/tmp/example.png',
      screenshotHash: 'hash',
      perceptualHash: 'phash',
      ocrSummary: ['File Edit View'],
      visibleRegionHash: ['abc'],
    });

    const written = writeGuiTrustSessionArtifacts(session, graph, {
      notes: ['line one', 'line two'],
    });

    expect(fs.existsSync(written.sessionPath)).toBe(true);
    expect(fs.existsSync(written.graphPath)).toBe(true);
    expect(fs.existsSync(written.stateIndexPath)).toBe(true);
    expect(written.notesPath && fs.existsSync(written.notesPath)).toBe(true);

    const loadedGraph = JSON.parse(fs.readFileSync(written.graphPath, 'utf8'));
    expect(loadedGraph.appId).toBe('gimp');
    expect(loadedGraph.states).toHaveLength(1);
  });
});

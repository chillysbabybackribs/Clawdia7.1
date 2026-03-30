import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const originalCwd = process.cwd();
let tempRoot = '';

afterEach(() => {
  if (tempRoot) {
    process.chdir(originalCwd);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = '';
  }
});

describe('trusted anchor store', () => {
  it('writes and reloads trusted anchors for an app', async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-anchors-'));
    process.chdir(tempRoot);

    const mod = await import('../../../../src/main/core/desktop/hybrid-mapping/trustedAnchors');
    const result = mod.upsertTrustedAnchor({
      id: 'anchor-1',
      appId: 'gimp',
      label: 'File menu',
      role: 'menu_item',
      targetDescription: 'File menu item in the top menu bar',
      sectionLabel: 'top-menu',
      sectionBounds: { x: 0, y: 0, width: 1920, height: 90 },
      x: 19,
      y: 12,
      confidence: 0.98,
      windowTitle: 'GNU Image Manipulation Program',
      windowBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      screenshotPath: '/tmp/gimp.png',
      trustedAt: '2026-03-28T13:00:00.000Z',
      source: 'hybrid-mapper',
    });

    expect(fs.existsSync(result.filePath)).toBe(true);
    const anchors = mod.loadTrustedAnchors('gimp');
    expect(anchors).toHaveLength(1);
    expect(anchors[0].label).toBe('File menu');
    expect(anchors[0].x).toBe(19);
    expect(anchors[0].sectionLabel).toBe('top-menu');
  });
});

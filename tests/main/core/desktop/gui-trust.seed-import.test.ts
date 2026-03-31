import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { importGuiTrustSeedFromAppArtifacts } from '../../../../src/main/core/desktop/gui-trust';

describe('gui-trust seed import', () => {
  function withArtifactRoot(appId: string, files: Record<string, unknown>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `gui-trust-${appId}-`));
    for (const [name, data] of Object.entries(files)) {
      fs.writeFileSync(path.join(root, name), JSON.stringify(data, null, 2), 'utf8');
    }
    return root;
  }

  it('skips screen-map seeds when the recorded window context belongs to a different app', () => {
    const artifactRoot = withArtifactRoot('gimp', {
      'gimp-map.smap.json': {
        baselineScreenshot: 'baseline.png',
        description: 'GIMP seed',
        points: [
          {
            x: 100,
            y: 80,
            label: 'menu_file',
            windowContext: {
              appName: 'obs',
              windowTitle: 'OBS Studio',
              bounds: { x: 0, y: 0, width: 1280, height: 720 },
            },
          },
        ],
      },
    });

    const result = importGuiTrustSeedFromAppArtifacts('gimp', { artifactRoot });

    expect(result.sourceFiles.some((file) => file.endsWith('gimp-map.smap.json'))).toBe(true);
    expect(result.graph.elements.length).toBe(0);
    expect(result.warnings.some((warning) => warning.includes('window context points at'))).toBe(true);
  });

  it('imports OBS validated-map seeds and creates trust edges for passed controls', () => {
    const artifactRoot = withArtifactRoot('obs', {
      'validated-map.json': {
        app_name: 'OBS Studio',
        window_bounds: { x: 10, y: 20, width: 1600, height: 900 },
        sections: {
          menu_bar: {
            elements: [
              {
                id: 'menu-file',
                label: 'File',
                type: 'menu item',
                x: 20,
                y: 30,
                center_x: 40,
                center_y: 40,
                w: 60,
                h: 20,
                validation_result: 'PASS',
              },
            ],
          },
        },
      },
    });

    const result = importGuiTrustSeedFromAppArtifacts('obs', { artifactRoot });

    expect(result.sourceFiles.some((file) => file.endsWith('validated-map.json'))).toBe(true);
    expect(result.graph.elements.some((element) => element.label === 'File')).toBe(true);
    expect(result.graph.edges.length).toBeGreaterThan(0);
    expect(result.graph.edges.some((edge) => edge.successCount > 0)).toBe(true);
  });
});

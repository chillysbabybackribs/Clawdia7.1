import { describe, expect, it } from 'vitest';
import { importGuiTrustSeedFromAppArtifacts } from '../../../../src/main/core/desktop/gui-trust';

describe('gui-trust seed import', () => {
  it('skips screen-map seeds when the recorded window context belongs to a different app', () => {
    const result = importGuiTrustSeedFromAppArtifacts('gimp');

    expect(result.sourceFiles.some((file) => file.endsWith('gimp-map.smap.json'))).toBe(true);
    expect(result.graph.elements.length).toBe(0);
    expect(result.warnings.some((warning) => warning.includes('window context points at'))).toBe(true);
  });

  it('imports OBS validated-map seeds and creates trust edges for passed controls', () => {
    const result = importGuiTrustSeedFromAppArtifacts('obs');

    expect(result.sourceFiles.some((file) => file.endsWith('validated-map.json'))).toBe(true);
    expect(result.graph.elements.some((element) => element.label === 'File')).toBe(true);
    expect(result.graph.edges.length).toBeGreaterThan(0);
    expect(result.graph.edges.some((edge) => edge.successCount > 0)).toBe(true);
  });
});

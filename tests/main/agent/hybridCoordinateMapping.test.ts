import { describe, expect, it } from 'vitest';
import {
  buildCoordinateProposalPrompt,
  buildCoordinateValidationPrompt,
} from '../../../src/main/agent/appMapping/hybridCoordinateMapping';

describe('hybridCoordinateMapping prompts', () => {
  it('builds a proposal prompt with the expected JSON contract', () => {
    const prompt = buildCoordinateProposalPrompt({
      appName: 'gimp',
      windowTitle: 'GNU Image Manipulation Program',
      targetDescription: 'File menu item in the top menu bar',
      screenshotPath: '/tmp/gimp.png',
      windowBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      sectionLabel: 'top-menu',
      sectionBounds: { x: 0, y: 0, width: 1920, height: 90 },
    });

    expect(prompt).toContain('Return JSON only');
    expect(prompt).toContain('"x"');
    expect(prompt).toContain('Target description: File menu item in the top menu bar');
    expect(prompt).toContain('Phase 1 only: work on one section and one coordinate only.');
    expect(prompt).toContain('Section label: top-menu');
  });

  it('builds a validation prompt with cursor calibration fields', () => {
    const prompt = buildCoordinateValidationPrompt({
      appName: 'gimp',
      windowTitle: 'GNU Image Manipulation Program',
      targetDescription: 'File menu item in the top menu bar',
      screenshotPath: '/tmp/gimp.png',
      windowBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      cursor: { x: 20, y: 15 },
      sectionLabel: 'top-menu',
      sectionBounds: { x: 0, y: 0, width: 1920, height: 90 },
    });

    expect(prompt).toContain('status');
    expect(prompt).toContain('"dx"');
    expect(prompt).toContain('Cursor coordinate: x=20, y=15');
    expect(prompt).toContain('Phase 1 only: this is a strict hover-only calibration task.');
    expect(prompt).toContain('Section bounds: x=0, y=0, width=1920, height=90');
  });
});

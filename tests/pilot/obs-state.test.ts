import { describe, expect, it } from 'vitest';
import { detectStateFromSignals } from '../../src/pilot/obs/obs-state';
import type { StateDef } from '../../src/pilot/obs/obs-types';

const states: Record<string, StateDef> = {
  main: {
    windowTitlePattern: 'OBS.*',
    cues: ['Scenes', 'Sources', 'Audio Mixer', 'Controls'],
  },
  settingsDialog: {
    windowTitlePattern: 'Settings',
    cues: ['General', 'Stream', 'Output'],
  },
};

describe('detectStateFromSignals', () => {
  it('matches the most specific state by title and cues', () => {
    const state = detectStateFromSignals(states, {
      windowList: 'OBS Studio\nSettings',
      cueText: 'General Stream Output',
    });
    expect(state).toBe('settingsDialog');
  });

  it('falls back to title-only matching when cues are absent', () => {
    const state = detectStateFromSignals(states, {
      windowList: 'OBS Studio',
      cueText: '',
    });
    expect(state).toBe('main');
  });

  it('returns unknown when nothing matches', () => {
    const state = detectStateFromSignals(states, {
      windowList: 'Calculator',
      cueText: 'Add Subtract',
    });
    expect(state).toBe('unknown');
  });
});

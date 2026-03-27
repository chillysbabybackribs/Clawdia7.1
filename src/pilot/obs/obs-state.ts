// src/pilot/obs/obs-state.ts
import type { StateDef } from './obs-types';

/**
 * Given a map of named state definitions and runtime signals,
 * return the key of the best-matching state or 'unknown'.
 *
 * Scoring: title match = 2pts, each cue match = 1pt.
 * The state with the highest score wins. No title match = skip.
 */
export function detectStateFromSignals(
  states: Record<string, StateDef>,
  signals: { windowList: string; cueText: string },
): string {
  let best = 'unknown';
  let bestScore = 0;

  for (const [key, def] of Object.entries(states)) {
    let titleMatch = false;
    try {
      titleMatch = new RegExp(def.windowTitlePattern).test(signals.windowList);
    } catch {
      continue;
    }
    if (!titleMatch) continue;

    const cuesMatched = def.cues.filter((c) => signals.cueText.includes(c)).length;
    const score = 2 + cuesMatched;

    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
  }

  return best;
}

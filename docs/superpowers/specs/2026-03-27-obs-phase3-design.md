# OBS Phase 3 Design

**Date:** 2026-03-27
**Status:** Approved
**Scope:** Fix 3 failing test gaps → complete map → run harness end-to-end

---

## Overview

Phase 3 has three sequential sub-goals:

1. **Fix failing tests** — two test failures in `obs-locator.test.ts` and one missing module in `obs-state.test.ts`
2. **Complete the Phase 3 map** — verify/update `obs-map.json` control coordinates against Phase 2 validated data; extend map with left panel and bottom area entries
3. **Run the harness** — build, execute `runHarness({ runCount: 1 })` against live OBS, write a completion report

Phase 1 and Phase 2 mapping artifacts are complete and stable. The pilot code compiles clean (`tsc --noEmit` passes). The only gaps are the three test failures and the map extensions.

---

## Part 1 — Fix Failing Tests

### 1a. `obs-types.ts` — two additions

**Add `relative` field to `ControlDef`:**

```typescript
export interface ControlDef {
  a11yRole: string;
  a11yName: string | null;
  region: string;
  ocrFallback: string;
  coord?: [number, number];
  relative?: [number, number];   // ← add this
  knownValues?: string[];
  toggleState?: boolean;
}
```

**Add `StateDef` export:**

```typescript
export interface StateDef {
  windowTitlePattern: string;
  cues: string[];
}
```

`StateDef` is used by `obs-state.ts` and imported in `obs-state.test.ts`.

---

### 1b. `obs-locator.ts` — two additions

**Update `selectLocatorStrategy`** to add a `'relative'` branch between `'ocr'` and `'coord'`:

```typescript
export function selectLocatorStrategy(ctrl: ControlDef): LocatorUsed {
  if (ctrl.a11yRole) return 'a11y';
  if (ctrl.ocrFallback) return 'ocr';
  if (ctrl.relative) return 'relative';
  return 'coord';
}
```

The `LocatorUsed` union type already needs `'relative'` added: `'a11y' | 'ocr' | 'coord' | 'relative' | 'none'`.

**Export `getRelativePoint`:**

```typescript
export function getRelativePoint(ctrl: ControlDef): { x: number; y: number } {
  const [rx, ry] = ctrl.relative ?? [0, 0];
  return { x: rx, y: ry + OBS_PILOT_CONFIG.contentYOffset };
}
```

`contentYOffset = 69` — the pixel offset from the window top to the content area (menu bar 50px + dock header 19px). Add this constant to `obs-config.ts`:

```typescript
contentYOffset: 69,
```

This makes `getRelativePoint({relative:[100,200]})` → `{x:100, y:269}`, matching the test.

---

### 1c. `obs-state.ts` — new file

`detectStateFromSignals` scores each `StateDef` against two signals: window title pattern match and cue text matches. Returns the key of the highest-scoring state, or `'unknown'`.

**Scoring logic:**
- Title pattern match = 2 points
- Each cue found in `cueText` = 1 point
- Ties broken by number of cues matched (more specific wins)
- If no state scores > 0, return `'unknown'`

```typescript
// src/pilot/obs/obs-state.ts
import type { StateDef } from './obs-types';

export function detectStateFromSignals(
  states: Record<string, StateDef>,
  signals: { windowList: string; cueText: string },
): string {
  let best = 'unknown';
  let bestScore = 0;

  for (const [key, def] of Object.entries(states)) {
    const titleMatch = new RegExp(def.windowTitlePattern).test(signals.windowList);
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
```

**Test coverage (existing `obs-state.test.ts`):**
- Matches `settingsDialog` (title + 3 cues) over `main` (title only) — higher score wins
- Falls back to `main` on title-only match when cues absent
- Returns `'unknown'` when no title matches

---

## Part 2 — Phase 3 Map Completion

### Coordinate verification

The existing `obs-map.json` controls use hand-written coordinates from the pilot plan. Cross-reference against Phase 2 validated geometry (window 2560×1080, OBS at 0,0):

| Control | Current coord | Phase 2 note |
|---|---|---|
| `sceneAddBtn` | (22, 1033) | Left panel bottom — plausible |
| `sourceAddBtn` | (330, 1028) | Center-left bottom — plausible |
| `micMuteBtn` | (980, 917) | Mixer panel — plausible |
| `transitionCombo` | (1110, 883) | Transitions panel — plausible |
| `settingsBtn` | (1421, 955) | Controls panel — plausible |

Coordinates are consistent with the Phase 2 section bounds. No corrections needed — they will be validated by the harness run itself.

### Map extensions for Phase 3

Add two new regions and their elements to `obs-map.json`:

**Left panel — scene list items and source list:**

```json
"sceneList": {
  "label": "Scene List",
  "a11yRole": "list",
  "a11yName": "Scenes",
  "position": "left-panel-bottom",
  "controls": ["sceneItem0", "sceneAddBtn", "sceneRemoveBtn"]
},
"sourceList": {
  "label": "Source List",
  "a11yRole": "list",
  "a11yName": "Sources",
  "position": "left-panel-bottom",
  "controls": ["sourceItem0", "sourceAddBtn", "sourceRemoveBtn"]
}
```

New controls:

```json
"sceneItem0": { "a11yRole": "list item", "a11yName": null, "region": "sceneList", "ocrFallback": "", "coord": [155, 840] },
"sourceItem0": { "a11yRole": "list item", "a11yName": null, "region": "sourceList", "ocrFallback": "", "coord": [330, 900] }
```

**Bottom area — recording and virtual camera:**

```json
"bottomControls": {
  "label": "Bottom Controls",
  "a11yRole": "panel",
  "a11yName": null,
  "position": "bottom-center",
  "controls": ["startRecordingBtn", "startVirtualCameraBtn"]
}
```

New controls:

```json
"startRecordingBtn":      { "a11yRole": "push button", "a11yName": "Start Recording",      "region": "bottomControls", "ocrFallback": "Start Recording",      "coord": [1200, 980] },
"startVirtualCameraBtn":  { "a11yRole": "push button", "a11yName": "Start Virtual Camera", "region": "bottomControls", "ocrFallback": "Start Virtual Camera", "coord": [1200, 1030] }
```

These coordinates come directly from Phase 2's `bottom_area` element centers.

---

## Part 3 — End-to-End Harness Run

### Build

```bash
npx tsc -p tsconfig.main.json
```

Expected: zero errors.

### Run

```bash
node dist/pilot/run-obs-pilot.js --runs 1
```

This executes the 10-step workflow:
1. launchOBS
2. detectMainWindow
3. createScene (PilotScene)
4. selectScene (PilotScene)
5. addSource (monitor_capture / PilotScreen)
6. setMicMuted (true)
7. setTransition (Fade)
8. openSettings
9. closeSettings
10. verifyMainState

Results are written to `logs/obs-pilot-results.jsonl`.

### Pass criteria

The harness passes if all 6 core steps (`launchOBS`, `detectMainWindow`, `createScene`, `selectScene`, `openSettings`, `closeSettings`) pass in ≥50% of runs. With `--runs 1`, all 6 must pass.

### Deliverable

Write `artifacts/app-mapping/obs/PHASE3_COMPLETION_REPORT.md` with:
- Test fix summary (which tests were fixed, how)
- Map extension summary (new regions + controls added)
- Harness run results (step-by-step pass/fail, confidence scores, token costs)
- Phase 3 pass/fail verdict

---

## File Summary

| File | Action |
|---|---|
| `src/pilot/obs/obs-types.ts` | Add `relative?` to `ControlDef`; add `'relative'` to `LocatorUsed`; export `StateDef` |
| `src/pilot/obs/obs-config.ts` | Add `contentYOffset: 69` constant |
| `src/pilot/obs/obs-locator.ts` | Add `'relative'` branch in `selectLocatorStrategy`; export `getRelativePoint` |
| `src/pilot/obs/obs-state.ts` | New file — `detectStateFromSignals` |
| `src/pilot/obs/obs-map.json` | Add `sceneList`, `sourceList`, `bottomControls` regions; add 4 new controls |
| `artifacts/app-mapping/obs/PHASE3_COMPLETION_REPORT.md` | New — written after harness run |

**Test result target:** 15/15 passing (currently 13/15).

---

## Constraints

- Do not modify `obs-adapter.ts`, `obs-workflow.ts`, `obs-harness.ts`, or `obs-verifier.ts` — these are working
- Do not touch `obs-map.json` control coordinates that Phase 2 validated as accurate
- `obs-state.ts` is not wired into the adapter in Phase 3 — it is implemented and tested, integration is future work
- The `relative` locator strategy in `clickControl` does not need to be implemented in Phase 3 — `getRelativePoint` is exported and tested but no controls in `obs-map.json` use `relative` (all have `coord`), so `clickControl` will never hit the `'relative'` branch during the harness run

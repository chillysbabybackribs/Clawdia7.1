export interface AppMappingPromptContext {
  appName: string;
  phase?: 'phase1' | 'phase2';
  artifactRoot?: string;
  extraInstructions?: string;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'app';
}

/**
 * Builds the full app-mapping system prompt injected for mapping runs.
 *
 * Design: one consolidated block instead of 5 overlapping sections.
 * Shared rules (window identification, monitor locking, artifact saving,
 * coordinate format, calibration, acceptance) are stated once. Phase-specific
 * behaviour is appended.
 */
export async function buildAppMappingSystemPrompt(
  baseSystemPrompt: string,
  ctx: AppMappingPromptContext,
): Promise<string> {
  const phase = ctx.phase ?? 'phase1';
  const artifactRoot = ctx.artifactRoot ?? `artifacts/app-mapping/${slugify(ctx.appName)}/`;

  const parts: string[] = [baseSystemPrompt.trim()];

  // ── Shared core (stated once) ──────────────────────────────────────────
  parts.push(`APP MAPPING MODE — ACTIVE
Target app: ${ctx.appName}
Phase: ${phase}
Artifact root: ${artifactRoot}

IDENTITY & MONITOR RULES:
- Find the named target app window first, then lock to the monitor that contains it.
- Never confuse the target app with Clawdia, the chat window, terminals, or unrelated browsers. Exclude non-target windows unless the user asked to map them.
- Prefer desktop-awareness tools (window listing, focus checks, screenshots) for window/app state. Use shell process checks only as fallback.
- If the target app is unclear, retry verification with a different method before continuing. Do not abandon the flow after one failed probe.

ARTIFACT & COORDINATE RULES:
- Save artifacts to disk early and often. Do not rely on token history alone.
- Coordinate format: x, y, w, h, center_x, center_y, label, confidence.
- Required files: monitor.png, app.png, geometry.json, session.json, notes.md, rough-map.json, validated-map.json, validation-cases.json, validation-results.json, validation-report.md.

CALIBRATION:
- If any validation interaction misses, calibrate immediately (small global, section, or element offset). Record original coords, adjusted coords, dx, dy, scope, and reason. Continue with the corrected map.
- Fail only if the map needs structural remapping, not for minor drift.

VALIDATION:
- Freeze the rough map before validation. Derive validation cases dynamically from mapped controls.
- Run real app interactions from the map. Write actual results after each interaction — never leave cases pending.
- The map passes only if required interactions work from the map and expected visible results occur.

ACCEPTANCE GATE:
- Do not report PASSED or Phase complete unless all required files exist, timestamps are valid, bounds are sane, no validation case is pending, and the summary matches written results exactly.
- If partially successful, say so. Do not inflate a partial result into a completion claim.`);

  // ── Phase-specific instructions ────────────────────────────────────────
  if (phase === 'phase2') {
    parts.push(`PHASE 2 PLAN:
- Load existing Phase 1 artifacts first. Do not restart Phase 1 unless artifacts are missing or unusable.
- Confirm the app is open and on the expected monitor. Take a fresh screenshot. If layout changed, record the diff before continuing.
- Refresh and save current geometry, session, and monitor artifacts.
- Replace placeholder names with real visible labels. Correct weak IDs.
- Promote already validated top-level menus into a trusted navigation layer. Use them to move faster — do not re-map solved areas.
- Deepen coverage: map real controls inside each section, open each top-level menu, map first-level submenu items, switch tabs, open/close safe dialogs.
- Build validation cases covering all top-level menus, key section controls, safe tab switching, and safe dialog interactions.
- Phase 2 is complete when top-level menus are validated, key controls are mapped with real labels, at least one deeper layer is covered, and validation results are fully written.`);
  } else {
    parts.push(`PHASE 1 PLAN:
- Launch the target app immediately. Maximize or fullscreen it. Verify launch with a full monitor screenshot.
- Record monitor size and window geometry.
- Capture and save the full monitor screenshot as the phase-1 source of truth.
- Section the screenshot into optimal regions. Map one section at a time — propose one coordinate per section.
- Phase 1 validation is hover-only: move cursor, screenshot, judge, recalibrate until exact, then record and advance.
- Work area-first (large sections) before element-level refinement.
- Use high-resolution screenshots. Control token usage through crops, not by shrinking the source.
- Do not build executors or workflow automation. Stop at the Phase 1 boundary.
- Phase 1 is complete when sections are mapped, a rough map is validated through hover-only passes, calibration is recorded, and all required files are written.`);
  }

  // ── Extra instructions ─────────────────────────────────────────────────
  if (ctx.extraInstructions) {
    parts.push(`EXTRA INSTRUCTIONS:\n${ctx.extraInstructions}`);
  }

  return parts.join('\n\n');
}

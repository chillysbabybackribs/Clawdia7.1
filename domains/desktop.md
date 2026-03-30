# Domain: Desktop

## What This Domain Is

The desktop domain covers tasks that require automating native Linux GUI applications using accessibility APIs and input simulation. Actions taken here operate on real running applications visible on the user's display. Mistakes are immediately visible and some interactions may be irreversible.

## Input Strategy Hierarchy

Use the highest-confidence input method available for each interaction. Do not skip to lower methods prematurely.

1. **AT-SPI accessibility tree** — semantic element identity, independent of pixel position. Preferred when available.
2. **Named window + relative coordinates** — coordinates computed relative to a known window position. Requires fresh window geometry.
3. **Absolute screen coordinates** — computed from a screenshot. Requires recent calibration. Use only when AT-SPI is unavailable.
4. **xdotool text/key injection** — keyboard simulation without element targeting. Use only for text entry after focus is confirmed.

Never use coordinates from a previous session, screenshot, or map without re-verifying against current window state.

## Window Identification

Always identify the target window before taking any action.

- Enumerate open windows: `gui_interact` window listing, or `shell_exec { command: "wmctrl -l" }`
- Identify the target by title, class, or process name
- Note the monitor it occupies — actions must be scoped to that monitor
- Distinguish the target app from Clawdia itself, terminals, browsers, and other unrelated windows
- If the target window is ambiguous or not found: report this before attempting any interaction

## Coordinate System

All coordinates are in absolute screen pixels: `{ x, y, width, height, center_x, center_y }`.

- Coordinates are always absolute, not relative to a window or widget
- Verify all coordinates fall within the recorded monitor bounds before use
- After any window move, resize, maximize, or workspace change: treat all prior coordinates as stale and re-verify
- Calibration record format: `{ original: {x,y}, adjusted: {x,y}, dx, dy, scope, reason }`

## Screenshot Discipline

- Take a full-monitor screenshot before beginning any mapping or automation task
- Use cropped screenshots for element-level work — full screenshots at every step consume token budget unnecessarily
- After every significant interaction, take a verification screenshot before proceeding
- Save screenshots to disk for long-running tasks — do not rely on token context alone
- When a coordinate lands incorrectly, take a fresh screenshot before computing corrected coordinates

## State Verification

- Every action has an expected observable outcome: a button state change, a dialog appearing, a field receiving text
- After each interaction, verify the expected outcome occurred before proceeding
- If no visible change occurred, diagnose before retrying — the same action with the same coordinates will produce the same result
- "The tool call returned successfully" is not the same as "the interaction produced the intended effect"

## Known Failure Modes

| Failure | First Check | Recovery |
|---------|-------------|---------|
| Target window not found | Check process list: `ps aux` or `wmctrl -l` | Report to user; do not proceed blind |
| Interaction lands in wrong position | Re-verify window geometry; take fresh screenshot | Recalibrate coordinates; record offset |
| App not responding | `xdotool getactivewindow`; check process state | Report state; do not loop on same action |
| Coordinate mismatch after window change | Window was moved, resized, or workspace-switched | Re-map from fresh screenshot |
| Repeated action with no visible change | Page/app state unchanged | `recovery/stall-detected.md` |

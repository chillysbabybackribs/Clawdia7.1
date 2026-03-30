# App Mapping Phase 2

**BEFORE YOU DO ANYTHING**
- Launch the target app and immediately fullscreen or maximize it.
  Try: `{"action":"maximize_window","window":"<app>"}` or `{"action":"fullscreen_window","window":"<app>"}` via gui_interact.
- Confirm the app has started. Sometimes it starts after your first check — always verify with a screenshot.
- Check for monitor setup and validate where the app launched and landed.
- If there are multiple monitors, determine which monitor contains the target app window and lock to that monitor for the run.
- Once the app is confirmed, take a screenshot of the full monitor view to validate the app launched successfully.

## Goal

Phase 2 moves beyond basic section coverage and proves that the app can be navigated through its real top-level controls, menus, submenus, tabs, and safe dialogs using the map.

## Trigger

User prompt examples:

- `Continue mapping <app name>`
- `Run Phase 2 on <app name>`
- `Deep map <app name>`

Phase 2 assumes Phase 1 artifacts already exist.

## Phase 2 Flow

### 1. Load The Existing App Map

- load the Phase 1 artifacts from the app folder
- inspect the current windows and visible apps before doing anything else so you know the current desktop state
- confirm the app is open
- confirm the correct app window and determine which monitor contains it
- confirm the app is still maximized or fullscreen if that was the Phase 1 baseline
- take a fresh monitor screenshot and app screenshot

If the app layout changed significantly from Phase 1, record that immediately before continuing.
If the app is not visible where expected, retry with a different verification method before continuing.

### 2. Refresh The Current Geometry

Capture and save:

- current monitor screenshot
- current app screenshot
- current geometry
- current session notes

Update:

- `geometry.json`
- `session.json`
- `notes.md`

### 3. Tighten The Existing Map

- replace placeholder names with real visible labels wherever possible
- correct weak ids that do not match real visible controls
- confirm major sections still make sense
- keep coordinates simple and explicit
- promote already validated top-level menus into a trusted navigation layer

This step is for map refinement, not full remapping from scratch unless the layout has clearly changed.

### 4. Deepen Section Coverage

Map the real controls inside each major section.

Examples:

- top-level menu items
- list or tree entries in side panels
- toolbar and action bar controls
- mixer, timeline, or property panel controls
- status bar or bottom panel controls

Each required mapped item should have:

- real label
- stable id
- section assignment
- coordinates
- confidence
- validation status

### 5. Traverse One Level Deeper

Phase 2 should map at least one level deeper than Phase 1.

Use the already validated top menu bar as the primary expansion path.
Do not keep rediscovering the menu bar if it is already validated and stable.
Use it to move faster into deeper validated states.

Examples:

- open each top-level menu
- map first-level submenu items
- switch visible tabs
- open safe dialogs
- close safe dialogs

Do not use destructive actions unless explicitly required and clearly safe.

### 6. Build Real Validation Cases

Validation cases should now cover more than a first smoke pass.

Required coverage should include:

- all top-level menus
- key section controls
- safe tab switching
- safe dialog open and close interactions
- selection changes where relevant

Prefer validation chains instead of isolated clicks when a validated menu can take you there faster.

Examples:

- open a top-level menu -> open a submenu item
- open a settings or preferences dialog -> inspect current options
- open a tools or utilities menu -> inspect entries
- navigate to a panel or dock -> validate its controls

Use real app-derived names from the map, not generic placeholders unless the UI truly uses those names.

Suggested outputs:

- `validation-cases.json`
- `validation-results.json`
- `validation-report.md`

### 7. Validate Through Real Interaction

Use the validation process from Phase 1, but with deeper coverage.

- freeze the current map
- run the validation interactions from the frozen map
- calibrate small drift if needed
- record calibration immediately
- continue with the corrected map when appropriate
- fail if the map needs structural remapping

### 8. Save State And Transition Evidence

Phase 2 should save stronger evidence than Phase 1.

Suggested artifacts:

- before and after screenshots for important interactions
- screenshots of opened menus
- screenshots of safe dialogs
- updated map notes

### 9. Stop Condition

Phase 2 is complete when:

- all top-level menus required for the app were opened and validated
- key section controls were mapped with real labels
- at least one deeper layer of menu, submenu, tab, or dialog coverage was added
- validation results are fully written
- calibration is recorded if used
- no required case remains pending
- the final summary matches the validation results exactly

Phase 2 is not complete if the output is still mostly section-level approximation.

## Model Split

### Fast Model

Use a fast, cheap model for:

- local section refinement
- repeated screenshot interpretation
- map drafting
- non-critical coordinate review

### Strong Model

Use a stronger model for:

- whole-map review
- deeper validation planning
- ambiguity resolution
- calibration review
- final pass/fail judgment

## Key Rules

- Keep the startup and monitor-detection flow consistent with Phase 1.
- Maintain awareness of what windows and apps are currently running during the mapping run.
- Retry ambiguous startup, focus, or app-detection steps before treating them as failures.
- Treat already validated top-level menus as trusted navigation unless they fail.
- Use validated areas to move faster. Do not remap solved areas without a reason.
- Use real visible app names for controls whenever possible.
- Validate through interaction, not passive observation alone.
- Persist calibration the moment it is confirmed.
- Keep the summary honest and synchronized with the written results.
- Do not build executors during Phase 2.

## Deliverables

At the end of Phase 2, the app folder should contain updated versions of at minimum:

- `monitor.png`
- `app.png`
- `geometry.json`
- `session.json`
- `notes.md`
- `rough-map.json`
- `validated-map.json`
- `validation-cases.json`
- `validation-results.json`
- `validation-report.md`

Optional additional evidence:

- menu screenshots
- dialog screenshots
- before and after validation screenshots

# App Mapping Phase 1

## Goal

Build an LLM-first mapping agent that can launch an app, capture its visual context, split the app window into sections, create a rough map, and validate that rough map through real app interactions.

Phase 1 stops after a validated map is written to disk.

No executor generation.
No workflow automation outside the validation process.
No deep menu/dialog traversal yet beyond what is needed for the first mapping pass and safe validation.

## Trigger

User prompt:

- `Map <app name>`

Phase 1 assumes a specific target app is named directly in the prompt.

## Phase 1 Flow

Phase 1 is intentionally narrow. Do not click. Do not open deeper layers. Do not branch into richer pipelines.

### 1. Create App Mapping Folder

Create a dedicated folder for the target app before mapping begins.

Suggested location:

- `artifacts/app-mapping/<app-slug>/`

Initial files:

- `monitor.png`
- `app.png`
- `geometry.json`
- `session.json`
- `notes.md`

### 2. Strict Mapping Loop

Run this sequence exactly:

1. record monitor size
2. launch the target app fullscreen
3. take one fullscreen high-resolution screenshot
4. let a strong LLM split that fullscreen screenshot into however many sections are optimal for the visible surface-level detail
5. let the LLM assign coordinates for one section and only one section
6. launch or refocus the application fullscreen again if needed
7. move the cursor to the first coordinate
8. do not click, only take a screenshot
9. validate from the screenshot whether the cursor is in the optimal spot
10. if yes, record and map the full section; if no, recalibrate and rescreenshot until optimal
11. move to the next section

Stay in this loop until the visible top-level surface is mapped reliably.

### 3. Section Mapping Rules

- Split the app window into large sections only when helpful.
- Accuracy over speed is paramount.
- A strong model should decide the section count and boundaries from the fullscreen screenshot.
- Only one section may be actively coordinate-mapped at a time in phase 1.
- Validation for the active section is hover-only.
- Save coordinates, labels, and notes for each section.

For each mapped item, store simple geometry:

- `x`
- `y`
- `w`
- `h`
- `center_x`
- `center_y`
- `label`
- `confidence`

### 4. Rough Map Merge

- Merge all section outputs into one rough whole-app map.
- Save the merged map to disk.

Suggested output:

- `rough-map.json`

### 5. Strong-Model Validation

- Use the strongest available model to review the rough map.
- Freeze the rough map before validation.
- Calibrate small global or section drift immediately and record it.
- Validation in phase 1 is still hover-only. Move to the coordinate, take a screenshot, judge, recalibrate, repeat.
- Validate section boundaries, labels, and coordinates only at the visible top-level surface.
- Flag ambiguous or low-confidence items and give a short and to the point reason as to why.
- Correct obvious coordinate mistakes, but do not remap the app from scratch. 

Suggested outputs:

- `validated-map.json`
- `validation-cases.json`
- `validation-results.json`
- `validation-report.md`

### 6. Stop Condition

Phase 1 is complete when:

- initial screenshots are saved
- geometry is saved
- the app window is sectioned appropriately for its complexity
- the chosen sections are mapped
- a rough map exists
- a stronger model has reviewed that rough map
- required hover validation passes were actually run
- a validated map and validation report are written
- validation cases and validation results are written

Phase 1 does not need to prove the app is fully mapped top to bottom.
It does need to prove that the first-pass map can drive a hover-only validation process and that any small drift was calibrated and recorded.

## Model Split

### Fast Model

Use a fast, cheap model for:

- section mapping
- repeated screenshot interpretation
- rough coordinate extraction
- map drafting

### Strong Model

Use a stronger model for:

- section planning
- whole-map validation
- calibration review
- coordinate sanity checking
- ambiguity review
- final correction pass

## Key Rules

- Prefer fullscreen or maximized windows.
- Save artifacts to disk immediately instead of keeping state only in tokens.
- Work from high-resolution files on disk.
- Keep coordinates simple and explicit.
- Area-first mapping comes before element-level refinement.
- Persist calibration when validation adjusts coordinates.
- Do not click during phase 1 validation.
- Do not build executors during Phase 1.
- Do not move into deeper layers, dialogs, or detailed pipelines until this loop is reliable.

## Deliverables

At the end of Phase 1, the app folder should contain at minimum:

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

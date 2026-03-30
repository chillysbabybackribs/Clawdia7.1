# App Mapping Validation Process

## Goal

Validation is a process, not a subjective review.

The map is considered valid only if the app can be operated from the map.

This process is allowed to make small calibration adjustments during validation so that minor drift does not poison the rest of the run.

This process is not allowed to remap the app from scratch.

## Validation Sequence

### 1. Freeze The Map

Before validation begins:

- write the current map to disk
- treat that map as the validation input
- do not generate a brand new map during validation

The validation process may adjust small offsets, but it must keep using the same map structure.

### 2. Run Real App Interactions

Validation must use the frozen map to interact with the app.

Examples:

- click a mapped top-level menu item
- click a mapped control button
- open a mapped dialog
- close a mapped dialog
- switch a mapped tab
- activate a mapped panel control

Each interaction must have:

- a target from the map
- an action
- an expected result
- a simple proof that the expected result happened

### 3. Calibrate Small Drift Immediately

If the first validation step misses because the cursor is slightly off, correct that immediately and continue.

Allowed calibration:

- small global x/y offset
- small section-level x/y offset
- minor bounding-box drift
- repeatable click bias

Example:

- first click lands 5 pixels low
- apply the correction
- retry
- if it works, continue using that correction

### 4. Continue With The Corrected Map

After a valid small calibration:

- keep validating with the adjusted coordinates
- record what changed
- reuse the correction where it applies

The goal is to validate the usable map, not fail the entire process because of tiny drift.

### 5. Fail On Structural Problems

Validation must fail if the issue is structural instead of minor drift.

Structural failures include:

- wrong section assignment
- wrong control identity
- missing control
- missing dialog
- wrong state model
- wrong menu structure
- needing to invent new controls during validation

If validation needs a new map instead of a small adjustment, the map fails.

## Allowed And Forbidden Changes

### Allowed During Validation

- global coordinate offset
- section coordinate offset
- minor coordinate refinement
- confidence downgrade
- validation notes

### Not Allowed During Validation

- fresh full remapping
- inventing new controls
- changing labels freely
- changing app structure
- moving controls into different sections unless the section map itself is proven wrong and validation is stopped

## Pass Or Fail Rule

The map passes only if the app remains functional from the map through the required validation interactions.

The map fails if:

- required interactions do not work from the map
- the process depends on full remapping
- the expected visible result does not occur
- the wrong control responds

## Required Validation Coverage

For the first validation process, cover at minimum:

- one top-level menu interaction
- one main display or content area interaction
- one panel interaction
- one primary control button
- one dialog open or close interaction if available

Later phases can expand this to full top-to-bottom app coverage.

## What To Record

Write validation outputs that show what happened, not just a summary.

Suggested files:

- `validation-cases.json`
- `validation-results.json`
- `validation-summary.md`

For each validation item, record:

- target id
- original coordinates
- adjusted coordinates if changed
- action performed
- expected result
- actual result
- calibration applied
- pass or fail

## Completion Standard

Validation is complete only when:

- required validation interactions were run against the real app
- any small drift was calibrated and recorded
- no structural remapping was needed
- the final result is clearly pass or fail

If those conditions are not met, validation is not complete.

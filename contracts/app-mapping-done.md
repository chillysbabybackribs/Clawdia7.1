# App Mapping Completion Contract

This contract defines what must be true before an app mapping task can be reported as complete.

It applies to tasks whose goal is to map a desktop application's UI structure, interaction regions, visible controls, workflow paths, or automation-relevant surfaces.

## Core Rule

App mapping is complete only when the produced map is grounded in actual observed application state, sufficiently structured for later reuse, and not missing critical validation needed to trust it.

## Completion Checklist

Before reporting completion, confirm all of the following:

### 1. The intended application was actually mapped
- The target application was positively identified.
- The mapping work was performed on the correct window, screen, pane, or dialog.
- The map is not based on guessed app identity or stale screenshots alone.

### 2. The mapping scope is explicit
- The mapped scope is clearly stated.
- It is clear whether the map covers:
  - one screen
  - one workflow
  - one dialog
  - one application region
  - or a broader multi-step area

Do not imply full-app coverage if only a narrow area was mapped.

### 3. The map is grounded in observed UI structure

The map should be tied to actual observed application state such as:
- window title or identity
- pane or screen structure
- visible controls
- menus, dialogs, sections, or tabs
- coordinates or regions when relevant
- interaction relationships between visible parts of the UI

Do not claim a control or region exists unless it was actually observed or validated.

### 4. The map is useful for later execution

A completed map should support later automation or navigation by making clear:
- what regions or controls matter
- how they relate to the intended workflow
- what state the app must be in for the map to apply
- what parts are stable vs uncertain
- what assumptions or environmental dependencies matter

A map that is technically detailed but operationally unusable is not complete.

### 5. Verification was performed

At least one validation pass should confirm that the produced map corresponds to the current application state.

Validation may include:
- re-checking the same UI surface
- confirming mapped controls are still present
- confirming region relationships
- confirming that the map was not invalidated by a modal, zoom, layout shift, or step change
- confirming that the map matches the app state it claims to describe

### 6. Uncertainty is disclosed

The map must clearly distinguish between:
- confirmed mapped regions
- inferred relationships
- unverified assumptions
- unstable or dynamic elements

Do not present uncertain mapping details as fully confirmed.

### 7. Completion artifacts are present when required

If the mapping task expects saved files, structured outputs, coordinate tables, region definitions, screenshots, or validation notes, confirm those artifacts actually exist and correspond to the claimed mapping result.

Do not claim a mapping artifact was created unless it was actually written or observed.

## False Positive Patterns

Watch for these common failure modes:

- mapping the wrong window or wrong app state
- mistaking a transient modal or temporary layout for the stable target interface
- claiming "the app is mapped" after inspecting only one small region
- producing coordinate data without validating the window context
- inferring control relationships that were never confirmed
- reporting mapping completion without the required output artifacts

## Required Final Standard

Before final completion, the mapping task must satisfy this statement:

> The produced map is grounded in the intended application state, scoped honestly, operationally usable, and not contradicted by unresolved validation gaps.

If this statement is not true, do not claim the mapping task is complete.

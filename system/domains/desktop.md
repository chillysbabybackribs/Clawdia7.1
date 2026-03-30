# Desktop Domain

## Purpose

The desktop domain covers interaction with live graphical desktop applications, windows, dialogs, and system-visible application state.

This domain applies to GUI automation tasks, app workflows, app mapping, and desktop verification. It defines desktop-specific guidance, not task-specific phase sequences.

## Core Desktop Rules

- Confirm the correct application and window before interacting.
- Distinguish clearly between identifying, mapping, interacting, and verifying.
- Prefer structured and window-aware methods over blind interaction when available.
- Treat visible application state as authoritative.
- Do not confuse attempted GUI input with confirmed task progress.
- Re-ground after meaningful UI changes.

## Desktop Grounding

Desktop work should begin with certainty about the current application context.

Useful grounding signals:
- active application identity
- window title or window ID
- visible dialog or pane state
- focused control or active region
- desktop-visible text, labels, icons, and controls
- whether the target app is open, focused, blocked, or obscured
- whether interaction is occurring in the intended window rather than a different one

When state is uncertain, inspect and identify before interacting.

## Window Identity

Desktop automation is highly sensitive to window context.

Before interaction, determine:
- which application window is intended
- whether the intended window is open
- whether the intended window is focused
- whether a modal, popup, or secondary dialog has taken control
- whether the app is in the expected state or step

**Many desktop failures are not input failures. They are window identity failures.**

## Input Strategy Hierarchy

Prefer the most reliable interaction method supported by the current environment.

General order:
1. AT-SPI accessibility actions (`a11y_do_action`, `a11y_set_value`) — semantic, window-aware, robust
2. Application- or session-aware control methods (`dbus_control` for media, document, or service control)
3. Keyboard-driven interaction (`key`, `type`) when the focused target is confirmed
4. Coordinate-based interaction (`click` with x/y) only when the visible target is well-grounded and no better method is available

In Clawdia's tool set: prefer `gui_interact` with `a11y_*` actions over raw coordinate clicks. Use `gui_interact` with `action: "click"` and coordinates only after the target region is confirmed visible and stable.

Do not default to brittle coordinate guessing when `a11y_find` can locate the target by role and name.

## Coordinate System Awareness

Coordinate-based interaction is sometimes necessary, especially in visually complex or poorly exposed interfaces.

When using coordinate logic:
- confirm the correct window is focused first
- confirm the visible target region before acting
- be aware that window movement, scaling, modal dialogs, and layout changes can invalidate assumptions
- verify the resulting UI state after interaction

Coordinates are a last-mile action method, not a substitute for grounding.

## Map Before Complex Interaction

For unfamiliar or dense applications:
- identify the app structure first using `a11y_get_tree` or `gui_interact { action: "screenshot" }`
- determine where key controls, panes, menus, and dialogs live
- understand whether the task is linear, nested, modal, or stateful
- build a lightweight map of the interaction space before deep execution

This is especially important for app mapping tasks, repeated workflows, and fragile GUI sequences.

## Common Desktop Failure Patterns

- wrong window focused
- intended app not actually open
- modal or popup intercepting interaction
- control visually present but not interactable in the assumed way
- coordinate drift after window move or layout change
- application state advanced, but acting on a stale step assumption
- attempted interaction mistaken for successful outcome

When these appear, re-ground the app state and classify the failure before retrying.

## Verification Standard

Desktop claims must be supported by visible or system-confirmed application state.

Acceptable evidence:
- the intended window is open and focused (`verify_window_title`)
- a dialog appeared (visible in screenshot or a11y tree)
- a field contains the entered value (`a11y_find` by value)
- the requested menu or screen is visible
- the application moved to the expected next state

Do not claim a click succeeded, a value was entered, a workflow step completed, or an app action worked unless resulting app state confirms it.

## Relationship to Task Files

This file defines how desktop automation should be approached in general.

Task files define:
- which phases apply
- what each phase is trying to accomplish
- what to confirm before advancing
- what done means for the specific desktop task

→ Active task file: `tasks/desktop-automation.md` or `tasks/app-mapping-phase1.md` / `tasks/app-mapping-phase2.md`

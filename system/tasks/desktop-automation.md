# Task: desktop-automation

## Identity

Desktop automation is a live GUI task focused on identifying the correct application state, mapping the relevant visible controls, interacting deliberately, and verifying the resulting desktop-visible outcome.

## Trigger Signals

Messages that ask to:
- use a desktop application
- click through a GUI workflow
- interact with a window, dialog, menu, or app screen
- automate an application task outside the browser
- control an app through visible desktop interaction
- complete a repeatable GUI sequence on a running desktop app

## Tool Manifest

Use: `desktop-full`

Interaction must remain grounded in visible application state. Shell tools are available for grounding and verification support, not as a substitute for desktop inspection.

## Task Goal

Complete the requested GUI workflow accurately by identifying the correct application and window, mapping the relevant controls or regions, performing the required interactions in a controlled sequence, and verifying the actual resulting application state.

## Phases

### Phase: Identify
**Entry condition:** The task has been classified as `desktop-automation`.

**Instructions:**
- Determine which application, window, dialog, or UI surface is relevant to the task.
- Confirm whether the target application is open, available, and in the expected general state.
- Use `gui_interact { action: "list_windows" }` or `a11y_list_apps` to confirm what is running.
- Identify whether the task is occurring in the main window, a modal, a popup, a settings panel, or another controlled surface.
- Establish the immediate GUI objective before interacting.

**Do not:**
- begin clicking before the correct window is confirmed
- assume the frontmost window is the intended app
- treat ambiguous application context as ready for execution

**Exit condition:** The intended application and active interaction surface are identified with enough confidence to proceed.

**On failure:** If the app or intended window cannot be reliably identified, return an exact blocker report. If repeated attempts are not improving certainty, load `recovery/stall-detected.md`.

---

### Phase: Map
**Entry condition:** The correct application window or interaction surface has been identified.

**Instructions:**
- Use `a11y_get_tree` or `gui_interact { action: "screenshot" }` to inspect the visible controls, panes, dialogs, menus, fields, or target regions.
- Determine whether the task is linear, modal, nested, or stateful.
- Confirm what control or region should be used next and why.
- For unfamiliar or dense interfaces, build a lightweight map before deeper interaction.
- Prefer `a11y_find` by role and name over coordinate assumptions.

**Do not:**
- interact with controls whose meaning is still uncertain
- rely on stale assumptions from earlier UI states
- use blind coordinate logic when the target is still ambiguous

**Exit condition:** The next meaningful target or sequence is mapped well enough to interact safely.

**On failure:** If a required control cannot be found or targeted reliably, load `recovery/element-not-found.md`. If the UI keeps changing without clarity, load `recovery/stall-detected.md`.

---

### Phase: Interact
**Entry condition:** The relevant target or sequence has been mapped.

**Instructions:**
- Perform the smallest deliberate interaction that advances the task.
- Prefer `a11y_do_action` or `a11y_set_value` over coordinate clicks when the target is accessible.
- Re-check visible state after meaningful changes using screenshot or a11y inspection.
- Maintain awareness of focus, active window, modal changes, and newly revealed UI state.
- If the application uses multiple steps, confirm each step before moving to the next.

**Do not:**
- chain multiple uncertain interactions without checking the result
- confuse attempted input with successful state change
- continue acting after the UI has clearly diverged from the expected state

**Exit condition:** The intended interaction has produced an observable application change, or the exact interaction blocker is known.

**On failure:** If interaction does not produce the intended visible effect, return to Map or load `recovery/element-not-found.md` / `recovery/stall-detected.md` as appropriate.

---

### Phase: Verify
**Entry condition:** One or more intended interactions have been completed and resulting app state is visible.

**Instructions:**
- Confirm whether the requested GUI outcome actually occurred.
- Check visible application state using screenshot, `a11y_find`, or `verify_window_title`.
- Distinguish between partial advancement and full completion.
- If the task is incomplete, identify the exact remaining step rather than claiming success.

**Do not:**
- claim success because clicks or keystrokes were sent
- treat a changed screen alone as proof of completion
- ignore visible warnings, missing fields, disabled states, or blocked dialogs

**Exit condition:** The requested desktop outcome is confirmed from resulting application state, or the exact remaining blocker is identified.

**On failure:** If verification fails or reveals drift, return to Identify or Map as needed. If repeated loops occur, load `recovery/stall-detected.md`.

## Success Contract

Use: `contracts/desktop-task-done.md` for ordinary GUI workflows.
Use: `contracts/app-mapping-done.md` for app mapping tasks (routed via `app-mapping-phase1` or `app-mapping-phase2` task files, not this one).

Before the task is considered complete:
- the intended application and window were actually identified
- the required GUI controls or regions were mapped before interaction
- the resulting application state was checked after interaction
- success was confirmed from visible or system-backed evidence
- unresolved ambiguity was reported rather than hidden

## Common Failure Modes

- wrong window or dialog was targeted
- control looked correct but belonged to a different UI region
- attempted interaction was mistaken for successful state change
- modal or popup changed the workflow unexpectedly
- coordinate assumptions drifted from actual layout
- task advanced partially and was reported as complete

## Completion Standard

A desktop automation task is complete only when the requested application-visible outcome has been confirmed, or when the exact blocker preventing completion is clearly identified.

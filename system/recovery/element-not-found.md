# Recovery: Element Not Found

Use this playbook when an expected browser or desktop element cannot be found, cannot be targeted reliably, or no longer appears where the task assumed it would be.

## What Counts as Element Not Found

This recovery applies when:
- the expected button, field, control, or label is absent
- a previously visible element no longer appears
- multiple ambiguous elements match the same rough description
- the target exists visually but is not reliably identifiable from the current method
- a dynamic page or UI state changed and invalidated the expected target

## Core Rule

Do not keep using the same target assumption once it has failed.

Re-ground the interface, determine whether the target is missing, renamed, moved, hidden, disabled, or replaced, and then take one deliberate next step.

## Diagnosis Checklist

### 1. Is the current page or window still the correct one?
- Did the interface change between the last confirmed step and now?
- Is the agent still on the expected page, dialog, tab, or application window?
- Was the workflow redirected, collapsed, or advanced unexpectedly?

If not, restore certainty about the current location before searching again.

### 2. Is the target actually missing or just differently presented?
Check whether the target may now appear as:
- different wording
- icon-only control
- nested menu item
- dropdown option
- modal content
- newly revealed section
- disabled or hidden control
- accessibility label rather than visible text

Do not assume identical wording is required.

### 3. Is the search scope too broad?
- Are there too many possible matches?
- Is the page cluttered with unrelated controls?
- Is the selected region too wide?

If the target is ambiguous, narrow the search to the relevant section, form group, step, pane, or dialog.

### 4. Did earlier task assumptions become stale?
- Was the target based on a guessed selector or rough memory?
- Did the page change after a prior action?
- Was the field or control expected before the UI was fully ready?

If assumptions may be stale, re-inspect rather than retry.

### 5. Is the target conditional?
The target may depend on:
- a previous field being filled
- a checkbox or option being selected
- a tab or accordion being opened
- scrolling to a hidden region
- a hover or focus state
- a step transition finishing

Check whether prerequisite UI state is missing before concluding the element is absent.

## Recovery Actions

Choose the smallest action that reduces uncertainty.

Good recovery actions:
- inspect current page or window state again
- narrow the search to the relevant region
- search for semantic alternatives rather than exact text only
- confirm whether prerequisite state must be created first
- return to the prior confirmed phase if mapping is incomplete

Bad recovery actions:
- repeating the same failed selector attempt
- clicking nearby elements blindly
- typing into an uncertain field
- assuming the missing element was successfully activated
- continuing the workflow without the required control

## Decision Tree

### If the current page or window is wrong
Return to the last confirmed location or phase and re-ground.

### If the target seems renamed or moved
Remap the relevant region and identify the new control using labels, role, proximity, and task relevance.

### If the target is hidden or conditional
Establish the missing prerequisite state first, then re-check for the element.

### If the target is truly absent
Treat this as a real blocker. Report what was expected, what was observed instead, and why the task cannot safely continue.

## What to Report

If recovery does not restore a usable target, report:
1. what element or control was expected
2. what step or phase required it
3. what current state was actually observed
4. whether the target appears missing, hidden, renamed, or conditional
5. what exact limitation prevents safe progress

## Completion Condition for This Recovery

This recovery is complete only when one of these is true:
- the correct target has been re-identified with enough confidence to continue
- the task has been returned to an earlier mapping or grounding phase
- the missing element has been clearly classified as a blocker and reported

Do not leave this recovery by retrying the same failed target assumption.

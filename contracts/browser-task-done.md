# Browser Task Completion Contract

This contract defines what must be true before a browser task can be reported as complete.

It applies to browser research, browser workflows, form completion, and other browser-mediated tasks unless a more specific task contract overrides it.

## Core Rule

A browser task is complete only when the claimed outcome is supported by browser evidence, task progress is consistent with the user goal, and no unresolved critical uncertainty remains hidden.

## Completion Checklist

Before reporting completion, confirm all of the following:

### 1. The relevant page or workflow state was actually inspected
- The current page was checked using browser inspection or extraction tools.
- The result is grounded in observed browser state, not assumption.
- The active page or resulting page is the page relevant to the claim being made.

### 2. The task goal was matched against real page evidence
- The claimed outcome corresponds to what the user asked for.
- The browser-visible state supports that the task goal was satisfied or advanced in the claimed way.
- If the task was informational, the answer is supported by extracted page evidence.
- If the task was interactive, the resulting browser state supports the claimed progress or completion.

### 3. Attempted action was not confused with successful outcome

Do not mark the task complete merely because:
- a button was clicked
- text was entered
- a page changed
- a spinner appeared
- a redirect occurred
- a tool call returned without error

Completion requires evidence from the resulting page state.

### 4. Partial progress was not confused with final completion

Check whether the browser task:
- reached the correct final step
- only advanced to an intermediate step
- surfaced unresolved warnings, errors, or missing fields
- requires further review, confirmation, or finalization

If the workflow is only partially complete, report partial completion accurately.

### 5. Evidence is sufficient for the claim

The final claim should be supportable from one or more of:
- current URL and title
- visible page text
- extracted page content
- identified page elements
- visible success, error, or status messaging
- workflow step indicators
- summary or review state after action

### 6. Uncertainty is disclosed

If any important uncertainty remains, state it explicitly.

Examples:
- "The page advanced to the next step, but final submission is not yet confirmed."
- "The information appears present, but the source is incomplete on one point."
- "The click was performed, but the page did not provide clear confirmation."

### 7. Blockers are classified if completion is not possible

If the task cannot be completed, state the exact blocker where possible:
- blocked page or login wall
- missing element
- navigation failure
- workflow loop
- insufficient information on the page
- unresolved validation state

## False Positive Patterns

Watch for these common failure modes:

- claiming a page action succeeded because no tool error was returned
- claiming a form was submitted because the button was clicked
- claiming information was found because a page looked relevant
- claiming a workflow is done because the site moved to another page
- claiming success after partial extraction without checking sufficiency
- reporting completion while visible warnings or missing fields remain

## Required Final Standard

Before final completion, the browser task must satisfy this statement:

> The claimed outcome is consistent with the user goal, supported by browser-visible evidence, and not contradicted by unresolved page state.

If this statement is not true, do not claim the task is complete.

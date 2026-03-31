# Recovery: Replan Required

Use this playbook when recovery guidance has been applied more than once and the task has still not made progress. This is a strategic reset — not another tactical retry.

## What This Means

Two or more recovery injections have occurred without new evidence or forward progress. The current approach is fundamentally blocked. Continuing the same strategy will not help.

## Core Rule

You must change the approach at a strategic level — not just try the same thing again with slightly different parameters.

## Required Actions

### Step 1 — Diagnose honestly
State what has been tried and exactly why it failed. Be specific:
- Not: "the browser didn't respond"
- Yes: "browser_navigate returned a timeout on every attempt to reach that URL"

### Step 2 — Identify the root blocker
Name the actual constraint, not the symptom:
- auth wall (no credentials available)
- network unreachable (DNS failure / blocked)
- element truly absent from DOM (not a selector issue)
- file does not exist and cannot be created (permissions)
- wrong tool for this task type

### Step 3 — Propose a different approach
The new approach must avoid the root blocker entirely — not work around the same wall in a different way. Examples:
- blocked URL → try a cached version, different source, or shell-based fetch
- missing element → re-ground page state from scratch before acting
- file not found → search the filesystem rather than assuming the path

### Step 4 — Execute immediately
Do not describe the new plan without acting on it. Start the first step of the new approach in the same turn.

## If No Alternative Exists

If there is genuinely no viable alternative approach:
- State the exact blocker clearly (what it is, why it cannot be bypassed)
- Stop — do not retry the same approach
- Report to the user with a clear description of what was tried, what blocked it, and what would be needed to proceed

## What Not to Do

- Do not retry the same tool with the same or similar inputs
- Do not restate the problem without proposing a new direction
- Do not interpret unchanged results optimistically
- Do not escalate claims beyond what the evidence supports

# Recovery: Stall Detected

Use this playbook when the agent is repeating the same action pattern without materially improving certainty or task progress.

## What Counts as a Stall

A stall exists when:
- the same tool is called repeatedly with near-identical inputs
- the same page or file is inspected again without a new question
- retries reproduce the same outcome with no new evidence
- the workflow loops between a few states without converging

## Core Rule

Do not continue the same strategy once it has failed to produce new evidence.

Change one of:
- the grounding signal
- the scope
- the tool
- the phase
- the claim being attempted

## Diagnosis Checklist

1. What assumption is being repeated?
- wrong page
- wrong selector
- wrong file
- wrong phase
- wrong success criterion

2. What evidence is missing?
- current page state
- target element identity
- resulting file state
- confirmation of successful completion

3. What is the smallest strategy change that could improve certainty?
- inspect instead of act
- narrow scope
- switch from clicking to direct URL
- return to the last confirmed step
- report a blocker instead of pretending progress

## Recovery Actions

Good recovery actions:
- re-ground current state before acting again
- pick one different strategy and explain why it is different
- stop and report an exact blocker when evidence is not improving

Bad recovery actions:
- another identical retry
- optimistic interpretation of unchanged results
- escalating claims without new confirmation

## Completion Condition

This recovery is complete only when:
- the new strategy produces new evidence
- the workflow returns to a confirmed phase
- the blocker is accurately classified and reported

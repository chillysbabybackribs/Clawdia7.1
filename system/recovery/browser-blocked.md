# Recovery: Browser Blocked

Use this playbook when the browser task is blocked by an access barrier, anti-automation barrier, session barrier, or site-controlled restriction that prevents normal progress.

## What Counts as Blocked

A browser task is blocked when the page or workflow cannot be meaningfully advanced because access or interaction is restricted by the site rather than by simple navigation or element targeting.

Common blocked states:
- login wall
- account or session requirement
- captcha or bot check
- rate limit
- paywall
- permission gate
- geo restriction
- browser compatibility wall
- interstitial that prevents normal inspection or workflow progress

Note: "repeated redirect to an access boundary" is a symptom, not a block type. Classify the underlying reason — it is almost always a login wall or session requirement.

## Core Rule

Do not treat blocked state as ordinary navigation failure.

First classify the block. Then determine whether the task can safely continue, must pause, or must be reported as blocked.

## Classification Checklist

### 1. Login wall
Signs:
- sign-in required message
- forced redirect to login page
- hidden workflow behind account authentication
- page content unavailable without credentials

Action:
- confirm the task is actually gated by authentication
- do not pretend the target content is accessible when it is not
- if the workflow depends on an authenticated session that is not available, report the blocker clearly
- do not navigate to a login page or attempt to authenticate — report the wall and stop

### 2. Captcha or anti-bot check
Signs:
- captcha widget
- "verify you are human"
- behavior challenge
- looping anti-bot interstitial
- challenge page with no meaningful task controls

Action:
- identify this as an anti-automation barrier
- do not treat it as an ordinary missing element or timeout
- do not claim the workflow can continue normally unless the barrier is visibly cleared

### 3. Rate limit
Signs:
- "too many requests"
- temporary access restriction
- cooldown notice
- request throttling message
- repeated denial after ordinary navigation attempts

Action:
- stop retrying the same request pattern immediately
- confirm whether the site is enforcing a temporary restriction
- report the rate-limit condition rather than masking it as a generic failure

### 4. Paywall or subscription barrier
Signs:
- content preview only
- paid access interstitial
- subscription gate
- locked article or section
- overlay blocking access to full content

Action:
- distinguish partial access from full access
- do not claim information was fully available if only a snippet is visible
- report the limitation if the task requires content beyond the accessible portion

### 5. Permission or policy gate
Signs:
- denied by organization policy
- unsupported browser or environment message
- permission prompt blocks workflow
- access restricted to specific role, region, or account type

Action:
- identify the exact visible restriction
- do not continue as if ordinary page interaction can overcome it
- report the restriction precisely

## Recovery Actions

Choose the smallest action that improves certainty.

Good recovery actions:
- inspect the current page state and visible blocker text
- confirm whether the blocker is transient or structural
- check whether the current session already contains the required access state
- return an exact blocker report when the restriction prevents safe continuation
- if the block appears temporary, state that clearly rather than hiding it

Bad recovery actions:
- repeatedly navigating to the same blocked page
- retrying the same click pattern through an access wall
- pretending restricted content is accessible
- describing the task as complete when only the gate was reached
- escalating into random browsing without a plan

## What to Report

When blocked, report:
1. what the task was trying to reach
2. what visible blocker was encountered
3. whether the blocker is login, captcha, rate limit, paywall, or other restriction
4. whether any partial progress or visible information was still available
5. what exact limitation prevents normal completion

## Completion Condition for This Recovery

This recovery is complete only when one of these is true:
- the blocker has been clearly classified
- the workflow has visibly moved past the block
- the task has been accurately reported as blocked with the exact limiting condition

Do not exit this recovery by simply retrying the blocked path without new evidence.

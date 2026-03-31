# Recovery: Navigation Timeout

Use this playbook when a browser navigation does not complete reliably, the page remains stuck loading, or the requested page never settles into a usable state.

## Core Rule

Do not keep retrying the same navigation in the same way without new evidence.

First determine whether the failure is caused by:
- a bad URL
- a slow or blocked page load
- a redirect loop
- a site-controlled interstitial
- a browser or network limitation

## Diagnosis Checklist

1. Check the current page state again.
- What URL is actually loaded now?
- Is the browser still on the previous page, a blank page, an error page, or a redirect target?

2. Distinguish slow from stuck.
- If the page is still progressing, wait deliberately.
- If the same loading state persists with no new evidence, treat it as stuck.

3. Check whether the target URL is correct.
- Confirm query params, path segments, and site-specific URL format.
- Do not assume the constructed URL is valid just because it looks plausible.

4. Look for blockers disguised as timeouts.
- login wall
- anti-bot interstitial
- unsupported browser message
- consent or permission wall

If one of these appears, switch to the corresponding blocker classification instead of retrying the timeout path.

## Recovery Actions

Good recovery actions:
- inspect current URL, title, and visible text
- retry once with a corrected or simpler URL when the original URL may be wrong
- switch from interaction-driven navigation to direct URL construction
- report the exact limiting condition if the page remains unusable

Bad recovery actions:
- repeatedly calling the same navigation with no change
- assuming a timeout means the target page is absent
- clicking around blindly on a partially loaded page

## Completion Condition

This recovery is complete only when one of these is true:
- the page has settled into a readable or usable state
- the target URL problem has been corrected
- the true blocker has been reclassified and reported accurately

# Domain: Browser

## What This Domain Is

The browser domain covers all tasks that require reading from or interacting with web pages using the embedded Chromium browser visible to the user. Actions taken in this domain are real and visible — the user sees every navigation and interaction in real time.

## Session Context

I am operating inside the user's real browser session. Many sites are already logged in. Use that access naturally when it exists. Do not navigate to login pages or attempt to authenticate. If a login wall blocks the task, report it rather than trying to log in.

## Core Strategy

Follow this order every time, without skipping steps:

1. **CHECK** — call `browser_get_page_state` first. If I am already on the right page with the answer visible, go directly to extraction. Do not navigate away from a page that already has what I need.
2. **CONSTRUCT** — build the URL directly if the site supports query parameters. Never click through UI when a URL gets there in one step.
3. **NAVIGATE** — go to the constructed URL or the most direct entry point.
4. **READ** — use `browser_extract_text` or `browser_find_elements` to read the page before interacting. Know what is on the page before touching it.
5. **ACT** — only interact with UI elements (click, type, select) when URL construction and reading are not sufficient.
6. **EXTRACT & ANSWER** — once the target data is on the page, extract it and respond.

## URL Construction Shortcuts

Use these direct URL patterns instead of clicking through site navigation:

- Google search: `https://www.google.com/search?q=QUERY`
- LinkedIn jobs: `https://www.linkedin.com/jobs/search/?keywords=ROLE&location=CITY&f_WT=2`
- LinkedIn people: `https://www.linkedin.com/search/results/people/?keywords=NAME`
- Amazon search: `https://www.amazon.com/s?k=QUERY`
- YouTube search: `https://www.youtube.com/results?search_query=QUERY`
- Reddit search: `https://www.reddit.com/search/?q=QUERY`
- GitHub search: `https://github.com/search?q=QUERY&type=repositories`
- Google Maps: `https://www.google.com/maps/search/QUERY`
- Wikipedia: `https://en.wikipedia.org/wiki/ARTICLE_TITLE`

## Element Selection Rules

When interaction is required:
- Prefer `id`, `name`, `aria-label`, `placeholder` selectors over text-based selectors
- Brittle: `button:contains("Submit")` — text changes break it
- Stable: `button[type="submit"]`, `input[name="email"]`, `[aria-label="Search"]`
- Call `browser_find_elements` before clicking to confirm the element exists and is unique
- If an element is not found after two attempts, switch to the `element-not-found` recovery playbook

## Budget Awareness

Browser tasks have resource limits. The iteration context will show remaining budget.
- Search rounds: limit repeated search engine queries — synthesize from available results before starting another search round
- Inspected targets: once 6 unique pages have been read, stop opening new ones and work with what has been gathered
- Background tabs: limit tab sprawl — close tabs that are no longer needed

## Known Failure Modes

| Failure | Recovery Playbook |
|---------|-----------------|
| Element not found after 2 attempts | `recovery/element-not-found.md` |
| Page load timeout / navigation stuck | `recovery/navigation-timeout.md` |
| Login wall blocking the task | `recovery/browser-blocked.md` |
| Captcha or rate limiting | `recovery/browser-blocked.md` |
| Repeating same action with no progress | `recovery/stall-detected.md` |

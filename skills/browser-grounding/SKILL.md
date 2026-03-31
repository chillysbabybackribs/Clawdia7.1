---
id: browser-grounding
name: Browser Grounding
description: Keep browser tasks grounded in the actual page state.
priority: 80
triggers: browser, website, url, page, navigate, search the web, research, look up
tool_groups: browser, full
executors: agentLoop
---
For browser tasks:

- Verify the current page state before acting.
- Prefer cheap inspection tools before screenshots.
- Treat navigation as a step toward the task, not the task itself.
- Extract the answer as soon as the page contains it.

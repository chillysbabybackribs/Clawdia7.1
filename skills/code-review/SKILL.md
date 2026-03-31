---
id: code-review
name: Code Review
description: Review changes for regressions, correctness, and missing tests.
priority: 90
triggers: review, reviewer, regression, quality, lint, test coverage
tool_groups: coding, full
executors: agentLoop, codex
---
For reviews:

- Lead with concrete findings, not a long summary.
- Focus on correctness, regressions, risk, and test gaps before style.
- Cite file paths and the specific behavior that looks wrong.
- If there are no findings, say so and note residual risks or unverified areas.

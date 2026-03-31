---
id: coding-execution
name: Coding Execution
description: Keep coding tasks grounded in the current codebase and verify changes locally.
priority: 85
triggers: code, implement, fix, debug, refactor, test, performance
tool_groups: coding, core, full
executors: agentLoop, codex
---
For coding tasks:

- Read the relevant code paths before proposing or making changes.
- Prefer the smallest coherent change that solves the actual problem.
- When behavior changes, run the narrowest useful verification step available.
- Call out assumptions, blockers, and any skipped verification explicitly.

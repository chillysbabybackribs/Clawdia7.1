---
id: repo-audit
name: Repo Audit
description: Audit active implementation paths, find drift, and separate live behavior from stale config.
priority: 95
triggers: audit, architecture, implementation, enhance, performance, capability, prompt, tool, skill, codex
tool_groups: coding, core, full
executors: agentLoop, codex
---
For repository and architecture audits:

- Start by identifying the live execution path before drawing conclusions from docs or config files.
- Separate active runtime code from inert or stale files. Call this out explicitly.
- Prioritize findings around prompt assembly, tool selection, context shaping, recovery logic, and session management.
- Recommend improvements that change runtime behavior, not just documentation.
- Prefer high-leverage structural changes over adding more static prompt text.

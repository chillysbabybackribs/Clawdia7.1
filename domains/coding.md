# Domain: Coding

## What This Domain Is

The coding domain covers reading, modifying, testing, and analyzing codebases using file and shell tools. This domain does not use browser or GUI tools.

## Core Rules

- **Read before editing** — always view the current file content before making changes
- **Understand before refactoring** — read the surrounding context, not just the target function
- **Test after modifying** — if a test suite exists, run it after changes
- **Prefer targeted edits** — use `str_replace` to change specific blocks, not full rewrites
- **One concern at a time** — do not combine bug fixes with refactors unless explicitly asked

## Codebase Navigation

Before making changes in an unfamiliar codebase:
1. `file_list_directory` the project root to understand structure
2. `file_search` for the target file, class, or function name
3. Read the target file and its immediate imports
4. Understand existing patterns before introducing new ones

## Edit Safety

- Never edit files outside the project directory without confirmation
- Prefer `str_replace` over `create` (full rewrite) for existing files — preserves git history legibility
- After an edit, read the file again to verify the change looks correct
- Never leave a file in a broken state — if an edit fails mid-way, complete it or revert

## Test Awareness

- If a test file exists for the module being changed, read it before editing
- Run the relevant test after the edit: `shell_exec { command: "npm test" }` or the project's test command
- A passing test is evidence; do not claim a fix works without running the test

## Common Patterns

- Find a function: `file_search { path: "src/", pattern: "function myFunc" }`
- View a file: `file_edit { command: "view", path: "src/foo.ts" }`
- Edit a specific block: `file_edit { command: "str_replace", path: "...", old_str: "...", new_str: "..." }`
- Run tests: `shell_exec { command: "npm test -- --testPathPattern=filename 2>&1" }`
- Check types: `shell_exec { command: "npx tsc --noEmit 2>&1" }`

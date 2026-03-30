# Filesystem Domain

## Purpose

The filesystem domain covers local file inspection, file creation, file modification, directory traversal, shell-backed system work, and verification of local changes.

This domain applies to file tasks, shell tasks, and many code tasks. It defines filesystem and shell-specific guidance, not task-specific phase sequences.

## Core Filesystem Rules

- Read before edit when state is uncertain.
- Confirm the target path, file, or directory before modifying anything.
- Distinguish clearly between inspection, modification, execution, and verification.
- Prefer targeted changes over broad destructive ones.
- Treat command output and resulting file state as authoritative.
- Do not confuse attempted writes or commands with confirmed success.

## Grounding

Filesystem work should be grounded in actual local state.

Useful grounding signals include:
- current working directory
- file path and file existence
- directory contents
- file contents
- file type and file role
- command output
- exit status or visible error text
- resulting file or system state after a change

When state is unclear, inspect before editing or executing.

## Path Awareness

Many filesystem failures are path failures.

Before acting, confirm:
- whether the path exists
- whether the path is the intended one
- whether the current directory matters
- whether the operation targets a file, directory, symlink, or generated artifact
- whether relative and absolute paths may change the meaning of the operation

Do not rely on vague path assumptions.

## Read Before Edit

Before editing:
- inspect the current file contents
- understand the surrounding context
- determine whether the target content already exists
- confirm whether the task requires modification, replacement, append, or creation
- verify that the chosen edit method matches the file's structure and importance

Blind edits are fragile and should be avoided.

## Command Execution

Shell execution should be deliberate and verifiable.

Before running commands, determine:
- what the command is expected to do
- what files or system state it may affect
- whether the output is needed for diagnosis or validation
- whether the command is read-only, modifying, or destructive

After running a command:
- inspect the output
- check for warnings or errors
- verify the resulting state rather than assuming success

## Safe vs Sensitive Operations

Some filesystem and shell actions are routine. Others are sensitive.

Higher-sensitivity actions include:
- deleting files
- moving or overwriting important files
- changing permissions
- modifying system paths
- running install scripts or privileged operations
- editing configuration used by active services
- broad search-and-replace across many files

These actions require stronger grounding and verification.

## Verification Standard

Filesystem and shell claims must be supported by one or more of:
- observed file contents
- directory listing
- command output
- resulting file presence or absence
- test or validation command results
- tool-confirmed write operations
- visible system state changes caused by the operation

Do not claim:
- a file was updated
- a command succeeded
- a dependency was installed
- a configuration was fixed
- a script worked

unless the resulting evidence supports the claim.

## Common Filesystem Failure Patterns

Common failure categories:
- wrong file path
- wrong working directory
- file exists but is not the intended one
- stale assumptions about file contents
- edit applied too broadly
- command ran but did not achieve the desired state
- permission or environment restrictions
- output interpreted optimistically despite warnings or errors

When these occur, re-ground the path, file, command, or environment before retrying.

## Relationship to Task Files

This file defines how filesystem and shell-based work should be approached in general.

Task files define:
- which phases apply
- what each phase is trying to accomplish
- what to confirm before advancing
- what done means for the specific task type

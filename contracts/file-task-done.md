# File Task Completion Contract

This contract defines what must be true before a file or shell task can be reported as complete.

It applies to file editing, file creation, shell execution, system state changes, and environment operations unless a more specific task contract overrides it.

## Core Rule

A file or shell task is complete only when the intended change or outcome is confirmed by observed local state, not when a tool was called or a command appeared to run.

## Completion Checklist

Before reporting completion, confirm all of the following:

### 1. The target was confirmed before acting
- The file path, command target, or system resource was confirmed to exist before being acted on.
- The current state of the target was read or assessed before modification or execution.
- The task did not proceed on assumed paths, assumed file contents, or assumed system state.

### 2. The action was deliberate and scoped
- The edit, command, or operation targeted exactly what the task required.
- The scope of the action was not broader than the task intended.
- For `str_replace`: the `old_str` was confirmed present in the file before the edit was applied.
- For shell commands: stderr was captured alongside stdout.

### 3. The result was verified, not assumed

Do not mark the task complete merely because:
- a tool call returned without error
- a command exited with code 0
- the edit tool reported success
- a file write appeared to complete

Verification requires reading the resulting state:
- for file edits: re-read the file and confirm the intended change is present
- for new files: confirm the file exists with a directory listing
- for shell operations: run a follow-up read-only check that confirms the system is in the intended state

### 4. No unintended side effects were introduced
- No files outside the task scope were modified.
- No system state changes occurred beyond what the task required.
- If a command had broader effects than intended, they are identified and reported.

### 5. Errors were read and reported, not suppressed
- If a command produced errors or warnings, they were read and their significance assessed.
- Errors that did not prevent the goal from being achieved are noted.
- Errors that indicate the goal was not achieved are reported explicitly — not hidden.

### 6. Partial completion is reported accurately
If the task is only partially complete:
- state what was successfully verified
- state what remains and why
- do not present partial completion as full completion

## False Positive Patterns

Watch for these common failure modes:

- claiming a file was updated because `str_replace` returned success, without re-reading
- claiming a command succeeded because exit code was 0, without checking resulting state
- claiming a package was installed because `apt install` ran, without verifying `which` or import works
- claiming a service was started because `systemctl start` ran, without checking `systemctl status`
- reporting a file path without verifying it is the actual file that was modified
- claiming completion when stderr contained unread warnings or errors

## Required Final Standard

Before final completion, the file or shell task must satisfy this statement:

> The intended change or outcome is confirmed by observed local state — the file, system, or environment is verifiably in the state the task required.

If this statement is not true, do not claim the task is complete.

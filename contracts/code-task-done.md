# Contract: Code Task Done

Run this checklist before delivering a final response for any code task.

## Checklist

### Before Editing
- [ ] The target file(s) were read before modification
- [ ] The change scope was understood — not just the target line but surrounding context

### Edits
- [ ] Every edit was made with `str_replace` (not a full file rewrite) unless a new file was created
- [ ] Every edited file was read back after the edit to confirm the change is correct
- [ ] No file was left in a syntactically broken state

### Verification
- [ ] If a test file exists for the modified module: it was read
- [ ] Tests were run after the edit: `npm test` or project equivalent
- [ ] The test output was read — passing is confirmed, not assumed
- [ ] If TypeScript: `tsc --noEmit` was run and output was read
- [ ] If tests or type checks fail: the failure was diagnosed and fixed, or explicitly reported

### Claim Accuracy
- [ ] No change is claimed to work unless a test run confirmed it
- [ ] File paths in the response are exact
- [ ] If no test suite exists: this is stated explicitly rather than silently omitted

### Response Quality
- [ ] The specific change made is described clearly
- [ ] Any remaining issues or follow-up work are noted

# App Mapping Acceptance Gate

## Goal

The agent may not report `PASSED`, `VALIDATED`, or `Phase 1 complete` unless the artifact set and validation outputs are internally consistent.

## Required Files

These files must exist before Phase 1 can be reported complete:

- `monitor.png`
- `app.png`
- `geometry.json`
- `session.json`
- `notes.md`
- `rough-map.json`
- `validated-map.json`
- `validation-cases.json`
- `validation-results.json`
- `validation-report.md`

## Required Data Integrity Checks

Do not report completion if any of these fail:

- timestamps are valid for the current run
- app window dimensions are positive
- monitor dimensions are positive
- app geometry fits sane monitor bounds
- validated elements fit sane app bounds
- validated elements fit sane section bounds, or the mismatch is explicitly recorded as a structural failure
- no duplicate required ids exist in the validated map

## Required Validation Checks

Do not report completion if any of these fail:

- required safe validation interactions were actually run
- no required validation case remains `pending`
- `validation-results.json` contains actual results, not placeholders
- calibration is recorded if calibration was applied
- no structural remapping was needed during validation

## Required Summary Honesty

Do not report completion if:

- the summary says `PASSED` but required files are missing
- the summary says `PASSED` but required validation cases are still pending
- the summary says `PASSED` but timestamps or bounds are inconsistent
- the summary claims counts or file totals that do not match the actual artifacts on disk

## Final Rule

If the map is promising but these checks are not fully satisfied, report:

- artifacts captured successfully
- mapping partially validated
- Phase 1 not complete yet

Do not convert a partial success into a completion claim.

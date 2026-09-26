# <Roadmap section> — Execution progress

## Approval evidence

- Plan: <relative link>
- Reviewed plan commit and blob/hash: <values>
- User approval statement and verifiable source: <actual statement and source; never invent>
- Approved phases / execution policy / exclusions: <values>
- Material revisions requiring renewed review: <none or details>

## Live state

- Branch / base: <values>
- PR number / dependency: <values>
- Latest implementation candidate: <commit>
- Last verified candidate: <commit>
- Current phase / status: <awaiting approval, implementing, reviewing, CI pending, verified, blocked>

## Evidence by phase

| Phase   | Candidate commit | Local results                   | CI workflow / run IDs / results | Agent review / resolved findings | Status   |
| ------- | ---------------- | ------------------------------- | ------------------------------- | -------------------------------- | -------- |
| <phase> | <SHA>            | <actual results or unavailable> | <evidence>                      | <evidence>                       | <status> |

Record this document's checkpoint commit in the next checkpoint if needed; do not attempt to embed its own hash. Verify required CI for any new branch head before advancing or handing off.

## Blockers and next action

<Unresolved findings, unavailable checks, attempt count, next concrete action, and user decisions needed.>

## Final acceptance audit

<Requirement-to-evidence mapping and honest remaining limitations.>

## Task execution records

Use one compact record per delegated task and attributable lead integration task; retain records on resume. Use unavailable for unobserved values. Apply the skill's execution-tracking rules; do not infer missing usage or savings.

### <task ID> — <phase / role / scope>

- Model / effort: <requested; confirmed or unavailable>
- Start / end / elapsed: <timestamps with timezone; observed wall time or unavailable; known waits/interruptions>
- Usage: <reported values, units, source, accounting scope; or unavailable>
- Outcome / evidence: <result and relative file links or CI run references>
- Retries / follow-ups: <count and related task IDs; environment failures distinguished>
- Corrections / review findings: <substantive rework and resolution, or none observed>
- Observed difficulty: <brief evidence-based note>

## Model-efficiency review

- Coverage and limitations: <unavailable telemetry, unmeasured lead overhead, overlapping tasks, partial run if interrupted>
- Where reasoning/rework mattered: <task IDs and concrete evidence>
- Candidates for a later cheaper-model/lower-effort trial: <task IDs, bounded scope, rationale, review overhead; untested, no savings claimed>
- Recommendation: <retain assignments or propose a separate measured trial; no automatic model change>

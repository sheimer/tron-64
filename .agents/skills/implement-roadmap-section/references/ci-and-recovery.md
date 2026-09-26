# CI verification and recovery

Read the current [testing guide](../../../../docs/architecture/testing.md) and [workflow](../../../../.github/workflows/ci.yml); do not assume the original setup remains unchanged.

## Execution routes

- In a prepared local checkout, install locked dependencies and run the required local checks, including Chromium when available.
- In hosted Work, shell Git may lack credentials even though the GitHub connector can read/write. Use supported connector operations for commits, branch updates, PRs, runs, job logs, and artifacts. Discover available tool schemas instead of assuming CLI or API access.
- When Chromium is unavailable locally, run browser checks in GitHub Actions and record that distinction. GitHub Actions runs the tests; the active agent session orchestrates. This workflow does not install an AI service in Actions or require an API key.
- If no working browser route exists, stop before feature work. Propose a separate, reviewable CI prerequisite package; do not silently omit required coverage.

## Candidate verification

Resolve branch head before each mutation. For connector commits, preserve the base tree, file modes, symlinks, and unrelated files. Use the current parent and a non-forced ref update. If the remote advanced, fetch and reconcile changes safely; do not overwrite them.

Match CI to repository, branch, candidate SHA, workflow, event, and required jobs. Inspect step results and the suite summary, including expected browser suites. A green installation step does not establish browser execution. Check both branch and applicable PR results before final handoff; a PR merge-ref run may test a synthetic merge SHA, so also verify its source head/base relationship.

A missing job can indicate invalid workflow syntax rather than a test failure. Inspect run annotations as well as logs. If tooling cannot expose annotations, use an authorized read route or report the diagnostic gap.

On failure:

1. Fetch the failed job logs and diagnostic artifacts. Identify the failed assertion, runtime error, timeout, or infrastructure fault.
2. Fix the cause within scope; preserve the test's intended strength. Classify unrelated failures honestly instead of calling the phase verified.
3. Rerun affected local checks and obtain independent testing/re-review of substantive code or test changes, then push a follow-up candidate and inspect its exact run. Earlier review does not validate a changed final diff.
4. Rerun unchanged CI only for evidence of a transient infrastructure problem. Do not retry a deterministic failure until it happens to pass.

After three unsuccessful fix/verification attempts for the same unresolved issue, or two unchanged infrastructure retries, checkpoint and explain the blocker with evidence and proposed options. Continue with a materially different supported diagnosis when it can resolve the issue; do not enter an unbounded retry loop. Poll with reasonable intervals and provide progress updates without claiming background execution beyond the active session.

## Checkpoints

Use the plan's companion progress document. Record what is verified, not just what was written. Keep credentials, secrets, raw token-bearing messages, and sensitive logs out of tracked files. Repository document links must be relative; store commit and run IDs as plain identifiers rather than embedding machine paths or absolute repository URLs.

At each pause record:

- Approval source/revision and allowed scope.
- Branch, last verified commit, latest candidate, CI run IDs/statuses.
- Completed/in-progress phases and unresolved review findings.
- Local checks versus remote checks, including unavailable coverage.
- Exact next action, pending decisions, and existing PR number.

If limits interrupt execution, no skill can guarantee continued background work. Save checkpoints at normal boundaries rather than assuming a last-minute write will be possible. Resume from remote evidence, not memory alone.

## Proven repository baseline

The CI prerequisite was verified on candidate `d3bcb74601ac8faf316980cbcf407c6c40995638`: push run `36123206998` and PR run `36123209652` passed all 12 suites. Run `36122959508` demonstrated intentional failure propagation, accessible job logs, and a downloadable diagnostics artifact; its temporary failure probe was removed. These are historical evidence, not substitutes for checking the current branch.

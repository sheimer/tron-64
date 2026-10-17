# Accurate room membership and cleanup — Execution progress

## Approval evidence

- Plan: [implementation plan](2026-10-17-accurate-room-membership-and-cleanup.md).
- Reviewed revision: commit `d37d417bd793827a9f3b9b5eb746042eb75ba2b8`, plan blob `74032f7d3eddaf91390ad2fdbad00217e4b3f15a`.
- Verifiable source: the user in this task's conversation approved the proposed defaults on 2026-10-18 at 00:02 Europe/Berlin: “are approved. so in general you might proceed, but before” requesting a short explanation. After that explanation and a separately authorized roadmap documentation commit, the user explicitly instructed at 00:20 Europe/Berlin: “now you can orchestrate the implementation, please :)”. These statements together approve the reviewed plan and its implementation workflow.
- Approved phases: all three, sequentially, with separate implementation/testing/review agents, feature-branch commits/pushes, exact-candidate GitHub Actions verification and a final PR. Merge and deployment remain reserved for the user.
- Exclusions: heartbeat detection, wider network hardening, scoring changes, slot relinquishing/owner transfer, archives, UI redesign and any old-version wire compatibility. Retain five-minute expiry, 60-second checks, existing credentials and snapshot format.
- Material revisions requiring renewed review: none.

## Live state

- Branch: `feat/accurate-room-membership-and-cleanup`; base `main` at `30f0356068bcc873fdc92b8e5c78fc776baf60b4`.
- Starting head: `c006c4822bb23abef74d829ab9c44d5abce635d7` (approved roadmap rationale documentation).
- Existing PR/dependency: none at preparation.
- Latest implementation candidate: `8cb70e1a8b62cacaeaa15d152e9038ecf6809ae9` (Phase 3; repair 1 in progress).
- Last verified implementation candidate: `2716d086e602f5e15a3e7dfc673de2cc6b23eda8` (Phase 2). Approval checkpoint `c3c3af6` passed Tests run `39074867491` / job `117519804698`, with 34 suites and real Chromium journeys.
- Status: Phase 3 repair 1 independently verified; publishing repaired candidate for real Chromium CI.
- Local dependencies: `npm ci` succeeded on Node 24.19.0. Shell Git pushes lack authentication; supported GitHub connector writes are available and already proven. Preserve unrelated files and symlink modes in connector commits.

## Evidence by phase

| Phase                                   | Candidate | Local results                                                                                         | CI evidence                                                                                                  | Independent review                                            | Status               |
| --------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | -------------------- |
| 1: Membership and departure             | `c1b38ca` | All Node suites passed; required local browser launch unavailable; scoped checks and benchmark passed | Tests `39075570744` / job `117521894492`: 35 suites passed, zero failed; required Chromium journeys executed | P1-T strengthened tests; P1-R no blocking findings            | Verified             |
| 2: Expiry and destruction               | `2716d08` | All Node suites and scoped checks passed; local Chromium missing                                      | Tests `39076752813` / job `117525379528`: 36 suites passed, zero failed; required Chromium executed          | P2-T strengthened tests; P2-R no blocking findings            | Verified             |
| 3: Browser acceptance and documentation | `8cb70e1` | Node/fixture/scoped checks pass; local browser unavailable                                            | Push `39077930919` / PR `39077934710`: 36 passed, new browser journey failed score projection assertion      | P3-T and P3-R complete; repair returned to independent checks | Repair 1 in progress |

## Blockers and next action

Baseline `c006c48`: Tests push run `39074615251`, job `117519091953`, passed 34 suites with zero failures; inspected logs prove ownership and round-authority Chromium journeys. Local Chromium launch failed because its executable is missing; download returned invalid/truncated archives. Use local Node checks and exact-candidate CI for required browser coverage. P1-I implementation, P1-T independent tests and P1-R independent review are complete. Phase 1 candidate `c1b38ca` passed exact-candidate CI with 35 suites, zero failures and real Chromium journeys. Administrative checkpoint `94f482f` passed Tests run `39075747204` / job `117522417931` (35 suites, required Chromium). P2-I, P2-T and P2-R completed implementation, independent testing and review. Global lint, scoped formatting, documentation links and whitespace passed. Phase 2 candidate `2716d08` passed exact-candidate Tests CI with 36 suites and zero failures including required Chromium. Administrative checkpoint `f306535` passed Tests `39076930538` / job `117525905625`, 36 suites and required Chromium. P3-I implementation, P3-T independent testing and P3-R review are complete. Next: publish Phase 3 candidate, prove the new required Chromium journey in exact-candidate CI, then finalize roadmap/plan/progress and PR. No runtime Phase 3 changes were needed. Global JavaScript lint, documentation links and diff whitespace also passed. No product decision is pending.

## Final acceptance audit

Phase 1 membership/admission/departure and packet-isolation requirements are verified by the strengthened real-socket suite, existing ownership/authority regressions, and exact-candidate CI. Phase 2 expiry, destruction, external reference cleanup, storage limitations and exact-instance safety are verified by controlled regressions, independent test/review and passing full CI. New browser membership journeys remain Phase 3.

## Task execution records

Record delegation timestamps and actual outcomes here. Usage/token telemetry and attributable monetary costs are unavailable unless explicitly supplied by the runtime; do not infer them from elapsed time.

### P1-I — Phase 1 / implementation

- Requested via spawn controls: `gpt-6.1-sol` / `high`; worker could not introspect actual model/effort, so actual selection is unverified.
- Worker-reported first timestamp: 2026-10-17T22:22:49Z; handoff 2026-10-17T22:27:15Z; observed worker interval 4m26s, not compute time. Earlier delegation/orchestration overhead is unmeasured.
- Scope: Phase 1 runtime membership/departure, migrated fixtures, socket regressions and relevant docs.
- Usage: unavailable.
- Outcome: runtime/fixture/docs implementation ready; affected Node suites and scoped lint/format passed. Full isolated `npm test`: 32 runner-passed / 3 failed, 15.300s; all Node suites passed, three required browser suites failed only for missing Chromium, optional client-leak skipped browser execution. Server GC +0.238 MB. Quick benchmark: 50 rooms / 200 players, mean jitter 0.30ms, p95 1.13ms, max spike 1.65ms. Independent test/review and CI still pending.
- Corrections: three curly-brace ESLint findings in the new test corrected before handoff. One lead follow-up highlighted stale routing/current-room index safety; no model or cost comparison.

### P1-T — Phase 1 / independent testing

- Requested via spawn controls: `gpt-6.1-sol` / `high`; actual model/effort introspection unavailable.
- First worker-observed clock: 2026-10-17T22:28:12Z, after initial reads; final verification 2026-10-17T22:30:23Z. Observed interval 2m11s excludes initial reads and is not compute time.
- Scope: challenge Phase 1 acceptance, real socket regressions, missing cases and local checks. Only test changes allowed.
- Usage: unavailable. Outcome: strengthened only `test/room-membership.test.js` with cap spectator retries, target state preservation, leave-to-lobby packet isolation, routing-only authorization denial, successful-switch cancellation/preservation, mixed invalid proof and fresh monotonically allocated handles. Eight relevant Node suites and final scoped lint/format/diff checks passed. No blocking runtime finding; no installer/full-suite/benchmark repeats. One lead follow-up requested final handoff timing; no corrective runtime follow-up.

### P1-R — Phase 1 / independent review

- Requested via spawn controls: `gpt-6.1-sol` / `xhigh`; worker introspection pending.
- First worker-observed start 2026-10-17T22:30:50Z; end 22:32:31Z; observed interval 1m41s, not compute time.
- Scope: read-only review of approved Phase 1 contract and final runtime/tests/docs diff; authorization, cleanup, idempotence and rejection atomicity.
- Usage: unavailable; actual model/effort introspection unavailable. Outcome: no blocking Phase 1 findings. Reviewer inspected final runtime, fixtures, regression and documentation; no assertion weakening. Residual requirement: exact-candidate CI including real Chromium before Phase 2. No corrective follow-up required.

### P2-I — Phase 2 / implementation

- Requested via spawn controls: `gpt-6.1-sol` / `high`; actual introspection pending.
- Delegation boundary: 2026-10-17T22:38:17.870453+00:00; worker times pending.
- Scope: membership-driven idle timing, idempotent exact-instance disposal, timer/callback/external reference cleanup, controlled-clock regressions and docs.
- Usage and actual model/effort introspection: unavailable. Last worker-observed timestamp 2026-10-17T22:45:54Z; first clock read 22:43:43Z occurred after implementation began, so exact elapsed unavailable.
- Outcome: controlled cleanup and affected Node suites passed; final full suite 33 runner-passed / 3 missing-Chromium failures in 14.484s, optional browser leak skipped. All Node suites passed; server GC +0.245 MB under unchanged threshold. Scoped lint/format/diff passed.
- Corrections: full suite exposed expired creation-request semantics after deleting retries; bounded credential-free tombstones preserve unchanged REQUEST_ID_CONFLICT assertion. Preserved omitted-hook callback installation behavior. Lead follow-ups highlighted captured callback/other-room index protection and preserving personalized deletion notices. No scope/protocol change. Independent test/review and CI remain pending at handoff.

### P2-T — Phase 2 / independent testing

- Requested via spawn controls: `gpt-6.1-sol` / `high`; actual introspection pending.
- Delegation boundary: 2026-10-17T22:46:02.800750+00:00; worker times pending.
- Scope: controlled cleanup contract, stale callbacks, exact-instance safety, persistence and personalized deletion tests. Test changes only.
- Usage and actual model/effort introspection: unavailable. Worker-observed interval 2026-10-17T22:46:29Z–22:48:30Z (2m01s), not compute time.
- Outcome: strengthened only `test/room-cleanup.test.js`; nine affected Node suites and scoped lint/format/diff passed. Added offset-departure cadence, actual cold-restore/read-only deletion and byte protection, stale callbacks/buffers/detached owners, private replacement isolation, real routing/handle/retry cleanup, monotonic continuing socket handles, silent rollback and nonempty stale binary draw assertions. No blocking runtime findings, weakened assertions, full-suite/browser repeats or runtime edits.

### P2-R — Phase 2 / independent review

- Requested via spawn controls: `gpt-6.1-sol` / `xhigh`; actual introspection pending.
- Delegation boundary: 2026-10-17T22:48:29.796256+00:00; worker times pending.
- Scope: read-only final Phase 2 lifecycle/ownership/persistence/callback/retained-reference review.
- Usage and actual model/effort introspection: unavailable. Worker-observed interval 2026-10-17T22:48:48Z–22:50:46Z (1m58s), not compute time. Outcome: no blocking findings after complete runtime/docs diff and 773-line cleanup suite review. Independently ran cleanup test and whitespace check successfully. Residual requirement: exact-candidate Chromium CI. No corrective follow-up required.

### P3-I — Phase 3 / implementation

- Requested via spawn controls: `gpt-6.1-sol` / `high`; actual introspection pending.
- Delegation boundary: 2026-10-17T22:56:45.985452+00:00; worker times pending.
- Scope: real independent-context membership browser journey, isolated production-clock expiry fixture and relevant docs. Runtime remains stable unless a demonstrated in-scope bug requires lead coordination.
- Usage and actual model/effort introspection: unavailable. First worker clock 2026-10-17T22:59:58Z after work began; final check 23:01:44Z; exact elapsed unavailable.
- Outcome: required independent-context Chromium journey and private 76-line IPC fixture plus testing/lifecycle/Changelog docs. Private IPC smoke proved production startup, target creation, retention at 299999ms, inclusive expiry at 300000ms and actual snapshot deletion. Full local suite: 33 runner-passed / 4 required missing-Chromium failures, 14.616s; optional browser leak skipped, all Node suites passed, server GC +0.245 MB. Scoped lint/format/diff passed. Browser behavior remains unexecuted locally; exact-candidate CI required. No runtime edits or browser bypass.

### P3-T — Phase 3 / independent testing

- Requested via spawn controls: `gpt-6.1-sol` / `high`; actual introspection pending.
- Delegation boundary: 2026-10-17T23:01:59.512399+00:00; worker times pending.
- Scope: challenge real browser journey assertions, IPC fixture bounds/isolation and diagnostics; meaningful test improvements only.
- Usage and actual model/effort introspection: unavailable. Worker finished approximately 2026-10-17T23:05Z; exact start and elapsed unavailable.
- Outcome: strengthened browser journey with creator-alone 300000ms activity, matching completed-score/timer gates, recovered browser roster/scores, correlated barriers before isolation baselines and both bike contexts checked before expiry. Syntax, scoped lint/format/diff passed. Independent real-WebSocket fixture smoke proved creator activity, last-leave boundaries and snapshot deletion. Initial smoke used `/` rather than `/ws`; corrected and passed.
- Two lead follow-ups examined repeated-join freshness; source proved the existing pendingJoin/private-result gate sufficient, so no redundant wait was added. No runtime/docs edits, browser bypass or broad repeats. Browser acceptance remains pending CI.

### P3-R — Phase 3 / independent review

- Requested via spawn controls: `gpt-6.1-sol` / `xhigh`; actual introspection pending.
- Delegation boundary: 2026-10-17T23:05:14.184736+00:00; worker times pending.
- Scope: read-only final browser journey, isolated fixture and final lifecycle/testing docs; check acceptance, timing, diagnostics and no assertion weakening.
- Usage and actual model/effort introspection: unavailable. First worker clock 2026-10-17T23:05:53Z after review began; end 23:07:02Z; exact elapsed unavailable.
- Outcome: no blocking findings after final diff, both test files and relevant production paths. Async gates/barriers, required browser failure behavior, bounded IPC/physics/cleanup, coverage and credential-safe diagnostics were sound. Independently passed scoped ESLint/Prettier and whitespace checks. No edits. Residual requirement: exact-candidate real Chromium acceptance.

### P3-I-F1 — Phase 3 / CI repair 1

- Parent task P3-I; requested Sol/high retained, actual introspection unavailable.
- Delegation boundary: 2026-10-17T23:12:45.042516+00:00; worker times pending.
- Evidence: push job `117528850083` and PR job `117528861722` fail the same new-browser comparison at line 402. Browser-rendered score rows carry UI-only `_rank`/`_rankLabel`; authoritative score values match.
- Scope: diagnose production score annotation and correct test comparison without dropping authoritative score/recovery coverage; no runtime changes or unchanged CI retries.
- Usage and actual model/effort introspection unavailable. Worker-observed 2026-10-17T23:12:32Z–23:13:14Z (42s). Only durableScores test projection changed to omit existing connection flag and UI rank annotations; every remaining score field/messages/gamecount still exact. Scoped lint/format, scoreboard suite and direct helper sensitivity/immutability checks passed. P3-T recheck 2026-10-17T23:13:35Z–23:13:54Z passed actual helper sensitivity against production sorter and frozen sources: all authoritative fields, future fields, gamecount/messages still detect changes. P3-R re-review 23:13:40Z–23:13:50Z found no blocking issue and confirmed all other assertions unchanged. Both scoped checks passed; no writes. Actual model/effort/usage unavailable. Repaired-candidate CI remains required.

## Model-efficiency review

Pending completed task evidence. Requested roles follow the repository: GPT-6.1 Sol/high implementer and tester; GPT-6.1 Sol/xhigh reviewer. The lead retains the current session model. No cheaper-model trial or savings claim is authorized or made.

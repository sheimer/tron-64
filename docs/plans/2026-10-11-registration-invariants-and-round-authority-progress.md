# Registration invariants and round authority — Execution progress

## Approval evidence

- Plan: [implementation plan](2026-10-11-registration-invariants-and-round-authority.md).
- Reviewed plan commit: `302a9859b77ecca890254b24a3ca381c9e66ac49`.
- Reviewed plan blob: `a1c56c375235b0ac3846d592c09023f4bc7cfbf2`.
- User approval: “very well :) you can go on orchestrating the implementation :)”. Source: user's message in the active conversation on 2026-10-11, after the strict single-current-version refinement.
- All four phases, proposed defaults, independent agents, feature-branch commits/pushes, exact-candidate CI, and reuse/update of PR #5 are approved. Merge/release/deployment, automatic owner election, compatibility handlers, broader membership/reaping, scoring, network limits, accounts, and other exclusions remain outside scope.
- Material revisions requiring renewed review: none.

## Live state

- Branch: `feat/registration-invariants-and-round-authority`; base `main` at `8f89e08235cf042abb1df346399a0343f1ae0666`.
- PR: #5, existing draft; no unmerged dependency.
- Latest published implementation candidate and last verified branch head: `28a6c9bfde7593e65ddd7bf28d413e7da3e0c5b7` (Phase 1 plus reviewed fixture repairs).
- Current phase: Phase 1 verified; Phase 2 implementation and independent tests frozen, final review completed without blockers; candidate CI pending.
- Isolated full checkout preserves `AGENTS.md` as the `GEMINI.md` symlink. No user changes were present in this checkout; changes on the user's other machines are not visible.

## Evidence by phase

| Phase     | Candidate commit                           | Local results                                                                          | CI workflow / run IDs / results                                                                                                                                                | Agent review / resolved findings                                    | Status      |
| --------- | ------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ----------- |
| Readiness | `302a9859b77ecca890254b24a3ca381c9e66ac49` | Node 24.19.0; locked `npm ci` succeeded                                                | Tests push `38140410169`, job `114472954882`; PR `38140413340`, job `114472964133`: both 23 passed / 0 failed, browser-smoke, ownership-flow and client-leak actually executed | Current branch/PR heads and job logs inspected                      | Verified    |
| 1         | 28a6c9bfde7593e65ddd7bf28d413e7da3e0c5b7   | 23 executed local passes / 2 missing-Chromium failures / 1 skip; scoped checks passed  | Push 38145291262 / PR 38145295223: both 26 passed / 0 failed, three real browser suites                                                                                        | Independent tests/review passed; two CI repairs verified            | Verified    |
| 2         | Pending                                    | 25 executed passes / 2 missing-Chromium failures / 1 optional skip; scoped checks pass | Pending                                                                                                                                                                        | Independent testing and final max review found no remaining blocker | CI pending  |
| 3         | Pending                                    | Pending                                                                                | Pending                                                                                                                                                                        | Pending                                                             | Not started |
| 4         | Pending                                    | Pending                                                                                | Pending                                                                                                                                                                        | Pending                                                             | Not started |

Record administrative checkpoint commits in the next checkpoint; never embed this document's own commit hash. Verify exact-head CI before advancing.

Approval checkpoint `f23e443dd09f40a403449a3495e2fa0e7767f844` passed Tests push `38142088056` (job `114477846514`) and PR `38142090835` (job `114477854870`): both 23 passed / 0 failed, all three required browser suites executed. It changed only approval/status documentation; its success does not verify the pending Phase 1 runtime diff.

Phase 1 candidate `2390d3737ac5c7e3e1ab7529c4226d415e5d4ecb` preserved all unrelated tree entries and the `AGENTS.md` symlink, and failed Tests push `38143434216` (job `114481782494`) and PR `38143437972` (job `114481792797`): both 24 passed / 2 failed with real Chromium. Browser smoke accepted reset dots as gameplay before the one-second durable launch, then changed bindings/closed the creator during countdown. Cancellation left the first-round configuration intact; its later scoreboard-start wait was invalid. The repair now requires committed `firstRoundStarted` and server `running` before transfer, then proves retained-only reconnect has one eligible bike and disabled later start before explicitly recovering both bikes. Client-leak completed its first metric cycle, then its second arena wait timed out. Independent controlled-time callback diagnosis reproduced an old score reveal hiding the new room's arena; the fixture now completes each matching finished round before teardown, while full generation guards remain Phase 2. Assertions, cycles and metric thresholds are preserved. One failed published candidate, no unchanged CI retries. Diagnostics artifact `11704156274`, smoke trace and job logs were inspected.

First repair candidate `aeb8945ea0add6eebee3f2a09adc21425bd5d461` also failed Tests push `38144459426` (job `114484790058`) and PR `38144462868` (job `114484800457`): both 24 passed / 2 failed with real Chromium. The durable-launch predicate returned in milliseconds, and leak cycle 2's first round appeared finished in 321 ms. Independent inspection and execution of the installed Playwright poller showed the common cause: `waitForFunction` treats an async predicate's Promise as immediately truthy, even when it resolves false. The first repair's added async predicates therefore did not poll. The second package will await module setup, use synchronous predicates across all three existing browser suites (including previously passing ownership coverage), and guard against async predicates. Earlier source diagnoses were incomplete; full callback cancellation still remains Phase 2. Two failed published candidates; no unchanged CI retries. New diagnostics artifact `11703748866` and both job logs were inspected.

## Blockers and next action

No product or access blocker. Publish the independently tested/reviewed Phase 2 candidate and require exact-candidate push/PR CI, including all three actual browser suites, before Phase 3. Keep minimum-roster assertions and all leak thresholds. Preserve strict protocol version checks and reload guidance throughout.

Local Chromium launch failed because the Playwright executable is missing. One installation command failed with invalid/truncated archives on all of its internal download retries. This is an environment failure; local browser coverage is unavailable. Required browser checks will run in Actions, with assertions and prerequisite failures preserved.

## Final acceptance audit

Pending. No roadmap implementation items are complete yet.

## Task execution records

Requested settings: Sol 6.1/high implementation and testing, Sol 6.1/xhigh review. Spawn controls expose those settings; independent actual model/effort and token/usage telemetry are unavailable unless reported by the runtime. Wall time is observational and includes tool/CI waits; it is not compute time.

### phase1_implement — Phase 1 / implementer

- Scope: approved creator identity/admission/speed contract, minimum pending latch, current protocol bump, minimal client proof storage, tests/fixtures and landed architecture documentation.
- Model / effort: requested `gpt-6.1-sol` / `high`; spawn accepted; independent actual settings unavailable.
- Start observation: 2026-10-11T13:08:04Z UTC, shortly after delegation; precise spawn timestamp unavailable. Frozen/end: 2026-10-11T13:19:36Z UTC. Observed window 11m32s; full task elapsed unavailable because delegation preceded the observation.
- Usage: unavailable; runtime does not expose task token accounting here.
- Outcome / evidence: creator/admission/speed runtime, current version 3, affected fixtures and docs frozen; domain/client/affected tests and scoped checks pass. Full `npm test` actual results: 23 executed passes, two missing-Chromium failures, one browser skip (aggregator 24/2).
- Follow-ups/corrections: fixed two unintended registration-helper return replacements detected on initial fixture runs; guarded omitted creation payload hashing, completed owner acknowledgement/finish-state assertions, and preserved bike-only handover fixtures. No failed published implementation candidate yet.
- Observed difficulty: independent creator and bike credentials, transactional admission, launch durability and cross-file fixture updates.

### phase1_test — Phase 1 / independent tester

- Scope: independent real-socket acceptance suite, rejection/transactionality/privacy checks, then final-diff coverage assessment and local verification.
- Model / effort: requested `gpt-6.1-sol` / `high`; spawn accepted; independent actual settings unavailable.
- Start / end: 2026-10-11T13:11:40Z–13:20:53Z UTC; observed wall time 9m13s including tool execution/waits.
- Usage: unavailable.
- Write ownership: [round-authority acceptance suite](../../test/round-authority-acceptance.test.js); all runtime and existing tests read-only while implementer works.
- Outcome / evidence: controlled-clock real-WebSocket [acceptance suite](../../test/round-authority-acceptance.test.js) passed, including creation cache pressure, mixed claims, both resource preflights, owner-only exhausted-budget recovery, launch durability, state/timer preservation and recipient-specific privacy. Final source/diff assessment found no Phase 1 code blocker. Owned-file ESLint, Prettier and diff checks passed. Independent full `npm test` actual results: 23 executed passes / 2 absent-Chromium failures / 1 browser skip; 18.775s (aggregator 24/2).
- Follow-ups/corrections: final frozen-diff verification requested after implementer handoff; no runtime fixes requested by tester.
- Observed difficulty: test independent owner/bike proofs and authority from externally observable socket behavior.

### phase1_review — Phase 1 / independent reviewer

- Scope: final frozen runtime, client, new/changed test and architecture diff against the approved Phase 1 contract.
- Model / effort: requested `gpt-6.1-sol` / `xhigh`; spawn accepted; independent actual settings unavailable.
- Start / end: 2026-10-11T13:20:38Z–13:26:12Z UTC; reported observed wall time 5m34s, including checks/waits.
- Usage: unavailable.
- Outcome / evidence: final source and all four new files reviewed. Domain, real-socket acceptance, client-creation and client-reconnect suites independently passed. A P2 browser fixture blocker was identified before publication: the leak fixture expected automatic credential pruning despite the new retention contract. Its correction resolved the blocker by inspection; no other Phase 1 blocker. Actual Chromium execution remains a candidate CI gate.
- Observed difficulty: authorization and persistence ordering, independent credentials, immutable rejection behavior and phase boundaries.

### phase1_implement.1 — Leak-fixture correction

- Model / effort: requested `gpt-6.1-sol` / `high`; accepted; independent actual settings/usage unavailable.
- UTC window: 2026-10-11T13:23:53Z–13:24:37Z, 44s observed wall time.
- Outcome: adapted [client-leak fixture](../../test/client-leak.test.js) and [testing guide](../architecture/testing.md) to observe real list removal, retain owner/bike proof, and explicitly retire only a destroyed test record before GC. All original lifecycle and leak thresholds preserved; no runtime edits.
- Checks: scoped ESLint/Prettier/diff checks passed. Browser launch unavailable; local skip is not coverage.
- Difficulty/correction: stale browser-only fixture assumption hidden by the local environment failure; this follow-up resolves the review finding without changing product policy.

### phase1_test.1 — Independent fixture verification and stronger assertion

- Model / effort: requested `gpt-6.1-sol` / `high`; accepted; independent actual settings/usage unavailable.
- UTC window: 2026-10-11T13:24:09Z–13:27:13Z, 3m04s observed wall time including handoff/waits.
- Outcome: verified unchanged heap/DOM/node/listener thresholds and journey, then added exact pre/post saved-record equality and both-copy cleanup assertions. Only assigned browser test changed; runtime read-only.
- Checks: scoped lint/format/diff passed; local Chromium still unavailable. Ready for exact-candidate CI.

### phase1_review.1 — Final affected-delta review

- Model / effort: requested `gpt-6.1-sol` / `xhigh`; accepted; actual settings/usage unavailable.
- UTC window: 2026-10-11T13:28:02Z–13:28:24Z, 22s observed wall time.
- Scope/outcome: final credential-equality/cleanup assertion and restoration of unrelated original math text independently re-reviewed; no new blocker. Scoped checks passed. No runtime change or repeated suites; Chromium remains the CI gate.

### phase1_implement.2 — First candidate CI repair

- Requested model / effort: Sol 6.1/high; actual settings/usage unavailable.
- UTC window: 2026-10-11T13:34:04Z–13:38:47Z, 4m43s observed wall time.
- Scope/outcome: smoke waits for actual durable physics launch and verifies the two-bike restart minimum; leak completes matching finished transitions before the next fixture and includes safe lifecycle diagnostics. Three test/guide files changed, no runtime edits, assertions/cycles/thresholds preserved. Full callback guards remain Phase 2.
- Checks: scoped ESLint/Prettier/diff pass. Full local test aggregator 24/2; actual 23 executed passes, two absent-Chromium failures and one leak skip, 18.457s. Browser correction requires exact-candidate CI.
- Difficulty/correction: source and trace showed reset dots did not establish physics; coordinated fixture sequencing with authoritative launch and reveal state. First published candidate failure, first repair package, no unchanged CI retries.

### phase1_test.2 — Independent CI diagnosis and repair verification

- Requested model / effort: Sol 6.1/high; actual settings/usage unavailable.
- UTC window: 2026-10-11T13:34:19Z–13:40:04Z, 5m45s observed wall time including handoff/checks.
- Scope/outcome: independently inspected trace and frozen diff; reproduced the old score callback with actual coordinator handlers under controlled time. Verified durable-launch gate, explicit two-bike recovery, matching finished waits and unchanged thresholds. No writes or runtime expansion.
- Checks: scoped ESLint, Prettier and diff pass. Full local test actual 23 executed passes / two missing-Chromium failures / one skip, 19.267s (aggregator 24/2). Real browser validation remains the new push/PR CI gate.
- Difficulty: fixture assertions had mistaken countdown/reset drawing for committed physics; cross-room delayed callback diagnosis is separate from missing local Chromium.

### phase1_review.2 — Independent CI-repair review

- Requested model / effort: Sol 6.1/xhigh; actual settings/usage unavailable.
- UTC window: 2026-10-11T13:42:31Z–13:43:55Z, 1m24s observed wall time.
- Outcome: final repair diff and trace inspected; no blocking findings. Durable-launch and explicit recovery assertions preserve drawing/input/revocation coverage; three leak cycles with two rounds each and all thresholds remain intact. Safe diagnostics contain no credentials. No runtime edits.
- Checks: scoped ESLint, JavaScript Prettier and diff pass. The unrelated baseline math escape was reverted before publication. Exact-candidate real-Chromium CI remains required.
- Follow-up: first CI repair package independently re-reviewed; Phase 2 must retain adversarial callback/cancellation coverage.

### phase1_implement.3 — Second CI-repair package

- Requested model / effort: Sol 6.1/high; actual settings/usage unavailable.
- UTC window: 2026-10-11T13:47:54Z–13:53:57Z, 6m03s observed wall time.
- Scope/outcome: converted 21 async browser waits across smoke/leak/ownership suites into synchronous predicates, awaiting module exposure after every navigation/reload through a shared test helper. All 26 direct gates preserve Playwright polling. A test-scoped ESLint restriction rejects async wait predicates, including future browser suites. Leak verifies a fresh key/name and zero-score/empty-roster server state. No runtime edits or relaxed assertions/cycles/thresholds.
- Checks: all test JavaScript ESLint plus config pass; scoped Prettier/diff pass. Nine-case ESLint check rejects async arrows/functions and accepts synchronous false in all three suites. Full local actual 23 passes / two missing-Chromium failures / one leak skip, 19.329s (aggregator 24/2).
- Difficulty/correction: read installed Playwright source and trace; first repair's Promise-returning waits had bypassed state conditions. Second package after two failed published candidates; no unchanged retries. Independent affected verification/re-review and new exact CI pending.

### phase1_test.3 — Independent second-repair verification

- Requested model / effort: Sol 6.1/high; actual settings/usage unavailable.
- UTC window: 2026-10-11T13:48:13Z–13:54:45Z, 6m32s observed wall time including handoff/checks.
- Outcome: independently reproduced the actual installed poller's async-false behavior with zero repolls, and synchronous-false remaining pending until a later true condition. Verified every navigation/reload exposes current modules and all 26 direct predicates are synchronous, including pixels and ownership. Fresh-room assertions, full stale-control journeys and all three leak cycles/two rounds/thresholds are preserved. No runtime edits; no tester writes.
- Checks: nine-case ESLint contract, all test JavaScript/config ESLint, scoped Prettier and diff pass. Full local actual 23 passes / two missing-Chromium failures / one leak skip, 19.708s (aggregator 24/2); reserved acceptance passes. Recommend exact-candidate CI with all three actual browser suites; no local browser coverage claimed.

### phase1_review.3 — Independent second-repair review

- Requested model / effort: Sol 6.1/xhigh; actual settings/usage unavailable.
- UTC window: 2026-10-11T13:54:20Z–13:57:03Z, 2m43s observed wall time.
- Outcome: final diff/helper and actual installed poller independently inspected/reproduced; no blocking findings. All 26 polling predicates are synchronous without Promise wrappers, current app singletons are exposed after every navigation/reload, and test-wide lint rejects async callbacks. Ownership/drawing/recovery/stale-control assertions, three leak cycles/two rounds and original thresholds remain intact. No runtime changes or credential diagnostics.
- Checks: scoped ESLint, Prettier, in-memory guard checks and diff pass. Original math text preserved before publication. Exact-candidate Chromium CI remains required.
- Correction: reviewer explicitly identified the earlier missed async-predicate cause. Second repair package re-reviewed; no unchanged CI retries.

### Phase 1 verification checkpoint

Candidate `28a6c9bfde7593e65ddd7bf28d413e7da3e0c5b7` passed Tests push `38145291262` (job `114487241923`) and PR `38145295223` (job `114487254520`): both 26 passed / 0 failed. Logs prove actual browser smoke (11.251s / 12.254s), client leak (39.828s / 39.318s) and independent-context ownership flow (2.341s / 2.357s) executed without skips. Final job steps, source head, PR base/head relationship and preserved symlink/tree were inspected. Full suite durations were 68.767s / 69.291s. This completes Phase 1 after two failed published candidates and two independently tested/reviewed repair packages; no unchanged CI retries. Phases 2–4 remain necessary for the final feature.

### phase2_implement — Phase 2 / implementer

- Requested model / effort: `gpt-6.1-sol` / `high`, fresh independent context accepted; actual settings/usage unavailable.
- Scope: cancellable room attempts/timers/readiness, current protocol 4, scoped snapshots/events, client cancellation/race guards, existing regressions/browser coverage and applicable architecture/changelog.
- Write ownership: required runtime and existing tests/docs; exclude tester's two new lifecycle suites and lead plan/progress/roadmap. No commits/pushes.
- UTC window: 2026-10-11T14:02:03.918Z–14:18:43.912Z, 16m40s observed wall window including tools/waits and an interruption of unknown duration; not compute time.
- Outcome: frozen room-owned attempt/readiness/countdown, full-roster cancellation and live-room launch revalidation, protocol 4 scoped wire/snapshots, client cancellation/race guards, current stage/started consistency, meaningful existing socket/browser tests and applicable docs/changelog. Scope stayed in Phase 2.
- Checks: affected authority/ownership/client/lifecycle suites and changed JavaScript ESLint passed. Supported changed-file Prettier and diff passed; whole testing-guide formatting retains one pre-existing math-header warning to preserve its unrelated source. Full local actual 25 passes / two missing-Chromium failures / one optional leak skip, runner 26/2. Final reconnect snapshot fix passed affected checks, and independent tester subsequently ran the exact frozen full suite.
- Corrections: independent stale/reentrant physics regressions drove pre/post-arena-hook generation/timer/live-room guards; tester flagged six-slot configuration `started` inconsistency and stale guide wording, both fixed. Actual browser cancellation/switch/spectator coverage awaits candidate Actions.

### phase2_test — Phase 2 / independent tester

- Requested model / effort: `gpt-6.1-sol` / `high`, fresh separate context accepted; actual settings/usage unavailable.
- Scope: controlled-time server and actual client-handler adversarial lifecycle regressions, acceptance/browser audit and final frozen-diff verification.
- Write ownership: [server lifecycle suite](../../test/round-lifecycle.test.js) and [client lifecycle suite](../../test/client-round-lifecycle.test.js); all other files read-only. No commits/pushes.
- UTC window: 2026-10-11T14:02:35Z–14:20:37Z, 18m02s observed wall time including interruption/waits; interruption timestamp and duration unavailable. Full test runs coordinated to avoid fixed-port/data races.
- Outcome: both independently authored suites pass; no remaining blocking runtime finding in the frozen diff. Actual scheduler and coordinator regressions cover readiness/fallback, both pending stages, cancellation, stale and reentrant physics/reset/score callbacks, persistence failure, immutable rejection and six-slot snapshots. Runtime diff remained unchanged after execution; existing socket/browser additions were audited.
- Checks: frozen full suite exited 1 with 25 executed passes / two missing-Chromium failures / one optional leak skip in 20.976s (runner 26/2). Changed JavaScript ESLint, owned-file Prettier and diff checks passed. Browser verification remains required in Actions.

Phase 2 independent controlled-time tests exposed a concrete queued-physics race: a cleared tick from an old round can execute after a replacement launch, run that new arena and schedule a second tick chain. The tester retained the failing actual-scheduler regression; implementation guards now pass it. Final review used the workflow's `max` escalation for this concurrency issue, with actual runtime settings/usage still unavailable. This is distinct from local Chromium unavailability.

Lead integration also identified the need to revalidate after `arena.run`: a synchronous lifecycle hook can replace a round before the old callback resumes. The tester reproduced advancement/replacement of the new tick timer/deadline and retained that regression. Both pre/post-hook guards now pass the independent actual-scheduler cases, including removed live-room identity. The tester's frozen full suite returned 25 executed passes / two missing-Chromium failures / one optional leak skip in 20.976s (runner 26/2). Both environment failures and skipped coverage remain explicit; exact-candidate browser CI is still required.

At the user's status check on 2026-10-11 around 14:14 UTC (16:14 Berlin), both Phase 2 contexts were marked interrupted. Uncommitted work remained intact; process inspection found no active Node/npm/lint process. The lead resumed the same contexts. The implementer reported its latest command had returned normally and no observed tool hang. Interruption start/duration and cause are unavailable; do not count that interval as compute time. Phase 2 was not yet frozen, committed, reviewed, or verified by CI.

### phase2_review — Phase 2 / independent reviewer

- Requested model / effort: `gpt-6.1-sol` / `max`, fresh independent context accepted. Escalation is grounded in the concrete queued/reentrant physics races above, per the workflow; actual settings/usage unavailable.
- UTC window: 2026-10-11T14:19:42Z–14:24:48Z, 5m06s observed wall time including tools, not compute time.
- Scope: final actual runtime/client/wire/doc diff and both new lifecycle suites against the approved Phase 2 contract, including fixes, transactional admission, attempt scoping, stale callbacks and privacy. All files read-only.
- Outcome: final frozen diff, both untracked controlled lifecycle suites, real-socket acceptance additions and browser journey reviewed without blocking findings. Pre/post-arena-hook scheduler guards, transactional admission, public/persistence projections and strict version-4 wire checks were inspected. Independent local result confirmed from the tester's log; exact-candidate Actions browser verification remains required. No edits or repeated suites; no full/fixed-port test overlap with the independent tester.

## Model-efficiency review

Pending live execution. No cheaper-model trial or savings claim is authorized or inferred. Lead orchestration overhead and subscription quota consumption are unmeasured.

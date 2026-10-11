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
- Latest published implementation candidate: `2390d3737ac5c7e3e1ab7529c4226d415e5d4ecb`, failed exact-candidate CI; follow-up fix independently tested/reviewed and ready to publish.
- Last verified branch head: `f23e443dd09f40a403449a3495e2fa0e7767f844` (administrative approval checkpoint).
- Current phase: Phase 1 CI repair; Phase 2 has not started.
- Isolated full checkout preserves `AGENTS.md` as the `GEMINI.md` symlink. No user changes were present in this checkout; changes on the user's other machines are not visible.

## Evidence by phase

| Phase     | Candidate commit                           | Local results                                                                         | CI workflow / run IDs / results                                                                                                                                                | Agent review / resolved findings                             | Status      |
| --------- | ------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ----------- |
| Readiness | `302a9859b77ecca890254b24a3ca381c9e66ac49` | Node 24.19.0; locked `npm ci` succeeded                                               | Tests push `38140410169`, job `114472954882`; PR `38140413340`, job `114472964133`: both 23 passed / 0 failed, browser-smoke, ownership-flow and client-leak actually executed | Current branch/PR heads and job logs inspected               | Verified    |
| 1         | 2390d3737ac5c7e3e1ab7529c4226d415e5d4ecb   | 23 executed local passes / 2 missing-Chromium failures / 1 skip; scoped checks passed | Push 38143434216 / PR 38143437972: 24 passed / 2 browser failures                                                                                                              | Initial review passed; CI repair requires affected re-review | CI repair   |
| 2         | Pending                                    | Pending                                                                               | Pending                                                                                                                                                                        | Pending                                                      | Not started |
| 3         | Pending                                    | Pending                                                                               | Pending                                                                                                                                                                        | Pending                                                      | Not started |
| 4         | Pending                                    | Pending                                                                               | Pending                                                                                                                                                                        | Pending                                                      | Not started |

Record administrative checkpoint commits in the next checkpoint; never embed this document's own commit hash. Verify exact-head CI before advancing.

Approval checkpoint `f23e443dd09f40a403449a3495e2fa0e7767f844` passed Tests push `38142088056` (job `114477846514`) and PR `38142090835` (job `114477854870`): both 23 passed / 0 failed, all three required browser suites executed. It changed only approval/status documentation; its success does not verify the pending Phase 1 runtime diff.

Phase 1 candidate `2390d3737ac5c7e3e1ab7529c4226d415e5d4ecb` preserved all unrelated tree entries and the `AGENTS.md` symlink, and failed Tests push `38143434216` (job `114481782494`) and PR `38143437972` (job `114481792797`): both 24 passed / 2 failed with real Chromium. Browser smoke accepted reset dots as gameplay before the one-second durable launch, then changed bindings/closed the creator during countdown. Cancellation left the first-round configuration intact; its later scoreboard-start wait was invalid. The repair now requires committed `firstRoundStarted` and server `running` before transfer, then proves retained-only reconnect has one eligible bike and disabled later start before explicitly recovering both bikes. Client-leak completed its first metric cycle, then its second arena wait timed out. Independent controlled-time callback diagnosis reproduced an old score reveal hiding the new room's arena; the fixture now completes each matching finished round before teardown, while full generation guards remain Phase 2. Assertions, cycles and metric thresholds are preserved. One failed published candidate, no unchanged CI retries. Diagnostics artifact `11704156274`, smoke trace and job logs were inspected.

## Blockers and next action

No product or access blocker. Phase 1 browser fixes have passed independent affected testing/re-review; publish the follow-up and require a new exact-candidate push/PR run before advancement. Keep minimum-roster assertions and all leak thresholds. Preserve strict protocol version checks and reload guidance throughout.

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

## Model-efficiency review

Pending live execution. No cheaper-model trial or savings claim is authorized or inferred. Lead orchestration overhead and subscription quota consumption are unmeasured.

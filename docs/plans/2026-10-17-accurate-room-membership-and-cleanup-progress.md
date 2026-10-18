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
- PR: `#6`, existing user-opened PR discovered during Phase 3 and reused; base `main`. No unmerged dependency.
- Latest implementation candidate: `0964999a241b992c0ef692e47b9706029c0b500a` (Phase 3 repaired browser acceptance).
- Last verified implementation candidate: `0964999a241b992c0ef692e47b9706029c0b500a`; push and PR CI both passed 37 suites with the new real Chromium journey.
- Status: all three phases verified; final roadmap/plan/progress administration and PR handoff. This completion commit changes documentation only; its push and PR CI must pass before final handoff.
- Local dependencies: `npm ci` succeeded on Node 24.19.0. Shell Git pushes lack authentication; supported GitHub connector writes are available and already proven. Preserve unrelated files and symlink modes in connector commits.

## Evidence by phase

| Phase                                   | Candidate | Local results                                                                                         | CI evidence                                                                                                                                       | Independent review                                      | Status   |
| --------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------- |
| 1: Membership and departure             | `c1b38ca` | All Node suites passed; required local browser launch unavailable; scoped checks and benchmark passed | Tests `39075570744` / job `117521894492`: 35 suites passed, zero failed; required Chromium journeys executed                                      | P1-T strengthened tests; P1-R no blocking findings      | Verified |
| 2: Expiry and destruction               | `2716d08` | All Node suites and scoped checks passed; local Chromium missing                                      | Tests `39076752813` / job `117525379528`: 36 suites passed, zero failed; required Chromium executed                                               | P2-T strengthened tests; P2-R no blocking findings      | Verified |
| 3: Browser acceptance and documentation | `0964999` | Node/fixture/scoped checks passed; Chromium unavailable locally                                       | Push `39078259224` / job `117529800630` and PR `39078262811` / job `117529810970`: 37 passed, zero failed, new required Chromium journey executed | P3-T and P3-R, plus independent repair rechecks, passed | Verified |

## Blockers and next action

No implementation or product blocker remains. PR `#6` contains the final behavior; merging and deployment remain with the user. Before final handoff, verify both push and PR CI for this documentation-only completion commit and record those final-head run IDs in the PR description. Its own hash/run IDs are intentionally not embedded here to avoid a self-referential checkpoint.

Baseline `c006c48` passed run `39074615251` / job `117519091953` with 34 suites. Approval checkpoint `c3c3af6` passed run `39074867491` / job `117519804698`; Phase 1 checkpoint `94f482f` passed `39075747204` / job `117522417931` with 35 suites; Phase 2 checkpoint `f306535` passed `39076930538` / job `117525905625` with 36 suites. Logs confirmed real Chromium throughout. Phase candidate evidence is in the table above.

Local Chromium was unavailable and its download returned invalid/truncated archives. Local Node/fixture/lint/format results and remote browser execution are recorded separately. The first Phase 3 candidate `8cb70e1` failed only its new browser score-projection assertion in push `39077930919` and PR `39077934710`; one independently tested/reviewed test-only repair passed both replacement runs. No failed assertion was removed or unchanged CI rerun to obtain a pass.

## Final acceptance audit

| Approved requirement                               | Verification evidence                                                                                                                                                                                                                           | Result   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| One membership per socket; cap retries             | [Real-socket membership suite](../../test/room-membership.test.js), cap/spectator retries and new Chromium shared-keyboard/creator journey; Phase 1/3 CI                                                                                        | Verified |
| Atomic failed admission and handle preflight       | Membership, reconnection-ownership and round-authority acceptance suites preserve owners, proofs, pending timers, scores and handles; Phase 1 CI                                                                                                | Verified |
| Shared membership source                           | `liveClients` / `isJoined` cover admission, room broadcast, movement/registration, eligibility/readiness and idle checks; routing-only denial and delivery regressions plus P1-R review                                                         | Verified |
| Owner-safe leave/switch/close/termination/pruning  | Membership, player ownership/reconnect and cleanup suites cover partial handover, repeated cleanup, stale indexes and replacement-owned bikes/creator                                                                                           | Verified |
| Retained roster/scores/proofs and offline behavior | Browser saved recovery compares roster, every durable score field, proof digest and fresh monotonic handles; existing disconnect/explosion/credential suites pass                                                                               | Verified |
| Former-room packet and screen isolation            | Required Chromium journey runs actual reset/countdown/physics/finish; excluded lobby/other-room clients receive no old-room event or renderer/screen change                                                                                     | Verified |
| Idle window and activity                           | [Controlled cleanup suite](../../test/room-cleanup.test.js) covers initial/cold restore, offset departure, periodic cadence, rejoin, spectator and dead peer; browser proves creator/spectator retention and expiry with sockets open elsewhere | Verified |
| Read-only discovery and private expiry             | Existing discovery suite and cleanup/browser journeys prove checks do not retain activity, checked missing records retire and unrelated private keys/replacements remain isolated                                                               | Verified |
| Complete idempotent exact-instance destruction     | Cleanup suite captures stale status/physics/preparation/countdown/arena/save callbacks and checks no work or scheduling; handlers, buffers, ownership and external references released without harming replacement/current-room indexes         | Verified |
| Registry/storage/capacity lifetime                 | Cleanup tests inspect real snapshot deletion/cold restore/read-only protected bytes/save failure, server capacity recovery, silent creation rollback and credential-free bounded retry tombstones                                               | Verified |
| Browser/regression acceptance                      | Required new [Chromium journey](../../test/room-membership-flow.test.js) passed with all existing required journeys; push and PR each 37 passed, zero failed                                                                                    | Verified |

The roadmap section is moved to implemented history with plan/progress/Changelog links. Only the corresponding milestone membership acceptance checkbox is newly completed. Other roadmap features remain open. Stale foundation descriptions now point to already verified membership and room-authority records.

Limitations retained: five-minute timeout is evaluated on the 60-second check cadence; heartbeat detection remains later work. No wire or saved-format migration. Failed/read-only snapshot deletion can restore old disk data on restart; no fsync durability or deletion retry guarantee is added. The quick benchmark is a local sanity check, not deployment-capacity proof.

## Task execution records

Record delegation timestamps and actual outcomes here. Usage/token telemetry and attributable monetary costs are unavailable unless explicitly supplied by the runtime; do not infer them from elapsed time.

### P1-I — Phase 1 / implementation

- Requested via spawn controls: `gpt-6.1-sol` / `high`; worker could not introspect actual model/effort, so actual selection is unverified.
- Worker-reported first timestamp: 2026-10-17T22:22:49Z; handoff 2026-10-17T22:27:15Z; observed worker interval 4m26s, not compute time. Earlier delegation/orchestration overhead is unmeasured.
- Scope: Phase 1 runtime membership/departure, migrated fixtures, socket regressions and relevant docs.
- Usage: unavailable.
- Outcome: runtime/fixture/docs implementation ready; affected Node suites and scoped lint/format passed. Full isolated `npm test`: 32 runner-passed / 3 failed, 15.300s; all Node suites passed, three required browser suites failed only for missing Chromium, optional client-leak skipped browser execution. Server GC +0.238 MB. Quick benchmark: 50 rooms / 200 players, mean jitter 0.30ms, p95 1.13ms, max spike 1.65ms. Independent test/review and CI were pending at handoff; subsequent verification is above.
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

- Requested via spawn controls: `gpt-6.1-sol` / `high`; actual model/effort introspection unavailable.
- Lead record timestamp: 2026-10-17T22:38:17.870453+00:00; worker-reported times are recorded below where available.
- Scope: membership-driven idle timing, idempotent exact-instance disposal, timer/callback/external reference cleanup, controlled-clock regressions and docs.
- Usage and actual model/effort introspection: unavailable. Last worker-observed timestamp 2026-10-17T22:45:54Z; first clock read 22:43:43Z occurred after implementation began, so exact elapsed unavailable.
- Outcome: controlled cleanup and affected Node suites passed; final full suite 33 runner-passed / 3 missing-Chromium failures in 14.484s, optional browser leak skipped. All Node suites passed; server GC +0.245 MB under unchanged threshold. Scoped lint/format/diff passed.
- Corrections: full suite exposed expired creation-request semantics after deleting retries; bounded credential-free tombstones preserve unchanged REQUEST_ID_CONFLICT assertion. Preserved omitted-hook callback installation behavior. Lead follow-ups highlighted captured callback/other-room index protection and preserving personalized deletion notices. No scope/protocol change. Independent test/review and CI remain pending at handoff.

### P2-T — Phase 2 / independent testing

- Requested via spawn controls: `gpt-6.1-sol` / `high`; actual model/effort introspection unavailable.
- Lead record timestamp: 2026-10-17T22:46:02.800750+00:00; worker-reported times are recorded below where available.
- Scope: controlled cleanup contract, stale callbacks, exact-instance safety, persistence and personalized deletion tests. Test changes only.
- Usage and actual model/effort introspection: unavailable. Worker-observed interval 2026-10-17T22:46:29Z–22:48:30Z (2m01s), not compute time.
- Outcome: strengthened only `test/room-cleanup.test.js`; nine affected Node suites and scoped lint/format/diff passed. Added offset-departure cadence, actual cold-restore/read-only deletion and byte protection, stale callbacks/buffers/detached owners, private replacement isolation, real routing/handle/retry cleanup, monotonic continuing socket handles, silent rollback and nonempty stale binary draw assertions. No blocking runtime findings, weakened assertions, full-suite/browser repeats or runtime edits.

### P2-R — Phase 2 / independent review

- Requested via spawn controls: `gpt-6.1-sol` / `xhigh`; actual model/effort introspection unavailable.
- Lead record timestamp: 2026-10-17T22:48:29.796256+00:00; worker-reported times are recorded below where available.
- Scope: read-only final Phase 2 lifecycle/ownership/persistence/callback/retained-reference review.
- Usage and actual model/effort introspection: unavailable. Worker-observed interval 2026-10-17T22:48:48Z–22:50:46Z (1m58s), not compute time. Outcome: no blocking findings after complete runtime/docs diff and 773-line cleanup suite review. Independently ran cleanup test and whitespace check successfully. Residual requirement: exact-candidate Chromium CI. No corrective follow-up required.

### P3-I — Phase 3 / implementation

- Requested via spawn controls: `gpt-6.1-sol` / `high`; actual model/effort introspection unavailable.
- Lead record timestamp: 2026-10-17T22:56:45.985452+00:00; worker-reported times are recorded below where available.
- Scope: real independent-context membership browser journey, isolated production-clock expiry fixture and relevant docs. Runtime remains stable unless a demonstrated in-scope bug requires lead coordination.
- Usage and actual model/effort introspection: unavailable. First worker clock 2026-10-17T22:59:58Z after work began; final check 23:01:44Z; exact elapsed unavailable.
- Outcome: required independent-context Chromium journey and private 76-line IPC fixture plus testing/lifecycle/Changelog docs. Private IPC smoke proved production startup, target creation, retention at 299999ms, inclusive expiry at 300000ms and actual snapshot deletion. Full local suite: 33 runner-passed / 4 required missing-Chromium failures, 14.616s; optional browser leak skipped, all Node suites passed, server GC +0.245 MB. Scoped lint/format/diff passed. Browser behavior remains unexecuted locally; exact-candidate CI required. No runtime edits or browser bypass.

### P3-T — Phase 3 / independent testing

- Requested via spawn controls: `gpt-6.1-sol` / `high`; actual model/effort introspection unavailable.
- Lead record timestamp: 2026-10-17T23:01:59.512399+00:00; worker-reported times are recorded below where available.
- Scope: challenge real browser journey assertions, IPC fixture bounds/isolation and diagnostics; meaningful test improvements only.
- Usage and actual model/effort introspection: unavailable. Worker finished approximately 2026-10-17T23:05Z; exact start and elapsed unavailable.
- Outcome: strengthened browser journey with creator-alone 300000ms activity, matching completed-score/timer gates, recovered browser roster/scores, correlated barriers before isolation baselines and both bike contexts checked before expiry. Syntax, scoped lint/format/diff passed. Independent real-WebSocket fixture smoke proved creator activity, last-leave boundaries and snapshot deletion. Initial smoke used `/` rather than `/ws`; corrected and passed.
- Two lead follow-ups examined repeated-join freshness; source proved the existing pendingJoin/private-result gate sufficient, so no redundant wait was added. No runtime/docs edits, browser bypass or broad repeats. Browser acceptance remains pending CI.

### P3-R — Phase 3 / independent review

- Requested via spawn controls: `gpt-6.1-sol` / `xhigh`; actual model/effort introspection unavailable.
- Lead record timestamp: 2026-10-17T23:05:14.184736+00:00; worker-reported times are recorded below where available.
- Scope: read-only final browser journey, isolated fixture and final lifecycle/testing docs; check acceptance, timing, diagnostics and no assertion weakening.
- Usage and actual model/effort introspection: unavailable. First worker clock 2026-10-17T23:05:53Z after review began; end 23:07:02Z; exact elapsed unavailable.
- Outcome: no blocking findings after final diff, both test files and relevant production paths. Async gates/barriers, required browser failure behavior, bounded IPC/physics/cleanup, coverage and credential-safe diagnostics were sound. Independently passed scoped ESLint/Prettier and whitespace checks. No edits. Residual requirement: exact-candidate real Chromium acceptance.

### P3-I-F1 — Phase 3 / CI repair 1

- Parent task P3-I; requested Sol/high retained, actual introspection unavailable.
- Lead record timestamp: 2026-10-17T23:12:45.042516+00:00; worker-reported times are recorded below where available.
- Evidence: push job `117528850083` and PR job `117528861722` fail the same new-browser comparison at line 402. Browser-rendered score rows carry UI-only `_rank`/`_rankLabel`; authoritative score values match.
- Scope: diagnose production score annotation and correct test comparison without dropping authoritative score/recovery coverage; no runtime changes or unchanged CI retries.
- Usage and actual model/effort introspection unavailable. Worker-observed 2026-10-17T23:12:32Z–23:13:14Z (42s). Only durableScores test projection changed to omit existing connection flag and UI rank annotations; every remaining score field/messages/gamecount still exact. Scoped lint/format, scoreboard suite and direct helper sensitivity/immutability checks passed. P3-T recheck 2026-10-17T23:13:35Z–23:13:54Z passed actual helper sensitivity against production sorter and frozen sources: all authoritative fields, future fields, gamecount/messages still detect changes. P3-R re-review 23:13:40Z–23:13:50Z found no blocking issue and confirmed all other assertions unchanged. Both scoped checks passed; no writes. Actual model/effort/usage unavailable. Repaired-candidate CI remains required.

### L-1 — Lead integration, publication and verification

- Model/effort: current session; actual introspection and usage unavailable. First readiness clock 2026-10-17T22:20:49Z; completion record 2026-10-17T23:18:40.017343+00:00. This wall interval includes substantial CI/tool waits and is not compute time; overlapping worker intervals are not summed.
- Scope: authorization/readiness, role assignment, integration, connector publication, CI diagnostics, phase checkpoints, roadmap audit and existing PR update. Only the lead published commits; every update checked the expected remote head, preserved the base tree/symlink modes and used a non-forced ref update.
- Publication correction: one aggregated tool read was truncated before a candidate was published; bounded per-file reads and local/remote tree-hash equality resolved it without publishing incomplete data.
- Follow-ups: P1-I received stale-index and benchmark notes; P1-T a handoff scope reminder; P2-I received captured-callback/index and private-deletion notes plus retry-contract acknowledgement; P3-T received a join-gate concern and correction. One Phase 3 CI repair required implementation and separate read-only tester/reviewer follow-ups. No extra agents or repeat runs were launched solely for measurement.
- Outcome: nine primary worker assignments across implementation/testing/review, with no blocking findings outstanding. Full behavior verified on candidate `0964999`; final administrative-head verification and PR handoff remain the lead's final steps.

## Model-efficiency review

- Requested roles stayed GPT-6.1 Sol/high for implementation and independent testing, Sol/xhigh for review. Worker contexts could not introspect actual model/effort or usage. No token totals, monetary costs, subscription consumption or measured savings are available; orchestration overhead and some task start times are unmeasured.
- Cross-file reasoning mattered in P1-I/P1-T for ownership versus routing indexes, and P2-I/P2-T for callback invalidation, same-key instance safety, persistence limits and private deletion notices. P2-I's full-suite failure exposed the creation-retry semantic regression before publication; preserving bounded credential-free tombstones repaired it.
- P3-T strengthened asynchronous browser barriers, reveal timing and activity evidence. Real CI then exposed UI rank annotations absent from server scores. P3-I-F1 and independent rechecks fixed only the comparison projection while retaining sensitivity to all authoritative fields, future fields, messages and gamecount. Review before browser execution did not catch this; exact-candidate CI was necessary.
- Mechanical array-to-Set fixture migrations from P1-I and evidence-link/formatting administration from L-1 are bounded candidates for a separately agreed lower-effort trial. This is untested, with no equivalent-quality or savings claim. Keep ownership, lifecycle and browser concurrency work under the current independent roles.
- Recommendation: retain current assignments for comparable runtime work; collect real per-task usage telemetry before drawing cost conclusions or changing models. CI and checkpoint waiting contributed to elapsed time and must not be treated as model computation.

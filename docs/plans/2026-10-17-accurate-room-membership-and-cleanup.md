# Accurate room membership and cleanup — Implementation plan

- Date: 2026-10-17
- Status: Approved for autonomous implementation on 2026-10-18; see [approval evidence and progress](2026-10-17-accurate-room-membership-and-cleanup-progress.md)
- Roadmap section: [Accurate room membership and cleanup](../../ROADMAP.md#accurate-room-membership-and-cleanup)
- Branch: `feat/accurate-room-membership-and-cleanup`
- Base: `main` at `30f0356068bcc873fdc92b8e5c78fc776baf60b4`
- Existing PR or unmerged dependency: none found during preparation

## Goal and scope

Make live room membership accurate, idempotent, and the common source for
admission, room broadcasts, round eligibility, and inactivity. A socket belongs
to at most one room and occupies one client slot, regardless of how many local
bikes it controls or how often it joins. Spectators occupy one slot too.

Keep live membership separate from the durable roster and authentication:
leaving, switching rooms, closing, or terminating a connection releases its live
bindings but preserves registered bikes, accumulated scores, and reconnect
credentials while the room exists. Offline bikes retain the existing
`[disconnected]` presentation and starting-position explosion behavior. Only room
destruction ends the room's recovery window and removes its persisted record.

Excluded: heartbeat scheduling/dead-peer detection, payload/rate limits,
slow-client handling, metrics access policy, scoring changes, explicit slot
relinquishing, owner transfer, longer-lived room archives, and UI redesign.
Those remain separate roadmap work. Termination cleanup is in scope; introducing
a heartbeat to decide when to terminate is not.

## Current behavior and proposed contract

### Findings at the baseline

- [GameSession](../../server/GameSession.js) stores `clients` in an array.
  `connect()` prunes closed entries and appends without deduplication; normal
  `JOIN_GAME` currently avoids reconnecting a socket already in that room.
  `isJoined()` also checks the socket's room key and ready state.
- [wsHandler](../../server/wsHandler.js) counts an independently filtered room
  array for capacity, but broadcasts by scanning all WebSocket-server clients
  for matching `gameKey`. Leave, switch, and close each edit membership directly.
  The periodic session prune drops closed references without routing them
  through ownership release.
- Ownership release already checks the room's authoritative current-owner map.
  Preserve that protection: stale indexes and superseded sockets must never
  disconnect replacement-owned bikes or release a replacement creator.
- Inactivity is sampled every 60 seconds. The empty-room timestamp is currently
  established on a check rather than necessarily on the last departure.
- `destroy()` stops physics/pending starts, clears the status timer, arena
  handlers and ownership, then invokes removal. However,
  [GameServer.destroyGame()](../../server/GameServer.js) only removes the registry
  entry and saves; calling that entry point directly does not dispose the session.
- Socket discovery grants (`lobbyRooms`) and bounded creation-retry records can
  reference room objects after their removal. Cleanup must consider these
  external references as well as timers inside the session.

### Membership, admission, and departure

1. Use a room-owned `Set` or equivalent deduplicated membership collection.
   Centralize add/remove/live-member enumeration so callers do not replace or
   filter the collection independently. `ws.gameKey` remains a routing index;
   it cannot alone establish membership. A live member is open, recorded in
   this room, and indexed to this room. Apply the same predicate to capacity,
   broadcasts, inactivity, and existing round permission/readiness checks.
2. Repeated same-room joins are idempotent, including at the client cap: no new
   slot, duplicate room-event subscription, needless handle allocation, or
   eligibility/attempt change. Authenticated claims may still intentionally
   change ownership under the existing handover contract.
3. Preflight the target room and all required input handles before changing
   source membership or either room's ownership. `ROOM_FULL`, missing rooms,
   malformed claims, and handle exhaustion preserve source state. Validly formed
   requests with invalid credentials retain the current per-claim rejection and
   spectator-admission policy; invalid proof is not a new admission failure.
4. Route explicit leave, successful switch, close, terminated sockets, and
   defensive pruning through one idempotent departure path. Release only actual
   current bike/creator bindings; invalidate released handles and registration
   retries; remove membership and reconcile pending starts before publishing the
   resulting room snapshot. Preserve the connection-lifetime monotonically
   increasing handle counter, unrelated owners, roster entries, score totals,
   and credential verifiers. Clear discovery state only when its connection or
   referenced room expires, not simply on leaving a still-existing room.
5. Departure cleanup can run again after termination/close without duplicate
   disconnections, explosions, persistence changes, or room events. Defensive
   pruning must release a dead member's current bindings rather than silently
   dropping its reference. Other local bikes after a partial handover remain
   owned until their own socket departs.
6. Room-event broadcasts enumerate this room's live members. Former members in
   the lobby or another room receive no old-room draw/reset/state/finish/info
   packets. Global personalized lobby discovery remains separate and read-only.

### Inactivity and destruction

1. Preserve `IDLE_ROOM_TIMEOUT_MS` at five minutes and the current 60-second
   periodic check. Establish the empty timestamp on the transition to zero live
   members; establish it at creation/cold restore for an initially empty room.
   Destroy at or after the timeout on the next check, rather than promising
   second-exact expiry. Rejoining before expiry clears the timestamp; a later
   last departure starts a fresh window.
2. A joined spectator keeps the room active. A former member's open lobby or
   other-room socket, registered offline bikes, creator credentials, creation
   retries, and read-only discovery checks do not keep it active or refresh it.
   No new inactivity timestamp is persisted; cold restore starts a fresh window.
3. Make session destruction and registry removal one idempotent lifecycle,
   including explicit removal, idle removal, and creation rollback. Remove the
   exact room instance; a delayed callback from an old instance cannot remove a
   replacement with the same key. Avoid recursive destroy/remove callbacks.
4. Cancel preparation/countdown, physics and inactivity timers; invalidate
   queued callbacks before releasing arena/state references. Clear room-owned
   event handlers, membership, ownership/verifiers and retained room data, and
   purge external discovery/creation-retry references to the destroyed instance.
   Clear any affected socket routing/handle indexes without closing otherwise
   usable connections. Late callbacks and repeated destruction do no work,
   emit no room packets, and schedule no timers.
5. On successful persistence, the room disappears from the registry, personalized
   lobby lists and snapshot, and frees server room capacity. Preserve current
   storage error/read-only behavior and safe diagnostics; do not claim deletion
   survives restart if its snapshot write failed. Automatic retry or stronger
   disk durability is outside this section.

Existing creator-only first launch and speed authority, later joined-spectator
start permission, full-roster pending-start cancellation, and authenticated
reconnection remain the contracts in the [lifecycle guide](../architecture/lifecycle.md).
Membership cleanup does not resurrect a cycle during its current round.

## Decisions for user review

Proposed defaults, requiring approval with the plan:

- Keep the five-minute empty-room recovery window and 60-second check cadence.
  Returning before expiry permits authenticated recovery; after destruction the
  room is missing and saved credentials grant no recovery.
- Count all joined sockets, including spectators and zero-bike creators, toward
  room capacity and activity. Count neither saved rosters nor lobby discovery.
- Keep existing wire messages, error codes, credential lifetime, and snapshot
  format. No protocol bump is expected for internal membership changes. If a
  wire-contract change becomes necessary, return its material delta for review;
  retain exact current-version checking and reload guidance, with no old-version
  handlers or fallback payloads.
- Keep heartbeat introduction in the later network-hardening section. Prove
  cleanup now through server-side termination and defensive stale-member tests.

No additional product decision is required with these defaults.

## Acceptance matrix

| Requirement                            | Observable proof                                                                                                                                                     | Phase |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| One membership per socket              | Repeated joins, including at capacity, retain one slot; a further distinct socket gets `ROOM_FULL`; departure immediately frees its slot                             | 1     |
| Atomic admission                       | Full/missing target, malformed claims and handle exhaustion leave source membership, owners, handles and pending attempt intact                                      | 1     |
| Shared membership source               | Capacity, binary/text broadcasts, eligibility and inactivity use the same live-member predicate; stale routing alone grants nothing                                  | 1–2   |
| Safe departure and handover            | Leave, switch, close, server termination and repeated cleanup disconnect only current owners; partial handover preserves replacement bikes/creator                   | 1     |
| Durable recovery                       | Leave/switch/rejoin preserves roster, score totals and proofs, restores only authenticated bindings, and retains offline explosion behavior                          | 1, 3  |
| Room event isolation                   | Remaining members receive the expected event once; lobby/other-room/former members receive no old-room events                                                        | 1, 3  |
| Correct idle window                    | Controlled clock covers initial emptiness, last exit, spectator retention, rejoin reset, second exit and post-timeout reap while former sockets stay open            | 2     |
| Discovery does not retain activity     | Credential checks leave ownership, membership and idle deadline unchanged; expired room disappears from personalized discovery                                       | 2–3   |
| Complete destruction                   | Idle/direct/double destroy clears timers, handlers, external room references and indexes; invoking captured stale callbacks emits/schedules nothing                  | 2     |
| Correct registry/storage lifetime      | Successful deletion frees room capacity, removes the saved record and cannot destroy a replacement instance; write failures are reported without claiming durability | 2     |
| Browser behavior and regression safety | Independent Chromium contexts exercise leave, switch, authenticated rejoin and expiry; all required existing suites pass without browser skips                       | 3     |

## Phases

### Phase 1 — One live membership model and safe departure

- [x] Introduce deduplicated membership and shared live-member operations in
      `GameSession`; migrate direct consumers, fixtures and relevant benchmarks
      from array assumptions.
- [x] Integrate idempotent admission/departure in `wsHandler`, preserving target
      preflights, connection-local handle lifetime and current-owner release.
- [x] Route room broadcasts through membership and prune dead/stale members
      through safe cleanup. Keep room event hooks independent of visitor count.
- [x] Add `test/room-membership.test.js` with real WebSocket joins, capacity,
      rejection atomicity, leave/switch/close/termination, multi-bike partial
      handover and delivery-isolation cases. Include stale-index and duplicate
      cleanup assertions; retain round authority/cancellation regressions.
- [x] Update the membership/departure sections of the lifecycle guide and add
      accurate Unreleased notes for the implemented behavior.

Dependencies: none beyond the completed ownership/round-authority foundation.
Exit criteria: Phase 1 acceptance passes, with independent testing/review and
successful exact-candidate CI before proceeding.
Interim limitations: final inactivity timing, direct-removal disposal and external
reference cleanup are completed in Phase 2; do not mark the roadmap section done.

### Phase 2 — Accurate empty-room expiry and complete destruction

- [ ] Start/reset the idle window from membership transitions, including initial
      emptiness and defensive dead-peer cleanup. Keep one unreferenced status
      timer and preserve the documented timeout/check cadence.
- [ ] Unify `GameSession.destroy()` and `GameServer.destroyGame()` disposal with
      exact-instance protection, creation-failure safety and idempotency.
- [ ] Invalidate timers/callbacks and purge socket discovery/creation retry room
      references, live bindings and routing indexes for removed instances.
- [ ] Add `test/room-cleanup.test.js` using controlled time and captured callbacks
      for timeout boundaries, leave-to-lobby, switch-away, reconnect, spectator,
      cold restore, stale callbacks, double destruction and replacement safety.
      Assert actual snapshot deletion, capacity recovery and storage-failure
      behavior; retain meaningful server GC coverage without weakening thresholds.
- [ ] Update lifecycle/testing documentation and Unreleased notes for expiry,
      destruction and the remaining persistence limitations.

Dependencies: Phase 1 verified.
Exit criteria: Phase 2 acceptance passes and required exact-candidate CI is green.
Interim limitations: browser acceptance and the complete roadmap audit remain in
Phase 3; no new heartbeat detector is supplied.

### Phase 3 — Browser acceptance and roadmap completion

- [ ] Extend an existing browser journey or add
      `test/room-membership-flow.test.js` using independent Chromium contexts.
      Exercise repeated join, shared-keyboard bikes, spectator/creator presence,
      leave to an open lobby, switch to another room and explicit saved rejoin.
- [ ] Verify saved roster/scores/credentials survive before expiry, offline bikes
      remain disconnected, and former-room packets cannot change the new screen.
- [ ] Drive server expiry deterministically through an isolated fixture around
      the production cleanup path; verify lobby deletion and the existing saved
      credential retirement flow. Add no public test-only endpoint or five-minute
      real-time wait. Check an expired-room join returns `GAME_NOT_FOUND`.
- [ ] Run the complete acceptance matrix and required suites; update the testing
      guide and final lifecycle contracts. Move only this completed roadmap
      section to implemented history, link plan/progress/Changelog evidence and
      mark only the membership-related acceptance item verified.
- [ ] Finish the progress evidence and model-efficiency observations; create or
      update the final PR for user review after required final-head CI passes.

Dependencies: Phases 1–2 verified.
Exit criteria: every acceptance row has evidence, required browser execution is
proven, and the final PR contains no unresolved blocking findings.
Interim limitations: the excluded network-hardening and other roadmap sections
remain open; final merge is reserved for the user.

## Verification and execution policy

Preparation inspected remote `main`, matching branches, existing plans and open
PRs. No matching branch/plan or open PR existed. The scratch workspace contained
no checkout or uncommitted project work; preparation uses the GitHub connector.
GitHub reads, branch creation and file commits are available. Shell, Git and
Node 24 are available. Dependency installation and local application/browser
execution have not yet been established for a project checkout; verify these at
execution time. Independent agent tools and the preferred role controls are
available, but no implementation agents are launched during preparation.

Baseline GitHub Actions `Tests` run `39070809253` passed for
`30f0356`: 34 suites passed, zero failed. Inspected job logs confirm real Chromium
journeys, including ownership and round-authority flows. The workflow installs
Chromium, runs JavaScript lint and `npm test` on Node 24. Job/log reading is proven.
Recheck readiness against the live branch and workflow before execution.

For every implementation phase:

- Run affected suites, scoped ESLint for changed JavaScript, scoped Prettier for
  supported changed files, and `npm test` per repository instructions. Use
  isolated data directories; do not write to a developer's actual snapshot.
- Use real sockets for transport behavior and controlled clocks/captured callbacks
  for expiry. Avoid assertions tied only to collection shape. Exercise binary
  draws as well as JSON events, rejected operations, and former-owner cleanup.
- Require [.github/workflows/ci.yml](../../.github/workflows/ci.yml), `Tests` / `test`,
  to pass on each exact pushed candidate and final head. Confirm required browser
  journeys actually ran; an optional skip or Chromium installation alone is not
  proof. Remote full-suite execution may provide unavailable local coverage,
  with local limitations reported honestly.
- Follow the [skill](../../.agents/skills/implement-roadmap-section/SKILL.md) and
  its [agent-role guidance](../../.agents/skills/implement-roadmap-section/references/agents.md):
  current-session lead, separate GPT-6.1 Sol/high implementation and testing,
  GPT-6.1 Sol/xhigh review, with supported substitutions disclosed. Record actual
  task settings, outcomes, follow-ups and available usage; do not invent cost or
  token savings. Escalate concrete unresolved issues as the guidance describes.

After explicit approval of this specific plan and autonomous execution policy,
implement sequentially with independent testing/review, feature-branch candidate
commits/pushes and CI gating. Resolve blocking findings and re-review substantive
fixes. Record approval revision and evidence in
`2026-10-17-accurate-room-membership-and-cleanup-progress.md` before implementation.
Pause for material plan changes or genuine blockers. Never force-push, merge,
release, deploy, or change permissions under this approval.

## Migration and rollback

No saved-data migration or wire-format change is planned. Live membership and
timers remain process-local; existing snapshots still restore disconnected bikes
and creator proofs with no active socket membership. Runtime changes require
the usual coordinated server/client upgrade and reload guidance.

Back up the snapshot before upgrade. For rollback, stop the server and restore
the prior matching application and snapshot backup as described in the
[lifecycle guide](../architecture/lifecycle.md#9-upgrade-and-rollback). Rooms
correctly reaped by this change are deleted; rolling code back cannot recreate
them without a backup. Restoring a backup loses changes made since that backup.

## Approval gate

The user approved the proposed defaults and subsequently requested implementation
orchestration on 2026-10-18. The reviewed contract and execution policy above are
approved for all three phases. See the [progress record](2026-10-17-accurate-room-membership-and-cleanup-progress.md)
for the original reviewed revision and the actual approval statements. Material
scope changes still require renewed review; merging and deployment remain outside
this approval.

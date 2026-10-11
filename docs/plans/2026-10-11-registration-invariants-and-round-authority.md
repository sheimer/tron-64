# Registration invariants and round authority — Implementation plan

- Date: 2026-10-11
- Status: Awaiting user review; implementation is not approved
- Roadmap section: [Milestone 1 — Registration invariants and round authority](../../ROADMAP.md#registration-invariants-and-round-authority)
- Branch: `feat/registration-invariants-and-round-authority`
- Base: `main` at `8f89e08235cf042abb1df346399a0343f1ae0666`
- Existing PR: none; create the implementation PR after approval
- Dependency: completed ownership/reconnection work, merged in PR #4 and included in this baseline

## Goal and scope

Give each room one server-verified host. Only the socket currently owning that
host's player may start a round, cause its reset, or change the room speed.
Validate the eligible roster before any reset and again before physics starts.
Make pending preparation/countdown work cancellable and ensure a disconnected
host cannot permanently block a room that still has authenticated players.

Keep account-free play, two-to-six registered players, multiple players on one
keyboard/socket, spectators, existing scores, authenticated per-player recovery,
and binary-only movement/drawing. Registration ID/control/capacity validation and
private acknowledgement already landed; preserve and reuse those contracts.

Excluded: broader membership/capacity/reaping work, heartbeat and slow-client
limits, scoring changes, metrics security, active-round slot replacement,
creation-form speed options, manual host-transfer UI, accounts, and deployment.
Touch membership hooks only where they affect host authority or pending starts.
Automatic host fallback is necessary here; deliberate handover remains a later
[room-feature item](../../ROADMAP.md#target-v180--milestone-4-room-features--matchmaking).

## Current behavior and proposed contract

### Code-backed findings

- [WebSocket handling](../../server/wsHandler.js) authorizes `START_GAME` and
  `SET_INTERVAL` when the caller owns any room player. There is no host role.
  A start resets the arena, replacing an earlier pending start, even if a round
  is already running. Unauthorized controls are silently ignored.
- [GameSession](../../server/GameSession.js) validates registration but does not
  enforce `MIN_PLAYERS` at start. Disconnected roster entries still count in the
  configuration button's readiness. `setInterval` accepts mutations during play.
- `pendingStarts` belongs to the WebSocket setup closure, outside the room's
  timer cleanup. Its two-second preparation fallback and one-second countdown
  are not cancelled on all leave/switch/close/destroy paths. Readiness counts
  open sockets including spectators and has no attempt identifier.
- [GameServer](../../server/GameServer.js) exposes roster, scores, interval,
  `started`, and `running`. It exposes no host, pending stage, or eligibility.
  [Storage](../../server/Storage.js) persists private verifier snapshots using
  envelope version 1; every restored player starts disconnected.
- [ConfigView](../../public/javascripts/ui/configView.js),
  [GameView](../../public/javascripts/ui/gameView.js), and
  [SettingsView](../../public/javascripts/ui/settingsView.js) gate controls on
  having a local player rather than being host. The speed listener in
  [main.js](../../public/javascripts/main.js) has the same limitation.
- [The speed suite](../../test/spectator-speed.test.js) currently checks interval
  storage/public information, not real-socket spectator/host authorization.
  Existing ownership suites provide the foundation for rejection/handover tests.

### Host identity and authorization

1. In a new room, the first successfully registered player becomes `hostPlayerId`. Room creation
   and spectator joins alone grant no host authority. Host selection is part of
   the existing registration snapshot transaction; a failed save rolls it back
   together with the roster, verifier, and owner without consuming a handle.
2. The role belongs to that player identity, not to its original socket. Authorize
   through the room's authoritative ownership map, live socket state, and matching
   room membership on every operation. Claimed IDs, socket-side caches, saved
   client state, and public host metadata grant no authority.
3. A socket with several local players can operate room controls if it currently
   owns the host player. Transferring the host player by authenticated handover
   transfers those permissions immediately; leaving or closing the old socket
   cannot revoke the new owner's role or disconnect its players.
4. Publish only public role/status fields: `hostPlayerId`, `hostStatus`
   (`active`, `recovering`, `vacant`, or `blocked`), `hostGraceExpiresAt` where
   applicable, a safe `hostError` code if reassignment cannot be saved, and
   `eligiblePlayerCount`. Never expose tokens or verifiers. Role changes must
   reach remaining room members without relying on lobby-list broadcasts alone.

### Round and speed controls

- An eligible player is a registered roster player marked connected whose
  current authoritative owner is an open socket in this room. Require at least
  `MIN_PLAYERS` (two) eligible players and at most `MAX_PLAYERS` registered slots.
  Two players on one owner socket count as two players. Do not require survivors
  of the previous round to be alive: reset prepares the next round.
- `START_GAME` starts the first or next round only between rounds. It is the
  existing wire action that authorizes the associated arena reset; introduce no
  separate reset button/message or mid-round abort policy in this section.
  A request during preparation/countdown or active physics is rejected without
  resetting, finishing, rescoring, or replacing a timer.
- Check host and roster before mutation. Check eligibility again at the final
  launch boundary. A rejected start preserves registration availability,
  positions, scores, speed, timers, and existing ownership bindings.
- `SET_INTERVAL` is host-only in configuration or after a round finishes.
  Reject it throughout preparation, countdown, and active physics. Accept only
  integer intervals in the existing 10–500 ms range; malformed/out-of-range
  mutation payloads produce an error instead of silently changing speed.
  Creation-time interval normalization is outside this section.
- Successful speed changes are saved before acknowledgement/broadcast; a save
  failure restores the previous interval and reports `PERSISTENCE_FAILED`.
  Room authority and eligibility checks belong in a shared domain operation,
  with explicit trusted internal paths for fixtures; do not rely only on DOM
  disabling or one WebSocket branch.
- Return stable `ERROR` codes with understandable messages: `NOT_IN_ROOM`,
  `HOST_REQUIRED`, `INSUFFICIENT_PLAYERS`, `ROUND_PENDING`, `ROUND_RUNNING`,
  `INVALID_INTERVAL`, and `PERSISTENCE_FAILED`. Preserve any supplied valid
  `requestId` for correlation. Keep existing registration errors, improving
  their human-readable explanation without changing rollback or retry behavior.

### Pending starts and cancellation

- Model room stages explicitly as configuration, preparation, countdown,
  running, finished, and destroyed. Expose stage, `startId`, and prepared
  positions in `GAME_INFO.round` during preparation/countdown. Retain the attempt
  identity through running/finished for event validation, clearing it on
  cancellation. Keep existing `started`/`running` fields consistent: preparation
  counts as started, physics alone counts as running, and cancelling the first
  attempt restores the configuration state. A joiner must not depend on an earlier
  reset broadcast to display the current countdown/positions.
- Let the room own its pending start and timeout handles, or give it an explicit
  cancellation lifecycle that `reset`, `stop`, and `destroy` reliably invoke.
  Capture the room instance and a fresh opaque `startId` per attempt. Every
  callback must verify that exact live room/attempt/stage before acting.
- Keep the current two-second preparation fallback and one-second countdown.
  Readiness is a deduplicated set of the participating owner sockets captured
  when preparation begins, rather than a count of all spectators. Carry
  `{ key, startId, positions }` in `GAME_RESET` and `{ startId }` in `ARENA_READY`.
  Only a current expected participant may acknowledge the current attempt;
  duplicate, stale, spectator, or other-room acknowledgements cannot launch it.
- Freeze registration during preparation/countdown. Cancel the attempt whenever
  any roster player's connected eligibility or authoritative owner changes after
  capture, including a previously disconnected player's authenticated admission,
  participant leave/close/switch, and ownership handover. Host role changes also
  cancel. Spectator-only arrival/departure has no effect. Compare the complete
  before/after roster ownership after a whole admission/handover commits, not
  individual claims; preserve the existing handle-capacity preflight contract.
- Cancellation clears both timers, retires the attempt, and broadcasts a
  consistent idle/finished state and explanation. A cancelled preparation before
  the room's first actual round restores its prior registration availability,
  subject to the six-slot limit. It does not reopen registration in an already
  played room, add a result, or alter accumulated scores. The host starts again
  explicitly; there is no automatic restart/reclaim loop.
- Finish/stop/reset/destroy cannot leave a callback that starts physics later.
  After destruction no callback may touch the arena or broadcast a stale reset.
  Avoid timing-sensitive sleeps in lifecycle regressions: control the clock or
  scheduler and assert cancellation plus stale-callback behavior directly.
- Define protocol-3 `GAME_STATE` as a room/attempt-scoped stage transition with
  an optional cancellation reason, and similarly scope `GAME_FINISH` while
  preserving its score content. The old `running` broadcast used to mean
  countdown before physics; distinguish countdown from running explicitly now.
  Apply cancelled-first-start routing to configuration and cancelled-next-start
  routing to finished scores even if the game screen is already visible.
- In Phase 2, cancel or guard delayed client arena-reset/readiness and score-reveal
  callbacks using the room, socket generation, and attempt identity. Old callbacks
  may not clear a replacement arena, acknowledge another attempt, or replace its
  screen/state. Pending spectator snapshots display the same prepared positions
  without granting readiness/controls. Host labels and final control presentation
  may wait for Phase 4; correct cancellation/wire behavior cannot.

### Host recovery, fallback, and persisted rooms

- An unexpected host socket close reserves the role for 60 seconds. Show recovery
  status and a deadline; nobody can use host controls without owning that player.
  Authentication of the same host player before expiry restores the role. Other
  players and any active round continue under existing disconnect rules.
- An explicit host leave/room switch skips that grace period. Transfer the role
  immediately to the earliest registered eligible player in roster order.
  Spectators, unauthenticated claims, and disconnected players cannot be selected.
- At grace expiry select the earliest registered eligible player. If none is
  available, show `vacant`; the next successful authenticated admission or new
  registration that produces an eligible player elects a host. An expired absent
  role must not indefinitely block later admissions. The returning former host
  remains a normal player once somebody else has durably received the role.
- A successful fresh registration counts as authenticated admission because it
  creates a verified current owner. It may trigger election only where existing
  registration rules allow it, including restored rooms with spare open slots.
  Elect only when host metadata is missing/invalid, the role is vacant, or an
  expired/blocked reassignment needs reconciliation. Preserve a valid saved host's
  unexpired recovery reservation: registration during that grace adds the player
  without replacing the host. When election is permitted, choose the earliest
  eligible roster player after adding the new owner, not necessarily the newcomer.
  Persist that choice inside the registration transaction; a failed save rolls
  back both player and role.
- A live handover of the host player is not a disconnect and does not create a
  grace period. If a countdown is pending it still cancels because its expected
  owner socket changed. Handle whole multi-player release/admission transitions
  atomically enough to avoid electing another player on the same departing socket.
- Persist `hostPlayerId` as an additive version-1 room field. Validate it against
  the restored roster and a usable verifier. Socket ownership, deadlines, timer
  handles, and pending starts are transient. After restart all owners are empty,
  no round/countdown resumes, and a valid saved host gets a fresh 60-second
  recovery window. A version-1 record with no valid host elects only after a
  successful authenticated reconnect or permitted fresh registration. Legacy
  arrays retain their existing
  disconnected/unclaimable policy; unsupported/malformed snapshots remain
  protected from overwrite.
- Persist role assignment/fallback before publishing a new host. On write failure
  retain the last durable identity, grant no candidate privileges, publish
  `hostStatus: blocked`, `hostError: PERSISTENCE_FAILED`, and no active recovery
  deadline. Accepted reconnect claims/ownership stay accepted; a failed role save
  does not undo their acknowledgement or the completed departure of another
  socket. A new registration's combined save failure instead rolls back that
  registration, as required above.
- After storage is repaired, an explicit authenticated `JOIN_GAME`/rejoin
  (including an idempotent rejoin on the same socket) retries reconciliation
  exactly once. At least one accepted claim or a permitted new registration is
  required; spectator/all-invalid joins cannot trigger election. Explain that the
  existing lobby rejoin action is the retry route. If no replacement was durably
  assigned, authenticated recovery of the retained host player can restore its
  active role without granting privileges to a failed fallback candidate; this
  does not restart the expired grace clock. Once a replacement is durably assigned,
  the former host cannot recover the role by rejoining.
- Do not silently write-loop. Cancel host recovery timers when the host recovers,
  is replaced, or the room is destroyed; repeated events cannot extend one grace
  period indefinitely.

### Client behavior and compatibility

- Show the host beside the roster and a short recovery/vacancy status. Derive
  local host permission from server role metadata plus privately acknowledged
  local ownership. Clear it on disconnect, leave, revocation, or room switch.
  Host/eligibility/stage updates must refresh buttons even when no screen changes.
- Enable first/next-round start only for the host with two eligible players in an
  allowed stage. Enable speed changes only for the host between rounds. Preserve
  local speed preferences outside rooms and display the acknowledged room speed
  inside a room without sending feedback mutations. Rejections restore that
  value and display a readable explanation; avoid optimistic permission changes.
- Put permanent host/control feedback markup in the existing Pug templates, per
  [UI markup guidance](../architecture/rendering.md#5-ui-markup-pug-templates-and-javascript).
  Use text nodes/textContent for names and runtime messages. Keep keyboard and
  shared-keyboard play working; disabled controls explain their state.
- Bump the shared protocol version from 2 to 3 when attempt-scoped reset/readiness
  payloads land. Upgrade server, client wire handling, and affected fixtures in
  the same phase. Stale clients receive reload guidance, never a compatibility
  fallback. Preserve binary-only movement/drawing and existing credential and
  input-handle lifetime rules.

## Decisions for user review

These are proposed defaults. Approval of this plan accepts them; none is already
an implemented product decision.

| Decision       | Proposed default and consequence                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| Initial host   | First successfully registered player; an empty room creator has no separate lasting privilege.                       |
| Role lifetime  | Attached to a player, so authenticated ownership handover also moves room controls.                                  |
| Host loss      | 60-second grace after unexpected close; immediate fallback after explicit leave/switch.                              |
| Fallback       | Earliest registered eligible player; former host cannot automatically retake an assigned role.                       |
| Minimum roster | Two currently authenticated/connected players; two local players on one socket qualify.                              |
| Restarting     | No active-round restart; repeated start while pending/running is rejected rather than replacing the current attempt. |
| Speed          | Host-only between rounds; pending countdowns already count as locked.                                                |
| Compatibility  | Coordinated protocol-3 upgrade; additive host metadata in snapshot version 1; restart cancels starts.                |

## Acceptance matrix

| Requirement              | Observable proof                                                                                                                                                                     | Phase |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| Host is server verified  | Real sockets: spectator and ordinary owner rejected; claimed IDs and stale indexes do not authorize; shared socket owning host accepted.                                             | 1     |
| Atomic initial role      | Registration save failure leaves no host, player, verifier, score row, or consumed handle; retry succeeds once.                                                                      | 1     |
| Valid eligible roster    | Zero/one connected owner, disconnected slots, or stale owner rejected before reset; two local players and separate owners accepted.                                                  | 1, 2  |
| Control safety           | Unauthorized/pending/running requests change no positions, scores, interval, pending attempt, or timers; invalid interval and save failure preserve speed.                           | 1, 2  |
| Attempt-scoped readiness | Old, duplicate, spectator, and wrong-room acknowledgements cannot advance a new attempt; fallback launches exactly once.                                                             | 2     |
| Cleanup                  | Controlled-time reset/destroy/participant leave/switch/close/handover cases clear both pending timers and prevent stale physics/broadcasts.                                          | 2, 3  |
| Recovery and fallback    | Grace recovery, exact expiry, immediate voluntary-exit fallback, vacant recovery, no spectator promotion, and old-owner close are verified with real sockets and controlled time.    | 3     |
| Durable roles/restart    | Saved host restores disconnected; missing/invalid host, save failures, legacy data, and unsupported versions preserve defined recovery and private verifiers.                        | 1, 3  |
| Clear client controls    | Independent-context browser host, ordinary owner, replacement, and spectator see correct buttons, statuses, speed, and actionable errors; one keyboard with two players still works. | 4     |
| Compatibility/privacy    | Protocol-2 client rejected; binary drawing/input and original ownership suites pass; public role/status messages contain no credentials/verifiers.                                   | 2, 4  |
| Complete section         | Five open roadmap items linked to verified evidence; full suite and required browser checks pass for final branch and applicable PR candidate.                                       | 4     |

## Phases

### Phase 1 — Verified host identity and control admission

- [ ] Add initial host selection, authoritative per-operation host checking, and
      eligible-roster validation before reset/start side effects.
- [ ] Persist/restore the additive host field, include safe role/eligibility
      metadata in public room info, and cover registration rollback of initial host.
- [ ] Restrict start and interval operations by host and allowed current state;
      validate interval mutations and save/rollback them without optimistic success.
- [ ] Add a minimal room-owned pending-admission latch before scheduling a start;
      shared start/speed guards consult it to reject duplicate starts and speed changes
      during preparation/countdown. Phase 2 replaces it with the full stage/attempt
      lifecycle; `running` alone cannot satisfy this Phase 1 guarantee.
- [ ] Return stable/readable control and registration errors. Add meaningful
      domain and real-socket tests; adapt affected existing fixtures in this phase.
- [ ] Update protocol/lifecycle documentation for landed behavior.

Dependencies: merged ownership baseline. Exit: host/roster/speed guard regressions
and the full required CI suite pass. Interim limitations: dedicated pending-stage
cleanup and automatic host recovery/fallback are not complete; client controls
may still expose actions the server rejects. This phase alone is not launch-ready.

### Phase 2 — Cancellable preparation and countdown

- [ ] Tie pending start/timers to the room lifecycle with explicit stages,
      attempt identity, participant readiness, and final-launch validation.
- [ ] Cancel on reset/stop/destroy and committed participant ownership/membership
      transitions; preserve registration/score behavior on cancelled first starts.
- [ ] Introduce protocol-3 reset/readiness payloads and update client wire handling
      plus every affected fixture together; retain existing binary and ownership rules.
- [ ] Implement authoritative cancellation screen/state routing, pending snapshot
      positions, and generation guards/cancellation for delayed client callbacks in
      this phase. Add browser coverage for immediate retry, switch, and reconnect;
      cover late authenticated roster admission and spectator-only joins separately.
- [ ] Prove exactly-once launch and stale-callback rejection with controlled time,
      including both the readiness path and preparation timeout fallback.
- [ ] Update protocol/lifecycle/testing guides for these contracts.

Dependencies: Phase 1. Exit: cancellation and wire regressions plus existing real
browser suites pass. Interim limitations: host vacancy/fallback policy and final
host-aware UI have not landed; pending cleanup does not complete general reaping.

### Phase 3 — Host recovery and deterministic fallback

- [ ] Implement 60-second unexpected-close recovery, immediate leave/switch
      fallback, deterministic eligible-player selection, and vacancy recovery.
- [ ] Integrate atomic multi-player release/handover, role-change persistence,
      timer cancellation, and broadcasts; failed writes grant no new role.
- [ ] Restore valid saved host identity with disconnected owners and fresh grace;
      migrate missing/invalid host metadata through authenticated reconnect or
      permitted fresh registration, with election included in registration rollback.
- [ ] Test before/at/after deadline, no eligible candidates, shared-socket exit,
      partial handover, former-owner close, failed persistence followed by explicit
      authenticated rejoin retry, fresh registration during restored-host grace
      without replacement, and cold restart.
- [ ] Document recovery, role loss, and restart behavior without phase labels in
      the living architecture guide.

Dependencies: Phase 2. Exit: all host lifecycle/persistence regressions and required
CI pass. Interim limitations: server contract complete, final UI/acceptance audit
pending; intentional manual handover and broader room cleanup remain excluded.

### Phase 4 — Host-aware UI, integrated acceptance, and closure

- [ ] Add host/recovery/control feedback in Pug and update configuration, game,
      and settings views from acknowledged role, roster, and stage changes.
- [ ] Preserve outside-room speed preference, avoid reflected speed feedback,
      and restore authoritative UI values after rejected operations.
- [ ] Add a required independent-context real-Chromium authority journey with
      host, ordinary player, spectator, and replacement; keep shared-keyboard,
      reconnection, leak, and binary protocol acceptance intact.
- [ ] Make any new browser suite fail on unavailable Chromium in CI and local
      required coverage, include diagnostics, and lint it in the existing workflow.
- [ ] Audit the matrix, update CHANGELOG under Unreleased, close only the five
      proven roadmap items with plan/progress links, and update architecture guides.
- [ ] Obtain final independent testing/review and exact-head push/PR CI; deliver
      the feature PR for user review with remaining limitations and migration notes.

Dependencies: Phase 3. Exit: all acceptance rows have actual evidence and final
required CI passes. General membership/reaping, scoring, resource limits, and
public-launch work remain open.

## Verification and execution policy

### Readiness established during planning

- GitHub connector read access and branch creation worked. This preparation uses
  an isolated local source snapshot for inspection, not the user's live checkout;
  it has no access to uncommitted work on other machines. Future writes must
  re-read remote heads and preserve tree modes, symlinks, and unrelated files.
- The baseline `8f89e08235cf042abb1df346399a0343f1ae0666` passed Tests push run
  `38083302492`, job `114304495105`: logs show **23 passed, 0 failed** and executed
  browser smoke, independent-context ownership flow, and client leak suites.
  Step results and job logs are accessible. This is baseline evidence, not proof
  of future candidates or an independently tested feature.
- Shell Node/npm/Git and independent agent/model controls are exposed. A full
  locked dependency installation and local Chromium launch have not been proven
  in this session. Use GitHub Actions for required browser execution when local
  prerequisites are unavailable; report local failures/unavailable checks honestly.
- The [current workflow](../../.github/workflows/ci.yml) uses Node 24, `npm ci`,
  Chromium installation, selected browser-test ESLint, and `npm test`. It does
  not run repository-wide formatting/lint; perform scoped checks separately.

### Proposed execution after user approval

- Lead: the current user-selected session model/effort (requested Sol 6.1/max).
  Implementation: separate Sol 6.1/high agent. Testing: separate Sol 6.1/high
  agent. Independent review: Sol 6.1/xhigh; escalate to the highest verified
  supported effort for a concrete unresolved authorization/concurrency problem.
  Follow [model-selection and tracking rules](../../.agents/skills/implement-roadmap-section/references/agents.md).
  Report substitutions; do not describe self-review as independent agent review.
- First record the approved immutable plan revision and actual user approval in
  a companion `2026-10-11-registration-invariants-and-round-authority-progress.md`.
  Do not copy the previous ownership plan's approval onto this new scope.
- Implement phases sequentially with independent testing and diff-based review,
  scoped ESLint, scoped Prettier, meaningful affected suites, and `npm test`.
  Update relevant docs, write the phase message to `tmpcommit.md`, commit only
  intended changes, and push without force after checking the live head.
- Require the Tests job for the exact candidate before advancing. At final
  handoff require branch and applicable PR checks, including actual Chromium
  execution and the new authority browser journey. No skips or stale green run
  can satisfy required coverage. New substantive CI fixes return to testing/review.
- Stop for material contract changes, genuine access blockers, or unresolved
  failures after the skill's bounded diagnosis. Routine implementation fixes
  within this plan do not require another approval. Checkpoint on interruption.
- Record role/model/effort, timestamps, outcomes, findings/follow-ups, and available
  usage telemetry; write unavailable when unknown. Include a grounded efficiency
  retrospective without invented subscription/cost savings or extra comparison runs.

## Migration and rollback

Coordinate the protocol-3 server/client upgrade; users with stale pages must reload.
Saved player credentials remain valid. New role fields do not grant ownership;
version-1 snapshots without them retain verifier-based authenticated recovery.
Malformed/future snapshots keep the existing protected behavior. Restart never
resumes pending timers or an in-progress round.

Back up `games.json` before upgrade. Rolling back requires matching prior client
and server code; prior code ignores new host metadata and restores its older
any-owner control policy. Restore the pre-upgrade snapshot for an exact data
rollback, accepting loss of changes since that backup. Preserve existing atomic
rename durability limitations; adding fsync or a new persistence backend is out
of scope. No merge, release, or deployment is authorized by planning approval.

## Approval gate

Await user review and explicit approval of this plan revision and its autonomous
implementation/commit/push/CI policy. The current request authorizes only branch
preparation, model-guidance changes, and this planning document. Agent plan review
is advisory; it cannot approve the product decisions or implementation.

### Advisory plan review

Read-only task `round_authority_plan_review` requested Sol 6.1/xhigh in a separate
context. The spawning tool accepted those requested settings; actual model/effort
and token/usage telemetry were not independently exposed in the task. Observed
review windows were 2026-10-11 06:45:54.532–06:48:18.342 UTC and
06:51:35.017–06:51:58.059 UTC; these are wall-time observations, not compute time.

The review found late authenticated admission missing from cancellation, an
undefined failed-fallback retry, delayed client callback/state routing gaps,
Phase 1's missing pending latch, and inconsistent restored-room registration
election. The revised contracts address all five. The follow-up additionally
required preserving a valid restored host's grace during fresh registration;
that condition and its regression are now explicit. This is plan review only,
not independent implementation verification or user approval.

A final narrow read-only check at 2026-10-11 06:53:56.351–06:53:56.992 UTC
confirmed that the grace correction resolves the last finding. No reported plan
review findings remain open; implementation and its product choices still await
user approval.

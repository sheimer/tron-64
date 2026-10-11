# Registration invariants and round authority — Implementation plan

- Date: 2026-10-11
- Status: Approved for autonomous implementation on 2026-10-11; see [execution progress](2026-10-11-registration-invariants-and-round-authority-progress.md)
- Roadmap section: [Milestone 1 — Registration invariants and round authority](../../ROADMAP.md#registration-invariants-and-round-authority)
- Branch: `feat/registration-invariants-and-round-authority`
- Base: `main` at `8f89e08235cf042abb1df346399a0343f1ae0666`
- Existing PR: draft #5; reuse it for implementation
- Dependency: completed ownership/reconnection work, merged in PR #4 and included in this baseline

## Goal and scope

Establish server-verified ownership of a room by its creator client. Only that
client may start the first round; after the first round has successfully begun,
any open client joined to the room may start the next round between rounds.
Room ownership is independent of which players/bikes a client controls.

The user specified client ownership and first/subsequent-round permissions during
review on 2026-10-11. Any joined client includes spectators; this is a settled
requirement. Keep protocol version fields, an exact check against the single current
version, and reload guidance for mismatched clients. The server supports only that
version and its current message formats; no older-version compatibility branches
or fallbacks. These are settled requirements. The complete revised plan
has now received implementation approval, including its proposed defaults.

Validate two-to-six registered slots and at least two eligible connected players
before reset and again before launch. A requester need not control a bike.
Preserve shared-keyboard play, spectators, scores, authenticated bike recovery,
and binary-only movement/drawing. Existing per-player credentials concern bike
control and recovery; they grant no room ownership or special round-start role.

Speed changes are a creator-client permission, only between rounds.
A client may create and own a room without registering any local players. Any
open client joined to the room, including spectators, qualifies for later starts;
a lobby client or a client in another room cannot operate this room.

Excluded: broader membership/capacity/reaping, network limits, scoring and metrics
changes, active-round slot replacement, creation-form speed options, manual
ownership transfer, accounts, deployment, and replacing existing bike credentials.
Touch membership only where it affects room-owner binding and pending starts.
Automatic ownership election/takeover is excluded: it would let another client
perform a first start reserved to the creator. Deliberate ownership transfer
remains a later [room feature](../../ROADMAP.md#target-v180--milestone-4-room-features--matchmaking).

## Current behavior and proposed contract

### Code-backed findings

- [WebSocket handling](../../server/wsHandler.js) authorizes `START_GAME` and
  `SET_INTERVAL` when the caller owns any room player. There is no host role.
  A start resets the arena, replacing an earlier pending start, even if a round
  is already running. Unauthorized controls are silently ignored.
- `CREATE_GAME` privately returns a room key but records no creating-client
  ownership or recovery credential. A new room-owner acknowledgement and join
  proof are needed; existing bike credentials cannot establish who created it.
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
  having a local player rather than creator/first-launch permissions. The speed listener in
  [main.js](../../public/javascripts/main.js) has the same limitation.
- [The speed suite](../../test/spectator-speed.test.js) currently checks interval
  storage/public information, not real-socket spectator/host authorization.
  Existing ownership suites provide the foundation for rejection/handover tests.
- [LobbyView](../../public/javascripts/ui/lobbyView.js) disables ordinary joining
  when bike registration is closed and recognizes saved bike claims alone as
  rejoin evidence. It also deletes saved room records absent from the public-only
  lobby list, which cannot establish that a private room has been destroyed.

- [The current wire implementation](../../shared/protocol.js),
  [NetworkClient](../../public/javascripts/network.js), and WebSocket handling
  carry/check the shared current protocol version (currently `2`). The server
  rejects a mismatch before processing the request; NetworkClient validates the
  initial lobby version and shows reload guidance. main.js and the browser smoke
  test also cover mismatch feedback. Preserve this strict single-version guard;
  it does not provide older-version compatibility.

### Creator-client identity and room ownership

1. `CREATE_GAME` establishes a room-scoped creator-client identity and a private
   recovery credential before any player registration. Persist its verifier with
   the new room; on save failure, remove the entire room and acknowledge no
   creation/ownership success. Successful player registration never elects or
   replaces a room owner.
2. Return `{ key, ownerClientId, roomOwnerToken }` only in a private correlated
   `GAME_CREATED` acknowledgement. Require a valid creation `requestId`, match it
   to the current connection/request, then store the owner credential in the
   existing room-scoped `sessionStorage` record independently of bike records.
   Keep creation retries bounded/idempotent on the same socket/request so a lost
   acknowledgement cannot create another room for each retry. A different payload
   with the same request ID conflicts; only a live matching room may be replayed.
3. A logical creator client survives socket replacement by authenticating its
   saved room credential in `JOIN_GAME`. The server then binds that room-owner
   identity to the admitted socket. A public ID, IP address, arbitrary player IDs,
   or owning any bike cannot establish that binding. The current owner binding
   and live membership are authoritative on each restricted operation.
4. Keep owner recovery separate from the existing per-bike reconnect array.
   Authenticate each claim independently, preflight room admission and all bike
   handle allocations before any membership/owner mutation, then return separate
   correlated owner and bike results. An invalid owner claim grants no creator
   controls even if bike claims succeed; owner authentication without bike claims
   can succeed without allocating input handles. Resource-preflight failure leaves
   all prior owner/bike bindings untouched.
5. Transferring one or all bike controls does not transfer room ownership. Owner
   authentication on a replacement socket replaces only the room-owner binding
   unless bike credentials are also claimed. Revoke the old socket's room controls
   immediately; its later leave/close cannot release the replacement owner.
   Do not use a designated 'host player' or infer creator authority from a roster.
6. Public room info may include `ownerClientId`, `ownerStatus` (`present`, `away`,
   or `unrecoverable`), `firstRoundStarted`, and `eligiblePlayerCount`. Presence
   means an authenticated owner socket is open and joined to this room. Publish no
   token or verifier. Public metadata describes authority; it cannot grant it.

### First/next-round and speed permissions

- An eligible player is a registered roster player marked connected whose
  authoritative bike owner is an open socket in this room. Require at least
  `MIN_PLAYERS` (two) eligible players and at most `MAX_PLAYERS` registered slots.
  Two local players on one socket qualify. Do not require survivors of the
  previous round to be alive; reset prepares the next round.
- Persist `firstRoundStarted` independently of completed scores. It starts false.
  While false, only the currently authenticated creator client may request
  `START_GAME`, even if that client controls zero bikes. Never infer creator
  authority from being the first player to register.
- After a round has been successfully committed for launch, any open joined
  room client may request a later `START_GAME`, including a spectator or a client
  without local bike bindings. The creator's presence is not required for later
  rounds. Global roster eligibility and the between-round gate still apply.
- The first-start permission is not consumed by rejection, reset, preparation,
  countdown, cancellation, or a failed snapshot write. At the final launch
  boundary revalidate the initial creator binding, room attempt, and roster, then
  durably set `firstRoundStarted` before starting physics. For subsequent rounds,
  requester membership is checked at admission; a spectator requester leaving
  afterwards does not cancel an otherwise unchanged attempt.
  If that write fails, keep it false, cancel the attempt, and report
  `PERSISTENCE_FAILED`. A crash after the launch flag commits but before the first
  tick restores the committed launch decision; it does not restore physics.
- `START_GAME` authorizes the existing reset needed for a first/next round.
  Introduce no separate reset message/button or mid-round abort policy. Reject
  duplicate starts during preparation/countdown and all starts during physics
  without resetting, finishing, rescoring, or replacing a timer. Creator-only
  first starts and any-client later starts use the same domain admission operation.
- `SET_INTERVAL` is a proposed creator-client-only operation in configuration or
  after a round finishes. Reject it during preparation, countdown, and physics;
  granting a next-round start does not grant speed permission. A creator with no
  bikes can change speed. Accept only integer intervals in the existing 10–500 ms
  range. Creation-time interval normalization remains outside this section.
- Check membership, relevant creator authority, stage, and roster before mutation.
  Rejected starts preserve registration availability, positions, scores, speed,
  timers, launch marker, and all bindings. Save a speed change before success
  broadcast; on failure restore the previous interval. Use explicit trusted
  internal fixture paths rather than exposing a network bypass.
- Return stable/readable `ERROR` codes: `NOT_IN_ROOM`, `CREATOR_REQUIRED`,
  `INSUFFICIENT_PLAYERS`, `ROUND_PENDING`, `ROUND_RUNNING`, `INVALID_INTERVAL`,
  `INVALID_OWNER_CREDENTIAL`, and `PERSISTENCE_FAILED`. Preserve supplied valid
  request IDs. Keep existing registration errors and their rollback/retry behavior.

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
  participant leave/close/switch, and bike ownership handover. Before the first
  launch, loss or replacement of the creator-client binding also cancels, even
  when it controls no bike. After the first launch, creator binding changes alone
  do not cancel if it is not a bike participant. Spectator-only arrival/departure
  otherwise has no effect. Compare the complete
  before/after roster ownership after a whole admission/handover commits, not
  individual claims; preserve the existing handle-capacity preflight contract.
- Cancellation clears both timers, retires the attempt, and broadcasts a
  consistent idle/finished state and explanation. A cancelled preparation before
  the room's first actual round restores its prior registration availability,
  subject to the six-slot limit. It does not reopen registration in an already
  played room, add a result, or alter accumulated scores. An authorized client
  starts again explicitly; there is no automatic restart/reclaim loop.
- Finish/stop/reset/destroy cannot leave a callback that starts physics later.
  After destruction no callback may touch the arena or broadcast a stale reset.
  Avoid timing-sensitive sleeps in lifecycle regressions: control the clock or
  scheduler and assert cancellation plus stale-callback behavior directly.
- Define current-contract `GAME_STATE` as a room/attempt-scoped stage transition with
  an optional cancellation reason, and similarly scope `GAME_FINISH` while
  preserving its score content. The old `running` broadcast used to mean
  countdown before physics; distinguish countdown from running explicitly now.
  Apply cancelled-first-start routing to configuration and cancelled-next-start
  routing to finished scores even if the game screen is already visible.
- In Phase 2, cancel or guard delayed client arena-reset/readiness and score-reveal
  callbacks using the room, socket generation, and attempt identity. Old callbacks
  may not clear a replacement arena, acknowledge another attempt, or replace its
  screen/state. Pending spectator snapshots display the same prepared positions
  without granting readiness or bike controls. Spectators retain permission to
  request subsequent starts when idle. Owner labels and final control presentation
  may wait for Phase 4; correct cancellation/wire behavior cannot.

### Creator recovery and persisted rooms

- Keep ownership with the creator's logical client while the room exists. Leaving,
  switching rooms, or closing releases its current socket binding, not the durable
  owner identity/credential. A saved valid owner credential can authenticate the
  creator again on a new or existing admitted socket without registering a bike.
  There is no automatic election, expiry, or 60-second takeover window.
- Before the first launch, an absent creator blocks the initial start. Other
  clients may join/register under existing rules and wait for creator recovery;
  show why start is unavailable. Without a recoverable creator credential, users
  create a new room. This is an explicit limitation of creator-only first starts,
  not a promise that another client can take over. General stale-room reaping
  remains the next roadmap section.
- After the first launch, owner absence cannot block later round starts by joined
  clients with a valid eligible roster. Under the proposed speed policy, speed
  remains unchanged until the creator authenticates again. Deliberate ownership
  transfer can be planned separately; ordinary joining/player registration cannot
  seize ownership or bypass the initial-start gate.
- Owner recovery has its own private result. Restore local creator controls only
  after a matching acknowledgement for the current room, socket generation, and
  request. On owner-binding revocation stop automatic reclaim; explicit saved-room
  rejoin may authenticate again. Keep ordinary network reconnect bounded and do
  not introduce an ownership reclaim loop.
- Persist the creator client ID and credential verifier under a private room-owner
  field alongside existing private bike verifiers, plus public
  `firstRoundStarted`, as additive snapshot-version-1 fields. Never persist a raw
  room token, live socket, input handle, pending attempt, or timer. Validate the
  creator metadata independently of roster entries; a room can validly have zero
  registered players.
- On cold restore all bikes and the room-owner socket start disconnected. Preserve
  the durable creator proof and launch marker; no pending/in-progress round resumes.
  Successful owner authentication restores room permissions independently of which
  bike claims were accepted. Owner handover plus old-owner close must not revoke
  either the replacement room binding or replacement-owned bikes.
- A valid restored `firstRoundStarted: true` closes new bike registration and
  restores `started: true`, `running: false`, and a finished/idle next-round stage,
  even when no round completed before a crash (`gamecount: 0`). Preserve actual
  scores; show that the interrupted round produced no result, without inventing a
  score or restoring an attempt. After bike recovery, any joined client may start
  the next round. A false marker restores configuration and normal slot-capacity
  registration rules. Legacy completed history likewise closes registration.
- For an older version-1 record without the launch marker, positive completed-round
  history can establish that the initial round already happened. Without that
  evidence retain the first-start restriction. Missing/invalid creator metadata
  never elects the first registered/reconnecting client: mark owner recovery
  unavailable. A legacy already-played room can allow later starts by joined
  clients; an unstarted room without creator proof requires a new room. Legacy
  array bike credentials retain their disconnected/unclaimable behavior.
- Validate launch restoration with the matrix below. Only an omitted marker is a
  legacy marker; a present marker must be a strict boolean. Completed-round
  evidence must be a nonnegative safe integer; an omitted count means no completed
  evidence and normalizes to zero. Do not coerce strings, null, or other values.
  Protected-invalid launch data follows existing `INVALID_SNAPSHOT` behavior:
  restore no rooms, mark storage read-only, preserve the original file, and require
  manual recovery from a valid snapshot before writes/creation can succeed.
- Malformed/missing creator proof is independent of launch validity: it grants no
  creator controls and sets owner recovery unavailable, but valid bike recovery
  and legitimate later-start permission remain intact. Invalid launch data grants
  no initial-start bypass. Preserve future/malformed-snapshot protection and bike
  verifiers, and cover each matrix row plus malformed creator proof separately.
  Snapshot I/O failure returns an actionable error without assigning a new owner
  or silently retrying writes. Restart migration/recovery decisions are part of
  user review because old snapshots did not identify the creating client.

| Launch marker      | Completed-round history                              | Restored behavior                                                                                     |
| ------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `false`            | Zero or omitted                                      | Creator-only initial start; configuration; normal slot-capacity registration.                         |
| `true`             | Valid zero, omitted, or positive count               | Any joined client may start later rounds; registration closed; finished/idle with actual scores only. |
| Omitted            | Strictly validated positive count                    | Migrate to `true`; later-round behavior above.                                                        |
| Omitted            | Zero or omitted                                      | Migrate to `false`; initial-round behavior above.                                                     |
| `false`            | Positive count                                       | Contradictory; protected-invalid snapshot.                                                            |
| Present nonboolean | Any                                                  | Malformed; protected-invalid snapshot.                                                                |
| Any                | Present count that is not a nonnegative safe integer | Malformed; protected-invalid snapshot.                                                                |

### Client behavior and current wire protocol

- Display room ownership as a client role, such as 'You created this room' and
  creator present/away/recovery-unavailable status. Do not mark any player row as
  host or require a chosen bike for room controls. Local creator permission needs
  an accepted private owner result and the matching current server binding.
- Enable the initial start only for that creator client with two eligible players
  in an allowed stage. After the durable first-launch marker, enable later starts
  for any joined client, including spectators, under the same roster/stage gate.
  Refresh on ownership, stage, roster, and launch-marker changes without needing a
  screen transition. Clear live creator permission on close/leave/switch/revocation.
- Enable room speed changes only for the creator between rounds under the proposed
  default. Preserve outside-room preferences; display acknowledged room speed
  inside a room without reflected mutation feedback. Rejecting an operation
  restores its authoritative value and shows an understandable message.
- Saved room rejoin must be available with an owner credential alone, even when
  there are no saved local bike credentials and player registration is closed.
  Update lobby rejoin detection and storage validation accordingly. Ordinary joins
  without a creator proof confer no owner privilege. Keep bike control restoration
  and ownership-revoked behavior unchanged except for the separate room-owner result.
- Separate room admission from bike registration in the lobby and direct-room
  entry: a new spectator may join a room with registration closed, subject to
  existing server admission/capacity checks. An owner-only saved record must retain
  its credential through normalization with an empty local-bike map.
- Absence from the filtered public lobby list must not delete a saved room-owner
  or bike credential. Clear a missing-room record only after a correlated
  `GAME_NOT_FOUND` response to an explicit join of that room, with matching current
  connection/request. Invalid credentials, capacity errors, or connection loss
  preserve records for explicit recovery; do not add background existence probes.
- Put permanent owner/control feedback in the existing Pug templates, per
  [UI markup guidance](../architecture/rendering.md#5-ui-markup-pug-templates-and-javascript).
  Use text nodes/textContent for names and messages. Preserve keyboard/shared
  keyboard operation and explain disabled controls.
- Keep one shared `PROTOCOL_VERSION` and the wire `protocolVersion` fields.
  Phase 1 advances the current value from 2 to 3 for the changed creation/owner
  payloads. Update client, server, fixtures, and docs together; accept only the
  current shared value. Phase 2 advances the current value again for its changed
  reset/readiness/stage payloads, updating both ends together. Each phase accepts
  only its current value; previous values receive mismatch/reload guidance.
- Preserve strict version checks and `PROTOCOL_MISMATCH` reload guidance. Missing,
  invalid, older, or future wire versions cannot authorize room mutations or input.
  Reject a mismatched request before mutation and preserve a valid request ID;
  mismatched clients must see that they need to reload. Keep the current browser
  initialization/version check and connection feedback behavior.
- Use an exact-current-version guard, not a supported-version list or negotiated
  range. Do not add per-version handlers, older payload shapes, aliases, adapters,
  JSON movement/drawing fallbacks, or a dual-version rollout. Each implementation
  phase and its fixtures use only the current message contract. Tests that reject
  mismatched versions are required; they are not older-version support.
- Preserve version readiness plus authenticated room admission/accepted bike
  bindings before input. Keep private acknowledgements, authoritative ownership
  and input-handle checks, binary opcode/length/direction validation, and
  room/attempt/generation guards. Binary movement/drawing remains unchanged; its
  connection must have joined using the current version. Retain mismatch/reload
  tests and useful error feedback/layout coverage.

## Confirmed requirements and proposed policies

Client ownership, first/subsequent start permissions, inclusion of joined
spectators, and strict checking of a single current wire version with mismatch
reload guidance are settled user requirements.
The other rows describe policies approved with the complete plan on 2026-10-11.

| Decision                    | Contract                                                                                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial versus later starts | Creator client alone starts the first round; any joined room client may start subsequent rounds between rounds. User-specified.                                                                                                         |
| Room ownership              | Belongs to the client that creates the room, independently of its local players/bikes. User-specified.                                                                                                                                  |
| Meaning of any client       | All open joined room clients, including spectators and clients with no local bikes. Lobby, other-room, and disconnected clients are outside that room's membership. Settled requirement.                                                |
| Wire protocol               | Keep version fields, strict equality against the one current version, and mismatch/reload guidance. Accept only the current wire format; no older-version handlers, adapters, fallbacks, or multiple accepted versions. User-specified. |
| Recovery                    | A private room credential restores the same logical creator on a replacement socket; bike handover does not transfer room ownership.                                                                                                    |
| Owner loss                  | No automatic takeover. Before the first launch wait for creator recovery or create a new room; later starts remain available without the creator.                                                                                       |
| Minimum roster              | Two authenticated/connected bikes; two on one shared client qualify, and the requester need not own either.                                                                                                                             |
| Restarting                  | No active-round restart; repeated start while pending/running is rejected. Cancellation does not consume the creator-only initial start.                                                                                                |
| Speed                       | Creator-client-only between rounds; unrestricted later starts do not imply permission to change speed. Proposed default.                                                                                                                |
| Persisted rooms             | Additive private creator proof and durable first-launch marker in snapshot version 1; legacy unstarted rooms without creator proof require a new room.                                                                                  |

The [roadmap](../../ROADMAP.md#registration-invariants-and-round-authority) is
updated to describe these planned permissions, including the deliberate later-round
spectator permission. All implementation checkboxes remain unchecked.

## Acceptance matrix

| Requirement                | Observable proof                                                                                                                                                                                                                                                                                                                | Phase   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Creator-client identity    | Creation before player registration grants recoverable room authority only via private correlated proof; arbitrary client/player IDs do not authorize.                                                                                                                                                                          | 1       |
| Atomic creation            | Failed save leaves no room/owner; same-request retry returns one room and the same private result without additional allocations.                                                                                                                                                                                               | 1       |
| First versus later starts  | Creator with zero bikes can start a two-bike initial round; another player client/spectator cannot. After committed first launch both can start a later round; lobby/other-room clients cannot.                                                                                                                                 | 1, 4    |
| Durable first-launch gate  | Rejection, countdown cancellation, and failed launch save keep the initial restriction; completed/committed launch and cold restore preserve later-round permission.                                                                                                                                                            | 1, 2, 3 |
| Valid eligible roster      | Disconnected/stale-owner slots do not meet the minimum; two local bikes and separate bike-owner clients do; requester bike count is irrelevant.                                                                                                                                                                                 | 1, 2    |
| Control safety             | Pending/running starts and unauthorized speed changes mutate no positions, scores, interval, attempt, or timers; invalid interval/save failure preserve speed.                                                                                                                                                                  | 1, 2    |
| Attempt-scoped readiness   | Duplicate/stale/spectator/wrong-room acknowledgements cannot launch; readiness and preparation timeout each launch at most once. A spectator may request a later start without acknowledging readiness.                                                                                                                         | 2       |
| Cleanup                    | Controlled-time reset/destroy/participant leave/switch/close/handover and initial-creator binding loss clear pending timers and prevent stale physics/broadcasts.                                                                                                                                                               | 2, 3    |
| Independent owner recovery | Owner-only rejoin works with zero saved bikes; transferring bike controls does not transfer room authority; mixed owner/bike claims and resource preflight preserve correct independent results.                                                                                                                                | 1, 3    |
| Durable identity/restart   | Zero-player creator recovery, lost/invalid proof, old already-played/unstarted rooms, invalid marker, save failures, and cold restore follow the documented policy without new ownership election; committed launch with zero completed rounds restores closed registration and later-start permission without invented scores. | 3       |
| Room entry and saved proof | New spectators can join registration-closed rooms; owner-only records survive normalization; omission of a live private room from the public list preserves saved credentials, while a matching explicit missing-room response can clear its record.                                                                            | 3, 4    |
| Clear client controls      | Independent browser contexts for creator, ordinary bike client, owner replacement, and spectator show creator-only initial controls, any-client later starts, speed/status/errors, and shared-keyboard play.                                                                                                                    | 4       |
| Current protocol/privacy   | Current client/server/fixtures agree on the shared version; missing, invalid, older, or future versions are rejected before mutation/input and show reload guidance. No multiple-version handlers/fallbacks; binary/ownership suites pass; public packets and logs expose no creator or bike secrets.                           | 1, 4    |
| Complete section           | Five open roadmap items linked to evidence under the clarified policy; full suite and required browser checks pass for final branch/applicable PR candidate.                                                                                                                                                                    | 4       |

## Phases

### Phase 1 — Creator-client identity and first/next-round admission

- [x] Create and durably acknowledge independent room-owner credentials with
      bounded correlated creation retries; authenticate owner claims on join without
      requiring a player registration. Update the single current wire contract,
      minimal client storage, creation/join handling, and affected fixtures together.
- [x] Retain shared version constants/fields, strict-current-version checks,
      version readiness, and mismatch/reload feedback. Advance the shared version
      for the new wire contract and update both ends/fixtures together. Prove
      mismatch rejection before mutation/input while allowing only the current
      format; add no compatibility branches, adapters, or older-version handlers.
- [x] Preserve the independently stored owner credential through room-record
      normalization from this phase onward; owner-only records have an empty bike map.
- [x] Gate the first start by verified creator-client binding and later starts by
      live room membership. Validate the eligible roster and save the first-launch
      marker only at successful launch; failed launch save preserves the initial gate.
- [x] Restrict interval mutations to the creator between rounds, including a
      creator with zero bikes; validate/save/rollback with stable/readable errors.
- [x] Add a minimal room-owned pending latch before scheduling preparation so
      duplicate starts and speed changes are rejected before physics is running.
- [x] Add domain and real-socket regressions for creator-before-registration,
      creator-without-bikes, forbidden noncreator first starts, spectator/player later
      starts, transactional failures, and separate owner/bike claims. Adapt affected
      baseline browser fixtures in this phase so they exercise the current contract.
- [x] Update protocol/lifecycle docs for landed behavior and permission distinctions.

Dependencies: merged ownership baseline. Exit: authority/marker/speed regressions
and the full required CI suite pass. Interim limitations: complete cancellable
attempt/client routing and cold-restore/owner-revocation acceptance are pending;
this phase alone is not launch-ready.

### Phase 2 — Cancellable preparation and countdown

- [ ] Tie pending stages/attempts/timers to the room lifecycle, capture participant
      readiness, and revalidate roster/initial creator binding at final launch.
- [ ] Cancel on reset/stop/destroy and committed participant ownership/membership
      changes, including late disconnected-bike admission. Loss/replacement of the
      initial creator binding cancels a first attempt even when the creator owns no
      bikes; spectator-only changes do not cancel later attempts.
- [ ] Add attempt-scoped reset/readiness/stage/finish messages and pending snapshot
      positions; update server, client and affected fixtures together for the current contract.
- [ ] Implement authoritative cancellation routing and delayed client callback
      generation guards here. A cancelled first attempt returns to configuration with
      its creator gate intact; a cancelled later attempt returns to finished scores.
- [ ] Prove exactly-once launch and stale callback rejection under controlled time,
      plus browser cancellation/retry/switch/reconnect and spectator-initiated later
      start coverage. Preserve registration/scores on cancellation.
- [ ] Update protocol/lifecycle/testing guides for these contracts.

Dependencies: Phase 1. Exit: cancellation/wire regressions and existing required
browser suites pass. Interim limitations: comprehensive creator recovery/migration
and final permission presentation are pending; broader room reaping is excluded.

### Phase 3 — Independent creator recovery and persisted-room migration

- [ ] Restore creator verifier/identity and the durable launch flag with no live
      owners or pending round. Handle zero-player rooms and legacy missing/invalid data
      without electing a player or joining client as owner.
- [ ] Restore committed-launch rooms as registration-closed/idle even when no
      result completed; preserve scores and show interrupted-round recovery without
      fabricating a result. Cover public stage/started fields and next-round admission.
- [ ] Finish owner-only saved-room rejoin and private result validation, plus
      current-socket-only revocation/release on owner proof handover, leave, switch,
      and close. Preserve independent bike claims/bindings and preflight rollback.
- [ ] Preserve owner-only records and credentials for rooms absent from the public
      lobby list; remove missing-room records only on matching explicit join failure.
      Make registration-closed room admission available to new spectators and owners.
- [ ] Test creator credential recovery with no bikes, transfer of all creator bikes
      without transfer of the room role, replacement-owner versus former-socket close,
      mixed valid/invalid owner/bike claims, handle/room-capacity rejection, and restart.
- [ ] Verify absent creator blocks only initial start and owner-only speed changes,
      while later eligible rounds remain startable by any joined client. Test legacy
      already-played versus unstarted recovery policy and failed first-launch writes.
- [ ] Document credential loss, creator absence, restart/migration limitations and
      the absence of automatic ownership transfer in the living lifecycle guide.

Dependencies: Phase 2. Exit: creator recovery/persistence regressions and required
CI pass. Interim limitations: final UI/acceptance audit pending; manual ownership
transfer and general membership cleanup remain excluded.

### Phase 4 — Client permission UI, integrated acceptance, and closure

- [ ] Add client-owner/status/control feedback in Pug and update configuration,
      game, settings, and lobby from verified owner binding, launch flag, stage, and
      global eligible roster; never attach the owner role to a chosen player row.
- [ ] Present owner-only initial start, any-joined-client next starts, and proposed
      owner-only speed distinctly. Preserve preferences and authoritative values on
      rejection, clear stale permission, and support owner-only rejoin records.
- [ ] Add a required independent-context real-Chromium journey covering creator
      without bikes, other registered client, spectator, and replacement owner. Cover
      initial rejection, spectator-initiated later start, ownership-independent bike
      controls, recovery, cancellation, and shared-keyboard play.
- [ ] Include a late spectator joining a registration-closed room, owner-only
      rejoin, private-room credential preservation through lobby refresh, and a
      restart after committed first launch with zero completed scores.
- [ ] Retain binary, bike-ownership, leak, and browser coverage. Required new browser
      checks fail when Chromium is missing, preserve diagnostics, and join CI lint.
- [ ] Audit the matrix, update CHANGELOG under Unreleased, close only the five
      proven roadmap items under the clarified client policy, and update architecture.
- [ ] Obtain final independent testing/review and exact-head push/PR CI; deliver
      the feature PR for user review with migration notes and remaining limitations.

Dependencies: Phase 3. Exit: every acceptance row has actual evidence and required
CI passes. General membership/reaping, scoring, network limits and launch work stay
open.

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

Use matching current client/server builds with one shared protocol version. Advance
that version when changing the wire contract and retain strict mismatch rejection
with reload guidance; accept no historical wire format or parallel version. Bike
credentials follow their existing room/roster rules. New creator credentials are
stored independently and never derived from a player ID/token.

Add private creator metadata and the durable first-launch marker to version-1
snapshots. Older records have no reliable creator identity: completed-round
history can establish later-start eligibility, but it cannot authorize speed or
identify an owner. An unstarted legacy room without creator proof needs a new
room; do not grant the initial start to whoever first reconnects/registers.
Explain lost-creator-credential recovery limits. Future/malformed snapshots retain
protection, and restart never resumes pending timers or physics. Malformed or
contradictory launch metadata uses existing snapshot-wide read-only protection;
recover a valid snapshot manually rather than overwrite the protected file.

Back up `games.json` before upgrade. Rollback requires matching prior server/client
code; old code ignores creator metadata and restores its old any-bike-owner control
policy. Restore the backup for an exact data rollback, accepting changes lost
since it. Preserve existing atomic-rename durability limits; fsync/new persistence
backends are outside scope. No merge, release, or deployment is authorized by
planning approval.

## Approval gate

The user approved revision `302a9859b77ecca890254b24a3ca381c9e66ac49` and its
autonomous implementation/commit/push/CI policy on 2026-10-11: “very well :)
you can go on orchestrating the implementation :)”. The immutable revision,
approval source, task records, and verification evidence are recorded in
[execution progress](2026-10-11-registration-invariants-and-round-authority-progress.md).
Material scope changes require renewed review; merge, release, and deployment
remain outside this approval. Agent plan review is advisory.

### Advisory plan review

The initial draft at `098546debdf93682dc08abec9ae2a6f0e0339517` received read-only
Sol 6.1/xhigh task `round_authority_plan_review` and two follow-ups. The spawning
tool accepted the requested settings; actual model/effort and usage telemetry
were not independently exposed in that context. Observed UTC review windows were
06:45:54.532–06:48:18.342, 06:51:35.017–06:51:58.059, and
06:53:56.351–06:53:56.992 on 2026-10-11. Wall time is not compute time.

That review resolved attempt/admission, failed-fallback, client callback, phase
sequencing, and restored-host-grace issues for the earlier player-host proposal.
The user's later creator-client and subsequent-round clarifications supersede its
host identity/election policy. Its old review verdict is not evidence for the
revised ownership/permission contract.

The revised client-based draft received a new read-only review and a follow-up by
the same requested Sol 6.1/xhigh reviewer. Reported UTC windows on 2026-10-11 were
07:44:54.337–07:46:55.033 (2m 0.696s) and 07:48:53.916–07:49:06.767 (12.851s).
Actual model/effort and usage telemetry remained unavailable; wall time is not
compute time. No application tests or runtime changes were performed by the reviewer.

Four gaps were corrected: spectator admission when bike registration is closed,
private-room and owner-only credential retention, restored committed launch with
zero completed scores, and strict malformed/contradictory launch metadata policy.
The follow-up found all four resolved and no remaining substantive issue in the
reviewed fixes. This is advisory consistency evidence, not product approval or
proof that the planned feature is implemented/tested.

At `a881efcbd9a15c52cfce7bce05f945956705d637`, the lead interpreted the preceding
refinement as removing version fields/checks and mismatch/reload handling.
A read-only follow-up by the same requested reviewer reported
09:36:05.896–09:36:14.812 UTC on 2026-10-11 (8.916s), with no substantive issue in
the internal consistency of that draft. Actual model/effort and usage telemetry
were unavailable; no application tests or runtime changes were performed.

The user's subsequent clarification supersedes that interpretation: retain version
fields, exact-current-version checking, and reload guidance, while accepting only
one version and adding no backward-compatibility handlers. This revision corrects
the plan to that clarified intent and preserves the already implemented strict
version guard. Snapshot recovery remains a separate policy. The subsequent user
approval is recorded above and in the companion progress document.

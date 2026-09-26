# Player Ownership and Reconnection — Implementation Plan

> **Date:** 2026-09-25  
> **Target:** v1.5.0, Milestone 1, “Player ownership and reconnection”  
> **Status:** Planned; no implementation tasks completed  
> **Baseline:** main at `291299c8500ad7f30caf6d335e357d533888355f`

## Scope and completion rule

Implement all six items in the [roadmap section](../../ROADMAP.md#player-ownership-and-reconnection), preserving account-free play and multiple local players per browser connection. Each phase below is a separate reviewable implementation commit. Complete its tests and documentation, then stop for review before starting the next phase.

This plan includes the registration validation and private acknowledgement necessary to establish ownership safely. It does not complete the separate registration/round-authority section: host selection, host-only start/reset/speed changes, minimum eligible roster, and countdown cleanup remain there. Likewise, broader membership deduplication, capacity accounting, idle reaping, scoring, and traffic bounds remain separate work. Ownership-aware leave/switch/close cleanup is required here.

Creating this plan does not mark roadmap features complete or change the release version.

## Current implementation and gaps

| Area                                                                                                  | Current behavior at baseline                                                                                                                         | Required change                                                                                                               |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [WebSocket handler](../../server/wsHandler.js)                                                        | JOIN_GAME accepts arbitrary playerIds; ADD_PLAYER updates ws.playerIds before domain registration; JSON and binary steering bypass ownership checks. | Authenticate reconnect claims; grant only after successful registration; use one ownership predicate for both steering paths. |
| [Session](../../server/GameSession.js) and [arena](../../server/Arena.js)                             | Player mutation methods accept public IDs; no authoritative owner mapping exists.                                                                    | Keep room-scoped ownership state and guard connection-originated mutations before reaching simulation methods.                |
| [Public game information](../../server/GameServer.js)                                                 | getGameInfo serializes Player instances directly.                                                                                                    | Use an explicit public projection; keep credential records outside Player and score objects.                                  |
| [Client coordinator](../../public/javascripts/main.js) and [state](../../public/javascripts/state.js) | Generate eight-character hexadecimal IDs, save local controls before acknowledgement, and restore ownership from stored IDs.                         | Separate saved reconnect credentials from currently acknowledged ownership and pending registration.                          |
| [Network client](../../public/javascripts/network.js)                                                 | Converts some IDs to numbers for a three-byte movement frame; server registration uses strings.                                                      | Define an explicit compact handle mapping; never coerce a public ID to a byte.                                                |
| [Storage](../../server/Storage.js) and session restoration                                            | Snapshots omit credentials and connected status; Player defaults connected to true.                                                                  | Version ownership persistence, preserve credential verifiers, and restore every player disconnected.                          |

The architecture guides describe intended behavior in places where implementation differs. Verify against code while updating [protocol](../architecture/protocol.md), [lifecycle](../architecture/lifecycle.md), and [testing](../architecture/testing.md).

## Proposed contract

These are implementation defaults for review, not claims about existing behavior.

### Identity, credentials, and ownership

- Keep public player IDs as canonical nonempty strings, unique within a room. Keep the existing client-generated ID format for compatibility, but reject invalid or duplicate IDs without truncating them into another identity.
- Issue an independent server-generated secret per successfully registered player using 32 random bytes encoded as base64url. A public ID is never proof of ownership.
- Store only a SHA-256 verifier on the server, scoped to the room and player. Validate encoding/length before comparing fixed-length digests with a timing-safe comparison.
- Keep an authoritative room-scoped map from player ID to owning socket, plus a socket-local set as an index. Treat the map as authoritative if they disagree.
- A connection may own zero through six players in its current room. Authorization is evaluated for the specific player on every input.
- Keep secrets and verifiers out of Player objects, scores, lobby data, public GAME_INFO, error messages, metrics labels, and logs. Use explicit serialization allowlists.
- Return the raw secret only in a private registration-success response to the registering socket. Reconnection results never echo it.
- Retain a credential until its player/room is destroyed. Ordinary disconnect, return to lobby, room switching, and server restart do not revoke it. Slot release/reassignment will invalidate credentials when implemented in Milestone 4.
- No automatic rotation during handover: this avoids losing access when an acknowledgement is lost. Possession of the secret remains the authority; this is not protection against stolen browser storage.

### Wire and client state

Extend [shared/protocol.js](../../shared/protocol.js) with documented response types and a protocol version. Proposed payloads:

| Message           | Proposed payload / semantics                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| ADD_PLAYER        | requestId plus player configuration; pending client controls confer no ownership.                            |
| PLAYER_REGISTERED | Private requestId, room key, public player ID, reconnectToken, and inputHandle after successful mutation.    |
| JOIN_GAME         | Room key plus reconnect entries containing id and reconnectToken; an empty list joins as spectator.          |
| JOIN_RESULT       | Private room key, accepted IDs/handles, and rejected IDs with generic reasons; never echo submitted secrets. |
| OWNERSHIP_REVOKED | Private list of IDs transferred away from this socket; remove only those local bindings.                     |
| ERROR             | Stable code and safe human-readable explanation, correlated to requestId where applicable.                   |

- Validate each reconnect entry independently. A mixed valid/invalid batch restores only valid players; invalid claims never modify another owner. Reject duplicate IDs within a request before processing that request.
- A bare legacy playerIds claim must never restore ownership. Unsupported clients receive an explicit reload/rejoin error; do not silently enable the insecure fallback.
- Use versioned sessionStorage records per room/player: public ID, secret, and local control configuration. Handle malformed JSON, old records, and unavailable storage without crashing.
- Maintain a separate in-memory set of acknowledged owners and input handles. Clear it on socket loss; enable input only after registration/reconnection acknowledgement.
- Public GAME_INFO cannot establish ownership. Correlate private responses with the current socket generation, room, and pending request so late responses cannot bind controls in another room.
- Cache a successful registration response for bounded, same-socket retries of the same requestId; never create duplicate players. Do not log that cache or persist raw secrets. If the socket dies before the first acknowledgement arrives, no ID-only recovery is allowed: explain recovery through a new registration where eligible or a new room.
- Losing sessionStorage means losing that device's ability to reclaim the player. Do not turn knowledge of an ID, name, or key binding into recovery authority.

### Binary movement

Use a server-assigned, connection-local Uint8 inputHandle mapped to the canonical player ID. The final frame remains three bytes: opcode, inputHandle, direction byte (0 left, 1 right).

- Return handles only for acknowledged owned players. Both binary and JSON input call the same authorization/validation helper.
- Use the WebSocket message callback's isBinary argument to distinguish text buffers from binary frames. Reject malformed lengths, unknown opcodes/handles, and invalid direction bytes.
- Do not reuse handles during a socket lifetime, including room switches and handovers. This prevents an old queued frame targeting a newly assigned player. After 256 allocations, use authorized JSON input until a fresh connection; never wrap.
- Invalidate mappings immediately when ownership is lost. Reconnection on a new socket receives new mappings.
- Negotiate/require the updated protocol before accepting these frames so stale clients cannot interpret a public ID byte as a handle.
- Preserve binary drawing deltas unchanged. Until this mapping lands, disable inbound binary movement and use authorized JSON rather than retaining a bypass.

### Handover and cleanup

For a valid reconnect, transfer ownership synchronously without an await between verification and map/index updates. The last successfully authenticated claim wins.

1. Verify room membership/admission and the credential without changing ownership.
2. Remove the player and its handle from the previous socket's indexes.
3. Assign the new owner and handle, then mark the player connected.
4. Notify the old owner and acknowledge the new one; broadcast only public state.

Do not disconnect the old socket wholesale: it may still own other local players. Old input, leave, close, or delayed cleanup can affect a player only if the authoritative map still names that socket. Repeated cleanup must be idempotent.

A real disconnect keeps current explosion/trail behavior. Reconnection does not revive a dead cycle mid-round; it becomes eligible on the next round. Handover while the old socket is still live must not itself kill the cycle. The replacement client may retain the existing scoresWaiting presentation until the next reset.

On a room switch, validate target admission first, then release only currently owned players in the old room and clear all old-room indexes. Broader room membership/capacity refactoring is separate; reconnect admission at a full room must return a clear error without partially transferring ownership.

### Persistence and migration

- Introduce a versioned snapshot format with room/player credential verifiers in a dedicated private section. Never persist raw secrets, sockets, handles, or active ownership.
- Preserve room metadata, rosters, and scores. Restore all players and score connection flags as disconnected, with an empty owner map. Only valid authentication makes them connected.
- Versioned credentials survive restart with the corresponding room. Preserve the existing boundary: no in-progress physics restoration.
- Load legacy snapshots without inventing credentials. Preserve their scores and roster as disconnected, unclaimable historical players; explain that a new room is needed to continue with those identities. Never allow first-claim takeover of old IDs.
- Missing/malformed credential records fail closed per player. Unknown future snapshot versions must not be silently rewritten as the current schema; preserve the original and report a safe diagnostic.
- Persist registration and verifier together before acknowledging durable recovery. Make Storage report failure; roll back failed registration/ownership and send a safe error rather than promise restart recovery that was not saved.
- Document backup and rollback: back up the snapshot before upgrade; rollback uses the matching old snapshot and client/server version, with explicit loss of post-upgrade progress.

## Implementation phases

### Phase 1 — Secure registration and JSON ownership end to end

- [ ] Add a focused server ownership component, owned by GameSession, for credentials, owner maps, and ownership checks.
- [ ] Make GameSession.addPlayer validate nonempty unique string IDs, allowed controls, registration state, and the six-player limit before any mutation. Return an explicit success/failure result.
- [ ] Grant ownership and issue a secret only after successful registration. Add private correlated acknowledgements and bounded same-socket retry handling.
- [ ] Update main.js, state.js, network.js, and configuration feedback so controls and confirmed ownership are committed only after acknowledgement.
- [ ] Replace unrestricted public serialization with an allowlist. Keep all credential state out of shared Player objects.
- [ ] Guard JSON CHANGE_DIR and its legacy alias with the same owner check; disable binary movement until Phase 3.
- [ ] Reject bare playerIds reconnection claims. Until Phase 2, reconnection fails closed with understandable feedback.
- [ ] Add protocol-version mismatch handling on both endpoints before changing message semantics.
- [ ] Normalize restored players to disconnected immediately; until Phase 4 persists verifiers, document that restart invalidates these interim credentials.
- [ ] Test spectator/victim steering, foreign IDs, empty/duplicate IDs, invalid controls, seventh-player rejection, failed registration, lost/duplicate acknowledgement, and multi-player local registration. Assert rejection leaves state unchanged.
- [ ] Update protocol/lifecycle documentation and applicable Unreleased notes; run phase checks below.

**Exit:** Only successful registration grants ownership; JSON steering and cleanup cannot affect another socket's players. Implement owner-checked leave/close now, even before handover is added.

### Phase 2 — Authenticated reconnection and atomic handover

- [ ] Implement per-player reconnect verification and JOIN_RESULT responses, with bounded/validated claim lists and mixed-success behavior.
- [ ] Restore saved credentials and bindings only for accepted IDs; display rejected/missing credentials without silently registering replacements.
- [ ] Implement handover, ownership-revoked notifications, and idempotent release for leave, switch, and close. Preserve other players still owned by either socket.
- [ ] Suspend bindings on transport loss and reject late responses from superseded sockets/rooms. A transferred-away client must not automatically reclaim in a loop.
- [ ] Test A-to-B handover followed by A steering/leaving/closing, unrelated C closing, two valid concurrent claimants, repeated joins, partial transfer of shared-keyboard players, and room switching with reused public IDs.
- [ ] Test disconnected mid-round rejoin versus live handover: no resurrection, duplicate explosion, or false disconnected scoreboard state.
- [ ] Update lifecycle/protocol documentation and Unreleased notes; run phase checks.

**Exit:** Only valid credentials restore individual ownership, and a superseded socket cannot revoke the replacement's players.

### Phase 3 — Authorized binary movement with explicit handles

- [ ] Add non-reused per-socket handle allocation and private ID/handle mappings; negotiate the updated frame contract.
- [ ] Replace Number(id) conversion in network.js with acknowledged handle lookup and authorized JSON fallback.
- [ ] Route decoded JSON and binary movement through one owner/room/direction validator.
- [ ] Test hexadecimal and numeric-looking string IDs, all local players, unknown handles, stale handles after transfer/switch, handle exhaustion, malformed frames, and legacy clients.
- [ ] Assert binary and JSON parity for accepted/rejected movement and preserve drawing-delta behavior.
- [ ] Correct the protocol guide's ID representation and its input-queue description to match actual Player.changeDir/dirStack behavior.
- [ ] Update Unreleased notes and run phase checks.

**Exit:** Binary movement reaches the same canonical string identity and authorization rule as JSON, without coercion or stale-handle reuse.

### Phase 4 — Durable credentials and restart recovery

- [ ] Implement the versioned snapshot, verifier serialization, explicit write results, and registration rollback on persistence failure.
- [ ] Restore disconnected players with no owners or handles, retaining only valid verifiers and saved scores.
- [ ] Implement/document legacy, malformed-record, unknown-version, missing-file, and rollback behavior.
- [ ] Test a cold restart with matching credentials, wrong credentials, absent credentials, legacy snapshots, malformed verifiers, and failed writes. Assert raw secrets never appear in snapshots.
- [ ] Test room destruction removes verifier state and a stale credential cannot authenticate into another room or newly created player.
- [ ] Extend persistence/disconnect tests and update lifecycle/protocol documentation and Unreleased notes; run phase checks.

**Exit:** Restart preserves authenticated recovery without restoring phantom connected players or accepting ID-only claims.

### Phase 5 — Integrated acceptance and roadmap closure

- [ ] Add real local WebSocket regressions covering registration through reconnect, movement, handover, leave, and restart; use a temporary DATA_DIR and deterministic teardown.
- [ ] Add a required Playwright ownership-flow test with two independent browser contexts plus a spectator. Cover two local players, reload/session restoration, rejection feedback, and absence of stale bindings.
- [ ] Inspect all outbound message types and captured logs for the test credentials/verifiers; only the intended private registration response may contain the raw secret.
- [ ] Verify stale cached clients get an actionable reload error; document coordinated client/server deployment and snapshot backup/rollback.
- [ ] Audit the six-item matrix below and update roadmap/history only for verified completed items. Cross-reference the shared registration acknowledgement work without marking unrelated host/round-authority work done.
- [ ] Update testing/lifecycle/protocol guides and Unreleased notes; run the full validation gate.

**Exit:** Every acceptance row passes, and remaining Milestone 1 sections are still clearly identified as open.

## Acceptance matrix

| Roadmap item                                                 | Required proof                                                                                                                    | Phases     |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Public IDs separate from secret credentials                  | Spectator can see public IDs but cannot recover ownership; public frames/logs contain no secret or verifier.                      | 1, 4, 5    |
| Ownership only after registration or authenticated reconnect | Failed registration/claims leave maps, roster, controls, and scores unchanged; ID-only claims fail.                               | 1, 2       |
| Every direction path authorized; binary identity aligned     | JSON, legacy alias, and binary target the same string ID and reject spectator, foreign, stale, and malformed input.               | 1, 3       |
| Multiple local players                                       | One socket registers/reconnects multiple players; independent credentials and bindings work; partial transfer preserves the rest. | 1, 2, 3, 5 |
| Safe reconnection handover                                   | Replacement retains control after old/unrelated socket input, leave, switch, and close; no false disconnect or extra explosion.   | 2, 5       |
| Credential lifetime and restart                              | Saved verifiers authenticate after restart; all restored players begin disconnected; legacy data never enables takeover.          | 4, 5       |

## Validation and review gate for every implementation phase

- Add meaningful tests alongside each phase under test/\*.test.js; the existing runner discovers suites automatically. Use real socket integration tests for authorization boundaries, not only mocks.
- Run affected suites first, then npm test before handoff. Report browser skips as unavailable coverage; the Phase 5 required browser test must fail or explicitly block completion if Chromium is unavailable.
- Run npx eslint on changed supported JavaScript and npx prettier --write on changed supported files; review the resulting diff and relative links.
- Retain existing disconnect, explosion, persistence, scoreboard, and spectator-speed regressions. Update fixtures to use confirmed registration rather than trusting claimed IDs.
- Keep fixtures isolated from real snapshots; close sockets/servers and destroy sessions/timers after each test.
- Record actual results, unresolved failures, and unavailable checks. Do not mark a phase complete based only on having written its code.
- Update the corresponding phase checkboxes and affected documentation, then write the phase-specific proposed commit message to tmpcommit.md as required by the repository workflow.
- Stop for review before the next implementation phase. None of these phases authorize unrelated host authority, scoring, or deployment work.

## Related plans

- [Disconnected client lifecycle](2026-08-22-disconnected-client-lifecycle.md)
- [Match-state persistence](2026-08-20-match-state-persistence.md)
- [Spectator permissions and speed synchronization](2026-08-24-spectator-permissions-and-speed-sync.md)
- [Server capacity limits](2026-08-23-server-concurrency-capacity-limits.md)

For ownership and credential semantics, this plan supersedes older ID-only reconnect assumptions once implemented. The other plans remain references for their own scope.

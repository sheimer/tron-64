# Bitcycles — Roadmap & Backlog

Bitcycles is a free, open-source multiplayer browser game inspired by classic Commodore 64 party games. The immediate goal is a dependable public hobby release: safe room controls, correct scoring, an easy first visit, and measured hosting capacity.

This roadmap separates work required before wider community promotion from later enhancements. Existing deployments and small-group playtests can continue while these milestones are addressed.

## Release sequence

| Target version | Milestone | Focus | Outcome |
| --- | --- | --- | --- |
| **v1.5.0** | 1. Server correctness & hardening | Ownership, registration, room lifecycle, scoring, resource controls | Reliable multiplayer behavior |
| **v1.6.0** | 2. Public launch preparation | CI, media notices, onboarding, mobile checks, operational playtest | **Ready for public launch** |
| **v1.7.0** | 3. Showcase & palette extensibility | Scripted feature demos, recording pipeline, theme registry, C64 refinement | Richer presentation and easier theming |
| **v1.8.0** | 4. Room features & matchmaking | Creation options, invitations, slot replacement, host continuity | More flexible multiplayer sessions |
| **v2.0.0** | 5. Retro Arcade Edition | Synthesized audio, practice bot, advanced mobile layout | Expanded arcade experience |

These are proposed release targets for the agreed scope, not fixed dates. Milestones may be delivered through smaller releases; document scope and version changes here as implementation progresses. For published versions, see [CHANGELOG.md](CHANGELOG.md).

### Versioning approach

- **v1.4.x:** focused fixes to the current release that can be delivered independently of a milestone. Ship urgent corrections when ready.
- **v1.5.0–v1.8.0:** successive minor-release targets for the milestones below. Use patch releases for subsequent fixes and prereleases such as `v1.6.0-rc.1` when a release candidate needs playtesting.
- **v1.6.0:** the proposed first release promoted broadly, after the public-launch checklist is complete. If checks remain open, keep it a release candidate rather than declaring launch readiness from the number alone.
- **v2.0.0:** a provisional target for the expanded Retro Arcade Edition. Audio, a bot, and layout improvements alone do not require a major version. Confirm this number against the final compatibility policy; use a further 1.x minor release if those additions remain compatible.

For this hosted game, document compatibility where it affects self-hosters: client/server protocol pairing, deployment configuration, and persisted room/score formats. Coordinate server and client upgrades, prevent stale cached clients from silently using an incompatible protocol, and provide migration or explicit recovery steps for saved data. If a release intentionally breaks an interface promised as stable, reassess its major version before publishing.

---

## Target v1.5.0 — Milestone 1: Server Correctness & Hardening

Complete this work before a larger influx of unfamiliar players. Keep account-free local multiplayer and cross-device play.

### Player ownership and reconnection

Implementation plan: [Player ownership and reconnection](docs/plans/2026-09-25-player-ownership-and-reconnection.md).

- [ ] Keep public player IDs separate from secret reconnection credentials. Never include credentials in lobby lists, shared game information, or logs.
- [ ] Grant connection ownership only after successful player registration or authenticated reconnection; reject arbitrary `playerIds` claims.
- [ ] Check ownership for every direction-change path, including JSON and binary messages. Align binary player identifiers with the actual server identity representation.
- [ ] Allow multiple local players on one connection, with authorization for each player individually.
- [ ] Define reconnection handover so an old or unrelated socket cannot disconnect a player owned by the replacement connection.
- [ ] Define credential lifetime and restart behavior alongside persisted room state; do not restore an ownerless player as connected automatically.

### Registration invariants and round authority

- [ ] Enforce nonempty unique IDs, valid control data, registration state, and the six-player maximum inside domain methods as well as message handlers.
- [ ] Validate the minimum eligible roster before a round starts and return understandable registration/start errors.
- [ ] Acknowledge registration success before the client commits local ownership and key bindings.
- [ ] Introduce server-verified room-host authority for round starts/resets and speed changes. A nonempty claimed player-ID set is insufficient.
- [ ] Allow speed changes only between rounds; reject unauthorized or mid-round changes.
- [ ] Define host disconnection/reconnection behavior so a room cannot be hijacked or left permanently unusable.
- [ ] Make pending start/countdown cleanup explicit on reset, room destruction, and membership changes.

### Accurate room membership and cleanup

- [ ] Make joins idempotent with one membership record per socket, using a Set or equivalent deduplicated structure.
- [ ] Explicitly remove membership on leave, room switch, close, and dead-peer termination; disconnect only players that the connection actually owns.
- [ ] Use the same membership source for capacity checks, broadcasts, and inactivity detection.
- [ ] Reap empty rooms even when former visitors remain connected to the lobby or another room.
- [ ] Stop room timers and release callbacks when a room is removed; preserve the intended player-reconnection policy separately from socket membership.

Reference plans: [Disconnected client lifecycle](docs/plans/2026-08-22-disconnected-client-lifecycle.md), [Capacity limits](docs/plans/2026-08-23-server-concurrency-capacity-limits.md), [Spectator permissions and speed sync](docs/plans/2026-08-24-spectator-permissions-and-speed-sync.md).

### Scoring and collision correctness

- [ ] Represent every kill event, including multiple victims of the same killer in one round; update aggregation and any affected stored-score format.
- [ ] Verify simultaneous collisions with two and three or more players, checking death counts, mutual credit, position rollback, and end-of-round results.
- [ ] Retain explosion cleanup and escape scoring behavior through resets, disconnects, and restarts.

### Metrics access and bounded network behavior

- [ ] Resolve client addresses through an explicit trusted-proxy boundary; do not authorize raw caller-supplied forwarding headers independently.
- [ ] Fail closed for missing address information and document whether a configured metrics token is mandatory or an alternative to an IP allowlist.
- [ ] Verify both application and deployed proxy restrictions for `/metrics`.
- [ ] Add protocol-appropriate payload limits, global connection limits, and rate limits for room creation and costly mutations. Preserve legitimate multi-player shared connections.
- [ ] Bound direction queues; define how excess input is rejected or coalesced.
- [ ] Detect dead peers with a server heartbeat and handle socket errors explicitly.
- [ ] Define a slow-client policy using outbound buffered bytes; disconnect or resynchronize rather than allowing indefinite accumulation of drawing deltas.
- [ ] Measure snapshot-write cost under repeated mutations; batch or debounce persistence if necessary without losing required state on shutdown.

### Acceptance criteria

- [ ] Local WebSocket regressions prove that spectators cannot steer, claim, disconnect, reset, or change speed for other players.
- [ ] Empty/duplicate IDs, over-capacity registration, and invalid round starts leave the room usable.
- [ ] Repeated joins, room switches, reconnection handover, and open-socket leaves maintain correct capacity and eventually permit idle cleanup.
- [ ] Multi-kill scoring credits every victim; collision and explosion regressions pass.
- [ ] Spoofed forwarding headers and invalid credentials cannot bypass the documented metrics policy.
- [ ] Excess input and slow/dead connections stay within configured bounds without disrupting normal local multiplayer.

---

## Target v1.6.0 — Milestone 2: Public Launch Preparation

Make the existing game easy to try and maintain. A complete demo engine, practice bot, or new theme architecture is not required for this milestone.

### Repeatable verification

- [ ] Add pull-request and push CI for the supported Node version, dependency installation, lint, formatting, server tests, and required browser tests.
- [ ] Report skipped suites separately from passing suites. Required browser checks must fail if the browser is unavailable; optional local skips must remain visible.
- [ ] Resolve formatting drift in a separate cleanup change so functional fixes remain reviewable.
- [ ] Exercise the complete create → register → start → score → leave/reconnect flow in browser tests, including two independent clients.
- [ ] Review runtime dependencies for known security issues and record resolutions or justified exceptions.
- [ ] Document supported browsers and their required CSS, canvas, and input capabilities.

Reference: [Testing architecture](docs/architecture/testing.md).

### Branding, assets, and notices

- [ ] Use Bitcycles consistently in public titles and descriptions; correct the welcome page's GitHub link and choose a canonical Play URL.
- [ ] Remove unnecessary legacy media from `public/images` and deployable output. Record provenance and permission for anything retained.
- [ ] Fill in the project copyright holder and retain applicable licenses/notices for copied palette material, icons, fonts, and other third-party assets.
- [ ] Ensure legal/privacy text matches actual hosting, logs, persistence, and browser storage. Describe implemented behavior without claiming independently verified legal compliance.
- [ ] Keep tribute credits and the non-affiliation disclaimer without treating either as permission to use third-party material.

### First-visit experience and contributor entry

- [ ] Put a short game description, prominent Play link, gameplay clip/image, and two-to-six-player requirements at the top of the README.
- [ ] Explain the fastest two-player-on-one-keyboard setup and how friends connect from separate devices.
- [ ] Provide a useful empty-lobby path: clear local-play instructions plus a short watchable preview or minimal demo. Start with a small capture; automate later.
- [ ] Put the main play action and controls ahead of extended engineering/history detail on the welcome screen.
- [ ] Add `CONTRIBUTING.md` with setup, checks, architecture entry points, and a small first-contribution path.
- [ ] Add `SECURITY.md` with a private reporting route, plus concise bug-report templates requesting browser/device and reproduction steps.

### Mobile usability and accessibility baseline

- [ ] Add device-width viewport metadata and check portrait/landscape layout on phones and tablets.
- [ ] Verify touch turning, accidental scrolling, browser zoom, and canvas scaling across common device pixel ratios.
- [ ] Check rendered text/control contrast, keyboard operation, focus visibility, and legal/privacy modal behavior.
- [ ] Assess player/trail distinguishability and provide usable non-color cues where needed; palette/background contrast alone does not establish distinguishability.
- [ ] Narrow accessibility claims to the checks actually performed. Document any remaining limitations.

Advanced landscape ergonomics remain in Milestone 5; basic mobile usability is part of launch readiness. Reference: [Mobile landscape plan](docs/plans/2026-08-17-mobile-landscape-layout.md).

### Operational playtest

- [ ] Run a small invited playtest covering shared keyboards, multiple devices, spectators, disconnects, room switching, and repeated rounds.
- [ ] Benchmark representative matches with spectators; record tick latency, event-loop lag, CPU, memory, bandwidth, and persistence overhead.
- [ ] Set room/socket/rate limits for the actual host with measured headroom. Treat defaults as guardrails rather than proof of capacity.
- [ ] Verify HTTPS/WSS, health monitoring, alert delivery, log retention, restart recovery, and a practical rollback procedure on the intended deployment.
- [ ] Review feedback and resolve remaining launch-blocking defects; record smaller issues in the backlog.

Reference plans: [Capacity](docs/plans/2026-08-23-server-concurrency-capacity-limits.md), [Memory verification](docs/plans/2026-08-24-memory-leak-profiling-and-verification.md), [Persistence](docs/plans/2026-08-20-match-state-persistence.md), [Telemetry](docs/plans/2026-08-29-telemetry-monitoring-and-alerting.md).

## Public Launch Marker — v1.6.0 Ready to Publish

> **This milestone is reached when Milestones 1 and 2 are complete, required CI checks pass on the release candidate, and the intended deployment passes the operational playtest.**
>
> This means ready for wider community promotion of a free hobby game within its documented capacity and limitations. It is not a guarantee of unlimited scalability or formal legal clearance.

- [ ] Confirm the release candidate has no unresolved high-priority ownership, registration, room-lifecycle, or metrics-access defects.
- [ ] Confirm newcomers can start a local game or understand the game through the empty-lobby path without assistance.
- [ ] Publish accurate release notes, supported-device information, and known limitations.
- [ ] Check current rules for a small selection of player, retro, and open-source communities; prepare tailored posts with transparent project ownership.
- [ ] Promote gradually and monitor capacity and feedback before expanding exposure.

**Everything below can follow public launch.** Theme refinements, automated capture, advanced matchmaking, audio, and autonomous practice are enhancements rather than prerequisites.

---

## Target v1.7.0 — Milestone 3: Showcase, Demo Engine & Palette Extensibility

### Feature demos and automated media recording

- [ ] Create reproducible scripted showcases for themes, killzone scoring, wall-breach escape, and explosions; seed randomness where deterministic capture is needed.
- [ ] Make demos accessible from the welcome screen and optionally deep links such as `#demo=escape`.
- [ ] Keep demo state separate from public matches and ensure entering/exiting demos releases timers and subscriptions.
- [ ] Add a Playwright recording command and optional ffmpeg conversion to compact GIF/MP4/WebM assets in `docs/media/`.
- [ ] Embed selected clips in README and feature documentation.

Plan: [Feature demos and media pipeline](docs/plans/2026-09-06-feature-demos-and-media-pipeline.md). Stable scoring and clean explosion/reset behavior are prerequisites. Capture can use existing palettes; it does not depend on enabling `c64-original` or completing the registry.

### Dynamic palette registry

- [ ] Centralize palette metadata in one manifest and generate the settings catalog, test discovery, and gallery metadata from it.
- [ ] Preserve palette-specific highlight/muted derivations and raw overrides for effects such as neon and monochrome CRT styling.
- [ ] Validate registered palette metadata and provide instructions for creating, checking, and contributing themes.

### C64 original hi-res refinement

- [ ] Keep the prototype `c64-original` palette disabled until its typography, hierarchy, and player visibility are usable.
- [ ] Introduce appropriately licensed bitmap/PETSCII-inspired typography for HUD, prompts, and scoreboards.
- [ ] Add distinctive player heads/direction markers so monochrome trails remain interpretable.
- [ ] Rebalance gray, black, and white UI boundaries; test the rendered result before enabling the palette.

The existing `c64` palette and disabled `c64-original` prototype are different entries. Do not describe the prototype as a completed capture prerequisite.

---

## Target v1.8.0 — Milestone 4: Room Features & Matchmaking

Build on the verified ownership, host authority, and membership model from Milestone 1.

- [ ] **Creation-time speed:** expose the initial speed in the lobby creation form; add a HUD indicator for non-normal speeds. Host-only, between-round changes are already required by Milestone 1.
- [ ] **Unlisted rooms and invitations:** expose `isPublic: false` in the UI, with join-by-ID and shareable room links. Backend visibility filtering already exists; document that unlisted is not access-controlled private play.
- [ ] **Roster locks:** let hosts restrict new registration and define whether spectators remain permitted.
- [ ] **Slot relinquishing:** distinguish temporarily disconnected players from explicitly released slots; invalidate old credentials on relinquish or reassignment.
- [ ] **Replacement players:** let newcomers acquire abandoned slots between rounds with a clear scoring policy. Defer active-round takeover until its gameplay and ownership semantics are explicitly defined.
- [ ] **Host transfer:** provide deliberate handover or a documented fallback when the host leaves permanently, using the same authorization model as room controls.

---

## Target v2.0.0 — Milestone 5: The Retro Arcade Edition

### Procedural Web Audio SFX

- [ ] Synthesize engine hum, turn blips, collision/explosion noise, and victory/game-over sounds without external audio downloads.
- [ ] Respect browser audio activation requirements and provide persistent mute/volume controls.
- [ ] Release audio resources when leaving a game or demo.

### Single-player practice bot

- [ ] Implement a lightweight wall-avoidance/open-space heuristic—for example, flood-fill reachable-area scoring—for practice when no opponents are available.
- [ ] Define whether practice runs locally/offline or in a server room before implementation; avoid implying offline support from a server-only bot.
- [ ] Keep bot behavior bounded and preserve the same movement/scoring rules as human players.

### Advanced mobile landscape ergonomics

- [ ] Refine height-driven 16:10 arena scaling and split thumb controls beside the canvas.
- [ ] Improve immediate pointer/touch response without creating duplicate events or unbounded client input queues.
- [ ] Audit scaling, zoom, orientation changes, and control placement across 1×, 2×, and 3× device pixel ratios.

Plan: [Mobile landscape layout](docs/plans/2026-08-17-mobile-landscape-layout.md).

---

## Implemented Foundation & Historical Milestones

These features exist or were recorded as completed in the previous roadmap. They describe the foundation, not blanket verification of security, deployment, accessibility, or every supported device. Open work above takes precedence where it strengthens or corrects an existing feature.

### Networking and client lifecycle

- Connection quality indicator with theme-adaptive latency feedback.
- Session-storage restoration of local player IDs/key bindings; secure ownership handover remains in Milestone 1.
- Disconnected-player explosion/trail handling and subsequent-round reset behavior.
- Binary drawing deltas and a movement-frame implementation; identity representation and authorization require verification.
- Speed synchronization, lobby loading/empty/reconnect feedback, and return-to-lobby navigation.

Reference: [Lobby loading state](docs/plans/2026-08-21-lobby-loading-state.md).

### Server simulation, storage, and tests

- Timestamp-based round scheduling with a lag recovery guard.
- Configurable room-count limits and per-room client limits; accurate membership and broader traffic bounds remain open.
- Atomic JSON snapshots for room metadata and score tallies. This is not restoration of in-progress physics state or proof of durability against every storage failure.
- Server GC/lifecycle tests, browser memory-test tooling, and concurrency benchmark tooling. Publish measured results with environment and workload; distinguish skipped browser tests from executed verification.
- Spectator UI restrictions and preliminary server checks; verified ownership and room-control authorization remain open.

### Welcome screen and project identity

- Welcome/About screen with C64 inspiration, gameplay descriptions, controls, project references, and Info/Lobby navigation.
- Bitcycles naming and existing responsive layout work; canonical links and real-device checks remain open.
- Legal-notice and privacy modals as a disclosure scaffold; their existence does not establish legal compliance.

Plan: [Welcome page and branding](docs/plans/2026-08-28-welcome-page-and-branding.md).

### Operations and monitoring

- Prometheus instrumentation for rooms, registered players, sockets, completed rounds, collisions, tick duration, and Node runtime metrics. Confirm names/help text accurately distinguish registered from connected players.
- Metrics allowlist/token implementation; trusted-address resolution and intended-deployment restrictions require Milestone 1 verification.
- Deployment/service tooling with resource limits.
- Prometheus/Grafana host monitoring and Postfix-backed alerting recorded in the prior roadmap; verify the intended deployment and alert delivery before wider launch.

### Themes and gameplay presentation

- Twelve selectable palettes: eight Zenbones-family schemes plus `c64`, `arcade-neon`, `amber-crt`, and `green-crt`.
- Live theme switching, browser preference persistence, and canvas/UI recoloring.
- Automated palette contrast checks, simulated color-vision checks, and visual gallery tooling; complete-interface accessibility remains a separate assessment.
- Sorted post-round scores, tie-breaking, and rank badges; multi-victim kill aggregation still needs correction.
- Explosion/reset/disconnection regression tests; retain them as further changes are made.

Plan: [Multi-palette schemes](docs/plans/2026-09-05-multi-palette-color-schemes.md).

## Maintaining This Roadmap

Mark an item complete only with a reference to its implementation and relevant verification. Keep detailed design in the linked plans and release history in CHANGELOG. Update plans when their assumptions differ from the final implementation; preserve this roadmap as the short source of priority and launch criteria.

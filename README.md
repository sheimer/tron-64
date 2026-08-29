# Bitcycles (Web Tribute)

> **Disclaimer:** This project is an independent open-source fan game and tribute to classic Commodore 64 party games. It is not affiliated with, sponsored by, or endorsed by The Walt Disney Company.

A multiplayer retro light-cycle arena game inspired by the legendary C64 party game **Ultimate Tron II** (created by Oliver Stiller / Masters' Design Group and published on *64'er* magazine cover disks).

Built from the ground up with pure modern web technologies — zero heavy UI frameworks, pure ES Modules, a deterministic 40 FPS target-timestamp physics loop, binary WebSocket streaming, and a responsive HTML5 canvas renderer.

---

## The Nostalgia: 6 Players on One Keyboard

Back in the Commodore 64 era, *Ultimate Tron II* was the undisputed king of local multiplayer house parties. Up to 6 players would crowd shoulder-to-shoulder around a single breadbin keyboard, frantically tapping keys (`Q/W`, `C/V`, `M/,`, arrow keys), screaming as light-cycles turned at pixel precision, trails trapped opponents, and screen-shaking particle explosions determined the ultimate champion.

**Bitcycles (Web Tribute)** preserves that raw, chaotic party energy — allowing multiple local players to share a single keyboard or join together over the internet via WebSockets across laptops, desktops, and mobile devices.

---

## Development Story: Building with AI (Gemini Flash)

This project has been a long-time passion endeavor worked on in tiny, sporadic steps over several years. Between job and family life, time and energy were naturally limited, making it tough to find enough focused hours to tackle complex tasks like real-time multiplayer networking, responsive canvas rendering, crash-safe state persistence, and automated leak verification.

Pair programming with AI assistance (specifically Google's Gemini Flash via Antigravity) completely transformed the development process. Having an intelligent assistant to brainstorm architectural decisions with, design binary streaming protocols, implement complex game loops, and construct comprehensive headless test suites allowed this project to leap forward rapidly. It has been an absolute joy to bridge childhood retro gaming nostalgia with modern AI-driven engineering, bringing the project to a level of polish and completeness that I am truly proud to present to the world.

---

## Historical & Algorithmic References

* Original C64 Inspiration: **Ultimate Tron II** by Oliver Stiller / Masters' Design Group (*64'er* Magazine, Markt & Technik) — [Lemon64 Entry](https://www.lemon64.com/game/ultimate-tron-2)
* Algorithm & Score Reference: [mist64/ultimatetron2](https://github.com/mist64/ultimatetron2)
* Fixed Timestep Game Loop Architecture: [Glenn Fiedler - Fix Your Timestep!](https://gafferongames.com/post/fix_your_timestep/)
* MDN Game Loop Engine: [MDN - Anatomy of a Video Game](https://developer.mozilla.org/en-US/docs/Games/Anatomy#building_a_main_loop_in_javascript)
* MDN Resolution & Zoom Scaling: [MDN - Window devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio#monitoring_screen_resolution_or_zoom_level_changes)

---

## Architecture Overview

```
tron/
├── shared/                     # Isomorphic modules (Node.js & Browser)
│   ├── constants.js            # Grid dimensions, speeds, colors, starting positions
│   ├── protocol.js             # Typed WebSocket action & event constants
│   ├── Player.js               # Pure Player model (direction stack, position, killzone)
│   └── utils.js                # Shared utilities (shuffle, random, ordinal formatting)
├── server/                     # Backend domain logic & match simulation
│   ├── Arena.js                # 2D collision grid, simultaneous crash resolution, explosions
│   ├── Explosion.js            # Particle explosion physics simulation
│   ├── GameSession.js          # Target-Timestamp game loop scheduler & score calculation
│   ├── GameServer.js           # In-memory registry of active game sessions
│   ├── Storage.js              # Crash-safe atomic JSON snapshot persistence
│   └── wsHandler.js            # Unified WebSocket server (/ws) with input sanitization
├── public/                     # Frontend client assets
│   ├── javascripts/
│   │   ├── main.js             # Main application orchestrator & input binding
│   │   ├── network.js          # Unified WebSocket client singleton & ping heartbeat
│   │   ├── state.js            # Central reactive client state store (pub/sub)
│   │   ├── Renderer.js         # Hybrid delta canvas renderer with DPR scaling
│   │   ├── settings.js         # User preferences & localStorage persistence
│   │   ├── theme.js            # Live computed CSS variable color reader & observer
│   │   └── ui/                 # Modular view controllers
│   │       ├── dropdown.js     # Dropdown menu controller
│   │       ├── settingsView.js # Theme, speed, and visibility toggles
│   │       ├── lobbyView.js    # Game list & creation form
│   │       ├── configView.js   # Player registration & key binding setup
│   │       └── gameView.js     # Scoreboard, arena display, & player position badges
│   └── stylesheets/            # Vanilla CSS design system
└── docs/plans/                 # Architecture roadmap & mobile layout plans
```

---

## Key Features

1. **Target-Timestamp Server Game Loop**: Tracks absolute target time (`nextTickTime`) to absorb both OS timer jitter and physics computation time without busy-polling.
2. **Unified WebSocket Protocol**: Single persistent connection handling lobby, room-scoped gameplay messaging, and in-band latency ping heartbeats.
3. **Input Sanitization**: Server-side clamping of grid size, frame intervals, player names, and movement directions.
4. **Hybrid Delta Canvas Renderer**: Local `Int8Array` grid buffer with delta cell painting ($O(k)$ per frame) and full redraws on theme or DPR changes.
5. **Simultaneous 2-in-1 Spot Collision**: Equal mutual kill credit and position rollback when two players enter the same cell in the same tick.

---

## Development

```bash
# 1. Install Node.js dependencies
npm install

# 2. (Optional) Setup Playwright browser binaries for automated client-side tests
npx playwright install chromium

# On Linux / WSL environments, install required OS system libraries if running browser tests:
# sudo npx playwright install-deps chromium

# 3. Start development server (default: port 3000)
npm start

# 4. Run automated test suites (server lifecycles, memory GC, Playwright browser leak tests)
npm test

# 5. Run headless concurrency benchmark (10, 25, 50 concurrent active games)
npm run benchmark

# 6. Run linter
npx eslint .
```

### Server Concurrency & Capacity Configuration
* **`MAX_ACTIVE_GAMES` (Default: `50`):** Maximum concurrent active game rooms allowed on the server. Configurable via environment variable:
  ```bash
  MAX_ACTIVE_GAMES=100 npm start
  ```
* **`MAX_CLIENTS_PER_ROOM` (Default: `32`):** Maximum connected clients (players + spectators) per game room.
* **Automatic Inactivity Reaper:** Rooms with zero connected clients automatically clean up and free server memory/slots after **5 minutes** of inactivity (`IDLE_ROOM_TIMEOUT_MS`).

---

## Deployment

Deployments to production servers use [`scripts/deploy.sh`](scripts/deploy.sh), which synchronizes files via rsync, preserves `/srv/tron/data/`, dynamically templates [`bitcycles.service`](bitcycles.service) or [`bitcycles-fnm.service`](bitcycles-fnm.service) depending on `DEPLOY_USE_FNM`, and triggers systemd reload:

```bash
# 1. Setup local environment configuration (optional):
cp .env.example .env
# Edit .env with DEPLOY_TARGET or multi-target profiles DEPLOY_TARGETS="primary,secondary"

# 2. Deploy to all configured targets (zero arguments loads all targets or default):
./scripts/deploy.sh

# Or deploy to a specific configured profile:
./scripts/deploy.sh primary
./scripts/deploy.sh secondary

# Or pass parameters on the fly:
./scripts/deploy.sh user@server /srv/tron 3000
```

### Server Sudoers Setup

To allow automated deployments to restart the service and update systemd unit files without interactive password prompts, create `/etc/sudoers.d/bitcycles-service` on the target server:

```text
<user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop bitcycles.service
<user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl start bitcycles.service
<user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl status bitcycles.service
<user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl enable bitcycles.service
<user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl daemon-reload
<user> ALL=(ALL) NOPASSWD: /usr/bin/cp <path>/build/bitcycles.service.resolved /etc/systemd/system/bitcycles.service
<user> ALL=(ALL) NOPASSWD: /bin/cp <path>/build/bitcycles.service.resolved /etc/systemd/system/bitcycles.service
```

---

## Roadmap & Changelog

* **Roadmap & Planned Features:** See [ROADMAP.md](ROADMAP.md) for the active milestone backlog (Game Room Lifecycles, Audio SFX, Single-player Bot, Mobile Layouts).
* **Release History:** See [CHANGELOG.md](CHANGELOG.md) for detailed version release notes.

---

## License

This project is licensed under the terms of the [MIT License](LICENSE).

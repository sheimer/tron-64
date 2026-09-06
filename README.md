# Bitcycles (Web Tribute)

> **Disclaimer:** This project is an independent open-source fan game and tribute to classic Commodore 64 party games. It is not affiliated with, sponsored by, or endorsed by The Walt Disney Company.

A multiplayer retro light-cycle arena game inspired by the classic Commodore 64 game **Ultimate Tron II** (created by Oliver Stiller / Masters' Design Group and published on *64'er* magazine cover disks).

Built with standard web technologies — vanilla ES Modules, a deterministic 40 FPS target-timestamp physics loop, binary WebSocket streaming, and a responsive HTML5 canvas delta renderer.

---

## Background: 6 Players on One Keyboard

On the Commodore 64, *Ultimate Tron II* stood out by supporting up to 6 simultaneous players sharing a single keyboard (`Q/W`, `C/V`, `M/,`, arrow keys, etc.), creating fast-paced local multiplayer matches where light-cycles navigated tight grid corridors and left solid obstacle trails.

**Bitcycles** brings that same multiplayer mechanic to modern web browsers — supporting multiple players on a shared local keyboard as well as cross-device multiplayer over WebSockets across desktops, laptops, and mobile devices.

---

## Development & Engineering Methodology

This project originated as an independent side project developed sporadically over several years. Recently, modern AI pair-programming tools (specifically Google's Gemini models via Antigravity) were introduced to accelerate development and modernize the architecture while balancing limited time outside of work and family commitments.

AI assistance was leveraged across several key engineering areas:
* **Protocol & Loop Design:** Architecting the deterministic target-timestamp physics loop and compact binary WebSocket frame format.
* **Canvas Optimization:** Structuring the $O(k)$ hybrid delta renderer and `Int8Array` spatial grid buffer.
* **Testing & Verification:** Implementing comprehensive test suites, including multi-cycle heap leak verifications (`node --expose-gc`), headless concurrency benchmarks, and Playwright browser tests.

This approach enabled rapid architectural iteration, rigorous automated testing, and clean modular separation across both client and server subsystems.

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
6. **Multi-Palette Theming & Accessibility**: 12 hot-swappable color schemes (Zenbones Neovim family, Commodore 64 VIC-II tribute, synthwave arcade, and monochrome phosphor CRTs) with `light-dark()` CSS resolution, live canvas recoloring without page reload, and automated WCAG 2.1 AA / CVD accessibility verification.

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

# 4. Run automated test suites (server lifecycles, memory GC, palette accessibility, Playwright browser leak tests)
npm test

# 5. Generate visual palette comparison gallery (generates test/reports/palette-gallery.html)
npm run test:palettes

# 6. Run headless concurrency benchmark (10, 25, 50 concurrent active games)
npm run benchmark

# 7. Run linter
npx eslint .

# 8. (Optional) Configure Git hooks (auto-fills Fugitive 'cc' commits from tmpcommit.md)
./scripts/setup-git-hooks.sh
```

### Developer Git Hooks (Optional)

To streamline the commit workflow in Neovim Fugitive (`cc` in `:G`) or standard CLI `git commit`, run:
```bash
./scripts/setup-git-hooks.sh
# Or via npm:
npm run setup:hooks
```
This configures `core.hooksPath` to point to version-controlled hooks in [`.githooks/`](.githooks):
* **`prepare-commit-msg`**: Automatically pre-populates the commit message editor buffer with the contents of `tmpcommit.md` when present and non-empty (for standard new commits).
* **`post-commit`**: Resets `tmpcommit.md` after a successful commit to prevent stale messages from carrying over into subsequent manual commits.
* **Deactivation**: To disable hooks at any time, run `git config --unset core.hooksPath`.


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

## Acknowledgments & Credits

* **Ultimate Tron II:** Gameplay rules, 6-player local keyboard ergonomics, and nostalgic inspiration by Oliver Stiller / Masters' Design Group (1989, *64'er* Magazine).
* **Zenbones Color Schemes:** Palette values and design aesthetics adapted from [`zenbones.nvim`](https://github.com/mcchrish/zenbones.nvim) created by [Michael Chris Lopez (mcchrish)](https://github.com/mcchrish), licensed under the [MIT License](https://github.com/mcchrish/zenbones.nvim/blob/main/LICENSE). Includes derivative adaptations of [Tokyo Night](https://github.com/folke/tokyonight.nvim) (Folke Lemaitre), [Nord](https://www.nordtheme.com/) (Arctic Ice Studio), [Rosé Pine](https://rosepinetheme.com/), and [Gruvbox](https://github.com/morhetz/gruvbox).
* **Commodore 64 Palette:** Authentic 16-color VIC-II hardware palette based on vintage C64 video signal standards.

---

## License

This project is licensed under the terms of the [MIT License](LICENSE).

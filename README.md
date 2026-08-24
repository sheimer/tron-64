# Retro Multiplayer Tron Game

A multiplayer retro Tron light-cycle game built with Node.js, Express, HTML5 Canvas, and WebSockets.

---

## Historical & Algorithmic References

* Some infos taken from: [mist64/ultimatetron2](https://github.com/mist64/ultimatetron2)
* Score calculation from: [mist64/ultimatetron2/basic.bas](https://github.com/mist64/ultimatetron2/blob/master/basic.bas)
* Fixed timestep game loop reference: [Glenn Fiedler - Fix Your Timestep!](https://gafferongames.com/post/fix_your_timestep/)
* MDN Game Loop Architecture: [MDN - Anatomy of a Video Game](https://developer.mozilla.org/en-US/docs/Games/Anatomy#building_a_main_loop_in_javascript)
* MDN Resolution & Zoom Listener: [MDN - Window devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio#monitoring_screen_resolution_or_zoom_level_changes)

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
# Install dependencies
npm install

# Start server (default: port 3000)
npm start

# Run automated tests (lifecycle, persistence, concurrency)
npm test

# Run headless concurrency benchmark (10, 25, 50 concurrent active games)
npm run benchmark

# Run linter
npx eslint .
```

### Server Concurrency & Capacity Configuration
* **`MAX_ACTIVE_GAMES` (Default: `50`):** Maximum concurrent active game rooms allowed on the server. Configurable via environment variable:
  ```bash
  MAX_ACTIVE_GAMES=100 npm start
  ```
* **`MAX_CLIENTS_PER_ROOM` (Default: `32`):** Maximum connected clients (players + spectators) per game room.
* **Automatic Inactivity Reaper:** Rooms with zero connected clients automatically clean up and free server memory/slots after **5 minutes** of inactivity (`IDLE_ROOM_TIMEOUT_MS`).

### Testing Disconnected Clients & Multi-Tab Behavior
1. Open a regular browser window at `http://localhost:3000` and create a game (e.g. Player "Alice").
2. Open a second window (e.g. Private / Incognito window or a second browser) and join the game as Player "Bob".
3. Start the match. Both clients drive their cycles across the arena grid in real time.
4. **Mid-Round Disconnect:** Close Bob's browser tab while driving:
   * **Alice's Screen:** Bob's cycle instantly explodes into particle sparks at his last coordinates, and his trail remains on the grid as an obstacle. Alice continues steering until the round naturally finishes.
   * **Bob's Reconnection:** When Bob re-opens the URL, he automatically rejoins the game room. If a round is actively running, Bob sees the scoreboard with *"waiting for current round to finish"*, and on the next round reset, Bob is automatically placed back on the grid ready to race.

---

## Deployment

Deployments to production servers use [`scripts/deploy.sh`](scripts/deploy.sh), which synchronizes files via rsync, preserves `/srv/tron/data/`, dynamically templates [`tron.service`](tron.service), and triggers systemd reload:

```bash
# 1. Setup local environment configuration (optional):
cp .env.example .env
# Edit .env with your DEPLOY_TARGET (e.g. user@your-server.com)

# 2. Deploy with zero arguments (loads .env):
./scripts/deploy.sh

# Or pass parameters on the fly:
./scripts/deploy.sh user@server /srv/tron 3042
```

### Server Sudoers Setup

To allow automated deployments to restart the service and update systemd unit files without interactive password prompts, create `/etc/sudoers.d/tron-service` on the target server:

```text
<user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop tron.service
<user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl start tron.service
<user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl status tron.service
<user> ALL=(ALL) NOPASSWD: /usr/bin/systemctl daemon-reload
<user> ALL=(ALL) NOPASSWD: /usr/bin/cp <path>/build/tron.service.resolved /etc/systemd/system/tron.service
<user> ALL=(ALL) NOPASSWD: /bin/cp <path>/build/tron.service.resolved /etc/systemd/system/tron.service
```

---

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the prioritized backlog across Network Resilience, Server Lifecycle, Gameplay Polish, and Mobile Layout.

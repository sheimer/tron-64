# Canvas Rendering & Theming Architecture

> **Audience:** Reference for AI agents and maintainers working on canvas rendering, DPR scaling, responsive UI, or CSS color palettes.

---

## 1. Hybrid Delta Canvas Renderer (`Renderer.js`)

Instead of clearing and redrawing the entire $320 \times 200$ canvas on every tick ($O(W \times H)$), the client uses an optimized hybrid approach:

### Ground-Truth Grid Buffer
* The renderer maintains an in-memory `Int8Array` 2D buffer (`this.fields[x][y]`) representing the full state of every cell (`EMPTY`, `BORDER`, `EXPLOSION`, or `PLAYER_0..5`).

### Delta Frame Painting ($O(k)$ per frame)
* When binary draw packets arrive via WebSocket, the renderer paints *only* the modified cells (`drawField(x, y, value)`) to the canvas 2D context.
* This keeps frame computation minimal ($<0.5\text{ms}$) on mobile and low-power devices.

### Full Canvas Redraws & Visibility Lifecycle
* Full canvas repaints (`redrawAll()`) occur automatically during:
  1. **Match Start Synchronization:** On `GAME_RESET`, the UI switches to `'game'` screen, dismisses scoreboard overlays (`setMatchState('start')`), and schedules `resetGrid()` on a 50ms paint tick. This ensures the canvas reflows and activates its GPU compositor surface before drawing borders and acknowledging `ARENA_READY`.
  2. **Layout & Grid Reflows (`ResizeObserver`):** When container dimensions change or CSS Grid shifts layout areas, `ResizeObserver` recalculates dimensions and repaints the buffer.
  3. **Display Density / DPR Changes:** Media query resolution changes (`(resolution: ${dpr}dppx)`).
  4. **Theme / Palette Changes:** Instant live CSS color resolution.

---

## 2. Dynamic DPR & Zoom Monitoring

* Displays with high pixel densities (Retina, 4K, zoomed mobile viewports) require canvas dimension scaling to prevent blurry pixelation.
* `Renderer.js` attaches a media query listener via `window.matchMedia('(resolution: ${devicePixelRatio}dppx)')`.
* When the user zooms or moves the window across displays with different scaling factors, the canvas dimensions and block sizes recalculate dynamically, followed by a full buffer repaint.

---

## 3. Multi-Palette Theming Architecture & Live CSS Resolution (`theme.js`, `palettes.css`)

* **Modes & Palettes:**
  - Color scheme modes: `dark`, `light`, and `auto` (respects `prefers-color-scheme`).
  - Hot-swappable color palettes via `[data-palette="..."]` attribute selectors on `<html>`, defaulting to `forestbones`.
  - Curated 12-palette catalog:
    - **Zenbones Neovim Family:** `forestbones`, `zenbones`, `zenburned`, `tokyobones`, `rosebones`, `nordbones`, `duckbones`, `seoulbones`.
    - **Retro & Display Aesthetics:** `c64` (Commodore 64 VIC-II tribute), `arcade-neon` (synthwave neon), `amber-crt` (stepped luminance amber phosphor), `green-crt` (P1 monochrome green phosphor).
* **Token Contract:**
  - Each palette defines the 13 semantic tokens in both light and dark variants using `light-dark(lightVal, darkVal)`:
    - UI Backgrounds: `--color-bg`, `--color-bg-hl`, `--color-bg-muted`
    - UI Foregrounds / Borders: `--color-fg`, `--color-fg-hl`, `--color-fg-muted`
    - Explosions & Highlight: `--color-rose`
    - 6 Light-Cycle Player Trails: `--color-water`, `--color-wood`, `--color-leaf`, `--color-blossom`, `--color-sky`, `--color-rock`
  - Highlight (`-hl`) and muted (`-muted`) variants for player/accent colors are generated automatically via relative CSS color syntax (`hsl(from var(...) ...)`).
* **Live CSS Resolution (`getThemeColors()`):**  
  Reads computed colors directly from documentElement CSS custom properties and resolves `light-dark()` expressions dynamically without hardcoded hex constants in JS.
* **Canvas Hot-Swapping:**
  Changing palette or theme notifies `Renderer.setColors(...)`, which immediately triggers `redrawAll()` to recolor all trails, borders, and particles on the existing grid buffer with zero page reload.
* **Player Monochrome Toggle:**
  `settings.coloredPlayers` toggles between vibrant palette player colors and monochrome styling (`--color-fg`).

---

## 4. Dual Layout Modes & Legal Modals (`layout.css`, `components.css`)

### Welcome Screen Layout (`#layout.screen-welcome`)
* **Natural Page Scrolling:** Allows the long-form tribute, gameplay controls, and tech overview to scroll smoothly using native browser scrolling (`min-height: var(--inner-height)`).
* **Sticky Header:** Keeps `#head` and `#controls` pinned to `top: 0` with `position: sticky` and background fill, ensuring theme toggles and "Enter Lobby →" remain instantly accessible.
* **CSS Grid Area Discipline:** Explicitly defines 2-column `grid-template-areas` (`"head ctrl" "main main" "footer footer" "stat pltt"`) while hiding `#footer` via `#layout.screen-welcome #footer { display: none; }` to prevent implicit grid column generation.

### Arena & Match Layout
* **Fixed Viewport CSS Grid:** Renders fixed-dimension arenas with responsive multiplicator scaling (`--multiplicator`), DPR alignment, and zero artificial scrollbars across desktop and mobile.

### Accessible Modals & Email Anti-Scraping
* **Legal Dialogs:** Impressum (§ 5 DDG) and Privacy (GDPR/DSGVO) render as centered modal overlays with backdrop click and `Escape` key dismissal.
* **Email Protection:** Uses obfuscated data attributes (`<span class="mail-link" data-user="..." data-domain="..."></span>`) hydrated into `mailto:` links on client load to thwart automated scrapers.

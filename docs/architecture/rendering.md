# Canvas Rendering & Theming Architecture

> **Audience:** Reference for AI agents and maintainers working on canvas rendering, DPR scaling, responsive UI, CSS color palettes, or Pug and JavaScript DOM construction.

---

## 1. Hybrid Delta Canvas Renderer (`Renderer.js`)

Instead of clearing and redrawing the entire $320 \times 200$ canvas on every tick ($O(W \times H)$), the client uses an optimized hybrid approach:

### Ground-Truth Grid Buffer

- The renderer maintains an in-memory `Int8Array` 2D buffer (`this.fields[x][y]`) representing the full state of every cell (`EMPTY`, `BORDER`, `EXPLOSION`, or `PLAYER_0..5`).

### Delta Frame Painting ($O(k)$ per frame)

- Only binary `DRAW` packets reach the renderer. Valid packets begin with opcode `0x01` and contain complete five-byte records (`Uint16 x`, `Uint16 y`, `Int8 cellValue`); JSON `GAME_DRAW` type/action envelopes and array deltas are ignored.
- The network routes binary DRAW opcodes to its internal `GAME_DRAW` event. `Renderer.draw(DataView)` owns validation and checks the opcode, full record lengths, coordinates, and cell values across the entire packet before painting any modified cells. Its internal `drawCell(x, y, value)` trusts those validated records. Malformed packets leave both the grid and canvas unchanged.
- Rendering cost scales with the packet’s changed-cell count. Measure it with the ownership performance benchmark described in [testing](testing.md); no fixed timing is guaranteed across devices.

### Full Canvas Redraws & Visibility Lifecycle

- `GAME_INFO` carries public roster and score state in JSON. Binary deltas update the local grid; `GAME_RESET` and `Renderer.resetGrid()` resynchronize the grid. Local theme, resize, and DPR changes repaint the existing buffer without accepting a JSON drawing delta.
- Full canvas repaints (`redrawAll()`) occur automatically during:
  1. **Match Start Synchronization:** On `GAME_RESET`, the UI switches to `'game'` screen, dismisses scoreboard overlays (`setMatchState('start')`), and schedules `resetGrid()` on a 50ms paint tick. This ensures the canvas reflows and activates its GPU compositor surface before drawing borders and acknowledging `ARENA_READY`.
  2. **Layout & Grid Reflows (`ResizeObserver`):** When container dimensions change or CSS Grid shifts layout areas, `ResizeObserver` recalculates dimensions and repaints the buffer.
  3. **Display Density / DPR Changes:** Media query resolution changes (`(resolution: ${dpr}dppx)`).
  4. **Theme / Palette Changes:** Instant live CSS color resolution.

---

## 2. Dynamic DPR & Zoom Monitoring

- Displays with high pixel densities (Retina, 4K, zoomed mobile viewports) require canvas dimension scaling to prevent blurry pixelation.
- `Renderer.js` attaches a media query listener via `window.matchMedia('(resolution: ${devicePixelRatio}dppx)')`.
- When the user zooms or moves the window across displays with different scaling factors, the canvas dimensions and block sizes recalculate dynamically, followed by a full buffer repaint.

---

## 3. Multi-Palette Theming Architecture & Live CSS Resolution (`theme.js`, `palettes.css`)

- **Modes & Palettes:**
  - Color scheme modes: `dark`, `light`, and `auto` (respects `prefers-color-scheme`).
  - Hot-swappable color palettes via `[data-palette="..."]` attribute selectors on `<html>`, defaulting to `forestbones`.
  - Curated 12 active palettes (+ 1 disabled prototype):
    - **Zenbones Neovim Family:** `forestbones`, `zenbones`, `zenburned`, `tokyobones`, `rosebones`, `nordbones`, `duckbones`, `seoulbones`.
    - **Retro & Display Aesthetics:** `c64` (Commodore 64 VIC-II tribute), `arcade-neon` (synthwave neon), `amber-crt` (stepped luminance amber phosphor), `green-crt` (P1 monochrome green phosphor).
    - **Experimental / Disabled:** `c64-original` (1-bit hi-res medium gray/black homage, disabled in UI pending custom bitmap typography, cycle head markers, and inverted white UI hierarchy).
- **Token Contract:**
  - Each palette defines the 13 semantic tokens in both light and dark variants using `light-dark(lightVal, darkVal)`:
    - UI Backgrounds: `--color-bg`, `--color-bg-hl`, `--color-bg-muted`
    - UI Foregrounds / Borders: `--color-fg`, `--color-fg-hl`, `--color-fg-muted`
    - Explosions & Highlight: `--color-rose`
    - 6 Light-Cycle Player Trails: `--color-water`, `--color-wood`, `--color-leaf`, `--color-blossom`, `--color-sky`, `--color-rock`
  - Highlight (`-hl`) and muted (`-muted`) variants for player/accent colors are generated automatically via relative CSS color syntax (`hsl(from var(...) ...)`).

### Color Science of Relative Color Derivations (`-hl` and `-muted`)

- **Perceptual Non-Uniformity Compensation in HSL:**
  - Standard HSL models saturation and lightness as simple cylinders, but human spectral sensitivity peaks strongly in green/yellow wavelengths (~555nm). In HSL, a 50% lightness yellow has a relative luminance of ~0.90, whereas 50% lightness blue has a relative luminance of ~0.07.
  - To prevent contrast washouts and luminance collapse, the `:root` relative color rules define distinct, hand-calibrated multipliers per semantic hue (e.g., `leaf-muted` scales lightness by $1.8\times$ with saturation at $0.4\times$, whereas `water-hl` scales lightness by $1.3\times$ and dark lightness down to $0.7\times$).
- **Universal Inheritance vs Scoped Palette Overrides:**
  - `:root` establishes the universal baseline so palettes only need to declare their 13 primary semantic tokens.
  - Specialized display aesthetics selectively override `--color-*-hl` and `--color-*-muted` inside their scoped `[data-palette="..."]` selector:
    - **`arcade-neon`:** Replaces the standard saturation clamp with high-radiance electric bloom for highlights ($L \times 1.25$ in dark mode) and glowing wireframe phosphors for muted elements ($S \times 0.75, L \times 0.5$).
    - **`amber-crt`, `green-crt` & `c64-original`:** Locks hue and saturation strictly to the physical phosphor emission wavelengths (585nm amber / 525nm green) or 1-bit hi-res monochrome channels while driving pure radiometric luminance steps (beam overdrive for `-hl`, afterglow decay for `-muted`).
    - **`rosebones`:** Preserves soft pastel and dusty cedar personality by retaining higher saturation ($S \times 0.7$) rather than collapsing into neutral gray.
- **Live CSS Resolution (`getThemeColors()`):**
  Reads computed colors directly from documentElement CSS custom properties and resolves `light-dark()` expressions dynamically without hardcoded hex constants in JS.
- **Canvas Hot-Swapping:**
  Changing palette or theme notifies `Renderer.setColors(...)`, which immediately triggers `redrawAll()` to recolor all trails, borders, and particles on the existing grid buffer with zero page reload.
- **Player Monochrome Toggle:**
  `settings.coloredPlayers` toggles between vibrant palette player colors and monochrome styling (`--color-fg`).

---

## 4. Dual Layout Modes & Legal Modals (`layout.css`, `components.css`)

### Welcome Screen Layout (`#layout.screen-welcome`)

- **Natural Page Scrolling:** Allows the long-form tribute, gameplay controls, and tech overview to scroll smoothly using native browser scrolling (`min-height: var(--inner-height)`).
- **Sticky Header:** Keeps `#head` and `#controls` pinned to `top: 0` with `position: sticky` and background fill, ensuring theme toggles and "Enter Lobby →" remain instantly accessible.
- **CSS Grid Area Discipline:** Explicitly defines 2-column `grid-template-areas` (`"head ctrl" "main main" "footer footer" "stat pltt"`) while hiding `#footer` via `#layout.screen-welcome #footer { display: none; }` to prevent implicit grid column generation.

### Arena & Match Layout

- **Fixed Viewport CSS Grid:** Renders fixed-dimension arenas with responsive multiplicator scaling (`--multiplicator`), DPR alignment, and zero artificial scrollbars across desktop and mobile.

### Accessible Modals & Email Anti-Scraping

- **Legal Dialogs:** Impressum (§ 5 DDG) and Privacy (GDPR/DSGVO) render as centered modal overlays with backdrop click and `Escape` key dismissal.
- **Email Protection:** Uses obfuscated data attributes (`<span class="mail-link" data-user="..." data-domain="..."></span>`) hydrated into `mailto:` links on client load to thwart automated scrapers.

---

## 5. UI Markup: Pug Templates and JavaScript

Define permanent UI structure in Pug. Create elements in JavaScript when their
number or structure depends on runtime data, or when they deliberately require
client-side construction. Changing text, visibility, classes, or enabled state
alone does not justify creating the element in JavaScript.

The templates own stable containers, forms, controls, and feedback regions. View
controllers retrieve those elements by ID and update their content or state.
For example, `#registration-feedback` in [index.pug](../../views/index.pug) is
always the same status region below the add-player controls;
[ConfigView](../../public/javascripts/ui/configView.js) only updates its text.
Keep its `role='status'` in the template, just as `#connection-feedback` and
`#lobby-error` declare their structure there.

JavaScript creates the changing children of those stable containers:

- [LobbyView](../../public/javascripts/ui/lobbyView.js) builds room rows and their
  join buttons from the current room list. Its loading, empty, and connection
  status rows replace that same table content according to runtime state.
- [ConfigView](../../public/javascripts/ui/configView.js) and
  [GameView](../../public/javascripts/ui/gameView.js) build player and scoreboard
  rows from the current roster and scores.
- GameView builds round messages with optional colored player-name spans because
  both the message count and their internal structure depend on round results.
- [WelcomeView](../../public/javascripts/ui/welcomeView.js) deliberately assembles
  email links in the browser from obfuscated template attributes, as described
  above.

Use `textContent` or text nodes for player names, room names, and other runtime
text so it is displayed as text rather than interpreted as HTML. Keep repeated
rows inside their existing template containers; do not append another permanent
feedback region each time a view is constructed or shown.

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

### Full Canvas Redraws
* Full canvas repaints (`redrawAll()`) occur only during:
  1. Window resize or display orientation changes.
  2. Device Pixel Ratio (DPR) or browser zoom changes.
  3. Color theme or palette switches.

---

## 2. Dynamic DPR & Zoom Monitoring

* Displays with high pixel densities (Retina, 4K, zoomed mobile viewports) require canvas dimension scaling to prevent blurry pixelation.
* `Renderer.js` attaches a media query listener via `window.matchMedia('(resolution: ${devicePixelRatio}dppx)')`.
* When the user zooms or moves the window across displays with different scaling factors, the canvas dimensions and block sizes recalculate dynamically, followed by a full buffer repaint.

---

## 3. Theme Engine & Live CSS Custom Property Resolution (`theme.js`)

* **Modes:** `dark`, `light`, and `auto` (respects `prefers-color-scheme`).
* **Live CSS Resolution (`getThemeColors()`):**  
  Reads computed colors directly from CSS custom properties (`--color-bg`, `--color-rose`, `--color-water`, etc.) and resolves `light-dark()` expressions dynamically without hardcoded hex constants in JS.
* **Palette Switch:** `settings.coloredPlayers` toggles between vibrant player-specific colors and classic monochrome phosphor styling.

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

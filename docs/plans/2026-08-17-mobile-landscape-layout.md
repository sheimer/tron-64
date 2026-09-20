# Plan: Mobile Landscape Layout & Responsive Aspect Ratio Optimization

**Date:** 2026-08-17  
**Goal:** Optimize the Tron layout on mobile devices in horizontal (landscape) orientation by driving arena dimensions from viewport height instead of width, introducing an ergonomic "retro handheld" thumb-control layout, and keeping directional input immediate and bounded.

---

## 1. Problem Statement

* The Tron arena has a fixed **16:10** aspect ratio (`320 x 200` cells = `1.6`).
* **In Portrait (Mobile / Vertical):** The viewport is tall (`100dvh > 100dvw`), so the arena is width-constrained. Scaling by width works naturally, and touch buttons sit comfortably below the canvas.
* **In Landscape (Mobile / Horizontal):** The viewport is short and wide (e.g. `844px x 390px`). Sizing based on width overflows the screen vertically, pushing the controls, start buttons, and scores off-screen.
* **Input latency:** Touch controls must react on contact rather than waiting for a synthesized click. Registering overlapping pointer, touch, and click handlers can submit the same turn more than once, while an unconstrained input queue can accumulate stale turns.
* **Goal:** When in horizontal orientation, size the arena based on available **height** (`max-height: 100dvh - offset`), derive width via `aspect-ratio: 16 / 10`, position touch controls under the left and right thumbs, and process rapid direction changes without duplicate events or an unbounded backlog.

---

## 2. Proposed Architecture & Design

### A. Pure CSS Height/Width Constraint via `min()` and `dvh`

In `public/stylesheets/layout.css`:

```css
#layout {
  /* Dynamic viewport units account for mobile browser navigation bars */
  --inner-width: calc(100dvw - 2 * var(--body-padding-horizontal));
  --inner-height: calc(100dvh - 2 * var(--body-padding-vertical));

  /* Scale by width in portrait, or by available height in landscape */
  --arena-fit-width: min(
    var(--arena-width),
    var(--inner-width),
    calc(var(--inner-height) * 1.6)
  );
}

#main {
  width: var(--arena-fit-width);
  height: calc(var(--arena-fit-width) / 1.6);
  aspect-ratio: 16 / 10;
  max-width: 100%;
  max-height: var(--inner-height);
}
```

### B. "Retro Handheld" Layout for Mobile Landscape

For `@media (orientation: landscape) and (max-height: 500px)`:
* **Grid Layout:** 3-column split view:
  * **Left Column:** Left-turn touch button (`<-`) and game stats.
  * **Center Column:** `#main` canvas scaled to maximum available viewport height with 16:10 ratio.
  * **Right Column:** Right-turn touch button (`->`) and settings/theme dropdown.
* **Ergonomics:** Enables two-handed thumb play without obstructing the canvas or requiring vertical scrolling.

### C. Immediate, De-duplicated Touch Input

* Prefer `pointerdown` as the single unified activation event where Pointer Events are supported, so a turn is sent as soon as the control is pressed.
* Use `touchstart` only as a deliberate compatibility fallback. Do not register pointer and touch handlers that can both process the same physical gesture.
* Apply `touch-action: manipulation` to the controls and suppress the follow-up synthetic click where necessary, while preserving keyboard activation and accessible button semantics.
* Evaluate a small client-side direction buffer for rapid sequential turns. Keep it explicitly bounded (for example, one pending turn beyond the current input), discard stale or invalid entries, and reset it on round/lifecycle transitions.
* Treat the buffer as an implementation option to validate against the existing server/player direction queue; do not introduce two independent queues with conflicting ordering rules.

---

## 3. Implementation Steps

1. **Update CSS Variables (`public/stylesheets/layout.css`):**
   - Replace standard `vh`/`vw` with `dvh`/`dvw` for reliable mobile browser bar handling.
   - Set up height-driven `min()` scaling for `--arena-fit-width`.
2. **Mobile Landscape Media Query:**
   - Define dedicated 3-column grid template areas for horizontal mobile screens (`max-height: 500px`).
   - Reposition `#btn-left` and `#btn-right` to left and right screen flanks.
3. **Immediate Input Handling:**
   - Route touch-control activation through one de-duplicated pointer/touch path with immediate press response.
   - Add `touch-action: manipulation` without breaking keyboard or assistive-technology activation.
4. **Bounded Direction Buffer Evaluation:**
   - Test whether a one-entry pending-turn buffer improves rapid cornering under realistic network latency.
   - If retained, define ordering, invalid-turn rejection, overflow behavior, and lifecycle reset rules, and keep them compatible with the server/player direction queue.
5. **Canvas Auto-Fit & Re-rendering:**
   - Verify `Renderer.js` resolution listener automatically handles orientation changes seamlessly.

---

## 4. Verification Checklist

- [ ] Mobile Portrait (e.g. 390x844): Arena scales to full width; touch buttons appear below canvas.
- [ ] Mobile Landscape (e.g. 844x390): Arena fills 100% of available height without vertical scrollbars.
- [ ] Left/right thumb buttons are easily reachable on mobile landscape.
- [ ] A physical press produces exactly one direction action; no pointer/touch/click duplication occurs.
- [ ] Rapid valid turns are responsive, ordered, and bounded; stale input does not execute later in the round.
- [ ] Keyboard activation and accessible button behavior still work.
- [ ] Direction input and any client buffer reset correctly on death, disconnect/reconnect, round end, and new round.
- [ ] Rotating between portrait and landscape preserves the live game canvas without distortion or queued-input side effects.
- [ ] Layout and controls are checked at 1×, 2×, and 3× device pixel ratios and relevant browser zoom levels.

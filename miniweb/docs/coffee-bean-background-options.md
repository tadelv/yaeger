# Coffee Bean Interactive Background — Design Options

This document proposes implementation options for adding a **subtle, performant, interactive** coffee-bean background to the miniweb Preact UI.

## Goals
- Keep telemetry and controls legible and primary.
- Maintain smooth interaction on low-power mobile devices.
- Respect reduced-motion accessibility preferences.
- Keep implementation maintainable in the existing TypeScript + Preact + Vite stack.

## Constraints from current app
- App root mounts in `#app` and currently renders a two-column layout (`.app-layout`).
- Styling is centralized in `src/style.css`.
- The app already uses lightweight Preact hooks and avoids heavyweight UI frameworks.

---

## Option 1 (Recommended): CSS + lightweight DOM bean layer

### Concept
Add a fixed background layer behind `.app-layout` containing 12–24 bean elements (`<span>`), each animated with CSS keyframes (slow drift + gentle roll). Use pointer position to apply a tiny parallax transform to the entire layer.

### Why it fits
- Very low implementation complexity.
- No rendering loop required for baseline motion.
- Easy to tune and theme with CSS variables.
- Accessible and easy to disable for `prefers-reduced-motion`.

### Implementation sketch
1. Add a `CoffeeBeanBackground` component (e.g. `src/coffeeBeans.tsx`) that:
   - Renders a `div.bean-bg` with child elements.
   - Tracks normalized pointer position (`-1..1`) via `pointermove` on window.
   - Applies `transform: translate(...)` to a wrapper for subtle interactivity.
2. Insert component near the top of `App()` so it sits behind content.
3. Add CSS:
   - `position: fixed; inset: 0; z-index: 0; pointer-events: none;`
   - Main UI (`#app`, `.app-layout`, panels) moved to `z-index: 1` context.
   - Keyframes for `bean-drift` and `bean-roll` with long durations (20–60s).
4. Add `@media (prefers-reduced-motion: reduce)` to disable or simplify animation.

### Interactivity level
Low-to-medium (gentle depth effect only).

### Performance
Excellent. Mostly compositor-friendly transforms and opacity.

---

## Option 2: Canvas 2D particle field (beans as vector sprites)

### Concept
Use one full-screen `<canvas>` and simulate 30–80 bean particles with simple physics: slow velocity, mild angular velocity, edge wrapping, and pointer repulsion/attraction radius.

### Why it fits
- More natural motion than pure CSS.
- Single DOM node regardless of bean count.
- Fine-grained control over motion profiles.

### Implementation sketch
1. Create `src/coffeeBeanCanvas.tsx` with a `requestAnimationFrame` loop.
2. Use `ResizeObserver` for canvas sizing.
3. Draw each bean as an ellipse + center crease line (or cached `Path2D`).
4. Apply small pointer force and spring back to base drift velocity.
5. Cap device pixel ratio (e.g. max 1.5) for battery/performance.
6. Pause loop when tab is hidden (`visibilitychange`).

### Interactivity level
Medium-to-high.

### Performance
Good if particle count and DPR are capped; moderate implementation complexity.

---

## Option 3: SVG pattern + displacement interaction

### Concept
Render a repeated SVG bean pattern in a background layer and animate group transforms slowly. On pointer move, shift a mask/gradient or mild displacement filter area.

### Why it fits
- Crisp visuals at any scale.
- Designer-friendly (easy to iterate bean shape).
- No canvas loop required for static/slow effects.

### Caveats
- SVG filters can be expensive on some browsers/devices.
- More tuning required to keep effect subtle and avoid visual noise.

### Interactivity level
Low-to-medium.

### Performance
Variable depending on filter usage.

---

## Option 4: WebGL shader background (noise-flow beans)

### Concept
Use a shader-based background that advects bean silhouettes through a velocity/noise field; pointer affects local distortion.

### Why it fits
- Most visually polished and fluid.
- Scales well for many elements.

### Caveats
- Highest complexity and maintenance cost.
- Overkill for this interface unless branding polish is a top priority.

### Interactivity level
High.

### Performance
Potentially great on modern GPUs, but less predictable on embedded/mobile browsers.

---

## Comparison table

| Option | Effort | Runtime cost | Visual richness | Best for |
|---|---:|---:|---:|---|
| 1. CSS + DOM layer | Low | Low | Medium | Fast, reliable delivery |
| 2. Canvas particles | Medium | Low-Medium | High | Natural motion + control |
| 3. SVG pattern | Medium | Low-Medium | Medium | Designer-led iteration |
| 4. WebGL shader | High | Medium | Very High | Premium visual identity |

## Recommendation
Start with **Option 1** and architect the background as a replaceable component boundary (`<CoffeeBeanBackground />`).

That gives immediate value with minimal risk, while preserving a path to upgrade to Option 2 later if richer motion is desired.

## Suggested defaults for subtlety
- Bean count: 14 desktop, 8 mobile.
- Opacity range: 0.06–0.14.
- Scale range: 0.7–1.25.
- Drift speed: 8–20 px/s equivalent.
- Pointer parallax max offset: 8–16 px.
- Keep high-contrast UI cards fully opaque to preserve readability.

## Acceptance criteria
- No measurable lag in tab switches or chart interactions.
- Text contrast and chart readability unchanged.
- Motion disabled/reduced when `prefers-reduced-motion` is active.
- Background never intercepts clicks (`pointer-events: none`).


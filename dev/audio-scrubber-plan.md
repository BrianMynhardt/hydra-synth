## Overview

Add drag-scrubber interaction to the `cut` and `scl` stat rows in the audio panel. Dragging a **value span** left/right adjusts that bin's `cutoff` or `scale` directly on `window.a.settings[i]` — no setter needed, `tick()` reads it live each frame. Dragging a **key label** calls the existing `setCutoff(v)` / `setScale(v)` to adjust all bins at once. Cursor changes to `ew-resize` on hover for discoverability. All changes are confined to `dev/panels/audio.js`.

## Constraints

- No changes to `src/lib/audio.js` or any file outside `dev/`
- `mousemove` and `mouseup` listeners must be registered once on `document`, not inside `buildCols()` (which can be called multiple times on bin-count change)
- `scale` must be clamped to a minimum of `0.1` to prevent divide-by-zero in `tick()` (`src/lib/audio.js:180`)
- `cutoff` clamped to `[0, window.a.max || 15]`; `scale` clamped to `[0.1, 50]`
- Vanilla JS only, no external dependencies, CommonJS module format preserved

## Acceptance Criteria

- Hovering over a `cut` or `scl` label or value shows `ew-resize` cursor
- Dragging a value span left/right changes only that bin's cutoff or scale live (canvas line moves, stat updates each frame)
- Dragging a key label left/right changes all bins' cutoff or scale via `setCutoff` / `setScale`
- No listener accumulation when `buildCols()` reruns (bin count change)
- Values never go below their minimum clamp (no NaN, no negative scale)

## Phase 1: Constants and drag state

1. `dev/panels/audio.js` — add two sensitivity constants at the top of the file: `const CUT_SENS = 0.1` and `const SCL_SENS = 0.15`
2. `dev/panels/audio.js` — add a module-level drag state object after the constants: `const drag = { active: false, binIndex: 0, prop: '', startX: 0, startVal: 0, global: false }`

## Phase 2: Per-element wiring in buildCols

3. `dev/panels/audio.js` — at the very top of `buildCols()`, add `drag.active = false` to reset stale state whenever columns are rebuilt
4. `dev/panels/audio.js` — in the `forEach` loop inside `buildCols()`, for `cut` and `scl` rows only, add `cursor:ew-resize` to the `k` (key) span's cssText
5. `dev/panels/audio.js` — for `cut` and `scl` rows only, add `cursor:ew-resize` to the `v` (value) span's cssText
6. `dev/panels/audio.js` — attach `mousedown` on the `v` span for `cut`/`scl`: set `drag = { active: true, binIndex: i, prop: (key === 'cut' ? 'cutoff' : 'scale'), startX: e.clientX, startVal: window.a.settings[i][prop], global: false }` and call `e.preventDefault()`
7. `dev/panels/audio.js` — attach `mousedown` on the `k` span for `cut`/`scl`: same capture but `global: true`, read `startVal` from `window.a.cutoff` (for cut) or `window.a.scale` (for scl)

## Phase 3: Document-level drag handlers

8. `dev/panels/audio.js` — after `buildCols()`, add a single `document.addEventListener('mousemove', onDragMove)` where `onDragMove` is a named function defined once at module scope
9. `dev/panels/audio.js` — inside `onDragMove`: guard `if (!drag.active || !window.a) return`; compute `const delta = (e.clientX - drag.startX) * (drag.prop === 'cutoff' ? CUT_SENS : SCL_SENS)`; compute `newVal = drag.startVal + delta`
10. `dev/panels/audio.js` — inside `onDragMove`: clamp `newVal` — for `cutoff`: `Math.max(0, Math.min(window.a.max || 15, newVal))`; for `scale`: `Math.max(0.1, Math.min(50, newVal))`
11. `dev/panels/audio.js` — inside `onDragMove`: if `drag.global`, call `window.a.setCutoff(newVal)` or `window.a.setScale(newVal)`; otherwise mutate `window.a.settings[drag.binIndex][drag.prop] = newVal` directly
12. `dev/panels/audio.js` — add `document.addEventListener('mouseup', () => { drag.active = false })` once at module scope (alongside the mousemove registration)

## Phase 4: Display polish

13. `dev/panels/audio.js` — in `update()`, change `cells[2].textContent = settings[i].cutoff` to `cells[2].textContent = settings[i].cutoff.toFixed(2)` so scrubbed values display cleanly
14. `dev/panels/audio.js` — change `cells[3].textContent = settings[i].scale` to `cells[3].textContent = settings[i].scale.toFixed(2)`

## Risks and Open Questions

- Listener accumulation: mitigated by registering `mousemove`/`mouseup` once outside `buildCols()`, but verify the module is only evaluated once (it is — CommonJS caches modules)
- `drag.active = false` reset in `buildCols()` means a mid-drag bin-count change aborts the drag cleanly
- Sensitivity constants may need tuning after live testing — `CUT_SENS` and `SCL_SENS` are easy to adjust at the top of the file
- No harness findings overlap with this change

## Verification

1. Open the dev UI with audio panel visible (Alt+a)
2. Hover over a `cut` or `scl` label or value — cursor should change to `ew-resize`
3. Drag a value span left/right — the cutoff line in that bin's canvas should move live
4. Drag a key label left/right — all bin canvases' cutoff lines should move together
5. Drag `scl` value toward the left until value approaches 0 — confirm it clamps at 0.10 and no NaN appears in the display
6. Change bin count via `a.setBins(8)` in the console — panel should rebuild with no extra listeners (verify via DevTools Event Listeners panel)

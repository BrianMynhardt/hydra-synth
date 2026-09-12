## Overview

Adds a 6th "bar" column to the Audio Inspector Panel in `dev/panels/audio.js`. Each row gains an 80×14 canvas that draws a live bar proportional to the raw smoothed `bins[i]` value, a 1px threshold line at the normalized `cutoff[i]` level, and a peak-hold marker (1px white line) that latches to the recent maximum and decays after 90 frames of non-exceedance. All changes live inside `init()` and `update()` in the single target file; no other file is modified.

## Constraints

- Only `dev/panels/audio.js` is modified — `src/lib/audio.js`, `dev/performance-ui.js`, and `dev/index.js` must not be touched
- State is attached to the `el` object using the established `el._rows` pattern (`el._canvases`, `el._peaks`, `el._peakAge`)
- No new imports, no new module dependencies
- Peak-hold decay uses a frame counter (90 frames), not `setTimeout` or `requestAnimationFrame`
- F-005 (audio.js setBins implicit global) must not be disturbed — panel reads `window.a` in the dev layer only
- Canvas context is retrieved via `getContext('2d')` per-frame (safe — returns cached context)
- `MAX` should read from `window.a.max || 15` rather than a hardcoded constant so user-set max is respected

## Acceptance Criteria

- The "Audio Bins" panel has a 6th "bar" column header
- Each row shows an 80×14 canvas with a cyan-tinted filled rect whose height is proportional to the current `bins[i]` value relative to `window.a.max`
- A dim horizontal line marks the `cutoff[i]` threshold on the canvas
- A white 1px peak-hold line floats above the bar and stays stable for ~90 frames before decaying
- When `bins[i]` exceeds the previous peak the line jumps immediately to the new max
- The panel does not overflow its container (width bumped to 400)
- No changes are observed in `src/lib/audio.js`, `dev/performance-ui.js`, or `dev/index.js`

## Phase 1: DOM — header and canvas cells

1. `dev/panels/audio.js` → `init()`, header labels array (line 13): add `'bar'` as the 6th entry after `'scale'`
2. `dev/panels/audio.js` → `init()`, row-building inner loop: keep the existing `j < 5` text-cell loop unchanged; after the loop body, create a 6th `<td>` containing a `<canvas width="80" height="14">` and append it to `tr`
3. `dev/panels/audio.js` → `init()`, after pushing to `rows`: push the canvas element into a parallel `canvases` array; after the row-building loop, store it as `el._canvases = canvases`

## Phase 2: State — peak-hold arrays

4. `dev/panels/audio.js` → `init()`, after `el._rows = rows`: add `el._peaks = Array(DEFAULT_BIN_COUNT).fill(0)`
5. `dev/panels/audio.js` → `init()`, same location: add `el._peakAge = Array(DEFAULT_BIN_COUNT).fill(0)`

## Phase 3: Drawing — bar, threshold, peak

6. `dev/panels/audio.js` → `update()`, top of the `for` loop body: add `const cv = el._canvases && el._canvases[i]; if (!cv) continue`
7. `dev/panels/audio.js` → `update()`, after the canvas guard: `const ctx = cv.getContext('2d')`
8. `dev/panels/audio.js` → `update()`: compute `const MAX = window.a.max || 15` (once, before the loop)
9. `dev/panels/audio.js` → `update()`, inside the loop: `const barH = Math.min(cv.height, (bins[i] / MAX) * cv.height)`
10. `dev/panels/audio.js` → `update()`: clear canvas — `ctx.clearRect(0, 0, cv.width, cv.height)`
11. `dev/panels/audio.js` → `update()`: draw bar — `ctx.fillStyle = '#0ff8'`, `ctx.fillRect(0, cv.height - barH, cv.width, barH)`
12. `dev/panels/audio.js` → `update()`: compute threshold Y — `const cutoffY = cv.height - (settings[i].cutoff / MAX) * cv.height`
13. `dev/panels/audio.js` → `update()`: draw threshold line — `ctx.strokeStyle = '#ff04'`, `ctx.lineWidth = 1`, `ctx.beginPath()`, `ctx.moveTo(0, cutoffY)`, `ctx.lineTo(cv.width, cutoffY)`, `ctx.stroke()`
14. `dev/panels/audio.js` → `update()`: peak-hold update — `if (bins[i] > el._peaks[i]) { el._peaks[i] = bins[i]; el._peakAge[i] = 0 } else { el._peakAge[i]++ }` then `if (el._peakAge[i] > 90) { el._peaks[i] *= 0.95 }`
15. `dev/panels/audio.js` → `update()`: compute peak Y — `const peakY = cv.height - Math.min(cv.height, (el._peaks[i] / MAX) * cv.height)`
16. `dev/panels/audio.js` → `update()`: draw peak line — `ctx.strokeStyle = '#fff'`, `ctx.beginPath()`, `ctx.moveTo(0, peakY)`, `ctx.lineTo(cv.width, peakY)`, `ctx.stroke()`

## Phase 4: Panel width

17. `dev/panels/audio.js` → module.exports: change `width: 300` to `width: 400`

## Risks and Open Questions

- `window.a.max` is user-settable at runtime; using `window.a.max || 15` in update() handles this correctly
- `DEFAULT_BIN_COUNT = 4` is fixed at init-time; if user calls `a.setBins(n)` with a different n after the panel is open, new bins won't have canvas cells — this is a pre-existing limitation of the panel and is out of scope for this plan
- Peak decay multiplier (0.95 per frame after 90-frame hold) may need tuning; 0.95 decays to ~half in ~14 frames after the hold expires — adjust if the marker feels too slow or too jumpy

## Verification

1. Open `dev/index.html` in a browser (or run the dev server via `npm start` / `npm run dev`)
2. Press Alt+A to show the Audio Bins panel
3. Play audio or call `a.initStream()` in the editor
4. Confirm the 6th "bar" column is visible with live cyan bars, a dim horizontal threshold line, and a white peak-hold line that jumps on loud transients and slowly decays
5. Confirm panel width is not clipped (no horizontal scrollbar inside the panel)

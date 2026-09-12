## Overview

Add an "auto-tune" button to the Audio Bins panel ([dev/panels/audio.js](dev/panels/audio.js)) that calibrates each bin's `cutoff` and `scale` from a short capture of live loudness samples. Goal: after clicking the button, `fft[i]` uses the full 0–1 range during typical audio activity — sitting near 0 in quiet sections and reaching near 1 on peaks without constant clipping. The button samples raw `bins[i]` for ~3 seconds on the existing per-frame `update()` tick, then writes 10th-percentile loudness as `cutoff` and `(95th-percentile − cutoff) * 1.1` as `scale`. A silence guard flashes the button red and skips the write if no bin shows meaningful range.

## Constraints

- All changes confined to [dev/panels/audio.js](dev/panels/audio.js). Do not modify [src/lib/audio.js](src/lib/audio.js) — `src/lib/` is a separate concern per AGENTS.md, and the per-bin `settings[]` write path already exists.
- Match the existing settings-mutation pattern at [dev/panels/audio.js:13-26](dev/panels/audio.js#L13-L26): write directly to `window.a.settings[i].cutoff` and `window.a.settings[i].scale`. Do not introduce a new API.
- Piggyback on the panel's existing `update(el)` tick (called from [dev/performance-ui.js:161-168](dev/performance-ui.js#L161-L168)). Do not add `setInterval`, `requestAnimationFrame`, or a separate sampling loop.
- The chrome (button + header) must survive `buildCols`'s `el.innerHTML = ''` reset at [dev/panels/audio.js:55](dev/panels/audio.js#L55), which fires on every bin-count change.
- Preserve panel descriptor signature — `init`, `update`, `id`, `title`, `key`, `zone`, `width`, `height` (lines [215-224](dev/panels/audio.js#L215-L224)) — unchanged.
- No new npm dependencies. No persistence to `localStorage` (out of scope; runtime-only, matching the drag handler's behaviour).
- No overlap with any open finding in [harness/findings.md](harness/findings.md).

## Acceptance Criteria

- A visible `auto-tune` button sits above the bin grid in the Audio panel.
- Clicking the button changes its label to `listening…` for ~3 seconds.
- After the capture window, `cells[2]` (cutoff row) and `cells[3]` (scale row) update for every bin to reflect the new computed values.
- With music playing during capture, the `fft` row consistently reaches values close to 1.0 on peaks and close to 0 in quiet sections.
- Clicking the button with no audio playing (silence) leaves all `settings[i]` untouched and flashes the button red briefly before restoring the `auto-tune` label.
- Changing bin count during a capture (via `window.a.setBins(n)`) aborts the capture cleanly — no partial write, button label restored.
- Existing drag-to-tune behaviour on `cut`/`scl` rows still works after auto-tune runs.

## Phase 1: Restructure panel chrome to host the button

1. In [dev/panels/audio.js](dev/panels/audio.js), modify `init(el)` to create a header `<div>` and a grid container `<div>` as children of `el`. Store the grid as `el._grid`. Apply existing `el.style.cssText` flex/column layout to keep current visual structure.
2. In `init(el)`, replace the existing `buildCols(el, 4)` call with `buildCols(el._grid, 4)`.
3. Update `buildCols(el, count)` parameter name to `grid` (or pass a separate grid reference) so the function operates on `el._grid` instead of `el`. Keep all writes to `_rows`/`_canvases`/`_peaks`/`_peakAge`/`_binCount` on the grid element — or move them onto a shared object — so `update(el)` continues to read them.
4. In `update(el)`, change reads of `el._rows`/`el._canvases`/`el._binCount` to read from `el._grid` (whichever target step 3 used). Verify rows/canvases still populate correctly.
5. Manually verify the panel still renders identically — bin canvases, raw/fft/cut/scl rows, drag handlers, MAX_BINS scroll — before moving on.

## Phase 2: Add the button and constants

6. At the top of [dev/panels/audio.js](dev/panels/audio.js), near the existing `CUT_SENS = 0.1` / `SCL_SENS = 0.15` constants, add `const CAPTURE_MS = 3000`, `const EPSILON = 0.05`, `const HEADROOM = 1.1`, `const FLASH_MS = 600`.
6. In `init(el)`, after building the header from Phase 1, create a `<button>` element with text `auto-tune`. Style it: monospace, font-size 11px, background `rgba(0,0,0,0.75)`, border `1px solid #0ff`, color `#0ff`, padding `2px 6px`, cursor `pointer`. Append to the header div.
7. Store the button reference on `el._tuneBtn` so `update` can mutate label/colour later.

## Phase 3: Capture loop

8. In `init(el)`, add a click handler to the button. On click, if `!window.a || !window.a.bins` return. Otherwise set `el._tune = { samples: Array.from({ length: window.a.bins.length }, () => []), until: performance.now() + CAPTURE_MS, binCount: window.a.bins.length }`. Set button text to `listening…`.
9. In `update(el)`, after the existing early-return guards (`if (!window.a || !el._rows) return`), add a block: if `el._tune` exists and `window.a.bins.length !== el._tune.binCount`, clear `el._tune` and restore button text to `auto-tune`. Return early from the auto-tune logic but continue with the rest of `update` so the panel keeps rendering.
10. In the same block, if `el._tune` exists and bin counts match, iterate `window.a.bins.forEach((b, i) => el._tune.samples[i].push(b))`.

## Phase 4: Compute and apply

11. In `update(el)`, after the capture block, if `el._tune && performance.now() >= el._tune.until`, run the compute step.
12. Inside the compute step, for each bin: sort the bin's sample array ascending; compute `cutoff = samples[Math.floor(samples.length * 0.10)]` and `peak = samples[Math.floor(samples.length * 0.95)]`; store both in a local results array.
13. Check the silence guard: if `any` results entry has `peak - cutoff < EPSILON`, set `el._tuneBtn.style.background = '#400'` and `el._tuneBtn.style.color = '#f88'`, set a `setTimeout` for `FLASH_MS` to restore `background: rgba(0,0,0,0.75)`, `color: #0ff`, and label `auto-tune`. Clear `el._tune` without writing settings.
14. If the silence guard passes, for each bin write `window.a.settings[i].cutoff = results[i].cutoff` and `window.a.settings[i].scale = (results[i].peak - results[i].cutoff) * HEADROOM`. Restore button text to `auto-tune` and clear `el._tune`.
15. The existing render loop in `update` will pick up the new `settings[i]` values automatically on the next tick (cutoff/scale lines redraw at [dev/panels/audio.js:190-196](dev/panels/audio.js#L190-L196), text cells at [dev/panels/audio.js:178-179](dev/panels/audio.js#L178-L179)).

## Risks and Open Questions

- **Headroom multiplier value (`HEADROOM = 1.1`)** — chosen to leave ~10% room above peak so `fft[i]` doesn't clip on every loud frame. May need tuning after the first real-world test. Surface as a panel constant for now; do not expose as a UI control yet.
- **Epsilon threshold (`EPSILON = 0.05`)** — order-of-magnitude guess for "no meaningful loudness range." Validate against Meyda's loudness specific scale during manual test. If too lenient, false positives on quiet music; if too strict, silence flash fails to fire.
- **Mid-capture bin-count change** — handled in step 9 but only if `window.a.setBins(n)` runs synchronously inside the dev console. If something else mutates `bins` mid-tick the abort still triggers on the next tick.
- **Capture window length** — 3s is fine for steady music but may miss a drop or build. Out of scope to make configurable.
- **Race with concurrent drag** — if the user is dragging `cut`/`scl` while auto-tune writes, drag wins on subsequent mousemove. Acceptable — no extra coordination needed.
- **No persistence** — same as the existing drag handlers. Document, do not fix.

## Verification

- Run `npm run dev` to start the dev server with live-reload.
- Open the browser; press `Escape` to reveal the editor and `Alt+A` to open the Audio Bins panel.
- Play music through the mic input (or call `a.initStream()` from the editor for system audio).
- Click `auto-tune`. Verify the button reads `listening…` for ~3s, then returns to `auto-tune`. Verify `cut` and `scl` row values change for every bin.
- In the editor, eval `osc(10, 0.1).color(a0(), a1(), a2()).out()` and observe `fft` values via the panel — they should range across roughly 0 to 1 during a song.
- Stop audio, click `auto-tune` again. Verify the button flashes red briefly and the `cut`/`scl` values do **not** change.
- Eval `a.setBins(8)`, click `auto-tune`, then immediately eval `a.setBins(4)`. Verify the button label restores to `auto-tune` without writing partial results.
- Confirm existing drag-to-tune on `cut` and `scl` rows still works after a successful auto-tune pass.

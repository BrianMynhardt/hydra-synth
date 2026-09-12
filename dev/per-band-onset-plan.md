## Overview

Adds per-bin onset (attack) detection to `Audio` so performers can trigger visuals on
the moment a sound *starts* in a frequency band — not just when it's loud. The signal is
spectral flux, computed as the positive part of the frame-to-frame magnitude difference
in `amplitudeSpectrum`, summed over each bin's FFT index range. Two new arrays appear on
the synth: `a.flux[i]` (raw flux this frame) and `a.onset[i]` (boolean — true for the one
frame a rising edge crosses the bin's threshold, with a small refractory cooldown to
prevent double-fires). Bins with explicit Hz ranges from Plan 1 reuse the same
`[kMin..kMax]` window, so once `a.setBinRange(0, 40, 100)` is set, `a.onset[0]` fires on
kicks; pair with `a.setBinRange(1, 180, 300)` to get `a.onset[1]` firing on snares.

This plan depends on Plan 1 (`amplitudeSpectrum` already in Meyda's feature list and
`settings[i].minHz`/`maxHz` already present). It assumes Plan 1 has shipped.

The dev panel gains a `thr` row (scrubable threshold per bin, mirroring the existing
`cut`/`scl` interactions) and a 1-frame white flash on the bar canvas when a bin's
onset fires — giving immediate visual feedback that an instrument trigger is firing.

## Constraints

- Only `src/lib/audio.js` and `dev/panels/audio.js` are modified
- Existing `a.isBeat`, `a.fft`, `a.bins`, `a0..a3` consumers continue to behave identically
- Flux is computed from `amplitudeSpectrum` (always — even for default-mode bins, which
  map to an equal-Hz slice of the spectrum), giving a consistent flux scale across all
  bins so a single default `fluxThreshold` works regardless of bin mode
- Onset firing uses rising-edge + refractory cooldown (default 3 frames ≈ 50ms at 60fps)
  so a single transient produces one `true` frame, not a burst
- No new module dependencies; Meyda's built-in `'spectralFlux'` feature is NOT used
  (it returns a single scalar across the whole spectrum, not per-bin)
- `setBins(n)` reset still drops thresholds along with cutoff/scale — pre-existing,
  documented
- F-005 (`window.a` global) is unchanged; `a.onset` and `a.flux` are reachable via the
  same `window.a` reference

## Acceptance Criteria

- `a.onset[i]` exists as an array of booleans, same length as `a.bins`
- `a.flux[i]` exists as an array of finite non-negative numbers
- With audio playing and `a.setBinRange(0, 40, 100)` active, scrubbing the new `thr` cell
  on bin 0 down to ~0.05 (or below the kick peak) produces `a.onset[0] === true` exactly
  once per kick (verifiable by `setInterval(() => a.onset[0] && console.log('kick'), 16)`
  showing one log per kick)
- Onset cooldown prevents adjacent-frame double-fires: at 0.05 threshold during a single
  kick transient, `a.onset[0]` is `true` for one frame and then `false` for at least 3
  frames before it can fire again
- Default-mode bins (no `setBinRange`) also produce flux — `a.flux[2]` is non-zero on
  broadband audio activity
- The Audio Bins panel shows a new `thr` row beneath `hz` (from Plan 1); cells are
  scrubable left/right to adjust per-bin `settings[i].fluxThreshold`
- The bar canvas flashes a white horizontal band at the bottom for the single frame
  `onset[i] === true`
- `a.setFftSize(2048)` reallocates `prevSpectrum` correctly; onsets continue to fire
  without a NaN/crash on the first frame after the switch
- Patches using `osc(60).out()` plus a snippet like `a.onset[0] && /* spike */` (e.g.
  `solid(1,1,1).out(o3)` triggered) flash on each kick — observable in the rendered
  canvas

## Touch points

- [src/lib/audio.js:18-32](src/lib/audio.js#L18-L32) — constructor; initialize
  `this.onsetHoldFrames = 3` near the other beat-detection fields
- [src/lib/audio.js:135-146](src/lib/audio.js#L135-L146) — `setFftSize`; clear
  `this._prevSpectrum = null` so the next tick reallocates at the new size
- [src/lib/audio.js:164-185](src/lib/audio.js#L164-L185) — `tick()`; add the flux/onset
  computation block after the existing `fft` mapping, before `if (this.isDrawing)`
- [src/lib/audio.js:203-217](src/lib/audio.js#L203-L217) — `setBins`; initialize
  `this.flux`, `this.onset`, `this._onsetCooldown`, and add
  `fluxThreshold: 0.1` to each settings entry
- [src/lib/audio.js:217-218](src/lib/audio.js#L217-L218) — insert new
  `setOnsetThreshold` method after `setBinRange` (added in Plan 1)
- [dev/panels/audio.js:90-95](dev/panels/audio.js#L90-L95) — stat-row descriptor array;
  append `{ label: 'thr', color: '#f80', prop: 'fluxThreshold' }`
- [dev/panels/audio.js:59](dev/panels/audio.js#L59) — `rows = Array.from(...)` row
  template; bump per-bin row slot count from 5 (after Plan 1) to 6
- [dev/panels/audio.js:18-31](dev/panels/audio.js#L18-L31) — `onDragMove` sensitivity
  selection; extend the `sens` choice so `fluxThreshold` uses a fine sensitivity (~0.005
  — flux values live in 0–1 range)
- [dev/panels/audio.js:251-289](dev/panels/audio.js#L251-L289) — `update()` per-bin
  rendering; populate the new `cells[5]` text, and add the 1-frame white-flash overlay
  on the bar canvas when `a.onset[i] === true`
- [dev/panels/audio.js:292-301](dev/panels/audio.js#L292-L301) — module.exports
  `height`; bump 175 → 190 to accommodate the extra row

## Design

**Data flow.** Each tick, after the existing `bins`/`fft` computation, the code reads
`features.amplitudeSpectrum` and a per-instance `_prevSpectrum` cache. For every bin it
derives an FFT index window `[kMin..kMax]` (Hz-range path identical to Plan 1; default
path equal-slices `spec.length / bins.length`). Flux is the sum of
`max(0, spec[k] - prevSpectrum[k])` over the window — the rectified spectral flux. A
rising edge across `settings[i].fluxThreshold` flips `onset[i]` to `true` and seeds the
per-bin refractory counter; subsequent frames stay `false` until the counter expires.

**Why per-bin manual flux instead of Meyda `spectralFlux`.** Meyda's `'spectralFlux'`
returns one scalar across the entire spectrum — useless for instrument separation. Manual
integration over the same Hz windows used by Plan 1 keeps onset detection aligned with
bin energy: `onset[i]` and `bins[i]` measure attack-vs-loudness on the same band.

**Naming.**
- New instance fields: `flux: number[]`, `onset: boolean[]`,
  `_prevSpectrum: Float32Array | null`, `_onsetCooldown: number[]`,
  `onsetHoldFrames: number`
- New per-bin setting: `fluxThreshold: number` (default 0.1)
- New method: `setOnsetThreshold(index, value)`

**Rising-edge + cooldown.** A pure threshold-crossing without cooldown would fire `true`
for every frame the flux stays above threshold (typically 2–5 frames during a single
hit). The cooldown counter is set to `onsetHoldFrames` at fire time and decremented each
tick; new onsets are gated until it hits zero. This is structurally identical to the
existing `beat.holdFrames` / `_framesSinceBeat` pattern in [src/lib/audio.js:148-162](src/lib/audio.js#L148-L162).

**Central mechanism (sketch).**

```js
// inside tick(), placed after the existing this.fft = ... mapping
const spec = features.amplitudeSpectrum
if (spec) {
  if (!this._prevSpectrum || this._prevSpectrum.length !== spec.length) {
    this._prevSpectrum = new Float32Array(spec.length) // zero-filled — first frame flux = sum(spec)
  }
  const binHz = this._context.sampleRate / this._fftSize
  const span  = spec.length / this.bins.length
  for (let i = 0; i < this.bins.length; i++) {
    const s = this.settings[i]
    let kMin, kMax
    if (s.minHz != null) {
      kMin = Math.max(0, Math.floor(s.minHz / binHz))
      kMax = Math.min(spec.length - 1, Math.ceil(s.maxHz / binHz))
    } else {
      kMin = Math.floor(i * span)
      kMax = Math.min(spec.length - 1, Math.floor((i + 1) * span) - 1)
    }
    let flux = 0
    for (let k = kMin; k <= kMax; k++) {
      const d = spec[k] - this._prevSpectrum[k]
      if (d > 0) flux += d
    }
    this.flux[i] = flux
    if (this._onsetCooldown[i] > 0) {
      this._onsetCooldown[i]--
      this.onset[i] = false
    } else if (flux >= s.fluxThreshold) {
      this.onset[i] = true
      this._onsetCooldown[i] = this.onsetHoldFrames
    } else {
      this.onset[i] = false
    }
  }
  this._prevSpectrum.set(spec)
}
```

## Phase 1: per-bin onset state in setBins

1. [src/lib/audio.js:207-211](src/lib/audio.js#L207-L211) — extend the settings-entry
   factory (already touched by Plan 1) to include `fluxThreshold: 0.1`
2. [src/lib/audio.js:203-217](src/lib/audio.js#L203-L217) — alongside the existing
   `this.bins = ...`, `this.prevBins = ...`, `this.fft = ...` lines, add
   `this.flux = Array(numBins).fill(0)`, `this.onset = Array(numBins).fill(false)`,
   `this._onsetCooldown = Array(numBins).fill(0)`
- **Files:** `src/lib/audio.js`
- **Acceptance:** in the editor, `a.flux.length === a.bins.length`,
  `a.onset.every(v => v === false)`, `a.settings[0].fluxThreshold === 0.1`

## Phase 2: prevSpectrum cache + reset on fftSize change

3. [src/lib/audio.js:18-32](src/lib/audio.js#L18-L32) — in the constructor, near the
   beat detection block, add `this.onsetHoldFrames = 3` and `this._prevSpectrum = null`
4. [src/lib/audio.js:135-146](src/lib/audio.js#L135-L146) — in `setFftSize`, after the
   Meyda re-creation, add `this._prevSpectrum = null` so the next tick lazily allocates
   at the new spectrum length
- **Files:** `src/lib/audio.js`
- **Acceptance:** `a.onsetHoldFrames === 3`; after `a.setFftSize(2048)`,
  `a._prevSpectrum === null` until the next tick

## Phase 3: tick() flux + onset block

5. [src/lib/audio.js:164-185](src/lib/audio.js#L164-L185) — paste the Design sketch
   inside the existing `if (features && features !== null)` branch, after the line
   that sets `this.fft = this.bins.map(...)`. Guard on `features.amplitudeSpectrum`
   (may be undefined on the very first frame)
- **Files:** `src/lib/audio.js`
- **Acceptance:** with audio playing, `a.flux[2]` is non-zero on broadband activity;
  `a.flux[0]` after `a.setBinRange(0, 40, 100)` shows brief spikes (~0.05–0.5 range
  depending on source) on each kick; lowering `a.settings[0].fluxThreshold = 0.02`
  causes `a.onset[0]` to fire visibly per kick (verifiable via a logging snippet)

## Phase 4: setOnsetThreshold convenience method

6. [src/lib/audio.js:217-218](src/lib/audio.js#L217-L218) — insert after the
   `setBinRange` method (Plan 1):
   ```js
   setOnsetThreshold (index, value) {
     if (!Number.isInteger(index) || index < 0 || index >= this.settings.length) {
       throw new RangeError(`bin index ${index} out of range`)
     }
     if (!Number.isFinite(value) || value < 0) {
       throw new TypeError(`fluxThreshold must be a non-negative number`)
     }
     this.settings[index].fluxThreshold = value
   }
   ```
- **Files:** `src/lib/audio.js`
- **Acceptance:** `a.setOnsetThreshold(0, 0.05)` succeeds;
  `a.setOnsetThreshold(0, -1)` throws TypeError

## Phase 5: panel thr row with scrub

7. [dev/panels/audio.js:90-95](dev/panels/audio.js#L90-L95) — append
   `{ label: 'thr', color: '#f80', prop: 'fluxThreshold' }` after the `hz` row added in
   Plan 1
8. [dev/panels/audio.js:59](dev/panels/audio.js#L59) — change `rows = Array.from({ length: count }, () => [null, null, null, null, null])`
   (5 slots from Plan 1) to a 6-slot template so the new `si === 5` index has a slot
9. [dev/panels/audio.js:7-8](dev/panels/audio.js#L7-L8) — add `const THR_SENS = 0.005`
   beside the existing `CUT_SENS` / `SCL_SENS` constants
10. [dev/panels/audio.js:20](dev/panels/audio.js#L20) — extend `onDragMove`'s sensitivity
    selection to pick `THR_SENS` when `drag.prop === 'fluxThreshold'`, and update its
    clamp branch (a new `else if` mirroring `cutoff`'s shape: `Math.max(0, Math.min(5, raw))`)
11. [dev/panels/audio.js:25-27](dev/panels/audio.js#L25-L27) — the global drag branch
    inside `onDragMove` currently routes `cutoff` → `setCutoff` and `scale` → `setScale`.
    For `fluxThreshold` there's no global setter — fall through to the
    `window.a.settings[drag.binIndex][drag.prop] = newVal` per-bin path even when
    `drag.global === true` (or just skip the global affordance and only allow per-cell
    scrubbing). Recommended: skip — making the row label non-scrubable (`prop: null`)
    is wrong since `prop` drives the per-cell scrub binding too. Instead, in the
    label-mousedown handler (lines 104-114), check `prop === 'fluxThreshold'` and bail
    out (don't activate global drag for that row)
12. [dev/panels/audio.js:251-256](dev/panels/audio.js#L251-L256) — in `update()`'s
    per-bin loop, set `cells[5].textContent = settings[i].fluxThreshold.toFixed(3)`
- **Files:** `dev/panels/audio.js`
- **Acceptance:** panel shows new `thr` row beneath `hz`; scrubbing the bin-0 thr cell
  left/right changes `a.settings[0].fluxThreshold` in real time; the row label itself
  does NOT scrub globally (no `setOnsetThreshold` global affordance)

## Phase 6: onset flash overlay on bar canvas

13. [dev/panels/audio.js:251-289](dev/panels/audio.js#L251-L289) — in the per-bin loop
    inside `update()`, after the existing peak-line draw, check
    `window.a.onset && window.a.onset[i]` and, if true, draw a white rectangle across
    the full canvas width at the bottom 4px: `ctx.fillStyle = '#fff'; ctx.fillRect(0,
    cv.height - 4, cv.width, 4)`. Because `onset[i]` is reset to `false` on the very
    next tick, this naturally produces a 1-frame flash
14. [dev/panels/audio.js:298](dev/panels/audio.js#L298) — bump `height: 175` → `height: 190`
- **Files:** `dev/panels/audio.js`
- **Acceptance:** with a kick playing through `setBinRange(0, 40, 100)` and threshold
  tuned to ~0.05, the bin-0 canvas flashes a white strip at the bottom on each kick;
  no flash on neighbouring bins; panel height accommodates the new row without clipping

## Phase 7: integration sanity

15. No code change. End-to-end test exercising the full chain: `a.initStream()` →
    `a.setBinRange(0, 40, 100)` → `a.setBinRange(1, 180, 300)` → tune `thr` for both
    bins from the panel → write `osc(60).color(()=>a.onset[0]?1:0).out()` in the editor
    → Ctrl+Enter → confirm canvas flashes red on each kick
- **Files:** none
- **Acceptance:** osc visibly white-flashes on kicks and stays dark on snares; switching
  `a.onset[0]` to `a.onset[1]` in the editor flips the trigger to snare-only

## Risks and open questions

- **Risk:** `0.1` is a placeholder default `fluxThreshold` — too low for default-mode
  bins on noisy sources (firing on hi-hat hash), too high for narrow Hz-range bins (no
  fires until manually scrubbed lower). The plan accepts this and relies on the panel's
  scrub affordance for tuning. A future plan could add a per-bin onset auto-tune (3-sec
  capture, pick 95th percentile of flux as threshold) — same pattern as the existing
  cutoff/scale auto-tune in [dev/panels/audio.js:161-172](dev/panels/audio.js#L161-L172).
- **Risk:** the first frame after `_prevSpectrum` allocation has `prevSpectrum` all
  zeros, so flux equals the full `spec` sum — likely a spurious onset on every bin. Mitigated
  by the cooldown (suppresses one frame and moves on) but visible as a flash. Optional:
  skip the onset check on the first frame after reallocation (track via a
  `_prevSpectrumReady` flag) — add only if the false-fire is distracting in practice.
- **Risk:** `amplitudeSpectrum` from Meyda is windowed (Hanning by default) — the
  effective Hz range covered by `[kMin..kMax]` has spectral leakage at the edges.
  Acceptable for performance use; not acceptable for analysis-grade onset detection.
  Document, don't fix.
- **Q:** should `onset[]` also expose a "level-held" variant (`onset[]` true for *every*
  frame above threshold, not just the rising edge)? Default: no — rising-edge is more
  composable in patches. Users who want sustained-above-threshold can compare `a.flux[i]
  >= a.settings[i].fluxThreshold` directly.
- **Q:** should there be a global `setOnsetHoldFrames(n)` setter? Default: no — keep
  it as a direct property assignment (`a.onsetHoldFrames = 5`) until a use case justifies
  a method.
- **Q:** edge-vs-level semantics for a future `o0..oN` global (analog to `a0..a3` for
  `fft`)? Out of scope here — `a.onset[0]` is reachable today and sufficient.

## Verification

1. Run dev harness; press Alt+A
2. `a.initStream()` (system audio) on a kick+snare-heavy track
3. `a.setBinRange(0, 40, 100); a.setBinRange(1, 180, 300)` — Plan 1 already verified
   bins respond
4. In panel, scrub bin-0 `thr` cell to ~0.05 — watch the bar canvas for white flashes
   on each kick
5. Scrub bin-1 `thr` likewise; flashes should fire on snares without firing on kicks
6. In editor: `osc(60).color(()=>a.onset[0]?1:0,1,1).out()`. Ctrl+Enter.
   Output canvas should white-flash on each kick
7. Change to `a.onset[1]` — flashes track snare instead
8. Drop bin-2 `thr` to ~0.05 — default-mode bin should now flash on broadband activity
   (any loud transient)
9. `a.setFftSize(2048)` mid-play: brief glitch ok (one frame of fall-through), but
   subsequent kicks still trigger `a.onset[0]`
10. `a.setOnsetThreshold(0, 999)` — bin 0 stops firing; restore `0.05` and it fires again

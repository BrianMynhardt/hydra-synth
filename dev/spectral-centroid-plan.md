## Overview

Adds a 0–1 "brightness" reading to `Audio` that tracks the spectral centroid of the
current sound — a measure of where the spectrum's center of mass sits, independent of
volume. A bassline blasting at peak loudness and a hi-hat playing quietly have very
different centroids, so brightness lets performers crossfade or recolor visuals on
*timbre* rather than amplitude. The change is one new entry in Meyda's feature list,
one normalization line in `tick()`, two new properties on the `Audio` instance
(`a.brightness` smoothed, `a.brightnessRaw` unsmoothed), and an optional `br()` global
factory that mirrors `a0..a3`. A small inline readout is added to the Audio Bins panel
title bar so the value is observable without leaving the dev harness.

This plan is independent of Plans 1 and 2 — it only adds `'spectralCentroid'` to the
Meyda feature list and reads `features.spectralCentroid` in `tick()`. It can ship before
or after the Hz-range / onset plans without conflict.

## Constraints

- Only `src/lib/audio.js` and `dev/panels/audio.js` are modified
- Brightness is normalized into `[0, 1]` by Nyquist (`sampleRate / 2`); values above 1
  are clamped (FFT leakage can push centroid slightly above Nyquist)
- The raw centroid Hz value is preserved on `a.brightnessRaw` (in Hz, not normalized)
  so users can inspect the underlying number; `a.brightness` is the normalized + smoothed
  version intended for patch binding
- Smoothing factor is configurable (`a.brightnessSmooth`, default 0.5) and matches the
  `prevBins`-style one-pole filter already used for bins
- The new `br(scale = 1, offset = 0)` global is opt-in via `_makeGlobal` (same gate as
  `a0..a3` in `setBins`)
- `features.spectralCentroid` is `NaN` when the signal is fully silent (Meyda returns
  `0/0`); the code guards with `Number.isFinite` and falls through to the previous
  smoothed value
- No new dependencies; `'spectralCentroid'` is built into Meyda

## Acceptance Criteria

- `a.brightness` is a finite number in `[0, 1]`, updated every tick
- `a.brightnessRaw` is the unsmoothed centroid in Hz (e.g. ~300 for a bass-heavy mix,
  ~4000+ for a hi-hat-only stem)
- `a.brightnessSmooth` reads and writes the smoothing factor; setting it to 0 makes
  `a.brightness` equal to the normalized raw value
- `br()` is a function in `window` after `a.initStream()`; calling `br(2)` returns a
  thunk that returns `a.brightness * 2`
- The Audio Bins panel title bar shows `brt: 0.NN` updating live
- On silence, `a.brightness` stays at its last value (does not jump to NaN); resuming
  audio updates it normally
- A patch `osc(60).color(() => a.brightness, 1, 1).out()` visibly tints brighter on
  high-content audio (cymbals, vocals) and dimmer on bass-only passages — independent
  of overall loudness

## Touch points

- [src/lib/audio.js:18-32](src/lib/audio.js#L18-L32) — constructor; initialize
  `this.brightness = 0`, `this.brightnessRaw = 0`, `this.brightnessSmooth = 0.5`
- [src/lib/audio.js:124](src/lib/audio.js#L124) — Meyda `featureExtractors` array; append
  `'spectralCentroid'`
- [src/lib/audio.js:143](src/lib/audio.js#L143) — duplicate feature list in `setFftSize`;
  append `'spectralCentroid'`
- [src/lib/audio.js:164-185](src/lib/audio.js#L164-L185) — `tick()`; after the
  `this.fft = ...` line, compute normalized + smoothed brightness from
  `features.spectralCentroid`
- [src/lib/audio.js:212-216](src/lib/audio.js#L212-L216) — `setBins`; inside the
  `_makeGlobal` guard alongside the `a0..a3` factory, add a one-time
  `window.br = (scale = 1, offset = 0) => () => (this.brightness * scale + offset)`
  (only on first call — guard with `if (!window.br)` to avoid re-binding on every
  `setBins`)
- [dev/panels/audio.js:174-203](dev/panels/audio.js#L174-L203) — `init`; append a
  `<span>` readout to `titleBar` showing `brt: …`
- [dev/panels/audio.js:205-256](dev/panels/audio.js#L205-L256) — `update`; refresh the
  brightness readout with `a.brightness.toFixed(2)`

## Design

**Data flow.** Meyda's `spectralCentroid` returns the centroid as an FFT *bin index*
(0..fftSize/2). Convert to Hz with `centroid * sampleRate / fftSize`, normalize by
`sampleRate / 2` (Nyquist) to land in `[0, 1]`. Apply a one-pole filter against the
previous smoothed value so the readout doesn't jitter wildly between frames.

**Why expose both `brightness` and `brightnessRaw`.** Most patches want the normalized
0–1 form to plug into a `.color(…)` or `.scale(…)` argument. Power users tuning to a
specific frequency range (e.g. "trigger when centroid > 2 kHz") want the Hz value
directly. Storing both costs two scalars per frame.

**Why a one-pole smoothing instead of using `setSmooth`'s value.** `setSmooth` is
bin-scoped and writes to `settings[i].smooth`. Brightness is global, so it gets its own
field. Default 0.5 matches the bin default.

**Naming.**
- `brightness: number` (normalized + smoothed, 0..1, intended for binding)
- `brightnessRaw: number` (raw Hz, post-normalization but pre-smoothing — actually:
  decision below)
- `brightnessSmooth: number` (smoothing factor 0..1; 0 = no smoothing, 1 = frozen)

Clarification on `brightnessRaw`: store the centroid in **Hz** (pre-normalization,
pre-smoothing) so it remains intelligible across sample rates. Convert when reading.

**Central mechanism (sketch).**

```js
// inside tick(), after this.fft = ...
const sc = features.spectralCentroid
if (Number.isFinite(sc) && this._context) {
  const hz       = sc * this._context.sampleRate / this._fftSize
  const nyquist  = this._context.sampleRate / 2
  const normRaw  = Math.max(0, Math.min(1, hz / nyquist))
  this.brightnessRaw = hz
  this.brightness    = normRaw * (1 - this.brightnessSmooth) +
                       this.brightness * this.brightnessSmooth
}
// silence (NaN) falls through — brightness keeps its previous value
```

## Phase 1: instance fields + Meyda feature

1. [src/lib/audio.js:18-32](src/lib/audio.js#L18-L32) — in the constructor near the
   `this.cutoff`, `this.smooth` lines, add `this.brightness = 0`,
   `this.brightnessRaw = 0`, `this.brightnessSmooth = 0.5`
2. [src/lib/audio.js:124](src/lib/audio.js#L124) — change
   `featureExtractors: ['loudness']` to
   `featureExtractors: ['loudness', 'spectralCentroid']` (or append if other plans have
   landed; preserve the existing entries)
3. [src/lib/audio.js:143](src/lib/audio.js#L143) — same change inside `setFftSize`
- **Files:** `src/lib/audio.js`
- **Acceptance:** in the editor, after `a.initStream()`,
  `a._meyda.get().spectralCentroid` returns a finite number; `a.brightness === 0`
  (uninitialized but valid)

## Phase 2: tick() centroid normalization + smoothing

4. [src/lib/audio.js:164-185](src/lib/audio.js#L164-L185) — inside the
   `if (features && features !== null)` block, after `this.fft = ...`, paste the
   Design sketch
- **Files:** `src/lib/audio.js`
- **Acceptance:** with audio playing, `a.brightness` is a finite number in `[0, 1]`;
  bass-only passages show ~0.1–0.2, cymbal/vocal-rich passages show ~0.4–0.7;
  `a.brightnessRaw` is in Hz (centroid * sampleRate / fftSize)

## Phase 3: br() global factory

5. [src/lib/audio.js:212-216](src/lib/audio.js#L212-L216) — inside the
   `if (this._makeGlobal)` block in `setBins`, after the `a0..a3` loop, add (idempotent):
   ```js
   if (!window.br) {
     window.br = (scale = 1, offset = 0) => () => (this.brightness * scale + offset)
   }
   ```
- **Files:** `src/lib/audio.js`
- **Acceptance:** `typeof br === 'function'`; `br(2)()` returns
  `a.brightness * 2`; reassigning `br = null` and calling `a.setBins(8)` reinstalls it

## Phase 4: panel readout in title bar

6. [dev/panels/audio.js:174-203](dev/panels/audio.js#L174-L203) — inside `init`, after
   the existing auto-tune button is attached to `titleBar`, create a
   `<span>` (e.g. `brtEl`), set its style
   (`font:11px monospace;color:#0ff;margin-right:6px`), set initial text `brt: —`,
   insert it before `titleBar.lastChild`, and store on `el._brtEl`
7. [dev/panels/audio.js:205-256](dev/panels/audio.js#L205-L256) — in `update`, near the
   top after the `window.a` guard, if `el._brtEl` exists and `window.a.brightness` is a
   number, set `el._brtEl.textContent = 'brt: ' + window.a.brightness.toFixed(2)`
- **Files:** `dev/panels/audio.js`
- **Acceptance:** opening the Audio Bins panel (Alt+A) shows `brt: 0.NN` in the title
  bar, updating each tick

## Phase 5: documentation comment (optional)

8. Add a one-line comment near the new tick() block: `// spectral centroid → 0..1
   "brightness" — see docs/IDEAS.md #9`. Keep it short; one line max.
- **Files:** `src/lib/audio.js`
- **Acceptance:** comment present; no behavior change

## Risks and open questions

- **Risk:** `spectralCentroid` from Meyda is sensitive to noise floor — quiet rooms or
  silent stems yield erratic values. The `Number.isFinite` guard prevents NaN
  contamination, and smoothing reduces jitter, but a hard-silent-input check (e.g.
  `if (this.vol < 0.01) skip update`) could be added later if needed. Out of scope.
- **Risk:** `_makeGlobal` users who shadow `br` with their own variable will lose the
  helper after a `setBins` re-run; the `if (!window.br)` guard prevents accidental
  clobber, which means re-installing requires `delete window.br` first. Acceptable.
- **Q:** should there be `bd()` ("darkness") = `1 - brightness` as a convenience global?
  Skip — users can write `() => 1 - a.brightness` inline. Avoid global pollution.
- **Q:** centroid normalization by Nyquist is correct for full-bandwidth audio, but if
  the source has a lowpass at e.g. 8 kHz, brightness will never approach 1. Should we
  expose a `brightnessMaxHz` clamp? Skip for v1; users can write
  `() => Math.min(1, a.brightnessRaw / 4000)` if they want a custom range.
- **Q:** worth adding a tiny sparkline of recent brightness in the title bar instead of
  just text? Skip — keeps the change to two lines per file. Sparkline is a candidate
  for a future Variable Watch panel (IDEAS.md #13).

## Verification

1. Run dev harness; press Alt+A
2. `a.initStream()` on a track with clear bass/cymbal contrast
3. Confirm the title bar shows `brt: 0.NN` and updates each frame
4. Mute the stream momentarily — brightness should freeze (not jump to NaN); resume
   and it updates again
5. In editor: `osc(60, 0.1).color(()=>a.brightness, 1, 1).out()` — Ctrl+Enter. Output
   should brighten on hi-hat-heavy sections and darken during bass drops, independent
   of overall loudness
6. Try `osc(60, 0.1).color(br(2), 1, 1).out()` — same effect, doubled
7. `a.brightnessSmooth = 0` — readout should jitter visibly (raw normalized);
   `a.brightnessSmooth = 0.9` — readout should drift slowly
8. Inspect `a.brightnessRaw` — value is in Hz (typically 200–6000 depending on source)

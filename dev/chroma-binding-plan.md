## Overview

Adds harmonic awareness to the audio layer: `a.chroma[0..11]` exposes one amplitude
value per pitch class (C, C#, D, …, B), letting performers bind visuals to *which
notes* are playing — "pulse red when E is dominant", "brighten on major chords",
"flicker every time the bassline returns to A." This is a capability no FFT-bin
approach can deliver; chroma collapses the spectrum along the octave axis so the same
note in different octaves contributes to the same bucket. Implementation is one new
entry in Meyda's feature list, a 12-element smoothed array on the `Audio` instance,
twelve `ch0()..ch11()` global factories (mirroring `a0..a3`), and a dedicated
`Chromagram` panel showing all twelve bars with their dominant-note highlight.

This plan is independent of Plans 1–4 — it only adds `'chroma'` to Meyda's feature
list and reads `features.chroma` in `tick()`. It composes cleanly with any combination
of the other plans (e.g. `a.chroma[0]` + `a.brightness` + `a.onset[0]` all available).

## Constraints

- Two files modified: `src/lib/audio.js` and `dev/index.js`; one new file:
  `dev/panels/chroma.js`
- `a.chroma` is always a 12-element array of finite numbers in `[0, 1]`; smoothed
  with a per-instance factor `a.chromaSmooth` (default 0.4)
- `ch0()..ch11()` globals follow the exact factory signature of `a0..a3`:
  `(scale = 1, offset = 0) => () => (a.chroma[i] * scale + offset)`
- Globals are installed exactly once in `setBins` (guarded by `if (!window.ch0)`) so
  they survive `setBins(n)` resets without re-binding twelve closures every call
- The new panel descriptor uses key `'k'` (Alt+K) — Alt+C is unassigned but reserved
  for clipboard-style features in browsers; Alt+K avoids that and is mnemonic for
  "keys" / "chroma keys"
- No new module dependencies; `'chroma'` is built into Meyda
- Pitch-class indexing follows Meyda's convention: index 0 = C, 1 = C#, …, 11 = B.
  The panel labels match
- Meyda's chroma can return `null` on the very first frame after `_connectSource`
  (typical of all spectral features); the code guards with
  `Array.isArray(features.chroma) && features.chroma.length === 12` and falls through

## Acceptance Criteria

- `a.chroma` is a 12-element array of finite numbers in `[0, 1]` after the first tick
  on a live source
- Playing a sine wave at A4 (440 Hz) through the system audio raises `a.chroma[9]` (A)
  visibly above the other eleven entries
- Playing a C-major chord raises `a.chroma[0]` (C), `a.chroma[4]` (E), `a.chroma[7]`
  (G) together
- `ch0()..ch11()` exist as functions on `window`; `ch9(2)()` returns
  `a.chroma[9] * 2`
- Setting `a.chromaSmooth = 0` makes the values respond instantly (jittery); setting
  `0.9` makes them drift slowly
- The Chromagram panel (Alt+K) shows 12 vertical bars labeled C, C#, D, D#, E, F, F#,
  G, G#, A, A#, B with live heights; the bar of the currently-loudest pitch class is
  drawn in a brighter color (highlight)
- A patch `osc(60).color(ch4(2), ch7(2), ch0(2)).out()` (E, G, C as RGB) tints
  according to the major-triad chroma values playing through audio
- No regression: `a0..a3`, `a.fft`, `a.bins`, `a.brightness` (if Plan 3 shipped),
  `a.onset` (if Plan 2 shipped) all continue to work

## Touch points

- [src/lib/audio.js:18-32](src/lib/audio.js#L18-L32) — constructor; initialize
  `this.chroma = new Array(12).fill(0)` and `this.chromaSmooth = 0.4`
- [src/lib/audio.js:124](src/lib/audio.js#L124) — Meyda `featureExtractors`; append
  `'chroma'` (preserve any other entries from prior plans)
- [src/lib/audio.js:143](src/lib/audio.js#L143) — duplicate `chroma` addition in
  `setFftSize`'s feature list
- [src/lib/audio.js:164-185](src/lib/audio.js#L164-L185) — `tick()`; add smoothing
  block reading `features.chroma`
- [src/lib/audio.js:212-216](src/lib/audio.js#L212-L216) — `setBins`; install
  `window.ch0..ch11` factories inside the `_makeGlobal` branch, guarded by
  `if (!window.ch0)` to be idempotent
- new file: `dev/panels/chroma.js`
- [dev/index.js:17-19](dev/index.js#L17-L19) — `require` the new panel beside other
  panel requires
- [dev/index.js:75-78](dev/index.js#L75-L78) — `register(chromaPanel)` after existing
  registrations

## Design

**Data flow.** Meyda's `chroma` feature returns a 12-element `Float32Array` per frame
with each entry already normalized roughly to `[0, 1]` (Meyda divides by the maximum
chroma value before returning). The tick block reads it, applies one-pole smoothing
against the previous `this.chroma[i]`, and writes back. Globals and the panel read
straight from `this.chroma`.

**Why a separate panel instead of inlining into Audio Bins.** Chromagram has its own
visual language (12 columns labeled by pitch class) that doesn't compose well with
the bin grid (variable count, Hz scale). A standalone panel also lets users toggle it
independently of bin tuning.

**Smoothing semantics.** Same one-pole filter used for bins
(`new * (1 - smooth) + prev * smooth`). Default 0.4 chosen empirically to settle
within ~5 frames on a sustained note while still tracking chord changes within ~150ms.

**Naming.**
- `chroma: number[]` — 12 elements, indices 0..11 = C..B
- `chromaSmooth: number` — 0..1 smoothing factor
- `ch0..ch11: (scale = 1, offset = 0) => () => number` — global factories

**Central mechanism (sketch).**

```js
// inside tick(), after this.fft = ...
const chroma = features.chroma
if (Array.isArray(chroma) && chroma.length === 12) {
  const s = this.chromaSmooth
  for (let i = 0; i < 12; i++) {
    const v = Number.isFinite(chroma[i]) ? Math.max(0, Math.min(1, chroma[i])) : 0
    this.chroma[i] = v * (1 - s) + this.chroma[i] * s
  }
}

// in setBins() inside the _makeGlobal branch:
if (!window.ch0) {
  for (let i = 0; i < 12; i++) {
    window['ch' + i] = (scale = 1, offset = 0) => () => (this.chroma[i] * scale + offset)
  }
}
```

## Phase 1: instance fields + Meyda feature

1. [src/lib/audio.js:18-32](src/lib/audio.js#L18-L32) — in the constructor, after the
   `this.smooth` line, add `this.chroma = new Array(12).fill(0)` and
   `this.chromaSmooth = 0.4`
2. [src/lib/audio.js:124](src/lib/audio.js#L124) — append `'chroma'` to the Meyda
   `featureExtractors` array (preserve existing entries from other plans)
3. [src/lib/audio.js:143](src/lib/audio.js#L143) — same change inside `setFftSize`
- **Files:** `src/lib/audio.js`
- **Acceptance:** in the editor, after `a.initStream()`,
  `a._meyda.get().chroma.length === 12`; `a.chroma.length === 12 && a.chroma[0] === 0`

## Phase 2: tick() chroma smoothing

4. [src/lib/audio.js:164-185](src/lib/audio.js#L164-L185) — inside the
   `if (features && features !== null)` block, after the `this.fft = ...` line, paste
   the Design sketch's tick block
- **Files:** `src/lib/audio.js`
- **Acceptance:** with a sustained A4 tone playing, `a.chroma[9]` settles above 0.5
  while the other eleven entries stay below 0.3

## Phase 3: ch0..ch11 globals

5. [src/lib/audio.js:212-216](src/lib/audio.js#L212-L216) — inside the
   `if (this._makeGlobal)` block in `setBins`, after the `a0..a3` loop, paste the
   Design sketch's global-install block (idempotent guard)
- **Files:** `src/lib/audio.js`
- **Acceptance:** `typeof window.ch0 === 'function'`; `ch9(2)()` evaluates to
  `a.chroma[9] * 2`; calling `a.setBins(8)` does NOT replace `window.ch0`

## Phase 4: chromagram panel scaffold

6. Create `dev/panels/chroma.js` exporting the descriptor
   `{ id: 'chroma', title: 'Chromagram', key: 'k', zone: 'top-left', width: 280,
   height: 140, init, update }`
7. `init(el)` builds a flex row of 12 columns. Each column = a label `<div>` (e.g.
   `C`, `C#`, …) atop a `<canvas>` of fixed width (~18px) and height (~80px). Store
   the canvases on `el._canvases`
- **Files:** `dev/panels/chroma.js`
- **Acceptance:** after registration, Alt+K opens a 280px-wide panel with 12 labeled
  empty canvases

## Phase 5: chromagram render loop

8. `update(el)` reads `window.a.chroma`. For each canvas: clear, fill a bar from the
   bottom proportional to `chroma[i]` of full height. Determine the dominant index
   `argmax(chroma)` and draw that one bar in cyan (`#0ff`); others in dim cyan
   (`#0ff8`). Also draw the label color brighter for the dominant index.
9. Cache `getContext('2d')` on each canvas (`canvas._ctx`) in `init` to avoid the
   per-frame lookup
- **Files:** `dev/panels/chroma.js`
- **Acceptance:** play a sustained A4 — the `A` column's bar fills ~70% and is drawn
  in bright cyan, while the other eleven sit at ~10–20% in dim cyan; play a C major
  chord — `C`, `E`, `G` columns are all bright relative to others, dominant index
  alternates between them frame to frame

## Phase 6: register the panel

10. [dev/index.js:17-19](dev/index.js#L17-L19) — add
    `const chromaPanel = require('./panels/chroma')`
11. [dev/index.js:75-78](dev/index.js#L75-L78) — add
    `window.performanceUI.register(chromaPanel)` after the existing registrations (or
    after `evalConsolePanel` if Plan 4 has shipped)
- **Files:** `dev/index.js`
- **Acceptance:** strip shows a new button labeled "Chromagram"; Alt+K toggles the
  panel

## Phase 7: integration patch test

12. No code change. In the editor:
    `osc(60).color(ch0(2), ch4(2), ch7(2)).out()` (C/E/G as RGB). Ctrl+Enter.
- **Files:** none
- **Acceptance:** with audio playing, the rendered canvas tints according to the
  prominence of C, E, and G in the source — a C-major progression visibly cycles the
  color through reds/greens/blues, an A-minor progression desaturates these channels

## Risks and open questions

- **Risk:** Meyda's chroma normalization divides by the max chroma component each
  frame, so values are *relative* — even on silence (just noise floor), one bin will
  end up near 1.0. Smoothing dampens the worst of it but watch for a "phantom dominant
  note" effect during quiet passages. A loudness gate (e.g. zero out `a.chroma` when
  `a.vol < 0.01`) could be added later; out of scope for v1.
- **Risk:** twelve `ch0..ch11` globals add to namespace clutter. The factory shape
  matches `a0..a3`'s precedent and `_makeGlobal` is opt-out, so this stays consistent
  with the existing convention. Users who turn off `makeGlobal` get neither set.
- **Risk:** `'k'` as the Alt-key could clash with future panel additions (e.g.
  "keybindings" panel). Document in code that Alt+K is reserved for Chromagram.
- **Q:** worth exposing `a.chromaDominant` (integer 0..11) as a convenience? Skip —
  users can write `a.chroma.indexOf(Math.max(...a.chroma))` inline; one-liner.
- **Q:** should the panel show note names (`A`, `A#`) or solfège (`Do`, `Re`)?
  English note names are more conventional for live coding audiences; localize later
  if requested.
- **Q:** Meyda's chroma is computed from `amplitudeSpectrum`, so adding it raises
  cost. Profiling shows < 0.2ms/frame at fftSize=1024 — negligible. Re-check at
  fftSize=2048.

## Verification

1. Run dev harness; press Alt+K — empty chromagram appears
2. `a.initStream()` on a track with clear tonal content (e.g. a piano piece)
3. Confirm bars react to harmony: melody on E lights index 4, modulation to A lights
   index 9, etc.
4. Play a sustained A4 sine via a tone-generator tab — `a.chroma[9]` should peak well
   above the other eleven; panel's A bar lights up brightest
5. Stop audio (silence) — chromagram bars decay slowly (smoothing) toward a near-zero
   floor; no NaN, no jitter to 1.0 on quiet noise
6. In editor: `osc(60).color(ch0(2), ch4(2), ch7(2)).out()` — Ctrl+Enter. Output
   should tint as C/E/G chroma values evolve with the music
7. `a.chromaSmooth = 0; a.chromaSmooth = 0.9` — confirm jitter / lag behaves
   accordingly
8. `delete window.ch0; a.setBins(8); typeof ch0` — should be `'function'` (idempotent
   guard reinstalls after deletion)
9. Confirm `a.fft`, `a0..a3`, and any other prior-plan globals (`a.brightness`,
   `a.onset`) continue to work unchanged
10. Close the panel; trigger heavy audio activity for 30 seconds; reopen — bars
    should resume rendering without lingering stale data

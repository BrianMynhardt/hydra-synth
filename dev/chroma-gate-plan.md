## Overview

Adds a loudness gate to the chroma smoothing path in `src/lib/audio.js` so that
`a.chroma[0..11]` decays toward zero during silence instead of latching onto a
"phantom dominant note." Meyda's chroma feature normalizes each frame against its own
maximum, so even on the noise floor one pitch class reads near 1.0. This patch gates
the smoothing *input* by the current loudness (`this.vol`) through a soft transfer
curve, and exposes the gate threshold as a live-tunable instance field
`a.chromaGate`. This closes the gap explicitly deferred as "out of scope for v1" in
the shipped chroma binding plan (`dev/chroma-binding-plan.md`).

## Constraints

- One file modified: `src/lib/audio.js`. No new files, no new dependencies.
- The gate is a per-instance mutable field `this.chromaGate`, mirroring how
  `this.chromaSmooth` is exposed — a plain field with no setter, tweakable as
  `a.chromaGate = 1.2` in the console without rebuilding.
- Use a *soft* gate, not a hard `this.vol < 1 ? 0 : 1` cutoff, to avoid popping when
  loudness hovers near the floor.
- One tunable knob only for v1: `chromaGate` is the threshold; the gate width is a
  hardcoded constant (4). Promote width to its own field only if calibration proves it
  necessary.
- The read path of `this.chroma` (the `ch0..ch11` globals and the Chromagram panel) is
  unchanged — those must continue to work.
- Harness finding F-005 lives in `setBins()` (uses implicit global `a` instead of
  `this`). It is adjacent to the audio code but OUT OF SCOPE for this patch — do not
  "tidy" it here. It needs its own dedicated PR.

## Acceptance Criteria

- After the patch, with no audio playing, all twelve `a.chroma[i]` values decay
  smoothly toward ~0 instead of one channel latching near 1.0.
- With audio playing, chroma values track harmony exactly as before the patch (no
  regression to the dominant-note behavior on live tonal content).
- `a.chromaGate` exists as a finite number on the Audio instance and is mutable at
  runtime; setting it higher raises the silence cutoff, lower lowers it.
- The transition across the threshold is gradual (soft), with no audible/visible pop in
  the Chromagram panel as audio fades in or out.
- `ch0()..ch11()` globals and the Chromagram panel continue to render correctly.

## Phase 1: gate the chroma smoothing input

1. `src/lib/audio.js` — constructor, immediately after the `this.chromaSmooth = 0.4`
   line (currently line 27): add `this.chromaGate = 0.5` with a short comment noting it
   is the silence cutoff in `a.vol` units.
2. `src/lib/audio.js` — `tick()`, inside the chroma block (currently the
   `if (Array.isArray(chroma) && chroma.length === 12)` body), after the
   `const s = this.chromaSmooth` line: add
   `const g = Math.min(1, Math.max(0, (this.vol - this.chromaGate) / 4))`.
3. `src/lib/audio.js` — `tick()`, the chroma write line (currently
   `this.chroma[i] = v * (1 - s) + this.chroma[i] * s`): change the input term `v` to
   `v * g`, yielding `this.chroma[i] = (v * g) * (1 - s) + this.chroma[i] * s`.

## Phase 2: calibrate and lock the default

4. No code change yet. Run the dev harness (`npm run dev`), call `a.initStream()` (or
   `a.initMic()`), and read `a.vol` while silent — record this as X.
5. Read `a.vol` again while representative audio is playing — record this as Y.
6. Set `a.chromaGate` in the console to approximately `X * 1.5`; confirm chroma decays
   to near-zero on silence and still tracks harmony when audio plays. Confirm the soft
   width (4) reasonably spans `(Y - X)`; if it clearly does not, note it as a candidate
   for a future `chromaGateWidth` field (do not add it now).
7. `src/lib/audio.js` — if the calibrated value differs materially from 0.5, update the
   default on the constructor line from Phase 1 to the calibrated value.

## Risks and Open Questions

- Calibration-dependent default: 0.5 is a guess; real loudness floors vary by source
  and device. Phase 2 must run before trusting the default.
- Width constant: the hardcoded 4 may be too wide or narrow for very dynamic sources.
  Flagged as the single open knob to promote to a field later if needed.
- F-005 proximity: the gate lives in `tick()`, not `setBins()`, so it is well clear of
  the implicit-global bug — but do not touch `setBins()` in this change.
- No regression risk to `ch0..ch11` or the Chromagram panel: the `this.chroma` read
  path is untouched; only the write/smoothing input changes.

## Verification

1. Run `npm run dev` and open the editor.
2. `a.initStream()` (or `a.initMic()`) on a source with clear tonal content.
3. Open the Chromagram panel (Alt+K). Confirm bars track harmony as before.
4. Stop/mute the audio: confirm all twelve bars decay smoothly toward zero with no
   single channel latching near full height, and no popping during the fade.
5. In the console, read `a.vol` silent (X) and playing (Y); set
   `a.chromaGate = X * 1.5` and re-verify steps 3-4.
6. Confirm `osc(60).color(ch0(2), ch4(2), ch7(2)).out()` still tints with the music and
   settles to dark on silence.
7. Confirm no NaN in `a.chroma` and that `a0..a3`, `a.fft`, `a.brightness`, `a.onset`
   are unaffected.

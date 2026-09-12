# bpm()/tempo() Global Factory + a.beatPhase

## Overview

Expose audio-derived tempo to live coders as a global signal factory and add a sawtooth phase ramp for tempo-synced motion. A factory `tempo(scale, offset)` returns a `() => value` function (mirroring the existing `a0()..a3()`, `br()`, and `ch0()..ch11()` factories) yielding the detected BPM. A new instance property `a.beatPhase` ramps 0→1 between beats, recomputed every `tick()` from elapsed time over the current beat interval. Live coders use `a.beatPhase` (or the optional `bp()` factory) to drive `rotate`/`scroll` in sync with the beat — a phase ramp, not just a tempo number, is what makes motion lock to the music.

## Constraints

- `bpm` is ALREADY a reserved global (default 30) defined at src/hydra-synth.js:58 and synced `window.bpm → synth.bpm` every frame by EvalSandbox.tick() (src/eval-sandbox.js:30-39). array-utils.js:68 reads it as `bpm / 60` for sequencing. Installing `window.bpm` as a function factory would overwrite the numeric global and break all array `.fast()` sequencing (NaN). The audio-tempo factory MUST use a different global name — this plan uses `tempo()`.
- Store detected tempo as an Audio instance property `this.bpm` (accessed as `a.bpm`) — namespaced, so no clash with the global `bpm`.
- Follow the exact factory-install convention in setBins() `_makeGlobal` block (src/lib/audio.js:292-304): guard with `if (!window.NAME)`, factory shape `(scale = 1, offset = 0) => () => (this.VALUE * scale + offset)`, arrow functions so `this` binds to the Audio instance.
- `beatPhase` is computed in tick() the same way `brightness` is (src/lib/audio.js:211-220) — a plain instance property updated each frame.
- Hard dependency on idea #1 (beat timing): requires `this._lastBeatTime` (ms) and a beat `interval` (ms). If idea #1 has not landed, this plan adds minimal timestamp/interval tracking into detectBeat() itself. Match idea #1's field names if it exists.
- Use a single, consistent time source in both detectBeat() and tick() — recommend `performance.now()`.
- Out of scope: audio-panel UI readout for BPM/phase, MIDI-clock sync, tap-tempo.
- Do not disturb open harness findings (see memory: F-001..F-007). F-005 concerns `makeGlobal:false`; the factories already use `this` via arrow functions, so they are unaffected.

## Acceptance Criteria

- `tempo` is a global function; `tempo()` returns a function, and calling it returns the current detected BPM (`a.bpm`).
- `tempo(scale, offset)` returns `a.bpm * scale + offset`.
- `a.beatPhase` is a number in [0, 1] that rises from 0 toward 1 between beats and resets toward 0 on each detected beat.
- `a.bpm` reflects a plausible tempo (e.g. 60–180) for music with a clear beat, and is 0 before any beat is detected.
- The existing numeric `bpm` global and array `.fast()` sequencing still work unchanged.
- No division-by-zero or `beatPhase > 1` drift before the first beat or during silence (defaults `beatPhase = 0`, `bpm = 0`).
- In `makeGlobal:false` mode the factories are not installed and nothing throws.

## Phase 1: Beat timing (dependency)

1. src/lib/audio.js constructor — add `this._lastBeatTime = null` and `this._beatInterval = 0` beside the existing beat fields, only if idea #1 has not already added equivalents.
2. src/lib/audio.js detectBeat() — when a beat fires, read `const now = performance.now()`; if `this._lastBeatTime != null` compute `const dt = now - this._lastBeatTime` and smooth it into `this._beatInterval` (e.g. exponential smoothing toward `dt`, ignoring implausible dt outside ~250–2000ms); then set `this._lastBeatTime = now`. Skip this task if idea #1 already records beat timing — reuse its fields instead.

## Phase 2: Tempo and phase values

1. src/lib/audio.js constructor — initialize `this.bpm = 0` and `this.beatPhase = 0` beside `this.brightness`.
2. src/lib/audio.js detectBeat() (or wherever `_beatInterval` is updated) — derive `this.bpm = this._beatInterval > 0 ? 60000 / this._beatInterval : 0`.
3. src/lib/audio.js tick() — after the brightness/onset blocks, compute beatPhase: `if (this._beatInterval > 0 && this._lastBeatTime != null) { const now = performance.now(); this.beatPhase = Math.max(0, Math.min(1, (now - this._lastBeatTime) / this._beatInterval)) }`. Use the same `performance.now()` source as detectBeat().

## Phase 3: Global factories

1. src/lib/audio.js setBins() `_makeGlobal` block — after the `window.br` install, add: `if (!window.tempo) { window.tempo = (scale = 1, offset = 0) => () => (this.bpm * scale + offset) }`.
2. src/lib/audio.js setBins() `_makeGlobal` block — add the phase factory for parity with `br()`: `if (!window.bp) { window.bp = (scale = 1, offset = 0) => () => (this.beatPhase * scale + offset) }`.

## Phase 4: Documentation

1. docs/IDEAS.md — mark this idea (bpm() factory + a.beatPhase) as implemented with a short status note pointing at src/lib/audio.js.
2. docs/API_REFERENCE.md — document `a.bpm`, `a.beatPhase`, `tempo(scale, offset)`, and `bp(scale, offset)`; explicitly note that the audio tempo is `tempo()`/`a.bpm` and is distinct from the existing numeric `bpm` sequencing global.

## Risks and Open Questions

- Naming: `bpm()` as requested collides with the reserved numeric `bpm` global and would break sequencing — resolved here by using `tempo()`. Confirm the rename is acceptable, or choose another non-reserved name.
- Dependency on idea #1: field names for beat timing must match idea #1's implementation; if #1 is not yet merged, Phase 1 owns those fields and idea #1 must later converge rather than duplicate.
- Time source consistency: detectBeat() and tick() must use the same clock; mixing `performance.now()` with `_context.currentTime*1000` would corrupt the phase. Recommend `performance.now()`.
- Edge cases: first beat (no prior timestamp), silence/long gaps (stale interval), and tempo doubling/halving from amplitude-based beat detection may make `a.bpm` jumpy — smoothing and a plausible-interval guard mitigate but do not eliminate this.
- `beatPhase` keeps climbing and clamps at 1 if no beat arrives (e.g. during a breakdown); this is acceptable sawtooth behavior but worth noting for users.

## Verification

- `npm test` (and `node validate.js` if present) to confirm no regressions.
- Run the dev harness (`npm start` / open dev/index.js), play music with a clear beat, and in devtools confirm: `a.bpm` settles to a plausible tempo, `a.beatPhase` oscillates 0→1, `typeof tempo === 'function'`, `typeof tempo() === 'function'`, and `tempo()()` returns `a.bpm`.
- Confirm `bpm = 120` still drives array `.fast()` sequencing (numeric global intact).
- Live-code test: `osc(20).rotate(0, () => a.beatPhase * 6.28).out()` rotates in sync with the beat.

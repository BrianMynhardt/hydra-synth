# Autocorrelation Tempo Tracker — Plan

## Overview
Add a second, independent tempo estimator to the `Audio` class that derives BPM from the periodicity of the onset/spectral-flux envelope rather than from the amplitude beat detector. It maintains a rolling history of the per-frame flux sum (an onset detection function), and periodically runs normalized autocorrelation over that history to find the lag of peak correlation — the dominant beat period. This is a v2 robustness upgrade that runs in parallel with the existing `detectBeat()` path and is exposed as new `bpmAuto` / `bpmAutoConfidence` properties, leaving the current `bpm`, `bpmConfidence`, and `beatPhase` untouched. It directly addresses the amplitude detector's tendency to alias fast tempos downward, but does so additively so the cheap path that already shipped is not disturbed.

## Constraints
- Edit only `src/lib/audio.js` (the `Audio` class). `audio.js` is graded C and is browser-only at runtime.
- Do not modify `detectBeat()`, `this.bpm`, `this.bpmConfidence`, or the `beatPhase` logic — the new estimator is purely additive and parallel.
- Do not disturb harness finding F-005 (logged in `harness/findings.md`) or the separately-diagnosed beat-hold refractory behavior in `detectBeat()`.
- Allocate the envelope buffer in the constructor, not in `setBins()`: the envelope is a scalar-per-frame signal and must be independent of `numBins` (which changes `flux[]` length).
- Reuse existing conventions: module-level `const` tuning values at top of file, `_`-prefixed private fields, the `performance.now()` clock already used by `detectBeat`/`beatPhase`, and the guarded `if (!window.x)` global-factory pattern in `setBins()`.
- Match the existing BPM clamp range (70–180) so the two estimators are comparable.
- Do not add any npm dependency; autocorrelation is hand-rolled.
- Out of scope: fusing/selecting between `bpm` and `bpmAuto`, octave-error correction beyond a basic guard, dev-panel readout wiring (separate plan), and any change to `src/` files other than `audio.js`.

## Acceptance Criteria
- `Audio` instances expose numeric `this.bpmAuto` (0 until enough envelope history accrues) and `this.bpmAutoConfidence` (0–1).
- A rolling flux-sum envelope buffer fills every `tick()` and the tempo routine runs on an interval (not every frame).
- For steady music, `bpmAuto` settles within the 70–180 clamp and tracks fast tempos (e.g. ~180 BPM) more accurately than the amplitude path's reading.
- `bpmAutoConfidence` rises for steady rhythmic input and falls for arrhythmic/silent input.
- No regression: `this.bpm`, `this.bpmConfidence`, `this.beatPhase`, onset, chroma, brightness, and bins all behave exactly as before.
- No new npm dependency; runs without throwing when audio is silent or `numBins` changes mid-stream.

## Phase 1: Buffer and state
1. In `src/lib/audio.js`, add module-level constants near the top of the file: `ENV_LEN` (~360, ≈6 s of frames), `TEMPO_EVERY` (~15 frames between analyses), `MIN_SAMPLES` (minimum filled samples before estimating, e.g. 120), `BPM_MIN` (70), `BPM_MAX` (180).
2. In the `Audio` constructor, beside `this.bpmConfidence`, add `this.bpmAuto = 0` and `this.bpmAutoConfidence = 0`.
3. In the constructor, allocate `this._env = new Float32Array(ENV_LEN)`, `this._envIdx = 0`, `this._envCount = 0`, `this._envDt = 16.7`, `this._envLastT = 0`, and `this._tempoCounter = 0`.

## Phase 2: Envelope capture in tick()
4. In `tick()`, after the flux loop completes (after the `this._prevSpectrum.set(spec)` block), compute `fluxSum` as the sum of `this.flux`.
5. In `tick()`, update the frame-interval EMA: from `performance.now()` and `this._envLastT`, compute `dt`, blend into `this._envDt` (skip the blend on the first sample), and store the new time.
6. In `tick()`, write `fluxSum` into `this._env` at `this._envIdx`, advance the ring index modulo `ENV_LEN`, and increment `this._envCount` (capped at `ENV_LEN`).
7. In `tick()`, gate the estimator: `if ((++this._tempoCounter % TEMPO_EVERY) === 0 && this._envCount >= MIN_SAMPLES) this._estimateTempo()`.

## Phase 3: Autocorrelation routine
8. Add a method `_estimateTempo()` to the `Audio` class.
9. In `_estimateTempo()`, copy the ring buffer into chronological order using `_envIdx`/`_envCount`, into a working array of length `n = Math.min(this._envCount, ENV_LEN)`.
10. In `_estimateTempo()`, compute the mean of the working array and subtract it from every sample (DC removal) so autocorrelation reflects periodicity, not loudness.
11. In `_estimateTempo()`, derive the lag search bounds from the measured sample rate: `lagMin = round(60000 / (BPM_MAX * this._envDt))`, `lagMax = round(60000 / (BPM_MIN * this._envDt))`, clamped to `[1, n-1]`.
12. In `_estimateTempo()`, for each lag in `[lagMin, lagMax]` compute the autocorrelation sum, normalize it by the zero-lag energy (sum of squares) to get a 0–1 score, and track the lag with the maximum score.
13. In `_estimateTempo()`, add a basic octave guard: if the best lag is short and a near-double lag has a comparable score, prefer the longer period (resolving the common half/double-tempo ambiguity); keep this conservative.
14. In `_estimateTempo()`, convert the chosen lag to BPM with `60000 / (lag * this._envDt)`, clamp to `[BPM_MIN, BPM_MAX]`, assign to `this.bpmAuto`, and assign the normalized peak score to `this.bpmAutoConfidence`. Guard against zero-energy (silent) windows by leaving values unchanged or zeroing confidence.

## Phase 4: Optional globals
15. In `setBins()`, inside the `this._makeGlobal` block following the existing `window.tempo` / `window.conf` factories, add guarded `window.tempoAuto` and `window.confAuto` factories mirroring the existing `(scale = 1, offset = 0) => () => (value * scale + offset)` shape. (Optional — include only if user wants user-facing globals now.)

## Risks and Open Questions
- Octave errors: autocorrelation peaks at 2x/0.5x the true period; the Phase 3 guard is basic and may need tuning or a comb-filter/harmonic-sum refinement to be fully trustworthy.
- Non-uniform raf timing: the `_envDt` EMA approximates sample spacing, but large frame-time variance, tab-blur, or pauses corrupt the window and skew lag→BPM conversion.
- DC removal and normalization are mandatory — without them the result is dominated by loudness and is meaningless; must be verified.
- Must not touch F-005 or the beat-hold refractory logic in `detectBeat()`; this tracker is the robustness answer to that bug but stays strictly additive.
- Open question: is `bpmAuto` informational only for v1, or will it feed a later fusion with `bpm`? Recommended: informational only now; fusion is a follow-up.
- Cost: autocorrelation over ~360 samples × ~40 lags every `TEMPO_EVERY` frames is cheap, but lowering `TEMPO_EVERY` toward 1 would waste cycles; keep it on an interval.

## Verification
- Run `npm run dev` and enable audio input.
- In the browser console, inspect `a.bpmAuto` and `a.bpmAutoConfidence` while playing music with a known tempo; confirm `bpmAuto` settles near the true tempo (within the 70–180 clamp) and tracks a ~180 BPM track more accurately than `a.bpm`.
- Confirm `a.bpmAutoConfidence` rises for steady beats and drops for silence/arrhythmic input.
- Confirm `a.bpm`, `a.bpmConfidence`, `a.beatPhase`, `a.onset`, `a.chroma`, and `a.bins` are unchanged in behavior.
- Toggle `numBins` (e.g. via re-init) and confirm no exception from the envelope path.
- Run `npm run harness:validate` to confirm no structural regression.

# Audio BPM from Inter-Beat Median — Implementation Plan

## Overview
Add a live `a.bpm` field to the `Audio` class that estimates tempo from the existing
beat detector. Each time `detectBeat()` registers a beat (where `onBeat()` already
fires), timestamp it, push the inter-beat interval into a fixed-size ring buffer, and
derive `bpm = 60000 / median(intervals)`. The result is smoothed with a one-pole filter
and clamped to a plausible musical range (70–180 BPM). This reuses the existing beat
event with zero new audio analysis and mirrors how plain tunable fields like
`chromaSmooth` and `brightnessSmooth` are exposed for live tuning.

## Constraints
- Edit only the `Audio` class constructor and `detectBeat()` in `src/lib/audio.js`.
- Do NOT touch `setBins()` — it holds active finding F-005 (uses implicit global `a`
  instead of `this`); adding a global modulation source there is out of scope.
- Reuse the existing one-pole smoothing idiom: `v*(1-s) + prev*s` (see brightness and
  chroma blends already in `tick()`).
- No new Meyda feature extractors; computation happens only on beat events.
- No new dependencies; `performance.now()` is already used elsewhere in the dev panels.
- Match existing code style in audio.js (camelCase, sparse comments, no doc-block headers).
- Out of scope: exposing a `bpm()` modulation global, BPM decay/reset on silence, and
  any dev-panel readout (the panel readout is an optional follow-up, see Phase 2).

## Acceptance Criteria
- `a.bpm` exists and is `0` before enough beats are observed.
- After ≥3 inter-beat intervals on steady rhythmic input, `a.bpm` reports a value
  within `[70, 180]`.
- The value is smoothed (does not jump instantly to each raw estimate) via
  `a.bpmSmooth`, and `a.bpmSmooth` is adjustable at runtime.
- No per-frame cost added: computation runs only inside the beat branch of
  `detectBeat()`.
- Existing beat detection, `isBeat`, and `onBeat()` behavior are unchanged.

## Phase 1: Core BPM estimation in Audio
1. In `src/lib/audio.js` constructor, near the `this.isBeat = false` line (~line 29),
   add `this.bpm = 0`.
2. In the same block, add `this.bpmSmooth = 0.6` (one-pole smoothing coefficient,
   tunable at runtime).
3. In the same block, add `this._beatTimes = []` (ring buffer of recent inter-beat
   intervals in ms) and `this._lastBeatTime = 0`.
4. In `detectBeat()`, inside the beat branch (after `this.onBeat()`), capture
   `const now = performance.now()`; if `this._lastBeatTime` is non-zero, push
   `now - this._lastBeatTime` into `this._beatTimes` and trim the buffer to the last 8
   entries; then set `this._lastBeatTime = now`.
5. In the same branch, when `this._beatTimes.length >= 3`: copy and sort the buffer
   ascending, take the median (middle element, or average of the two middle elements
   for even length), compute `raw = 60000 / median`, clamp `raw` to `[70, 180]`, then
   set `this.bpm = this.bpm === 0 ? raw : raw * (1 - this.bpmSmooth) + this.bpm * this.bpmSmooth`
   so the first published value seeds directly instead of ramping from zero.

## Phase 2: Optional dev-panel readout
1. In `dev/panels/audio.js`, mirror the `brt:` title-bar span: add a `bpm:` span in
   `init()` and update it in `update()` from `window.a.bpm` (e.g.
   `'bpm: ' + Math.round(window.a.bpm)`). Only do this phase if a visible readout is
   wanted; it is not required for the feature itself.

## Risks and Open Questions
- `detectBeat()` fires on sustained loudness rather than strictly musical beats, so the
  estimate is noisy on non-percussive input; median + clamp mitigate but do not fully
  fix this.
- BPM stays latched at its last value when beats stop (no decay/reset). Acceptable for
  live tuning; revisit only if it proves confusing.
- Whether to later expose a `bpm()` modulation global (like `br`/`ch0`) is deferred —
  doing so would require touching `setBins()`, which carries finding F-005.
- No automated test framework exists; verification is manual.

## Verification
- `npm run dev`, enable mic input, play steady rhythmic audio, and in the console check
  that `a.bpm` settles within `[70, 180]` and tracks tempo changes after a few beats.
- Confirm `a.bpm` starts at `0` and only publishes after ≥3 inter-beat intervals.
- Adjust `a.bpmSmooth` at the console and confirm responsiveness changes.
- If Phase 2 is implemented, confirm the `bpm:` readout appears in the Audio panel
  title bar and updates live.

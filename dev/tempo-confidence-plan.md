# Tempo Confidence / Lock (a.bpmConfidence) — Implementation Plan

## Overview
Add a `a.bpmConfidence` value in the range 0–1 derived from the variance of the inter-beat
intervals already collected in the `_beatTimes` ring buffer used for BPM estimation. Low interval
variance maps to high confidence. Use that confidence to make the existing BPM smoothing
adaptive so that sparse or syncopated passages (high variance → low confidence) freeze the last
confidently-detected tempo instead of dragging it around. This is a small math add-on that makes
the amplitude-based estimator usable on real, non-four-on-the-floor material, and it surfaces a
new `conf()` global mirroring the existing `tempo()` / `bp()` helpers.

## Constraints
- All changes live in `src/lib/audio.js` (the `Audio` class) plus a docs update; no new
  dependencies, no new buffers — reuse the existing `this._beatTimes` ring buffer.
- Compute confidence inside the existing `detectBeat()` branch that already requires
  `this._beatTimes.length >= 3`; do not add a separate accumulation path.
- Global registration must stay inside `setBins()`, guarded by `this._makeGlobal` and the
  per-name `!window.<name>` guard, and must use `this.`-scoped closures (resolved finding F-005 —
  never reference the implicit global `a`).
- Match the existing closure signature `(scale = 1, offset = 0) => () => (value * scale + offset)`
  used by `tempo`, `bp`, `br`, and `ch*`.
- Keep the BPM cold-start behavior (`this.bpm === 0 ? raw : ...`) intact.
- Out of scope: changing the median-based raw BPM derivation, the beat-detection threshold logic,
  the 70–180 BPM clamp, or the dev panel (it already reads `window.a.bpmConfidence`).
- Do not touch or "fix as a side effect" any active harness finding (F-001 through F-007).

## Acceptance Criteria
- `a.bpmConfidence` exists as a numeric property, initialized to 0, and stays within 0–1.
- After at least three detected beats, `a.bpmConfidence` rises toward 1 on steady, evenly-spaced
  beats and falls toward 0 on erratic / syncopated beat spacing.
- When confidence is low, the reported `a.bpm` changes little between beats (frozen); when
  confidence is high, `a.bpm` tracks new estimates at the existing responsiveness.
- A `conf()` global (when `makeGlobal` is true) returns the smoothed confidence, supports the
  standard `(scale, offset)` arguments, and is usable in a hydra sketch.
- The dev audio panel shows the confidence value in parentheses next to the BPM readout (already
  wired) once the source property is present.
- `docs/API_REFERENCE.md` documents `a.bpmConfidence` and the `conf()` global.

## Phase 1: Confidence computation and adaptive lock
1. In `src/lib/audio.js`, constructor (near `this.bpm = 0`): add `this.bpmConfidence = 0`.
2. In `src/lib/audio.js`, `detectBeat()`, inside the existing `if (this._beatTimes.length >= 3)`
   block: compute `mean` of `this._beatTimes`, then the standard deviation `stddev`, then the
   coefficient of variation `cv = stddev / mean`.
3. In the same block: set `this.bpmConfidence = Math.max(0, Math.min(1, 1 - cv / 0.5))` (the
   `0.5` is the `cvMax` tuning constant — declare it as a local `const` for clarity).
4. In the same block: replace the fixed-`bpmSmooth` blend with a confidence-weighted retain
   weight — `const wOld = 1 - this.bpmConfidence * (1 - this.bpmSmooth)` — and update
   `this.bpm = this.bpm === 0 ? raw : raw * (1 - wOld) + this.bpm * wOld`.

## Phase 2: Global exposure
5. In `src/lib/audio.js`, `setBins()`, immediately after the `window.bp` registration block: add a
   `if (!window.conf)` guard registering
   `window.conf = (scale = 1, offset = 0) => () => (this.bpmConfidence * scale + offset)`.

## Phase 3: Documentation
6. In `docs/API_REFERENCE.md`: document the `a.bpmConfidence` property (0–1, variance-derived,
   drives adaptive BPM lock) and the `conf()` global, placed alongside the existing `tempo()` /
   `bp()` entries.

## Risks and Open Questions
- The `cvMax` constant (0.5) and the linear confidence→smoothing mapping are heuristics that may
  need tuning against real audio; expose as a local const so it is easy to adjust.
- Global name `conf` is generic and could collide with user variables; alternatives are `tconf`
  or `bpmc`. Confirm the preferred name before finalizing.
- The idea text phrases this as "freeze when confidence is high," but the drift actually comes
  from low-confidence (syncopated) windows; the confidence-weighted-smoothing approach freezes on
  low current-window confidence, which yields the same observable outcome (a confidently-found
  tempo is held). Confirm this reading is acceptable.
- No overlap with active harness findings (F-001 through F-007); step 5 must preserve the
  `this.`-scoped closure form per resolved finding F-005.

## Verification
- Run the dev server: `npm run dev`.
- Open the audio dev panel; with steady rhythmic input the BPM readout should show a confidence
  near 1.00 in parentheses and a stable BPM number; with sparse/irregular input the confidence
  should drop and the BPM number should stop drifting.
- In a sketch, confirm `conf()` resolves: e.g. `osc(10).rotate(0, conf(0.5)).out()` reacts to the
  confidence value, and `a.bpmConfidence` logged to the console stays within 0–1.

# Plan Queue

Ranked top-5 unimplemented IDEAS.md entries, ordered by usefulness.
Each invocation of the planning agent authors one plan, then stops.

## Ranking rationale

Weighted primarily on **performer impact + reach** for a live visual set: audio is the
performer's main expressive input, so foundational audio-binding ideas (#6, #7, #9, #8)
dominate because they unlock new vocabulary rather than polish existing surfaces.
**Leverage** breaks ties — Narrow Bandpass Bins (#7) goes first because Per-Band Onset
(#6) compounds on top of it. **Effort-to-value** lifts Spectral Centroid (#9) above
Chroma (#8) since it's a single Meyda feature that immediately enables timbral color
mapping. Eval Console (#15) is the one non-audio inclusion: silent errors mid-set are a
universal pain point and the fix is contained. Skipped: #10 (complex, depends on #6/#7),
#11/#13/#14/#16 (polish/discoverability — useful but lower reach), #3 (situational on MIDI
gear), #4 (premature until more standalone panels land), #12 (debug aid, not expressive).

## Queue

- [x] 1. **Narrow Bandpass Bins** (IDEAS.md #7) — plan file: `dev/narrow-bandpass-bins-plan.md` — done 2026-05-30
      Why ranked here: foundational change to audio binning that makes every downstream audio idea (onset, learn, chroma-tuned bins) precise instead of coarse.
- [x] 2. **Per-Band Onset Detection** (IDEAS.md #6) — plan file: `dev/per-band-onset-plan.md` — done 2026-05-31
      Why ranked here: paired with Hz-range bins this gives instrument-level triggers (kick/snare/hat) with zero MIDI gear — the single biggest expressive unlock on the list.
- [x] 3. **Spectral Centroid** (IDEAS.md #9) — plan file: `dev/spectral-centroid-plan.md` — done 2026-05-31
      Why ranked here: one Meyda feature, one normalization, one new global — best effort-to-value ratio and immediately useful for timbral color/crossfade mapping.
- [x] 4. **Eval Console Panel** (IDEAS.md #15) — plan file: `dev/eval-console-plan.md` — done 2026-05-31
      Why ranked here: typos during a set currently fail silently unless devtools are open; fixing this removes a recurring flow-breaker for every performer.
- [x] 5. **Chroma Binding** (IDEAS.md #8) — plan file: `dev/chroma-binding-plan.md` — done 2026-05-31
      Why ranked here: adds harmonic/pitch awareness — a genuinely new expressive axis no FFT-bin approach can deliver, and a clean standalone Meyda extension.

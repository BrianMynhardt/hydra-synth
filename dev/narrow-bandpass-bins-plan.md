## Overview

Lets performers define audio bins by exact Hz range instead of equal slices of Meyda's
Bark-scale loudness array — e.g. `a.setBinRange(0, 40, 100)` to tune bin 0 to a kick, or
`a.setBinRange(1, 180, 300)` for a snare. The change extends `Meyda` to also extract
`amplitudeSpectrum` (the raw FFT magnitude vector), adds optional `minHz`/`maxHz` to each
per-bin settings entry, and branches the bin-computation step in `tick()` so a bin with a
range integrates `amplitudeSpectrum` indices over `[k_min..k_max]` instead of slicing
`loudness.specific`. Bins without a range fall through to the existing equal-slice
behavior, so existing demos, the `a0..a3` globals, and the `fft`/`cutoff`/`scale` plumbing
remain untouched. The Audio Inspector panel gains a small "hz" row that displays each
bin's active range (or "—" when in default mode) so the change is observable in `dev/`.

Pairs with IDEAS.md #6 (Per-Band Onset Detection) — narrow Hz bins are the foundation that
makes per-band spectral flux instrument-specific instead of band-of-octaves-specific.

## Constraints

- Only `src/lib/audio.js` and `dev/panels/audio.js` are modified — no other source files
- `loudness` must remain in the Meyda feature list; existing equal-slice path is preserved
  for any bin where `settings[i].minHz == null` (default)
- `a0..a3` and `a.fft[]` consumers must keep working without code changes — the change is
  upstream of `fft` normalization
- No new module dependencies (Meyda already extracted, `amplitudeSpectrum` is built-in)
- `setBinRange` validates: index in `[0, bins.length)`, `minHz < maxHz`, both finite numbers
- Hz→FFT-index conversion uses live `this._context.sampleRate` and `this._fftSize` so it
  remains correct after `setFftSize(n)` re-creates the analyzer
- `setBins(n)` still resets all settings (pre-existing behavior); Hz ranges are lost on
  bin-count change — documented, not worked around
- F-005 (`window.a` global) and the existing `setBins` global-binding loop must not be
  disturbed

## Acceptance Criteria

- `a.setBinRange(0, 40, 100)` in the editor reroutes bin 0 to the 40–100 Hz range; on a
  kick-heavy source, `bins[0]` spikes on each kick and is near-silent on snare/hat
- `a.setBinRange(1, 180, 300)` likewise responds to snare body without firing on kicks
- Calling `a.setBinRange(0, null, null)` (or `a.settings[0].minHz = null`) restores the
  equal-slice default behavior for bin 0
- Throws a clear error on invalid args (`setBinRange(-1, ...)`, `setBinRange(0, 200, 100)`,
  `setBinRange(0, 'x', 100)`)
- The Audio Bins panel shows a new "hz" row beneath "scl" — cells read e.g. `40–100` for
  ranged bins and `—` for unranged
- `a.setFftSize(2048)` after a `setBinRange` keeps the bin tracking the same Hz window
  (i.e. the panel "hz" cell still shows `40–100` and `bins[0]` still spikes on kicks)
- `a0()` / `a.fft[0]` keep returning sensible values for a ranged bin once cutoff/scale
  are auto-tuned (via the panel's existing double-click → "listening…" pass)
- No regression: a fresh page load with no `setBinRange` calls behaves identically to the
  current `loudness.specific` equal-slice path (verified by eye in the panel)

## Touch points

- [src/lib/audio.js:120-125](src/lib/audio.js#L120-L125) — `Meyda.createMeydaAnalyzer`
  `featureExtractors` array; add `'amplitudeSpectrum'`
- [src/lib/audio.js:139-145](src/lib/audio.js#L139-L145) — duplicate feature list in
  `setFftSize`; add `'amplitudeSpectrum'`
- [src/lib/audio.js:164-185](src/lib/audio.js#L164-L185) — `tick()`; branch the first
  `.map` body on `settings[i].minHz`
- [src/lib/audio.js:203-217](src/lib/audio.js#L203-L217) — `setBins`; add `minHz: null`,
  `maxHz: null` to each settings entry
- [src/lib/audio.js:217-218](src/lib/audio.js#L217-L218) — insert new `setBinRange`
  method after `setBins`, before `setScale`
- [dev/panels/audio.js:90-95](dev/panels/audio.js#L90-L95) — stat-row descriptor array;
  add `{ label: 'hz', color: '#888', prop: null }` entry
- [dev/panels/audio.js:251-256](dev/panels/audio.js#L251-L256) — `update()` per-bin cell
  population; write Hz range into the new row's cell (`cells[4]`)
- [dev/panels/audio.js:292-301](dev/panels/audio.js#L292-L301) — module.exports `height`;
  bump from 160 → 175 to accommodate the extra ~14px row

## Design

**Data flow.** `_connectSource` (or `setFftSize`) registers `amplitudeSpectrum` alongside
`loudness`. Every `tick()`, `features.amplitudeSpectrum` is a `Float32Array` of length
`fftSize/2`; each entry `k` covers a band centered on `k * sampleRate / fftSize` Hz with
width `sampleRate / fftSize` Hz. For a bin with `minHz`/`maxHz` set, the new code
integrates that array over `[kMin..kMax]` where `kMin = floor(minHz / binHz)` and
`kMax = ceil(maxHz / binHz)`. The summed value replaces the `loudness.specific` slice
sum, then flows through the existing smoothing and `fft` (cutoff/scale) normalization
unchanged.

**Why amplitude-spectrum integration (not Bark sub-band selection).** Meyda's
`loudness.specific` is a 24-element Bark-scaled vector — perceptually motivated but with
fixed band edges (e.g. ~100, ~200, ~300 Hz boundaries). True instrument tuning needs
narrow user-defined Hz windows (e.g. 50–80 Hz for kick fundamental). Direct FFT-magnitude
integration gives that, at the cost that magnitudes are on a different (smaller) scale
than `loudness.specific` sums — handled by re-running the panel's auto-tune to update
`cutoff`/`scale`.

**Naming.**
- Per-bin field names: `minHz`, `maxHz` (sentinel `null` ⇒ "no range, use loudness slice")
- New method: `setBinRange(index, minHz, maxHz)`
- "Clear range" form: `setBinRange(index, null, null)` (explicit) — also writable directly
  on `a.settings[i]`

**Central mechanism (sketch).**

```js
// new method, after setBins
setBinRange (index, minHz, maxHz) {
  if (!Number.isInteger(index) || index < 0 || index >= this.settings.length) {
    throw new RangeError(`bin index ${index} out of range [0, ${this.settings.length})`)
  }
  if (minHz === null && maxHz === null) {
    this.settings[index].minHz = null
    this.settings[index].maxHz = null
    return
  }
  if (!Number.isFinite(minHz) || !Number.isFinite(maxHz) || minHz >= maxHz) {
    throw new TypeError(`invalid Hz range: ${minHz}..${maxHz}`)
  }
  this.settings[index].minHz = minHz
  this.settings[index].maxHz = maxHz
}

// inside tick(), replacing the first .map body
const s = this.settings[index]
if (s.minHz != null && features.amplitudeSpectrum && this._context) {
  const spec = features.amplitudeSpectrum
  const binHz = this._context.sampleRate / this._fftSize
  const kMin = Math.max(0, Math.floor(s.minHz / binHz))
  const kMax = Math.min(spec.length - 1, Math.ceil(s.maxHz / binHz))
  let sum = 0
  for (let k = kMin; k <= kMax; k++) sum += spec[k]
  return sum
}
return features.loudness.specific.slice(index * spacing, (index + 1) * spacing).reduce(reducer)
```

## Phase 1: Meyda feature list adds amplitudeSpectrum

1. [src/lib/audio.js:124](src/lib/audio.js#L124) — change `featureExtractors: ['loudness']`
   to `featureExtractors: ['loudness', 'amplitudeSpectrum']`
2. [src/lib/audio.js:143](src/lib/audio.js#L143) — same change inside `setFftSize`'s
   `createMeydaAnalyzer` call
- **Files:** `src/lib/audio.js`
- **Acceptance:** in the dev/ editor, after calling `a.initStream()`, evaluate
  `a._meyda.get().amplitudeSpectrum.length` and confirm it returns `fftSize / 2` (512 by
  default)

## Phase 2: per-bin Hz fields in settings

3. [src/lib/audio.js:207-211](src/lib/audio.js#L207-L211) — extend the settings-entry
   factory inside `setBins` to also include `minHz: null` and `maxHz: null`
- **Files:** `src/lib/audio.js`
- **Acceptance:** in the editor, `a.settings[0].minHz === null && a.settings[0].maxHz === null`

## Phase 3: setBinRange method with validation

4. [src/lib/audio.js:217-218](src/lib/audio.js#L217-L218) — insert the `setBinRange`
   method block (from the Design sketch) between `setBins` and `setScale`
- **Files:** `src/lib/audio.js`
- **Acceptance:** in the editor, `a.setBinRange(0, 40, 100)` succeeds and
  `a.settings[0].minHz === 40`; `a.setBinRange(-1, 0, 100)` throws RangeError;
  `a.setBinRange(0, 200, 100)` throws TypeError

## Phase 4: tick() branches on Hz range

5. [src/lib/audio.js:174-176](src/lib/audio.js#L174-L176) — rewrite the body of the first
   `.map` in `tick()` to branch on `settings[index].minHz`: if non-null and
   `features.amplitudeSpectrum` is present, integrate the spectrum over `[kMin..kMax]` and
   return that sum; otherwise fall through to the existing loudness.specific slice/reduce
- **Files:** `src/lib/audio.js`
- **Acceptance:** with audio playing through `initStream`, before `setBinRange`
  `bins[0]` looks the same as before this PR; after `a.setBinRange(0, 40, 100)`,
  `bins[0]` visibly spikes on kicks and is quiet otherwise (verify in the panel's bar
  canvas — needs auto-tune re-run for the cutoff/scale to settle)

## Phase 5: Audio panel exposes the active Hz range

6. [dev/panels/audio.js:90-95](dev/panels/audio.js#L90-L95) — extend the stat-row
   descriptor array with a fifth entry: `{ label: 'hz', color: '#888', prop: null }`. The
   inner row-building loop already handles `prop: null` cells (non-scrubable, plain text)
7. [dev/panels/audio.js:59](dev/panels/audio.js#L59) — change `rows = Array.from(...,
   () => [null, null, null, null])` to a 5-slot array (`Array(5).fill(null)`) so the new
   `si === 4` index has a slot
8. [dev/panels/audio.js:251-256](dev/panels/audio.js#L251-L256) — in `update()`'s per-bin
   loop, after writing `cells[3]` set `cells[4].textContent = settings[i].minHz != null
   ? settings[i].minHz + '–' + settings[i].maxHz : '—'`
9. [dev/panels/audio.js:298](dev/panels/audio.js#L298) — bump `height: 160` to
   `height: 175` to accommodate the new row
- **Files:** `dev/panels/audio.js`
- **Acceptance:** open the Audio Bins panel (Alt+A) — a new "hz" row is visible under
  "scl" and reads `—` for every bin. After `a.setBinRange(0, 40, 100)`, the bin-0 "hz"
  cell shows `40–100`. The panel does not visibly clip.

## Phase 6: Survive setFftSize

10. Sanity check (no code change expected): the Meyda re-creation inside `setFftSize`
    [src/lib/audio.js:138-145](src/lib/audio.js#L138-L145) already preserves the analyzer
    instance's feature list once Phase 1 lands. `this.settings` is not reset by
    `setFftSize`, so existing Hz ranges remain on the settings entries. The Hz→k mapping
    in `tick()` reads `this._fftSize` live, so the integration window auto-adjusts.
- **Files:** none
- **Acceptance:** with `a.setBinRange(0, 40, 100)` active and kicks audible, evaluate
  `a.setFftSize(2048)` in the editor; bin 0 keeps spiking on kicks and the panel "hz"
  cell still shows `40–100`

## Risks and open questions

- **Risk:** `amplitudeSpectrum` magnitudes are on a much smaller scale than
  `loudness.specific` slice sums. A ranged bin's raw value will look tiny (e.g. 0.05)
  next to neighbouring un-ranged bins (e.g. 2–8), which makes the auto-tune step
  (`startCapture` in [dev/panels/audio.js:161-172](dev/panels/audio.js#L161-L172))
  effectively mandatory after `setBinRange`. The double-click-to-tune affordance already
  handles per-bin re-tuning — call this out in any docs/snippet that uses `setBinRange`.
- **Risk:** when `kMax === kMin` (very narrow range or low fftSize), the sum is a single
  FFT bin and very noisy. The plan does not add extra smoothing — users can raise the
  per-bin `smooth` setting from the panel if needed.
- **Risk:** `setBins(n)` resets `this.settings`, dropping all `minHz`/`maxHz`. This is
  consistent with existing behavior (it also drops user-set cutoff/scale) but worth
  mentioning so a future "preset save" feature accounts for it.
- **Q:** should `setBinRange` also accept a single object form
  (`setBinRange(0, { minHz: 40, maxHz: 100 })`) for ergonomics in saved snippets? Default:
  no — keep one signature, document in Phase 7 of a future plan if pain shows up.
- **Q:** should the panel allow scrubbing `minHz`/`maxHz` directly on the new row? Out of
  scope here; would require a custom drag handler distinct from `cutoff`/`scale` because
  the values are paired and need separate min/max behavior. File as a follow-up if
  performers ask for it.
- **Q:** `features.amplitudeSpectrum` could in principle be absent on the first frame
  after `_connectSource` because Meyda needs one buffer to fill. The branch `if
  (features.amplitudeSpectrum && ...)` falls through to the loudness path in that case,
  which is safe — a one-frame fallback is invisible.

## Verification

1. Run the dev harness (`npm run dev` or open `dev/index.html` per repo convention)
2. Press Alt+A to show the Audio Bins panel; confirm the new "hz" row exists and shows
   `—` for every bin (baseline)
3. In the editor, run `a.initStream()` (system audio) or `a.initMic()` and play a track
   with a clear kick + snare
4. Confirm bins behave as they did before this PR (visual sanity check against `git
   stash` baseline if needed)
5. In the editor, run `a.setBinRange(0, 40, 100); a.setBinRange(1, 180, 300)` — the panel
   "hz" cells under bins 0 and 1 update to `40–100` and `180–300`
6. Double-click bin 0's bar canvas to auto-tune; wait for "listening…" → "auto-tune".
   Repeat for bin 1
7. Watch the bars: bin 0 should pulse on kicks and stay low between them; bin 1 should
   pulse on snares without firing on kicks. The bin-2/3 columns (still equal-slice) act
   as a control — they react to broad audio movement
8. Sanity: evaluate `a0()` in the editor (it logs nothing but returns a function);
   confirm `osc(60, 0.1, a0(20))` in the patch makes osc speed visibly track kicks
9. Switch FFT size: `a.setFftSize(2048)` — bin 0 keeps tracking kicks; panel "hz" still
   reads `40–100`
10. Clear: `a.setBinRange(0, null, null)` — panel cell returns to `—`; behavior reverts
    to equal-slice

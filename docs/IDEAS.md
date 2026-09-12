# Ideas

A running log of feature ideas and experiments for hydra-synth. Each idea includes a rationale and a starting point for implementation.

---

## Performance Space (`dev/`)

_Goal: transform the `dev/` folder into a first-class live performance environment with contextual tooling visible while the editor is open._

### 1. History Panel ✅ Implemented

**Status:** Done — [dev/panels/history.js](dev/panels/history.js), wired in [dev/index.js](dev/index.js). Adds localStorage persistence beyond the original spec.

An audit log of every Ctrl+Enter eval during a session — timestamped, scrollable, click-to-restore.

- **Why:** Live coding means iterating fast and often losing a good patch. History makes the session recoverable without breaking flow.
- **Where to start:** Wrap the eval block in [dev/index.js:117-123](dev/index.js#L117-L123) to push each run to a `history[]` array; render as a fixed overlay panel.
- **Details:** Timestamp + first 60 chars of script + restore button. Cap at ~50 entries per session; no persistence needed.

---

### 2. Audio Inspector Panel ✅ Implemented

**Status:** Done — [dev/panels/audio.js](dev/panels/audio.js). Per-bin bar visualizer with peak hold, scrubable cutoff/scale, dynamic bin count.

Expand the existing audio canvas widget into a proper bin viewer showing bar height, raw `bins[i]`, normalized `fft[i]`, and per-bin `cutoff`/`scale` as text labels.

- **Why:** Tuning audio reactivity live requires knowing the actual values — the current tiny canvas shows shape but not numbers.
- **Where to start:** Extend `Audio.draw()` in [src/lib/audio.js:242-260](src/lib/audio.js#L242-L260); widen the canvas and add per-bin labels. Toggle with a key (e.g. `A`) in the existing keydown handler.
- **Details:** Show `bins[i]` (raw), `fft[i]` (normalized 0–1), and horizontal lines for cutoff and scale per bin.

---

### 3. MIDI Live Monitor

A small overlay showing the current value of every active knob and pad trigger in real time.

- **Why:** Knowing which MIDI value maps to which visual parameter is guesswork without a live readout.
- **Where to start:** `MidiManager.knob(i)` returns live values; pads expose `onTrigger` ([src/lib/midi-manager.js:47-58](src/lib/midi-manager.js#L47-L58)). Render a grid of index → value, updated each frame via the existing `update` loop.

---

### 4. Unified Tool HUD ⚠️ Partial

**Status:** Partial — [dev/performance-ui.js](dev/performance-ui.js) provides the panel registry, Alt+key toggles, and a top-right button strip (Escape-toggled). The "vertical tab strip on the left edge with slide-out panels" layout is not built; panels are floating overlays zoned to the four corners.

A floating vertical tab strip (History | Audio | MIDI | Stats) on the left edge. Clicking a tab slides out its panel without covering the bottom editor.

- **Why:** As individual tool panels multiply, a shared container keeps the UI coherent and prevents overlap with the editor.
- **Where to start:** The editor is `position: fixed; bottom: 0; zIndex: 9999` ([dev/index.js:66-81](dev/index.js#L66-L81)). The HUD sits on the left at a lower z-index. Each of Ideas 1–3 becomes a tab.
- **Note:** Implement after at least two standalone panels exist — premature abstraction otherwise.

---

### 5. Snippet Bank ✅ Implemented

**Status:** Done — [dev/panels/snippets.js](dev/panels/snippets.js). Alt+0-9 to recall, Alt+Shift+0-9 to save, persisted to localStorage.

Named patch slots (0–9) bound to `Alt+0..9` — save the current editor content to a slot, recall it instantly.

- **Why:** Performers need to switch between prepared patches without searching through history.
- **Where to start:** Same keydown handler as Escape/Ctrl+Enter in [dev/index.js:99-141](dev/index.js#L99-L141). Store in `localStorage` for persistence across page reloads.
- **Pairs with:** History Panel (history = passive recall; snippets = intentional saves).

---

---

## Sound-Specific Audio Binding

_Goal: let users bind visual parameters to specific instruments or sounds (kick, snare, synth lead) rather than just coarse frequency bands._

**Background:** Hydra currently exposes 4 frequency bins (`a.fft[0..3]`) and a global beat flag (`a.isBeat`). Other tools like TouchDesigner and Resolume achieve sound-specific binding through per-band onset detection, timbral analysis (MFCC/chroma), and narrow bandpass filtering. Meyda (already installed) supports all of this — only `'loudness'` is currently extracted in [src/lib/audio.js:124](src/lib/audio.js#L124).

---

### 6. Per-Band Onset Detection (`a.onset[]`) ✅ Implemented

**Status:** Done — [src/lib/audio.js](src/lib/audio.js), [dev/panels/audio.js](dev/panels/audio.js). Exposes `a.flux[i]` (raw rectified spectral flux) and `a.onset[i]` (rising-edge boolean with refractory cooldown). Per-bin `fluxThreshold` (default 0.1) is scrubable via a new `thr` row in the Audio Bins panel; `a.setOnsetThreshold(i, value)` is the programmatic setter. Bar canvases flash a white strip when an onset fires.

Adds `a.onset[0..n]` boolean signals that fire when a sound *attacks* within a specific frequency band — not just when it's loud.

- **Why:** Beat detection fires on overall amplitude. Onset fires on *change* — a kick, snare, and hi-hat each leave distinct onset signatures in different frequency ranges. This is how Resolume's audio-to-MIDI works conceptually.
- **How:** Spectral flux measures frame-to-frame magnitude difference in a band. A threshold crossing = onset. Per-bin spectral flux is just `sum(max(0, |X[k]| - |X_prev[k]|))` over the bin's FFT range.
- **Where to start:** [src/lib/audio.js:124](src/lib/audio.js#L124) — add `'spectralFlux'` to Meyda features; compute per-bin flux in `tick()` alongside existing bin processing; expose as `a.onset[]` (boolean) and `a.flux[]` (raw value). See [Web-Onset](https://github.com/Keavon/Web-Onset) for a reference JS implementation.

---

### 7. Narrow Bandpass Bins (Hz-Range Bins) ✅ Implemented

**Status:** Done — [src/lib/audio.js](src/lib/audio.js), [dev/panels/audio.js](dev/panels/audio.js). `a.setBinRange(index, minHz, maxHz)` maps a bin to an exact Hz window via `amplitudeSpectrum` and `fftSize / sampleRate`. Default bins still equal-slice the spectrum until a range is set. The Audio Bins panel gained a scrubable `hz` row and auto-tune controls.

Lets users define frequency bins by exact Hz range rather than equal-chunk divisions — e.g. `a.setBinRange(0, 40, 100)` for kick, `a.setBinRange(1, 180, 300)` for snare.

- **Why:** The current binning in [src/lib/audio.js:172-175](src/lib/audio.js#L172-L175) divides Meyda's loudness array into equal slices. Instruments occupy specific Hz ranges — tuning bins to those ranges gives orders-of-magnitude better isolation.
- **Where to start:** Replace equal-slice logic with a Hz→FFT-index mapping using `fftSize / sampleRate`. Add `setBinRange(index, minHz, maxHz)` method. Combine with Idea 6 for instrument-tuned onset triggers.
- **Pairs with:** Idea 6 (per-band onset) — narrow bins + onset detection = instrument-level triggers with no MIDI required.

---

### 8. Chroma Binding — React to Specific Notes ✅ Implemented

**Status:** Done — [src/lib/audio.js](src/lib/audio.js), [dev/panels/chroma.js](dev/panels/chroma.js), wired in [dev/index.js](dev/index.js). Exposes `a.chroma[0..11]` (one-pole smoothed, controlled by `a.chromaSmooth`, default 0.4) and idempotent `ch0()..ch11()` globals mirroring `a0..a3`. Alt+K opens a Chromagram panel with twelve labeled bars (C..B) and argmax highlight.

Exposes `a.chroma[0..11]` — one amplitude value per pitch class (C through B) — letting users bind visuals to when a specific note or chord is playing.

- **Why:** Frequency bins track loudness; chroma tracks *harmony*. You can say "pulse red when E is dominant" or "brighten on major chords" — impossible with FFT bins alone.
- **Where to start:** [src/lib/audio.js:124](src/lib/audio.js#L124) — add `'chroma'` to Meyda features. Expose `a.chroma[0..11]` on the synth object and optionally as `ch0()..ch11()` globals alongside existing `a0()..a3()`.

---

### 9. Spectral Centroid (`a.brightness`) ✅ Implemented

**Status:** Done — [src/lib/audio.js](src/lib/audio.js), [dev/panels/audio.js](dev/panels/audio.js). Exposes `a.brightness` (0..1 normalized + smoothed), `a.brightnessRaw` (Hz), and `a.brightnessSmooth` (default 0.5). A `br(scale, offset)` global mirrors `a0..a3`. Silence-safe: holds last value when Meyda returns `0/0`. Audio panel title bar shows a live `brt: 0.NN` readout.

A single 0–1 value tracking how "bright vs dark" the current sound is, independent of volume.

- **Why:** Lets you bind to instrument *character* rather than loudness. A bassline playing loudly and a hi-hat playing quietly have very different centroids — useful for timbral crossfades and colour mapping.
- **Where to start:** [src/lib/audio.js:124](src/lib/audio.js#L124) — add `'spectralCentroid'` to Meyda features. Normalize by Nyquist frequency. Expose as `a.brightness`. Zero new dependencies.

---

### 9b. Tempo Factory + Beat Phase (`tempo()`, `a.beatPhase`) ✅ Implemented

**Status:** Done — [src/lib/audio.js](src/lib/audio.js). Exposes `a.bpm` (smoothed beats-per-minute from beat-interval timing, `a.bpmSmooth` default 0.6) and `a.beatPhase` (sawtooth 0→1 across the current beat, recomputed each `tick()`). Idempotent globals `tempo(scale, offset)` and `bp(scale, offset)` mirror `a0..a3`/`br`. **Note:** `tempo()` is the audio-detected tempo and is deliberately distinct from the numeric `bpm` sequencing global (default 30) read by array `.fast()` — naming the factory `bpm` would have overwritten that global and broken sequencing.

Gives live coders a phase ramp, not just a tempo number, so `rotate`/`scroll` can lock to the beat: `osc(20).rotate(0, () => a.beatPhase * 6.28).out()`.

- **Why:** A BPM number alone can't drive motion; a 0→1 sawtooth between beats can. The factory pattern (`a0`, `br`, `ch0`) exists precisely for installing such per-frame signals as globals.
- **Where:** [src/lib/audio.js](src/lib/audio.js) — `beatPhase` computed in `tick()` from `this.bpm` and `this._lastBeatTime`; factories installed in the `setBins()` `_makeGlobal` block.

---

### 10. Spectral Fingerprint "Learn" Mode

`a.learn(n)` captures an MFCC snapshot of whatever sound is playing *right now* and creates `a.match[n]` — a 0–1 similarity score that stays high when the same sound returns.

- **Why:** This is the VJ-tool approach for sound-specific binding without MIDI. Record a kick once; `a.match[0]` stays near 1 whenever the kick hits, near 0 for everything else.
- **How:** Cosine similarity between the stored MFCC vector and the current MFCC vector each tick.
- **Where to start:** [src/lib/audio.js:124](src/lib/audio.js#L124) — add `'mfcc'` to Meyda features. Add `learn(slotIndex)` method (stores current `mfcc` snapshot). Compute cosine similarity in `tick()`. Expose `a.match[]`.
- **Note:** Most complex of the four — implement after Ideas 6 and 7 are working.

---

---

## More Editor Panels

_Goal: extend the `PerformanceUI` registry (dev/performance-ui.js) with more in-context tools for live coding. Each idea is a new file in `dev/panels/` that conforms to the existing `{ id, title, key, zone, width, height, init, update }` descriptor._

---

### 11. FPS / Frame-Time Graph

A rolling 5-second sparkline of `hydra.synth.stats.fps` plus frame-time so dips and jitter are visible at a glance.

- **Why:** The `update` loop in [dev/index.js:69-70](dev/index.js#L69-L70) already polls FPS into the document title. A panel makes it visual without leaving the canvas.
- **Where to start:** New `dev/panels/fps.js`. Create a `<canvas>` in `init`, push samples to a ring buffer in `update`, redraw as a sparkline each tick. `top-right` zone, ~200×80px.

---

### 12. Texture Output Preview (`o0..o3`)

Four small thumbnails showing every output buffer simultaneously. Click a thumb to `render(oN)` full-screen or copy `oN` into the editor at cursor.

- **Why:** Hydra has four outputs but only one is visible at a time. Live thumbnails make multi-output patches debuggable.
- **Where to start:** `hydra.o[]` holds the output array; each has a framebuffer. Use `gl.readPixels` (or draw the framebuffer texture to a 2D canvas) into per-output preview canvases in the panel.

---

### 13. Variable Watch

A panel where the performer pins arbitrary expressions (`a.fft[0]`, `midi.knob(2)`, `time`) and sees their live numeric value plus a tiny sparkline.

- **Why:** Audio Inspector shows bins; MIDI Monitor will show knobs. A general-purpose watch covers everything in between — derived values, time-based math, custom variables.
- **Where to start:** New `dev/panels/watch.js`. Input row + "+" button, store user expressions as `new Function('return ' + src)`, call each in `update`, render value and 60-sample trace. `top-left` zone keeps it away from snippets/history.

---

### 14. Keybinding Cheat Sheet

Static panel listing every keyboard shortcut — Alt+key panel toggles, Ctrl+Enter eval, Alt+Shift+F format, Alt+0-9 snippet recall, Alt+Shift+0-9 snippet save, Alt+Up/Down history.

- **Why:** Shortcuts are scattered across [dev/index.js:116-194](dev/index.js#L116-L194) and `_routeKey` in [dev/performance-ui.js:63-69](dev/performance-ui.js#L63-L69). Discoverability is currently zero.
- **Where to start:** Panels self-describe their `key` and `title` already — iterate `window.performanceUI._panels` to render the dynamic rows, plus a hardcoded list for editor shortcuts. Bind to `Alt+?`.

---

### 15. Eval Console ✅ Implemented

**Status:** Done — [dev/panels/eval-console.js](dev/panels/eval-console.js), wired in [dev/index.js](dev/index.js). Wraps `console.error`/`console.warn` at boot to push entries into `window.evalErrors` (capped at 100), forwarding to the originals so DevTools output is unchanged. Alt+E opens the panel; last 20 entries render newest-first with timestamp, level badge, and message preview. Deviation from the original sketch: the strip-button red flash is triggered from the console wrap rather than `panel.update()`, because `performance-ui.js` skips `update()` for hidden panels (which is exactly when the flash needs to fire).

Captures the `[editor]` eval error log ([dev/index.js:163](dev/index.js#L163)) and any `console.error`/`console.warn` into a scrollback panel. Flashes the strip button red when a new error arrives.

- **Why:** Eval errors only surface in browser devtools today, which performers don't keep open during a set. A panel keeps mistakes visible without breaking flow.
- **Where to start:** Wrap `console.error`/`console.warn` to push into `window.evalErrors` and forward to the original. Add a push inside the existing `catch (err)` in the editor. Render last ~20 entries, newest first.

---

### 16. Function Reference / Insert

Searchable list of every Hydra function (osc, shape, kaleid, modulate, blend…) with one-line signatures. Click to insert at the editor's cursor.

- **Why:** The `<textarea>` editor has no autocomplete or signature help. New users and returning performers both lose time guessing parameter order.
- **Where to start:** Read `hydra.generator` / `hydra.synth.generators` and the transform registry to enumerate names and arg specs. Use `editor.setRangeText(...)` to insert at `editor.selectionStart` so the cursor lands inside the parens.

---

## Suggested Order

1. ~~**Audio Inspector**~~ ✅ done
2. ~~**History Panel**~~ ✅ done
3. ~~**Snippet Bank**~~ ✅ done
4. ~~**Narrow Bandpass Bins**~~ ✅ done
5. ~~**Per-Band Onset Detection**~~ ✅ done
6. ~~**Spectral Centroid**~~ ✅ done
7. ~~**Chroma Binding**~~ ✅ done
8. ~~**Eval Console**~~ ✅ done
9. **MIDI Monitor** — useful once MIDI is in active use during performance
10. **Spectral Fingerprint Learn** — most powerful but most complex; last
11. **Unified HUD** — partial (button strip exists); revisit for the left-edge slide-out layout once more panels land

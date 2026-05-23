# Ideas

A running log of feature ideas and experiments for hydra-synth. Each idea includes a rationale and a starting point for implementation.

---

## Performance Space (`dev/`)

_Goal: transform the `dev/` folder into a first-class live performance environment with contextual tooling visible while the editor is open._

### 1. History Panel

An audit log of every Ctrl+Enter eval during a session — timestamped, scrollable, click-to-restore.

- **Why:** Live coding means iterating fast and often losing a good patch. History makes the session recoverable without breaking flow.
- **Where to start:** Wrap the eval block in [dev/index.js:117-123](dev/index.js#L117-L123) to push each run to a `history[]` array; render as a fixed overlay panel.
- **Details:** Timestamp + first 60 chars of script + restore button. Cap at ~50 entries per session; no persistence needed.

---

### 2. Audio Inspector Panel

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

### 4. Unified Tool HUD

A floating vertical tab strip (History | Audio | MIDI | Stats) on the left edge. Clicking a tab slides out its panel without covering the bottom editor.

- **Why:** As individual tool panels multiply, a shared container keeps the UI coherent and prevents overlap with the editor.
- **Where to start:** The editor is `position: fixed; bottom: 0; zIndex: 9999` ([dev/index.js:66-81](dev/index.js#L66-L81)). The HUD sits on the left at a lower z-index. Each of Ideas 1–3 becomes a tab.
- **Note:** Implement after at least two standalone panels exist — premature abstraction otherwise.

---

### 5. Snippet Bank

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

### 6. Per-Band Onset Detection (`a.onset[]`)

Adds `a.onset[0..n]` boolean signals that fire when a sound *attacks* within a specific frequency band — not just when it's loud.

- **Why:** Beat detection fires on overall amplitude. Onset fires on *change* — a kick, snare, and hi-hat each leave distinct onset signatures in different frequency ranges. This is how Resolume's audio-to-MIDI works conceptually.
- **How:** Spectral flux measures frame-to-frame magnitude difference in a band. A threshold crossing = onset. Per-bin spectral flux is just `sum(max(0, |X[k]| - |X_prev[k]|))` over the bin's FFT range.
- **Where to start:** [src/lib/audio.js:124](src/lib/audio.js#L124) — add `'spectralFlux'` to Meyda features; compute per-bin flux in `tick()` alongside existing bin processing; expose as `a.onset[]` (boolean) and `a.flux[]` (raw value). See [Web-Onset](https://github.com/Keavon/Web-Onset) for a reference JS implementation.

---

### 7. Narrow Bandpass Bins (Hz-Range Bins)

Lets users define frequency bins by exact Hz range rather than equal-chunk divisions — e.g. `a.setBinRange(0, 40, 100)` for kick, `a.setBinRange(1, 180, 300)` for snare.

- **Why:** The current binning in [src/lib/audio.js:172-175](src/lib/audio.js#L172-L175) divides Meyda's loudness array into equal slices. Instruments occupy specific Hz ranges — tuning bins to those ranges gives orders-of-magnitude better isolation.
- **Where to start:** Replace equal-slice logic with a Hz→FFT-index mapping using `fftSize / sampleRate`. Add `setBinRange(index, minHz, maxHz)` method. Combine with Idea 6 for instrument-tuned onset triggers.
- **Pairs with:** Idea 6 (per-band onset) — narrow bins + onset detection = instrument-level triggers with no MIDI required.

---

### 8. Chroma Binding — React to Specific Notes

Exposes `a.chroma[0..11]` — one amplitude value per pitch class (C through B) — letting users bind visuals to when a specific note or chord is playing.

- **Why:** Frequency bins track loudness; chroma tracks *harmony*. You can say "pulse red when E is dominant" or "brighten on major chords" — impossible with FFT bins alone.
- **Where to start:** [src/lib/audio.js:124](src/lib/audio.js#L124) — add `'chroma'` to Meyda features. Expose `a.chroma[0..11]` on the synth object and optionally as `ch0()..ch11()` globals alongside existing `a0()..a3()`.

---

### 9. Spectral Centroid (`a.brightness`)

A single 0–1 value tracking how "bright vs dark" the current sound is, independent of volume.

- **Why:** Lets you bind to instrument *character* rather than loudness. A bassline playing loudly and a hi-hat playing quietly have very different centroids — useful for timbral crossfades and colour mapping.
- **Where to start:** [src/lib/audio.js:124](src/lib/audio.js#L124) — add `'spectralCentroid'` to Meyda features. Normalize by Nyquist frequency. Expose as `a.brightness`. Zero new dependencies.

---

### 10. Spectral Fingerprint "Learn" Mode

`a.learn(n)` captures an MFCC snapshot of whatever sound is playing *right now* and creates `a.match[n]` — a 0–1 similarity score that stays high when the same sound returns.

- **Why:** This is the VJ-tool approach for sound-specific binding without MIDI. Record a kick once; `a.match[0]` stays near 1 whenever the kick hits, near 0 for everything else.
- **How:** Cosine similarity between the stored MFCC vector and the current MFCC vector each tick.
- **Where to start:** [src/lib/audio.js:124](src/lib/audio.js#L124) — add `'mfcc'` to Meyda features. Add `learn(slotIndex)` method (stores current `mfcc` snapshot). Compute cosine similarity in `tick()`. Expose `a.match[]`.
- **Note:** Most complex of the four — implement after Ideas 6 and 7 are working.

---

## Suggested Order

1. **Audio Inspector** — lowest friction; extends existing `draw()` already called per-tick
2. **History Panel** — five-line wrap around the existing eval block
3. **Snippet Bank** — natural follow-on to History once recall patterns are established
4. **Narrow Bandpass Bins** — foundational change that makes all audio binding more precise
5. **Per-Band Onset Detection** — builds on bandpass bins; unlocks instrument-level triggers
6. **Spectral Centroid** — one-liner Meyda addition; useful immediately
7. **Chroma Binding** — adds harmonic/note awareness; standalone Meyda feature
8. **MIDI Monitor** — useful once MIDI is in active use during performance
9. **Spectral Fingerprint Learn** — most powerful but most complex; last
10. **Unified HUD** — only after 2–3 panels exist and the layout needs consolidation

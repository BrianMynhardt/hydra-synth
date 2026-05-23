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

## Suggested Order

1. **Audio Inspector** — lowest friction; extends existing `draw()` already called per-tick
2. **History Panel** — five-line wrap around the existing eval block
3. **Snippet Bank** — natural follow-on to History once recall patterns are established
4. **MIDI Monitor** — useful once MIDI is in active use during performance
5. **Unified HUD** — only after 2–3 panels exist and the layout needs consolidation

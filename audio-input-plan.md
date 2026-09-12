# Audio Input as Live Control Source — Design Plan

## Recon Summary

**Existing scaffolding (incorporate, do not replace):**
- `src/lib/audio.js` — `Audio` class, Grade C. Uses **Meyda** (already in `package.json`) for a `loudness` feature extractor. Has `tick()`, `fft[]`, `vol`, beat detection, `setBins()`, `setSmooth()`, `setCutoff()`, `setScale()`.
- `src/hydra-synth.js` — `_initAudio()` instantiates `Audio` and attaches it to `this.synth.a`. `tick()` calls `this.synth.a.tick()` every frame.
- `dev/examples.js` — already uses `a.fft[0]`, `a.fft[1]`, `a.setSmooth()` extensively.
- `this.synth.a` is the established namespace — do not rename it.

**Critical gaps to close:**
- Only microphone input (`getUserMedia`) is wired up; no display-capture audio or HTML element audio.
- `this.beat` is a config object, not a boolean signal — `a.beat ? 1 : 0` always truths (the object is always truthy).
- `AudioContext` is created inside the `getUserMedia` promise but never explicitly resumed — fragile in some browsers.
- **F-005** (active finding): `setBins()` captures `a` (implicit global) instead of `this` — broken in `makeGlobal: false` mode. This PR must fix it.

**Open findings that overlap:**
- **F-005** is directly in scope; the new source-switching code will touch `setBins()` so fix it here.
- F-001, F-002, F-003, F-004, F-006, F-007, F-008 are out of scope — do not touch.

---

## A. Architecture

**File:** Modify `src/lib/audio.js` (existing — do not create a new file).

The `Audio` class gains a source-management layer on top of the existing Meyda pipeline:

```
Audio instance
  ├── _context: AudioContext         (created lazily on first init* call)
  ├── _meyda: MeydaAnalyzer          (created/rewired when source changes)
  ├── _sourceNode: AudioNode | null  (MediaStreamSource or MediaElementSource)
  ├── fft[]: number[]                (read each frame via tick())
  ├── vol: number                    (overall amplitude)
  └── isBeat: boolean                (true for exactly one tick after beat threshold crossed)
```

**Init flow:**
1. Constructor no longer calls `getUserMedia`. It sets up the `beat` config and the `fft`/`bins` arrays only.
2. `initMic()` → `getUserMedia` → `_connectSource(stream)`.
3. `initStream()` → `getDisplayMedia` → `_connectSource(stream)` (same plumbing).
4. `initMedia(el)` → `context.createMediaElementSource(el)` → `_connectSource(node)`.
5. `_connectSource(streamOrNode)` creates the `AudioContext` if not already present, calls `context.resume()`, creates the Meyda analyzer pointed at the new source. If an analyzer already exists, call `meyda.setSource(newSourceNode)`.

**Update loop:** No change needed. `HydraRenderer.tick()` already calls `this.synth.a.tick()`. The `tick()` method calls `meyda.get()` as today — just guarded by a null check on `_meyda`.

**Derived signals storage:**
- `this.fft` — array of `numBins` normalised floats in `[0, 1]`.
- `this.vol` — scalar amplitude.
- `this.isBeat` — boolean, set `true` in `detectBeat()` when a beat fires, cleared to `false` at the top of the *next* `tick()`.
- `this.beat` — keep as config object for backwards compat; do NOT make it the boolean (breaking change). The public boolean is `isBeat`.

---

## B. Public API

`a` is already `this.synth.a`, automatically global when `makeGlobal: true`. No namespace change.

```js
// 1. amplitude drives oscillator frequency
osc(() => a.fft[0] * 40 + 2, 0.1).out()

// 2. beat gate triggers a white flash
solid(1, 1, 1)
  .mult(src(o0), () => a.isBeat ? 0 : 0.98)
  .out()

// 3. four-band visualiser
osc(() => a.fft[0] * 20, 0, () => a.fft[1])
  .rotate(() => a.fft[2] * 3)
  .color(() => a.fft[3], 0.5, 1)
  .out()

// 4. switch to system audio at runtime
a.initStream()   // triggers getDisplayMedia prompt

// 5. drive a parameter with a smoothed band shorthand
// (existing a0(), a1() helpers still work)
osc(() => a1(8, 0.1)(), 0.3).out()
```

`a` is attached in `HydraRenderer._initAudio()` exactly as today — no change to that method needed until source-switching is wired, at which point `detectAudio: true` continues to mean "create the Audio instance but do not auto-capture" (auto-capture was the old default; the constructor now waits for an explicit `init*` call).

**Backwards compatibility note:** The old constructor called `getUserMedia` immediately. This PR changes that to lazy/explicit. A migration path: honour a new option `autoMic: true` (default `false`) that calls `initMic()` automatically if set, giving existing code a one-flag escape hatch.

---

## C. Input Source Options

| Method | Browser API | Notes |
|---|---|---|
| `a.initMic()` | `navigator.mediaDevices.getUserMedia({audio: true, video: false})` | Current path, refactored into this method |
| `a.initStream()` | `navigator.mediaDevices.getDisplayMedia({audio: true, video: true})` | Must pass `{audio: true}` — some browsers require `video: true` alongside; `video` track should be stopped immediately after connecting to avoid unnecessary capture |
| `a.initMedia(el)` | `context.createMediaElementSource(el)` | `el` is a `<audio>` or `<video>` DOM element passed by the user; `el.crossOrigin = 'anonymous'` must be set before this call or the API will throw |

**Source switching at runtime:**

```js
a.initMic()          // start with microphone
// later:
a.initStream()       // switch to tab audio — re-wires Meyda in place
```

Internally, `_connectSource` stops any previous `MediaStream` (`stream.getTracks().forEach(t => t.stop())`), disconnects the old source node, and creates a new one. The `AudioContext` is reused across switches.

---

## D. Configuration

Existing constructor options remain unchanged. New additions:

| Option | Default | Notes |
|---|---|---|
| `fftSize` | `1024` | Passed to Meyda's `bufferSize` — must be power of two. Changing post-init requires recreating the analyzer. |
| `numBins` | `4` | Existing; kept |
| `smooth` | `0.4` | Existing; per-bin in `settings[]` |
| `cutoff` | `2` | Existing |
| `scale` | `10` | Existing |
| `beatThreshold` | `40` | Maps to `this.beat.threshold` — now a constructor param |
| `beatHoldFrames` | `20` | Maps to `this.beat.holdFrames` |
| `autoMic` | `false` | If `true`, calls `initMic()` in constructor (replicates old behaviour for upgraders) |

Runtime setters already exist: `setSmooth()`, `setCutoff()`, `setScale()`, `setBins()`. Add `setFftSize(n)` which stops and restarts the Meyda analyzer with the new buffer size.

---

## E. Constraints & Risks

**1. Browser autoplay / permission policy**
Both `getUserMedia` and `getDisplayMedia` require a user gesture. They must be called from a click handler or similar — they cannot fire from `setTimeout` or `raf-loop`. Document this; `initMic()` and `initStream()` should return a `Promise` so callers can chain or catch.

**2. AudioContext must be resumed after a user gesture**
`new AudioContext()` starts in `"suspended"` state in Chromium-based browsers if not created inside a user-gesture handler. The `getUserMedia` promise resolve *is* post-gesture, so the microphone path is safe. For `initMedia(el)`, add `this._context.resume()` explicitly before connecting. Expose `a.start()` as a public alias for `this._context.resume()` to let users hook it to a click handler if needed.

**3. Performance — FFT reads blocking the render loop**
Meyda's `get()` is synchronous and executes on the main thread. It does not use `AnalyserNode.getFloatFrequencyData()` directly (it wraps it). The current pattern calls `meyda.get()` once per animation frame, which is acceptable. Avoid calling `meyda.get()` more than once per tick. Do not start the Meyda analyzer in streaming mode — the current pull-style `get()` approach is correct.

**4. F-005 conflict**
The new code rewrites `setBins()` to fix the `a` implicit global — `this.fft[index]` replaces `a.fft[index]` in the closure. This resolves F-005 as a natural consequence; note it in `harness/findings.md` and move F-005 to Resolved.

**5. Non-global mode**
In `makeGlobal: false` mode, `a` is not on `window`. Users must write `hydra.a.fft[0]` or destructure it. The `window['a' + index]` shorthand helpers in `setBins()` must be guarded: only set window globals when `makeGlobal` is `true`. Currently `Audio` receives no `makeGlobal` flag — it must be passed from `HydraRenderer._initAudio()`.

**6. No new dependencies**
Meyda is already in `package.json`. The Web Audio API is native. No new imports needed.

**7. No open findings directly blocked**
F-001 through F-008 other than F-005 are unrelated to this work.

---

## F. File-by-File Change List

| File | Action | Reason |
|---|---|---|
| `src/lib/audio.js` | **Modify** | Add `initMic()`, `initStream()`, `initMedia(el)`, `_connectSource()`, `start()`, `isBeat` boolean, `fftSize` option, `autoMic` option; fix F-005 (`this.fft` not `a.fft`); accept and use `makeGlobal` flag to guard window assignments |
| `src/hydra-synth.js` | **Modify** | Pass `makeGlobal` flag into `Audio` constructor in `_initAudio()`; remove old auto-mic behaviour now that `autoMic` controls it |
| `dev/examples.js` | **Modify** | Add `audioDemo()` example showing mic, stream, and `initMedia` paths |
| `harness/findings.md` | **Modify** | Move F-005 from Active to Resolved once the `this.fft` fix is merged |
| `docs/API_REFERENCE.md` | **Modify** | Document `Audio` class public API: new methods, `isBeat`, constructor options |

No new files need to be created. `src/lib/audio.js` stays under the 600-line constraint (currently ~217 lines; the additions will add ~80–100 lines).

---

## G. Test / Validation Plan

**Problem:** `getUserMedia` and `getDisplayMedia` are unavailable in headless Node.js and require real hardware in a browser.

**Mock approach:**

Use an `OfflineAudioContext` with a programmatically generated sine wave to drive Meyda without a microphone:

```js
// In a harness/browser.html test page (not Node):
const offlineCtx = new OfflineAudioContext(1, 44100, 44100)
const osc = offlineCtx.createOscillator()
osc.frequency.value = 440
osc.connect(offlineCtx.destination)
osc.start()

const audio = new Audio({ numBins: 4, fftSize: 512 })
// Inject the offline context directly (test-only back door):
audio._context = offlineCtx
audio._connectSource(osc)
// Then call audio.tick() and assert audio.fft[0] > 0
```

This approach requires `_connectSource` to accept an `AudioNode` directly (not only streams) — which `initMedia(el)` already establishes as a pattern.

**Structural validation:**
- Add a check in `harness/validate.js` that `src/lib/audio.js` exports a class with `tick`, `initMic`, `initStream`, `initMedia` methods.
- Existing `npm run harness:validate` catches file-size overruns automatically.

**Manual verification checklist** (run `npm run harness` and open `localhost:3333`):
1. `a.initMic()` — FFT bars visible in the canvas overlay.
2. `a.fft[0]` updates each frame in the browser console.
3. `a.isBeat` pulses `true` on a clap.
4. `a.initStream()` — tab audio drives the same bars without needing a microphone.
5. `a.initMedia(document.querySelector('audio'))` — works with an `<audio>` element.
6. `makeGlobal: false` — no window globals leaked; `hydra.a.fft[0]` works.
7. After source switch, no stale `AudioNode` references or stream leaks.

---

## H. Demo

### [ ] Add demo to dev/examples.js
- Add a self-contained `audioDemo` function to `dev/examples.js`
- Export it in the `module.exports` block at the top of that file
- The demo must be runnable standalone: no external state, no assumptions about prior calls
- Cover the golden path and at least one edge-case variant (e.g., no device connected, value at boundary)
- Add a one-line comment above the export describing what the demo demonstrates

---

## Recommended First PR

**PR title:** `feat(audio): add initMic/initStream/initMedia source switching + fix F-005`

The smallest shippable slice is to refactor the existing constructor's auto-`getUserMedia` call into an explicit `initMic()` method, add `initStream()` and `initMedia(el)` alongside it using the shared `_connectSource()` helper, add `isBeat` as a properly-cleared boolean, pass `makeGlobal` from `HydraRenderer` into `Audio`, and fix F-005 by replacing `a.fft[index]` with `this.fft[index]` in `setBins()`. This is a self-contained change to `src/lib/audio.js` and a two-line change to `src/hydra-synth.js`, and it leaves the render-loop integration, FFT size config, and harness test additions as clean follow-up work. The `autoMic: false` default means the PR is non-breaking: existing users who relied on auto-capture add `autoMic: true` with no other changes.

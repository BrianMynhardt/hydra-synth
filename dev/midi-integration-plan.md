# MIDI Integration Plan

## Overview

This plan describes the complete implementation of MIDI controller support for hydra-synth. The
architecture follows the same three-part pattern already established by audio
(`src/lib/audio.js → synth.a`) and mouse (`src/lib/mouse.js → synth.mouse`): a dedicated
library class is initialised by `HydraRenderer`, attached to `this.synth.midi`, and thereby
automatically exposed as the global identifier `midi` in sketches when `makeGlobal: true`. The
system is decomposed into a **MidiController base class** (defines the interface all device
drivers implement), a concrete **LPD8 class** (the reference device), and a **MidiManager**
(owns the Web MIDI API connection, routes incoming messages, and presents the sketch-facing
API). MIDI values participate in the existing per-frame regl uniform evaluation pipeline with
no changes to the shader compilation path: callers wrap reads in arrow functions
(`() => midi.knob(3)`) exactly as they do for `() => mouse.x` and `() => a.fft[0]`.

---

## Architecture Diagram

```
 Web MIDI API
 navigator.requestMIDIAccess()
 MIDIAccess.onstatechange ──────────────────────────────────────┐
                                                                │ hot-plug events
                                                                ▼
┌───────────────────────────────────────────────────────────────────────┐
│                           MidiManager                                 │
│  src/lib/midi-manager.js                                              │
│                                                                       │
│  _access: MIDIAccess | null                                           │
│  _registry: Map<MIDIInput.id, MidiController>                        │
│  _padProxies: PadProxy[]   (stable across reconnects)                │
│  _deviceClasses: (typeof MidiController)[]                            │
│                                                                       │
│  init(): Promise<void>                   tick(dt: number): void      │
│  knob(n: number, opts?: {smooth?}): number                           │
│  pad(n: number): PadProxy                setController(name): void   │
│  controller: MidiController | null       controllers: MidiController[]│
│  devices: MIDIInput[]                                                 │
└──────────────────┬──────────────────────────────┬────────────────────┘
                   │ creates                       │ creates (future devices)
                   ▼                              ▼
┌──────────────────────────────┐  ┌────────────────────────────────────┐
│          LPD8                │  │      MidiController (base)         │
│  src/lib/devices/lpd8.js    │  │  src/lib/midi-controller.js        │
│                              │  │                                    │
│  deviceNamePattern: /LPD8/i  │  │  knobs: number[]   (0-1 each)     │
│  PROGRAMS: { 1, 2, 3, 4 }   │  │  pads: PadState[]                 │
│  program: number             │  │  connect(MIDIInput): void         │
│  setProgram(p): void         │  │  disconnect(): void               │
│  onMessage(event): routes    │  │  onMessage(event): void  (abstract)│
│    CC → knob value (0-1)     │  │  tick(dt): void          (no-op)  │
│    NoteOn → pad trigger      │  │  on/off/emit  (event emitter)     │
│    NoteOff → pad release     │  └────────────────────────────────────┘
└──────────────────────────────┘
                   │
                   │  this.synth.midi = midiManager
                   │  EvalSandbox.add('midi') → window.midi  (makeGlobal)
                   ▼
┌───────────────────────────────────────────────────────────────────────┐
│                          HydraRenderer                                │
│  src/hydra-synth.js                                                   │
│                                                                       │
│  constructor option: detectMidi = false                               │
│  this.synth.midi = null → MidiManager (after _initMidi, line ~123)   │
│  tick(): this.synth.midi.tick(dt)  (after audio tick, line 427)      │
│  EvalSandbox constructed at line 127 picks up midi automatically     │
└───────────────────────────────────────────────────────────────────────┘
                   │
                   ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        Hydra Sketch API                               │
│                                                                       │
│  midi.knob(3)                  → number  0-1 (raw)                   │
│  midi.knob(3, { smooth: 0.9 }) → number  0-1 (exponentially smoothed)│
│  midi.pad(0).velocity          → number  0-1                         │
│  midi.pad(0).active            → boolean                             │
│  midi.pad(0).onTrigger(fn)     → void    (registers Note On handler) │
│  midi.setController('LPD8')    → void    (pin primary by name)       │
│  midi.controller               → MidiController | null               │
│  midi.controllers              → MidiController[] (all connected)    │
│  midi.devices                  → MIDIInput[]                         │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Files to Create

### 1. `src/lib/midi-controller.js`

**Purpose:** Abstract base class that every MIDI device driver must extend; defines the shared
interface, default lifecycle hooks, and a minimal event emitter.

**Public interface — every export, method, and event:**

```
class MidiController

  // Subclasses override to match their MIDIInput.name string
  static get deviceNamePattern(): RegExp        // base default: /.*/

  // Per-frame state — arrays populated by subclass constructor
  knobs: number[]       // normalised 0-1; index = knob position (0-based)
  pads: PadState[]      // index = pad position (0-based)

  // PadState (plain object, not a class)
  //   active:    boolean    true while a note is held
  //   velocity:  number     last Note On velocity, 0-1
  //   note:      number     raw MIDI note number of last event
  //   _callbacks: Function[] internal; onTrigger handlers stored here

  // Read-only name of the connected MIDIInput (empty string if disconnected).
  // Used by MidiManager.setController() for name-based lookup.
  get name(): string    // returns this._midiInput?.name ?? ''

  // Lifecycle — called by MidiManager, not directly by sketch authors
  connect(midiInput: MIDIInput): void
    // Stores midiInput as this._midiInput.
    // Binds this.onMessage to midiInput.onmidimessage.

  disconnect(): void
    // Nulls midiInput.onmidimessage.
    // Clears this._midiInput (name becomes '').
    // Does NOT clear _callbacks — those survive on PadProxy (see MidiManager).

  // Message handler — subclasses MUST implement (base throws TypeError)
  onMessage(event: MIDIMessageEvent): void

  // Per-frame hook — subclasses MAY override (base is no-op)
  tick(dt: number): void      // dt in ms

  // Minimal event emitter (used internally for pad trigger propagation)
  on(event: string, fn: Function): void     // registers listener
  off(event: string, fn: Function): void    // removes listener
  emit(event: string, data: any): void      // calls all registered listeners

  // Events this class (or subclasses) must emit:
  //   'pad:on'  { index: number, velocity: number, note: number }
  //   'pad:off' { index: number, note: number }

export default MidiController
```

---

### 2. `src/lib/devices/lpd8.js`

**Purpose:** Concrete MIDI driver for the AKAI Professional LPD8; handles 8 velocity-sensitive
pads and 8 knobs across 4 switchable programs.

**Public interface — every export, method, and event:**

```
import MidiController from '../midi-controller.js'

class LPD8 extends MidiController

  // Matches "LPD8" anywhere in the MIDIInput.name string (case-insensitive)
  static get deviceNamePattern(): /LPD8/i

  // Factory program maps — see LPD8 Mappings section for values
  static get PROGRAMS(): {
    [1 | 2 | 3 | 4]: {
      notes:      number[8]   // pad index 0-7 → MIDI note number
      ccs:        number[8]   // knob index 0-7 → CC number
      padChannel: number      // 0-indexed channel for pads  (9 = MIDI ch 10)
      knobChannel: number     // 0-indexed channel for knobs (0 = MIDI ch 1)
    }
  }

  // Instance state
  knobs: number[8]      // 0.0–1.0; updated on each CC message
  pads: PadState[8]     // updated on each Note On / Note Off

  program: number       // active program 1-4 (default 1)

  setProgram(p: 1 | 2 | 3 | 4): void
    // Switches the note/CC routing maps used by onMessage.
    // Does NOT re-request MIDI access — takes effect on next message.

  // Overrides base (required)
  onMessage(event: MIDIMessageEvent): void
    // Parses event.data[0] for message type and channel.
    // Note On  (status & 0xF0 === 0x90, velocity > 0) → _handleNoteOn
    // Note Off (status & 0xF0 === 0x80, OR 0x90 vel=0) → _handleNoteOff
    // CC       (status & 0xF0 === 0xB0)                → _handleCC

  // Private helpers (must be implemented; not called from outside)
  _handleNoteOn(channel: number, note: number, velocity: number): void
    // Finds pad index via _padIndexForNote().
    // If found: sets pads[i].active = true, .velocity = velocity/127, .note = note.
    // Emits 'pad:on' with { index: i, velocity: velocity/127, note }.

  _handleNoteOff(channel: number, note: number): void
    // Finds pad index via _padIndexForNote().
    // If found: sets pads[i].active = false, .velocity = 0.
    // Emits 'pad:off' with { index: i, note }.

  _handleCC(channel: number, cc: number, value: number): void
    // Finds knob index via _knobIndexForCC().
    // If found: sets knobs[i] = value / 127.

  _padIndexForNote(note: number): number
    // Returns index 0-7 matching note in PROGRAMS[this.program].notes,
    // or -1 if not found.

  _knobIndexForCC(cc: number): number
    // Returns index 0-7 matching cc in PROGRAMS[this.program].ccs,
    // or -1 if not found.

  // Inherits: connect, disconnect, tick (no-op), on, off, emit

export default LPD8
```

---

### 3. `src/lib/midi-manager.js`

**Purpose:** Owns the Web MIDI API connection, discovers devices, routes messages to the
matching MidiController instance, and exposes the sketch-facing `knob()` / `pad()` API.

**Public interface — every export, method, and event:**

```
import MidiController from './midi-controller.js'
import LPD8 from './devices/lpd8.js'

class MidiManager

  constructor({
    deviceClasses?: (typeof MidiController)[]  // defaults to [LPD8]
  } = {})

  // Async initialisation — called once by HydraRenderer._initMidi()
  init(): Promise<void>
    // Calls navigator.requestMIDIAccess({ sysex: false }).
    // If Web MIDI is unavailable (undefined or rejected), logs a warning
    // and resolves cleanly — does not throw.
    // On success: iterates access.inputs and calls _registerDevice() for each.
    // Sets access.onstatechange = this._onStateChange.

  // Per-frame hook — called by HydraRenderer.tick()
  tick(dt: number): void
    // 1. If this.controller exists, calls this.controller.tick(dt).
    // 2. Advances all registered smooth states:
    //      state.smoothed = state.smoothed * state.factor
    //                     + rawKnobValue * (1 - state.factor)
    //    (frame-rate dependent exponential decay; same idiom as array-utils smooth)

  // --- Sketch API ---

  knob(index: number, options?: { smooth?: number }): number
    // Without options: returns this.controller.knobs[index] or 0.
    // With { smooth: f } (f in [0,1)):
    //   On first call for this index: registers a smooth state slot in _smoothState[index]
    //   with factor f and initial value = current raw knob value.
    //   Subsequent calls: returns the slot's already-advanced smoothed value.
    //   The slot is advanced by tick(dt) before each render frame.
    //   If no controller is connected, returns the last smoothed value (decays toward 0).
    //   Sketch usage: osc(() => midi.knob(3, { smooth: 0.85 }) * 20).out(o0)

  pad(index: number): PadProxy
    // Returns the stable PadProxy for pad at index.
    // PadProxy is created once per index and cached in _padProxies.
    // Safe to call with no controller connected.

  // PadProxy (returned by pad(); stable object, not recreated on disconnect)
  //   velocity: number         reads controller.pads[index].velocity or 0
  //   active:   boolean        reads controller.pads[index].active or false
  //   onTrigger(fn: Function): void
  //     Appends fn to the proxy's internal callback list.
  //     Callbacks are fired by MidiManager when it receives 'pad:on' from
  //     the active controller, with argument { index, velocity }.
  //     Callbacks persist across controller disconnect/reconnect.

  // Explicitly pins the primary controller by name substring (case-insensitive).
  // Stores nameSubstring as _preferredName.
  // The controller getter searches _registry for a controller whose name includes it.
  // If the device is not currently connected, controller returns null until it is.
  // Call setController(null) to clear the preference and revert to first-connected.
  setController(nameSubstring: string | null): void

  // Primary controller: the controller whose name matches _preferredName,
  // or the first entry in _registry if _preferredName is null.
  // null if no recognised device is connected (or preferred name not found).
  get controller(): MidiController | null

  // All currently connected and matched controllers (in _registry insertion order).
  // Useful when multiple devices are in use simultaneously.
  get controllers(): MidiController[]

  // All connected MIDI inputs, recognised or not
  get devices(): MIDIInput[]
    // Returns Array.from(this._access.inputs.values()) or [] if no access.

  // --- Private ---

  _access: MIDIAccess | null
  _preferredName: string | null     // set by setController(); null = first-connected mode

  _registry: Map<string, MidiController>
    // Key: MIDIInput.id   Value: controller instance

  _padProxies: PadProxy[]
    // Indexed by pad index; created lazily in pad().

  _smoothState: Array<{ smoothed: number, factor: number } | null>
    // Indexed by knob index; slot is null until first knob(i, {smooth}) call.
    // tick() advances each non-null slot toward its controller's raw knob value.

  _deviceClasses: (typeof MidiController)[]

  _onStateChange(event: MIDIConnectionEvent): void
    // event.port.type === 'input' && event.port.state === 'connected'
    //   → _registerDevice(event.port)
    // event.port.type === 'input' && event.port.state === 'disconnected'
    //   → _deregisterDevice(event.port)

  _registerDevice(midiInput: MIDIInput): void
    // Calls _matchClass(midiInput) to find a matching driver class.
    // If found: instantiates the class, calls instance.connect(midiInput),
    // attaches a 'pad:on' listener that fires matching _padProxies callbacks,
    // stores in _registry under midiInput.id.
    // If not found: silently skips (unrecognised device).

  _deregisterDevice(midiInput: MIDIInput): void
    // Looks up controller in _registry by midiInput.id.
    // Calls controller.disconnect().
    // Removes from _registry.
    // Does NOT clear _padProxies callbacks.

  _matchClass(midiInput: MIDIInput): typeof MidiController | null
    // Tests midiInput.name against each class's deviceNamePattern.
    // Returns the first match, or null.

export default MidiManager
```

---

## Files to Modify

### `src/hydra-synth.js`

**What changes and why:** MIDI must be initialised and ticked by `HydraRenderer` following the
same pattern as audio. Adding `detectMidi = false` (opt-in) ensures existing sketches are
unaffected. Adding `midi: null` to `this.synth` at the object literal (lines 49–66) before
`EvalSandbox` is constructed at line 127 ensures automatic global exposure when
`makeGlobal: true` — the same mechanism that exposes `a`, `mouse`, and all GLSL generators
(see `eval-sandbox.js` lines 11–18: `Object.keys(parent).forEach(k => window[k] = parent[k])`).
The `_initMidi()` call must be placed between line 122 and line 124 so `this.synth.midi` is
populated before `EvalSandbox` scans `this.synth`.

**Exact insertion points:**

1. **Import block (lines 1–12):** Add after the existing imports:
   ```javascript
   import MidiManager from './lib/midi-manager.js'
   import LPD8 from './lib/devices/lpd8.js'
   ```

2. **Constructor options destructuring (lines 21–34):** Add `detectMidi = false` alongside
   `detectAudio = true`:
   ```javascript
   detectAudio = true,
   detectMidi = false,     // ← add here
   enableStreamCapture = true,
   ```

3. **`this.synth` object literal (lines 49–66):** Add `midi: null` as the last property before
   the closing brace:
   ```javascript
   tick: this.tick.bind(this),
   midi: null               // ← add here; replaced by MidiManager in _initMidi()
   }
   ```
   This ensures EvalSandbox at line 127 picks up `midi` during its `Object.keys(this.synth)`
   scan.

4. **After `_initAudio()` call (line 122), before `autoLoop` start (line 124):** Insert:
   ```javascript
   if (detectMidi) this._initMidi()
   ```
   Placement is critical: must be after line 122 and before line 127 (`new Sandbox(...)`).

5. **New `_initMidi()` method:** Insert immediately after the closing brace of `_initAudio()`
   (after line 230):
   ```javascript
   _initMidi () {
     const manager = new MidiManager({ deviceClasses: [LPD8] })
     this.synth.midi = manager
     manager.init().catch(err =>
       console.warn('[hydra-synth] MIDI unavailable:', err)
     )
   }
   ```

6. **`tick()` method (line 427):** After
   `if(this.detectAudio === true) this.synth.a.tick()`, add:
   ```javascript
   if (this.detectMidi && this.synth.midi) this.synth.midi.tick(dt)
   ```
   Store `this.detectMidi` on the instance in the constructor for use here
   (`this.detectMidi = detectMidi` alongside `this.detectAudio = detectAudio` at line 43).

---

## Public API

Five concrete usage examples showing how a Hydra sketch author interacts with MIDI input.

### 1 — Read a knob continuously

```javascript
// Raw: midi.knob(2) returns the instantaneous 0-1 value each frame.
osc(() => midi.knob(2) * 40 + 1, 0.1, 0.8)
  .colorama(0.3)
  .out(o0)

// Smoothed: { smooth: 0.85 } applies exponential decay between MIDI events.
// factor 0 = no smoothing; 0.9 = very gradual; values ≥ 1 are invalid.
// Mirrors the .smooth() modifier on arrays in src/lib/array-utils.js.
osc(() => midi.knob(2, { smooth: 0.85 }) * 40 + 1, 0.1, 0.8)
  .colorama(0.3)
  .out(o0)
```

### 2 — Trigger an action on a pad hit

```javascript
// Pad 0 clears everything on hit.
midi.pad(0).onTrigger(() => hush())

// Pad 1 triggers with velocity sensitivity.
// fn receives { index: number, velocity: number } (velocity is 0-1).
midi.pad(1).onTrigger(({ velocity }) => {
  solid(velocity, 0, 1 - velocity).out(o1)
})
```

### 3 — Map a knob to a named parameter

```javascript
// Knob 0 controls rotation speed; evaluated fresh each animation frame.
voronoi(5, 0.3)
  .rotate(() => time * midi.knob(0) * 2)
  .colorama(0.4)
  .out(o0)
```

### 4 — List available devices and pin the primary controller

```javascript
// List all connected MIDI inputs (recognised or not).
console.log('MIDI inputs:', midi.devices.map(d => d.name))

// List all connected and recognised controllers.
console.log('Controllers:', midi.controllers.map(c => c.name))

// Pin a specific controller as primary by name substring.
// After this, midi.knob() and midi.pad() read from the LPD8 even if another
// recognised device is also connected.
midi.setController('LPD8')

// Access the pinned primary controller.
if (midi.controller) {
  console.log('Active:', midi.controller.name, '— knobs:', midi.controller.knobs.length)
} else {
  console.log('LPD8 not currently connected.')
}

// Clear the pin and revert to first-connected behaviour.
midi.setController(null)
```

### 5 — Handle a controller that is not connected

```javascript
// midi.knob() returns 0 and midi.pad() returns a safe proxy when no
// controller is connected — the sketch runs without errors.
osc(() => midi.knob(0) * 10 + 0.5).out(o0)  // 0.5 fallback when unplugged

// Callbacks registered before a device is connected are stored and
// fire automatically once the device is plugged in (no page reload needed).
midi.pad(3).onTrigger(() => console.log('Pad 3 hit'))
```

---

## LPD8 Mappings

Factory default note and CC assignments per program. All pads transmit on MIDI channel 10
(stored 0-indexed as channel 9); all knobs transmit on MIDI channel 1 (stored 0-indexed as
channel 0). Physical pad indices follow the layout below.

**Physical layout (knobs at top, pads below, bottom row closest to user):**

```
[K0][K1][K2][K3][K4][K5][K6][K7]
[P4][P5][P6][P7]
[P0][P1][P2][P3]
```

**Pad note numbers (MIDI note, all on ch 10 / 0-indexed ch 9):**

> ⚠ Verify against actual hardware or the AKAI LPD8 Editor software before shipping.
> Factory presets may differ across firmware versions.

| Program | Pad 0 | Pad 1 | Pad 2 | Pad 3 | Pad 4 | Pad 5 | Pad 6 | Pad 7 |
|---------|-------|-------|-------|-------|-------|-------|-------|-------|
| P1      | 36    | 37    | 38    | 39    | 40    | 41    | 42    | 43    |
| P2      | 48    | 49    | 50    | 51    | 52    | 53    | 54    | 55    |
| P3      | 36    | 37    | 38    | 39    | 40    | 41    | 42    | 43    |
| P4      | 32    | 33    | 34    | 35    | 36    | 37    | 38    | 39    |

**Knob CC numbers (all on ch 1 / 0-indexed ch 0):**

| Program | Knob 0 | Knob 1 | Knob 2 | Knob 3 | Knob 4 | Knob 5 | Knob 6 | Knob 7 |
|---------|--------|--------|--------|--------|--------|--------|--------|--------|
| P1      | 70     | 71     | 72     | 73     | 74     | 75     | 76     | 77     |
| P2      | 70     | 71     | 72     | 73     | 74     | 75     | 76     | 77     |
| P3      | 78     | 79     | 80     | 81     | 82     | 83     | 84     | 85     |
| P4      | 70     | 71     | 72     | 73     | 74     | 75     | 76     | 77     |

Programs 2 and 4 share the same CC map as Program 1 in most factory firmware. Program 3 uses
a shifted CC range (78–85). If hardware testing reveals different defaults, update only the
`PROGRAMS` static getter in `src/lib/devices/lpd8.js` — no other file depends on these values.

---

## Adding a New Controller

Follow these steps to add a new MIDI device (example: an Akai MPK Mini with 8 pads and 8
knobs). You will only need to create one file and edit two lines in an existing file.

1. **Identify the device name.** Connect the device and run in a browser console:
   ```javascript
   navigator.requestMIDIAccess().then(a =>
     a.inputs.forEach(i => console.log(i.name))
   )
   ```
   Note the exact string (e.g. `"MPK mini 3"`).

2. **Create the driver file** at `src/lib/devices/<device-name>.js`. Use lowercase-with-hyphens
   for the filename (e.g. `mpk-mini.js`).

3. **Import and extend `MidiController`:**
   ```javascript
   import MidiController from '../midi-controller.js'
   class MpkMini extends MidiController { ... }
   export default MpkMini
   ```

4. **Set `deviceNamePattern`** as a static getter. Match the name string you found in step 1:
   ```javascript
   static get deviceNamePattern () { return /MPK mini/i }
   ```

5. **Initialise arrays in the constructor.** Call `super()` first, then size `knobs` and `pads`
   to match the device:
   ```javascript
   constructor () {
     super()
     this.knobs = Array(8).fill(0)
     this.pads = Array(8).fill(null).map(() => ({
       active: false, velocity: 0, note: 0, _callbacks: []
     }))
   }
   ```

6. **Implement `onMessage(event)`.** Parse the three bytes in `event.data`:
   - `status = event.data[0]`; message type = `status & 0xF0`; channel = `status & 0x0F`
   - Note On: `0x90`, velocity in `event.data[2]`; treat velocity 0 as Note Off
   - Note Off: `0x80`
   - CC: `0xB0`, CC number in `event.data[1]`, value in `event.data[2]`

7. **Route notes to pad indices** in `_handleNoteOn` / `_handleNoteOff`. For each pad:
   - Set `this.pads[i].active` and `.velocity = velocity / 127`
   - Call `this.emit('pad:on', { index: i, velocity: velocity / 127, note })`
   - `MidiManager` listens for this event and fires the matching `PadProxy` callbacks.

8. **Route CC values to knob indices** in `_handleCC`:
   - Set `this.knobs[i] = value / 127`

9. **Register the class in `src/hydra-synth.js` `_initMidi()`:**
   ```javascript
   import MpkMini from './lib/devices/mpk-mini.js'
   // in _initMidi():
   const manager = new MidiManager({ deviceClasses: [LPD8, MpkMini] })
   ```

10. **Test** by opening the dev server (`npm run dev`) and running these in the browser console:
    ```javascript
    midi.devices            // should list the new device name
    midi.controller         // should be an MpkMini instance
    midi.knob(0)            // should respond to physical knob
    ```

---

## Demo Sketch

The demo verifies all resolved API decisions in a single runnable sketch. It lives in
`dev/examples.js` (exported as `midiDemo`) and is wired into `dev/index.js`.

### Changes to `dev/index.js`

Two modifications only. The existing sketch is commented out, not deleted.

```javascript
// Line 22 — add detectMidi: true
window.hydra = new Hydra({ detectAudio: false, detectMidi: true, makeGlobal: true, matchMedia: true })

// Line 5 — add midiDemo to the destructured import
const { fugitiveGeometry, exampleVideo, exampleResize, nonGlobalCanvas, midiDemo } = require('./examples.js')

// Lines 26 — comment out the existing sketch, call midiDemo instead
// osc(10,2).mult(shape(4,0.1,2).kaleid(3)).repeat(4).out()
midiDemo()
```

### New function in `dev/examples.js`

Add `midiDemo` to the `module.exports` object (line 8 area) alongside the existing exports.

Then add this function body anywhere in the file:

```javascript
function midiDemo () {
  // Log connected hardware on load — helps verify hot-plug and device detection.
  // Runs once after init(); Web MIDI access is async so the list may be empty
  // for a frame if called before init() resolves.
  setTimeout(() => {
    console.log('[midiDemo] MIDI inputs:', midi.devices.map(d => d.name))
    console.log('[midiDemo] Active controller:', midi.controller ? midi.controller.name : 'none')
  }, 500)

  // --- Pad triggers (Q1: callbacks) ---

  // Pad 0: clear all outputs on hit — demonstrates discrete onTrigger callback.
  midi.pad(0).onTrigger(() => hush())

  // Pad 1: cycle kaleid symmetry on each hit — demonstrates stateful trigger.
  let kSides = 3
  midi.pad(1).onTrigger(() => {
    kSides = (kSides % 8) + 1
  })

  // --- Main sketch ---
  // Graceful defaults when no controller is connected:
  //   knob 0 → 0  → osc frequency 1 Hz
  //   knob 1 → 0  → no rotation
  //   knob 2 → 0  → no colorama shift
  //   pad 2 velocity → 0  → scale 0.4 (small but visible)

  osc(
    () => midi.knob(0) * 59 + 1,              // raw knob 0: frequency 1–60 Hz (Q4: no smooth)
    0.1,
    0.8
  )
    .rotate(
      () => time * midi.knob(1, { smooth: 0.9 }) * 4  // smoothed knob 1: rotation speed (Q4: opt-in)
    )
    .kaleid(() => kSides)                      // kaleid count driven by pad 1 trigger (Q1)
    .scale(
      () => midi.pad(2).velocity * 0.6 + 0.4  // polled pad 2 velocity: scale 0.4–1.0 (Q1)
    )
    .colorama(
      () => midi.knob(2, { smooth: 0.7 }) * 0.6  // smoothed knob 2: hue rotation (Q4)
    )
    .out(o0)
}
```

### What each line exercises

| Line | API surface | Decision covered |
|------|-------------|-----------------|
| `midi.pad(0).onTrigger(...)` | Pad event callback | Q1 Option C |
| `midi.pad(1).onTrigger(...)` | Stateful trigger | Q1 Option C |
| `midi.knob(0) * 59 + 1` | Raw knob read | Q4 — no smooth |
| `midi.knob(1, { smooth: 0.9 })` | Smoothed knob | Q4 Option C |
| `midi.pad(2).velocity` | Polled pad state | Q1 Option C |
| `midi.knob(2, { smooth: 0.7 })` | Smoothed knob (different factor) | Q4 Option C |
| `hush()` inside trigger | Global exposed via makeGlobal | `eval-sandbox.js` pattern |
| `setTimeout(... midi.devices ...)` | Device discovery | Q2 / `MidiManager.devices` |

### Expected visual behaviour

- **No controller connected:** static oscillator at 1 Hz, no rotation, small shape, no colorama.
  Sketch renders without errors.
- **Controller connected, all knobs at zero:** same as above.
- **Knob 0 turned up:** oscillator frequency increases, bands get tighter.
- **Knob 1 turned up:** shape rotates faster; smoothing (0.9) prevents visual stutter on coarse steps.
- **Knob 2 turned up:** hue shifts across the colorama range.
- **Pad 2 held:** shape grows from 0.4 to 1.0 scale proportional to strike velocity.
- **Pad 1 hit repeatedly:** kaleid symmetry steps through 3→4→5→…→8→3.
- **Pad 0 hit:** outputs clear instantly (`hush()`).
- **Unplug controller mid-sketch:** knobs freeze at last smoothed value then decay toward 0;
  pads return 0 velocity; `active` returns false. No console errors.
- **Replug controller:** pad triggers registered before disconnect fire again immediately
  (Q5 — callbacks survive reconnect).

---

## Implementation Tasks

Each task is atomic and independently testable. Do not begin a task until all listed
prerequisites are complete.

**Task 1 — Create `src/lib/midi-controller.js`**
- Prerequisites: none
- Implement the `MidiController` base class with:
  - `knobs: []` and `pads: []` instance properties (empty arrays; subclass sizes them)
  - `this._midiInput = null` in constructor
  - `get name()` — returns `this._midiInput?.name ?? ''`
  - `connect(midiInput)` — stores as `this._midiInput`, sets `midiInput.onmidimessage = this.onMessage.bind(this)`
  - `disconnect()` — clears `onmidimessage`, sets `this._midiInput = null`
  - `onMessage(event)` — throws `TypeError('MidiController.onMessage must be implemented by subclass')`
  - `tick(dt)` — no-op
  - `on(event, fn)`, `off(event, fn)`, `emit(event, data)` — minimal array-based emitter;
    `_listeners` is a plain object (`{}`) of string → Function[]
- Test by importing in a Node.js script (no browser required):
  - Verify `new MidiController()` constructs without error
  - Verify `name` returns `''` before connect
  - Verify `on('x', fn); emit('x', 42)` calls `fn(42)`
  - Verify `off('x', fn); emit('x', 1)` does not call `fn`
  - Verify `onMessage({})` throws

**Task 2 — Create `src/lib/devices/lpd8.js`**
- Prerequisites: Task 1
- Implement `LPD8` extending `MidiController` as specified in Files to Create section
- Define `PROGRAMS` static getter using values from the LPD8 Mappings section
- Size `knobs` to `Array(8).fill(0)` and `pads` to 8 PadState objects in constructor
- Implement `onMessage` routing to `_handleNoteOn`, `_handleNoteOff`, `_handleCC`
- Implement `setProgram(p)` — validates 1–4, sets `this.program`
- Test without a browser using synthetic MIDI byte arrays:
  - Feed CC message `[0xB0, 70, 64]` → verify `knobs[0] ≈ 0.504`
  - Feed Note On `[0x99, 36, 100]` → verify `pads[0].active === true`, `pads[0].velocity ≈ 0.787`
  - Feed Note Off `[0x89, 36, 0]` → verify `pads[0].active === false`
  - Verify an unrecognised note/CC is silently ignored

**Task 3 — Create `src/lib/midi-manager.js`**
- Prerequisites: Tasks 1, 2
- Implement `MidiManager` with `init()`, `tick()`, `knob()`, `pad()`, `setController()`,
  `controller` getter, `controllers` getter, `devices` getter
- `init()` must gracefully handle `navigator.requestMIDIAccess` being undefined (HTTP context
  or unsupported browser): log `'[hydra-synth] Web MIDI not available'` and resolve
- `_registerDevice` must listen to the controller's `'pad:on'` event and fire matching
  `_padProxies[index]._callbacks` — this wires controller events to sketch callbacks
- `_padProxies` must be a fixed-size array (size 16); each slot created lazily in `pad()`
- **Knob smoothing:** `_smoothState` is an array of 16 null slots. When `knob(i, {smooth: f})`
  is called and `_smoothState[i]` is null, initialise `{ smoothed: currentRaw, factor: f }`.
  In `tick(dt)`: for each non-null slot, `state.smoothed = state.smoothed * state.factor + raw * (1 - state.factor)`.
  `knob(i, {smooth})` returns `_smoothState[i].smoothed`; `knob(i)` without smooth option
  returns the raw value from `controller.knobs[i]`.
- **Controller selection:** `_preferredName` is initially null. `controller` getter: if
  `_preferredName` is non-null, iterate `_registry.values()` and return the first whose
  `ctrl.name.toLowerCase().includes(_preferredName.toLowerCase())`; return null if not found.
  If `_preferredName` is null, return first entry in `_registry` or null.
  `setController(nameSubstring)` sets `this._preferredName = nameSubstring || null`.
  `controllers` getter returns `Array.from(this._registry.values())`.
- `knob()` and `pad()` must return safe zero/false/no-op values when `controller` is null
- Test by manually instantiating in browser DevTools and calling `init()`:
  - `midi.devices` returns an array (empty or populated)
  - `midi.knob(0)` returns `0` with no controller
  - `midi.knob(0, { smooth: 0.9 })` returns `0` without error and creates a smooth slot
  - `midi.pad(0).velocity` returns `0` with no controller
  - `midi.pad(0).onTrigger(fn)` registers without error
  - `midi.setController('nonexistent')` makes `midi.controller` return null
  - `midi.setController(null)` reverts to first-connected behaviour

**Task 4 — Modify `src/hydra-synth.js`: imports, constructor option, synth property**
- Prerequisites: Task 3
- Add `MidiManager` and `LPD8` imports at lines 1–12 (after existing imports)
- Add `detectMidi = false` to the constructor destructuring (line 21–34)
- Add `this.detectMidi = detectMidi` alongside `this.detectAudio = detectAudio` (line 43 area)
- Add `midi: null` to `this.synth` object literal (lines 49–66)
- Test: construct `new Hydra({ detectMidi: false })` in `dev/index.js`; no errors; `typeof window.midi` is `'object'` and equals `null`

**Task 5 — Modify `src/hydra-synth.js`: `_initMidi()` method and tick integration**
- Prerequisites: Task 4
- Insert `_initMidi()` method after line 230 (after `_initAudio` body closes)
- Insert `if (detectMidi) this._initMidi()` at line 123 (between line 122 and line 124)
- Insert `if (this.detectMidi && this.synth.midi) this.synth.midi.tick(dt)` in `tick()` after
  line 427
- Test: construct `new Hydra({ detectMidi: true })` in `dev/index.js`; `window.midi` is a
  `MidiManager` instance; `midi.knob(0)` returns `0`; no console errors with no device

**Task 6 — Hardware integration test**
- Prerequisites: Task 5
- Open the dev server (`npm run dev`) with an LPD8 connected
- In the browser console, verify:
  - `midi.devices` lists the LPD8 by name
  - `midi.controller` is an `LPD8` instance
  - Moving knob 0 changes `midi.knob(0)` in real time
  - Hitting pad 0 briefly sets `midi.pad(0).active === true`
  - `midi.pad(0).velocity` reflects the strike intensity
- If any note/CC numbers in the `PROGRAMS` table are wrong, update the `PROGRAMS` static getter
  in `src/lib/devices/lpd8.js` with the observed values and document the correction here

**Task 7 — Hot-plug test**
- Prerequisites: Task 6
- With a sketch running that uses `() => midi.knob(0)`, physically unplug the LPD8
- Verify: `midi.controller === null`; `midi.knob(0) === 0`; no unhandled errors; sketch
  continues rendering
- Replug the LPD8
- Verify: `midi.controller` is restored; knob responds to physical input; callbacks registered
  before disconnect fire on pad hits (no page reload required)
- This is a manual test; pass/fail is observed in the browser

**Task 8 — Write the demo sketch**
- Prerequisites: Task 5 (MIDI wired into HydraRenderer; `window.midi` available)
- Modify `dev/examples.js`:
  - Add `midiDemo` to the `module.exports` object (line 8)
  - Add the `midiDemo()` function body exactly as specified in the Demo Sketch section of this plan
- Modify `dev/index.js`:
  - Add `detectMidi: true` to the `new Hydra({...})` constructor call (line 22)
  - Add `midiDemo` to the destructured import from `./examples.js` (line 5)
  - Comment out the existing sketch at line 26 (`osc(10,2)...`)
  - Add `midiDemo()` call in its place
- Test by opening the dev server (`npm run dev`) and manually verifying each row of the
  "What each line exercises" table in the Demo Sketch section
- The browser console should print MIDI input names ~500 ms after page load; if the list
  is empty, the Web MIDI permission was denied or the device is not connected

---

## Resolved Decisions

All five open questions are answered. The implementing agent must follow these decisions exactly.

| # | Question | Decision |
|---|----------|----------|
| Q1 | Pad interaction model | **Option C** — `PadProxy` exposes `velocity`, `active`, AND `onTrigger`. Both polled state and event callbacks are implemented. |
| Q2 | Primary controller selection | **Option C** — `midi.setController(nameSubstring)` pins the primary by name. Reverts to first-connected when called with `null`. `midi.controllers` returns all connected instances. |
| Q3 | `detectMidi` default | **`false`** — opt-in. Hydra-editor or the sketch must pass `detectMidi: true` explicitly. |
| Q4 | Knob smoothing | **Option C** — opt-in via `midi.knob(i, { smooth: 0.85 })`. Raw knobs are unchanged. Smooth state is maintained in `_smoothState` inside `MidiManager` and advanced in `tick()`. |
| Q5 | `onTrigger` callback persistence | **Option B** — callbacks stored on `PadProxy` (owned by `MidiManager`), survive controller disconnect/reconnect. No page reload needed. |

**Q4 smoothing formula** (frame-rate dependent, matches `array-utils.js` idiom):
```
state.smoothed = state.smoothed * factor + rawKnobValue * (1 - factor)
```
`factor = 0` → no smoothing (instant). `factor = 0.9` → heavy smoothing. Values ≥ 1 are
invalid and must be clamped or warned against. The raw `controller.knobs[i]` value is never
modified — smoothing is a read-side concern in `MidiManager` only.

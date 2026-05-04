# API Reference — Hydra-Synth

This document covers every public class, function, and constant exported or exposed by the
hydra-synth library. Internal helpers are included where they are load-bearing for correctness.

Cross-references: `docs/ARCHITECTURE.md` for data-flow context, `harness/context/glossary.md`
for term definitions, `harness/context/adr.md` for design rationale.

---

## Table of Contents

1. [HydraRenderer](#1-hydrarenderer)
2. [GlslSource](#2-glslsource)
3. [Output](#3-output)
4. [HydraSource](#4-hydrasource)
5. [GeneratorFactory](#5-generatorfactory)
6. [EvalSandbox](#6-evalsandbox)
7. [formatArguments()](#7-formatarguments)
8. [generateGlsl()](#8-generateglsl)
9. [ArrayUtils](#9-arrayutils)
10. [Audio](#10-audio)
11. [The synth object](#11-the-synth-object)
12. [GLSL Transforms — src type](#12-glsl-transforms--src-type)
13. [GLSL Transforms — coord type](#13-glsl-transforms--coord-type)
14. [GLSL Transforms — color type](#14-glsl-transforms--color-type)
15. [GLSL Transforms — combine type](#15-glsl-transforms--combine-type)
16. [GLSL Transforms — combineCoord type](#16-glsl-transforms--combinecoord-type)
17. [Array.prototype extensions](#17-arrayprototype-extensions)

---

## 1. HydraRenderer

**File:** `src/hydra-synth.js`
**Export:** `export default HydraRenderer`
**ESM import path:** `src/hydra-synth.js` (via `package.json` exports map)

The top-level orchestrator. Initialises the WebGL canvas, outputs, sources, the render loop,
audio analysis, and the user-facing `synth` API object.

### Constructor

```js
/**
 * @param {object} [opts]
 * @param {object|null} [opts.pb=null]            PeerBroker instance for p2p streams
 * @param {number} [opts.width=1280]              Canvas width in pixels
 * @param {number} [opts.height=720]              Canvas height in pixels
 * @param {number} [opts.numSources=4]            Number of source buffers (s0–s3)
 * @param {number} [opts.numOutputs=4]            Number of output buffers (o0–o3)
 * @param {boolean} [opts.makeGlobal=true]        Inject synth properties onto window
 * @param {boolean} [opts.autoLoop=true]          Start raf-loop immediately
 * @param {boolean} [opts.detectAudio=true]       Initialise Meyda audio analyser
 * @param {boolean} [opts.enableStreamCapture=true] Attach canvas.captureStream()
 * @param {HTMLCanvasElement} [opts.canvas]       Provide existing canvas; else creates one
 * @param {'lowp'|'mediump'|'highp'} [opts.precision]  GLSL float precision; auto-detected if omitted
 * @param {object|Array} [opts.extendTransforms={}]  Additional transform definitions to register
 */
new HydraRenderer(opts)
```

**Invariants:**
- Calls `ArrayUtils.init()` once, patching `Array.prototype`
- If `canvas` is not provided, creates a full-viewport canvas and appends it to `document.body`
- Precision defaults to `'highp'` on iOS, `'mediump'` elsewhere
- `extendTransforms` accepts either an array of definition objects or a single object with a `type` field. Due to F-001 (`generator-factory.js:36`), the array form is silently discarded; only the single-object form works. See `harness/findings.md`.

### `HydraRenderer.prototype.eval(code)`

```js
/**
 * @param {string} code  JavaScript source to evaluate in the synth context
 */
eval(code)
```

Evaluates `code` via `EvalSandbox`. In `makeGlobal: true` mode this is equivalent to
`eval(code)` in the global scope. No isolation is provided.

### `HydraRenderer.prototype.getScreenImage(callback)`

```js
/**
 * @param {function(Blob): void} callback  Called with a PNG Blob of the current canvas
 */
getScreenImage(callback)
```

Flags `saveFrame = true`; on the next tick, calls `callback` with the canvas PNG blob
instead of triggering a download.

### `HydraRenderer.prototype.hush()`

Clears all sources, renders `solid(0,0,0,0)` to all outputs, resets `update` and
`afterUpdate` to no-ops. The canonical "reset to black" operation.

### `HydraRenderer.prototype.loadScript(url)`

```js
/**
 * @param {string} [url='']  URL of a JavaScript file to inject into document.head
 * @returns {Promise<void>}
 */
loadScript(url)
```

Dynamically injects a `<script>` tag. Resolves on `onload`, also resolves (not rejects) on
`onerror`. Intended for loading external libraries from the live-coding console.

### `HydraRenderer.prototype.setResolution(width, height)`

```js
/**
 * @param {number} width   New canvas width in pixels
 * @param {number} height  New canvas height in pixels
 */
setResolution(width, height)
```

Resizes the canvas, all outputs, all sources, and calls `regl._refresh()`. Exposed on the
`synth` object as `synth.setResolution`. Contains debug `console.log` calls (F-007).

### `HydraRenderer.prototype.tick(dt, uniforms)`

```js
/**
 * @param {number} dt  Milliseconds since last frame (from raf-loop)
 */
tick(dt)
```

The main render loop body. Per frame:
1. Calls `sandbox.tick()` to re-sync mutable user properties from `window`
2. Increments `synth.time` by `dt * 0.001 * synth.speed`
3. Calls `synth.update(timeSinceLastUpdate)`
4. Ticks all sources and outputs
5. Blits to canvas via `renderAll` or `renderFbo`
6. Calls `synth.afterUpdate(timeSinceLastUpdate)`
7. Saves a frame if `saveFrame` is set

Called automatically by `raf-loop` when `autoLoop: true`. Can be called manually for testing.

### `HydraRenderer.prototype.createSource(i)`

```js
/**
 * @param {number} i  Index for labelling (used as s{i} in synth)
 * @returns {HydraSource}
 */
createSource(i)
```

Creates and registers a new `HydraSource`. Called internally for `s0`–`s3`; can be called
externally to add more sources beyond the default four.

---

## 2. GlslSource

**File:** `src/glsl-source.js`
**Export:** `export default GlslSource`

The chain-builder object. Every `src`-type generator function (e.g. `osc()`, `noise()`)
returns a new `GlslSource` instance. Subsequent chained methods push transforms onto
`this.transforms` and return `this`.

This class is never instantiated directly by user code. `GeneratorFactory` creates a subclass
that inherits all prototype methods registered by `_addMethod()`.

### Constructor (internal)

```js
/**
 * @param {object} obj
 * @param {object} obj.transform  The transform definition object (from glsl-functions.js)
 * @param {string} obj.name       Transform name (GLSL function name)
 * @param {Array}  obj.userArgs   Arguments passed by the user
 * @param {Output} obj.defaultOutput
 * @param {object} obj.defaultUniforms
 * @param {GeneratorFactory} obj.synth
 */
new GlslSource(obj)
```

### `GlslSource.prototype.addTransform(obj)`

Appends a transform to `this.transforms`. Called by each chained method (e.g. `.rotate()`).

### `GlslSource.prototype.out(_output)`

```js
/**
 * @param {Output} [_output]  Defaults to defaultOutput (o0) if not provided
 */
out(_output)
```

Triggers GLSL compilation and registers the result with `output.render()`. Silently swallows
shader compile errors (logs a warning). `.out()` with no argument renders to `o0`.

**Invariant:** If any transform in the chain has `type === 'renderpass'`, it is skipped with
a `console.warn`. Renderpass is not implemented.

### `GlslSource.prototype.glsl()`

Returns the array of render passes (currently always length 0 or 1, since renderpass is
unimplemented). Calls `this.compile(transforms)`.

### `GlslSource.prototype.compile(transforms)`

```js
/**
 * @param {Array} transforms  Accumulated transform chain
 * @returns {{ frag: string, uniforms: object }}
 */
compile(transforms)
```

Assembles the full GLSL fragment shader string by:
1. Calling `generateGlsl(transforms, synth)` to get `{ uniforms, glslFunctions, fragColor }`
2. Emitting precision declaration, uniform declarations, utility functions, transform functions
3. Emitting `void main()` with the `fragColor` expression

The returned `uniforms` object merges `defaultUniforms` (time, resolution, prevBuffer) with
the transform-specific uniforms.

---

## 3. Output

**File:** `src/output.js`
**Export:** `export default Output`

Function constructor (not ES6 class). Wraps two `regl` framebuffers and a compiled draw call.

### Constructor

```js
/**
 * @param {object} opts
 * @param {object} opts.regl        regl instance
 * @param {string} opts.precision   GLSL precision ('mediump' | 'highp' | 'lowp')
 * @param {string} [opts.label='']  Label for debugging (e.g. 'o0')
 * @param {number} opts.width       FBO width in pixels
 * @param {number} opts.height      FBO height in pixels
 */
new Output(opts)
```

Creates two FBOs with `mag: 'nearest'` filtering and `rgba` format. Always `depthStencil: false`.

### `Output.prototype.getCurrent()`

Returns `this.fbos[this.pingPongIndex]` — the FBO most recently rendered into.
Used by other outputs reading this one as a texture input (e.g. `src(o0)`).

### `Output.prototype.getTexture()`

Returns `this.fbos[this.pingPongIndex ? 0 : 1]` — the FBO from the *previous* frame.
Used as `prevBuffer` inside this output's own shader for feedback effects.

**Invariant:** `getCurrent()` and `getTexture()` always return different FBOs.

### `Output.prototype.render(passes)`

```js
/**
 * @param {Array<{frag: string, uniforms: object}>} passes
 */
render(passes)
```

Compiles `passes[0]` into a `regl` draw command (`this.draw`). Only `passes[0]` is used;
multi-pass rendering is not implemented. Sets `prevBuffer` to read from the current FBO
(before it flips), ensuring the shader sees last frame's result.

`pingPongIndex` is toggled inside the `framebuffer` callback (executed by regl just before
each draw call), so it reflects the correct write target for the current frame.

### `Output.prototype.tick(props)`

```js
/**
 * @param {{ time: number, mouse: object, bpm: number, resolution: number[] }} props
 */
tick(props)
```

Calls `this.draw(props)`. The draw command was compiled by `render()`. If `render()` was
never called, `this.draw` is a no-op.

### `Output.prototype.resize(width, height)`

Resizes both FBOs. Called by `HydraRenderer.setResolution()`.

### `Output.prototype.init()`

Resets `transformIndex`, `fragHeader`, `fragBody`, `vert`, `attributes`, `uniforms`, and `frag`
to their defaults. Called in the constructor. Not typically called externally.

---

## 4. HydraSource

**File:** `src/hydra-source.js`
**Export:** `export default HydraSource`

ES6 class. Manages a single media texture input (webcam, video, image, canvas, screen, stream).
Exposed as `s0`–`s3` on the `synth` object.

### Constructor

```js
/**
 * @param {object} opts
 * @param {object} opts.regl
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {object|null} [opts.pb]    PeerBroker for p2p streams
 * @param {string} [opts.label='']
 */
new HydraSource(opts)
```

Initialises a 1×1 placeholder texture. `this.dynamic = true` means the texture is updated
every tick.

### `HydraSource.prototype.init(opts, params)`

```js
/**
 * @param {{ src: HTMLElement, dynamic?: boolean }} opts
 * @param {object} [params]  Additional regl texture parameters
 */
init(opts, params)
```

General-purpose initialiser. If `opts.src` is provided, creates a regl texture from it.

### `HydraSource.prototype.initCam(index, params)`

Requests webcam access via `Webcam(index)` (from `lib/webcam.js`). On success, sets
`this.dynamic = true` and creates a video texture.

### `HydraSource.prototype.initVideo(url, params)`

Creates a `<video>` element (`autoplay`, `loop`, `muted`). Starts texture upload on
`loadeddata`. Sets `this.dynamic = true`.

### `HydraSource.prototype.initImage(url, params)`

Creates an `<img>` element. On `onload`, creates a static texture. Sets `this.dynamic = false`.

### `HydraSource.prototype.initStream(streamName, params)`

Registers a p2p stream with `this.pb` (PeerBroker). On `'got video'` event, creates a
video texture. Sets `this.dynamic = true`. Requires `pb` to be set in the constructor.

### `HydraSource.prototype.initScreen(index, params)`

Requests screen capture via `lib/screenmedia.js` (`getDisplayMedia`). Sets `this.dynamic = true`.

### `HydraSource.prototype.initCanvas(width, height)`

```js
/**
 * @param {number} [width=1000]
 * @param {number} [height=1000]
 * @returns {CanvasRenderingContext2D}
 */
initCanvas(width, height)
```

Creates or reuses a canvas (keyed by `this.label`). Calls `this.init({ src: canvas })`.
Returns the 2D context so caller can draw to it. Canvas is reused across calls; cleared if
dimensions match.

### `HydraSource.prototype.tick(time)`

If `this.src` exists and `this.dynamic === true`, calls `this.tex.subimage(this.src)` to
upload the current frame to the GPU. Also resizes the texture if the video dimensions changed.

### `HydraSource.prototype.getTexture()`

Returns `this.tex` (the regl texture). Used by `format-arguments.js` when a source is
passed as a texture argument.

### `HydraSource.prototype.clear()`

Stops all active media tracks on `this.src.srcObject`, nulls `this.src`, and resets the
texture to a 1×1 placeholder.

### `HydraSource.prototype.resize(width, height)`

Updates `this.width` and `this.height`. Does not resize the underlying texture — texture
size is managed by `tick()`.

---

## 5. GeneratorFactory

**File:** `src/generator-factory.js`
**Export:** `export default GeneratorFactory`

ES6 class. Processes GLSL transform definitions into JavaScript functions and prototype
methods. Not directly accessible to end users; consumed by `HydraRenderer`.

### Constructor

```js
/**
 * @param {object} opts
 * @param {object} opts.defaultUniforms   Merged into every compiled shader's uniforms
 * @param {Output} opts.defaultOutput     The output used when .out() is called with no arg
 * @param {Array|object} [opts.extendTransforms=[]]  Additional transforms (see F-001 in findings.md)
 * @param {function} [opts.changeListener]  Called with {type, method, synth} on add/remove
 */
new GeneratorFactory(opts)
```

### `GeneratorFactory.prototype.setFunction(obj)`

```js
/**
 * @param {{ name, type, inputs, glsl }} obj  A transform definition object
 */
setFunction(obj)
```

The public extension API. Calls `processGlsl(obj)` to build the GLSL function, then
`_addMethod()` to register it. Exposed on `synth` as `synth.setFunction`. Triggers
`changeListener({type: 'add', …})` so `EvalSandbox` can register the new function globally.

### `GeneratorFactory.prototype._addMethod(method, transform)` (internal)

For `src`-type transforms: creates a generator function in `this.generators{}` that returns a
new `GlslSource` instance. For all other types: adds a prototype method to `this.sourceClass`.

### `processGlsl(obj)` (module-private function)

```js
/**
 * @param {{ name, type, inputs, glsl }} obj
 * @returns {{ name, type, inputs, glsl: string } | undefined}
 */
```

Looks up `typeLookup[obj.type]` to get the return type and first implicit argument. Assembles
the full GLSL function declaration. Returns `undefined` and logs a warning if `type` is
unrecognised.

**Invariant:** The `inputs` array on the returned object has the first implicit argument
(e.g. `vec2 _st` for `src`) stripped — `generate-glsl.js` handles it separately.

### `typeLookup` (module constant)

```js
const typeLookup = {
  'src':          { returnType: 'vec4', args: [{ type: 'vec2', name: '_st' }] },
  'coord':        { returnType: 'vec2', args: [{ type: 'vec2', name: '_st' }] },
  'color':        { returnType: 'vec4', args: [{ type: 'vec4', name: '_c0' }] },
  'combine':      { returnType: 'vec4', args: [{ type: 'vec4', name: '_c0' }, { type: 'vec4', name: '_c1' }] },
  'combineCoord': { returnType: 'vec2', args: [{ type: 'vec2', name: '_st' }, { type: 'vec4', name: '_c0' }] }
}
```

---

## 6. EvalSandbox

**File:** `src/eval-sandbox.js`
**Export:** `export default EvalSandbox`

Manages the bridge between `synth` object properties and the global `window` scope.

### Constructor

```js
/**
 * @param {object} parent       The synth object
 * @param {boolean} makeGlobal  Whether to mirror properties onto window
 * @param {string[]} userProps  Property names re-synced from window on every tick
 */
new EvalSandbox(parent, makeGlobal, userProps)
```

### `EvalSandbox.prototype.add(name)`

Mirrors `parent[name]` onto `window[name]` if `makeGlobal`. Called when a new generator
function is registered.

### `EvalSandbox.prototype.set(property, value)`

Sets `parent[property]` and, if `makeGlobal`, sets `window[property]`. Used for mutable
state like `time` and `width`.

### `EvalSandbox.prototype.tick()`

Re-syncs `userProps` from `window` back to `parent`. This is how user console assignments
(e.g. `speed = 2`) take effect: the user mutates `window.speed`; `tick()` propagates it to
`synth.speed` on the next frame.

### `EvalSandbox.prototype.eval(code)`

Calls `this.sandbox.eval(code)` which delegates to `globalThis.eval`. No isolation.

---

## 7. formatArguments()

**File:** `src/format-arguments.js`
**Export:** `export default formatArguments`

Resolves a transform's user-supplied arguments into typed argument descriptors that the GLSL
emitter understands.

```js
/**
 * @param {object} transform          A transform entry from GlslSource.transforms[]
 * @param {number} startIndex         Current uniform count; appended to uniform names
 * @returns {Array<TypedArg>}
 *
 * TypedArg = {
 *   value:     any          — inline GLSL string, function, or GlslSource
 *   type:      string       — 'float' | 'vec4' | 'sampler2D' | etc.
 *   isUniform: boolean      — true if value must be uploaded as a GPU uniform
 *   name:      string       — uniform name (= input.name + startIndex if isUniform)
 *   vecLen:    number        — parsed from type string (e.g. 4 for 'vec4'), else 0
 * }
 */
formatArguments(transform, startIndex)
```

**Resolution rules (in priority order):**
1. User-supplied `GlslSource` for a `vec4` input → used as nested shader input (not uniform)
2. User-supplied function → wrapped as a `(context, props) => value` uniform callback
3. User-supplied array → wrapped as `arrayUtils.getValue(arr)` uniform callback
4. User-supplied `sampler2D` texture object → wrapped as `() => x.getTexture()` uniform
5. User-supplied number for `float` → inlined as GLSL literal with a decimal dot
6. User-supplied array for `vec` type → inlined as GLSL constructor (e.g. `vec4(1., 0., 0., 1.)`)
7. Default from definition → used as fallback

**Invariant:** The uniform name is `input.name + startIndex`. `startIndex` is the length of
the uniforms array *before* this transform's inputs are added, ensuring global uniqueness across
the entire chain.

**Known limitation:** `startIndex < 0` disables all uniform registration. This path is used
internally by `GlslSource.glsl()` but is not fully documented in code.

---

## 8. generateGlsl()

**File:** `src/generate-glsl.js`
**Export:** `export default generateGlsl`

Converts a transform chain into a GLSL body string plus metadata.

```js
/**
 * @param {Array} transforms  GlslSource.transforms[]
 * @returns {{ uniforms: TypedArg[], glslFunctions: object[], fragColor: string }}
 */
generateGlsl(transforms)
```

Builds a closure chain where each transform wraps the previous one. The final closure is called
with `('c', 'st')` to emit the GLSL body. This closure-on-closure pattern encodes the
dependency on evaluation order without building an AST.

**Invariant:** Duplicate GLSL function definitions are deduplicated by name before output
(prevents the same function body appearing twice if a transform is used more than once in a chain).

---

## 9. ArrayUtils

**File:** `src/lib/array-utils.js`
**Export:** `export default { init, getValue }`

### `ArrayUtils.init()`

Patches `Array.prototype` with `.fast()`, `.smooth()`, `.ease()`, `.offset()`, `.fit()`.
Must be called exactly once (called by `HydraRenderer` constructor). The added properties are
non-enumerable JavaScript properties. See [Array.prototype extensions](#17-arrayprototype-extensions).

### `ArrayUtils.getValue(arr)`

```js
/**
 * @param {Array} arr  An array (possibly with ._speed, ._smooth, ._ease, ._offset metadata)
 * @returns {function({ time: number, bpm: number }): number}
 */
getValue(arr)
```

Returns a regl uniform callback that, when called with `{ time, bpm }`, computes the current
value from the array by time-indexing with optional smoothing/easing. Used by `format-arguments.js`
when a user passes an array as a transform argument.

**Interpolation logic:**
- `index = time * speed * (bpm/60) + offset`
- If `_smooth !== 0`: linearly interpolates between `arr[floor(index)]` and `arr[ceil(index)]`
  using the easing function, with wrap-around via modulo
- If `_smooth === 0`: steps to `arr[floor(index % arr.length)]`

---

## 10. Audio

**File:** `src/lib/audio.js`
**Export:** `export default Audio`

ES6 class. Meyda-based FFT analyser with beat detection. Created by `HydraRenderer` when
`detectAudio: true`. Exposed on the `synth` object as `synth.a`.

### Constructor

```js
/**
 * @param {object} opts
 * @param {number} [opts.numBins=4]      Number of frequency bands
 * @param {number} [opts.cutoff=2]       Minimum level before a bin registers
 * @param {number} [opts.smooth=0.4]     Smoothing factor (0 = no smooth, 1 = max smooth)
 * @param {number} [opts.max=15]         Deprecated; use scale instead
 * @param {number} [opts.scale=10]       Scaling factor for FFT values
 * @param {boolean} [opts.isDrawing=false]  Render visualiser canvas
 * @param {HTMLElement} [opts.parentEl=document.body]
 */
new Audio(opts)
```

Requests microphone access via `navigator.mediaDevices.getUserMedia`. Creates a
`canvas` (100×80px) appended to `parentEl` for optional visualisation.

### `Audio.prototype.tick()`

Reads features from the Meyda analyser. Updates `this.bins`, `this.prevBins`, `this.fft`.
Calls `detectBeat(this.vol)`. Calls `draw()` if `isDrawing`. No-op if Meyda is not
initialised yet.

### `Audio.prototype.setBins(numBins)`

```js
/** @param {number} numBins */
setBins(numBins)
```

Sets the number of FFT bands. Also registers `window['a0']`–`window['a{n}']` as closures.

**Known bug (F-005):** The closures reference the global variable `a` instead of `this`.
This works only when `makeGlobal: true` (because then `window.a === synth.a`). In
`makeGlobal: false` mode, `a` is undefined and the closures throw.

### `Audio.prototype.setCutoff(cutoff)` / `setSmooth(smooth)` / `setScale(scale)`

Update per-bin settings uniformly across all bins.

### `Audio.prototype.detectBeat(level)`

Threshold-based beat detector. Fires `this.onBeat()` when `level` exceeds the adaptive cutoff.
Adaptive cutoff decays toward `beat.threshold` between beats.

### Public properties (post-init)

| Property | Type | Description |
|----------|------|-------------|
| `a.fft` | `number[]` | Normalised FFT values, length = `numBins`, range [0, 1] |
| `a.bins` | `number[]` | Raw (smoothed) bin values before scale/cutoff normalisation |
| `a.vol` | `number` | Total loudness from Meyda |
| `a.onBeat` | `function` | Callback fired on beat detection; override to respond to beats |

---

## 11. The `synth` Object

The `synth` object is the stable user-facing API surface. When `makeGlobal: true` (default),
all its properties are also accessible as global variables.

| Property | Type | Description |
|----------|------|-------------|
| `time` | `number` | Elapsed time in seconds, scaled by `speed` |
| `bpm` | `number` | Beats per minute; used by array sequencing |
| `speed` | `number` | Time multiplier; set by user to control animation rate |
| `width` | `number` | Canvas width (read-only; use `setResolution` to change) |
| `height` | `number` | Canvas height (read-only; use `setResolution` to change) |
| `fps` | `number\|undefined` | Target FPS cap; `undefined` = uncapped |
| `stats.fps` | `number` | Measured FPS (updated each frame) |
| `mouse` | `MouseTools` | `{ x, y, buttons, shift, alt, control, meta }` |
| `render(output)` | `function` | Set which output to display; no arg = show all four in quad |
| `setResolution(w,h)` | `function` | Resize canvas and all FBOs |
| `hush()` | `function` | Reset all outputs to black, clear sources |
| `tick(dt)` | `function` | Manually advance the render loop by `dt` ms |
| `screencap()` | `function` | Trigger a PNG download of the current frame |
| `vidRecorder` | `VidRecorder` | MediaRecorder wrapper for .webm export |
| `a` | `Audio` | Audio analyser instance (when `detectAudio: true`) |
| `setFunction(obj)` | `function` | Register a custom GLSL transform at runtime |
| `update` | `function(dt)` | User-overridable per-frame callback |
| `afterUpdate` | `function(dt)` | User-overridable post-render callback |
| `o0`–`o3` | `Output` | Output framebuffers |
| `s0`–`s3` | `HydraSource` | Source texture slots |
| `osc`, `noise`, … | `function` | All registered generator functions |

---

## 12. GLSL Transforms — `src` type

`src`-type functions create a new `GlslSource`. They are called as standalone functions.
They accept a UV coordinate (`vec2`) and return a colour (`vec4`).

### `noise(scale, offset)`
```
@param {float|function|Array} [scale=10]   Spatial frequency of the noise field
@param {float|function|Array} [offset=0.1] Time-based animation offset
```
Simplex 3D noise (Ian McEwan / Ashima Arts). Returns greyscale. The third noise dimension is
`offset * time`, so higher `offset` values animate faster.

### `voronoi(scale, speed, blending)`
```
@param {float} [scale=5]     Cell density
@param {float} [speed=0.3]   Cell animation speed
@param {float} [blending=0.3] Edge softness
```
Animated Voronoi diagram. `blending` controls how much the cell edges are darkened.

### `osc(frequency, sync, offset)`
```
@param {float} [frequency=60]  Spatial frequency (number of stripes visible)
@param {float} [sync=0.1]      Time-based animation rate
@param {float} [offset=0]      Phase offset between RGB channels
```
Animated oscillator (sine wave stripes). `offset` shifts the R and B channels relative to G,
creating colour fringing.

### `shape(sides, radius, smoothing)`
```
@param {float} [sides=3]       Number of polygon sides (use floats for star-like effects)
@param {float} [radius=0.3]    Radius of the shape (0–1)
@param {float} [smoothing=0.01] Edge anti-aliasing width
```
Filled polygon, white on black background. `sides=4` = diamond, `sides=100` ≈ circle.

### `gradient(speed)`
```
@param {float} [speed=0]  Animation speed; 0 = static UV gradient
```
UV position gradient: R = x, G = y, B = `sin(time * speed)`.

### `src(tex)`
```
@param {HydraSource|Output} tex  A source buffer (s0–s3) or output buffer (o0–o3)
```
Samples a texture at UV coordinates. `fract(_st)` is applied, so coordinates wrap.
Pass an `Output` to read another output's current frame as a texture.

### `solid(r, g, b, a)`
```
@param {float} [r=0]  Red
@param {float} [g=0]  Green
@param {float} [b=0]  Blue
@param {float} [a=1]  Alpha
```
Constant colour. Used by `hush()` to clear outputs.

### `prev`
No inputs. Samples `prevBuffer` — the previous frame of the current output. Equivalent to
`src(o0)` within the same output's chain, but reads the FBO from `getTexture()` rather than
`getCurrent()`.

---

## 13. GLSL Transforms — `coord` type

`coord`-type methods modify UV coordinates before the source samples them. They are chained
after a `src`-type call. They receive and return `vec2`.

**Important:** `coord` transforms execute in reverse chain order relative to `color` transforms.
A `.rotate().osc()` chain applies the rotation to the UV *before* `osc` samples it.

### `rotate(angle, speed)`
```
@param {float} [angle=10]  Rotation in radians (around centre of image)
@param {float} [speed=0]   Additional rotation per second
```

### `scale(amount, xMult, yMult, offsetX, offsetY)`
```
@param {float} [amount=1.5]  Uniform scale factor (>1 = zoom out, <1 = zoom in)
@param {float} [xMult=1]     X-axis scale multiplier
@param {float} [yMult=1]     Y-axis scale multiplier
@param {float} [offsetX=0.5] Pivot X (0–1)
@param {float} [offsetY=0.5] Pivot Y (0–1)
```

### `pixelate(pixelX, pixelY)`
```
@param {float} [pixelX=20]  Horizontal pixel block size
@param {float} [pixelY=20]  Vertical pixel block size
```
Quantises UV coordinates into blocks, creating a pixelated effect.

### `repeat(repeatX, repeatY, offsetX, offsetY)`
```
@param {float} [repeatX=3]   Horizontal tile count
@param {float} [repeatY=3]   Vertical tile count
@param {float} [offsetX=0]   Horizontal alternating row offset
@param {float} [offsetY=0]   Vertical alternating column offset
```

### `repeatX(reps, offset)` / `repeatY(reps, offset)`
Single-axis repeat variants.
```
@param {float} [reps=3]    Number of repetitions
@param {float} [offset=0]  Alternating offset between rows/columns
```

### `kaleid(nSides)`
```
@param {float} [nSides=4]  Number of kaleidoscope mirror segments
```
Polar mirror effect. Folds UV space around the centre into `nSides` symmetric sections.

### `scroll(scrollX, scrollY, speedX, speedY)`
```
@param {float} [scrollX=0.5]  Horizontal scroll offset
@param {float} [scrollY=0.5]  Vertical scroll offset
@param {float} [speedX=0]     Horizontal auto-scroll rate
@param {float} [speedY=0]     Vertical auto-scroll rate
```

### `scrollX(scrollX, speed)` / `scrollY(scrollY, speed)`
Single-axis scroll variants.

---

## 14. GLSL Transforms — `color` type

`color`-type methods transform the colour after it has been sampled. They receive and return `vec4`.

### `posterize(bins, gamma)`
```
@param {float} [bins=3]    Number of colour steps per channel
@param {float} [gamma=0.6] Gamma correction applied before posterisation
```

### `shift(r, g, b, a)`
```
@param {float} [r=0.5]  Hue-shift applied to red channel (wraps)
@param {float} [g=0]    Green channel shift
@param {float} [b=0]    Blue channel shift
@param {float} [a=0]    Alpha channel shift
```

### `invert(amount)`
```
@param {float} [amount=1]  Mix factor between original and inverted (0 = original, 1 = full invert)
```

### `contrast(amount)`
```
@param {float} [amount=1.6]  Contrast multiplier around 0.5 midpoint
```

### `brightness(amount)`
```
@param {float} [amount=0.4]  Additive brightness offset applied to all channels
```

### `mask(mask)`
```
@param {GlslSource} mask  A GlslSource chain whose luminance is used as an alpha mask
```
Multiplies the current colour's alpha by the luminance of `mask`. Used for compositing.

### `luma(threshold, tolerance)`
```
@param {float} [threshold=0.5]  Luminance cutoff
@param {float} [tolerance=0.1]  Soft edge width around threshold
```
Keying operation. Pixels below the threshold become transparent.

### `thresh(threshold, tolerance)`
```
@param {float} [threshold=0.5]
@param {float} [tolerance=0.04]
```
Hard threshold. Pixels above become white (1,1,1,1); below become black (0,0,0,1).

### `color(r, g, b, a)`
```
@param {float} [r=1]  Multiply red channel
@param {float} [g=1]  Multiply green channel
@param {float} [b=1]  Multiply blue channel
@param {float} [a=1]  Multiply alpha channel
```
Per-channel colour multiplication. Use values <1 to tint, >1 to oversaturate.

### `saturate(amount)`
```
@param {float} [amount=2]  Saturation multiplier (0 = greyscale, 1 = unchanged, 2 = double)
```
Converts to HSV, scales S, converts back to RGB.

### `hue(hue)`
```
@param {float} [hue=0.4]  Hue rotation in [0, 1] range (wraps)
```

### `colorama(amount)`
```
@param {float} [amount=0.005]  Shift amount applied to all HSV channels
```
Shifts H, S, and V simultaneously by `amount`. Small values create subtle rainbow cycling.

### `sum(scale)`
```
@param {vec4} [scale=[1,1,1,1]]  Per-channel weights for summing to scalar
```
Returns a `vec4` where all channels equal the weighted sum `dot(c.rgb * scale.rgb, vec3(1))`.
Used for type conversion when a chain ending in `color` is passed where `float` is expected.

### `r(scale, offset)` / `g(scale, offset)` / `b(scale, offset)` / `a(scale, offset)`
```
@param {float} [scale=1]   Channel multiplier
@param {float} [offset=0]  Additive offset
```
Extracts a single channel and returns it in all four channels of a `vec4`.
Used to isolate a channel for further processing or as a combineCoord input.

---

## 15. GLSL Transforms — `combine` type

`combine`-type methods blend the current chain with another `GlslSource` passed as the first
argument. They receive two `vec4` values and return one `vec4`.

### `add(what, amount)`
```
@param {GlslSource} what      Second source to add
@param {float} [amount=0.5]   Mix factor (higher = more of the added source)
```

### `sub(what, amount)`
```
@param {GlslSource} what      Source to subtract
@param {float} [amount=0.5]
```

### `layer(what)`
```
@param {GlslSource} what  Source layered on top using alpha compositing
```
Alpha-aware compositing: `result = mix(a, b, b.a)`. The top layer's alpha controls blending.

### `blend(what, amount)`
```
@param {GlslSource} what
@param {float} [amount=0.5]  Linear interpolation between the two sources
```

### `mult(what, amount)`
```
@param {GlslSource} what
@param {float} [amount=1]   Mix between original and multiplied result
```
Multiplicative blend. `amount=1` = full multiply; `amount=0` = original.

### `diff(what)`
```
@param {GlslSource} what  Source to take absolute difference with
```
Computes `abs(c0 - c1)`. Useful for motion detection and glitch effects.

---

## 16. GLSL Transforms — `combineCoord` type

`combineCoord`-type methods modify UV coordinates using a second source's colour values.
They receive `(vec2 _st, vec4 _c0)` and return `vec2`.

### `modulate(what, amount)`
```
@param {GlslSource} what      Source whose red and green channels offset UV
@param {float} [amount=0.1]   Scale of the UV displacement
```
Displaces UV by `(what.r, what.g) * amount`. The core "modulate" effect.

### `modulateScale(what, multiple, offset)`
```
@param {GlslSource} what
@param {float} [multiple=1]
@param {float} [offset=1]
```
Scales UV toward centre using `what`'s luminance.

### `modulatePixelate(what, multiple, offset)`
```
@param {GlslSource} what
@param {float} [multiple=10]
@param {float} [offset=3]
```
Pixelates UV driven by `what`.

### `modulateRotate(what, multiple, offset)`
```
@param {GlslSource} what
@param {float} [multiple=1]
@param {float} [offset=0]
```
Rotates UV driven by `what`'s luminance.

### `modulateHue(what, amount)`
```
@param {GlslSource} what
@param {float} [amount=1]
```
Displaces UV using the hue of `what`.

### `modulateRepeat(what, repeatX, repeatY, offsetX, offsetY)`
### `modulateRepeatX(what, reps, offset)` / `modulateRepeatY(what, reps, offset)`
### `modulateKaleid(what, nSides)`
### `modulateScrollX(what, scrollX, speed)` / `modulateScrollY(what, scrollY, speed)`

Coord-modulated versions of the corresponding `coord`-type transforms. The second source's
brightness drives the transform parameter.

---

## 17. Array.prototype Extensions

These methods are added to `Array.prototype` by `ArrayUtils.init()`. They store metadata on
the array instance and are consumed by `ArrayUtils.getValue()` when the array is passed as a
transform argument.

### `.fast(speed)`
```js
/**
 * @param {number} [speed=1]  Multiply time index by this factor (>1 = faster stepping)
 * @returns {Array}  this (mutates and returns the same array)
 */
[1, 2, 3].fast(2)
```
Sets `arr._speed`. Values are stepped through `speed` times faster than the default BPM rate.

### `.smooth(smooth)`
```js
/**
 * @param {number} [smooth=1]  Smoothing window (0 = off, 1 = full interpolation between steps)
 * @returns {Array}
 */
[0, 1].smooth(0.5)
```
Sets `arr._smooth`. When non-zero, values are interpolated between adjacent steps using the
easing function (default: linear).

### `.ease(ease)`
```js
/**
 * @param {string|function} [ease='linear']  Easing curve name or custom function
 * @returns {Array}
 */
[0, 1].smooth(1).ease('easeInOutCubic')
```
Sets `arr._smooth = 1` (enables interpolation) and `arr._ease`. Easing names are the keys of
`src/lib/easing-functions.js`. If a function is passed directly, it is used as the easing curve.

### `.offset(offset)`
```js
/**
 * @param {number} [offset=0.5]  Phase offset in the [0, 1) range
 * @returns {Array}
 */
[0, 1].offset(0.25)
```
Sets `arr._offset`. Shifts the time index so the sequence starts at a different phase.

### `.fit(low, high)`
```js
/**
 * @param {number} [low=0]   Target minimum value
 * @param {number} [high=1]  Target maximum value
 * @returns {Array}          New array (does not mutate in-place — carries metadata forward)
 */
[10, 20, 30].fit(0, 1)  // → [0, 0.5, 1]
```
Remaps the array's values to the `[low, high]` range. Returns a **new array** that preserves
`_speed`, `_smooth`, and `_ease` from the original.

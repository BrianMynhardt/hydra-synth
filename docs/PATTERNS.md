# Design Patterns — Hydra-Synth

This document catalogues the recurring design patterns found in the hydra-synth codebase.
Each entry explains the problem the pattern solves, how it is implemented, when to use it,
and when to reach for something else.

Cross-references: `docs/ARCHITECTURE.md` for data-flow context, `harness/context/adr.md`
for the decisions that introduced each pattern.

---

## Pattern 1 — Transform-as-Data

### Problem
~50 visual operations each need both a JavaScript entry point and a GLSL implementation.
Writing both by hand for each operation leads to inconsistency, duplication of signature
boilerplate, and a list that cannot be programmatically introspected.

### How it is implemented here
Every GLSL function is described as a plain object with four fields:

```js
{
  name: 'osc',      // JS identifier AND GLSL function name — must be the same
  type: 'src',      // controls GLSL signature; one of the five valid types
  inputs: [
    { name: 'frequency', type: 'float', default: 60 },
    { name: 'sync',      type: 'float', default: 0.1 },
    { name: 'offset',    type: 'float', default: 0   }
  ],
  glsl: `
    float r = sin((st.x - offset/frequency + time*sync)*frequency)*0.5 + 0.5;
    // …
    return vec4(r, g, b, 1.0);
  `
}
```

These objects live in `src/glsl/glsl-functions.js`. At startup, `GeneratorFactory.init()`
passes each object to `processGlsl()`, which assembles the GLSL function signature from the
`type` and `inputs`, then calls `_addMethod()` to register the JavaScript API.

**The `glsl` field contains only the function body** — never the signature. The signature is
generated mechanically from `typeLookup` in `generator-factory.js`.

### Canonical source
`src/glsl/glsl-functions.js` (every entry), `src/generator-factory.js:processGlsl()`

### When to use
Always, when adding a new visual operation. This is the only sanctioned path for extending
the GLSL API surface.

### When NOT to use
Do not inline GLSL logic in `generator-factory.js`, `glsl-source.js`, or other JavaScript files.
Do not write full GLSL function declarations in the `glsl` field — only the body.

---

## Pattern 2 — Fluent Method Chain

### Problem
Live-coding requires expressive, terse syntax. Requiring users to declare variables or call
separate functions for each step would break the one-liner style that defines Hydra's UX.

### How it is implemented here
`src`-type generator calls (e.g. `osc()`, `noise()`) create and return a new `GlslSource`
instance. All non-`src` transforms are registered as prototype methods on the `GlslSource`
subclass by `GeneratorFactory._addMethod()`:

```js
// In _addMethod() for non-src transforms:
this.sourceClass.prototype[method] = function (...args) {
  this.transforms.push({ name: method, transform: transform, userArgs: args, synth: self })
  return this   // ← always returns this
}
```

The chain accumulates transforms lazily — no GLSL is generated until `.out()` is called.

```js
// User writes:
osc(4, 0.1)            // → new GlslSource (transforms: [osc])
  .rotate(0.5)         // → pushes {rotate} onto transforms; returns same GlslSource
  .color(1, 0, 0)      // → pushes {color}; returns same GlslSource
  .out(o0)             // → triggers compilation and render registration
```

### Canonical source
`src/glsl-source.js`, `src/generator-factory.js:_addMethod()`

### When to use
All visual effects are expressed through this chain. When adding a non-`src` transform, add it
as a prototype method that pushes to `this.transforms` and returns `this`.

### When NOT to use
Do not return a new `GlslSource` from a non-`src` transform. This would break chain identity
(subsequent calls would lose prior transforms). Only `src`-type calls create new instances.

---

## Pattern 3 — Closure-Accumulating GLSL Generator

### Problem
A transform chain of arbitrary length must be compiled into a single GLSL fragment shader body
where each step either reads from or writes to UV coordinates or colour values, and the ordering
of `coord` transforms (pre-sampling) vs `color` transforms (post-sampling) must be preserved.

### How it is implemented here
`generate-glsl.js` builds a **chain of closures**. Each iteration wraps the previous generator
function in a new one. The outermost closure, when called with `('c', 'st')`, emits the full
GLSL body as a string by calling the entire chain:

```js
// Simplified pattern:
var generator = (c, uv) => ''           // initial no-op

transforms.forEach((transform) => {
  var prev = generator
  if (transform.type === 'src') {
    generator = (c, uv) => `
      ${generateInputs(inputs)(`${c}${i}`, uv)}
      vec4 ${c} = ${transform.name}(${uv}, …);
    `
  } else if (transform.type === 'color') {
    generator = (c, uv) => `
      ${generateInputs(inputs)(`${c}${i}`, uv)}
      ${prev(c, uv)}            // ← eval previous steps first
      ${c} = ${transform.name}(${c}, …);
    `
  } else if (transform.type === 'coord') {
    generator = (c, uv) => `
      ${generateInputs(inputs)(`${c}${i}`, uv)}
      ${uv} = ${transform.name}(${uv}, …);
      ${prev(c, uv)}            // ← eval subsequent steps after UV modification
    `
  }
})

var glsl = generator('c', 'st')         // emit everything
```

The key insight: `color` transforms call `prev` *before* their own emission (so prior color
transforms are evaluated first). `coord` transforms call `prev` *after* (so the UV modification
takes effect before any sampling).

### Canonical source
`src/generate-glsl.js:generateGlsl()` (inner function, lines 31–76)

### When to use
This pattern is not extended by library users. Understand it when debugging GLSL generation
issues or when working on the five `type` dispatch branches.

### When NOT to use
Do not add new transform types without updating **all four** of these locations:
1. `typeLookup` in `src/generator-factory.js`
2. The `if/else if` dispatch in `src/generate-glsl.js:generateGlsl()`
3. `VALID_TYPES` in `harness/validate.js`
4. The glossary in `harness/context/glossary.md`

---

## Pattern 4 — Ping-Pong Framebuffer

### Problem
Feedback effects (`src(o0).scale(0.99).out(o0)`) require reading from and writing to the same
output simultaneously. In OpenGL/WebGL, reading from and writing to the same texture in the
same draw call is undefined behaviour.

### How it is implemented here
`Output` holds two `regl` framebuffers (`this.fbos[0]` and `this.fbos[1]`). Before each draw,
`pingPongIndex` flips, making the previously-idle FBO the new render target:

```js
// In Output.prototype.render():
self.draw = self.regl({
  // …
  framebuffer: () => {
    self.pingPongIndex = self.pingPongIndex ? 0 : 1   // flip before draw
    return self.fbos[self.pingPongIndex]               // render into this FBO
  }
})

// Uniform callback — called before flip, so reads the previous FBO:
prevBuffer: () => self.fbos[self.pingPongIndex]
```

`getCurrent()` returns the just-written FBO (used when other outputs read this one via `src(o0)`).
`getTexture()` returns the other FBO (used as `prevBuffer` in the same output's shader).

### Canonical source
`src/output.js:Output.prototype.render()` (lines 93–116)

### When to use
This pattern is already in place for all outputs. It must not be changed. If you add new
output-like objects, model them after `Output`.

### When NOT to use
Do not collapse the two FBOs into one. Do not render directly to the canvas — all rendering
goes through FBOs, and the final blit to canvas is handled by `renderFbo` in `hydra-synth.js`.

---

## Pattern 5 — makeGlobal Injection

### Problem
The live-coding UX requires users to type `osc(4).out()` directly in a browser console or
code editor, without any namespace prefix. But embedding Hydra in an application may require
strict namespace control and support for multiple instances on the same page.

### How it is implemented here
`EvalSandbox` mirrors every property of the `synth` object onto `window` when `makeGlobal: true`.
When `GeneratorFactory` registers a new function, it calls `changeListener({type:'add', method})`,
which calls `sandbox.add(method)`, which calls `window[method] = synth[method]`.

Mutable user properties (`speed`, `update`, `afterUpdate`, `bpm`, `fps`) are re-synced from
`window` back to `synth` on every tick by `EvalSandbox.tick()`. This means a user can type
`speed = 2` in the console and it takes effect immediately.

```js
// In HydraRenderer.tick():
this.sandbox.tick()   // pulls window.speed → synth.speed, etc.
```

### Canonical source
`src/eval-sandbox.js`, `src/hydra-synth.js:_generateGlslTransforms()` (changeListener callback)

### When to use
Use `makeGlobal: true` (the default) for the standard live-coding setup. Use `makeGlobal: false`
when embedding Hydra in a larger application where global namespace pollution is unacceptable.

### When NOT to use
Never add properties directly to `window` from `src/lib/` files or from `src/` root files.
All window assignments must go through the `synth` object → `EvalSandbox.add()` pathway.
The only exception is `src/lib/audio.js:setBins()`, which has a known bug (F-005) and should
not be used as a reference.

---

## Pattern 6 — Uniform Name Collision Prevention via startIndex

### Problem
A transform chain may use the same transform multiple times (e.g. `osc(4).modulate(osc(8))`).
If both calls create a uniform named `frequency`, the second overwrites the first in the
compiled regl uniforms object.

### How it is implemented here
`format-arguments.js:formatArguments(transform, startIndex)` appends `startIndex` to each
uniform name. `startIndex` is the **current length of `shaderParams.uniforms[]`** before
this transform's inputs are added — it is a monotonically increasing counter for each chain.

```js
// In generate-glsl.js:
let inputs = formatArguments(transform, shaderParams.uniforms.length)
// inputs[0].name might be 'frequency0' for the first osc, 'frequency3' for the second
```

The GLSL uniform declaration and the regl uniform property both use the suffixed name, so they
always agree.

### Canonical source
`src/format-arguments.js:formatArguments()` (line 33), `src/generate-glsl.js:generateGlsl()`
(line 36)

### When to use
This mechanism is automatic — you do not call it manually. Understand it if a shader produces
incorrect values when a transform is used more than once in a chain.

### When NOT to use
Do not hardcode uniform names in new transforms. All uniform naming goes through this mechanism.

---

## Pattern 7 — Array.prototype Extensions for Sequencing

### Problem
Live-coding style demands that users can pass an array of values as a parameter and have Hydra
step through them over time: `osc([2, 4, 8]).out()`. The chaining needed to configure speed
and smoothing should feel as fluid as the main generator API.

### How it is implemented here
`ArrayUtils.init()` (called once in `HydraRenderer` constructor) adds five methods directly to
`Array.prototype`. These methods store metadata on the array as non-standard properties:

```js
Array.prototype.fast = function(speed = 1) {
  this._speed = speed
  return this
}
Array.prototype.smooth = function(smooth = 1) {
  this._smooth = smooth
  return this
}
// … etc.
```

`ArrayUtils.getValue(arr)` reads these properties and returns a regl uniform callback:

```js
// When user writes:  osc([2, 4, 8].fast(0.5).smooth(1))
// format-arguments.js detects an Array, wraps it:
typedArg.value = (context, props, batchId) => arrayUtils.getValue(userArgs[index])(props)
typedArg.isUniform = true
```

On each frame, regl calls the uniform callback with `{ time, bpm }` and gets the current
interpolated value.

### Canonical source
`src/lib/array-utils.js` (lines 19–62 for init, lines 65–96 for getValue)

### When to use
When a user needs to sequence through discrete values over time with optional smoothing.
The existing five methods (`fast`, `smooth`, `ease`, `offset`, `fit`) cover all current use cases.

### When NOT to use
Do not add further methods to `Array.prototype`. The surface area is frozen by Constraint Rule 7
in `harness/constraints.md`. Do not use this pattern for anything other than time-indexed
uniform value sequences.

---

## Pattern 8 — Dual-Format Module Export (ESM Entry + CJS Shim)

### Problem
The library must support three consumption patterns simultaneously:
1. `<script src="https://unpkg.com/hydra-synth">` (UMD bundle in a browser `<script>` tag)
2. `import Hydra from 'hydra-synth'` (modern ESM)
3. `const Hydra = require('hydra-synth')` (CommonJS / legacy bundlers)

It also needs to be the input to `browserify ./src/index.js` to produce the UMD bundle.

### How it is implemented here
Two separate entry files, with the `package.json` `exports` field routing consumers:

```json
{
  "type": "module",
  "main": "./src/index.js",
  "exports": {
    ".": {
      "import":  "./src/hydra-synth.js",
      "require": "./dist/hydra-synth.js"
    }
  }
}
```

`src/hydra-synth.js` — pure ESM, the `import` entry.
`src/index.js` — the browserify build entry. Uses `import` (transpiled by `esmify`) +
  `module.exports` (required by browserify):

```js
import Synth from './hydra-synth.js'
module.exports = Synth
```

`dist/hydra-synth.js` — the UMD bundle produced by `npm run build`.

### Canonical source
`src/index.js`, `src/hydra-synth.js`, `package.json`

### When to use
This pattern is already in place. Do not change it.

### When NOT to use
Do not change `module.exports` in `src/index.js` to `export default` — that breaks the
browserify build entry. Do not change the `"type": "module"` declaration in `package.json`.
See ADR-002 in `harness/context/adr.md` for the full rationale.

---

## Pattern 9 — Single-Concern lib/ Utilities

### Problem
Browser API initialisation (webcam, screen capture, mouse tracking, audio) is verbose and
environment-specific. Keeping this code mixed with pipeline logic makes both harder to reason about.

### How it is implemented here
Each browser API concern is isolated to a single file in `src/lib/`:

| File | Single concern |
|------|---------------|
| `webcam.js` | `navigator.mediaDevices.getUserMedia` for camera |
| `screenmedia.js` | `navigator.mediaDevices.getDisplayMedia` for screen |
| `mouse.js` | Mouse position and button state tracking |
| `mouse-event.js` | Raw cross-browser mouse event normalisation |
| `audio.js` | Meyda FFT analyser + beat detection |
| `video-recorder.js` | `MediaRecorder` `.webm` export |
| `sandbox.js` | `globalThis.eval` wrapper |
| `easing-functions.js` | Pure easing curves (no browser deps) |
| `array-utils.js` | Array.prototype extensions + `getValue` (no browser deps) |

Files in `src/lib/` must not import from `src/` root files. They can only import from other
`src/lib/` files or npm packages.

### Canonical source
Any file in `src/lib/`. `src/lib/screenmedia.js` (14 lines) is the minimal example.

### When to use
When adding a new browser API integration (e.g. MIDI, WebRTC, WebSerial), create a new file
in `src/lib/` that exports a single function or class. Import it from `src/hydra-source.js`
or `src/hydra-synth.js`.

### When NOT to use
Do not add browser API code to `src/glsl/` files. Do not bundle multiple API concerns into
one `src/lib/` file. Do not import `src/hydra-synth.js` or any other root source from `src/lib/`.

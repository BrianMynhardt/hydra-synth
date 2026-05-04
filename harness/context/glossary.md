# Domain Term Glossary

Terms used throughout the hydra-synth codebase and documentation.

---

## Core Concepts

**synth**  
The user-facing API object attached to a `HydraRenderer` instance as `this.synth`. Contains
all generator functions, output buffers (`o0`–`o3`), source buffers (`s0`–`s3`), control
functions (`render`, `hush`, `tick`), and mutable state (`time`, `speed`, `bpm`, `fps`).
When `makeGlobal: true`, every property of `synth` is mirrored onto `window`.

**transform**  
A single visual operation described as a plain JS object with `name`, `type`, `inputs`, and
`glsl` fields. Transforms are defined statically in `src/glsl/glsl-functions.js`. At runtime
`GeneratorFactory` converts each transform definition into a JavaScript function.

**transform chain**  
The sequence of transforms accumulated on a `GlslSource` instance. Each call to a generator
function (e.g. `osc(4)`) creates a new `GlslSource` with one transform. Subsequent method
calls (`.rotate(0.5)`, `.blend(o1)`) push additional transforms onto the chain. Calling
`.out()` triggers shader compilation from the chain.

**transform type** (`type` field)  
Determines the GLSL function signature generated from the transform body. Five valid values:

| Value | GLSL signature | Purpose |
|-------|---------------|---------|
| `src` | `vec4 fn(vec2 _st, ...)` | Generates color from UV coords |
| `coord` | `vec2 fn(vec2 _st, ...)` | Warps UV coords |
| `color` | `vec4 fn(vec4 _c0, ...)` | Modifies existing color |
| `combine` | `vec4 fn(vec4 _c0, vec4 _c1, ...)` | Blends two color sources |
| `combineCoord` | `vec2 fn(vec2 _st, vec4 _c0, ...)` | Modifies UV using a second source |

**GlslSource**  
The chain-builder class (`src/glsl-source.js`). Every generator function returns a new
`GlslSource` instance. It is the object users interact with when writing `osc(4).rotate(0.5)`.
`.out()` compiles the chain to a GLSL shader and passes it to an `Output`.  
*Type marker:* `instance.type === 'GlslSource'` (used in `format-arguments.js` to detect
GlslSource values passed as `vec4` inputs to combine-type transforms).

---

## Rendering Infrastructure

**Output** (`o0`–`o3`)  
Instances of `Output` (`src/output.js`). Each holds a ping-pong framebuffer pair, a vertex
shader, and a `regl` draw function. Four outputs are created by default. Users direct the
current pipeline to an output with `.out(o0)`. The final canvas render reads from whichever
output was last passed to `render(output)`.

**Source** / **source buffer** (`s0`–`s3`)  
Instances of `HydraSource` (`src/hydra-source.js`). Each holds a regl texture that can be
populated from a webcam, video, image, canvas, or screen capture. Used as inputs via
`src(s0)`. Four sources are created by default.

**ping-pong framebuffer**  
A pair of `regl` framebuffers on an `Output` that alternate between "write target" and
"read source" each frame. The currently-being-written FBO is returned by `getCurrent()`.
The previously-written FBO is returned by `getTexture()` and is available in shaders as
the `prevBuffer` uniform. This enables feedback effects like `src(o0).scale(0.99).out(o0)`.

**prevBuffer**  
A `sampler2D` uniform injected into every compiled fragment shader. Holds the output of the
previous frame for the same `Output`. Enables feedback loops. Supplied by `getTexture()`.

**regl**  
The WebGL abstraction library used for all GPU operations. Manages shaders, draw calls,
framebuffers, textures, and uniforms. Version pinned at `^1.3.9`. Do not use WebGL APIs
directly — always go through `regl`.

---

## Shader Generation

**uniform**  
A WebGL value passed from JavaScript to the GLSL shader at draw time. In hydra-synth, uniforms
carry function-argument values that change over time (e.g. `() => time * 2`) or are textures.
Static values (numbers known at compile time) are inlined as GLSL literals to avoid uniform
overhead.

**startIndex**  
A counter passed to `formatArguments()` to give each uniform a unique name when multiple
transforms in a chain use the same parameter name. E.g. `freq0`, `freq1`. This prevents
GLSL uniform name collisions within a single compiled shader.

**utility functions** (`src/glsl/utility-functions.js`)  
GLSL helper functions (`_noise`, `_luminance`, `_rgbToHsv`, `_hsvToRgb`) injected into the
header of every compiled fragment shader. They are prefixed with `_` to avoid collisions with
user-defined or transform-defined names.

**precision**  
The GLSL floating-point precision qualifier (`lowp`, `mediump`, `highp`). Set globally for
each `Output` and injected at the top of each compiled shader. Defaults to `highp` on iOS,
`mediump` everywhere else.

---

## Runtime / Control Flow

**tick** (`dt`)  
The per-frame update method on `HydraRenderer`. Called by `raf-loop` on every animation
frame (or manually when `autoLoop: false`). `dt` is elapsed milliseconds since the last
frame. The tick:  
1. Reads user-mutated `window` properties back into `synth` (speed, fps, etc.)  
2. Advances `synth.time`  
3. Calls `synth.update(dt)` (user hook)  
4. Ticks all sources (uploads new video frames to GPU)  
5. Ticks all outputs (executes regl draw calls)  
6. Renders to canvas (`renderAll` or `renderFbo`)  
7. Calls `synth.afterUpdate(dt)` (user hook)

**makeGlobal**  
Constructor flag (default `true`). When `true`, every property of the `synth` object is
written to `window` at construction time, and mutable properties are re-synced from `window`
every tick. When `false`, all API access must go through the `synth` property of the
`HydraRenderer` instance.

**hush**  
Clears all source textures and sets all outputs to solid black. Resets `update` and
`afterUpdate` callbacks. The Hydra equivalent of "stop everything".

**EvalSandbox** (`src/eval-sandbox.js`)  
Wraps `globalThis.eval` to execute user-supplied code strings. When `makeGlobal: true`, code
executes with full window access. The "sandboxing" in the name is aspirational — there is no
isolation. See `harness/findings.md` F-006.

---

## Module / Build

**ESM entry**  
`src/hydra-synth.js` — the direct ESM import path, referenced by `package.json`
`exports["."].import`. Use this when importing from modern bundlers or ESM projects.

**CJS shim / browserify entry**  
`src/index.js` — uses `module.exports` for the browserify build pipeline. Referenced by
`package.json` `"main"` field.

**UMD bundle**  
`dist/hydra-synth.js` — the built output of `npm run build`. A standalone bundle for direct
`<script>` inclusion. Referenced by `package.json` `exports["."].require` (for `require()`
in Node/CJS) and `"unpkg"`.

**extendTransforms**  
A constructor option accepting an array of transform definition objects (or a single object).
Allows runtime extension of the transform library without modifying `glsl-functions.js`.
Note: there is a known bug where the array-concatenation path is incorrect —
see `harness/findings.md` F-003.

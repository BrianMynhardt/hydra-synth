# Architecture — Hydra-Synth

This document describes the data-flow architecture of the hydra-synth synthesis pipeline, the
dependency rules between modules, and the extension points for adding new effects and sources.

---

## Overview

Hydra-synth is a **transform pipeline** evaluated at runtime in the browser. Every visual
expression (e.g. `osc(4, 0.1).rotate(0.5).out(o0)`) follows the same path:

```
JS chain call
  → GlslSource accumulates transforms
    → generateGlsl() emits GLSL string
      → Output compiles shader via regl
        → GPU renders to framebuffer
          → canvas displays result
```

There are no intermediate representations, no AST, no pre-compilation step. The GLSL string is
assembled fresh on every `.out()` call and compiled on the GPU by the WebGL driver.

---

## Data-Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  glsl/glsl-functions.js                                              │
│  Pure data: array of ~50 transform definition objects                │
│  { name, type, inputs[], glsl }                                      │
└────────────────────────┬─────────────────────────────────────────────┘
                         │ imported by
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  generator-factory.js  GeneratorFactory                              │
│  processGlsl() wraps each definition in a full GLSL function body.  │
│  _addMethod() registers:                                             │
│    • type='src'  → generator function in generators{}               │
│    • all others → prototype method on GlslSource subclass           │
└────────────────────────┬─────────────────────────────────────────────┘
                         │ produces
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  User JS expression:  osc(4, 0.1).rotate(0.5).color(1,0,0).out(o0) │
│                                                                      │
│  osc(4, 0.1)          → new GlslSource({ name:'osc', userArgs:[4,0.1], … })   │
│  .rotate(0.5)         → GlslSource.transforms.push({ name:'rotate', … })      │
│  .color(1, 0, 0)      → GlslSource.transforms.push({ name:'color', … })       │
│  .out(o0)             → triggers compilation                         │
└────────────────────────┬─────────────────────────────────────────────┘
                         │ .out() calls
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  glsl-source.js  GlslSource.compile(transforms)                      │
│  Calls generateGlsl() → gets { uniforms[], glslFunctions[], fragColor }      │
│  Assembles full GLSL fragment shader string:                         │
│    • precision declaration                                           │
│    • uniform declarations (one per resolved input)                  │
│    • utility functions (from glsl/utility-functions.js)             │
│    • transform function bodies                                       │
│    • void main() { … gl_FragColor = c; }                            │
│  Returns: { frag: string, uniforms: object }                        │
└────────────────────────┬─────────────────────────────────────────────┘
                         │ passes pass[] to
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  output.js  Output.render(passes)                                    │
│  Calls regl({ frag, vert, uniforms, framebuffer: () => fbos[i] })   │
│  Stores compiled draw call as this.draw                              │
└────────────────────────┬─────────────────────────────────────────────┘
                         │ called each frame by
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  hydra-synth.js  HydraRenderer.tick(dt)                              │
│  raf-loop fires tick() at ~60 fps.                                   │
│  For each output:  output.tick({ time, mouse, bpm, resolution })    │
│  → calls this.draw(props)  → GPU executes shader into ping-pong FBO │
│  Then blits current FBO to canvas via renderFbo or renderAll.       │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Pipeline Layers

### Layer 1 — Transform Definitions (`src/glsl/glsl-functions.js`)

A single exported function returning an array of ~50 plain objects. Each object describes one
visual operation. The object schema is:

```js
{
  name:   string,   // JS identifier AND GLSL function name
  type:   string,   // one of: 'src' | 'coord' | 'color' | 'combine' | 'combineCoord'
  inputs: Array<{ name: string, type: 'float'|'vec4'|'sampler2D', default: any }>,
  glsl:   string    // GLSL function BODY only — no signature
}
```

This layer has zero side effects and no browser dependencies. It can be imported in Node.js.

### Layer 2 — JS API Generation (`src/generator-factory.js`)

`GeneratorFactory.init()` iterates all transform definitions and calls `setFunction()` on each.
`processGlsl()` adds the GLSL function signature using `typeLookup`. `_addMethod()` registers:
- **`src`-type transforms** as standalone generator functions (e.g. `osc`, `noise`, `src`)
- **all other types** as prototype methods on a dynamically created `GlslSource` subclass

After this layer, every transform name is a callable JS function.

### Layer 3 — Chain Accumulation (`src/glsl-source.js`)

A `GlslSource` instance is created by every `src`-type generator call. Subsequent chained
calls push transform objects onto `this.transforms`. No GLSL is generated at this stage.

`.out(output)` triggers shader compilation for the accumulated chain.

### Layer 4 — GLSL Emission (`src/generate-glsl.js` + `src/format-arguments.js`)

`generateGlsl(transforms)` walks the transforms array and constructs a **generator function
closure** for each step. The closure chain is called once with `('c', 'st')` to emit the GLSL
body string.

The five transform types determine how the closure interacts with previous steps:

| Type | GLSL output pattern | Receives | Produces |
|------|---------------------|----------|---------|
| `src` | `vec4 c = name(_st, …);` | UV coords (`vec2`) | color (`vec4`) |
| `coord` | `_st = name(_st, …);` | UV coords (`vec2`) | new UV coords (`vec2`) — applied **before** next src |
| `color` | `c = name(c, …);` | color (`vec4`) | transformed color (`vec4`) |
| `combine` | `c = name(c, other, …);` | two colors (`vec4`, `vec4`) | blended color (`vec4`) |
| `combineCoord` | `_st = name(_st, other, …);` | UV + color (`vec2`, `vec4`) | new UV coords (`vec2`) |

`format-arguments.js` resolves each transform's user-supplied arguments into one of:
- **inline GLSL literal** (numbers, static arrays, vec4 constructors)
- **uniform** (functions, dynamic arrays, textures) — added to `shaderParams.uniforms[]`
- **nested GlslSource** (another transform chain used as input) — recursively generates GLSL

### Layer 5 — Shader Execution (`src/output.js`)

`Output` wraps two `regl` framebuffers in a ping-pong pattern. `render(passes)` compiles the
pass into a `regl` draw command stored as `this.draw`. On each `tick()` the draw command
executes the fragment shader, writing to the inactive FBO.

`getCurrent()` returns the just-written FBO (used when another output reads this one as a
texture). `getTexture()` returns the previously-written FBO (available as `prevBuffer` inside
the same output's shader — enabling feedback).

### Layer 6 — Orchestration (`src/hydra-synth.js`)

`HydraRenderer` owns everything:
- Creates outputs (`this.o[0..3]`) and sources (`this.s[0..3]`)
- Initialises `GeneratorFactory`, which populates `this.synth` with generator functions
- Starts the `raf-loop`, which calls `tick()` on every animation frame
- Manages the `synth` object — the stable user-facing API surface
- Handles `makeGlobal` mode via `EvalSandbox`

---

## Dependency Direction

The rule is: **lower-level modules must not import higher-level modules**.

```
hydra-synth.js                            ← root; nothing imports this
  ├── output.js
  ├── hydra-source.js
  │     ├── lib/webcam.js
  │     └── lib/screenmedia.js
  ├── eval-sandbox.js
  │     ├── lib/sandbox.js
  │     └── lib/array-utils.js
  │           └── lib/easing-functions.js
  ├── generator-factory.js
  │     ├── glsl-source.js
  │     │     ├── generate-glsl.js
  │     │     │     └── format-arguments.js
  │     │     │           └── lib/array-utils.js
  │     │     └── glsl/utility-functions.js
  │     └── glsl/glsl-functions.js
  ├── lib/mouse.js
  │     └── lib/mouse-event.js
  ├── lib/audio.js              (→ npm: meyda)
  ├── lib/video-recorder.js
  ├── lib/array-utils.js
  └── (npm: regl, raf-loop)
```

**Prohibited directions:**
- `src/lib/` files must not import from `src/` root files
- `src/glsl/` files must not import from `src/` root files
- Nothing imports `hydra-synth.js` (it is the root)

---

## Ping-Pong Framebuffer Detail

Each `Output` has exactly two `regl` framebuffers: `fbos[0]` and `fbos[1]`. The
`pingPongIndex` toggles inside the `framebuffer` callback (called by regl before each draw):

```
Frame N:  pingPongIndex flips to 1 → renders into fbos[1]
            • prevBuffer = fbos[1] (same index) — wait, no:
              getTexture() returns fbos[index ? 0 : 1]
              so prevBuffer = fbos[0] = last frame's result ✓
Frame N+1: pingPongIndex flips to 0 → renders into fbos[0]
            • getTexture() returns fbos[1] = frame N's result ✓
```

`getCurrent()` = the FBO just written to (read by *other* outputs via `src(o0)`)
`getTexture()` = the FBO written to in the *previous* frame (used as `prevBuffer` within own shader)

---

## Extension Points

### Adding a new GLSL transform

1. Add a data object to the array in `src/glsl/glsl-functions.js`
2. The `type` must be one of the five valid values (see Constraint Rule 1 in
   `harness/constraints.md`)
3. The `glsl` field is the function **body only** — `processGlsl()` in `generator-factory.js`
   wraps it in a full function declaration
4. Run `npm run harness:validate` to confirm the new entry passes structural checks
5. The function is immediately available at runtime without any other changes

Example — adding a `flip` coord transform:
```js
{
  name: 'flip',
  type: 'coord',
  inputs: [
    { name: 'x', type: 'float', default: 0 },
    { name: 'y', type: 'float', default: 0 }
  ],
  glsl: `
    if (x > 0.) _st.x = 1.0 - _st.x;
    if (y > 0.) _st.y = 1.0 - _st.y;
    return _st;
  `
}
```

### Adding a new media source type

1. Add a method to `HydraSource` in `src/hydra-source.js` (e.g. `initWebRTC`)
2. Use existing patterns: `getUserMedia` / `regl.texture` / `this.dynamic = true`
3. If a new browser API is needed, add a helper in `src/lib/` following the single-concern
   pattern of `screenmedia.js` and `webcam.js`
4. Do not import any `src/` root files from `src/lib/` files

### Adding a new built-in GLSL utility function

1. Add an entry to the object exported by `src/glsl/utility-functions.js`
2. Use the `_` prefix convention for the function name to avoid collisions
3. The function body is injected into every compiled shader header automatically

### Adding new user-settable properties to the synth object

1. Add the property to `this.synth` in `HydraRenderer.constructor()`
2. If the property should be mutable by the user in global mode, add its name to the
   `userProps` array passed to `new Sandbox(this.synth, makeGlobal, userProps)`

---

## What Is Not Implemented

- **`renderpass` type**: Defined in the dead-code file `src/glsl/renderpass-functions.js`,
  referenced in `glsl-source.js` with a `console.warn` and no-op. Multi-pass effects are
  not supported in the current architecture.
- **Server-side / Node.js rendering**: `src/shader-generator.js` and `src/shaderManager.js`
  are standalone tools that are not imported by the main library and contain broken references.
  Do not use them.
- **True eval sandboxing**: `src/lib/sandbox.js` calls `globalThis.eval`. Code evaluated by
  `HydraRenderer.eval()` runs in the global scope. See `harness/findings.md` F-006.

# Architecture Decision Records

These records document *why* the significant design patterns in this codebase exist.
They are written after-the-fact based on code archaeology. Where the original rationale
is inferred rather than cited from comments or commits, it is marked as **[inferred]**.

---

## ADR-001: Transform Definitions as Pure Data Objects

**Status:** Active  
**Files:** `src/glsl/glsl-functions.js`, `src/generator-factory.js`

### Decision
All user-callable GLSL functions are described as plain JavaScript objects with four fields
(`name`, `type`, `inputs`, `glsl`) rather than as hand-written GLSL+JS pairs.

### Context
Hydra exposes ~50 visual functions (`osc`, `noise`, `rotate`, `blend`, etc.) each of which
needs both a JavaScript entry point (so users can write `osc(4, 0.1).out()`) and a GLSL
implementation. Writing both for every function by hand would be repetitive and inconsistent.

### Rationale
- **[inferred]** The data-object schema allows a single `processGlsl()` call in
  `generator-factory.js` to mechanically assemble the GLSL function signature from the type
  and inputs, keeping the transform author focused on the body logic only.
- **[inferred]** The schema allows transforms to be added dynamically at runtime via
  `setFunction()` / `extendTransforms`, which is a core live-coding feature.
- The schema is Node-importable without browser APIs, enabling static analysis and tooling
  (e.g. the `harness/index.js` enumerator and `harness/validate.js` Rule 1).

### Consequences
- New visual functions must always go through the schema, not be written inline.
- The five valid `type` values are a closed set — adding a sixth requires updating the
  dispatch logic in `generate-glsl.js` and the lookup table in `generator-factory.js`.
- The GLSL body string is injected verbatim; there is no pre-validation of GLSL syntax.
  Errors surface only at shader compile time in the browser (usually silently).

---

## ADR-002: Dual-Format Module Export (ESM Entry + CJS Shim)

**Status:** Active  
**Files:** `src/hydra-synth.js`, `src/index.js`, `package.json`

### Decision
The library is published with both an ESM entry (`src/hydra-synth.js` via the `exports` map)
and a CJS/bundler entry (`src/index.js` via `"main"`). They are separate files.

### Context
The package was originally CJS-only. The move to `"type": "module"` (ESM-first) was made in
v1.3.21, but the library must still work:
1. via `<script src="https://unpkg.com/hydra-synth">` (UMD bundle from `dist/`)
2. via `import Hydra from 'hydra-synth'` in ESM projects
3. via `const Hydra = require('hydra-synth')` in CJS/bundler projects
4. as the input to `browserify ./src/index.js` to produce the UMD bundle

### Rationale
- `src/index.js` uses `import` (handled by `esmify` when run through browserify) and
  `module.exports` (used by browserify and legacy CJS tooling). It is the browserify entry.
- `src/hydra-synth.js` is pure ESM and is the direct import path for modern bundlers.
- `dist/hydra-synth.js` (UMD bundle) is the `require`-compatible entry for end-users.
- The `package.json` `exports` field encodes all three paths cleanly.

### Consequences
- `src/index.js` must never switch to `export default` — that breaks browserify.
- Agents must not confuse `src/index.js` (the build entry) with the ESM API surface
  (`src/hydra-synth.js`).
- There is a known rough edge: `src/index.js` uses `module.exports` inside a
  `"type": "module"` package. This works for browserify but would fail if Node ever
  tried to execute that file directly as ESM. See `harness/findings.md` F-004.

---

## ADR-003: `makeGlobal` Live-Coding Mode

**Status:** Active  
**File:** `src/hydra-synth.js`, `src/eval-sandbox.js`

### Decision
When `makeGlobal: true` (the default), every property of the `synth` object — including all
generator functions like `osc`, `noise`, and output buffers `o0`–`o3` — is injected onto
`window`. This is mirrored every tick via `EvalSandbox.tick()`.

### Context
Hydra's primary UX is a live-coding environment where users type `osc(4).out()` directly into
a browser console or code editor. Having to prefix every call with `hydra.synth.` would break
this ergonomic entirely.

### Rationale
- **[inferred]** The global namespace injection is intentional and considered a feature, not
  a bug, for the live-coding context.
- `EvalSandbox.tick()` re-syncs mutable user properties (`speed`, `update`, `afterUpdate`,
  `bpm`, `fps`) from `window` back to `synth` on every frame, so users can type
  `speed = 2` in the console and have it take effect immediately.
- The `makeGlobal: false` path exists for embedding Hydra in applications that cannot
  tolerate global pollution (e.g. multiple Hydra instances on the same page).

### Consequences
- Generator methods added via `setFunction()` are immediately available globally when
  `makeGlobal: true`. This is intentional.
- The sandbox (`src/lib/sandbox.js`) uses `globalThis.eval` rather than isolated evaluation.
  True sandboxing is a known gap (see `harness/findings.md`).
- `makeGlobal: false` mode has historically had bugs (noted in CHANGELOG.md multiple times).
  Be conservative when working in that code path.

---

## ADR-004: Ping-Pong Framebuffer Rendering

**Status:** Active  
**File:** `src/output.js`

### Decision
Each `Output` object maintains **two** `regl` framebuffers (`fbos[0]` and `fbos[1]`) that
alternate roles each frame. The current frame renders into one; the previous frame's result
is available to the shader as `prevBuffer`.

### Context
A core Hydra creative technique is **feedback** — using the previous frame as input to the
current frame (e.g. `src(o0).scale(0.99).out(o0)`). This requires reading from a framebuffer
while rendering into a different one, since reading from and writing to the same texture in
the same draw call is undefined behaviour in OpenGL.

### Rationale
- The ping-pong pattern is the standard WebGL solution to this problem.
- `getCurrent()` returns the FBO just written to (used when `src(o0)` reads an output as
  input to another output's pipeline).
- `getTexture()` returns the *other* FBO (used as `prevBuffer` within the same output's
  own shader — i.e. the frame from the previous tick).
- `pingPongIndex` is toggled inside the `framebuffer` callback in `Output.prototype.render`,
  which regl calls just before each draw, ensuring the index is consistent within a frame.

### Consequences
- The `fbos` array must always have exactly two elements. See `harness/constraints.md` rule 5.
- Any resize must resize both FBOs (`Output.prototype.resize`).
- The distinction between `getCurrent()` and `getTexture()` is easy to confuse. See
  `harness/context/glossary.md` for definitions.

---

## ADR-005: Array.prototype Extensions for Sequencing

**Status:** Active  
**File:** `src/lib/array-utils.js`

### Decision
`arrayUtils.init()` (called once in `HydraRenderer` constructor) adds `.fast()`, `.smooth()`,
`.ease()`, `.offset()`, and `.fit()` methods to `Array.prototype`.

### Context
In Hydra's live-coding style, users can pass an array as a parameter to any GLSL input and
it will step through the values over time (e.g. `osc([2, 4, 8].fast(0.5))`). The chaining
syntax (`.fast(0.5).smooth(1)`) needed to feel as fluent as the main generator API.

### Rationale
- **[inferred]** Prototype extension was chosen over a wrapper class to preserve literal
  array syntax — `[1, 2, 3].smooth()` is more live-coding-friendly than `seq([1, 2, 3]).smooth()`.
- The `getValue` function (exported separately from `init`) converts these annotated arrays
  into time-indexed uniform values during `format-arguments.js` argument resolution.

### Consequences
- This is a non-standard pattern that can conflict with other libraries that check
  `Array.prototype` property count or use `for...in` on arrays.
- **Do not add further methods to `Array.prototype`.** See `harness/constraints.md` rule 7.
- The `init()` call is idempotent by re-assignment but calling it multiple times (e.g. from
  two Hydra instances) is wasteful.

# Architectural Constraint Rules

These rules must never be violated. They encode invariants that are either load-bearing for
correctness or that, if broken, would create silent failures that are hard to trace.

---

## 1. Transform Type Must Be One of Five Valid Values

Every entry in `src/glsl/glsl-functions.js` must have a `type` field set to exactly one of:

```
'src'           — generates vec4 from UV coords
'coord'         — transforms vec2 UV coords
'color'         — transforms vec4 color
'combine'       — blends two vec4 colors
'combineCoord'  — modifies vec2 UV coords using a second vec4 source
```

**Why this matters:** `generator-factory.js::processGlsl()` performs a lookup against
`typeLookup`. An unrecognized type causes `processGlsl` to return `undefined` and log a warning —
the transform silently disappears from the API. There is no error thrown. This is validated by
`harness/validate.js` Rule 1.

**What to never do:** Invent a new type without updating all four of these files:
1. `typeLookup` in `src/generator-factory.js`
2. The `generateGlsl` switch in `src/generate-glsl.js`
3. `harness/validate.js` `VALID_TYPES` set
4. `harness/context/glossary.md`

---

## 2. GLSL Transform Definitions Live in glsl-functions.js, Not Inline in JS

User-callable GLSL functions must be defined as data objects in `src/glsl/glsl-functions.js`.
They must **not** be defined inline inside `generator-factory.js`, `glsl-source.js`, or any
other file, and must **not** be injected dynamically at startup except via `extendTransforms`.

**Why this matters:** The data-as-definition pattern allows the function list to be introspected,
validated statically, and documented without executing any browser code. The `harness/index.js`
relies on this to enumerate transforms in Node.js.

**Corollary:** The `glsl` field of a transform definition must contain only the GLSL **body**
(the statements inside the function), not a full function declaration. The signature is assembled
by `processGlsl()` in `generator-factory.js`.

---

## 3. src/index.js Must Remain the Browserify/CJS Bridge

`src/index.js` must always:
- Import the main class from `./hydra-synth.js` (not from any other file)
- Export it via `module.exports = ...` (for browserify and legacy require tooling)
- Remain the file referenced by `"main"` in `package.json`

**Why this matters:** The browserify build (`npm run build`) uses `src/index.js` as its entry
point. Changing the export mechanism or the import source breaks the UMD bundle generation,
which breaks the CDN/unpkg distribution used in browser `<script>` tags.

This is validated by `harness/validate.js` Rule 2.

---

## 4. No New Dependencies Without package.json Update

Never use `import` or `require` with a module that is not listed in `package.json`
`dependencies` or `devDependencies`. Node will throw at import time; browserify will fail silently
in some configurations.

**Current violation to be aware of:** `src/glsl/renderpass-functions.js` imports `glslify` which
is not in `package.json`. This file is dead code and must not be imported. See `harness/findings.md`.

---

## 5. Ping-Pong FBOs Must Not Be Collapsed

`src/output.js` maintains exactly **two** framebuffer objects (`this.fbos[0]` and `this.fbos[1]`).
The `pingPongIndex` alternates each frame so that the previous frame's output is available as
`prevBuffer` in the shader. Collapsing to a single FBO would break all feedback effects that use
`src(o0)` as an input.

Do not reduce `fbos` to one element. Do not render directly to the canvas (bypassing FBOs).

---

## 6. lib/ Utilities Are Browser-Runtime Code

Files in `src/lib/` use browser APIs: `window`, `navigator.mediaDevices`, `AudioContext`,
`document.createElement`, `MediaRecorder`. Do not add Node.js-specific code (e.g. `process`,
`fs`, `require`) to any file in `src/lib/` or `src/`.

The boundary between Node-compatible and browser-only code is:
- **Node-compatible (pure logic):** `src/lib/easing-functions.js`, `src/lib/array-utils.js`,
  `src/glsl/glsl-functions.js`, `src/glsl/utility-functions.js`
- **Browser-only (everything else):** all other `src/` files

---

## 7. Array.prototype Must Not Be Extended Further

`src/lib/array-utils.js::init()` adds `.fast()`, `.smooth()`, `.ease()`, `.offset()`, and `.fit()`
to `Array.prototype`. This is a known design choice for live-coding ergonomics. Do not add more
methods to `Array.prototype` in any file. The surface area of prototype patching must not grow.

---

## 8. Module Boundary Rules

Allowed import directions:

```
hydra-synth.js
  → output.js, hydra-source.js, eval-sandbox.js, generator-factory.js
  → lib/mouse.js, lib/audio.js, lib/video-recorder.js, lib/array-utils.js
  → (regl, raf-loop)

generator-factory.js → glsl-source.js, glsl/glsl-functions.js
glsl-source.js → generate-glsl.js, glsl/utility-functions.js
generate-glsl.js → format-arguments.js, lib/array-utils.js
format-arguments.js → lib/array-utils.js
eval-sandbox.js → lib/sandbox.js, lib/array-utils.js
hydra-source.js → lib/webcam.js, lib/screenmedia.js
lib/mouse.js → lib/mouse-event.js
lib/audio.js → (meyda)
lib/array-utils.js → lib/easing-functions.js
```

**Prohibited import directions:**
- Nothing should import from `hydra-synth.js` (it is the root)
- `src/lib/` files must not import from `src/` root files (no upward dependency)
- `src/glsl/` files must not import from `src/` root files

---

## 9. File Size Signal Thresholds

These thresholds are enforced by `harness/validate.js` Rule 3:

| Location | Limit | Exempt |
|----------|-------|--------|
| `src/*.js` (root source files) | 600 lines | — |
| `src/lib/*.js` | 600 lines | — |
| `src/glsl/*.js` | 250 lines | `glsl-functions.js` (pure data, ~1107 lines) |

Exceeding these limits is a **signal** that a refactor is warranted, not an automatic breakage.
Open an issue and note it in `harness/findings.md` before proceeding.

---

## 10. Anti-Patterns — Never Do These

| Anti-Pattern | Why |
|---|---|
| Import `glslify` or any missing dependency | Will crash browserify build |
| Call `output.renderPasses()` | This method does not exist — use `output.render()` |
| Use `export default` in `src/index.js` | Breaks browserify build entry |
| Add `type: 'renderpass'` transforms to glsl-functions.js | Not implemented — `glsl-source.js` logs a warning and skips |
| Reference `precisionValue` anywhere | Undefined variable — exists only in dead `shaderManager.js` |
| Add properties directly to `window` in lib files | Use the `makeGlobal` pathway via `synth` object and `EvalSandbox` |
| Concatenate array-extending transforms: `functions.concat(x)` without reassigning | `.concat()` returns a new array; the result must be used |

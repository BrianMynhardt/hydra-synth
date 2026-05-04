# Onboarding — Hydra-Synth Agent Handoff

This document allows a new agent session — with no prior memory of this repository — to
become productive within the first context window. Read it top to bottom before touching
any source file.

---

## The single most important thing to understand

**This library does not evaluate GLSL at JS call time.** When a user writes
`osc(4).rotate(0.5).out()`, the call to `osc(4)` creates a data structure, `.rotate(0.5)`
appends to it, and `.out()` is the moment the GLSL string is assembled and compiled. There
is no intermediate representation between the data structure and the string — the GLSL
is emitted by a chain of JavaScript closures walking the transform array.

If you forget this and try to "just edit the GLSL", you will end up editing a data object's
`glsl` body field in `src/glsl/glsl-functions.js` — which is exactly where you should be.

---

## What this library is

`hydra-synth` is the WebGL engine behind [Hydra](https://hydra.ojack.xyz), a browser-based
live-coding video synthesiser. Users write JavaScript expressions like:

```js
osc(4, 0.1, 1.2).color(1, 0, 0.5).rotate(0.5, 0.1).out(o0)
```

These are translated at runtime into GLSL fragment shaders, compiled by `regl`, and rendered
to a `<canvas>`. The library is **browser-only** — it requires `window`, `WebGL`, and
`navigator.mediaDevices`. The only files that run in Node.js are
`src/glsl/glsl-functions.js`, `src/lib/array-utils.js`, and `src/lib/easing-functions.js`.

---

## Five-step mental model

```
1. DATA
   src/glsl/glsl-functions.js exports ~50 plain-object transform definitions.
   Each has { name, type, inputs[], glsl_body }.

2. FACTORY
   At startup, GeneratorFactory.init() converts each definition into:
     • a JS generator function (for type='src')
     • a GlslSource prototype method (for all other types)
   These are registered on synth{} and (if makeGlobal:true) on window.

3. CHAIN
   User code calls generator functions and chains prototype methods.
   GlslSource.transforms[] accumulates the chain. No GLSL yet.

4. COMPILE
   .out(output) triggers GlslSource.compile(), which calls generateGlsl()
   to emit a GLSL string, then output.render() to compile it via regl.

5. RENDER
   HydraRenderer.tick() fires ~60fps. Each output.tick() calls the regl
   draw command, rendering the shader into a ping-pong FBO.
   The FBO is blitted to the canvas after all outputs are processed.
```

---

## Repository layout (read this, not the full tree)

```
src/
  hydra-synth.js     ← START HERE for understanding orchestration
  glsl-source.js     ← START HERE for understanding chain + compile
  generator-factory.js
  generate-glsl.js
  format-arguments.js
  output.js
  hydra-source.js
  eval-sandbox.js
  glsl/
    glsl-functions.js  ← START HERE to add or edit a visual transform
    utility-functions.js
  lib/
    array-utils.js
    audio.js
    (other browser helpers)

harness/
  constraints.md     ← ALWAYS READ BEFORE MODIFYING src/
  findings.md        ← LIST OF KNOWN BUGS — do not fix without dedicated PR
  validate.js        ← run with: npm run harness:validate
  context/
    adr.md           ← WHY decisions were made
    glossary.md      ← domain vocabulary

docs/
  ARCHITECTURE.md    ← data-flow diagram + dependency rules
  API_REFERENCE.md   ← every public class, function, constant
  PATTERNS.md        ← recurring design patterns with code examples
  ONBOARDING.md      ← this file
```

---

## Before you change anything

Run the structural validator:
```sh
npm run harness:validate
```

Read `harness/constraints.md` — all 10 rules. The rules encode invariants that cause
**silent failures** when violated (no error is thrown; the feature simply disappears or
produces wrong output).

The three most important constraint rules for day-to-day work:

**Rule 1 — Valid transform types.** Every new entry in `glsl-functions.js` must have
`type` set to one of: `'src'`, `'coord'`, `'color'`, `'combine'`, `'combineCoord'`.
Any other value causes `processGlsl()` to return `undefined`, silently dropping the transform.

**Rule 5 — Ping-pong FBOs.** `Output` always has exactly two FBOs. Never reduce to one.
Collapsing them breaks all feedback effects (`src(o0).scale(0.99).out(o0)`).

**Rule 8 — Module boundaries.** `src/lib/` files must not import from `src/` root files.
`src/glsl/` files must not import from `src/` root files. Nothing imports `hydra-synth.js`.

---

## Known bugs — do not fix as side effects

Eight bugs are logged in `harness/findings.md`. Read the file before touching these areas.
Do **not** fix them as part of unrelated work — each needs its own dedicated PR.

| ID | Location | Summary |
|----|----------|---------|
| F-001 | `generator-factory.js:36` | `extendTransforms` array form silently discarded |
| F-002 | `glsl/renderpass-functions.js:1` | Imports `glslify` (not installed) — crash if imported |
| F-003 | `src/shaderManager.js` | References undefined `precisionValue` — dead code |
| F-004 | `src/index.js` | `module.exports` in `"type":"module"` package — latent risk |
| F-005 | `src/lib/audio.js:150` | `setBins()` closures reference global `a` — broken when `makeGlobal:false` |
| F-006 | `src/lib/sandbox.js` | `globalThis.eval` — no actual sandboxing |
| F-007 | `src/hydra-synth.js:177,185` | `console.log` in `setResolution()` — debug remnants |
| F-008 | `src/lib/video-recorder.js:15` | `sourceBuffer` undeclared in `sourceopen` handler |

---

## How to add a new visual transform (the most common task)

1. Open `src/glsl/glsl-functions.js`
2. Add a new object to the exported array:
   ```js
   {
     name: 'myEffect',          // unique camelCase identifier
     type: 'color',             // pick the right type for what you're doing
     inputs: [
       { name: 'amount', type: 'float', default: 1.0 }
     ],
     glsl: `
       return vec4(_c0.rgb * amount, _c0.a);
     `
   }
   ```
3. Run `npm run harness:validate` — it checks that the type is valid and the file structure
   is intact
4. Start the dev server (`npm run dev`) and test the effect manually

The five `type` values and what each receives/returns:

| type | receives | returns | use for |
|------|----------|---------|---------|
| `src` | `vec2 _st` (UV) | `vec4` (colour) | generating colour from coordinates |
| `coord` | `vec2 _st` | `vec2` | distorting UV before sampling |
| `color` | `vec4 _c0` | `vec4` | transforming colour after sampling |
| `combine` | `vec4 _c0`, `vec4 _c1` | `vec4` | blending two colour sources |
| `combineCoord` | `vec2 _st`, `vec4 _c0` | `vec2` | distorting UV using another source |

---

## How to add a new media source type

1. Add a method to `HydraSource` in `src/hydra-source.js`, following the pattern of `initCam`:
   ```js
   initMySource (opts, params) {
     // async setup
     myAPI.then(response => {
       this.src = response.mediaElement
       this.dynamic = true
       this.tex = this.regl.texture({ data: this.src, ...params })
     })
   }
   ```
2. If the new API requires browser initialisation boilerplate, create a helper in `src/lib/`:
   ```js
   // src/lib/my-source-helper.js
   export default function myHelper() {
     return navigator.mediaDevices.someAPI(…)
   }
   ```
3. Import the helper in `hydra-source.js`; do not import `src/hydra-synth.js` or any other
   root file from `src/lib/`

---

## How the user API is exposed

All user-facing functions and objects live on `this.synth` in `HydraRenderer`. When
`makeGlobal: true` (the default), every property of `synth` is also available on `window`.

To add a new user-callable function:
1. Add it to `this.synth` in `HydraRenderer.constructor()`
2. That's it — `EvalSandbox` will mirror it to `window` automatically

Never add to `window` directly. The `synth → EvalSandbox → window` pathway is the only safe
route.

---

## Build, run, and validate commands

```sh
npm install                  # install dependencies (once)

npm run dev                  # start dev server with live-reload (opens browser)
                             # create dev/index.js with your test code first

npm run build                # compile UMD bundle → dist/hydra-synth.js
                             # required before running npm run harness

npm run harness              # start Node introspection server + browser demo
                             # open http://localhost:3333 after running

npm run harness:validate     # run structural linter (3 rules)
                             # always run before committing src/ changes
```

No Jest, no Mocha, no ESLint. Validation is `harness/validate.js` only. There are no
automated tests — changes must be verified manually in the browser.

---

## The two files that are most commonly confused

**`src/index.js`** — the browserify build entry. Uses `import` (transpiled by esmify) +
`module.exports` (for browserify). This is NOT the ESM API. Do not add logic here.

**`src/hydra-synth.js`** — the actual `HydraRenderer` class. This is the ESM entry
consumed by `import Hydra from 'hydra-synth'`. This is where the constructor, tick loop,
and orchestration live.

If you are reading the library to understand how it works, start with `src/hydra-synth.js`.
If you are building the UMD bundle, the entry point is `src/index.js`.

---

## Dead code that must not be edited

Three files are dead code — they are not imported by the main library and contain broken
references. Leave them in place; do not extend or import them:

| File | Why it is dead |
|------|---------------|
| `src/shader-generator.js` | Standalone server-side tool; uses CJS `module.exports`; not imported |
| `src/shaderManager.js` | Prototype fragment builder; references undefined `precisionValue`; not imported |
| `src/glsl/renderpass-functions.js` | Imports `glslify` (not installed); renderpass type is unimplemented |

The `renderpass` type in `glsl-source.js` logs a `console.warn` and skips the transform if
encountered. Do not add `type: 'renderpass'` to `glsl-functions.js`.

---

## Common agent mistakes to avoid

| Mistake | What actually happens | Correct approach |
|---------|----------------------|-----------------|
| Adding `type: 'myNewType'` to a transform | `processGlsl()` silently drops it | Use one of the five valid types |
| Importing `glslify` | Browserify build fails at bundle time | Never import packages not in `package.json` |
| Changing `module.exports` to `export default` in `index.js` | UMD build breaks | Leave `src/index.js` untouched |
| Editing `dist/hydra-synth.js` | Next `npm run build` overwrites all changes | Edit `src/` files, then rebuild |
| Reducing `Output.fbos` to one element | All feedback effects break silently | Keep exactly two FBOs |
| Adding `window.xxx = yyy` in a `lib/` file | Bypasses `makeGlobal:false` control | Use `synth{}` → `EvalSandbox` pathway |
| Calling `output.renderPasses()` | Method does not exist; throws | Use `output.render(passes)` |
| Using `.concat(x)` without reassigning for `extendTransforms` | Result discarded (F-001) | Use `functions.push(x)` or reassign |

---

## Quality grades at a glance

| Module | Grade | Note |
|--------|-------|------|
| `glsl/glsl-functions.js` | A | Self-documenting schema with full file header |
| `glsl/utility-functions.js` | A | Clear naming, typed entries |
| `lib/easing-functions.js` | A | Pure math, fully self-describing |
| `hydra-synth.js` | B | Orchestration clear; constructor options undocumented in code |
| `generator-factory.js` | B | `processGlsl` and `typeLookup` are clear |
| `glsl-source.js` | B | Chain accumulation clear; `compile()` GLSL assembly is complex |
| `output.js` | B | Ping-pong non-obvious without context; read ADR-004 first |
| `eval-sandbox.js` | B | tick() re-sync pattern non-obvious without ADR-003 |
| `hydra-source.js` | B | Methods self-explanatory |
| `lib/array-utils.js` | B | `getValue()` closure chain slightly opaque |
| `lib/mouse.js` / `mouse-event.js` | B | Adequate |
| `lib/sandbox.js` | B | Thin and clear |
| `generate-glsl.js` | C | Closure-on-closure pattern requires careful study; see docs/PATTERNS.md #3 |
| `format-arguments.js` | C | Complex conditional resolution; `startIndex` semantics are implicit |
| `lib/audio.js` | C | `settings` array pattern unexplained; F-005 bug present |
| `lib/video-recorder.js` | C | F-008 bug; MediaSource path poorly documented |
| `shader-generator.js` | D | Dead code; CJS format; do not touch |
| `shaderManager.js` | D | Dead code; broken references; do not touch |
| `glsl/renderpass-functions.js` | D | Dead code; missing dependency; do not touch |

Grade scale: A = fully self-describing, B = adequate, C = gaps that could cause agent errors,
D = opaque / dead; must not be used.

# AGENTS.md — Hydra-Synth Agent Operating Guide

This file is the authoritative operating guide for any AI agent working on this repository.
Read it in full before making any changes.

---

## Project Purpose and Architecture

`hydra-synth` is a browser-based WebGL live-coding video synthesizer engine, published as an npm
library. It is the runtime core of the [Hydra editor](https://hydra.ojack.xyz). Users write
short JavaScript expressions (e.g. `osc(4, 0.1).rotate(0.5).out()`) that are translated at
runtime into GLSL fragment shaders, compiled by `regl`, and rendered to a `<canvas>` element.

The central architectural abstraction is the **transform pipeline**:
1. `src/glsl/glsl-functions.js` — a pure data file exporting ~50 GLSL transform definitions
2. `src/generator-factory.js` — processes those definitions into JavaScript generator functions
   and prototype methods on `GlslSource`
3. `src/glsl-source.js` — `GlslSource` accumulates a chain of transforms; `.out()` triggers shader
   compilation
4. `src/generate-glsl.js` — walks the transform chain and emits a GLSL fragment shader string
5. `src/output.js` — wraps a pair of `regl` framebuffers (ping-pong) and executes the draw call
6. `src/hydra-synth.js` — `HydraRenderer` orchestrates everything: outputs, sources, the render
   loop, audio, and the user-facing `synth` API object

The library is **browser-only at runtime** — `window`, `navigator`, `document`, and WebGL are
required and unavailable in Node.js. The only files that work in Node without a browser are
`src/glsl/glsl-functions.js` and the pure-logic utilities in `src/lib/array-utils.js` and
`src/lib/easing-functions.js`.

---

## Directory Map

```
hydra-synth/
├── src/                        Core library source (ESM, browser-only)
│   ├── hydra-synth.js          Main class: HydraRenderer (constructor + render loop)
│   ├── index.js                CJS compatibility shim for browserify / legacy require()
│   ├── glsl-source.js          GlslSource: transform chain builder + shader emitter
│   ├── generator-factory.js    GeneratorFactory: converts GLSL defs → JS functions
│   ├── generate-glsl.js        generateGlsl(): walks transform chain → GLSL string
│   ├── format-arguments.js     formatArguments(): resolves JS values → shader uniforms
│   ├── eval-sandbox.js         EvalSandbox: global / local eval bridge
│   ├── hydra-source.js         HydraSource: webcam / video / image / canvas texture inputs
│   ├── output.js               Output: ping-pong FBO + regl draw call
│   ├── shader-generator.js     ShaderGenerator: server-side/standalone shader tool (DEAD CODE)
│   ├── shaderManager.js        Frag builder prototype (DEAD CODE — has undefined references)
│   └── glsl/
│       ├── glsl-functions.js   Transform definitions data file (~50 transforms, 1107 lines)
│       ├── utility-functions.js Internal GLSL helpers injected into every shader
│       ├── renderpass-functions.js  Renderpass blur (DEAD CODE — imports missing glslify)
│       └── gaussian.frag       Gaussian blur GLSL (used only by renderpass-functions.js)
│   └── lib/
│       ├── array-utils.js      Array.prototype extensions (.fast/.smooth/.ease) + getValue()
│       ├── audio.js            Audio: Meyda-based FFT analyser + beat detection
│       ├── easing-functions.js Easing curve functions (pure math, Node-compatible)
│       ├── mouse-event.js      Low-level mouse event helpers
│       ├── mouse.js            MouseTools: tracks mouse position + button state
│       ├── sandbox.js          createSandbox(): thin wrapper around globalThis.eval
│       ├── screenmedia.js      Screen capture helper (getUserMedia)
│       ├── video-recorder.js   MediaRecorder wrapper for .webm export
│       └── webcam.js           Webcam initialisation helper
├── dist/
│   └── hydra-synth.js          UMD bundle (BUILD ARTIFACT — do not edit)
├── dev/
│   ├── index.js                Dev entry point loaded by budo (not committed, see README)
│   └── examples.js             Example hydra sketches for manual dev testing
├── harness/                    Agent harness (structural validation, docs, prompts)
│   ├── index.js                Dev harness: introspects library + serves browser.html
│   ├── browser.html            Visual WebGL demo harness (19 cycled demos)
│   ├── validate.js             Structural linter — run with `npm run harness:validate`
│   ├── constraints.md          Architectural rules that must never be violated
│   ├── findings.md             Bugs/improvements log — log here, do NOT fix here
│   ├── gc-prompt.md            Prompt for periodic garbage-collection / entropy check
│   ├── README.md               Harness onboarding and usage guide
│   └── context/
│       ├── adr.md              Architecture Decision Records
│       └── glossary.md         Domain term glossary
├── assets/                     Static images for README
├── AGENTS.md                   ← this file
├── CHANGELOG.md                User-facing changelog
├── LICENSE                     AGPL
├── package.json                npm metadata, scripts, dependencies
└── README.md                   Public-facing documentation
```

---

## Files the Agent MAY Modify

| Path | Reason |
|------|--------|
| `src/**/*.js` | Core library source — the main work surface |
| `src/glsl/glsl-functions.js` | Adding or editing GLSL transform definitions |
| `src/glsl/utility-functions.js` | Editing shared GLSL helper functions |
| `README.md` | Public documentation updates |
| `CHANGELOG.md` | Recording changes |
| `harness/**` | Harness tooling and documentation |
| `dev/examples.js` | Dev-harness example sketches |

---

## Files and Directories That Are OFF LIMITS

| Path | Reason |
|------|--------|
| `dist/hydra-synth.js` | Build artifact — regenerated by `npm run build`; editing is immediately overwritten |
| `package.json` | Version, exports map, and dependency graph — changes require deliberate human decision |
| `package-lock.json` | Lockfile — only touch when explicitly adding/removing dependencies |
| `node_modules/` | Dependency tree — never modify |
| `.git/` | Git internals |
| `src/glsl/gaussian.frag` | Used only by dead-code renderpass path; leave untouched until renderpass is revived |

---

## Naming Conventions and Code Style

These conventions are derived from the existing codebase and must be preserved:

- **File names**: kebab-case (`glsl-source.js`, `array-utils.js`, `generator-factory.js`)
- **Class names**: PascalCase (`HydraRenderer`, `HydraSource`, `GeneratorFactory`)
- **Variable/method names**: camelCase throughout
- **GLSL transform names** (the `name` field in glsl-functions.js): camelCase, short and
  descriptive (`osc`, `voronoi`, `modulateScale`)
- **GLSL internal variable names**: prefixed with underscore to avoid collisions with user-defined
  names (`_st`, `_c0`, `_c1`, `_noise`, `_luminance`)
- **Output buffers**: named `o0`–`o3`; **source buffers**: named `s0`–`s3`
- **Comments**: sparse; only used when the reason is non-obvious. Do not add doc-block headers.
- **No trailing semicolons** are not enforced but the existing code is inconsistent — match the
  file you are editing.

### Mixed OOP Style — Do Not Unify

The codebase uses two class patterns:
- `Output` and `GlslSource`: **function constructor + prototype** (`var Output = function() {}`,
  `Output.prototype.method = function() {}`)
- `HydraRenderer`, `HydraSource`, `Audio`: **ES6 `class`** syntax

Do not convert one style to the other. Both are intentional (Output and GlslSource predate the
class syntax migration). Any conversion risks subtle breakage in regl's internal reference
handling.

---

## Module Format and Import/Export Conventions

The package declares `"type": "module"` in `package.json`, making all `.js` files ESM by default.

| File | Format | Reason |
|------|--------|--------|
| `src/hydra-synth.js` | ESM (`export default`) | Main ESM entry (`exports["."].import`) |
| `src/*.js` (all others) | ESM (`import` + `export default`) | Standard source modules |
| `src/index.js` | **Mixed** (`import` + `module.exports`) | Browserify build entry; see note below |
| `src/shader-generator.js` | CJS (`module.exports`) | Dead code — standalone tool, ignore |

**`src/index.js` note**: This file is processed by browserify (which uses CommonJS) during the
build (`npm run build`). The `import` statements are transpiled by the `esmify` browserify plugin.
The `module.exports = Synth` at the bottom makes the bundle work as a UMD standalone. Do **not**
change `module.exports` to `export default` here — that breaks the build. The proper ESM consumer
path goes through `src/hydra-synth.js` directly (via the `exports` map in `package.json`).

**Importing rules:**
- Always use `import` at the top of the file, not dynamic `require()`
- `import` paths must include the `.js` extension (ESM resolution requires it)
- Never add a dependency that is not already in `package.json`

---

## Patterns and Abstractions That Must Be Preserved

### 1. Transform-as-data pattern
New GLSL functions are added to `src/glsl/glsl-functions.js` as data objects — never as inline
JavaScript. Each definition must have:
```js
{
  name: 'myFunc',                // string, camelCase, unique
  type: 'src',                   // one of: 'src', 'coord', 'color', 'combine', 'combineCoord'
  inputs: [                      // array (may be empty)
    { name: 'paramName', type: 'float', default: 1.0 }
  ],
  glsl: `...GLSL body only...`   // body without signature — signature is generated
}
```
See `harness/context/glossary.md` for what each `type` value means.

### 2. Uniform naming via `startIndex`
`format-arguments.js` appends `startIndex` to uniform names to prevent collisions across chains.
Do not rename or remove this mechanism.

### 3. Ping-pong framebuffers in Output
`Output` holds two FBOs (`this.fbos[0]` and `this.fbos[1]`). `pingPongIndex` alternates each
frame. `getCurrent()` returns the just-rendered buffer; `getTexture()` returns the previous one
(used for `prevBuffer` feedback effects). Never collapse the two FBOs into one.

### 4. The `synth` object is the user API surface
Properties added to `this.synth` inside `HydraRenderer` are exposed to users (and to `window`
when `makeGlobal: true`). Be conservative: only add properties that are intentional public API.

### 5. Array.prototype patching via `arrayUtils.init()`
`src/lib/array-utils.js` patches `Array.prototype` with `.fast()`, `.smooth()`, `.ease()`,
`.offset()`, and `.fit()`. This is called once in `HydraRenderer` constructor. It is a known
non-standard approach. Do not remove it, but do not extend it further either.

---

## How to Run, Lint, and Validate

```sh
# Install dependencies (once)
npm install

# Start dev server with live-reload (opens browser)
npm run dev

# Build UMD bundle (required before running browser harness)
npm run build

# Start dev harness (Node introspection + browser demo server)
npm run harness
# then open http://localhost:3333

# Run structural validator
npm run harness:validate
```

There is no linter or formatter configured. No test framework is present. Validation is provided
entirely by `harness/validate.js`.

---

## Assumptions Made by This Document

- `src/shader-generator.js` and `src/shaderManager.js` are dead code not imported by anything.
  They are left in place but should not be edited or extended. See `harness/findings.md`.
- `src/glsl/renderpass-functions.js` is also dead code (imports `glslify` which is not in
  `package.json`). The renderpass type in `glsl-source.js` logs a warning and does nothing.
- The `dev/` directory is used only for local development; `dev/index.js` is created by the
  developer on first run and is not in version control.

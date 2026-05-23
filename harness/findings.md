# Harness Findings Log

This file records bugs, inconsistencies, and improvement opportunities discovered during
harness reconnaissance. **Do not fix items here — log them and open issues or PRs separately.**

Items are assigned an ID for cross-reference from other harness documents.

---

## Active Findings

### F-001 — `extendTransforms` array concatenation result is not used

**File:** `src/generator-factory.js`, line 36  
**Severity:** Bug (silent feature failure)

```js
// Current (broken):
if (Array.isArray(this.extendTransforms)) {
  functions.concat(this.extendTransforms)  // ← result discarded
}
```

`Array.prototype.concat()` returns a **new array**; it does not mutate `functions`. The
`extendTransforms` transforms are silently ignored when passed as an array. The single-object
path (`typeof this.extendTransforms === 'object' && this.extendTransforms.type`) works
correctly via `functions.push()`.

**Expected fix:** Change to `functions = functions.concat(this.extendTransforms)`.

---

### F-002 — `src/glsl/renderpass-functions.js` imports `glslify` (not in package.json)

**File:** `src/glsl/renderpass-functions.js`, line 7  
**Severity:** Crash if imported

```js
import glsl from 'glslify'
```

`glslify` is not listed in `package.json` dependencies. This file is currently dead code
(nothing imports it), but if it were ever imported, the build/runtime would crash.

**Note:** The `renderpass` transform type is referenced in `glsl-source.js` (line ~43) but
is explicitly handled with `console.warn('no support for renderpass')` and skipped.

**Expected fix:** Either add `glslify` to devDependencies and complete the renderpass
implementation, or remove the file and the dead renderpass code path.

---

### F-003 — `src/shaderManager.js` references undefined variable `precisionValue`

**File:** `src/shaderManager.js`, line ~39  
**Severity:** Crash if used (dead code)

```js
var pass = {
  frag: frag,
  uniforms: output.uniforms,
  precision: precisionValue  // ← undefined variable
}
```

`precisionValue` is never defined in this file or its scope. Additionally, `shaderManager.js`
uses `module.exports` while the rest of the codebase uses ESM. It appears to be a prototype
or dead code that was never integrated. Nothing in the codebase imports it.

**Expected fix:** Delete the file, or migrate it to ESM and fix the undefined reference.

---

### F-004 — `src/index.js` uses `module.exports` in a `"type": "module"` package

**File:** `src/index.js`, `package.json`  
**Severity:** Latent risk (works today via browserify; would break direct Node execution)

```js
import Synth from './hydra-synth.js'
module.exports = Synth
```

In a package with `"type": "module"`, `.js` files are treated as ESM by Node.js.
`module` is not defined in ESM scope. Executing this file directly in Node (e.g.
`node src/index.js`) would throw `ReferenceError: module is not defined`.

Currently harmless because:
- The `exports` field in `package.json` routes `import` to `src/hydra-synth.js` (not `src/index.js`)
- The `exports["require"]` field routes to `dist/hydra-synth.js` (the built bundle)
- Only browserify uses `src/index.js` directly, and browserify handles `module.exports` fine

**Expected fix:** Rename `src/index.js` to `src/index.cjs` and update `package.json` `"main"` to match, OR keep as-is and add a comment explaining the dual-mode intent.

---

### F-006 — Eval sandbox provides no actual isolation

**File:** `src/lib/sandbox.js`  
**Severity:** Architectural note (known limitation)

```js
globalThis.eval(initial)
var localEval = function (code) {
  globalThis.eval(code)
}
```

The `createSandbox` function uses `globalThis.eval`, meaning user code executes with full
access to the global scope. The comment in the file acknowledges this: *"for now, just avoids
polluting the global namespace... should probably be replaced with an abstract syntax tree"*.

There is no content isolation, capability restriction, or error boundary beyond the `try/catch`
wrappers in `HydraRenderer.tick()` and `EvalSandbox`.

**Note:** This is by design for the live-coding context. Fixing it would require a significant
architecture change. Document it, do not silently "fix" it without community discussion.

---

### F-007 — `src/hydra-synth.js` console.log calls left in production code

**File:** `src/hydra-synth.js`, lines ~177, 185  
**Severity:** Minor (log noise in production)

```js
console.log(this.width)
// ...
console.log(this.canvas.width)
```

`setResolution()` logs width values unconditionally. These are debug remnants.

---

---

## Resolved Findings

### F-008 — `src/lib/video-recorder.js` references `sourceBuffer` (wrong variable)

**File:** `src/lib/video-recorder.js`, line 15  
**Severity:** Bug in `MediaSource` path  
**Resolved in:** `fix(video-recorder): reference self.sourceBuffer in sourceopen log (F-008)` (`74f7819`)

`sourceBuffer` was undeclared in the `sourceopen` handler scope. Fixed by changing the
`console.log` reference from `sourceBuffer` to `self.sourceBuffer`.

### F-005 — `src/lib/audio.js` references `a` (implicit global) in `setBins()`

**File:** `src/lib/audio.js`  
**Severity:** Bug (broken in non-global mode)  
**Resolved in:** `feat(audio): add initMic/initStream/initMedia source switching + fix F-005`

The closure in `setBins()` referenced the global `a` instead of `this`. Fixed by replacing
`a.fft[index]` with `this.fft[index]`. Window helper registration is now also guarded by
`this._makeGlobal`, so `makeGlobal: false` instances no longer assign to `window`.

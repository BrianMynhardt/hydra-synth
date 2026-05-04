# hydra-synth dev harness

A self-contained development harness for exploring and debugging the `hydra-synth` library.
No test framework is used — this is a plain script that calls the public API and renders the
results visually.

## What it does

**`harness/index.js`** — Node.js entry point (run this first)

1. Imports `src/glsl/glsl-functions.js` directly in Node and prints every defined GLSL
   transform (name, type, input signatures, defaults) — no browser required.
2. Imports `src/hydra-synth.js` and introspects the `HydraRenderer` class prototype and
   the full `synth.*` API surface.
3. Starts a local HTTP server on port 3333 that serves the project root, so `browser.html`
   can load `../dist/hydra-synth.js` and all source files via relative paths.

**`harness/browser.html`** — Visual browser harness

Opens automatically at `http://localhost:3333`. Exercises 19 demos that cycle every 5 s:

| Category | Exports exercised |
|---|---|
| Source Generators | `osc`, `noise`, `voronoi`, `shape`, `gradient`, `solid` |
| Color Transforms | `invert`, `contrast`, `brightness`, `saturate`, `hue`, `colorama`, `shift`, `color`, `posterize`, `luma`, `thresh`, `sum`, `r`, `g`, `b`, `a` |
| Coordinate Transforms | `rotate`, `scale`, `pixelate`, `kaleid`, `repeat`, `repeatX`, `scrollX`, `scrollY` |
| Combine | `add`, `sub`, `mult`, `blend`, `diff`, `layer`, `mask` |
| Modulate | `modulate`, `modulateScale`, `modulateRotate`, `modulatePixelate`, `modulateHue`, `modulateRepeat`, `modulateScrollX` |
| Time & Animation | function callbacks `() => synth.time` |
| Feedback | `src(o0)` ping-pong feedback loop |
| Custom Transforms | `setFunction()` + custom `myOsc` (type: `src`) |
| Source Buffers | `s0.initCanvas()`, `s0.initVideo()`, `s0.initImage()` |
| Complex Composition | multi-step chained expression |

## Prerequisites

The browser harness loads the pre-built UMD bundle. Build it once:

```sh
npm run build
```

This writes `dist/hydra-synth.js`. You only need to rebuild if you change source files.

## How to run

```sh
# From the project root:
npm run harness
# …or directly:
node harness/index.js
```

Then open **http://localhost:3333** in a browser.

The Node.js output prints to your terminal immediately. The browser harness starts cycling
through demos automatically. Use the **prev / next** buttons to jump, or **pause** to hold
on a demo.

## How to add new debug cases

1. Open `harness/browser.html` and find the `const demos = [...]` array.
2. Add a new object following this shape:

   ```js
   {
     category: 'My Category',            // shown in the UI header
     name: 'myNewDemo()',                 // demo title
     desc: 'What this exercises.',        // shown in the UI body
     exports: ['functionA', 'functionB'], // informational only
     run() {
       osc(4).myNewDemo().out(o0);
       render(o0);
     },
   },
   ```

3. Refresh the browser — no build step needed for the harness HTML itself.

**Tips:**
- `hush()` is called automatically before each `run()` — no need to clean up yourself.
- `synth.update = dt => {}` is reset before each demo; set it inside `run()` for
  per-frame JS logic (e.g. updating a canvas drawing in the `initCanvas` demo).
- All generator args accept either a number or a `() => number` function for live
  animation: `osc(() => synth.time * 2)`.
- To add a custom GLSL transform, call `setFunction(def)` once outside the demos array
  (it throws if called twice with the same name). The registered function is then
  available as `synth.myFnName(...)`.

## Notes

- `s0.initVideo()` and `s0.initImage()` demos require internet access; the canvas may
  be blank for a few seconds while the asset loads.
- The harness uses `makeGlobal: false` so it does not pollute `window`. All API calls
  go through the destructured `synth.*` namespace.
- The HTTP server (port 3333) only binds to `127.0.0.1` — it is not accessible remotely.

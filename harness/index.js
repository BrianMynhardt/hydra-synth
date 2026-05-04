/**
 * hydra-synth dev harness — Node.js entry point
 *
 * Two responsibilities:
 *   1. Exercise the glsl-functions.js export directly in Node (pure JS, no browser needed)
 *   2. Serve harness/browser.html over HTTP for the full WebGL visual harness
 *
 * Run: node harness/index.js   (or: npm run harness)
 * Then open http://localhost:3333 in a browser.
 */

import { createServer } from 'http'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, extname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = join(__dirname, '..')

// ── Banner ────────────────────────────────────────────────────────────────

console.log('\n╔══════════════════════════════════════════╗')
console.log('║          hydra-synth dev harness         ║')
console.log('╚══════════════════════════════════════════╝\n')

// ── 1. glsl-functions.js — pure-JS export, works in Node ─────────────────
//
// The exported value is a factory: () => Array<TransformDef>
// Each TransformDef has: { name, type, inputs: [{name, type, default}], glsl }

console.log('▶ glsl-functions export (Node-compatible)\n')

try {
  const { default: glslFunctionsDef } = await import('../src/glsl/glsl-functions.js')
  const fns = glslFunctionsDef()

  // Group by type
  const byType = {}
  for (const fn of fns) {
    ;(byType[fn.type] = byType[fn.type] || []).push(fn)
  }

  console.log(`  Total transform definitions: ${fns.length}\n`)

  for (const [type, group] of Object.entries(byType)) {
    const returnTypes = {
      src:          'vec4(vec2 _st)',
      coord:        'vec2(vec2 _st)',
      color:        'vec4(vec4 _c0)',
      combine:      'vec4(vec4 _c0, vec4 _c1)',
      combineCoord: 'vec2(vec2 _st, vec4 _c0)',
    }
    console.log(`  [${type}]  ${returnTypes[type] || ''}  (${group.length} functions)`)
    for (const fn of group) {
      const sig = fn.inputs.length
        ? fn.inputs.map(i => `${i.name}=${i.default}`).join(', ')
        : '—'
      console.log(`    ${fn.name.padEnd(24)} inputs: ${sig}`)
    }
    console.log()
  }
} catch (e) {
  console.error('  ✗ glsl-functions import failed:', e.message)
}

// ── 2. hydra-synth.js class structure (import may fail in Node due to regl/navigator) ─

console.log('▶ hydra-synth.js class introspection\n')

try {
  const { default: HydraRenderer } = await import('../src/hydra-synth.js')

  if (typeof HydraRenderer === 'function') {
    const protoMethods = Object.getOwnPropertyNames(HydraRenderer.prototype)
      .filter(n => n !== 'constructor')

    console.log(`  ✓ HydraRenderer class loaded`)
    console.log(`  Prototype methods: ${protoMethods.join(', ')}\n`)

    console.log('  Constructor options:')
    const opts = [
      'canvas          — HTMLCanvasElement (created+appended if omitted)',
      'width/height    — 1280×720 default',
      'autoLoop        — boolean, default true',
      'makeGlobal      — boolean, exposes API on window, default true',
      'detectAudio     — boolean, default true',
      'numSources      — default 4  (s0–s3)',
      'numOutputs      — default 4  (o0–o3)',
      'precision       — "lowp" | "mediump" | "highp"',
      'extendTransforms — custom GLSL transforms to add at init',
    ]
    opts.forEach(o => console.log(`    ${o}`))

    console.log('\n  synth.* API surface (populated after construction):')
    const surface = [
      'Generators   : osc, noise, voronoi, shape, gradient, solid, src, prev',
      'Color        : invert, contrast, brightness, saturate, hue, colorama,',
      '               posterize, luma, thresh, color, shift, mask, r, g, b, a, sum',
      'Coordinate   : rotate, scale, pixelate, repeat, repeatX, repeatY,',
      '               kaleid, scroll, scrollX, scrollY',
      'Combine      : add, sub, mult, blend, layer, diff',
      'ModCoord     : modulate, modulateScale, modulatePixelate, modulateRotate,',
      '               modulateHue, modulateRepeat, modulateRepeatX, modulateRepeatY,',
      '               modulateScrollX, modulateScrollY',
      'Outputs      : o0, o1, o2, o3  (Output instances)',
      'Sources      : s0, s1, s2, s3  (HydraSource instances)',
      'Control      : render([output]), hush(), tick(dt), setFunction(def)',
      'State        : time, bpm, fps, speed, width, height, stats, mouse',
      'Callbacks    : update(dt), afterUpdate(dt)',
    ]
    surface.forEach(s => console.log(`    ${s}`))
  }
} catch (e) {
  const msg = e.message || String(e)
  const knownBrowserAPIs = ['navigator', 'window', 'document', 'WebGL', 'canvas', 'requestAnimationFrame']
  const isBrowserOnly = knownBrowserAPIs.some(k => msg.includes(k))

  if (isBrowserOnly) {
    console.log(`  ⚠  Requires browser environment (expected in Node.js)`)
    console.log(`     Error: ${msg.split('\n')[0]}`)
    console.log(`     → Open http://localhost:3333 to run the full visual harness`)
  } else {
    console.error(`  ✗ Unexpected import error:`, msg)
  }
}

// ── 3. HTTP server — serves the full project tree so browser.html can load ──
//
// browser.html is at /harness/browser.html.
// It loads ../dist/hydra-synth.js which resolves to /dist/hydra-synth.js.
// The server root is the project root so all relative paths resolve correctly.

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.svg':  'image/svg+xml',
}

const server = createServer((req, res) => {
  let urlPath = req.url.split('?')[0]
  if (urlPath === '/') urlPath = '/harness/browser.html'

  const filePath = join(ROOT, decodeURIComponent(urlPath))

  // Prevent path traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  try {
    const content = readFileSync(filePath)
    const mime = MIME[extname(filePath)] || 'text/plain'
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' })
    res.end(content)
  } catch {
    res.writeHead(404)
    res.end(`404 Not found: ${urlPath}`)
  }
})

const PORT = 3333
server.listen(PORT, '127.0.0.1', () => {
  console.log('\n══════════════════════════════════════════════')
  console.log(`  ▶ Browser harness: http://localhost:${PORT}`)
  console.log('    Open in a browser to run the full visual demo')
  console.log('    (requires dist/hydra-synth.js — run `npm run build` if missing)')
  console.log('══════════════════════════════════════════════')
  console.log('\n  Ctrl+C to stop\n')
})

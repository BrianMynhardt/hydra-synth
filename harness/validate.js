/**
 * harness/validate.js — Structural validator for hydra-synth
 *
 * Enforces three deterministic rules derived from the architecture:
 *   Rule 1 — All GLSL transform definitions are structurally valid
 *   Rule 2 — src/index.js is correctly configured as the CJS/browserify bridge
 *   Rule 3 — Source file line counts are within thresholds
 *
 * Exit code 0 = all rules pass. Exit code 1 = one or more rules fail.
 *
 * Usage:  node harness/validate.js
 *         npm run harness:validate
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, dirname, extname, relative } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = join(__dirname, '..')

let allPassed = true

function pass(msg) {
  console.log(`  ✅ PASS  ${msg}`)
}

function fail(msg) {
  console.error(`  ❌ FAIL  ${msg}`)
  allPassed = false
}

function section(title) {
  console.log(`\nRule ${title}`)
  console.log('─'.repeat(60))
}

// ──────────────────────────────────────────────────────────────
// Rule 1: All GLSL transform definitions in src/glsl/glsl-functions.js
//         have the required fields and a valid type.
//
// Why: generator-factory.js::processGlsl() silently returns undefined for
// any transform with an unrecognised type (just logs a warning). A missing
// 'name', 'inputs', or 'glsl' causes a runtime crash that is hard to trace
// back to the data file.
// ──────────────────────────────────────────────────────────────

section('1: GLSL transform definitions are structurally valid')

const VALID_TYPES = new Set(['src', 'coord', 'color', 'combine', 'combineCoord'])
const REQUIRED_FIELDS = ['name', 'type', 'inputs', 'glsl']

try {
  const glslFnsPath = join(ROOT, 'src/glsl/glsl-functions.js')
  const { default: glslFnsDef } = await import(pathToFileURL(glslFnsPath).href)
  const fns = glslFnsDef()

  if (!Array.isArray(fns)) {
    fail('glsl-functions.js default export must be a function returning an array')
  } else {
    let rule1Failures = 0

    for (const fn of fns) {
      const label = fn.name ? `'${fn.name}'` : `(unnamed at index ${fns.indexOf(fn)})`

      for (const field of REQUIRED_FIELDS) {
        if (fn[field] === undefined || fn[field] === null) {
          fail(`Transform ${label} is missing required field '${field}'`)
          rule1Failures++
        }
      }

      if (fn.type !== undefined && !VALID_TYPES.has(fn.type)) {
        fail(
          `Transform ${label} has invalid type '${fn.type}' — ` +
          `must be one of: ${[...VALID_TYPES].join(', ')}`
        )
        rule1Failures++
      }

      if (fn.inputs !== undefined && !Array.isArray(fn.inputs)) {
        fail(`Transform ${label} — 'inputs' must be an array`)
        rule1Failures++
      }

      if (fn.glsl !== undefined && typeof fn.glsl !== 'string') {
        fail(`Transform ${label} — 'glsl' must be a string`)
        rule1Failures++
      }
    }

    if (rule1Failures === 0) {
      pass(`All ${fns.length} GLSL transform definitions are structurally valid`)
    }
  }
} catch (e) {
  fail(`Could not import src/glsl/glsl-functions.js: ${e.message}`)
}

// ──────────────────────────────────────────────────────────────
// Rule 2: src/index.js is the CJS/browserify bridge.
//
// Why: The npm build (`npm run build`) runs browserify on src/index.js.
// browserify requires a module.exports assignment. The ESM import of
// hydra-synth.js must also remain so esmify can transpile it.
// If either is removed, the UMD bundle breaks and CDN users lose access
// to the library. See AGENTS.md and harness/constraints.md rule 3.
// ──────────────────────────────────────────────────────────────

section('2: src/index.js is the CJS / browserify bridge')

try {
  const indexPath = join(ROOT, 'src/index.js')
  const indexContent = readFileSync(indexPath, 'utf8')

  const hasModuleExports = /module\.exports\s*=/.test(indexContent)
  const importsHydraSynth =
    /from\s+['"]\.\/hydra-synth\.js['"]/.test(indexContent) ||
    /import\s+['"]\.\/hydra-synth\.js['"]/.test(indexContent)

  if (!hasModuleExports) {
    fail(
      'src/index.js must contain `module.exports = ...` ' +
      '(CJS bridge for browserify build and legacy require())'
    )
  } else {
    pass('src/index.js contains module.exports assignment')
  }

  if (!importsHydraSynth) {
    fail(
      'src/index.js must import from ./hydra-synth.js ' +
      '(bridge to the main ESM implementation)'
    )
  } else {
    pass('src/index.js imports from ./hydra-synth.js')
  }
} catch (e) {
  fail(`Could not read src/index.js: ${e.message}`)
}

// ──────────────────────────────────────────────────────────────
// Rule 3: Source file line-count limits.
//
// Why: Enforcing line limits is a refactor signal, not a hard correctness
// check. Files that balloon in size tend to accumulate multiple concerns.
// glsl-functions.js is exempt because it is a pure data file (~1107 lines).
//
// Thresholds (see harness/constraints.md rule 9):
//   src/*.js and src/lib/*.js  → 600 lines
//   src/glsl/*.js              → 250 lines (except glsl-functions.js)
// ──────────────────────────────────────────────────────────────

section('3: Source file line-count limits')

const LIMITS = {
  src: 600,
  lib: 600,
  glsl: 250
}

const GLSL_EXEMPT = new Set(['glsl-functions.js'])

function countLines(filePath) {
  return readFileSync(filePath, 'utf8').split('\n').length
}

function checkFiles(dirPath, limitLines, exempt = new Set()) {
  let failures = 0
  let checked = 0

  let entries
  try {
    entries = readdirSync(dirPath)
  } catch {
    return { failures: 0, checked: 0 }
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry)
    const stat = statSync(fullPath)

    if (!stat.isFile()) continue
    if (extname(entry) !== '.js') continue
    if (exempt.has(entry)) continue

    const lines = countLines(fullPath)
    const rel = relative(ROOT, fullPath).replace(/\\/g, '/')
    checked++

    if (lines > limitLines) {
      fail(`${rel} — ${lines} lines (limit: ${limitLines}) — consider splitting`)
      failures++
    }
  }

  return { failures, checked }
}

const r3a = checkFiles(join(ROOT, 'src'),         LIMITS.src)
const r3b = checkFiles(join(ROOT, 'src/lib'),      LIMITS.lib)
const r3c = checkFiles(join(ROOT, 'src/glsl'),     LIMITS.glsl, GLSL_EXEMPT)

const r3TotalChecked = r3a.checked + r3b.checked + r3c.checked
const r3TotalFailed  = r3a.failures + r3b.failures + r3c.failures

if (r3TotalFailed === 0) {
  pass(`All ${r3TotalChecked} checked source files are within line-count limits`)
}

// ──────────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(60))

if (allPassed) {
  console.log('✅  All structural checks passed')
  process.exit(0)
} else {
  console.error('❌  One or more structural checks failed')
  process.exit(1)
}

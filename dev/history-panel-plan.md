## Overview

The History Panel adds full session recall to the dev/ live coding environment. Every Ctrl+Enter eval is captured in `window.evalHistory` (capped at 50 entries). A new `dev/panels/history.js` panel — following the exact shape of `dev/panels/audio.js` — renders each entry as a timestamp, an 80-character code preview, and a restore button. Alt+↑ / Alt+↓ shortcuts in the editor's keydown block let users navigate history without opening the panel. A single `localStorage` write after each eval gives cross-reload continuity for the most recent patch at near-zero cost.

## Constraints

- All changes are confined to `dev/` — no `src/` or `performance-ui.js` edits
- Panel shape must exactly match `dev/panels/audio.js`: `{ id, title, key, zone, width, height, init(el), update(el) }`, `'use strict'`, `module.exports`
- The `editor` textarea reference is exposed as `window._devEditor` (following the `window.a` convention used by audio.js) — do not restructure `initEditor()` otherwise
- `historyIndex` cursor lives as a closure-local `let` inside `initEditor()`, not on `window`
- `update(el)` must guard against full DOM re-renders on every tick — use an `el._lastLength` sentinel
- Do not disturb active findings F-001 through F-007 (all in `src/`)
- `dev/index.js` is not version-controlled; `dev/panels/` new files are safe to create

## Acceptance Criteria

- Ctrl+Enter eval pushes `{ code, ts }` to `window.evalHistory`; array never exceeds 50 entries
- `localStorage.getItem('hydra-last-eval')` pre-populates the editor on page reload
- Alt+↑ / Alt+↓ while the editor has focus advances/retreats through history and sets `editor.value`
- The History panel (Alt+H) renders a scrollable list of up to 50 entries, each with timestamp, 80-char preview, and a restore button
- Clicking restore writes the full code back into the editor textarea
- No changes to `dev/performance-ui.js`

## Phase 1: History Tracking in index.js

1. `dev/index.js`, top of `init()` — add `window.evalHistory = []`
2. `dev/index.js`, top of `initEditor()` — declare `let historyIndex = -1`
3. `dev/index.js`, inside `initEditor()`, before `document.body.appendChild(editor)` — add `window._devEditor = editor`
4. `dev/index.js`, inside `initEditor()`, in the `if (!editorValue) / else` block — replace the bare `editor.value = editorValue` with: check `localStorage.getItem('hydra-last-eval')` first, use it if present, fall back to `editorValue`
5. `dev/index.js`, inside the Ctrl+Enter try block, after `eval(editor.value)` — push `{ code: editor.value, ts: new Date() }` to `window.evalHistory`, slice to keep only the last 50 entries, reset `historyIndex = -1`, call `localStorage.setItem('hydra-last-eval', editor.value)`

## Phase 2: Keyboard Navigation in index.js

6. `dev/index.js`, inside `editor.addEventListener('keydown')` — add an `else if` branch: when `e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')`, call `e.preventDefault()`, advance or retreat `historyIndex` clamped to `[0, window.evalHistory.length - 1]`, and set `editor.value = window.evalHistory[historyIndex].code`

## Phase 3: History Panel

7. Create `dev/panels/history.js` with `'use strict'` at top
8. Implement `init(el)`: create a `div` with `style.overflowY = 'auto'` and `style.maxHeight = '240px'`; store it as `el._list`
9. Implement `update(el)`: bail early if `el._lastLength === window.evalHistory.length`; otherwise clear `el._list.innerHTML`; iterate `window.evalHistory` in reverse (newest first); for each entry create a row div with: a timestamp span (`entry.ts.toLocaleTimeString()`), a code preview span (entry.code truncated to 80 chars, `font-family: monospace`), and a "restore" button that on click sets `window._devEditor && (window._devEditor.value = entry.code)`; append row to `el._list`; set `el._lastLength = window.evalHistory.length`
10. Export `{ id: 'history', title: 'Eval History', key: 'h', zone: 'top-right', width: 360, height: 280, init, update }`

## Phase 4: Register Panel in index.js

11. `dev/index.js`, inside `init()` — add `const historyPanel = require('./panels/history')` alongside the `audioPanel` require
12. `dev/index.js`, inside `init()` — add `window.performanceUI.register(historyPanel)` after the existing audio panel registration

## Risks and Open Questions

- Alt+↑/↓ may conflict with browser or OS shortcuts in some contexts; `e.preventDefault()` is required and may suppress native textarea arrow-key behavior
- Panel height descriptor (`height: 280`) controls zone stacking offset; the scrollable inner div handles overflow, so visual content is safe — but the zone offset calculation in `performance-ui.js` uses this value, so keep it accurate
- `window._devEditor` must be set before any restore button is clicked; the flow (`initEditor` sets it → `new PerformanceUI` → `register`) ensures correct ordering
- No overlap with active findings F-001 through F-007

## Verification

1. Run `npm run dev` to start the dev server
2. Open the browser at the budo URL (default: http://localhost:9966)
3. Press Escape to show the editor; type and eval a few patches with Ctrl+Enter
4. Check `window.evalHistory` in the browser console — confirm entries are present
5. Press Alt+H to open the History panel — confirm entries list with timestamps and previews
6. Click a restore button — confirm editor textarea is populated with the full code
7. Press Alt+↑ / Alt+↓ while editor is focused — confirm history navigation updates textarea
8. Reload the page — confirm the editor pre-populates with the last eval from localStorage

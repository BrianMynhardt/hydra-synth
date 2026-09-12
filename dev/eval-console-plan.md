## Overview

Adds an Eval Console panel that captures every `console.error` / `console.warn` plus the
editor's eval failure path into a scrollable in-canvas log, so performers don't have to
keep browser DevTools open during a set. The strip button flashes red when a new error
arrives, providing peripheral awareness without forcing the panel open. Errors are
captured into `window.evalErrors` at boot (same pattern as `window.evalHistory`); the
panel registers itself like the existing History / Audio / Snippets panels and renders
the last ~20 entries newest-first. The editor's existing `catch (err) { console.error(
'[editor]', err) }` automatically funnels through the wrap, so no edit to the eval
catch site is needed.

## Constraints

- One new file: `dev/panels/eval-console.js` (matching the descriptor shape from
  [dev/panels/history.js](dev/panels/history.js))
- One small change to `dev/index.js`: install the console wrap at boot (before
  `initEditor`) and `register` the new panel after the snippets panel
- Wrapping `console.error` / `console.warn` MUST preserve original behavior — the wrap
  forwards every call to the original function so DevTools/users-with-DevTools-open are
  unaffected
- No modification of `dev/performance-ui.js`, `src/lib/audio.js`, or
  `dev/panels/{audio,history,snippets}.js`
- Capacity cap: 100 entries in `window.evalErrors` (drop oldest); render only the last
  20 in the panel to keep DOM cheap
- Flashing the strip button reads through `window.performanceUI._panels` to locate the
  registered entry's `btnEl`; this is a known leaky access into PerformanceUI internals
  and is acceptable for v1 (a follow-up could add a `performanceUI.flashButton(id)`
  helper)
- The wrap is installed exactly once per session (idempotent guard
  `if (window._consoleWrapped) return`); hot reloads should not stack wrappers

## Acceptance Criteria

- `window.evalErrors` exists as an array after page load (length 0 initially)
- Typing `console.error('hello')` in DevTools (or evaluating it in the editor) pushes
  one entry `{ ts: Date, level: 'error', message: 'hello', args: [...] }` into
  `window.evalErrors` AND still prints to DevTools console
- Typing a syntax error in the editor and Ctrl+Enter creates exactly one entry in
  `window.evalErrors` with `level: 'error'` and message starting with `[editor]`
- The Eval Console panel (Alt+E) renders a scrollable list of the last 20 entries,
  newest first, each row showing timestamp + level badge + message preview
- A row's full text is visible on hover (browser title tooltip) for entries that
  overflow the visible width
- When a new error arrives while the panel is closed, the strip button labeled
  "Eval Console" flashes red (background red, fade-out over ~600ms) and then returns
  to its inactive cyan-on-dim color
- Opening the panel after a flash clears the unread indicator (button returns to normal
  active style)
- `console.warn` entries appear with a yellow badge; `console.error` entries appear
  with a red badge
- Closing the panel and triggering another error re-arms the flash
- No regression: existing panels (History, Audio, Snippets) and editor Ctrl+Enter /
  Alt+0-9 / Escape behavior are unchanged

## Touch points

- [dev/index.js:10-19](dev/index.js#L10-L19) — `init()` top; add the boot-time console
  wrap before `initEditor` is called, and add `const evalConsolePanel = require(
  './panels/eval-console')` alongside the other panel requires
- [dev/index.js:75-78](dev/index.js#L75-L78) — after `window.performanceUI.register(
  snippetsPanel)`, add `window.performanceUI.register(evalConsolePanel)`
- new file: `dev/panels/eval-console.js`
- [dev/panels/history.js:1-63](dev/panels/history.js#L1-L63) — used as the style
  reference for the new panel (already similar use case)

No edits to `src/`, `dev/performance-ui.js`, or `dev/panels/{audio,history,snippets}.js`.

## Design

**Capture path.** At boot, wrap `console.error` and `console.warn` once. The wrapper
pushes a normalized entry to `window.evalErrors`, then invokes the original method with
the same arguments and `this` so DevTools output is unchanged. The buffer is capped at
100 entries (slice from index `-100` after each push). Editor failures already call
`console.error('[editor]', err)` (line 166), so they flow through the same path
automatically.

**Render path.** The panel's `update(el)` compares `window.evalErrors.length` to a
cached `el._lastLength`; if unchanged, returns early (cheap no-op every tick). If new
entries arrived, re-renders the last 20 newest-first into a `<div>` list, mirroring the
history panel's structure.

**Flash mechanism.** On detected length change, before re-rendering, the panel checks
whether `el._panelOpen` reflects display state. If the panel is closed, it locates its
own strip button by id-matching `window.performanceUI._panels` and applies a transient
red style with a 600ms `setTimeout` to revert. Multiple errors arriving within the
flash window simply re-trigger the timeout — at most one timer outstanding.

**Naming.**
- `window.evalErrors: Array<{ ts: Date, level: 'error'|'warn', message: string, args:
  any[] }>`
- Panel id: `'eval-console'`, key: `'e'`, zone: `'bottom-right'` (or `'top-right'` if
  conflict; bottom keeps top zone for history which is also high-traffic)
- Title: `'Eval Console'`

**Central mechanism (sketch).**

```js
// in dev/index.js init(), before initEditor():
if (!window._consoleWrapped) {
  window._consoleWrapped = true
  window.evalErrors = []
  for (const level of ['error', 'warn']) {
    const orig = console[level].bind(console)
    console[level] = function (...args) {
      try {
        const message = args.map(a => a instanceof Error ? (a.stack || a.message) :
          (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
        window.evalErrors.push({ ts: new Date(), level, message, args })
        if (window.evalErrors.length > 100) window.evalErrors = window.evalErrors.slice(-100)
      } catch (_) { /* never let logging crash the app */ }
      orig(...args)
    }
  }
}

// in dev/panels/eval-console.js update():
const list = window.evalErrors || []
if (list.length === el._lastLength) return
const isNew = list.length > (el._lastLength || 0)
el._lastLength = list.length
if (isNew && el.parentElement && el.parentElement.style.display === 'none') {
  flashButton('eval-console')
}
// re-render last 20 newest-first…
```

## Phase 1: console wrap at boot

1. [dev/index.js:10-19](dev/index.js#L10-L19) — inside `init()`, before
   `initEditor(defaultEditorValue)`, paste the wrap block from the Design sketch
- **Files:** `dev/index.js`
- **Acceptance:** after page load, `window.evalErrors instanceof Array` and
  `console.error('hi')` in DevTools console adds one entry while still printing to
  DevTools

## Phase 2: new panel file scaffold

2. Create `dev/panels/eval-console.js` mirroring the history panel structure: a `<div>`
   list with `overflowY: auto` and `maxHeight: 240px`, exporting the descriptor
   `{ id: 'eval-console', title: 'Eval Console', key: 'e', zone: 'bottom-right', width:
   420, height: 280, init, update }`
3. `init(el)` creates the scrollable list and stores `el._list = list`; appends list
   to `el`
- **Files:** `dev/panels/eval-console.js`
- **Acceptance:** after registration, Alt+E toggles an empty bordered panel labeled
  "Eval Console [Alt+E]"

## Phase 3: render loop

4. `update(el)` reads `window.evalErrors`. Early return when `el._lastLength ===
   window.evalErrors.length`. Otherwise, clear `el._list.innerHTML`, slice the last 20
   entries, `.reverse()` for newest-first, and append a row per entry containing:
   timestamp (`ts.toLocaleTimeString()`), level badge (red `'ERR'` for `'error'`,
   yellow `'WRN'` for `'warn'`), message preview (`.slice(0, 200)`)
5. Each row sets `row.title = entry.message` so hovering shows the full text
- **Files:** `dev/panels/eval-console.js`
- **Acceptance:** open the panel, then in editor type `console.error('test1')` +
  Ctrl+Enter. The panel shows one row with badge `ERR`, timestamp, and `test1`. A
  second `console.error('test2')` adds a row above it.

## Phase 4: flash strip button on new error

6. In `update(el)`, when new entries arrive and the panel is closed (check
   `el.parentElement.style.display === 'none'`), locate the strip button via
   `window.performanceUI._panels.find(p => p.descriptor.id === 'eval-console')?.btnEl`
   and call a `flashButton(btn)` helper
7. `flashButton(btn)` sets `btn.style.background = '#600'; btn.style.color = '#fff'`
   and schedules a `setTimeout(() => { btn.style.background = ''; btn.style.color =
   '' }, 600)`. Cancel any previous timeout via `btn._flashTimer` so rapid errors
   re-arm without stacking
- **Files:** `dev/panels/eval-console.js`
- **Acceptance:** with the panel closed, evaluate `console.error('flash test')` — the
  "Eval Console" button in the top-right strip flashes red briefly. Open the panel
  (Alt+E) and the button returns to its active cyan style

## Phase 5: register the panel

8. [dev/index.js:17-19](dev/index.js#L17-L19) — add
   `const evalConsolePanel = require('./panels/eval-console')` beside the other panel
   requires
9. [dev/index.js:75-78](dev/index.js#L75-L78) — add
   `window.performanceUI.register(evalConsolePanel)` after the snippets registration
- **Files:** `dev/index.js`
- **Acceptance:** after page load, the strip (visible when the editor is open) contains
  a fourth button labeled "Eval Console"; Alt+E toggles the panel

## Phase 6: editor catch sanity (no code change)

10. Verify that the existing `console.error('[editor]', err)` at
    [dev/index.js:166](dev/index.js#L166) flows through the wrap and produces a row
    in the panel
- **Files:** none
- **Acceptance:** type `nonexistentFn()` into the editor + Ctrl+Enter. The Eval Console
  shows a new row with message starting with `[editor]` followed by the ReferenceError
  text. The strip button also flashes if the panel is closed.

## Risks and open questions

- **Risk:** wrapping `console.error` early in `init()` doesn't catch errors fired
  during script load before `init()` runs (e.g. import-time errors). Performers
  encountering this would still need DevTools — out of scope; document in a future
  follow-up if it becomes a problem.
- **Risk:** stringifying argument objects with `JSON.stringify` will throw on circular
  references. The `try/catch (_)` swallows that — the entry will be skipped rather than
  crashing the wrap. Acceptable; user can still see the original log in DevTools.
- **Risk:** reaching into `window.performanceUI._panels` for the strip button is a
  leaky API contract. If `PerformanceUI` is refactored to use a different internal
  shape, this panel breaks silently (flash stops working, errors still recorded).
  Cheap to fix later; not worth a PerformanceUI API change now.
- **Q:** should the panel render its own button red when *open* and an error arrives?
  Default: no — when the panel is open, the new row provides feedback directly. Flash
  is reserved for "you weren't looking at this when it happened."
- **Q:** should `console.log` also be captured? Default: no — it would explode in
  volume during normal usage. Errors and warns are the signal. A future "verbose mode"
  toggle on the panel could opt-in to `log`.
- **Q:** should the panel zone be `'top-right'` instead of `'bottom-right'`? Top is
  currently History, which is bigger; putting Eval Console below leaves vertical
  breathing room. Easy to flip if performers prefer it adjacent to the strip button.

## Verification

1. Run the dev harness; press Escape to reveal the editor and strip
2. Confirm a fourth button "Eval Console" sits in the top-right strip
3. Press Alt+E — empty panel appears; confirm title text "Eval Console [Alt+E]"
4. In the editor, type `nonexistentFn()` and Ctrl+Enter — one red `ERR` row appears in
   the panel; DevTools also shows the same error (wrap forwards)
5. Press Alt+E to close. Type `console.warn('careful')` + Ctrl+Enter — strip button
   flashes red→dim, panel (when reopened) shows a yellow `WRN` row above the previous
   error
6. Open DevTools console and run `console.error('manual')` — same flash + new row
   confirms non-editor errors are captured
7. Trigger 5 errors in quick succession — strip button flashes once and the timeout
   re-arms cleanly (no stale red state after 600ms)
8. Reload the page — `window.evalErrors` is `[]` again; no double-wrap stacking
   (verify `console.error` calls produce exactly one entry, not two or four)
9. Hover a long row in the panel — browser tooltip shows the full message
10. Confirm History, Audio, Snippets panels still work and no panel registration
    ordering issue (Alt+H, Alt+A, Alt+0–9 all behave as before)

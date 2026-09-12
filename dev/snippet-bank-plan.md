## Overview

The Snippet Bank adds 10 named patch slots (0–9) to the `dev/` performance environment. Performers save the current editor content to a slot with Alt+Shift+0-9 and recall it instantly with Alt+0-9. Slots persist across page reloads via `localStorage`. A dedicated panel (toggled with Alt+S) shows all 10 slots with inline Save and Clear buttons. This feature lives entirely in `dev/` — no changes to `src/`.

## Constraints

- All changes are confined to `dev/` — do not touch any file under `src/`
- Follow the panel descriptor pattern: `{ id, title, key, zone, width, height, init, update }` as used in `dev/panels/history.js`
- Panel toggle key must be a letter registered via `_routeKey` in `PerformanceUI` — digit keys (0-9) must NOT be registered as panel keys
- Recall loads snippet into editor but does NOT auto-eval — performer triggers eval manually with Ctrl+Enter
- Use `localStorage` keys `hydra-snippet-0` through `hydra-snippet-9` for persistence
- Do not disturb active harness findings F-001 through F-008 (all in `src/`)
- Out of scope: auto-eval on recall, slot naming/labels, drag-to-reorder

## Acceptance Criteria

- Alt+Shift+0-9 saves the current editor content to the corresponding slot and persists it in `localStorage`
- Alt+0-9 loads a filled slot into the editor (shows editor if hidden); does nothing for an empty slot
- The Snippets panel opens/closes with Alt+S
- The panel shows all 10 slots: slot index, 30-char code preview (dimmed placeholder for empty slots), Save button, Clear button
- Slots survive a page reload
- No conflict with existing Alt+H (history panel) or Alt+A (audio panel) key bindings

## Phase 1: State Initialisation

1. `dev/index.js` `init()` — before `initEditor()`, add: `window.snippetBank = Array.from({length: 10}, (_, i) => localStorage.getItem('hydra-snippet-' + i))`
2. `dev/index.js` `init()` — add `require('./panels/snippets')` import at the top of the file alongside the existing panel requires
3. `dev/index.js` `init()` — add `window.performanceUI.register(snippetsPanel)` after the existing `register(historyPanel)` call

## Phase 2: Panel UI

4. `dev/panels/snippets.js` (new file) — export descriptor object: `{ id: 'snippets', title: 'Snippets', key: 'S', zone: 'top-right', width: 300, height: 240, init, update }`
5. `dev/panels/snippets.js` `init(el)` — store `el._rows = []`; build 10 row `<div>` elements each containing: a slot-number `<span>`, a preview `<span>` (30-char truncation), a Save `<button>`, and a Clear `<button>`; append rows to `el`
6. `dev/panels/snippets.js` `init(el)` — wire each Save button's click handler: `window.snippetBank[i] = window._devEditor ? window._devEditor.value : null; localStorage.setItem('hydra-snippet-' + i, window.snippetBank[i]); el._sig = null` (null forces re-render on next tick)
7. `dev/panels/snippets.js` `init(el)` — wire each Clear button's click handler: `window.snippetBank[i] = null; localStorage.removeItem('hydra-snippet-' + i); el._sig = null`
8. `dev/panels/snippets.js` `update(el)` — compute `sig = window.snippetBank.map(s => s ? s.slice(0, 8) : '').join('|')`; if `sig === el._sig` return early; otherwise update each row's preview span text and Save/Clear button disabled state; set `el._sig = sig`

## Phase 3: Key Bindings

9. `dev/index.js` `initEditor()` — in the editor's `keydown` listener (around line 132), add a new branch before the format handler: `if (e.altKey && e.shiftKey && /^[0-9]$/.test(e.key)) { e.preventDefault(); const i = parseInt(e.key, 10); window.snippetBank[i] = editor.value; localStorage.setItem('hydra-snippet-' + i, editor.value); return }`
10. `dev/index.js` `initEditor()` — in the document-level `keydown` listener (around line 113), extend the handler: `if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && /^[0-9]$/.test(e.key)) { const i = parseInt(e.key, 10); const slot = window.snippetBank && window.snippetBank[i]; if (slot != null) { e.preventDefault(); if (window._devEditor) window._devEditor.value = slot; editor.style.display = 'block'; editor.focus(); window.performanceUI && window.performanceUI.setVisible(true) } }`

## Risks and Open Questions

- Alt+0-9 has OS-level key assignments on some platforms (Windows: Alt+0 inserts a degree symbol in some apps); `e.preventDefault()` should suppress browser default but needs manual testing in the target browser
- Event ordering: the document listener registered in `initEditor()` fires before PerformanceUI's `_routeKey` (added later); digits fall through `_routeKey` cleanly because no panel uses a digit key — verify this holds as more panels are added
- If the editor reference (`editor` variable) is not in scope inside the document listener, use `window._devEditor` instead (already assigned at line 110)

## Verification

1. Open the dev page and press Escape to show the editor
2. Type any patch code in the editor
3. Press Alt+Shift+1 — confirm the slot is saved (check Snippets panel with Alt+S)
4. Clear the editor (select all, delete)
5. Press Alt+1 — confirm the editor is populated with the saved patch
6. Reload the page; press Alt+1 again — confirm the slot survived the reload
7. Press Alt+S to open the Snippets panel; click Save on slot 3 with content in editor — confirm slot 3 fills
8. Click Clear on slot 3 — confirm slot 3 shows empty placeholder

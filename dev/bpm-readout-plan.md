# BPM Readout in the Audio Panel — Plan

## Overview
Display a live BPM value (and optionally a confidence reading) in the title bar of the Audio Bins dev panel, next to the existing `brt:` brightness readout. The panel's `update()` hook reads `window.a.bpm` each frame and writes it into a small title-bar `<span>`. This reuses the panel's existing render loop and title-bar layout with no new infrastructure, following the precedent set by commit 9f7d920 when the brightness readout was added to the same panel.

## Constraints
- Edit only `dev/panels/audio.js`. `dev/` is a dev-only directory, freely editable per AGENTS.md.
- Mirror the brightness-readout pattern exactly: a `<span>` created in `init()`, stored on `el`, inserted via `titleBar.insertBefore(span, titleBar.lastChild)`, and updated in `update()` with a `typeof === 'number'` guard.
- `window.a` is the `Audio` instance, so the panel must read `window.a.bpm` (not the synth's `bpm`). This requires idea #1 to add `this.bpm` to the `Audio` class in `src/lib/audio.js`.
- Match existing code style: 11px monospace span, `#0ff` color, `margin-right:6px`. No trailing semicolons consistent with the file.
- Out of scope: BPM detection logic itself (idea #1), any change to `src/`, any build step, confidence rendering if idea #1 does not expose a confidence field.
- No open harness findings touch `dev/panels/audio.js`; do not disturb the auto-tune, brightness, onset, or chroma logic in this file.

## Acceptance Criteria
- A `bpm:` span appears in the Audio Bins title bar, ordered after the `brt:` span (`auto-tune | brt | bpm`).
- Before BPM data is available, the span reads `bpm: —` and does not error.
- When `window.a.bpm` is a number, the span shows the rounded integer BPM, updating live each frame.
- If `window.a.bpmConfidence` is a number, it is appended as a parenthesized 2-decimal value, e.g. `bpm: 120 (.85)`; otherwise BPM is shown alone.
- No regression to the existing brightness, auto-tune, onset, or chroma behavior.

## Phase 1: Title-bar span creation
1. In `dev/panels/audio.js`, in `init()`, immediately after the `el._brtEl` block, add `const bpmEl = document.createElement('span')` and set `bpmEl.style.cssText` to the same value used for `brtEl` (`font:11px monospace;color:#0ff;margin-right:6px`).
2. In `init()`, set `bpmEl.textContent = 'bpm: —'`.
3. In `init()`, insert the span with `if (titleBar && titleBar.lastChild) titleBar.insertBefore(bpmEl, titleBar.lastChild)`, then assign `el._bpmEl = bpmEl`.

## Phase 2: Live update
4. In `dev/panels/audio.js`, in `update()`, after the existing brightness update block, add a guarded block: `if (el._bpmEl && typeof window.a.bpm === 'number')` set `el._bpmEl.textContent = 'bpm: ' + Math.round(window.a.bpm)`.
5. In that same block, conditionally append confidence: if `typeof window.a.bpmConfidence === 'number'`, append ` (` + `window.a.bpmConfidence.toFixed(2)` + `)` to the text.

## Risks and Open Questions
- Hard dependency on idea #1: `window.a.bpm` does not exist yet (`bpm: 30` currently lives on the synth, not the `Audio` instance). The `typeof` guard keeps the panel graceful (`bpm: —`) until idea #1 lands, so this can be merged first but shows no data until then.
- The confidence field name (`bpmConfidence`) and shape (0–1 number) are an assumption pending idea #1's API. Keep rendering conditional so a missing or differently-named field is harmless.
- Title-bar crowding: three spans plus the auto-tune button may be tight on a narrow panel. Low risk at the current default width; revisit only if it visibly wraps.

## Verification
- Run `npm run dev` and open the dev harness with audio enabled.
- Confirm the Audio Bins title bar shows `bpm: —` before idea #1 is present, with no console errors.
- After idea #1 is integrated, play audio with a clear beat and confirm the value tracks a plausible tempo and updates live; if confidence is exposed, confirm the parenthesized value appears.

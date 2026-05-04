# hydra-synth Harness

This directory contains two complementary systems:

1. **Dev harness** — a visual debugging tool for the library (`index.js` + `browser.html`)
2. **Agent harness** — structural validation, documentation, and constraints for AI agents
   and human contributors

---

## Part 1 — Dev Harness (Visual Debugging)

### What it does

**`harness/index.js`** — Node.js entry point

1. Imports `src/glsl/glsl-functions.js` directly in Node and prints every defined GLSL
   transform (name, type, input signatures, defaults) — no browser required.
2. Imports `src/hydra-synth.js` and introspects the `HydraRenderer` class prototype and
   the full `synth.*` API surface.
3. Starts a local HTTP server on port 3333 that serves the project root, so `browser.html`
   can load `../dist/hydra-synth.js` and all source files via relative paths.

**`harness/browser.html`** — Visual browser harness

Opens at `http://localhost:3333`. Cycles through 19 demos covering every major transform
category. Use **prev / next** buttons to jump, or **pause** to hold a demo.

### Prerequisites

The browser harness loads the pre-built UMD bundle. Build it once:

```sh
npm run build
```

### How to run

```sh
npm run harness
# Then open http://localhost:3333
```

### Adding new demos

1. Open `harness/browser.html` and find the `const demos = [...]` array.
2. Add a new entry:

   ```js
   {
     category: 'My Category',
     name: 'myNewDemo()',
     desc: 'What this exercises.',
     exports: ['functionA', 'functionB'],
     run() {
       osc(4).myNewDemo().out(o0);
       render(o0);
     },
   }
   ```

3. Refresh the browser — no rebuild needed for the harness HTML.

---

## Part 2 — Agent Harness

### What it is and why it exists

The agent harness is a set of documents and scripts that give any AI agent (or new human
contributor) the context, constraints, and feedback loops needed to work reliably on this
codebase without breaking its architectural invariants.

Without this harness, an agent would need to re-derive the codebase's conventions from
scratch on every session — and would likely miss important non-obvious constraints (e.g.
the `extendTransforms` concat bug, the browserify/ESM dual-mode setup, the ping-pong FBO
invariant). The harness encodes that knowledge durably.

### Onboarding a new agent

**Start here:** Read [AGENTS.md](../AGENTS.md) at the project root. It contains:
- Project purpose and architecture overview
- Directory map (every file explained)
- Which files an agent may and may not modify
- Naming conventions and coding style rules
- Module format requirements
- Patterns that must be preserved

Then read, in order:
1. `harness/constraints.md` — rules that must never be violated
2. `harness/context/glossary.md` — domain terms
3. `harness/context/adr.md` — why key design decisions were made
4. `harness/findings.md` — known bugs to avoid accidentally "fixing" or stepping on

### Running the structural validator

```sh
npm run harness:validate
```

This runs `harness/validate.js`, which checks three structural rules:

| Rule | What it checks |
|------|---------------|
| 1 | All GLSL transform definitions in `glsl-functions.js` have required fields and valid types |
| 2 | `src/index.js` is correctly configured as the CJS/browserify bridge |
| 3 | Source files in `src/` are within line-count limits |

Exit code 0 = all pass. Exit code 1 = one or more fail.

Run this after any change to `src/` before committing.

### Running the garbage collection prompt

Periodically (after significant PRs or monthly), run the garbage collection agent:

1. Open a new agent session.
2. Paste the full prompt from `harness/gc-prompt.md`.
3. The agent reads source files and produces a Markdown decay report.
4. Save the report to `harness/gc-reports/YYYY-MM-DD.md`.
5. Add any new findings to `harness/findings.md`.

The GC prompt checks for documentation drift, undetected constraint violations, structural
inconsistencies, and stale findings.

### Extending the harness when new patterns emerge

When a pattern solidifies into a convention:

1. **Document the pattern** in `harness/context/adr.md` as a new ADR.
2. **Add a glossary entry** in `harness/context/glossary.md` if a new term is introduced.
3. **Add a constraint** in `harness/constraints.md` if the pattern must never be violated.
4. **Add a validator rule** in `harness/validate.js` if the constraint is machine-checkable.
5. **Update AGENTS.md** if the directory map, file permissions, or coding style changes.

When a finding is fixed:
- Move the entry in `harness/findings.md` from "Active Findings" to "Resolved Findings".
- Reference the PR that fixed it.

---

## File Index

| File | Purpose |
|------|---------|
| `index.js` | Dev harness Node entry: introspection + HTTP server |
| `browser.html` | Dev harness: visual WebGL demo runner (19 demos) |
| `validate.js` | Structural linter (`npm run harness:validate`) |
| `constraints.md` | Architectural rules that must never be violated |
| `findings.md` | Bugs and improvement opportunities (log, do not fix here) |
| `gc-prompt.md` | Agent prompt for periodic entropy/decay detection |
| `README.md` | This file |
| `context/adr.md` | Architecture Decision Records |
| `context/glossary.md` | Domain term glossary |

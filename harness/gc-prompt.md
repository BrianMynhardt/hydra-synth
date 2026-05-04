# Garbage Collection Agent Prompt

Copy the block below verbatim as the prompt for a periodic entropy-detection run.
This prompt is **read-only analysis only** — the agent must produce a report, not make fixes.

---

```
You are a garbage-collection agent for the hydra-synth repository. Your only job is to
detect entropy and decay — documentation drift, constraint violations, structural
inconsistencies, and naming divergence. You must NOT make any code changes. You must NOT
fix any problems. Produce a short Markdown report of findings only.

## Step 1 — Read context files first

Before inspecting source files, read these files in full:
- AGENTS.md
- harness/constraints.md
- harness/context/adr.md
- harness/context/glossary.md
- harness/findings.md

## Step 2 — Check documentation sync

For each of the following, verify that the documentation matches the current source code:

a) AGENTS.md directory map — check that every file listed exists, and that every top-level
   source file has an entry. Report any file that is listed but missing, or present but not
   listed.

b) harness/context/glossary.md — check that the five transform types listed match the
   VALID_TYPES set in harness/validate.js AND the typeLookup object in
   src/generator-factory.js. Report any divergence.

c) harness/context/glossary.md output/source counts — verify that the default numOutputs
   (4, giving o0-o3) and numSources (4, giving s0-s3) in src/hydra-synth.js constructor
   defaults still match the glossary's description.

d) README.md API section — verify that the constructor options documented in README.md
   match the actual constructor parameters in src/hydra-synth.js. Report any option that
   appears in one but not the other, or whose default value differs.

## Step 3 — Check for constraint violations not caught by the linter

a) Module boundary violations (harness/constraints.md rule 8): For each src/ file, check
   its import statements. Flag any import that violates the allowed direction graph (e.g.
   a lib/ file importing from src/ root, or hydra-synth.js being imported by another src/
   file).

b) New Array.prototype extensions (constraint rule 7): Check src/lib/array-utils.js and
   all other src/ files for any Array.prototype assignments beyond the five documented ones
   (fast, smooth, ease, offset, fit).

c) Dead import of glslify (constraint rule 4): Confirm src/glsl/renderpass-functions.js
   still imports glslify (a missing dependency). Note whether it is imported anywhere.

d) window direct-assignment in lib/ files (constraint anti-pattern, constraints.md rule 10):
   Search all src/lib/*.js files for direct window[...] = or window.xxx = assignments
   outside of src/lib/audio.js (which has a known instance documented in findings.md).

## Step 4 — Check for structural inconsistencies

a) CJS vs ESM: Find all src/ files that use module.exports or exports.xxx. Only
   src/index.js and src/shader-generator.js are expected. Report any unexpected additions.

b) Prototype vs class: Find any src/ file that mixes function-constructor prototype style
   with class syntax within the same file. Report it.

c) Import extension discipline: Check all import statements in src/ files. ESM imports
   must include the .js extension. Report any import missing the extension.

d) Stale commented-out code: Flag any import statement that is commented out (// import ...)
   in src/ files. These represent either dead experiments or deferred features and should
   be explicitly noted.

## Step 5 — Check findings.md for resolved items

Read harness/findings.md. For each finding, verify whether it is still present in the code.
Report any finding that appears to have been resolved (i.e. the described problem no longer
exists in the source) so it can be moved to a "Resolved" section.

## Step 6 — Produce the report

Write a Markdown report with the following structure. Each section should be short.
Use bullet points for findings. If a section has no findings, write "No issues found."

---

# GC Report — [DATE]

## Documentation Drift
[Findings from Step 2]

## Constraint Violations
[Findings from Step 3]

## Structural Inconsistencies
[Findings from Step 4]

## Stale Findings
[Findings from Step 5 — items that may be resolved]

## Summary
[One paragraph: overall health assessment, highest-priority items to address]

---
```

---

## How to Run

This prompt is intended for periodic use (e.g. after every significant PR or monthly).

1. Open a new agent session pointed at this repository.
2. Paste the prompt block above as the agent's initial instruction.
3. The agent will read source files, then produce the report.
4. Save the report output to `harness/gc-reports/YYYY-MM-DD.md` for historical reference.
5. If findings include items not already in `harness/findings.md`, add them there.

## What the GC Prompt Does NOT Cover

- Performance or correctness bugs
- GLSL shader logic errors
- WebGL extension compatibility
- Browser compatibility beyond what is documented
- Security vulnerabilities

These require human review or a separate dedicated analysis.

---
name: plan-idea
description: Use when the user wants to plan and analyze how to implement a specific idea for the hydra-synth codebase
---

Analyse a proposed idea in the context of the existing codebase and produce a structured implementation plan.

## Input

The user passes a short idea summary as the argument, e.g.:
  /plan-idea Add a low-pass filter node that integrates with the existing audio pipeline

If no summary is provided, use AskUserQuestion to ask: "What is the idea you want to plan? Describe it in one or two sentences."

## Output

- **Context** — relevant existing files, functions, and patterns the implementation must respect
- **Approach** — the recommended implementation strategy with key decision points called out
- **Step-by-step plan** — ordered, atomic implementation steps with the specific file or function to touch at each step
- **Risks and open questions** — unknowns, constraints, or decisions that need resolution before or during implementation
- **Effort estimate** — rough sizing (small / medium / large) with a one-line rationale

## Instructions

1. Read the idea summary from the skill arguments. If it is absent, use AskUserQuestion to ask for it before continuing.

2. Use Glob to survey the codebase structure. Check `src/**/*.js`, `examples/**/*`, and any `dev/**/*` files to understand the project layout.

3. Use Grep to find existing code directly related to the idea — search for relevant domain keywords (e.g., the feature name, related API methods, or similar node types) across `src/` and `examples/`.

4. Read the 3–5 most relevant files found in steps 2–3. Note the naming conventions, patterns, and integration points the idea must align with.

5. Check `AGENTS.md`, any `ADR` files, and `CLAUDE.md` (if present) for architectural constraints or active findings that affect the idea. Use Read on each file found.

6. Output a **Context** section: list the files and patterns most relevant to this idea, one line each.

7. Output an **Approach** section: describe the recommended strategy in 3–5 sentences. Call out any non-obvious design decision and state a clear recommendation for it.

8. Output a **Step-by-step plan**: a numbered list of atomic implementation steps. Each step must name the file to edit or create, the function or section to target, and what to do. Do not group steps — one action per line.

9. Output a **Risks and open questions** section: list anything that could block or complicate the implementation. Flag any overlap with open harness findings.

10. Output an **Effort estimate**: size the work as small (< 2 hrs), medium (half-day), or large (multi-day), with a one-sentence justification.

## Constraints

- Do not implement anything — this skill produces a plan only, no file edits
- Do not invent APIs or patterns not observed in the codebase
- Do not skip the risks section even if no risks are apparent — state "No significant risks identified" explicitly
- Keep the total output under 600 words; use bullets and short sentences over prose

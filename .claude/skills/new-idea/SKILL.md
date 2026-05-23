---
name: new-idea
description: Use when the user wants to brainstorm new features, improvements, or experiments for the hydra-synth codebase
---

Explore the codebase and generate concrete, well-grounded ideas based on a topic or area the user describes.

## Input

The user provides one of:
- A topic or area of interest (e.g., "audio reactivity", "new oscillator types", "performance")
- A rough idea to expand on (e.g., "I want to add more visual feedback")
- Nothing — in which case ask for a focus area

## Output

- A structured brainstorm: 3–6 concrete ideas, each with a one-line summary, rationale, and rough implementation sketch
- Relevant existing files or patterns to build on
- A recommendation for which idea to pursue first, with reasoning

## Instructions

1. If the user provided no description or topic, use AskUserQuestion to ask: "What area of hydra-synth would you like to brainstorm ideas for? (e.g., audio, visuals, API, performance, tooling)"

2. Use Glob to survey relevant files — try `src/**/*.js` for core logic, `examples/**/*` for usage patterns, and `dev/**/*` for in-progress experiments.

3. Use Grep to find existing implementations, TODOs, or patterns related to the topic. Search for relevant keywords in `src/` and any test or example files.

4. Read 2–4 of the most relevant files to understand current patterns, naming conventions, and design constraints.

5. Generate 3–6 concrete ideas grounded in what you found. For each idea output:
   - **Idea name** — short and descriptive
   - **What it does** — one sentence
   - **Why it fits** — how it extends or complements existing patterns
   - **Where to start** — the specific file, function, or pattern to build from

6. Close with a **Recommendation** block: pick the single most promising idea and explain why in 2–3 sentences, citing specific code or patterns you observed.

7. End with this prompt to the user: "When you've decided on an idea, say **'summarize'** and I'll produce a `/plan-idea`-ready summary for the chosen idea."

8. If the user responds with "summarize" (or asks for a summary), output a single concise paragraph — 3–5 sentences — that captures: the idea name, what it does, why it fits the codebase, and the suggested starting point. Write it so it can be passed directly as the argument to `/plan-idea` with no editing required.

## Constraints

- Do not invent APIs or functions that do not exist — only suggest ideas grounded in what you found in the code
- Do not implement anything — this skill produces ideas only, no file edits
- Keep the total response under 500 words; prefer tight actionable bullets over prose
- Do not suggest ideas that duplicate open findings in the harness log without noting the overlap

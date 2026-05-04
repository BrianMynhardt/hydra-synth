# Harness Engineering Principles

> "Humans steer. Agents execute." — OpenAI, February 2026

Harness engineering is the discipline of designing the **environments, constraints,
and feedback loops** that make AI coding agents reliable across multiple sessions
and context windows. It is distinct from prompt engineering (single-turn
instructions) and context engineering (token curation within one window).

The foundational rule: **anything an agent cannot discover from the repository
effectively does not exist.** The repository is the single source of truth.

---

## The Three Layers

### 1. Constraint Harnesses (Feedforward)
Reduce the agent's solution space *before* generation begins.
- Rules files scoped to directory trees, injected automatically at session start
- Lint rules set to `"error"` — hard gates, not advisory warnings
- Typed interfaces and stable abstractions the agent can fully internalise
- Prefer "boring" dependencies: composable, API-stable, well-represented in
  training data

### 2. Feedback Loops (Corrective)
Return structured error signals that allow autonomous self-correction.
- Lint messages must be self-remediating: tell the agent *how* to fix, not
  just *that* it failed
- Disable inline suppression rules (`eslint-disable`) — agents must fix
  violations, not silence them
- Structured progress files let new sessions understand prior state, like a
  shift handoff between engineers who've never met

### 3. Quality Gates (Enforcement)
Prevent non-compliant code from merging.
- CI failures block merges; no exceptions for AI-generated code
- Staleness gates catch dependency drift
- Background agents scan for deviations and open targeted cleanup PRs on a
  regular cadence

---

## The Five Taste Invariants
*(A small set of non-negotiable engineering standards encoded as hard rules)*

1. **Legibility over cleverness** — code must be discoverable and reasoned
   about by a future agent with no prior session memory
2. **Shared utilities over hand-rolled helpers** — keep invariants centralised;
   avoid duplicating logic that creates drift
3. **Validated boundaries over YOLO data access** — validate at edges or rely
   on typed SDKs; never assume upstream shape
4. **Depth-first decomposition** — break large goals into small, testable
   building blocks; unlock complexity incrementally
5. **Progressive disclosure** — entry-point docs (AGENTS.md) point to deeper
   sources of truth; never dump everything in one file

---

## Documentation Standards for Agent-Readable Repos

Documentation written *for* agents must follow these conventions:
- **AGENTS.md at every meaningful directory boundary** pointing to design
  docs, architecture maps, and quality grades
- Each module exposes: *purpose*, *public API surface*, *invariants it
  maintains*, and *known limitations*
- Architecture diagrams describe data flow and dependency direction, not
  just component names
- All design decisions record the *why*, not just the *what*
- Quality grades are explicit and versioned, not implicit in review comments

---

## Anti-Patterns to Avoid

| Anti-pattern | Why it fails |
|---|---|
| Mega instruction files | Agents lose signal in noise; use progressive disclosure |
| Advisory lint warnings | Agents learn to ignore them; use hard errors |
| Knowledge in Slack / Docs / heads | Invisible to agents; belongs in the repo |
| Opaque third-party dependencies | Agents can't model behaviour; prefer reimplementable subsets |
| One AGENTS.md for the whole repo | Context overload; scope to directory trees |
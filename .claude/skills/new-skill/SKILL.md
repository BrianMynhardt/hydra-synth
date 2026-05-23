---
name: new-skill
description: Use when the user wants to create a new Claude Code skill, generate a slash command, or write a SKILL.md file for this repo or their user profile.
---

# New Skill Generator

Creates a production-ready `SKILL.md` for a new Claude Code slash command and writes it to the correct path.

## Input

The user describes what the new skill should do. Optionally: a preferred slash-command name, and whether it should be project-level (this repo only) or user-level (all repos).

## Output

- A `SKILL.md` file written to the resolved path
- A clickable markdown link to the created file
- 2–4 bullets explaining key design decisions

## Instructions

### 1. Gather requirements

If the user's description is too vague to infer a clear name and purpose, use AskUserQuestion to ask:
"What should this skill do, when should it trigger, and what does it produce?"

Otherwise proceed directly — do not ask unnecessarily.

### 2. Determine scope

If the user has not specified project-level vs. user-level, use AskUserQuestion with two options:
- **Project-level** — `.claude/skills/<name>/SKILL.md` in the current repo, available only here
- **User-level** — `C:\Users\User\.claude\skills\<name>\SKILL.md`, available in all repos

Default to project-level when the skill is tightly coupled to this repo's workflow.

### 3. Derive the skill name

Infer a kebab-case slash-command name from the task description. Examples: `fix-tests`, `changelog`, `db-schema`. Prefer short verb-noun pairs. Use the user's preferred name if given.

### 4. Draft the SKILL.md content

The file must follow this structure exactly:

**Frontmatter** (required):
- `name`: kebab-case, matches the directory name and the slash command
- `description`: a trigger condition starting with "Use when the user wants to…", not a definition

**Body sections** (in order):
1. A one-line summary of the skill's purpose
2. `## Input` — concrete description of what the user provides (file paths, selections, descriptions, flags, or nothing)
3. `## Output` — list of artifacts created, commands run, or responses given
4. `## Instructions` — numbered steps in imperative voice, one atomic action per step
5. `## Constraints` (optional) — things the skill must never do

**Quality rules to enforce:**
- Instructions must be self-contained — the LLM has no prior conversation context when the skill loads
- Name tools explicitly in steps: Read, Edit, Write, Glob, Grep, Bash, AskUserQuestion
- Use precise verbs: "read", "write", "ask", "run", "output" — not "handle", "process", "deal with"
- No passive voice in instructions
- Keep the file under 150 lines; if longer, split into smaller composable skills
- Do not use nested fenced code blocks inside the SKILL.md — use indented text or prose to show templates

### 5. Write the file

Resolve the full target path from the scope and name determined in steps 2–3:
- Project-level: `<repo-root>/.claude/skills/<name>/SKILL.md`
- User-level: `C:\Users\User\.claude\skills\<name>\SKILL.md`

Use the Write tool to create the file. The Write tool creates intermediate directories automatically.

### 6. Report back

Output:
- A markdown link to the created file using a relative path (project-level) or absolute path (user-level)
- 2–4 bullets explaining the key design decisions made (name choice, scope, trigger condition wording, structural choices)

## Constraints

- Never write nested fenced code blocks inside a SKILL.md — they break rendering
- Never place skill content directly in MEMORY.md or other memory files
- Do not create a README or documentation file alongside the SKILL.md unless the user asks
- Do not skip step 6 — the design decision bullets are required output

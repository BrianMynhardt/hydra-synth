---
name: implement-plan
description: Use when the user wants to implement a thorough feature plan — ingesting a plan document and executing it phase by phase with progress tracking.
---

Turn a structured feature plan into working code, executing each phase and task in order with full progress tracking.

## Input

One of the following (checked in this order):
1. A file path passed as the argument (e.g. `/implement-plan dev/my-feature-plan.md`)
2. A plan file already open or referenced in the current conversation
3. If neither: ask the user for the plan file path using AskUserQuestion

The plan file is expected to contain phases and tasks. It may use any structure — numbered sections, headings, bullet lists, or prose — as long as it describes discrete units of work.

## Output

- All code changes required to implement the plan
- Progress tracked in TodoWrite throughout execution
- A brief end-of-run summary: what was completed, what was skipped, and any blockers encountered

## Instructions

1. Resolve the plan file path: check the skill argument first, then the conversation context. If no path is found, use AskUserQuestion to ask the user: "What is the path to the feature plan file?"

2. Read the plan file in full using the Read tool. If the file does not exist, report the path and stop.

3. Parse the plan by identifying:
   - Phases or sections (top-level groupings of work)
   - Tasks within each phase (discrete implementable steps)
   - Constraints, acceptance criteria, or out-of-scope notes (inform implementation decisions, do not implement them as tasks)

4. Use TodoWrite to create one todo item per task, prefixed with its phase name (e.g. "Phase 1: Add oscillator node type"). Mark all items as pending.

5. For each task in order:
   a. Mark the todo as in_progress using TodoWrite.
   b. Read any files relevant to the task using Glob and Grep before writing.
   c. Implement the task using Edit or Write. Prefer editing existing files over creating new ones.
   d. If the task requires a shell command (build step, test run, codegen), run it with Bash and check the output before continuing.
   e. Mark the todo as completed using TodoWrite.
   f. If a task cannot be implemented (missing dependency, ambiguous spec, destructive action requiring confirmation), mark it as blocked, note the reason, and continue to the next task.

6. After all tasks are processed, run a final check:
   - If the plan specifies a test command, run it with Bash.
   - If the plan specifies manual verification steps, list them explicitly for the user.

7. Output a summary with three sections:
   - **Completed**: list of tasks finished
   - **Skipped / Blocked**: list of tasks not completed with one-line reasons
   - **Next steps**: any follow-up actions the user needs to take

## Constraints

- Never implement tasks marked "out of scope" or "future work" in the plan.
- Never delete files or run destructive shell commands (rm -rf, git reset --hard, DROP TABLE) without first asking the user to confirm.
- Do not silently skip tasks — every task gets a completed or blocked status in TodoWrite.
- Do not introduce code outside the scope of the current task being processed.
- If the plan is ambiguous about a task, implement the minimal interpretation and note the ambiguity in the summary.

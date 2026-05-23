---
name: smart-commit
description: Use when the user wants to review uncommitted git changes and commit them in clean, logical groups — one commit per feature, fix, or concern.
---

Review uncommitted changes and create one clean git commit per logical grouping, without combining unrelated changes into a single commit.

## Input

No arguments required. Operates on the current working directory's git state. Optionally accepts a hint like "focus on the audio changes first" or "skip the dev/ folder" to guide grouping.

## Output

- One or more git commits, each covering a single logical concern
- A brief summary to the user: how many commits were made and what each one contained

## Instructions

1. Run `git status` and `git diff HEAD` (plus `git diff --cached` if anything is staged) to get the full picture of what has changed. Also run `git diff --stat HEAD` for a compact file-level overview.

2. Read the content of changed files as needed to understand *what* changed in each file — not just the filename.

3. Identify logical groupings. Each group should answer: "what single thing does this set of changes do?" Common groupings:
   - A new feature and its directly related files (source + test + config)
   - A bug fix touching one or more files for the same root cause
   - A refactor or rename that spans multiple files but has a single intent
   - A docs or config-only change
   - Dependency updates

4. If any grouping is ambiguous or you could argue it either way, use AskUserQuestion to present the options. Keep it to one question with 2–4 concrete choices. Do not ask for groupings that are clearly separable.

5. For each group, in the order that makes logical sense (features before docs, fixes before refactors, etc.):
   a. Run `git add <specific files or hunks>` to stage only the files for this group. Use `git add -p <file>` via Bash if a single file contains changes for multiple groups.
   b. Verify staging is correct with `git diff --cached --stat`.
   c. Write a commit message following Conventional Commits format: `type(scope): short imperative summary`. Types: feat, fix, refactor, chore, docs, test, style. Keep the subject under 72 characters.
   d. Run `git commit -m "<message>"` using a heredoc so special characters are safe. Do not add a Co-Authored-By trailer or any Claude signature to the message.
   e. Confirm the commit succeeded with `git log --oneline -1`.

6. After all groups are committed, run `git log --oneline -<N>` (where N = number of commits made) and output a summary to the user listing each commit hash and message.

## Constraints

- Never use `git add .` or `git add -A` — always stage by specific file path or hunk to avoid accidentally committing unrelated changes.
- Never amend existing commits — only create new ones.
- Never skip pre-commit hooks (`--no-verify`). If a hook fails, report the failure and stop; do not force past it.
- Do not commit files that look like secrets (.env, credentials, keys). Warn the user and exclude them.
- Do not push — only commit locally unless the user explicitly asks to push.

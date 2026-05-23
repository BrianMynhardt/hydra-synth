---
name: meta-prompt-engineer
description: Convert user descriptions into high-quality, production-ready prompts for large language models. Use when the user wants help writing, designing, or refining a system prompt or user prompt for an LLM.
---

# Prompt Engineer

Convert user descriptions into high-quality, production-ready prompts for large language models.

## Input

User describes what they want an LLM to do (task, context, constraints, desired output).

## Output

A complete, ready-to-use prompt (system prompt, user prompt, or both) inside clearly labeled code blocks, followed by 2–4 bullets explaining key design decisions.

## Instructions

### 1. Understand intent first
Before writing, identify:
- **Task type**: generation, classification, reasoning, extraction, roleplay, summarization, etc.
- **Intended model**: general-purpose, code-focused, specialized domain, etc.
- **Prompt structure needed**: system prompt, user prompt, or both

### 2. Prompt construction rules
- **Open with role/persona** if it aids the task ("You are a...")
- **State the task explicitly** — never assume the model will infer it
- **Define output format precisely**: length, structure, tone, language
- **Add constraints** for what to avoid, not just what to do
- **Include a worked example** when the task is complex or ambiguous
- **Use delimiters** (triple backticks, XML tags, headers) to separate sections cleanly
- **Prefer positive instructions** ("always do X") over purely negative ones ("don't do Y")
- **For multi-step tasks**, instruct the model to reason step by step before producing output

### 3. Output format
- Return the final prompt in a **clearly labeled code block** (copyable directly)
- If both system and user prompts are needed, **label and separate them**
- Follow with a brief note (2–4 bullets) explaining key design decisions
- **CRITICAL: Do NOT escape any characters inside code blocks.** Output markdown exactly as it should appear — never add backslashes before `*`, `_`, `[`, `]`, `#`, `` ` ``, `<`, `>`, `|`, or any other character. The user must be able to copy the code block contents and paste them directly without manual cleanup.

### 4. Iteration
- If the user's request is vague, **ask exactly one clarifying question** before writing
- Do not ask more than one question at a time
- Wait for the user's response before proceeding

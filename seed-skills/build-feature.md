---
name: "Build New Feature"
category: coding
description: "Implement a feature end-to-end with a plan, code, and verification."
when: "Adding new functionality beyond a one-line change."
safety: runs-commands
trigger: auto
---

Purpose: Ship a non-trivial feature that matches the codebase's conventions and is actually verified.

Steps:
1. Restate the goal and acceptance criteria in 1-2 lines.
2. Explore the relevant existing code so the new work matches conventions.
3. Lay out a short plan (files to add/change, in order); surface decisions that need input.
4. Implement in small, logical steps matching the surrounding style; add types/validation where the codebase already uses them.
5. Build/typecheck and run the relevant tests; fix failures before reporting done.
6. Report what changed, how you verified it, and any follow-ups.

How to behave:
- Match existing patterns rather than introducing new ones.
- Never claim it works without running the build/tests.
- Ask one question only if a decision genuinely blocks progress.
Prefer tools: Read, Glob, Grep, Edit, Write, Bash.
Safety level: runs-commands.

A good result:
- Feature meets the stated acceptance criteria
- Build/tests pass
- Style matches the codebase

Avoid these failure modes:
- Skipping verification
- Reinventing patterns
- Sprawling diff that does more than asked

When finished: Summarize the diff and offer to add tests or wire it into the UI/routes.

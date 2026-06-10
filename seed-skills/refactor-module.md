---
name: "Refactor Module"
category: coding
description: "Improve structure without changing behavior, verified by tests."
when: "Code works but is messy, duplicated, or hard to extend."
safety: runs-commands
trigger: auto
---

Purpose: Make code cleaner and more maintainable while proving behavior is unchanged.

Steps:
1. Read the module and its call sites; note the public surface that must stay stable.
2. Identify the specific smells (duplication, long functions, weak abstractions, tangled deps).
3. Make focused, reversible changes one concern at a time, keeping names/patterns consistent.
4. After each meaningful step run the build/tests; if there are no tests for this code, say so and add a couple of characterization tests first.
5. Report what improved and confirm behavior is unchanged.

How to behave:
- Behavior must not change
- One concern per step
- Verify with tests/build, don't assume
Prefer tools: Read, Glob, Grep, Edit, Bash.
Safety level: runs-commands.

A good result:
- Behavior unchanged (tests/build green)
- Real structural improvement
- Consistent with the codebase

Avoid these failure modes:
- Changing behavior
- Big-bang rewrite
- No verification

When finished: Confirm tests green and offer to refactor an adjacent rough spot.

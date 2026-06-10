---
name: "Generate Tests"
category: coding
description: "Write meaningful tests for a unit, including edge and failure cases."
when: "Coverage is missing, or you changed risky code."
safety: runs-commands
trigger: auto
---

Purpose: Add tests that actually exercise behavior, using the project's existing framework.

Steps:
1. Find an existing test and match its framework, structure, and conventions.
2. Cover the happy path, the important edge cases, and at least one failure case.
3. Prefer behavior-level assertions over implementation details.
4. Run the suite and confirm the tests pass and can actually fail.
5. Report what's covered and any gaps you deliberately left.

How to behave:
- A test that can't fail is worthless — verify it bites
- Don't restate the implementation in assertions
- Use the existing test framework, don't introduce a new one
Prefer tools: Read, Glob, Grep, Write, Edit, Bash.
Safety level: runs-commands.

A good result:
- Tests pass and exercise real behavior
- Edge + failure cases included
- Matches project conventions

Avoid these failure modes:
- Tautological tests
- Wrong framework
- Only the happy path

When finished: Report coverage and offer to test adjacent untested code.

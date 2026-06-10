---
name: "Review Pull Request"
category: coding
description: "Review a diff for correctness, security, and clarity — not just style nits."
when: "Before merging a branch or reviewing a teammate's diff."
safety: read-only
trigger: auto
---

Purpose: Catch real bugs and risks in a change before it merges.

Steps:
1. Read the diff (git diff / the changed files) and enough surrounding code to judge it.
2. Check correctness first: logic bugs, edge cases, error handling, race conditions.
3. Then security (injection, authz, secrets), then performance, then clarity.
4. For each finding give file:line, severity, why it matters, and a concrete fix.
5. Critique your own list — drop non-issues, then present findings ordered by severity.

How to behave:
- Lead with correctness and security, not formatting
- Don't pad the list with trivia
- Be specific enough that the author can act without asking
Prefer tools: Bash, Read, Grep, Glob.
Avoid tools: Write, Edit.
Safety level: read-only.

A good result:
- Real bugs/risks surfaced with evidence
- Each finding is actionable
- Severity-ordered, no noise

Avoid these failure modes:
- Only style nits
- Vague 'consider refactoring'
- Missing an obvious correctness bug

When finished: Offer to apply the high-severity fixes.

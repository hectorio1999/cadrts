---
name: "Codebase Audit"
category: coding
description: "Map an unfamiliar project and report architecture, risks, and quick wins."
when: "Starting on a new repo, inheriting a project, or scoping a large change."
safety: read-only
trigger: auto
---

Purpose: Give a fast, evidence-based understanding of a codebase before you commit to changes.

Steps:
1. Identify the stack: read package.json / Cargo.toml / pyproject / go.mod and the lockfile; name frameworks, language versions, and scripts.
2. Map structure: glob the top 2-3 directory levels (skip node_modules/target/dist); identify entry points, the build, and how it runs.
3. Read the 5-10 most important files (entry points, core modules, config) — not everything.
4. Summarize what the project does and its data/control flow.
5. Flag risks with file:line evidence: security, fragile abstractions, dead code, missing tests, doc drift.
6. Critique the draft against the success criteria, then present 3-5 ordered, high-impact, low-risk improvements.

How to behave:
- Work from what the code actually says, never assumptions.
- Cite real files and lines so claims are checkable.
- Prioritize signal over completeness — don't read the whole tree.
Prefer tools: Glob, Grep, Read, Bash.
Avoid tools: Write, Edit.
Safety level: read-only.

A good result:
- Stack and entry points are correctly identified
- Every risk cites a real file:line
- Recommendations are specific and ordered by impact

Avoid these failure modes:
- Inventing structure without reading
- Vague risks with no citation
- Reading the entire tree and running out of context

When finished: Offer to fix the top quick win or go deeper on any flagged risk.

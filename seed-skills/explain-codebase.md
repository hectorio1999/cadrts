---
name: "Explain Codebase"
category: coding
description: "Explain how a project or a specific flow works, grounded in the code."
when: "Onboarding to a repo, or trying to understand how a feature works."
safety: read-only
trigger: auto
---

Purpose: Help someone understand a codebase or a particular path through it, from the actual source.

Steps:
1. Scope the question: the whole architecture, or one specific flow (e.g. 'how does login work')?
2. Trace it through the real code — entry point → the files/functions involved → the data flow — reading, not guessing.
3. Explain it at the right altitude: the big picture first, then the key files, then the important details.
4. Cite the files so the user can follow along, and flag anything surprising or fragile you noticed.

How to behave:
- Trace the actual code, never guess
- Big picture before details
- Cite files so it's followable
Prefer tools: Read, Glob, Grep.
Avoid tools: Write, Edit.
Safety level: read-only.

A good result:
- Accurate to the code
- Right altitude for the question
- Key files cited

Avoid these failure modes:
- Guessing instead of reading
- Too much detail or too vague
- No file references

When finished: Offer to go deeper on any file or trace another flow.

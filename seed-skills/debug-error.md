---
name: "Debug Error"
category: coding
description: "Diagnose a failure from evidence and propose the minimal fix."
when: "Something is throwing, failing, or behaving wrong."
safety: runs-commands
trigger: auto
---

Purpose: Find the real root cause of a bug and fix that, not the symptom.

Steps:
1. Reproduce or locate the failure — read the actual error and the code at those lines.
2. Form a root-cause hypothesis and confirm it by reading code or running a check.
3. Propose the minimal fix and explain why it addresses the cause, not the symptom.
4. Apply it (if edits are allowed), then verify by re-running the failing path.
5. Report root cause · fix · confirmation; if unconfirmed, say so with the evidence.

How to behave:
- Distinguish root cause from symptom explicitly
- Prefer the smallest change that fixes the cause
- Don't guess when you can check
Prefer tools: Read, Grep, Glob, Bash, Edit.
Safety level: runs-commands.

A good result:
- The root cause is identified and supported
- The fix resolves the failing path
- The change is minimal

Avoid these failure modes:
- Patching the symptom
- Large speculative refactors
- Claiming a fix without re-running

When finished: Offer a regression test that would have caught this.

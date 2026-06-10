---
name: "Log Analyzer"
category: it
description: "Read through logs to find the real signal — errors, patterns, and root cause."
when: "Something went wrong and the answer is in the logs."
safety: read-only
trigger: auto
---

Purpose: Turn a wall of logs into what actually happened and what to do about it.

Steps:
1. Establish the symptom and the time window to focus on, so you're not drowning in noise.
2. Find the errors/warnings and the first occurrence — the first failure usually matters more than the cascade after it.
3. Reconstruct the sequence of events around the failure; distinguish the trigger from downstream noise.
4. State the likely root cause and the evidence; if unconfirmed, say so and give the next diagnostic step.
5. Critique: did you anchor on the first failure rather than the loudest later error? Adjust if not.

How to behave:
- Find the FIRST failure, not just the loudest
- Separate trigger from cascade
- Quote the actual log lines as evidence
Prefer tools: Bash, Read, Grep.
Avoid tools: Write, Edit.
Safety level: read-only.

A good result:
- First failure identified
- Event sequence reconstructed
- Cause supported by quoted lines

Avoid these failure modes:
- Anchoring on the loudest downstream error
- No timeline
- Guessing the cause

When finished: Offer the next diagnostic step or a fix if the cause is clear.

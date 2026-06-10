---
name: "Incident Writeup"
category: it
description: "Turn a resolved incident into a blameless postmortem with timeline and follow-ups."
when: "After an outage/bug/security event when you owe a clear writeup."
safety: writes-files
trigger: auto
---

Purpose: Document what happened and what prevents recurrence, from evidence.

Steps:
1. Pin the facts and the four timestamps (started, detected, mitigated, resolved); read logs for exact times, never invent them.
2. Build a chronological timeline: detection → diagnosis → mitigation → resolution, each with a time and action.
3. State root cause separately from symptom; if unconfirmed, say so with the best-supported hypothesis.
4. Quantify impact (who, how long, blast radius) and list owner-assignable preventive follow-ups.
5. Critique that the root cause is supported and the tone is blameless, then revise once.

How to behave:
- Blameless and factual
- Never invent a timestamp
- Root cause separate from symptom
Prefer tools: Read, Bash, Grep, Write.
Avoid tools: Edit.
Safety level: writes-files.

A good result:
- Evidence-based timeline
- Root cause vs symptom separated
- Owner-assignable follow-ups

Avoid these failure modes:
- Invented timestamps
- Blaming a person
- Symptom mistaken for cause

When finished: Surface the single highest-priority follow-up to prevent recurrence.

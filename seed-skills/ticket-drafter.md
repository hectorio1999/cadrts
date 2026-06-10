---
name: "Ticket Drafter"
category: productivity
description: "Turn a vague request into a well-formed ticket with testable acceptance criteria."
when: "Someone sends a fuzzy ask that needs to become trackable work."
safety: read-only
trigger: auto
---

Purpose: Produce a ticket an engineer can start from without asking follow-ups.

Steps:
1. Extract the desired outcome (not the proposed solution), who wants it, and why now.
2. Ask one clarifying question only if a missing detail blocks a useful ticket; otherwise note assumptions.
3. Write an imperative, specific title; a context paragraph; and 2-5 acceptance criteria as verifiable outcomes.
4. Add priority with a one-line justification, affected components, and inferred dependencies/risks.
5. Critique: could a fresh engineer start from this alone, and are the criteria testable? Revise once.

How to behave:
- Capture the outcome, not the requester's solution
- Acceptance criteria must be testable
- State assumptions explicitly
Prefer tools: Read.
Avoid tools: Bash.
Safety level: read-only.

A good result:
- Startable from the ticket alone
- Testable acceptance criteria
- Assumptions/unknowns noted

Avoid these failure modes:
- Copying the vague request
- Untestable criteria
- Encoding the requester's solution as the goal

When finished: Note what's still unknown and offer to split it if it's too big.

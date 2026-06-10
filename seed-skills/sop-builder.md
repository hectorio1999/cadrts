---
name: "SOP / Process Builder"
category: business
description: "Document a repeatable process as a clear standard operating procedure."
when: "A recurring task should be standardized, delegated, or made auditable."
safety: writes-files
trigger: auto
---

Purpose: Turn tribal knowledge into a step-by-step process anyone can follow consistently.

Steps:
1. Clarify the process's goal, who performs it, and how often. If the trigger is unclear, ask one question.
2. Write the steps in exact order — concrete actions a new person could follow without guessing, including the expected result of each.
3. Add roles/ownership, decision points, quality checks, and an escalation/exception path for when something goes wrong.
4. Critique: could someone new execute this correctly the first time? Remove assumed knowledge, then revise once.

How to behave:
- Write for someone who has never done it
- Concrete actions, not aspirations
- Include the failure/escalation path
Prefer tools: Read, Write.
Avoid tools: Bash.
Safety level: writes-files.

A good result:
- A newcomer can follow it without asking
- Roles and checks are explicit
- Failure path included

Avoid these failure modes:
- Assuming prior knowledge
- Vague steps
- No exception handling

When finished: Offer a one-page checklist version for day-to-day use.

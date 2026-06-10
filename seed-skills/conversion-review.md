---
name: "Conversion Rate Review"
category: design
description: "Find where users drop off in a flow and how to reduce the friction."
when: "A funnel or flow is leaking users and you want to fix it."
safety: read-only
trigger: auto
---

Purpose: Improve completion of a key flow (signup, checkout, onboarding) by removing friction.

Steps:
1. Map the flow step by step and the action required at each.
2. At each step, identify friction: unnecessary fields, unclear value, surprise costs, decision overload, trust gaps.
3. Hypothesize where the biggest drop-off is and why; if data exists, ground it in the data.
4. Recommend specific changes and what to A/B test, ordered by expected lift.
5. Critique for guessing the wrong step, then revise once.

How to behave:
- Go step by step — friction hides in specific steps
- Hypotheses tied to the step
- Recommend testable changes, ordered by expected lift
Prefer tools: Read, WebFetch, Glob, Grep.
Avoid tools: Bash.
Safety level: read-only.

A good result:
- Per-step friction identified
- Drop-off hypothesis is specific
- Testable, ranked changes

Avoid these failure modes:
- Generic 'simplify the flow'
- No step-level analysis
- Untestable suggestions

When finished: Offer to spec the top experiment or implement the easiest fix.

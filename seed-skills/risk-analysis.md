---
name: "Risk Analysis"
category: research
description: "Surface what could go wrong, how likely, how bad, and how to mitigate."
when: "Before a launch, migration, big decision, or commitment."
safety: read-only
trigger: auto
---

Purpose: Make risks explicit and prioritized before committing to a plan or change.

Steps:
1. Understand the plan and what success depends on.
2. Enumerate risks across categories: technical, operational, financial, people, external/dependencies, security.
3. For each, estimate likelihood and impact, and give a concrete mitigation plus an early-warning signal.
4. Rank by likelihood × impact and call out the top 3 to address first.
5. Critique for blind spots (the risks you'd rather not think about), then revise once.

How to behave:
- Be concrete — 'the vendor's API rate limit' not 'technical risk'
- Include the uncomfortable risks
- Every risk gets a mitigation
Prefer tools: WebSearch, WebFetch, Read.
Avoid tools: Bash.
Safety level: read-only.

A good result:
- Risks are specific and categorized
- Each has a mitigation and warning sign
- Ranked by likelihood × impact

Avoid these failure modes:
- Generic risks
- No mitigations
- Avoiding the real risks

When finished: Offer to turn the top risks into a mitigation checklist.

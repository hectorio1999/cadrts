---
name: "Research Brief"
category: research
description: "Research a question across sources and synthesize a cited, decision-ready brief."
when: "You need a trustworthy answer on something current or unfamiliar."
safety: read-only
trigger: auto
---

Purpose: Produce a grounded answer to a real question, with sources and honest uncertainty.

Steps:
1. Restate the question and the decision it feeds, so the research stays targeted.
2. Search 4+ independent sources, preferring primary/official ones; note each source's date and flag anything stale.
3. Extract findings and state explicitly where sources agree vs disagree — don't average away real disagreement.
4. Adversarially check load-bearing claims; if a claim rests on one weak source, say so.
5. Synthesize: answer first, evidence, uncertainties, and what you couldn't verify. Critique for bias, revise once.

How to behave:
- Don't answer from memory on time-sensitive facts
- Cite sources inline
- Surface disagreement instead of smoothing it
Prefer tools: WebSearch, WebFetch, Read.
Avoid tools: Bash, Write, Edit.
Safety level: read-only.

A good result:
- Answer is grounded in cited sources
- Agreement/disagreement is explicit
- Unverified claims are marked

Avoid these failure modes:
- Answering from memory
- Single-source confidence
- Hiding contradictions

When finished: Offer the recommended next step or the one question still worth resolving.

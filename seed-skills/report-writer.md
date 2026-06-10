---
name: "Report Writer"
category: documents
description: "Write a structured report grounded in real inputs, with a clear conclusion."
when: "You need a formal writeup of findings, status, or analysis."
safety: writes-files
trigger: auto
---

Purpose: Produce a report that informs a decision, not a data dump.

Steps:
1. Clarify the report's purpose and audience, and lead with an executive summary that states the conclusion.
2. Present findings grounded in the actual inputs (read them); separate fact from interpretation.
3. Analyze what the findings mean and give recommendations tied to the evidence.
4. Critique: is it faithful to the inputs, does the summary match the body, is it skimmable? Revise once, then write it out.

How to behave:
- Conclusion-first summary
- Separate evidence from interpretation
- Every recommendation traces to a finding
Prefer tools: Read, Write, Bash.
Safety level: writes-files.

A good result:
- Summary states the conclusion
- Findings grounded in inputs
- Recommendations trace to evidence

Avoid these failure modes:
- Data dump with no conclusion
- Summary that doesn't match the body
- Unsupported recommendations

When finished: Offer an executive-summary-only version for wider distribution.

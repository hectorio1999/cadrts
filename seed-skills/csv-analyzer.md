---
name: "CSV / Data Analyzer"
category: data
description: "Explore a dataset and surface the findings that actually matter."
when: "You have a data file and a question (or want to know what's interesting)."
safety: read-only
trigger: auto
---

Purpose: Go from a raw CSV/table to real insights, not just descriptive stats.

Steps:
1. Read the file and understand its shape: columns, types, row count, and the grain (what one row represents).
2. Check data quality first — missing values, obvious errors, duplicates — and note caveats that affect conclusions.
3. Answer the user's question if they gave one; otherwise surface the 3-5 most decision-relevant findings.
4. Quantify findings (numbers, not 'a lot') and flag outliers worth a human's attention.
5. Critique for spurious patterns and overreach, then revise once.

How to behave:
- Verify data quality before drawing conclusions
- Quantify everything
- Don't claim causation from correlation
Prefer tools: Read, Bash.
Avoid tools: Write, Edit.
Safety level: read-only.

A good result:
- Findings are quantified and decision-relevant
- Data caveats are stated
- The user's question is answered if asked

Avoid these failure modes:
- Reporting stats with no insight
- Ignoring data-quality issues
- Implying causation

When finished: Offer a chart recommendation or a deeper cut on the most interesting finding.

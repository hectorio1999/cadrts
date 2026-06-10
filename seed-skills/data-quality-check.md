---
name: "Data Quality Checker"
category: data
description: "Audit a dataset for the problems that would corrupt any analysis."
when: "Before analyzing or importing a dataset you didn't create."
safety: read-only
trigger: auto
---

Purpose: Find missing, malformed, duplicate, and inconsistent data before anyone trusts it.

Steps:
1. Read the data and establish the expected schema (types, required fields, valid ranges).
2. Check for: missing values, type mismatches, duplicates, out-of-range/impossible values, and inconsistent formats/categories.
3. Quantify each issue (how many rows, which columns) and rate its severity for downstream use.
4. Suggest a concrete fix for each (drop, impute, normalize, dedupe) without applying it unless asked.
5. Critique for issues you might have missed in skewed columns, then revise once.

How to behave:
- Quantify every issue
- Rate severity for actual use
- Suggest fixes but don't mutate the data unasked
Prefer tools: Read, Bash.
Avoid tools: Write, Edit.
Safety level: read-only.

A good result:
- Real issues found and quantified
- Severity rated for use
- Fixes suggested, data untouched

Avoid these failure modes:
- Vague 'some missing values'
- Missing impossible values
- Silently altering the data

When finished: Offer to apply the suggested cleanups (with confirmation) and re-check.

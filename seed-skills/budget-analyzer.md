---
name: "Budget Analyzer"
category: data
description: "Make sense of a budget or expense data and find what to act on."
when: "Reviewing a budget, expenses, or spend data."
safety: read-only
trigger: auto
---

Purpose: Turn budget/spend numbers into a clear picture and concrete savings/risks.

Steps:
1. Read the data and confirm the period, categories, and whether figures are actuals vs planned.
2. Summarize where the money actually goes (top categories, % of total) — concrete numbers.
3. Identify trends (rising/falling) and anomalies (spikes, unexpected line items) worth attention.
4. Surface the highest-leverage savings opportunities or financial risks, with the number attached.
5. Critique for misread categories/periods, then revise once.

How to behave:
- Always attach the number
- Separate actuals from plan
- Flag anomalies, don't smooth them
Prefer tools: Read, Bash.
Avoid tools: Write, Edit.
Safety level: read-only.

A good result:
- Clear picture of where money goes
- Anomalies and trends surfaced with numbers
- Actionable savings/risks

Avoid these failure modes:
- Restating totals with no insight
- Confusing planned with actual
- Generic 'cut costs' advice

When finished: Offer a category deep-dive or a simple month-over-month view.

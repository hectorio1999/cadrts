---
name: "Spreadsheet Formula Builder"
category: data
description: "Write and explain the exact spreadsheet formula you need."
when: "You're stuck building a spreadsheet formula."
safety: read-only
trigger: auto
---

Purpose: Produce a correct, copy-pasteable formula and explain how it works.

Steps:
1. Confirm the goal, the relevant cell ranges, and the target tool (Excel / Google Sheets) — they differ. Ask one question only if the layout is ambiguous.
2. Write the exact formula using the right functions; prefer robust, readable forms over clever one-liners.
3. Explain what each part does so the user can adapt it.
4. Call out edge cases (blanks, errors, division-by-zero, text vs number) and how the formula handles them.
5. Critique by mentally running it on a tricky row, then revise once.

How to behave:
- Match the exact tool's syntax
- Handle blanks/errors gracefully
- Explain so the user can modify it
Avoid tools: Bash.
Safety level: read-only.

A good result:
- Formula is correct for the stated tool
- Edge cases handled or noted
- Clear enough to adapt

Avoid these failure modes:
- Wrong tool's syntax
- Breaks on blanks/errors
- Cryptic with no explanation

When finished: Offer a variant (array/spill, or error-wrapped) if relevant.

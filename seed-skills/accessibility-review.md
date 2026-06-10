---
name: "Accessibility Review"
category: design
description: "Find accessibility barriers and give specific, standards-based fixes."
when: "Before shipping UI, or auditing an existing interface for a11y."
safety: read-only
trigger: auto
---

Purpose: Make an interface usable for people with disabilities, against real WCAG criteria.

Steps:
1. Review the markup/code for semantic structure, alt text, form labels, and ARIA usage.
2. Check keyboard operability (focus order, visible focus, no traps) and color contrast against WCAG AA.
3. Check for screen-reader pitfalls: missing labels, non-semantic clickable divs, unannounced state changes.
4. Report each issue with the WCAG criterion, severity, and the specific code fix.
5. Critique for issues only visible in interaction (focus, live regions), then revise once.

How to behave:
- Cite the specific barrier, not 'improve a11y'
- Give the exact code fix
- Cover keyboard + screen reader, not just contrast
Prefer tools: Read, Glob, Grep.
Avoid tools: Bash.
Safety level: read-only.

A good result:
- Real barriers found across types
- Each has a concrete fix
- Severity rated

Avoid these failure modes:
- Only checking contrast
- Vague advice
- Missing keyboard/focus issues

When finished: Offer to apply the high-severity fixes.

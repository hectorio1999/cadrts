---
name: "Quiz Generator"
category: learning
description: "Generate a quiz that tests real understanding of a topic."
when: "Studying, teaching, or assessing knowledge of a topic."
safety: read-only
trigger: auto
---

Purpose: Create questions that check comprehension, not just recall, with an answer key.

Steps:
1. Identify the key concepts that matter for this topic (from the source if given).
2. Write questions that test understanding and application, not just definitions; mix recall, application, and one harder reasoning question.
3. Provide an answer key with a one-line explanation for each, including why wrong options are wrong (for multiple choice).
4. Critique: do the questions actually discriminate understanding, are any ambiguous or trick questions? Fix and revise once.

How to behave:
- Test understanding, not just recall
- No ambiguous or trick questions
- Explain answers, not just mark them
Prefer tools: Read, WebSearch.
Avoid tools: Bash.
Safety level: read-only.

A good result:
- Questions test understanding
- Answer key with explanations
- Appropriate difficulty

Avoid these failure modes:
- Pure definition recall
- Ambiguous questions
- Answers with no explanation

When finished: Offer to grade the user's answers or make a harder set.

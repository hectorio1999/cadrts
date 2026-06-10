---
name: "Optimize Performance"
category: coding
description: "Find and fix the actual bottleneck, measured — not guessed."
when: "Something is slow and you need it faster."
safety: runs-commands
trigger: auto
---

Purpose: Make code measurably faster by targeting the real hot path.

Steps:
1. Establish how slowness is measured (a timing, a profile, a benchmark). If none exists, add a quick measurement first.
2. Locate the actual hot path with evidence — don't optimize on intuition.
3. Propose the highest-leverage change (algorithm, query, caching, N+1, allocation).
4. Apply it, then re-measure to prove it helped.
5. Report the bottleneck, the change, and the before/after numbers.

How to behave:
- Measure before and after — no unverified speedups
- Target the dominant cost, not micro-optimizations
- Don't sacrifice correctness for speed
Prefer tools: Read, Grep, Glob, Bash, Edit.
Safety level: runs-commands.

A good result:
- Bottleneck identified with evidence
- Measured improvement
- Correctness preserved

Avoid these failure modes:
- Optimizing the wrong thing
- No measurement
- Premature micro-optimization

When finished: Report the numbers and flag the next bottleneck if one remains.

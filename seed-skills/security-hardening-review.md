---
name: "Security Hardening Review"
category: it
description: "Review a system/service for exposure and give specific hardening steps."
when: "Before exposing a service, or auditing one that's already exposed."
safety: read-only
trigger: auto
---

Purpose: Reduce attack surface with concrete, prioritized hardening — read-only.

Steps:
1. Map the attack surface: what's exposed, to whom, and how it authenticates.
2. Check for: default/weak creds, unnecessary exposed ports, missing auth/TLS, over-broad permissions, unpatched versions, secrets at rest.
3. For each finding give severity, why it's exploitable, and the specific hardening step.
4. Prioritize by exploitability × impact and call out the single most urgent fix.
5. Critique for the 'works but wide open' issues, then revise once. Do not make changes — recommend them.

How to behave:
- Read-only — recommend, don't change
- Concrete steps, not 'harden the server'
- Prioritize by real exploitability
Prefer tools: Bash, Read, Grep.
Avoid tools: Write, Edit.
Safety level: read-only.

A good result:
- Real exposure found
- Each finding is actionable
- Prioritized by exploitability

Avoid these failure modes:
- Generic checklist with no specifics
- Making changes during an audit
- Missing the exposed admin/default creds

When finished: Offer to apply the top hardening step (with confirmation).

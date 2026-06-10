---
name: "Homelab Audit"
category: it
description: "Inventory a homelab/server setup and flag config, security, and reliability gaps."
when: "Reviewing a self-hosted setup, or before adding more to it."
safety: read-only
trigger: auto
---

Purpose: Understand what's running and surface the risks before they bite.

Steps:
1. Inventory what's running: services, containers, ports, and how they're exposed (read configs, ps, listening ports — don't change anything).
2. Check security posture: exposed ports, default creds risk, missing auth, outdated images, secrets in plaintext.
3. Check reliability: backups (exist? tested?), single points of failure, restart policies, disk headroom.
4. Prioritize fixes by risk (likelihood × blast radius) and flag the top 3.
5. Critique for the boring-but-deadly gaps (no tested backups, exposed admin UI), then revise once.

How to behave:
- Read-only — never change config during an audit
- Prioritize by real blast radius
- Untested backups = no backups
Prefer tools: Bash, Read, Grep.
Avoid tools: Write, Edit.
Safety level: read-only.

A good result:
- Accurate inventory
- Security + reliability gaps found
- Prioritized fixes

Avoid these failure modes:
- Changing config mid-audit
- Missing the exposed admin panel
- Ignoring backups

When finished: Offer to fix the top risk (with confirmation) or build a hardening checklist.

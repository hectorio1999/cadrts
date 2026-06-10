---
name: "Backup Plan Builder"
category: it
description: "Design a backup and recovery plan that would actually survive a disaster."
when: "Setting up or reviewing backups for important data/systems."
safety: writes-files
trigger: auto
---

Purpose: Build a 3-2-1-style plan with tested recovery — not just 'we copy files sometimes'.

Steps:
1. Identify what truly needs backing up and the tolerance: how much data loss is acceptable (RPO) and how fast you must be back (RTO).
2. Design coverage: what to back up, frequency, at least one offsite/offline copy, and retention.
3. Critically: define how recovery is TESTED — an untested backup is a hope, not a plan.
4. Flag the current gaps versus this plan and the highest-priority one to fix.
5. Critique for the single-copy and never-tested traps, then revise once.

How to behave:
- Untested backups don't count — include a restore test
- Insist on an offsite/offline copy
- Tie frequency to the stated RPO
Prefer tools: Read, Bash, Write.
Avoid tools: Edit.
Safety level: writes-files.

A good result:
- Coverage meets the stated RPO/RTO
- Includes offsite + a restore test
- Gaps prioritized

Avoid these failure modes:
- Single copy, same machine
- No restore test
- Frequency mismatched to RPO

When finished: Offer to script the backup or a restore-test procedure.

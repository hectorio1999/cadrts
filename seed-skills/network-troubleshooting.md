---
name: "Network Troubleshooting"
category: it
description: "Diagnose a connectivity or networking problem methodically, layer by layer."
when: "Something can't connect, resolve, or route and you need to find out why."
safety: runs-commands
trigger: auto
---

Purpose: Find where a network path actually breaks instead of guessing.

Steps:
1. Restate the exact symptom: what source can't reach what destination, and how it fails (timeout, refused, DNS, slow).
2. Work the layers in order: link/IP (can you ping?), DNS (does it resolve?), routing/firewall (is the port reachable?), then the service itself.
3. At each layer run the check and record the result — narrow to the first layer that fails.
4. Identify the cause at the failing layer and the specific fix.
5. Critique: did you confirm the fix resolves the original symptom? If not, verify before claiming done.

How to behave:
- Go layer by layer — don't skip to a guess
- Record the result at each step
- Confirm the fix against the original symptom
Prefer tools: Bash, Read.
Avoid tools: Write, Edit.
Safety level: runs-commands.

A good result:
- Failing layer pinpointed with evidence
- Cause and fix identified
- Fix verified against the symptom

Avoid these failure modes:
- Guessing without layer checks
- Fixing a layer that wasn't broken
- Not verifying

When finished: Offer to apply the fix (with confirmation) and re-test the path.

---
name: "Docker Compose Review"
category: it
description: "Review a docker-compose file for correctness, security, and reliability."
when: "Before deploying or after writing/changing a compose stack."
safety: read-only
trigger: auto
---

Purpose: Catch the compose mistakes that cause outages, data loss, or exposure.

Steps:
1. Read the compose file and understand the stack and how services relate.
2. Check data: are stateful services on named volumes (not ephemeral)? Will an update wipe data?
3. Check security: exposed ports that should be internal, secrets in the file, running as root, latest tags.
4. Check reliability: restart policies, healthchecks, dependency ordering, resource limits.
5. Report each issue with severity and the exact fix; critique for the data-loss landmines first, revise once.

How to behave:
- Data-loss risks are top priority
- Flag secrets in the file
- Concrete YAML fixes, not 'improve security'
Prefer tools: Read, Grep.
Avoid tools: Write, Edit, Bash.
Safety level: read-only.

A good result:
- Data-persistence risks caught
- Security issues flagged
- Each finding has a concrete fix

Avoid these failure modes:
- Missing an ephemeral-volume data-loss trap
- Ignoring exposed ports/secrets
- Vague advice

When finished: Offer to apply the fixes (with confirmation).

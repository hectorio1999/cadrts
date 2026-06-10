---
name: "Create API Route"
category: coding
description: "Add a backend route with validation, auth, and structured errors."
when: "Adding a server endpoint."
safety: runs-commands
trigger: auto
---

Purpose: Add an endpoint that matches the project's patterns and is safe by default.

Steps:
1. Read a sibling route to match the project's routing, validation, and error-handling patterns.
2. Implement with input validation, auth/permission checks consistent with the codebase, and structured success + error responses.
3. Avoid injection and unbounded inputs; keep secrets out of code.
4. Typecheck/build and report the route signature, validation, and error shape.

How to behave:
- Match the existing route patterns
- Validate inputs and check auth
- Never hardcode secrets
Prefer tools: Read, Glob, Grep, Write, Edit, Bash.
Safety level: runs-commands.

A good result:
- Matches existing patterns
- Validates input + checks auth
- Structured errors, builds clean

Avoid these failure modes:
- No input validation
- Inconsistent error shape
- Missing auth checks

When finished: Offer to add a test or wire it into the client.

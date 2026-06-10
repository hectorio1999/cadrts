---
name: "Create React Component"
category: coding
description: "Scaffold a React component matching the project's conventions and states."
when: "Adding a new frontend component."
safety: runs-commands
trigger: auto
---

Purpose: Build a typed, accessible component that fits the existing codebase.

Steps:
1. Inspect a couple of existing components to match framework, styling approach, file layout, and prop patterns.
2. Build it: typed props, sensible defaults, accessible markup, the project's styling system (don't introduce a new one).
3. Handle empty/loading/error states if it fetches or can be empty.
4. Wire it where asked (or show where), then typecheck/build and report the files added.

How to behave:
- Match existing conventions, don't invent new ones
- Typed props + accessible markup
- Handle non-happy states
Prefer tools: Read, Glob, Grep, Write, Edit, Bash.
Safety level: runs-commands.

A good result:
- Matches project conventions
- Typed + accessible
- Builds clean

Avoid these failure modes:
- New styling system
- Untyped props
- Ignoring loading/empty states

When finished: Offer to add tests or a usage example.

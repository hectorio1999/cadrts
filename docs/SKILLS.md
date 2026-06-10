# Skills

A **skill** is a reusable expert workflow. Instead of a one-off prompt, a skill
encodes how an expert approaches a recurring task — the steps, the way to
behave, what a good result looks like, and the failure modes to avoid. Selecting
a skill in chat makes the agent run that workflow on your next message.

The library is general-purpose: software engineering is one of eleven
categories, alongside writing, research, business, productivity, data, documents,
design, learning, creative, and IT/homelab.

## How it works

1. **Browse** — the `⚡ skill` button by the composer opens the Skill Library:
   browse by category, search, and open any skill to see its full detail and
   example prompts.
2. **Use** — "Use this skill" (or clicking an example prompt) attaches the skill
   to your next message. A chip shows which skill is attached; ✕ removes it.
3. **Run** — when you send, the skill's structured fields are composed into a
   directive that is prepended to the prompt the agent receives. Your visible
   message stays just what you typed; the directive rides along invisibly and
   does **not** affect keyword-skill matching.

A skill never bypasses your safety settings. The composer's permission mode
(Plan / Ask / Auto-edit / Full) and tool toggles still apply. Read-only skills
also tell the agent not to edit files or run mutating commands.

## Two kinds of skills

- **Library skills** (this document) — built-in, curated expert workflows you
  invoke on demand. Defined in `src/lib/skills/*.ts`.
- **Personal skills** — editable markdown in `~/.claude-agent-desktop/skills/`,
  managed in the Skills panel. These auto-inject by keyword/always triggers and
  are the place for your own private, context-specific workflows.

## Architecture

```
src/lib/skills/
  types.ts        Skill schema, categories, validation, asDirective()
  index.ts        Combines categories, validates, dedups, exports SKILLS
  coding.ts       one file per category …
  writing.ts
  research.ts
  business.ts
  productivity.ts
  data.ts
  documents.ts
  design.ts
  learning.ts
  creative.ts
  it.ts
src/components/SkillLibrary.tsx   browse / search / detail / use UI
```

Malformed or duplicate skills are dropped at load time (`validateSkill`),
recorded in `SKILL_LOAD_ERRORS`, and surfaced as a banner in the library — they
never silently disappear or crash the app.

## Included skills by category

**Coding & Engineering** — Codebase Audit · Build New Feature · Debug Error ·
Generate Tests · Review Pull Request · Optimize Performance · Refactor Module ·
Create React Component · Create API Route · Explain Codebase

**Writing & Editing** — Rewrite for Clarity · Professional Email Writer ·
Executive Summary · Tone Adjuster · Documentation Writer

**Research & Analysis** — Research Brief · Compare Options · Risk Analysis ·
Competitor Analysis

**Business & Strategy** — Business Plan Builder · Pricing Strategy ·
Proposal / SOW · SOP / Process Builder · Customer Persona Builder

**Productivity & Planning** — Weekly Planner · Project Plan Builder ·
Task Breakdown · Prioritization Assistant · Meeting → Actions · Ticket Drafter

**Data & Spreadsheets** — CSV / Data Analyzer · Spreadsheet Formula Builder ·
Data Quality Checker · Budget Analyzer

**Presentations & Docs** — Presentation Outline Builder · Slide Deck Critic ·
One-Page Brief · Report Writer

**Design & UX** — UI Critic · Landing Page Critic · Accessibility Review ·
Conversion Rate Review

**Learning & Coaching** — Tutor Mode · Quiz Generator · Study Guide Builder ·
Explain Like I'm New

**Creative & Ideation** — Brainstorm Ideas · Name Generator ·
Content Calendar Builder · Ad Copy Generator

**IT, Homelab & Automation** — Homelab Audit · Network Troubleshooting ·
Docker Compose Review · Log Analyzer · Backup Plan Builder ·
Security Hardening Review · Incident Writeup

See [SKILL_AUTHORING.md](SKILL_AUTHORING.md) to add your own.

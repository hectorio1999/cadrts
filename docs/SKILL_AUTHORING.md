# Authoring Skills

A good skill makes the agent meaningfully better at a specific task than a plain
prompt would. This guide covers the schema, the quality bar, and how to add one.

## The schema

Every skill is a typed object (`src/lib/skills/types.ts`):

| Field | Type | What it's for |
|---|---|---|
| `id` | kebab-case string | Stable unique id. |
| `name` | string | Display name. |
| `category` | `SkillCategory` | One of the eleven categories. |
| `description` | string | One line, shown on the card. |
| `purpose` | string | What the skill is for (1-2 sentences). |
| `whenToUse` | string | The trigger situation. |
| `inputs` | string[] | What the user should provide. |
| `outputs` | string[] | What they get back. |
| `steps` | string[] | The concrete workflow the agent follows. |
| `behaviorGuidelines` | string[] | How to behave while doing it. |
| `toolsAllowed` | string[] | Tools the skill expects to use (`[]` = up to the agent). |
| `toolsDisallowed` | string[] | Tools to avoid for this skill. |
| `safetyLevel` | `read-only` \| `writes-files` \| `runs-commands` \| `destructive` | Drives safety messaging/confirmation. |
| `confirmationRequired` | boolean | Ask the UI to confirm before invoking. |
| `examplePrompts` | string[] | Realistic things a user would type. |
| `successCriteria` | string[] | What a good result looks like. |
| `failureModes` | string[] | Ways it goes wrong — the agent avoids these. |
| `followUpBehavior` | string | How to close out / what to offer next. |

The `steps`, `behaviorGuidelines`, `successCriteria`, `failureModes`,
`toolsAllowed/Disallowed`, `safetyLevel`, and `followUpBehavior` fields are
composed by `asDirective()` into the actual instruction the agent receives — so
they aren't decoration, they drive behavior.

## The quality bar

Write each step as concrete behavior a real agent performs. Build in a
draft → critique-against-success-criteria → revise-once loop, and end with next
actions.

**Weak (don't do this):**
```
steps: [
  "Analyze the request.",
  "Provide helpful output.",
  "Summarize the result.",
]
```

**Strong:**
```
steps: [
  "Identify the desired outcome, audience, constraints, and deadline. Ask one clarifying question only if a missing detail blocks progress.",
  "Produce a structured first draft.",
  "Critique the draft against the success criteria — be specific about what fails.",
  "Revise once, then present the final result.",
  "End with clear next actions.",
]
```

Checklist for a good skill:
- Steps are concrete actions, not categories.
- It asks **at most one** clarifying question, and only if blocking.
- It includes a self-critique against the success criteria, then one revision.
- `successCriteria` are checkable, not vague.
- `failureModes` name the real ways this task goes wrong.
- `examplePrompts` are things a real user would actually type.
- `safetyLevel` and `toolsDisallowed` match what the task should and shouldn't do.
- It doesn't duplicate an existing skill.

## Adding a skill

1. Open the right category file in `src/lib/skills/` (or add a new category to
   `CATEGORIES` in `types.ts`).
2. Append a `Skill` object with every field filled. Keep arrays tight (3-6 items)
   and specific.
3. Run `npx tsc --noEmit` — the type system enforces the shape.
4. The skill appears in the library automatically (no registration step). If it
   fails validation it's skipped and listed in the library's warning banner.

## Personal vs library skills

Library skills (these files) are general-purpose and shipped with the app. For
private, context-specific workflows (e.g. your own client/process knowledge),
use **personal skills**: markdown files in `~/.claude-agent-desktop/skills/`
managed from the Skills panel. Those auto-inject by keyword and stay local — keep
anything sensitive there, not in the committed library.

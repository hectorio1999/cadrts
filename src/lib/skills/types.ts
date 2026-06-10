// Skill system — schema, categories, validation, and directive composition.
//
// A skill is a reusable expert workflow. Selecting one in chat prepends a
// composed directive (built from the structured fields below) to the user's
// next message, so the agent runs the workflow instead of free-forming. The
// fields aren't just metadata — `asDirective` turns them into the actual
// instruction the agent receives.

export type SkillCategory =
  | "coding"
  | "writing"
  | "research"
  | "business"
  | "productivity"
  | "data"
  | "documents"
  | "design"
  | "learning"
  | "creative"
  | "it";

export const CATEGORIES: {
  id: SkillCategory;
  label: string;
  icon: string;
  blurb: string;
}[] = [
  { id: "coding", label: "Coding & Engineering", icon: "⌨", blurb: "Build, debug, test, and review code." },
  { id: "writing", label: "Writing & Editing", icon: "✍", blurb: "Drafts, edits, and tone for any audience." },
  { id: "research", label: "Research & Analysis", icon: "🔍", blurb: "Gather, compare, and pressure-test information." },
  { id: "business", label: "Business & Strategy", icon: "📊", blurb: "Plans, pricing, proposals, and operations." },
  { id: "productivity", label: "Productivity & Planning", icon: "🗂", blurb: "Plan work, break down tasks, and prioritize." },
  { id: "data", label: "Data & Spreadsheets", icon: "🔢", blurb: "Analyze, clean, and reason about data." },
  { id: "documents", label: "Presentations & Docs", icon: "📄", blurb: "Decks, briefs, reports, and specs." },
  { id: "design", label: "Design & UX", icon: "🎨", blurb: "Critique and improve interfaces and flows." },
  { id: "learning", label: "Learning & Coaching", icon: "🎓", blurb: "Tutor, quiz, and build study material." },
  { id: "creative", label: "Creative & Ideation", icon: "💡", blurb: "Brainstorm, name, and generate content." },
  { id: "it", label: "IT, Homelab & Automation", icon: "🖧", blurb: "Operate, troubleshoot, and harden systems." },
];

/** What the agent might do while running the skill — drives confirmation UX. */
export type SafetyLevel =
  | "read-only" // inspects/produces text; never edits files or runs mutating commands
  | "writes-files" // may create/edit files
  | "runs-commands" // may run shell commands (build, test, git read, etc.)
  | "destructive"; // may delete/overwrite/deploy — always confirm

export type Skill = {
  id: string;
  name: string;
  category: SkillCategory;
  description: string; // one-line, shown on the card
  purpose: string; // what this skill is for (1-2 sentences)
  whenToUse: string; // the trigger situation
  inputs: string[]; // what the user should provide
  outputs: string[]; // what they get back
  steps: string[]; // the concrete workflow the agent follows
  behaviorGuidelines: string[]; // how to behave while doing it
  toolsAllowed: string[]; // tools the skill expects to use ([] = none/up to agent)
  toolsDisallowed: string[]; // tools to avoid for this skill
  safetyLevel: SafetyLevel;
  confirmationRequired: boolean; // ask the UI to confirm before invoking
  examplePrompts: string[]; // realistic things a user would type
  successCriteria: string[]; // what a good result looks like
  failureModes: string[]; // ways this goes wrong — the agent should avoid these
  followUpBehavior: string; // how to close out / what to offer next
};

export const REQUIRED_FIELDS: (keyof Skill)[] = [
  "id",
  "name",
  "category",
  "description",
  "purpose",
  "whenToUse",
  "steps",
  "behaviorGuidelines",
  "examplePrompts",
  "successCriteria",
  "failureModes",
  "followUpBehavior",
];

/** Validate a skill object. Returns a list of problems ([] = valid). Used to
 *  filter malformed skills out of the library gracefully rather than crash. */
export function validateSkill(s: Partial<Skill>): string[] {
  const errs: string[] = [];
  for (const f of REQUIRED_FIELDS) {
    const v = s[f];
    if (v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0)) {
      errs.push(`missing or empty "${f}"`);
    }
  }
  if (s.category && !CATEGORIES.some((c) => c.id === s.category)) {
    errs.push(`unknown category "${s.category}"`);
  }
  if (s.id && !/^[a-z0-9-]+$/.test(s.id)) {
    errs.push(`id "${s.id}" must be kebab-case`);
  }
  return errs;
}

export function categoryLabel(id: SkillCategory): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export function categoryIcon(id: SkillCategory): string {
  return CATEGORIES.find((c) => c.id === id)?.icon ?? "•";
}

/** Compose a skill's structured fields into the directive prepended to the
 *  user's next message. This is what makes the agent run the workflow. */
export function asDirective(skill: Skill): string {
  const bullets = (arr: string[]) => arr.map((s) => `- ${s}`).join("\n");
  const numbered = (arr: string[]) => arr.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const parts = [
    `[Skill: ${skill.name}]`,
    skill.purpose,
    "",
    "Follow these steps:",
    numbered(skill.steps),
    "",
    "How to behave:",
    bullets(skill.behaviorGuidelines),
  ];
  if (skill.toolsAllowed.length) parts.push(`Prefer these tools: ${skill.toolsAllowed.join(", ")}.`);
  if (skill.toolsDisallowed.length) parts.push(`Do not use: ${skill.toolsDisallowed.join(", ")}.`);
  if (skill.safetyLevel === "read-only") {
    parts.push("This is a read-only skill — do not edit files or run mutating commands.");
  } else if (skill.safetyLevel === "destructive") {
    parts.push("This skill can be destructive — confirm with the user before any irreversible action.");
  }
  parts.push(
    "",
    "A good result meets all of these:",
    bullets(skill.successCriteria),
    "",
    "Avoid these failure modes:",
    bullets(skill.failureModes),
    "",
    `When finished: ${skill.followUpBehavior}`,
    "",
    "---",
    "",
  );
  return parts.join("\n");
}

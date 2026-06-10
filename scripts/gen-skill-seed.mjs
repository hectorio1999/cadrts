// Generate base-skill markdown files from the TypeScript skill library.
// The .ts library is the single source of truth (used by the browse UI);
// this emits one markdown file per skill into seed-skills/, which the Rust
// agent-core embeds and seeds into each agent's skills directory so the base
// skills are available to Atlas by default.
//
// Usage (see package.json "gen:skills"):
//   npx esbuild src/lib/skills/index.ts --bundle --format=esm --platform=node --outfile=.skills-bundle.mjs
//   node scripts/gen-skill-seed.mjs
//   (then remove .skills-bundle.mjs)

import { SKILLS } from "../.skills-bundle.mjs";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const OUT = "seed-skills";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const q = (v) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const bullets = (a) => a.map((x) => `- ${x}`).join("\n");
const numbered = (a) => a.map((x, i) => `${i + 1}. ${x}`).join("\n");

function frontmatter(s) {
  return [
    "---",
    `name: ${q(s.name)}`,
    `category: ${s.category}`,
    `description: ${q(s.description)}`,
    `when: ${q(s.whenToUse)}`,
    `safety: ${s.safetyLevel}`,
    "trigger: auto",
    "---",
  ].join("\n");
}

function body(s) {
  const parts = [
    `Purpose: ${s.purpose}`,
    "",
    "Steps:",
    numbered(s.steps),
    "",
    "How to behave:",
    bullets(s.behaviorGuidelines),
  ];
  if (s.toolsAllowed.length) parts.push(`Prefer tools: ${s.toolsAllowed.join(", ")}.`);
  if (s.toolsDisallowed.length) parts.push(`Avoid tools: ${s.toolsDisallowed.join(", ")}.`);
  parts.push(`Safety level: ${s.safetyLevel}.`);
  parts.push(
    "",
    "A good result:",
    bullets(s.successCriteria),
    "",
    "Avoid these failure modes:",
    bullets(s.failureModes),
    "",
    `When finished: ${s.followUpBehavior}`,
  );
  return parts.join("\n");
}

let n = 0;
for (const s of SKILLS) {
  writeFileSync(`${OUT}/${s.id}.md`, `${frontmatter(s)}\n\n${body(s)}\n`, "utf8");
  n++;
}
console.log(`wrote ${n} base skills to ${OUT}/`);

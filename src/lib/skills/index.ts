// Skill library entry point. Combines every category, validates each skill,
// drops malformed/duplicate ones gracefully (recording why), and exports the
// clean SKILLS list the UI consumes.

import { CODING_SKILLS } from "./coding";
import { WRITING_SKILLS } from "./writing";
import { RESEARCH_SKILLS } from "./research";
import { BUSINESS_SKILLS } from "./business";
import { PRODUCTIVITY_SKILLS } from "./productivity";
import { DATA_SKILLS } from "./data";
import { DOCUMENT_SKILLS } from "./documents";
import { DESIGN_SKILLS } from "./design";
import { LEARNING_SKILLS } from "./learning";
import { CREATIVE_SKILLS } from "./creative";
import { IT_SKILLS } from "./it";
import { validateSkill, type Skill } from "./types";

const ALL: Skill[] = [
  ...CODING_SKILLS,
  ...WRITING_SKILLS,
  ...RESEARCH_SKILLS,
  ...BUSINESS_SKILLS,
  ...PRODUCTIVITY_SKILLS,
  ...DATA_SKILLS,
  ...DOCUMENT_SKILLS,
  ...DESIGN_SKILLS,
  ...LEARNING_SKILLS,
  ...CREATIVE_SKILLS,
  ...IT_SKILLS,
];

export type SkillLoadError = { id?: string; name?: string; errors: string[] };

/** Skills that failed validation and were excluded — surfaced in the UI so a
 *  broken skill is visible, not silently missing. */
export const SKILL_LOAD_ERRORS: SkillLoadError[] = [];

function buildLibrary(): Skill[] {
  const out: Skill[] = [];
  const seen = new Set<string>();
  for (const s of ALL) {
    const errs = validateSkill(s);
    if (s.id && seen.has(s.id)) errs.push(`duplicate id "${s.id}"`);
    if (errs.length) {
      SKILL_LOAD_ERRORS.push({ id: s.id, name: s.name, errors: errs });
      console.warn(`[skills] skipping "${s.name ?? s.id ?? "(unnamed)"}": ${errs.join("; ")}`);
      continue;
    }
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

/** The validated skill library. */
export const SKILLS: Skill[] = buildLibrary();

export function skillsByCategory(category: string): Skill[] {
  return SKILLS.filter((s) => s.category === category);
}

export function findSkill(id: string): Skill | undefined {
  return SKILLS.find((s) => s.id === id);
}

export * from "./types";

// Back-compat shim. The skill system now lives in ./skills (category files +
// a richer schema). These re-exports keep older imports working.
export { asDirective } from "./skills/types";
export type { Skill, Skill as WorkflowSkill } from "./skills/types";
export { SKILLS as WORKFLOW_SKILLS } from "./skills";

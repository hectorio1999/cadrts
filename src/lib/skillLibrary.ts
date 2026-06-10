// Built-in workflow skills — reusable, generic procedures the agent can run on
// demand (manual invocation from the composer). These complement the user's own
// keyword/always skills (which auto-inject). Selecting one prepends its workflow
// to the next message as an explicit directive.
//
// They are intentionally workspace-agnostic: each tells the agent how to use its
// own tools (Read/Glob/Grep/Bash/Edit) against the current project, and what to
// produce. Users can also install any of these into their editable skills dir.

export type WorkflowSkill = {
  id: string;
  name: string;
  description: string;
  /** When to reach for this. */
  when: string;
  /** The workflow body injected into the prompt. */
  body: string;
};

export const WORKFLOW_SKILLS: WorkflowSkill[] = [
  {
    id: "codebase-audit",
    name: "Codebase Audit",
    description: "Map an unfamiliar project and report architecture, risks, and quick wins.",
    when: "Starting on a new repo, or before a big change.",
    body: [
      "Audit this codebase. Work from evidence, not assumptions:",
      "1. Identify the stack: read package.json / Cargo.toml / pyproject / go.mod and the lockfile. Name the frameworks, language versions, and scripts.",
      "2. Map the structure: glob the top 2–3 directory levels (skip node_modules/target/dist). Identify entry points, the build, and how it runs.",
      "3. Read the 5–10 most important files (entry points, main modules, config) — don't read everything.",
      "4. Summarize: what the project does, how it's organized, and the data/control flow.",
      "5. Flag risks: security concerns, fragile abstractions, dead code, missing tests, doc drift — with file:line evidence.",
      "6. Recommend 3–5 high-impact, low-risk improvements, ordered.",
      "Output a concise report with sections: Stack · Architecture · Risks · Quick wins. Cite real files. Do not edit anything.",
    ].join("\n"),
  },
  {
    id: "build-feature",
    name: "Build Feature",
    description: "Implement a feature end-to-end with a plan, code, and verification.",
    when: "Adding new functionality of non-trivial size.",
    body: [
      "Build the feature I describe. Before writing code:",
      "1. Restate the goal and acceptance criteria in one or two lines.",
      "2. Explore the relevant existing code so the new work matches conventions.",
      "3. Lay out a short plan (files to add/change, in order). Surface risks or decisions that need my input.",
      "Then implement in small, logical steps. Match the surrounding code's style and patterns. Add types/validation where the codebase already uses them.",
      "After implementing: build/typecheck if there's a command, and run the relevant tests. Report what you changed (file list), how you verified it, and anything left as a follow-up. Don't claim it works without running it.",
    ].join("\n"),
  },
  {
    id: "debug-error",
    name: "Debug Error",
    description: "Diagnose a failure from evidence and propose the minimal fix.",
    when: "Something is broken, throwing, or behaving wrong.",
    body: [
      "Debug the problem I describe. Be evidence-driven:",
      "1. Reproduce or locate the failure — read the actual error/stack, and the code at those lines.",
      "2. Form a hypothesis for the root cause and confirm it by reading code or running a check. Distinguish the root cause from the symptom.",
      "3. Propose the minimal fix. Explain why it addresses the cause, not just the symptom.",
      "4. Apply it (if I've allowed edits), then verify by re-running the failing path.",
      "Report: root cause · the fix · how you confirmed it. If you can't confirm, say so and give the most likely cause with the evidence you have.",
    ].join("\n"),
  },
  {
    id: "refactor-module",
    name: "Refactor Module",
    description: "Improve structure without changing behavior, verified by tests.",
    when: "Code works but is messy, duplicated, or hard to extend.",
    body: [
      "Refactor the target I specify. Behavior must not change.",
      "1. Read the module and its call sites. Note the public surface that must stay stable.",
      "2. Identify the specific smells (duplication, long functions, weak abstractions, tangled deps).",
      "3. Make focused, reversible changes — one concern at a time. Keep names and patterns consistent with the codebase.",
      "4. After each meaningful step, run the build/tests. If there are no tests for this code, say so and add a couple of characterization tests first if feasible.",
      "Report what improved and confirm behavior is unchanged (tests green / build clean).",
    ].join("\n"),
  },
  {
    id: "create-component",
    name: "Create Component",
    description: "Scaffold a UI component matching the project's conventions.",
    when: "Adding a new frontend component.",
    body: [
      "Create the component I describe. First inspect a couple of existing components to match conventions (framework, styling approach, file layout, prop patterns).",
      "Then build it: typed props, sensible defaults, accessible markup, and the project's styling system (don't introduce a new one). Handle empty/loading/error states if the component fetches or can be empty.",
      "Wire it where I asked (or show me where to). Typecheck/build afterward and report the files added.",
    ].join("\n"),
  },
  {
    id: "create-api-route",
    name: "Create API Route",
    description: "Add a backend route/endpoint with validation and error handling.",
    when: "Adding a server endpoint.",
    body: [
      "Create the API route I describe. Match the project's existing routing, validation, and error-handling patterns (read a sibling route first).",
      "Include: input validation, auth/permission checks consistent with the codebase, structured success + error responses, and no secrets in code. Avoid SQL/command injection and unbounded inputs.",
      "Typecheck/build afterward. Report the route signature, the validation, and how errors are returned.",
    ].join("\n"),
  },
  {
    id: "generate-tests",
    name: "Generate Tests",
    description: "Write meaningful tests for a unit, including edge cases.",
    when: "Coverage is missing or you changed risky code.",
    body: [
      "Write tests for the target I specify, using the project's existing test framework and conventions (find an existing test and match it).",
      "Cover: the happy path, the important edge cases, and at least one failure case. Prefer behavior-level assertions over implementation details. Don't write tests that just restate the code.",
      "Run the test suite and confirm they pass (and actually exercise the code — a test that can't fail is worthless). Report what's covered and any gaps you deliberately left.",
    ].join("\n"),
  },
  {
    id: "write-docs",
    name: "Write Documentation",
    description: "Produce accurate docs grounded in the actual code.",
    when: "A module, API, or setup is undocumented or drifted.",
    body: [
      "Document the target I specify. Read the code first — docs must reflect what the code actually does, not what it should do.",
      "Produce: a clear overview, setup/usage with real examples that would actually run, and notes on gotchas/edge cases. Keep it concise. If you find the code and intended behavior disagree, flag it rather than papering over it.",
      "Write to the appropriate file (README/docs). Report what you wrote and any drift you found.",
    ].join("\n"),
  },
  {
    id: "security-review",
    name: "Security Review",
    description: "Review changed/auth/IO code for vulnerabilities (read-only).",
    when: "Before shipping auth, file, network, or admin code.",
    body: [
      "Do a security review of the code I point you at (or the recent changes). Read-only — do not edit.",
      "Check for: missing authn/authz, injection (SQL/command/path), unsafe deserialization, secrets in code/logs, SSRF, missing input validation, overly broad CORS/permissions, and unsafe file/upload handling.",
      "For each finding: severity, the exact file:line, why it's exploitable, and a concrete fix. Don't pad the list with non-issues — flag what's real. End with the single highest-priority item.",
    ].join("\n"),
  },
  {
    id: "project-onboarding",
    name: "Project Onboarding",
    description: "Get oriented in this workspace and produce a working summary.",
    when: "First time opening a project in this app.",
    body: [
      "Onboard me to this project. Explore the current workspace and produce a tight orientation:",
      "1. What is this? (stack, purpose, entry points)",
      "2. How do I run it? (install, dev, build, test commands — read them from the manifest/scripts, don't guess)",
      "3. Where does the important logic live? (the 5–8 files/dirs that matter most)",
      "4. What should I be careful about? (risky areas, missing tests, env/secrets, deploy)",
      "Keep it skimmable. Cite real files. Don't edit anything.",
    ].join("\n"),
  },
  {
    id: "release-prep",
    name: "Release Prep",
    description: "Pre-release checklist: build, tests, changelog, version.",
    when: "Cutting a release.",
    body: [
      "Prepare this project for release:",
      "1. Run the build and the full test suite. Report pass/fail honestly with output — do not proceed past a failure without telling me.",
      "2. Summarize what changed since the last release (read git log / tags if available) into changelog-ready bullets.",
      "3. Check version numbers are consistent across manifests and bump if I ask.",
      "4. Flag anything risky for release (uncommitted changes, TODO/FIXME in changed files, failing lint).",
      "Output a go/no-go summary with the evidence. Only make edits (changelog/version) if I've allowed it.",
    ].join("\n"),
  },
];

/** Wrap a skill body as an explicit directive prepended to the user's message. */
export function asDirective(skill: WorkflowSkill): string {
  return `[Apply the "${skill.name}" workflow]\n${skill.body}\n\n---\n`;
}

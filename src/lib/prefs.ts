// Agent preferences — how the spawned `claude` turn is configured. These were
// previously hardcoded in ChatPane; now they're user-controllable and
// persisted. The permission mode is the primary safety control.

import type { PermissionMode } from "./types";

const PREFS_KEY = "cad-prefs";

/** Tools the agent may use, in display order. Mirrors Claude Code's tool set. */
export const ALL_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "Task",
  "NotebookEdit",
] as const;

export const DEFAULT_TOOLS: string[] = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
];

/** Permission modes with human labels + what they mean for safety. */
export const PERMISSION_MODES: {
  value: PermissionMode;
  label: string;
  hint: string;
}[] = [
  { value: "plan", label: "Plan", hint: "Read-only. The agent proposes but never edits or runs commands." },
  { value: "default", label: "Ask first", hint: "Prompts before edits and shell commands." },
  { value: "acceptEdits", label: "Auto-edit", hint: "Applies file edits automatically; still surfaces them." },
  { value: "bypassPermissions", label: "Full access", hint: "No gating. The agent edits and runs commands freely." },
];

export type AgentPrefs = {
  permissionMode: PermissionMode;
  allowedTools: string[];
};

// Default: every tool checked. Because unchecked tools are now *withheld*
// (sent as --disallowed-tools), starting with all checked means "nothing
// withheld, everything auto-approved" — the user unchecks to restrict.
export const DEFAULT_PREFS: AgentPrefs = {
  permissionMode: "acceptEdits",
  allowedTools: [...ALL_TOOLS],
};

export function loadPrefs(): AgentPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<AgentPrefs>;
    const mode = parsed.permissionMode;
    const tools = Array.isArray(parsed.allowedTools)
      ? parsed.allowedTools.filter((t): t is string => typeof t === "string")
      : DEFAULT_PREFS.allowedTools;
    const validMode: PermissionMode =
      mode === "plan" || mode === "default" || mode === "acceptEdits" || mode === "bypassPermissions"
        ? mode
        : DEFAULT_PREFS.permissionMode;
    return { permissionMode: validMode, allowedTools: tools };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: AgentPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage disabled — prefs just won't persist */
  }
}

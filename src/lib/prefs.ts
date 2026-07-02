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

/** Model choices. Empty string = the plan's default model. Aliases map to the
 *  latest of each family; a full model id can also be set via the custom field. */
export const MODELS: { value: string; label: string; hint: string }[] = [
  { value: "", label: "Default", hint: "Whatever your plan uses by default (currently Fable 5)." },
  { value: "claude-fable-5", label: "Fable 5", hint: "The default frontier model." },
  { value: "opus", label: "Opus", hint: "Most capable — best for hard reasoning and code." },
  { value: "claude-sonnet-5", label: "Sonnet 5", hint: "Balanced speed and capability — latest Sonnet. (The bare `sonnet` alias on the box CLI still resolves to 4.6.)" },
  { value: "haiku", label: "Haiku", hint: "Fastest and cheapest — quick tasks." },
];

/** Color themes. `id` matches the `data-theme` attribute set on <html>.
 *  `swatch`/`accent` drive the little preview chips in Settings. */
export const THEMES: { id: string; label: string; hint: string; swatch: string; accent: string }[] = [
  { id: "navy", label: "Navy", hint: "Deep royal navy + cream serif wordmark (default).", swatch: "#09132c", accent: "#e6d6b0" },
  { id: "dark", label: "Dark", hint: "Tactical dark + orange.", swatch: "#0b0d10", accent: "#ff7a59" },
  { id: "light", label: "Light", hint: "Clean light mode.", swatch: "#f7f7f8", accent: "#e35a36" },
  { id: "nord", label: "Nord", hint: "Arctic blue-gray with a frost accent.", swatch: "#2e3440", accent: "#88c0d0" },
  { id: "synthwave", label: "Synthwave", hint: "Deep indigo, neon magenta + cyan glow.", swatch: "#160d28", accent: "#ff2e97" },
  { id: "matrix", label: "Matrix", hint: "Phosphor-green terminal with scanlines.", swatch: "#0a0f0a", accent: "#3df58a" },
];

export const THEME_IDS = THEMES.map((t) => t.id);

export type AgentPrefs = {
  permissionMode: PermissionMode;
  allowedTools: string[];
  /** "" = default model; otherwise an alias (opus/sonnet/haiku) or full model id. */
  model: string;
  /** Color theme id (matches a THEMES entry / the html data-theme). */
  theme: string;
};

// Default: every tool checked. Because unchecked tools are now *withheld*
// (sent as --disallowed-tools), starting with all checked means "nothing
// withheld, everything auto-approved" — the user unchecks to restrict.
export const DEFAULT_PREFS: AgentPrefs = {
  permissionMode: "acceptEdits",
  allowedTools: [...ALL_TOOLS],
  model: "",
  theme: "navy",
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
    const model = typeof parsed.model === "string" ? parsed.model : "";
    const theme =
      typeof parsed.theme === "string" && THEME_IDS.includes(parsed.theme)
        ? parsed.theme
        : DEFAULT_PREFS.theme;
    return { permissionMode: validMode, allowedTools: tools, model, theme };
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

// Workspace (project root) state — the directory the agent operates in.
//
// Every turn spawns the `claude` CLI with `--current_dir <cwd>`. Until now the
// UI always sent `cwd: null`, so the agent ran in a bare HOME with no project
// context. This module gives the app a real "current project" the user can
// pick and switch, and persists it across restarts.
//
// Local vs remote nuance (deliberate, surfaced in the UI):
//   - Tauri + Local transport: the native folder picker selects a REAL local
//     directory and the agent operates on it directly.
//   - Remote transport (Tauri or browser): `cwd` is a path on the *server's*
//     filesystem (e.g. the LXC). The native picker can't see the server's
//     disk, so remote users type/paste a server-side path instead.
//
// Persistence is localStorage for now (works identically in the Tauri webview
// and the plain browser bundle). Moving this into config.json / the DB is
// tracked in TODO.md.

import { isTauri } from "./runtime";

const WS_KEY = "cad-workspace";
const WS_RECENTS_KEY = "cad-workspace-recents";
const MAX_RECENTS = 8;

/** The active project root, or null to run the agent in its default HOME. */
export function loadWorkspace(): string | null {
  try {
    return localStorage.getItem(WS_KEY) || null;
  } catch {
    return null;
  }
}

export function saveWorkspace(path: string | null): void {
  try {
    if (path) localStorage.setItem(WS_KEY, path);
    else localStorage.removeItem(WS_KEY);
  } catch {
    /* storage disabled — selection just won't persist across restarts */
  }
}

export function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(WS_RECENTS_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Move `path` to the front of the recents list (deduped, capped). */
export function pushRecent(path: string): string[] {
  const next = [path, ...loadRecents().filter((p) => p !== path)].slice(0, MAX_RECENTS);
  try {
    localStorage.setItem(WS_RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

/**
 * Open the native folder picker (Tauri only). Returns the chosen absolute
 * path, or null if cancelled / unavailable. Lazy-imports the dialog plugin so
 * the browser bundle never pulls it.
 */
export async function browseForDirectory(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const dialog = await import("@tauri-apps/plugin-dialog");
    const picked = await dialog.open({
      directory: true,
      multiple: false,
      title: "Select project folder",
    });
    return typeof picked === "string" ? picked : null;
  } catch (e) {
    console.warn("[workspace] native folder picker failed:", e);
    return null;
  }
}

/** True when a native folder picker is available (desktop app). */
export function canBrowse(): boolean {
  return isTauri();
}

/** Last path segment, for compact display. Handles both `/` and `\`. */
export function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

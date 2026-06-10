// Thin bar above the chat showing the active project root (the `cwd` sent to
// the agent each turn) with controls to switch it. This is what makes the app
// "understand the current project" instead of running in a bare HOME.
//
// Two ways to set the workspace, surfaced honestly:
//   - "Browse…" (desktop app only) opens the native folder picker — best for
//     Local transport where the agent runs on this machine.
//   - A text field accepts a typed/pasted path — required for Remote transport,
//     where `cwd` is a path on the server's filesystem the picker can't see.

import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { browseForDirectory, canBrowse, basename } from "../lib/workspace";

export default function WorkspaceBar() {
  const workspace = useStore((s) => s.workspace);
  const recents = useStore((s) => s.workspaceRecents);
  const setWorkspace = useStore((s) => s.setWorkspace);
  const streaming = useStore((s) => s.streaming);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const popRef = useRef<HTMLDivElement | null>(null);

  // Close the popover on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(path: string | null) {
    setWorkspace(path && path.trim() ? path.trim() : null);
    setDraft("");
    setOpen(false);
  }

  async function onBrowse() {
    const picked = await browseForDirectory();
    if (picked) choose(picked);
  }

  const label = workspace ? basename(workspace) : "No project";

  return (
    <div ref={popRef} className="relative border-b border-ink-600 bg-ink-800/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-ink-700/30"
        title={workspace ?? "Agent runs in its default home directory"}
      >
        <span className="text-zinc-500" aria-hidden>
          {workspace ? "📁" : "🏠"}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-zinc-600">Project</span>
        <span className="truncate text-sm font-mono text-zinc-200">{label}</span>
        {workspace && (
          <span className="truncate text-[10px] font-mono text-zinc-600">{workspace}</span>
        )}
        <span className="ml-auto text-zinc-600">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="absolute left-3 right-3 top-full z-30 mt-1 rounded-lg border border-ink-500 bg-ink-800 p-3 shadow-xl shadow-black/40">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-zinc-500">
            Set project folder
          </div>

          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") choose(draft);
              }}
              placeholder={canBrowse() ? "Paste a path, or Browse…" : "Type/paste an absolute path on the server"}
              className="flex-1 rounded border border-ink-500 bg-ink-700/40 px-2 py-1.5 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:border-accent/60"
            />
            {canBrowse() && (
              <button
                onClick={onBrowse}
                className="rounded border border-ink-500 px-2 py-1.5 text-xs text-zinc-300 hover:bg-ink-700/40"
              >
                Browse…
              </button>
            )}
            <button
              onClick={() => choose(draft)}
              disabled={!draft.trim()}
              className="rounded bg-accent px-2 py-1.5 text-xs font-semibold text-ink-900 disabled:opacity-40"
            >
              Set
            </button>
          </div>

          {streaming && (
            <div className="mt-2 text-[10px] text-amber-400/80">
              Changing the project applies to your next message (a turn is in flight).
            </div>
          )}

          {recents.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-600">Recent</div>
              <ul className="max-h-40 overflow-y-auto">
                {recents.map((p) => (
                  <li key={p}>
                    <button
                      onClick={() => choose(p)}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-ink-700/40 ${
                        p === workspace ? "text-accent" : "text-zinc-300"
                      }`}
                      title={p}
                    >
                      <span className="truncate text-xs font-mono">{basename(p)}</span>
                      <span className="ml-auto truncate text-[10px] font-mono text-zinc-600">{p}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {workspace && (
            <button
              onClick={() => choose(null)}
              className="mt-3 w-full rounded border border-ink-500 px-2 py-1.5 text-xs text-zinc-400 hover:bg-ink-700/40"
            >
              🏠 Use home directory (no project)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

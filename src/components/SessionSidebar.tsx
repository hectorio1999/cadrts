import { useEffect, useState } from "react";
import { deleteSession as ipcDelete, renameSession as ipcRename } from "../lib/ipc";
import { useStore } from "../lib/store";

/**
 * Three-zone left rail:
 *   1. New / refresh actions
 *   2. SQLite-backed session history (click to resume, dbl-click to rename)
 *   3. Memory + skills entry points
 */
export default function SessionSidebar({
  onOpenMemory,
  onOpenSkills,
  onOpenSettings,
}: {
  onOpenMemory: () => void;
  onOpenSkills: () => void;
  onOpenSettings: () => void;
}) {
  const session = useStore((s) => s.session);
  const resetSession = useStore((s) => s.resetSession);
  const streaming = useStore((s) => s.streaming);
  const sessionList = useStore((s) => s.sessionList);
  const refreshSessions = useStore((s) => s.refreshSessions);
  const openSession = useStore((s) => s.openSession);

  // Pull the list whenever this component mounts.
  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  return (
    <aside className="w-64 border-r border-ink-600 bg-ink-800/40 flex flex-col">
      <div className="p-3 border-b border-ink-600 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-accent" />
          <span className="font-semibold text-sm">Agent Desktop</span>
        </div>
        <button
          onClick={resetSession}
          disabled={streaming}
          title="Start a new conversation"
          className="px-2 py-1 text-xs rounded border border-ink-500 hover:bg-ink-600/40"
        >
          + new
        </button>
      </div>

      <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-zinc-500 flex items-center justify-between">
        <span>history</span>
        <button
          onClick={() => refreshSessions()}
          className="text-zinc-500 hover:text-zinc-300"
          title="Refresh list"
        >
          ↻
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {sessionList.length === 0 ? (
          <div className="px-2 py-3 text-xs text-zinc-500 italic">
            No past sessions yet. They appear here after the first turn finishes.
          </div>
        ) : (
          sessionList.map((row) => (
            <SessionRowItem
              key={row.id}
              row={row}
              isActive={row.id === session.id}
              disabled={streaming}
              onOpen={() => openSession(row.id)}
              onAfterMutate={() => refreshSessions()}
            />
          ))
        )}
      </div>

      <div className="p-3 border-t border-ink-600 flex flex-col gap-1">
        <button
          onClick={onOpenMemory}
          className="text-xs text-left px-2 py-1.5 rounded hover:bg-ink-600/40"
        >
          ⌘  edit memory
        </button>
        <button
          onClick={onOpenSkills}
          className="text-xs text-left px-2 py-1.5 rounded hover:bg-ink-600/40"
        >
          ⌥  manage skills
        </button>
        <button
          onClick={onOpenSettings}
          className="text-xs text-left px-2 py-1.5 rounded hover:bg-ink-600/40"
        >
          ⚙  settings (transport)
        </button>
      </div>
    </aside>
  );
}

function SessionRowItem(props: {
  row: { id: string; title: string; last_at: number; message_count: number };
  isActive: boolean;
  disabled: boolean;
  onOpen: () => void;
  onAfterMutate: () => void;
}) {
  const { row, isActive, disabled, onOpen, onAfterMutate } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.title);

  async function commitRename() {
    setEditing(false);
    if (draft.trim() && draft !== row.title) {
      await ipcRename(row.id, draft.trim());
      onAfterMutate();
    }
  }

  async function onDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete session "${row.title}"?`)) return;
    await ipcDelete(row.id);
    onAfterMutate();
  }

  return (
    <div
      onClick={() => !disabled && !editing && onOpen()}
      onDoubleClick={() => setEditing(true)}
      className={`group px-2 py-2 rounded mb-1 cursor-pointer text-xs font-mono ${
        isActive
          ? "bg-accent/10 border border-accent/40"
          : "border border-transparent hover:bg-ink-600/30"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <div className="flex items-center justify-between">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setDraft(row.title);
                setEditing(false);
              }
            }}
            className="flex-1 bg-ink-900/60 border border-ink-500 rounded px-1 py-0.5 text-zinc-100"
          />
        ) : (
          <span className="text-zinc-100 truncate">{row.title}</span>
        )}
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-60 hover:opacity-100 ml-2 text-zinc-500 hover:text-red-400"
          title="Delete"
        >
          ✕
        </button>
      </div>
      <div className="mt-0.5 text-[10px] text-zinc-500">
        {row.message_count} msg · {timeAgo(row.last_at)}
      </div>
    </div>
  );
}

function timeAgo(ts: number): string {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

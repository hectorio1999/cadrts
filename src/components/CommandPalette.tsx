import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/store";

type Action = {
  id: string;
  label: string;
  hint?: string;
  perform: () => void;
};

/**
 * Cmd+K / Ctrl+K palette.
 *
 * Fuzzy-finds across: built-in actions (new, memory, skills, toggle inspector)
 * and the persisted session list. Selecting a session calls `openSession`.
 * Keyboard: Enter = run, ↑/↓ = move, Esc = close.
 */
export default function CommandPalette({
  open,
  onClose,
  onOpenMemory,
  onOpenSkills,
  onOpenSettings,
}: {
  open: boolean;
  onClose: () => void;
  onOpenMemory: () => void;
  onOpenSkills: () => void;
  onOpenSettings: () => void;
}) {
  const sessions = useStore((s) => s.sessionList);
  const openSession = useStore((s) => s.openSession);
  const resetSession = useStore((s) => s.resetSession);
  const toggleInspector = useStore((s) => s.toggleInspector);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const actions: Action[] = useMemo(() => {
    const base: Action[] = [
      {
        id: "new",
        label: "New session",
        hint: "start a fresh conversation",
        perform: () => {
          resetSession();
          onClose();
        },
      },
      {
        id: "memory",
        label: "Edit memory",
        hint: "~/.claude-agent-desktop/memory.md",
        perform: () => {
          onClose();
          onOpenMemory();
        },
      },
      {
        id: "skills",
        label: "Manage skills",
        hint: "markdown playbooks",
        perform: () => {
          onClose();
          onOpenSkills();
        },
      },
      {
        id: "inspector",
        label: "Toggle inspector",
        hint: "right pane",
        perform: () => {
          toggleInspector();
          onClose();
        },
      },
      {
        id: "settings",
        label: "Settings — transport",
        hint: "local ↔ remote",
        perform: () => {
          onClose();
          onOpenSettings();
        },
      },
    ];
    const sessionActions: Action[] = sessions.map((s) => ({
      id: `session:${s.id}`,
      label: s.title,
      hint: `${s.message_count} msg`,
      perform: () => {
        void openSession(s.id);
        onClose();
      },
    }));
    return [...base, ...sessionActions];
  }, [sessions, onClose, onOpenMemory, onOpenSkills, onOpenSettings, openSession, resetSession, toggleInspector]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return actions;
    return actions.filter((a) =>
      `${a.label} ${a.hint ?? ""}`.toLowerCase().includes(needle),
    );
  }, [q, actions]);

  useEffect(() => {
    if (cursor >= filtered.length) setCursor(0);
  }, [filtered.length, cursor]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[cursor]?.perform();
    }
  }

  return (
    <div
      className="fixed inset-0 bg-ink-900/70 backdrop-blur-sm z-50 grid place-items-start pt-[14vh]"
      onClick={onClose}
    >
      <div
        className="w-[560px] max-w-[90vw] bg-ink-800 border border-ink-500 rounded-lg overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Jump to session or action…"
          className="w-full px-4 py-3 bg-transparent text-zinc-100 font-mono text-sm placeholder:text-zinc-600 border-b border-ink-600"
        />
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-zinc-500 italic">
              No matches.
            </div>
          ) : (
            filtered.map((a, i) => (
              <button
                key={a.id}
                onClick={a.perform}
                onMouseEnter={() => setCursor(i)}
                className={`w-full text-left px-4 py-2 flex items-center justify-between text-sm font-mono ${
                  i === cursor ? "bg-accent/10" : ""
                }`}
              >
                <span className="text-zinc-100 truncate">{a.label}</span>
                {a.hint && (
                  <span className="text-[11px] text-zinc-500 ml-3 shrink-0">
                    {a.hint}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
        <div className="border-t border-ink-600 px-3 py-1.5 flex items-center gap-3 text-[10px] text-zinc-500 font-mono">
          <span>↵ run</span>
          <span>↑↓ move</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

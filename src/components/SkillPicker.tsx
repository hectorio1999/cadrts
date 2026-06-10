import { useEffect, useRef, useState } from "react";
import { WORKFLOW_SKILLS, type WorkflowSkill } from "../lib/skillLibrary";

/** Popover that lets the user attach a workflow skill to their next message.
 *  `wrapRef` (the element wrapping both the trigger button and this popover) is
 *  used for the outside-click check so clicking the trigger toggles cleanly
 *  rather than close-then-reopen. */
export default function SkillPicker({
  onPick,
  onClose,
  wrapRef,
}: {
  onPick: (skill: WorkflowSkill) => void;
  onClose: () => void;
  wrapRef?: React.RefObject<HTMLElement | null>;
}) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const container = wrapRef?.current ?? ref.current;
      if (container && !container.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, wrapRef]);

  const needle = q.trim().toLowerCase();
  const matches = needle
    ? WORKFLOW_SKILLS.filter(
        (s) =>
          s.name.toLowerCase().includes(needle) ||
          s.description.toLowerCase().includes(needle),
      )
    : WORKFLOW_SKILLS;

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 z-30 mb-2 w-[420px] max-w-[80vw] rounded-lg border border-ink-500 bg-ink-800 p-2 shadow-xl shadow-black/40"
    >
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Find a workflow…"
        className="mb-2 w-full rounded border border-ink-500 bg-ink-700/40 px-2 py-1.5 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:border-accent/60"
      />
      <ul className="max-h-72 overflow-y-auto">
        {matches.length === 0 && (
          <li className="px-2 py-3 text-center text-xs text-zinc-600">No matching workflow.</li>
        )}
        {matches.map((s) => (
          <li key={s.id}>
            <button
              onClick={() => onPick(s)}
              className="w-full rounded px-2 py-1.5 text-left hover:bg-ink-700/50"
            >
              <div className="text-xs font-semibold text-zinc-200">{s.name}</div>
              <div className="text-[10px] leading-snug text-zinc-500">{s.description}</div>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-1 border-t border-ink-600 px-2 pt-1.5 text-[10px] text-zinc-600">
        Attaches the workflow to your next message.
      </div>
    </div>
  );
}

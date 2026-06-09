import { useState } from "react";
import type { ToolRun } from "../lib/types";
import { useStore } from "../lib/store";

/**
 * Collapsible inline card for a single tool_use → tool_result pair.
 * Click the header to expand. While the call is in flight we show a pulsing
 * dot; when the result arrives we render input + output with monospace.
 */
export default function ToolCallCard({ run }: { run: ToolRun }) {
  const [open, setOpen] = useState(false);
  const selectToolRun = useStore((s) => s.selectToolRun);
  const done = run.ended_at != null;
  const errored = run.is_error === true;

  return (
    <div
      className={`border rounded font-mono text-xs ${
        errored
          ? "border-red-500/40 bg-red-500/5"
          : done
          ? "border-ink-500 bg-ink-700/30"
          : "border-accent/40 bg-accent/5"
      }`}
    >
      <button
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-ink-600/30"
        onClick={() => {
          setOpen((o) => !o);
          selectToolRun(run.tool_use_id);
        }}
      >
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${
            done ? (errored ? "bg-red-400" : "bg-emerald-400") : "bg-accent pulse-dot"
          }`} />
          <span className="text-zinc-200 font-semibold">{run.name}</span>
          <span className="text-zinc-500">{summarize(run.input)}</span>
        </div>
        <span className="text-zinc-500">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="px-3 py-2 border-t border-ink-500 space-y-2">
          <div>
            <div className="text-[10px] uppercase text-zinc-500 mb-1">input</div>
            <pre className="bg-ink-900/60 rounded p-2 overflow-x-auto text-zinc-200 whitespace-pre-wrap">{stringify(run.input)}</pre>
          </div>
          {done && (
            <div>
              <div className="text-[10px] uppercase text-zinc-500 mb-1">
                {errored ? "error" : "output"}
              </div>
              <pre className="bg-ink-900/60 rounded p-2 overflow-x-auto text-zinc-200 whitespace-pre-wrap">{stringify(run.output)}</pre>
            </div>
          )}
          {!done && (
            <div className="text-zinc-500 text-xs italic pulse-dot">running…</div>
          )}
        </div>
      )}
    </div>
  );
}

function summarize(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  // Heuristics tuned to the most common tool inputs.
  if (typeof obj.command === "string") return truncate(obj.command, 120);
  if (typeof obj.file_path === "string") return truncate(obj.file_path, 120);
  if (typeof obj.path === "string") return truncate(obj.path, 120);
  if (typeof obj.pattern === "string") return truncate(obj.pattern, 120);
  if (typeof obj.url === "string") return truncate(obj.url, 120);
  return truncate(JSON.stringify(obj), 120);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

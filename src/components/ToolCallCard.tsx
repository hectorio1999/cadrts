import { useState } from "react";
import type { ToolRun } from "../lib/types";
import { useStore } from "../lib/store";
import CopyButton from "./CopyButton";

/**
 * Collapsible inline card for a single tool_use → tool_result pair.
 * Click the header to expand. While the call is in flight we show a pulsing
 * dot; when the result arrives we render input + output. File-mutating tools
 * (Edit/Write/MultiEdit) get a diff/content preview instead of raw JSON.
 */
export default function ToolCallCard({ run }: { run: ToolRun }) {
  const [open, setOpen] = useState(false);
  const selectToolRun = useStore((s) => s.selectToolRun);
  const done = run.ended_at != null;
  const errored = run.is_error === true;

  return (
    <div
      className={`rounded border font-mono text-xs ${
        errored
          ? "border-red-500/40 bg-red-500/5"
          : done
          ? "border-ink-500 bg-ink-700/30"
          : "border-accent/40 bg-accent/5"
      }`}
    >
      <button
        className="flex w-full items-center justify-between px-3 py-2 hover:bg-ink-600/30"
        onClick={() => {
          setOpen((o) => !o);
          selectToolRun(run.tool_use_id);
        }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`h-1.5 w-1.5 flex-none rounded-full ${
              done ? (errored ? "bg-red-400" : "bg-emerald-400") : "bg-accent pulse-dot"
            }`}
          />
          <span className="flex-none font-semibold text-zinc-200">{run.name}</span>
          <span className="truncate text-zinc-500">{summarize(run.input)}</span>
        </div>
        <span className="flex-none text-zinc-500">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-ink-500 px-3 py-2">
          <ToolInput run={run} />
          {done && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] uppercase text-zinc-500">
                  {errored ? "error" : "output"}
                </span>
                <CopyButton text={outputText(run.output)} />
              </div>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-ink-900/60 p-2 text-zinc-200">
                {outputText(run.output)}
              </pre>
            </div>
          )}
          {!done && <div className="pulse-dot text-xs italic text-zinc-500">running…</div>}
        </div>
      )}
    </div>
  );
}

/** Renders the tool input — a diff for Edit, a content block for Write,
 *  otherwise pretty JSON. All with a copy affordance. */
function ToolInput({ run }: { run: ToolRun }) {
  const input = (run.input ?? {}) as Record<string, unknown>;
  const name = run.name;

  if ((name === "Edit" || name === "MultiEdit") && typeof input.old_string === "string") {
    return (
      <div>
        <div className="mb-1 text-[10px] uppercase text-zinc-500">edit</div>
        <DiffBlock
          file={typeof input.file_path === "string" ? input.file_path : undefined}
          oldText={input.old_string as string}
          newText={typeof input.new_string === "string" ? (input.new_string as string) : ""}
        />
      </div>
    );
  }

  if ((name === "Write" || name === "NotebookEdit") && typeof input.content === "string") {
    const file = typeof input.file_path === "string" ? input.file_path : undefined;
    return (
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] uppercase text-zinc-500">write {file ?? ""}</span>
          <CopyButton text={input.content as string} />
        </div>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded border border-emerald-500/20 bg-emerald-500/5 p-2 text-emerald-200/90">
          {input.content as string}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase text-zinc-500">input</span>
        <CopyButton text={stringify(run.input)} />
      </div>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-ink-900/60 p-2 text-zinc-200">
        {stringify(run.input)}
      </pre>
    </div>
  );
}

/** Replace-style diff: old lines (removed) then new lines (added). Edit is a
 *  literal old→new substitution, so this is an honest representation. */
function DiffBlock({
  file,
  oldText,
  newText,
}: {
  file?: string;
  oldText: string;
  newText: string;
}) {
  const oldLines = oldText.length ? oldText.split("\n") : [];
  const newLines = newText.length ? newText.split("\n") : [];
  return (
    <div className="overflow-hidden rounded border border-ink-500">
      {file && (
        <div className="flex items-center justify-between border-b border-ink-600 bg-ink-800/60 px-2 py-1">
          <span className="truncate text-[10px] text-zinc-400">{file}</span>
          <span className="flex-none text-[10px] text-zinc-600">
            <span className="text-red-400">-{oldLines.length}</span>{" "}
            <span className="text-emerald-400">+{newLines.length}</span>
          </span>
        </div>
      )}
      <div className="max-h-80 overflow-auto bg-ink-900/60 text-[11px] leading-relaxed">
        {oldLines.map((l, i) => (
          <div key={`o${i}`} className="whitespace-pre-wrap bg-red-500/10 px-2 text-red-300">
            <span className="select-none text-red-500/60">- </span>
            {l || " "}
          </div>
        ))}
        {newLines.map((l, i) => (
          <div key={`n${i}`} className="whitespace-pre-wrap bg-emerald-500/10 px-2 text-emerald-300">
            <span className="select-none text-emerald-500/60">+ </span>
            {l || " "}
          </div>
        ))}
      </div>
    </div>
  );
}

function summarize(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
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

/** tool_result content is usually `[{type:"text", text:"…"}]` — surface the
 *  text rather than dumping the content-block JSON. Falls back to stringify. */
function outputText(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    const texts = v
      .filter(
        (b): b is { type: string; text: string } =>
          !!b &&
          typeof b === "object" &&
          (b as { type?: unknown }).type === "text" &&
          typeof (b as { text?: unknown }).text === "string",
      )
      .map((b) => b.text);
    if (texts.length) return texts.join("\n");
  }
  return stringify(v);
}

import { useState } from "react";
import type { ToolRun } from "../lib/types";
import { useStore } from "../lib/store";
import CopyButton from "./CopyButton";

/**
 * Renders an assistant message's tool calls as a quiet, compact activity list
 * (Claude Code / Claude-desktop feel) instead of a stack of full-width cards.
 * A short run shows its rows directly under a subtle left gutter; a long run —
 * e.g. a health check firing 25 probes — collapses behind a one-line summary so
 * the transcript stays scannable. Each row expands on click to reveal I/O, and
 * clicking also selects the run in the inspector for a full drill-in.
 */
const COLLAPSE_THRESHOLD = 5;

export default function ToolGroup({ runs }: { runs: ToolRun[] }) {
  // Default: small groups open, large groups collapsed. `userOpen` lets a click
  // override the default and stick — including while the run streams in and
  // grows past the threshold, so a big batch tucks itself away live instead of
  // unrolling into a wall.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  if (runs.length === 0) return null;

  const many = runs.length > COLLAPSE_THRESHOLD;
  const open = userOpen ?? !many;
  const failed = runs.reduce((n, r) => n + (r.is_error === true ? 1 : 0), 0);
  const running = runs.some((r) => r.ended_at == null);

  return (
    <div className="border-l border-ink-600/60 pl-2.5">
      {many && (
        <button
          onClick={() => setUserOpen(!open)}
          className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs text-zinc-400 hover:bg-ink-600/30"
        >
          <span
            className={`h-1.5 w-1.5 flex-none rounded-full ${
              running ? "bg-accent pulse-dot" : failed ? "bg-red-400" : "bg-emerald-400"
            }`}
          />
          <span className="font-medium text-zinc-300">{runs.length} tool calls</span>
          {failed > 0 && <span className="text-red-400">· {failed} failed</span>}
          {running && <span className="italic text-zinc-500">· running…</span>}
          <span className="ml-auto flex-none text-zinc-600">{open ? "▾" : "▸"}</span>
        </button>
      )}
      {open && (
        <div className="space-y-px">
          {runs.map((run) => (
            <ToolRow key={run.tool_use_id} run={run} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One tool_use → tool_result pair as a compact, borderless row. The header is
 *  a single line (status dot · tool name · truncated args); expanding shows the
 *  input and output, with a diff/content preview for file-mutating tools. */
function ToolRow({ run }: { run: ToolRun }) {
  const [open, setOpen] = useState(false);
  const selectToolRun = useStore((s) => s.selectToolRun);
  const done = run.ended_at != null;
  const errored = run.is_error === true;

  return (
    <div>
      <button
        className="group flex w-full items-center gap-2 rounded px-1.5 py-1 text-left font-mono text-xs hover:bg-ink-600/30"
        onClick={() => {
          setOpen((o) => !o);
          selectToolRun(run.tool_use_id);
        }}
      >
        <span
          className={`h-1.5 w-1.5 flex-none rounded-full ${
            done ? (errored ? "bg-red-400" : "bg-emerald-400") : "bg-accent pulse-dot"
          }`}
        />
        <span className="flex-none font-sans font-medium text-zinc-300">{run.name}</span>
        <span className={`truncate ${errored ? "text-red-300/80" : "text-zinc-500"}`}>
          {summarize(run.input)}
        </span>
        <span className="ml-auto flex-none text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="space-y-2 px-1.5 pb-2 pt-1 font-mono">
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

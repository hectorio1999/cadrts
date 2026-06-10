// Live "the agent is working" status, shown while a turn streams. It surfaces
// what the agent is actually doing right now — the in-flight tool call (search,
// read, run, …) or "thinking" between steps — plus a ticking elapsed timer, so
// even a long turn with no text yet clearly looks alive.

import { useEffect, useState } from "react";
import type { ChatMessage } from "../lib/types";

function shorten(v: unknown, n = 52): string {
  if (typeof v !== "string") return "";
  const s = v.replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function describeTool(t: ChatMessage["tools"][number]): { icon: string; label: string } {
  const input = (t.input ?? {}) as Record<string, unknown>;
  switch (t.name) {
    case "WebSearch":
      return { icon: "🔍", label: `Searching the web${input.query ? `: ${shorten(input.query)}` : ""}` };
    case "WebFetch":
      return { icon: "🌐", label: `Reading ${shorten(input.url)}` };
    case "Read":
      return { icon: "📖", label: `Reading ${shorten(input.file_path)}` };
    case "Write":
      return { icon: "✍️", label: `Writing ${shorten(input.file_path)}` };
    case "Edit":
    case "MultiEdit":
      return { icon: "✏️", label: `Editing ${shorten(input.file_path)}` };
    case "Bash":
      return { icon: "⚙️", label: `Running ${shorten(input.command)}` };
    case "Grep":
    case "Glob":
      return { icon: "🔎", label: `Searching files${input.pattern ? `: ${shorten(input.pattern)}` : ""}` };
    case "Task":
      return { icon: "🤖", label: "Running a sub-task" };
    case "TodoWrite":
      return { icon: "🗒️", label: "Updating the plan" };
    default:
      return { icon: "⚙️", label: t.name };
  }
}

function currentAction(messages: ChatMessage[]): { icon: string; label: string } {
  // Most recent assistant message → its latest tool that hasn't completed.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const inflight = [...m.tools].reverse().find((t) => t.ended_at == null);
    if (inflight) return describeTool(inflight);
    break;
  }
  return { icon: "✦", label: "Thinking" };
}

export default function LiveActivity({ messages }: { messages: ChatMessage[] }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const { icon, label } = currentAction(messages);

  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-ink-600 bg-ink-800/50 px-3 py-2 text-xs">
      <span className="flex items-center gap-1" aria-hidden>
        {[0, 150, 300].map((d) => (
          <span
            key={d}
            className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-accent"
            style={{ animationDelay: `${d}ms` }}
          />
        ))}
      </span>
      <span className="min-w-0 truncate text-zinc-200">
        <span className="mr-1">{icon}</span>
        {label}
        <span className="text-zinc-500">…</span>
      </span>
      <span className="ml-auto flex-none font-mono tabular-nums text-zinc-500">{secs}s</span>
    </div>
  );
}

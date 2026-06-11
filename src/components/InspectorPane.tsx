import { useStore } from "../lib/store";

/**
 * Right-hand inspector. Shows the most recently selected tool run plus the
 * session metadata. Wider tool inspection (files, processes, raw events) is
 * scaffolded here and grown in M5.
 */
export default function InspectorPane() {
  const messages = useStore((s) => s.messages);
  const selectedId = useStore((s) => s.selectedToolRunId);
  const session = useStore((s) => s.session);
  const lastOutcome = useStore((s) => s.lastOutcome);
  const toggleInspector = useStore((s) => s.toggleInspector);

  const run = (() => {
    if (!selectedId) return null;
    for (const m of messages) {
      const r = m.tools.find((t) => t.tool_use_id === selectedId);
      if (r) return r;
    }
    return null;
  })();

  return (
    <aside className="fixed inset-0 z-40 w-full bg-ink-900 md:static md:z-auto md:w-[360px] md:bg-ink-800/40 border-l border-ink-600 flex flex-col text-xs font-mono">
      <div className="px-3 py-2 border-b border-ink-600 text-zinc-300 font-semibold uppercase tracking-wider text-[10px] flex items-center justify-between">
        <span>inspector</span>
        <button
          onClick={toggleInspector}
          title="Close inspector"
          className="rounded border border-ink-500 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-ink-600/40 md:hidden"
        >
          ✕ close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <Section title="session">
          <KV k="local id" v={session.id.slice(0, 12) + "…"} />
          <KV k="claude id" v={session.claude_session_id ?? "—"} />
          <KV k="messages" v={String(messages.length)} />
        </Section>

        {lastOutcome && (
          <Section title="last outcome">
            <KV
              k="result"
              v={lastOutcome.is_error ? "error" : (lastOutcome.terminal_reason ?? "ok")}
            />
            <KV k="turns" v={String(lastOutcome.num_turns ?? "—")} />
            <KV
              k="cost"
              v={
                lastOutcome.total_cost_usd != null
                  ? `$${lastOutcome.total_cost_usd.toFixed(4)}`
                  : "—"
              }
            />
          </Section>
        )}

        {run ? (
          <Section title={`tool: ${run.name}`}>
            <KV k="tool_use_id" v={run.tool_use_id} />
            <KV k="status" v={run.ended_at ? (run.is_error ? "error" : "ok") : "running"} />
            <div className="mt-2 text-[10px] uppercase text-zinc-500 mb-1">input</div>
            <pre className="bg-ink-900/60 rounded p-2 overflow-x-auto text-zinc-200 whitespace-pre-wrap text-[11px]">
              {pretty(run.input)}
            </pre>
            {run.ended_at && (
              <>
                <div className="mt-2 text-[10px] uppercase text-zinc-500 mb-1">
                  {run.is_error ? "error" : "output"}
                </div>
                <pre className="bg-ink-900/60 rounded p-2 overflow-x-auto text-zinc-200 whitespace-pre-wrap text-[11px]">
                  {pretty(run.output)}
                </pre>
              </>
            )}
          </Section>
        ) : (
          <div className="text-zinc-500 italic px-1">
            Click a tool card to inspect it here.
          </div>
        )}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2 border-b border-ink-600 pb-1">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-zinc-500">{k}</span>
      <span className="text-zinc-200 truncate text-right" title={v}>{v}</span>
    </div>
  );
}

function pretty(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

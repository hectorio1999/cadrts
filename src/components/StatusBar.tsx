import { useStore } from "../lib/store";
import UpdateBadge from "./UpdateBadge";

export default function StatusBar() {
  const auth = useStore((s) => s.auth);
  const inspectorOpen = useStore((s) => s.inspectorOpen);
  const toggleInspector = useStore((s) => s.toggleInspector);
  const streaming = useStore((s) => s.streaming);
  const lastOutcome = useStore((s) => s.lastOutcome);

  return (
    <footer className="h-7 px-3 border-t border-ink-600 bg-ink-800/60 text-[11px] font-mono text-zinc-400 flex items-center gap-4">
      <div className="flex items-center gap-1.5">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            auth?.authenticated ? "bg-emerald-400" : "bg-red-400"
          }`}
        />
        <span>
          {auth?.authenticated
            ? `signed in · plan: ${auth.subscription_type ?? "unknown"}`
            : "not signed in"}
        </span>
      </div>
      <div className="opacity-50">|</div>
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${streaming ? "bg-accent pulse-dot" : "bg-zinc-600"}`} />
        <span>{streaming ? "agent active" : "idle"}</span>
      </div>
      {lastOutcome && (
        <>
          <div className="opacity-50">|</div>
          <span>
            last: {lastOutcome.num_turns ?? "?"} turns · $
            {lastOutcome.total_cost_usd?.toFixed(4) ?? "—"}
          </span>
        </>
      )}
      <div className="flex-1" />
      <UpdateBadge />
      <button
        onClick={toggleInspector}
        className="hover:text-zinc-200"
        title="Toggle inspector pane"
      >
        {inspectorOpen ? "hide inspector" : "show inspector"}
      </button>
    </footer>
  );
}

import { useStore } from "../lib/store";

/** Bottom-right transient notifications. Errors persist a little longer and
 *  can be dismissed; info/success auto-expire. Replaces the old pattern of
 *  dumping `String(e)` into red inline text. */
export default function ToastHost() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-12 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => {
        const tone =
          t.kind === "error"
            ? "border-red-500/50 bg-red-500/10 text-red-200"
            : t.kind === "success"
            ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200"
            : "border-ink-500 bg-ink-800 text-zinc-200";
        const icon = t.kind === "error" ? "⚠" : t.kind === "success" ? "✓" : "ℹ";
        return (
          <div
            key={t.id}
            className={`toast-in pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-xs shadow-lg shadow-black/40 ${tone}`}
          >
            <span className="flex-none">{icon}</span>
            <span className="min-w-0 flex-1 break-words">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="flex-none text-zinc-500 hover:text-zinc-200"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

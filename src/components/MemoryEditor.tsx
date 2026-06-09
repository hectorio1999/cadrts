import { useEffect, useState } from "react";
import { readMemory, writeMemory } from "../lib/ipc";

export default function MemoryEditor({ onClose }: { onClose: () => void }) {
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    readMemory()
      .then((t) => {
        if (alive) setBody(t);
      })
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      await writeMemory(body);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-ink-900/80 backdrop-blur-sm grid place-items-center z-50"
      onClick={onClose}
    >
      <div
        className="w-[720px] max-w-[90vw] h-[70vh] bg-ink-800 border border-ink-500 rounded-lg flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-ink-600 flex items-center justify-between">
          <div>
            <div className="font-semibold text-zinc-200">Memory</div>
            <div className="text-[11px] text-zinc-500 font-mono">
              Injected into every turn's system prompt. Keep it tight.
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 text-sm"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 min-h-0">
          {loading ? (
            <div className="h-full grid place-items-center text-zinc-500 text-sm">
              loading…
            </div>
          ) : (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              spellCheck={false}
              className="w-full h-full bg-ink-900 text-zinc-200 font-mono text-sm p-4 resize-none focus:outline-none leading-relaxed"
            />
          )}
        </div>
        {error && (
          <div className="px-4 py-2 text-xs text-red-400 border-t border-ink-600">{error}</div>
        )}
        <div className="px-4 py-3 border-t border-ink-600 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded border border-ink-500 hover:bg-ink-600/40"
          >
            cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving || loading}
            className="px-3 py-1.5 text-sm rounded bg-accent text-ink-900 font-semibold disabled:opacity-50"
          >
            {saving ? "saving…" : "save"}
          </button>
        </div>
      </div>
    </div>
  );
}

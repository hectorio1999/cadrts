import { useState } from "react";
import { authStatus } from "../lib/ipc";
import { setBearerToken } from "../lib/runtime";
import { useStore } from "../lib/store";

/**
 * Browser-mode sign-in.
 *
 * The agent-server is gated by a bearer token (`CAD_SERVER_TOKEN`). Paste
 * it once; we store it in `localStorage` under `cad-bearer` and use it on
 * every subsequent fetch + WS upgrade. There is no username; this is a
 * pre-shared secret model, same posture as the Tauri Settings → Remote
 * field.
 */
export default function WebLogin() {
  const setAuth = useStore((s) => s.setAuth);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const tok = token.trim();
    if (!tok) return;
    setBusy(true);
    try {
      setBearerToken(tok);
      const st = await authStatus();
      if (!st.authenticated) {
        setBearerToken(""); // clear bad token
        setError(st.reason ?? "Token rejected by the server.");
        setBusy(false);
        return;
      }
      setAuth(st);
    } catch (e) {
      setBearerToken("");
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <div className="h-full grid place-items-center bg-ink-900 text-zinc-200 font-mono">
      <form
        onSubmit={onSubmit}
        className="w-[440px] p-6 border border-ink-500 rounded-lg bg-ink-800/60"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-3 h-3 rounded-full bg-accent" />
          <div className="text-lg font-semibold">Claude Agent Desktop · web</div>
        </div>
        <div className="text-sm text-zinc-400 mb-4 leading-relaxed">
          Connecting to{" "}
          <span className="text-accent">{window.location.host}</span>. Paste
          the bearer token your agent-server is configured with
          (<code>CAD_SERVER_TOKEN</code> on the LXC). It's stored locally in
          this browser — no account, no cookies.
        </div>

        <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1">
          Bearer token
        </label>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          spellCheck={false}
          autoFocus
          placeholder="48+ characters"
          className="w-full bg-ink-900 border border-ink-500 rounded px-2 py-2 text-sm font-mono mb-3"
        />

        <button
          type="submit"
          disabled={busy || !token.trim()}
          className="w-full py-2 rounded bg-accent text-ink-900 font-semibold disabled:opacity-60"
        >
          {busy ? "verifying…" : "sign in"}
        </button>

        <div className="text-[11px] text-zinc-500 mt-3 leading-relaxed">
          The credentials your agent uses (your Claude Max session) live on
          the LXC itself. This bearer only authorises this browser to drive
          the server. To rotate it: edit{" "}
          <code>/etc/cad/server.env</code> on the LXC and restart the
          service.
        </div>

        {error && (
          <div className="text-xs text-red-400 mt-3 break-words">{error}</div>
        )}
      </form>
    </div>
  );
}

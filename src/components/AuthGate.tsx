import { useState } from "react";
import { authStatus, launchLogin } from "../lib/ipc";
import { useStore } from "../lib/store";

/**
 * Shown when `~/.claude/.credentials.json` is missing or unreadable.
 *
 * "Sign in with Claude" shells out to `claude login` in a new terminal
 * window; the CLI walks the user through OAuth (browser + device code).
 * We poll [`auth_status`] every second after that until the credential
 * file appears — no API key prompt, no token typing.
 */
export default function AuthGate() {
  const auth = useStore((s) => s.auth);
  const setAuth = useStore((s) => s.setAuth);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSignIn() {
    setError(null);
    setWorking(true);
    try {
      await launchLogin();
      // Poll once per second for up to 10 minutes.
      const start = Date.now();
      const id = setInterval(async () => {
        try {
          const s = await authStatus();
          setAuth(s);
          if (s.authenticated) {
            clearInterval(id);
            setWorking(false);
          } else if (Date.now() - start > 10 * 60_000) {
            clearInterval(id);
            setWorking(false);
            setError("Timed out waiting for sign-in.");
          }
        } catch (e) {
          /* keep trying */
        }
      }, 1000);
    } catch (e: any) {
      setWorking(false);
      setError(String(e?.message ?? e));
    }
  }

  return (
    <div className="h-full grid place-items-center bg-ink-900 text-zinc-200 font-mono">
      <div className="w-[420px] p-6 border border-ink-500 rounded-lg bg-ink-800/60">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-3 h-3 rounded-full bg-accent" />
          <div className="text-lg font-semibold">Claude Agent Desktop</div>
        </div>
        <div className="text-sm text-zinc-400 mb-4 leading-relaxed">
          This app drives the Claude Agent SDK against your{" "}
          <span className="text-accent">Max subscription</span>, not a
          pay-per-token API key. Sign in once with the Claude CLI and every
          turn from here on bills against your plan.
        </div>
        {auth?.reason && (
          <div className="text-xs text-zinc-500 mb-4 leading-relaxed">
            {auth.reason}
          </div>
        )}
        <button
          onClick={onSignIn}
          disabled={working}
          className="w-full py-2 rounded bg-accent text-ink-900 font-semibold disabled:opacity-60"
        >
          {working ? "waiting for sign-in…" : "Sign in with Claude"}
        </button>
        <div className="text-[11px] text-zinc-500 mt-3 leading-relaxed">
          A new console window will open running <code>claude login</code>.
          Complete the browser flow there. We'll detect the new session
          automatically.
        </div>
        {error && (
          <div className="text-xs text-red-400 mt-3">{error}</div>
        )}
      </div>
    </div>
  );
}

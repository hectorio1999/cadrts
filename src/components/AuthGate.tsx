import { useEffect, useRef, useState } from "react";
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
  const pollRef = useRef<number | null>(null);

  // Always clear the sign-in poll if the gate unmounts (e.g. auth flips from
  // another source) so we never leak a 1Hz interval.
  useEffect(() => {
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, []);

  async function onSignIn() {
    setError(null);
    setWorking(true);
    try {
      await launchLogin();
      // Poll once per second for up to 10 minutes.
      const start = Date.now();
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(async () => {
        try {
          const s = await authStatus();
          setAuth(s);
          if (s.authenticated) {
            if (pollRef.current !== null) window.clearInterval(pollRef.current);
            pollRef.current = null;
            setWorking(false);
          } else if (Date.now() - start > 10 * 60_000) {
            if (pollRef.current !== null) window.clearInterval(pollRef.current);
            pollRef.current = null;
            setWorking(false);
            setError("Timed out waiting for sign-in.");
          }
        } catch {
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
          Sign in with your{" "}
          <span className="text-accent">Claude account</span> and the app runs
          against your existing plan — no API key, no per-token charges. One
          quick OAuth sign-in and you're set.
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

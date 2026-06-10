import { useEffect, useState } from "react";
import {
  getChangelog,
  getVersion,
  type ChangelogResponse,
  type VersionInfo,
} from "../lib/ipc";
import { isTauri } from "../lib/runtime";

// Tauri updater glue. Lazy-loaded so the browser bundle never imports the
// `@tauri-apps/plugin-updater` chunk; the dynamic import is gated by
// `isTauri()` at call time.
async function tauriCheckAndInstall(
  onPhase: (s: string) => void,
): Promise<{ updated: boolean; error?: string }> {
  try {
    const [{ check }, processMod] = await Promise.all([
      import("@tauri-apps/plugin-updater"),
      import("@tauri-apps/plugin-process"),
    ]);
    onPhase("checking…");
    const update = await check();
    if (!update) {
      return { updated: false, error: "No update reported by the GitHub releases endpoint yet." };
    }
    onPhase(`downloading ${update.version}…`);
    let total = 0;
    let got = 0;
    await update.downloadAndInstall((ev) => {
      if (ev.event === "Started") total = ev.data.contentLength ?? 0;
      else if (ev.event === "Progress") {
        got += ev.data.chunkLength;
        if (total > 0) {
          onPhase(`downloading… ${Math.round((100 * got) / total)}%`);
        }
      } else if (ev.event === "Finished") {
        onPhase("installing…");
      }
    });
    onPhase("relaunching…");
    await processMod.relaunch();
    return { updated: true };
  } catch (e) {
    return { updated: false, error: String(e) };
  }
}

/**
 * Bottom-right floating "update available" badge.
 *
 * What it shows:
 *   - A pulsing accent dot when the server reports its source tree is
 *     ahead of its build commit (i.e. somebody pushed new code that the
 *     running server hasn't picked up yet).
 *   - Clicking opens a modal with the last 10 commits + how many more
 *     exist beyond what's listed, plus an "Update now" button.
 *
 * What "Update now" does:
 *   - Browser: hard-reloads the page. If the agent-server has redeployed,
 *     the new bundle is served immediately.
 *   - Tauri desktop: tells the user to restart the desktop binary. A real
 *     Tauri updater plugin (downloads a new binary) is a follow-up.
 *
 * Polling cadence: 60s. The /api/version endpoint is unauth'd so the badge
 * can come alive even before the user signs in (browser mode).
 */
export default function UpdateBadge() {
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [changelog, setChangelog] = useState<ChangelogResponse | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const v = await getVersion();
        if (!alive) return;
        setVersion(v);
      } catch {
        // ignore — server might still be booting; we'll retry
      }
    }
    tick();
    const id = setInterval(tick, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Pull the changelog when the badge becomes "active" or when the user opens it.
  useEffect(() => {
    if (!version) return;
    if (!version.update_available && !open) return;
    let alive = true;
    getChangelog()
      .then((c) => alive && setChangelog(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [version, open]);

  if (!version) return null;
  if (!version.update_available && !open) {
    // No badge when we're current. Keep DOM clean.
    return null;
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`${version.commits_ahead} change${version.commits_ahead === 1 ? "" : "s"} available — click to see what's new`}
        className="fixed bottom-10 right-4 z-40 flex items-center gap-2 rounded-full border border-accent/60 bg-ink-800 px-3 py-1.5 text-xs font-mono text-accent shadow-lg hover:bg-ink-700"
      >
        {version.commits_ahead > 0 && (
          <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-ink-900">
            +{version.commits_ahead}
          </span>
        )}
        <span>Update</span>
        <span className="h-2 w-2 rounded-full bg-accent pulse-dot" />
      </button>
      {open && (
        <UpdateModal
          version={version}
          changelog={changelog}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function UpdateModal({
  version,
  changelog,
  onClose,
}: {
  version: VersionInfo;
  changelog: ChangelogResponse | null;
  onClose: () => void;
}) {
  const tauri = isTauri();
  const commits = changelog?.commits ?? [];
  // "Extras" = how many more commits exist in the repo beyond the 10 we showed.
  const extras = changelog
    ? Math.max(0, changelog.commits_ahead_of_build - commits.length)
    : 0;

  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onUpdate() {
    if (!tauri) {
      window.location.reload();
      return;
    }
    setError(null);
    setPhase("checking…");
    const r = await tauriCheckAndInstall(setPhase);
    if (r.updated) {
      // Plugin already relaunched — control never reaches here.
      return;
    }
    setPhase(null);
    setError(
      r.error ??
        "No update available from the desktop updater feed yet. Server has new commits; the next signed release will come down automatically.",
    );
  }

  return (
    <div
      className="fixed inset-0 bg-ink-900/80 backdrop-blur-sm z-50 grid place-items-center"
      onClick={onClose}
    >
      <div
        className="w-[640px] max-w-[92vw] bg-ink-800 border border-ink-500 rounded-lg flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-ink-600 flex items-start justify-between">
          <div>
            <div className="font-semibold text-zinc-100">
              What's new{version.commits_ahead > 0 ? ` · +${version.commits_ahead}` : ""}
            </div>
            <div className="text-[11px] text-zinc-500 font-mono mt-0.5">
              running build{" "}
              <span className="text-zinc-300">
                {version.build_commit_short ?? "—"}
              </span>{" "}
              · source head{" "}
              <span className="text-zinc-300">
                {version.head_commit_short ?? "—"}
              </span>
              {version.commits_ahead > 0 && (
                <>
                  {" "}· <span className="text-accent">{version.commits_ahead} new</span>
                </>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 px-2"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto px-4 py-3">
          {changelog === null ? (
            <div className="py-6 text-center text-xs text-zinc-500 font-mono pulse-dot">
              loading…
            </div>
          ) : commits.length === 0 ? (
            <div className="py-6 text-center text-xs text-zinc-500 font-mono">
              No commit history available.
            </div>
          ) : (
            <ul className="space-y-2">
              {commits.map((c) => (
                <li
                  key={c.sha}
                  className="flex items-start gap-3 px-2 py-1.5 rounded hover:bg-ink-700/30"
                >
                  <span className="text-[10px] font-mono text-zinc-500 mt-0.5 shrink-0 w-14">
                    {c.short}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-zinc-100 truncate">
                      {c.subject}
                    </div>
                    <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                      {c.author} · {prettyDate(c.iso_date)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {extras > 0 && (
            <div className="text-xs text-zinc-500 italic px-2 mt-3">
              + {extras} more commit{extras === 1 ? "" : "s"} not shown
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-ink-600 flex items-center justify-between gap-2">
          <div className="text-[11px] text-zinc-500 leading-snug max-w-[60%]">
            {tauri ? (
              <>
                {phase ?? "Downloads + verifies the signed bundle from GitHub Releases, then relaunches."}
                {error && (
                  <div className="text-red-400 mt-1 break-words">{error}</div>
                )}
              </>
            ) : (
              <>
                Reload to pick up the latest web bundle. If the server still
                needs a redeploy on the LXC, the badge will stay until that
                lands.
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={Boolean(phase)}
              className="px-3 py-1.5 text-sm rounded border border-ink-500 hover:bg-ink-600/40 disabled:opacity-50"
            >
              Close
            </button>
            <button
              onClick={onUpdate}
              disabled={Boolean(phase)}
              className="px-3 py-1.5 text-sm rounded bg-accent text-ink-900 font-semibold disabled:opacity-50"
            >
              {phase ?? "Update"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function prettyDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

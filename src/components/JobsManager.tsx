// Scheduled Jobs manager. Lists the automations Atlas runs on a schedule
// (created from chat or here), with their next/last run, status, and history,
// plus pause/resume, run-now, and delete. Jobs live on the agent-server, so
// this is a Remote-mode feature; in Local mode the fetch fails and we explain.

import { useCallback, useEffect, useState } from "react";
import { deleteJob, jobRuns, listJobs, runJobNow, updateJob } from "../lib/ipc";
import type { CronRun, JobView } from "../lib/types";

function rel(ms?: number | null): string {
  if (!ms) return "—";
  const d = ms - Date.now();
  const abs = Math.abs(d);
  if (abs < 60_000) return "just now";
  const m = Math.round(abs / 60_000);
  const h = Math.round(abs / 3_600_000);
  const day = Math.round(abs / 86_400_000);
  const s = m < 60 ? `${m}m` : h < 48 ? `${h}h` : `${day}d`;
  return d >= 0 ? `in ${s}` : `${s} ago`;
}

function fmt(ms?: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export default function JobsManager({ onClose }: { onClose: () => void }) {
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, CronRun[]>>({});

  const load = useCallback(async () => {
    try {
      setError(null);
      setJobs(await listJobs());
    } catch (e) {
      setError(String(e));
      setJobs([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, fn: () => Promise<void>) {
    setBusy(id);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function toggleRuns(id: string) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!runs[id]) {
      try {
        const r = await jobRuns(id, 20);
        setRuns((m) => ({ ...m, [id]: r }));
      } catch {
        /* leave empty */
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-[760px] max-w-[94vw] flex-col rounded-lg border border-ink-500 bg-ink-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-600 px-4 py-3">
          <div>
            <div className="font-semibold text-zinc-100">Scheduled Jobs</div>
            <div className="font-mono text-[11px] text-zinc-500">
              Automations Atlas runs on a schedule. Ask Atlas to scan, monitor, or summarize something and it'll offer to schedule it.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void load()} className="rounded border border-ink-500 px-2 py-1 text-xs text-zinc-300 hover:bg-ink-600/40">
              ↻ refresh
            </button>
            <button onClick={onClose} className="px-2 text-zinc-400 hover:text-zinc-200">✕</button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
          {jobs === null ? (
            <div className="py-10 text-center font-mono text-xs text-zinc-500 pulse-dot">loading…</div>
          ) : error ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-amber-200/90">
              Couldn't load scheduled jobs. They run on the agent server, so this needs <b>Remote</b> mode.
              <div className="mt-1 break-words font-mono text-[11px] text-zinc-500">{error}</div>
            </div>
          ) : jobs.length === 0 ? (
            <div className="grid place-items-center py-12 text-center text-sm text-zinc-500">
              <div className="max-w-sm">
                <div className="mb-1 font-semibold text-zinc-300">No scheduled jobs yet.</div>
                Try asking Atlas something like <span className="text-accent">"scan my home lab"</span> or{" "}
                <span className="text-accent">"check this site every morning"</span> — when it's something worth
                repeating, Atlas will offer to schedule it.
              </div>
            </div>
          ) : (
            jobs.map((j) => {
              const lr = j.last_run;
              return (
                <div key={j.id} className="rounded-lg border border-ink-600 bg-ink-900/40">
                  <div className="flex items-start gap-3 p-3">
                    <span
                      title={j.enabled ? "active" : "paused"}
                      className={`mt-1 h-2 w-2 flex-none rounded-full ${j.enabled ? "bg-emerald-400" : "bg-zinc-600"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-zinc-100">{j.name}</span>
                        {!j.enabled && <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] text-zinc-400">paused</span>}
                      </div>
                      {j.description && <div className="truncate text-xs text-zinc-500">{j.description}</div>}
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-zinc-500">
                        <span>🗓 {j.schedule_human}</span>
                        <span>next: <span className="text-zinc-300">{j.enabled ? rel(j.next_run) : "—"}</span></span>
                        <span>
                          last:{" "}
                          {lr ? (
                            <span className={lr.ok ? "text-emerald-400" : "text-red-400"}>
                              {lr.ok ? "ok" : "failed"} {rel(lr.started_at)}
                            </span>
                          ) : (
                            <span className="text-zinc-600">never run</span>
                          )}
                        </span>
                        <span>notify: {j.notify}</span>
                      </div>
                    </div>
                    <div className="flex flex-none flex-col items-end gap-1">
                      <div className="flex gap-1">
                        <button
                          disabled={busy === j.id}
                          onClick={() => void act(j.id, () => updateJob(j.id, { enabled: !j.enabled }).then(() => {}))}
                          className="rounded border border-ink-500 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-ink-600/40 disabled:opacity-50"
                        >
                          {j.enabled ? "Pause" : "Resume"}
                        </button>
                        <button
                          disabled={busy === j.id}
                          onClick={() => void act(j.id, () => runJobNow(j.id))}
                          className="rounded border border-ink-500 px-2 py-0.5 text-[11px] text-accent hover:bg-ink-600/40 disabled:opacity-50"
                        >
                          Run now
                        </button>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => void toggleRuns(j.id)}
                          className="rounded px-2 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-200"
                        >
                          {expanded === j.id ? "Hide logs" : "Logs"}
                        </button>
                        <button
                          disabled={busy === j.id}
                          onClick={() => {
                            if (confirm(`Delete "${j.name}"? This stops the automation.`)) {
                              void act(j.id, () => deleteJob(j.id));
                            }
                          }}
                          className="rounded px-2 py-0.5 text-[11px] text-red-400/80 hover:text-red-300 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>

                  {expanded === j.id && (
                    <div className="border-t border-ink-700 bg-ink-900/60 px-3 py-2">
                      {!runs[j.id] ? (
                        <div className="py-3 text-center font-mono text-[11px] text-zinc-500 pulse-dot">loading runs…</div>
                      ) : runs[j.id].length === 0 ? (
                        <div className="py-3 text-center font-mono text-[11px] text-zinc-500">No runs yet.</div>
                      ) : (
                        <ul className="space-y-2">
                          {runs[j.id].map((r, i) => (
                            <li key={i} className="rounded border border-ink-700 bg-ink-800/40 p-2">
                              <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-500">
                                <span className={r.ok ? "text-emerald-400" : "text-red-400"}>{r.ok ? "● ok" : "● failed"}</span>
                                <span>{fmt(r.started_at)}</span>
                                <span>· {r.trigger}</span>
                                {r.changed && <span className="text-accent">· notable</span>}
                                {typeof r.cost === "number" && <span>· ${r.cost.toFixed(3)}</span>}
                              </div>
                              {r.error ? (
                                <div className="mt-1 whitespace-pre-wrap break-words text-[11px] text-red-300/90">{r.error}</div>
                              ) : (
                                <div className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[11px] text-zinc-300">
                                  {r.summary || <span className="text-zinc-600">(no output)</span>}
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

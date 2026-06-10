import { useEffect, useState } from "react";
import { getConfig, setConfig, testRemoteConnection } from "../lib/ipc";
import type { TransportMode } from "../lib/types";
import { useStore } from "../lib/store";
import { ALL_TOOLS, PERMISSION_MODES, MODELS } from "../lib/prefs";

type Mode = "local" | "remote";
type Probe = { state: "idle" | "running" | "ok" | "err"; message?: string };

/**
 * Settings modal — the Local ↔ Remote toggle.
 *
 * Persisted to `~/.claude-agent-desktop/config.json` and applied live:
 * `set_config` swaps the live transport without an app restart, so the
 * very next message you send goes through the new path.
 */
export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("local");
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [probe, setProbe] = useState<Probe>({ state: "idle" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getConfig()
      .then((cfg) => {
        if (!alive) return;
        if (cfg.transport.mode === "remote") {
          setMode("remote");
          setBaseUrl(cfg.transport.base_url);
          setToken(cfg.transport.token);
        } else {
          setMode("local");
        }
      })
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  async function onTest() {
    setProbe({ state: "running" });
    try {
      const r = await testRemoteConnection(baseUrl.trim(), token.trim());
      if (r.ok) setProbe({ state: "ok" });
      else setProbe({ state: "err", message: r.error ?? "unknown error" });
    } catch (e) {
      setProbe({ state: "err", message: String(e) });
    }
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      const transport: TransportMode =
        mode === "local"
          ? { mode: "local" }
          : { mode: "remote", base_url: baseUrl.trim(), token: token.trim() };
      await setConfig({ transport });
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
        className="flex max-h-[88vh] w-[620px] max-w-[92vw] flex-col rounded-lg border border-ink-500 bg-ink-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-ink-600 flex items-center justify-between">
          <div>
            <div className="font-semibold text-zinc-200">Settings</div>
            <div className="text-[11px] text-zinc-500 font-mono">
              Transport and agent defaults. Changes apply to your next message.
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 text-sm px-2"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <Choice
            current={mode}
            value="local"
            onSelect={() => setMode("local")}
            title="Local"
            blurb="Spawn claude.exe on this machine. Auth lives in ~/.claude/.credentials.json on the local user."
          />
          <Choice
            current={mode}
            value="remote"
            onSelect={() => setMode("remote")}
            title="Remote agent-server"
            blurb="Send each turn to an agent-server (e.g. LXC on Proxmox). Your local credentials are uploaded per turn and never persisted server-side."
          />

          {mode === "remote" && (
            <div className="mt-2 space-y-3 border border-ink-500 rounded p-3 bg-ink-700/30">
              <Field
                label="Server URL"
                hint="e.g. http://10.0.0.x:9120 or https://agent.rosariotechsolutions.com"
              >
                <input
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value);
                    setProbe({ state: "idle" });
                  }}
                  spellCheck={false}
                  placeholder="https://agent.rosariotechsolutions.com"
                  className="w-full bg-ink-900 border border-ink-500 rounded px-2 py-1.5 text-sm font-mono"
                />
              </Field>
              <Field
                label="Bearer token"
                hint="Matches CAD_SERVER_TOKEN on the server. NOT a Claude API key."
              >
                <input
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    setProbe({ state: "idle" });
                  }}
                  spellCheck={false}
                  type="password"
                  placeholder="long random string"
                  className="w-full bg-ink-900 border border-ink-500 rounded px-2 py-1.5 text-sm font-mono"
                />
              </Field>
              <div className="flex items-center gap-3">
                <button
                  onClick={onTest}
                  disabled={!baseUrl.trim() || !token.trim() || probe.state === "running"}
                  className="px-3 py-1.5 text-xs rounded border border-ink-500 hover:bg-ink-600/40 disabled:opacity-50"
                >
                  {probe.state === "running" ? "testing…" : "test connection"}
                </button>
                <ProbeBadge probe={probe} />
              </div>
            </div>
          )}

          <AgentPrefsSection />
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
            disabled={saving || (mode === "remote" && (!baseUrl.trim() || !token.trim()))}
            className="px-3 py-1.5 text-sm rounded bg-accent text-ink-900 font-semibold disabled:opacity-50"
          >
            {saving ? "saving…" : "save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AgentPrefsSection() {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);

  function toggleTool(tool: string) {
    const has = prefs.allowedTools.includes(tool);
    const allowedTools = has
      ? prefs.allowedTools.filter((t) => t !== tool)
      : [...prefs.allowedTools, tool];
    setPrefs({ allowedTools });
  }

  return (
    <div className="space-y-3 border-t border-ink-600 pt-4">
      <div>
        <div className="text-sm font-semibold text-zinc-200">Agent defaults</div>
        <div className="font-mono text-[11px] text-zinc-500">
          Applied to every turn. The permission mode is your main safety control.
        </div>
      </div>

      <Field label="Model" hint="Applied to every turn. Switch per-task from the composer too.">
        <div className="flex flex-wrap items-center gap-1.5">
          {MODELS.map((m) => {
            const active = prefs.model === m.value;
            return (
              <button
                key={m.value || "default"}
                onClick={() => setPrefs({ model: m.value })}
                title={m.hint}
                className={`rounded border px-2 py-1 text-xs ${
                  active ? "border-accent/60 bg-accent/5 text-zinc-100" : "border-ink-500 text-zinc-400 hover:bg-ink-600/30"
                }`}
              >
                {m.label}
              </button>
            );
          })}
          <input
            value={MODELS.some((m) => m.value === prefs.model) ? "" : prefs.model}
            onChange={(e) => setPrefs({ model: e.target.value.trim() })}
            placeholder="or full model id…"
            spellCheck={false}
            className="flex-1 min-w-[140px] rounded border border-ink-500 bg-ink-900 px-2 py-1 text-xs font-mono"
          />
        </div>
      </Field>

      <Field label="Permission mode" hint={modeHint(prefs.permissionMode)}>
        <div className="grid grid-cols-2 gap-2">
          {PERMISSION_MODES.map((m) => {
            const active = prefs.permissionMode === m.value;
            return (
              <button
                key={m.value}
                onClick={() => setPrefs({ permissionMode: m.value })}
                className={`rounded border px-2 py-1.5 text-left text-xs ${
                  active ? "border-accent/60 bg-accent/5" : "border-ink-500 hover:bg-ink-600/30"
                }`}
              >
                <div className="font-semibold text-zinc-200">{m.label}</div>
                <div className="mt-0.5 text-[10px] leading-snug text-zinc-500">{m.hint}</div>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Allowed tools" hint="Tools the agent may call. Unchecked tools are withheld.">
        <div className="flex flex-wrap gap-1.5">
          {ALL_TOOLS.map((tool) => {
            const on = prefs.allowedTools.includes(tool);
            return (
              <button
                key={tool}
                onClick={() => toggleTool(tool)}
                className={`rounded border px-2 py-0.5 text-[11px] font-mono ${
                  on
                    ? "border-accent/50 bg-accent/10 text-accent"
                    : "border-ink-500 text-zinc-500 hover:bg-ink-600/30"
                }`}
              >
                {on ? "✓ " : ""}
                {tool}
              </button>
            );
          })}
        </div>
      </Field>
    </div>
  );
}

function modeHint(mode: string): string {
  return PERMISSION_MODES.find((m) => m.value === mode)?.hint ?? "";
}

function Choice(props: {
  current: Mode;
  value: Mode;
  onSelect: () => void;
  title: string;
  blurb: string;
}) {
  const active = props.current === props.value;
  return (
    <button
      onClick={props.onSelect}
      className={`w-full text-left p-3 rounded border ${
        active ? "border-accent/60 bg-accent/5" : "border-ink-500 hover:bg-ink-600/30"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-2.5 h-2.5 rounded-full ${active ? "bg-accent" : "bg-zinc-600"}`}
        />
        <span className="text-zinc-100 font-semibold text-sm">{props.title}</span>
      </div>
      <div className="text-xs text-zinc-500 mt-1 leading-relaxed">{props.blurb}</div>
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] text-zinc-300 mb-1">{label}</div>
      {children}
      <div className="text-[10px] text-zinc-500 mt-0.5">{hint}</div>
    </div>
  );
}

function ProbeBadge({ probe }: { probe: Probe }) {
  if (probe.state === "idle") return null;
  if (probe.state === "running")
    return <span className="text-xs text-zinc-500 pulse-dot">probing…</span>;
  if (probe.state === "ok")
    return <span className="text-xs text-emerald-400">connection ok</span>;
  return (
    <span className="text-xs text-red-400 truncate" title={probe.message}>
      {probe.message ?? "failed"}
    </span>
  );
}

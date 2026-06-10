import { useEffect, useState } from "react";
import AuthGate from "./components/AuthGate";
import ChatPane from "./components/ChatPane";
import CommandPalette from "./components/CommandPalette";
import InspectorPane from "./components/InspectorPane";
import JobsManager from "./components/JobsManager";
import MemoryEditor from "./components/MemoryEditor";
import SessionSidebar from "./components/SessionSidebar";
import SettingsModal from "./components/SettingsModal";
import SkillsManager from "./components/SkillsManager";
import StatusBar from "./components/StatusBar";
import ToastHost from "./components/ToastHost";
import UpdateBadge from "./components/UpdateBadge";
import WebLogin from "./components/WebLogin";
import { authStatus, getConfig, migrateLocalHistoryToServer, testRemoteConnection } from "./lib/ipc";
import { isTauri } from "./lib/runtime";
import { useStore } from "./lib/store";
import type { AuthStatus } from "./lib/types";

export default function App() {
  const setAuth = useStore((s) => s.setAuth);
  const auth = useStore((s) => s.auth);
  const inspectorOpen = useStore((s) => s.inspectorOpen);
  const refreshSessions = useStore((s) => s.refreshSessions);
  const theme = useStore((s) => s.prefs.theme);

  // Apply the selected color theme to <html data-theme>.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme || "dark");
  }, [theme]);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Global Cmd/Ctrl+K
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Boot/poll the right gate based on the configured transport.
  //
  // - **Local** (or browser): keep the historical behaviour — read
  //   `~/.claude/.credentials.json` via the `auth_status` Tauri command (or
  //   probe the server in the browser bundle). The local file is the
  //   credential the spawned `claude` will actually use, so it must exist.
  //
  // - **Remote**: the server has its own credentials in `/home/<user>/.claude/`
  //   on the LXC; this client machine doesn't need any Claude session of
  //   its own. Skip the local file check entirely and just probe the
  //   server with the configured bearer token. Fixes the "stub credentials
  //   file" workaround that the Mac install needed.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const cfg = await getConfig();
        if (cfg.transport.mode === "remote") {
          const probe = await testRemoteConnection(cfg.transport.base_url, cfg.transport.token);
          const synthesized: AuthStatus = {
            authenticated: probe.ok,
            subscription_type: probe.ok ? "remote" : null,
            expires_at: null,
            scopes: null,
            credential_path: null,
            reason: probe.error,
          };
          if (alive) setAuth(synthesized);
          return;
        }
        const s = await authStatus();
        if (alive) setAuth(s);
      } catch {
        // Backend not ready yet; keep trying.
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [setAuth]);

  // Pull session list once the auth gate clears.
  useEffect(() => {
    if (auth?.authenticated) void refreshSessions();
  }, [auth?.authenticated, refreshSessions]);

  // One-time: in the desktop app + Remote mode, push the local chat history up
  // to the server so it's unified with the web UI. Runs once (flag), and only
  // after a real remote attempt so a Local-mode launch doesn't burn the flag.
  useEffect(() => {
    if (!auth?.authenticated || !isTauri()) return;
    const KEY = "cad-history-migrated-v1";
    if (localStorage.getItem(KEY)) return;
    (async () => {
      try {
        const cfg = await getConfig();
        if (cfg.transport.mode !== "remote") return;
        const { migrated } = await migrateLocalHistoryToServer();
        localStorage.setItem(KEY, "1");
        if (migrated > 0) await refreshSessions();
      } catch {
        // leave the flag unset so it retries on the next launch
      }
    })();
  }, [auth?.authenticated, refreshSessions]);

  if (auth === null) {
    // Tauri commands haven't responded yet — show a quiet boot screen.
    return (
      <div className="h-full grid place-items-center bg-ink-900 text-zinc-500 text-sm font-mono">
        <span className="pulse-dot">booting agent core…</span>
      </div>
    );
  }

  if (!auth.authenticated) {
    // In browser, "authenticated" means the bearer token validates against
    // the server. In Tauri, it means a local Claude OAuth session exists.
    // Two different gates, same store flag.
    return isTauri() ? <AuthGate /> : <WebLogin />;
  }

  return (
    <div className="h-full flex flex-col bg-ink-900 text-zinc-200">
      <div className="flex-1 min-h-0 flex">
        <SessionSidebar
          onOpenMemory={() => setMemoryOpen(true)}
          onOpenSkills={() => setSkillsOpen(true)}
          onOpenJobs={() => setJobsOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <ChatPane />
        {inspectorOpen && <InspectorPane />}
      </div>
      <StatusBar />
      {memoryOpen && <MemoryEditor onClose={() => setMemoryOpen(false)} />}
      {skillsOpen && <SkillsManager onClose={() => setSkillsOpen(false)} />}
      {jobsOpen && <JobsManager onClose={() => setJobsOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenMemory={() => setMemoryOpen(true)}
        onOpenSkills={() => setSkillsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <UpdateBadge />
      <ToastHost />
    </div>
  );
}

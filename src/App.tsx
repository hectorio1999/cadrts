import { useEffect, useState } from "react";
import AuthGate from "./components/AuthGate";
import ChatPane from "./components/ChatPane";
import CommandPalette from "./components/CommandPalette";
import InspectorPane from "./components/InspectorPane";
import MemoryEditor from "./components/MemoryEditor";
import SessionSidebar from "./components/SessionSidebar";
import SettingsModal from "./components/SettingsModal";
import SkillsManager from "./components/SkillsManager";
import StatusBar from "./components/StatusBar";
import UpdateBadge from "./components/UpdateBadge";
import WebLogin from "./components/WebLogin";
import { authStatus } from "./lib/ipc";
import { isTauri } from "./lib/runtime";
import { useStore } from "./lib/store";

export default function App() {
  const setAuth = useStore((s) => s.setAuth);
  const auth = useStore((s) => s.auth);
  const inspectorOpen = useStore((s) => s.inspectorOpen);
  const refreshSessions = useStore((s) => s.refreshSessions);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
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

  // Poll auth status periodically — if the user signs in via the launched
  // `claude login` window, this picks it up without a page reload.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
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
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <ChatPane />
        {inspectorOpen && <InspectorPane />}
      </div>
      <StatusBar />
      {memoryOpen && <MemoryEditor onClose={() => setMemoryOpen(false)} />}
      {skillsOpen && <SkillsManager onClose={() => setSkillsOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenMemory={() => setMemoryOpen(true)}
        onOpenSkills={() => setSkillsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <UpdateBadge />
    </div>
  );
}

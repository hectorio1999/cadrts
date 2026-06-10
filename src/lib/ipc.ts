// Unified IPC surface. Detects Tauri vs browser at runtime and routes each
// call to the right backend without the component layer caring which.
//
// In Tauri the calls go through `@tauri-apps/api/core::invoke` and use a
// `Channel<T>` for streaming. In browser they hit the agent-server over
// fetch + native WebSocket. The function signatures are identical.

import type {
  AgentEventEnvelope,
  AuthStatus,
  ClientConfig,
  CronJob,
  CronRun,
  JobView,
  MessageRow,
  PersistMessage,
  RemoteHealth,
  SessionRow,
  Skill,
  StartTurnArgs,
  TurnOutcome,
} from "./types";
import { apiOrigin, getBearerToken, isTauri, wsOrigin } from "./runtime";

// ---------- shared types beyond the existing surface ----------

export type VersionInfo = {
  build_commit: string | null;
  build_commit_short: string | null;
  server_version: string;
  head_commit: string | null;
  head_commit_short: string | null;
  update_available: boolean;
  commits_ahead: number;
};

export type ChangelogEntry = {
  sha: string;
  short: string;
  subject: string;
  author: string;
  iso_date: string;
};

export type ChangelogResponse = {
  commits: ChangelogEntry[];
  commits_ahead_of_build: number;
  total_commits_in_range: number;
};

// ---------- thin lazy loader for the Tauri SDK (browser bundle must not import statically) ----------

type TauriCore = typeof import("@tauri-apps/api/core");
let _tauri: TauriCore | null = null;
async function tauri(): Promise<TauriCore> {
  if (_tauri) return _tauri;
  _tauri = await import("@tauri-apps/api/core");
  return _tauri;
}

// ---------- shared web helpers ----------

async function webApi<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getBearerToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${apiOrigin()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} → ${res.status} ${text}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json() as Promise<T>;
  return (await res.text()) as unknown as T;
}

// ===============================================================
// Tauri-mode and Browser-mode share the *same* exported function
// names + signatures. Each call dispatches once and routes.
// ===============================================================

export async function authStatus(): Promise<AuthStatus> {
  if (isTauri()) {
    const t = await tauri();
    return t.invoke<AuthStatus>("auth_status");
  }
  // In the browser, "auth" means "is the server reachable with my bearer".
  // Synthesize an AuthStatus from a /api/sessions probe.
  try {
    await webApi<unknown>("GET", "/api/sessions?limit=1");
    return {
      authenticated: true,
      subscription_type: "remote",
      expires_at: null,
      scopes: null,
      credential_path: null,
      reason: null,
    };
  } catch (e) {
    return {
      authenticated: false,
      subscription_type: null,
      expires_at: null,
      scopes: null,
      credential_path: null,
      reason: `server not reachable or token invalid: ${String(e).slice(0, 200)}`,
    };
  }
}

export async function launchLogin(): Promise<void> {
  if (isTauri()) {
    const t = await tauri();
    await t.invoke<void>("launch_login");
    return;
  }
  // No-op in browser — credential bootstrap happens via `claude login` on
  // the LXC itself; the browser only gates on the bearer.
}

export async function readMemory(): Promise<string> {
  if (isTauri()) {
    const t = await tauri();
    return t.invoke<string>("read_memory");
  }
  return webApi<string>("GET", "/api/memory");
}

export async function writeMemory(body: string): Promise<void> {
  if (isTauri()) {
    const t = await tauri();
    await t.invoke<void>("write_memory", { body });
    return;
  }
  const token = getBearerToken();
  const headers: Record<string, string> = {
    "Content-Type": "text/plain",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${apiOrigin()}/api/memory`, {
    method: "PUT",
    headers,
    body,
  });
  if (!res.ok) throw new Error(`PUT /api/memory → ${res.status}`);
}

export async function listSkills(): Promise<Skill[]> {
  if (isTauri()) {
    const t = await tauri();
    return t.invoke<Skill[]>("list_skills");
  }
  return webApi<Skill[]>("GET", "/api/skills");
}

export async function readSkill(path: string): Promise<string> {
  if (isTauri()) {
    const t = await tauri();
    return t.invoke<string>("read_skill", { path });
  }
  // In browser, `path` is actually treated as the skill name.
  const name = pathToSkillName(path);
  return webApi<string>("GET", `/api/skills/${encodeURIComponent(name)}`);
}

export async function writeSkill(path: string, body: string): Promise<void> {
  if (isTauri()) {
    const t = await tauri();
    await t.invoke<void>("write_skill", { path, body });
    return;
  }
  const name = pathToSkillName(path);
  const token = getBearerToken();
  const headers: Record<string, string> = { "Content-Type": "text/plain" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(
    `${apiOrigin()}/api/skills/${encodeURIComponent(name)}`,
    { method: "PUT", headers, body },
  );
  if (!res.ok) throw new Error(`PUT /api/skills → ${res.status}`);
}

function pathToSkillName(path: string): string {
  // The Tauri side passes absolute file paths; the browser API expects
  // just the skill stem. Strip dir + .md.
  const tail = path.split(/[\\/]/).pop() ?? path;
  return tail.replace(/\.md$/i, "");
}

// ---------- server HTTP (jobs + remote-mode session/state) ----------
// Talks to the agent-server directly over HTTP using the configured remote
// base_url (CORS is open + CSP is null, so the desktop webview can reach the
// LXC). Used for jobs (server-only) and for session ops in Remote mode.

/** Should this call hit the LOCAL Tauri DB? Only when we're the desktop app AND
 *  the transport is Local. In Remote mode (and always in the browser) we route
 *  to the configured server so history/state is unified across clients. */
async function useLocalDb(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return (await getConfig()).transport.mode === "local";
  } catch {
    return true; // be conservative — fall back to the local DB
  }
}

async function serverApi<T>(method: string, path: string, body?: unknown): Promise<T> {
  const cfg = await getConfig();
  const t = cfg.transport;
  const base = t.mode === "remote" ? t.base_url.replace(/\/$/, "") : apiOrigin();
  const token = t.mode === "remote" ? t.token : getBearerToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} → ${res.status} ${text}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json() as Promise<T>;
  return (await res.text()) as unknown as T;
}

export async function listJobs(): Promise<JobView[]> {
  const r = await serverApi<JobView[]>("GET", "/api/jobs");
  // Defensive: a misrouted request (e.g. Local mode hitting the SPA) could
  // return HTML; never let a non-array reach the UI's .map.
  if (!Array.isArray(r)) throw new Error("server did not return a job list (are you in Remote mode?)");
  return r;
}

export async function createJob(job: CronJob): Promise<CronJob> {
  return serverApi<CronJob>("POST", "/api/jobs", job);
}

export async function updateJob(id: string, patch: Partial<CronJob>): Promise<CronJob> {
  return serverApi<CronJob>("PATCH", `/api/jobs/${encodeURIComponent(id)}`, patch);
}

export async function deleteJob(id: string): Promise<void> {
  await serverApi<unknown>("DELETE", `/api/jobs/${encodeURIComponent(id)}`);
}

export async function runJobNow(id: string): Promise<void> {
  await serverApi<unknown>("POST", `/api/jobs/${encodeURIComponent(id)}/run`);
}

export async function jobRuns(id: string, limit = 50): Promise<CronRun[]> {
  const r = await serverApi<CronRun[]>("GET", `/api/jobs/${encodeURIComponent(id)}/runs?limit=${limit}`);
  return Array.isArray(r) ? r : [];
}

export async function cancelTurn(turnId: string): Promise<boolean> {
  if (isTauri()) {
    const t = await tauri();
    return t.invoke<boolean>("cancel_turn", { turnId });
  }
  await webApi<{ cancelled: boolean }>("DELETE", `/api/turns/${encodeURIComponent(turnId)}`);
  return true;
}

/**
 * Begin a turn and stream envelopes. In Tauri this uses a `Channel<T>`;
 * in browser this opens a WebSocket and translates frames into the same
 * envelope shape.
 */
export async function startTurn(
  args: StartTurnArgs,
  onEvent: (env: AgentEventEnvelope) => void,
): Promise<TurnOutcome> {
  if (isTauri()) {
    const t = await tauri();
    const channel = new t.Channel<AgentEventEnvelope>();
    channel.onmessage = onEvent;
    return t.invoke<TurnOutcome>("start_turn", { args, onEvent: channel });
  }
  return startTurnBrowser(args, onEvent);
}

async function startTurnBrowser(
  args: StartTurnArgs,
  onEvent: (env: AgentEventEnvelope) => void,
): Promise<TurnOutcome> {
  const token = getBearerToken();
  // 1. Start the turn — server registers it, returns the WS path.
  const start = await webApi<{ turn_id: string; ws_path: string }>(
    "POST",
    "/api/turns",
    {
      turn_id: args.turn_id,
      prompt: args.prompt,
      resume_session_id: args.resume_session_id ?? null,
      permission_mode: args.permission_mode ?? null,
      allowed_tools: args.allowed_tools ?? null,
      disallowed_tools: args.disallowed_tools ?? null,
      skill_directive: args.skill_directive ?? null,
      model: args.model ?? null,
      // cwd is a path on the *server's* filesystem in remote mode.
      cwd: args.cwd ?? null,
      // Browser has no filesystem access to a local credentials.json,
      // so we omit and let the server fall back to its own.
      credentials_json: null,
    },
  );

  // 2. Open WS with the bearer carried via the subprotocol mechanism.
  //    The server echoes "bearer" back; the token sits in the second slot.
  return new Promise<TurnOutcome>((resolve, reject) => {
    const url = `${wsOrigin()}${start.ws_path}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url, ["bearer", token]);
    } catch (e) {
      reject(e);
      return;
    }
    let finalOutcome: TurnOutcome | null = null;
    let lastError: string | null = null;

    ws.onmessage = (m) => {
      try {
        const env = JSON.parse(m.data) as AgentEventEnvelope;
        if (env.kind === "outcome") finalOutcome = env.outcome;
        if (env.kind === "error") lastError = env.message;
        onEvent(env);
      } catch (e) {
        console.warn("ws frame decode failed", e);
      }
    };
    ws.onerror = () => {
      if (!finalOutcome) lastError = lastError ?? "websocket error";
    };
    ws.onclose = () => {
      if (finalOutcome) {
        resolve(finalOutcome);
      } else {
        resolve({
          session_id: "",
          is_error: true,
          terminal_reason: lastError ?? "stream closed before outcome",
          total_cost_usd: null,
          final_text: null,
          num_turns: null,
        });
      }
    };
  });
}

// ---------- Persistence ----------

export async function persistSession(args: {
  session_id: string;
  title: string;
  claude_session_id: string | null;
  total_cost_delta: number;
  messages: PersistMessage[];
}): Promise<void> {
  if (await useLocalDb()) {
    const t = await tauri();
    await t.invoke<void>("persist_session", { args });
    return;
  }
  await serverApi<unknown>(
    "POST",
    `/api/sessions/${encodeURIComponent(args.session_id)}/persist`,
    args,
  );
}

export async function listSessions(limit?: number): Promise<SessionRow[]> {
  if (await useLocalDb()) {
    const t = await tauri();
    return t.invoke<SessionRow[]>("list_sessions", { limit: limit ?? null });
  }
  const q = limit != null ? `?limit=${limit}` : "";
  const r = await serverApi<SessionRow[]>("GET", `/api/sessions${q}`);
  return Array.isArray(r) ? r : [];
}

export async function loadMessages(sessionId: string): Promise<MessageRow[]> {
  if (await useLocalDb()) {
    const t = await tauri();
    return t.invoke<MessageRow[]>("load_messages", { sessionId });
  }
  return serverApi<MessageRow[]>(
    "GET",
    `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
}

export async function deleteSession(sessionId: string): Promise<void> {
  if (await useLocalDb()) {
    const t = await tauri();
    await t.invoke<void>("delete_session", { sessionId });
    return;
  }
  await serverApi<unknown>("DELETE", `/api/sessions/${encodeURIComponent(sessionId)}`);
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  if (await useLocalDb()) {
    const t = await tauri();
    await t.invoke<void>("rename_session", { sessionId, title });
    return;
  }
  await serverApi<unknown>("PATCH", `/api/sessions/${encodeURIComponent(sessionId)}`, { title });
}

export async function searchMessages(query: string, limit?: number): Promise<MessageRow[]> {
  if (await useLocalDb()) {
    const t = await tauri();
    return t.invoke<MessageRow[]>("search_messages", {
      query,
      limit: limit ?? null,
    });
  }
  const params = new URLSearchParams({ q: query });
  if (limit != null) params.set("limit", String(limit));
  return serverApi<MessageRow[]>("GET", `/api/search?${params.toString()}`);
}

/** One-time migration: push the desktop app's LOCAL chat history up to the
 *  server so it's unified with the web UI. Idempotent — skips sessions already
 *  on the server. Runs only in the desktop app while in Remote mode. */
export async function migrateLocalHistoryToServer(): Promise<{ migrated: number }> {
  if (!isTauri()) return { migrated: 0 };
  const cfg = await getConfig();
  if (cfg.transport.mode !== "remote") return { migrated: 0 };
  const t = await tauri();
  // Read straight from the LOCAL DB via the Tauri commands (which always use it).
  const local = await t.invoke<SessionRow[]>("list_sessions", { limit: 1000 });
  if (!local.length) return { migrated: 0 };
  const onServer = await serverApi<SessionRow[]>("GET", "/api/sessions?limit=1000").catch(() => []);
  const have = new Set((Array.isArray(onServer) ? onServer : []).map((s) => s.id));
  let migrated = 0;
  for (const s of local) {
    if (have.has(s.id)) continue;
    try {
      const msgs = await t.invoke<MessageRow[]>("load_messages", { sessionId: s.id });
      await serverApi<unknown>("POST", `/api/sessions/${encodeURIComponent(s.id)}/persist`, {
        session_id: s.id,
        title: s.title,
        claude_session_id: s.claude_session_id,
        total_cost_delta: s.total_cost,
        messages: msgs.map((m) => ({ idx: m.idx, role: m.role, content_json: m.content_json })),
      });
      migrated++;
    } catch (e) {
      console.warn("migrate session failed", s.id, e);
    }
  }
  return { migrated };
}

// ---------- Settings (Tauri-only — transport toggle is meaningless in browser) ----------

export async function getConfig(): Promise<ClientConfig> {
  if (isTauri()) {
    const t = await tauri();
    return t.invoke<ClientConfig>("get_config");
  }
  // Browser is always "remote, this server".
  return { transport: { mode: "remote", base_url: apiOrigin(), token: getBearerToken() } };
}

export async function setConfig(config: ClientConfig): Promise<void> {
  if (isTauri()) {
    const t = await tauri();
    await t.invoke<void>("set_config", { args: { config } });
    return;
  }
  // No-op in browser.
}

export async function testRemoteConnection(
  baseUrl: string,
  token: string,
): Promise<RemoteHealth> {
  if (isTauri()) {
    const t = await tauri();
    return t.invoke<RemoteHealth>("test_remote_connection", { baseUrl, token });
  }
  // In browser, probe directly.
  try {
    const r = await fetch(`${baseUrl}/api/health`, { method: "GET" });
    if (!r.ok) return { ok: false, error: `health ${r.status}` };
    // Also bearer-check.
    const r2 = await fetch(`${baseUrl}/api/sessions?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r2.ok) return { ok: false, error: `bearer rejected (${r2.status})` };
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ---------- New: version + changelog (used by UpdateBadge, both modes) ----------

export async function getVersion(): Promise<VersionInfo> {
  return webApi<VersionInfo>("GET", "/api/version");
}

export async function getChangelog(): Promise<ChangelogResponse> {
  return webApi<ChangelogResponse>("GET", "/api/changelog");
}

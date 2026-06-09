// TypeScript mirror of the Rust types in `crates/agent-core` and the
// Tauri command envelopes in `src-tauri/src/commands.rs`. Keep these in sync
// when the Rust schema changes.

export type AuthStatus = {
  authenticated: boolean;
  subscription_type: string | null;
  expires_at: number | null;
  scopes: string[] | null;
  credential_path: string | null;
  reason: string | null;
};

export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

export type StartTurnArgs = {
  turn_id: string;
  prompt: string;
  resume_session_id?: string | null;
  permission_mode?: PermissionMode | null;
  allowed_tools?: string[] | null;
  cwd?: string | null;
};

// --- Agent events (mirrors of `agent_core::agent::events`) ---

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "tool_use"; id: string; name: string; input: unknown; caller?: unknown }
  | { type: "tool_result"; tool_use_id: string; content?: unknown; is_error?: boolean | null }
  | { type: "unknown" };

export type AssistantMessage = {
  id?: string | null;
  model?: string | null;
  role?: string | null;
  stop_reason?: string | null;
  content?: ContentBlock[] | null;
  usage?: unknown;
};

export type AgentEvent =
  | {
      type: "system";
      subtype?: string | null;
      session_id?: string | null;
      cwd?: string | null;
      model?: string | null;
      permission_mode?: string | null;
      api_key_source?: string | null;
      tools?: string[] | null;
    }
  | {
      type: "assistant";
      session_id?: string | null;
      message?: AssistantMessage | null;
    }
  | {
      type: "user";
      session_id?: string | null;
      message?: { role?: string | null; content?: ContentBlock[] | null } | null;
    }
  | { type: "rate_limit_event"; rate_limit_info?: unknown }
  | {
      type: "result";
      subtype?: string | null;
      is_error?: boolean | null;
      session_id?: string | null;
      result?: string | null;
      total_cost_usd?: number | null;
      num_turns?: number | null;
      terminal_reason?: string | null;
    }
  | { type: "stream_event" }
  | { type: "other" };

export type TurnOutcome = {
  session_id: string;
  is_error: boolean;
  terminal_reason: string | null;
  total_cost_usd: number | null;
  final_text: string | null;
  num_turns: number | null;
};

export type AgentEventEnvelope =
  | { kind: "event"; turn_id: string; event: AgentEvent }
  | { kind: "error"; turn_id: string; message: string }
  | { kind: "outcome"; turn_id: string; outcome: TurnOutcome };

// --- Skills ---

export type SkillTrigger =
  | { kind: "always" }
  | { kind: "keyword"; keywords: string[] }
  | { kind: "manual" }
  | { kind: "never" };

export type Skill = {
  name: string;
  description: string | null;
  trigger: SkillTrigger;
  body: string;
  path: string;
};

// --- UI domain types (frontend-only) ---

export type ChatRole = "user" | "assistant" | "system";

export type ToolRun = {
  tool_use_id: string;
  name: string;
  input: unknown;
  output?: unknown;
  is_error?: boolean;
  started_at: number;
  ended_at?: number;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  // Accumulated visible text. Streaming appends here.
  text: string;
  // Tool runs surfaced inline in this assistant message.
  tools: ToolRun[];
  // Has the streaming finished for this message?
  done: boolean;
  ts: number;
};

export type Session = {
  id: string;
  title: string;
  claude_session_id: string | null;
  created_at: number;
  last_at: number;
};

// --- Transport config (mirror agent_core::config) ---

export type TransportMode =
  | { mode: "local" }
  | { mode: "remote"; base_url: string; token: string };

export type ClientConfig = {
  transport: TransportMode;
};

export type RemoteHealth = {
  ok: boolean;
  error: string | null;
};

// --- Persistence types (mirror agent_core::db) ---

export type SessionRow = {
  id: string;
  title: string;
  created_at: number;
  last_at: number;
  claude_session_id: string | null;
  total_cost: number;
  message_count: number;
};

export type MessageRow = {
  id: number;
  idx: number;
  ts: number;
  role: string;
  content_json: string;
};

export type PersistMessage = {
  idx: number;
  role: string;
  content_json: string;
};

/// Shape encoded into MessageRow.content_json.
export type PersistedContent = {
  text: string;
  tools?: ToolRun[];
};

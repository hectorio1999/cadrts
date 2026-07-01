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
  /** Tools to auto-approve (Claude Code `--allowed-tools`; an allow-list, not a restriction). */
  allowed_tools?: string[] | null;
  /** Tools to withhold entirely (Claude Code `--disallowed-tools`; the real restriction). */
  disallowed_tools?: string[] | null;
  /** Workflow directive prepended to the prompt the agent receives (kept out of the transcript). */
  skill_directive?: string | null;
  /** Model alias (opus/sonnet/haiku) or full id. null/empty = plan default. */
  model?: string | null;
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
      // Fine-grained token deltas (when --include-partial-messages is on).
      // The nested `event` is Anthropic's streaming event; we render text_delta.
      type: "stream_event";
      event?: {
        type?: string; // e.g. "content_block_delta"
        index?: number;
        delta?: { type?: string; text?: string }; // text_delta carries the token in `text`
      } | null;
    }
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
  | { kind: "auto" }
  | { kind: "keyword"; keywords: string[] }
  | { kind: "manual" }
  | { kind: "never" };

export type Skill = {
  name: string;
  description: string | null;
  when?: string | null;
  trigger: SkillTrigger;
  body: string;
  path: string;
};

// --- UI domain types (frontend-only) ---

export type ToastKind = "error" | "info" | "success";
export type Toast = { id: string; kind: ToastKind; message: string };

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
  // Image attachments on a user message — object URLs for live thumbnails.
  // Session-only (not persisted) to keep base64 out of SQLite.
  images?: string[];
  // Has the streaming finished for this message?
  done: boolean;
  // True once token deltas (stream_event/text_delta) have streamed into `text`,
  // so the duplicate final `assistant` text block is suppressed (RTS-113).
  streamed?: boolean;
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
  /** "desktop" | "telegram" | future platform tags. Optional so an older
   *  local binary that doesn't send it still type-checks. */
  source?: string;
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

// ---------- scheduled jobs (cron) ----------

export type CronJob = {
  id: string;
  name: string;
  description: string;
  schedule: string;
  timezone: string;
  prompt: string;
  permission_mode?: string | null;
  allowed_tools?: string[] | null;
  model?: string | null;
  cwd?: string | null;
  notify: string; // always | on_change | on_failure
  enabled: boolean;
  created_at: number;
  updated_at: number;
};

export type CronRun = {
  started_at: number;
  finished_at: number;
  ok: boolean;
  summary: string;
  cost?: number | null;
  error?: string | null;
  output_hash?: string | null;
  changed: boolean;
  trigger: string; // schedule | manual
};

/// What GET /api/jobs returns: a job plus computed display fields.
export type JobView = CronJob & {
  next_run: number | null;
  schedule_human: string;
  last_run: CronRun | null;
};

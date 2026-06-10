//! Agent transport abstraction.
//!
//! A transport is anything that, given a user prompt and optional resume
//! context, streams typed [`AgentEvent`]s back. Today we ship one
//! implementation: [`cli_transport::CliTransport`], which spawns the bundled
//! `claude.exe` from `@anthropic-ai/claude-code` in headless streaming JSON
//! mode and parses its events. The CLI itself handles OAuth refresh against
//! the user's Claude account via `~/.claude/.credentials.json`.
//!
//! A future `SdkTransport` (Node sidecar over `@anthropic-ai/claude-agent-sdk`)
//! drops in behind this same trait without any UI churn.

pub mod cli_transport;
pub mod events;
pub mod remote_transport;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

pub use events::*;

/// A single turn the user asks the agent to execute.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnRequest {
    /// The user's natural-language prompt for this turn.
    pub prompt: String,
    /// Resume an existing conversation by session id (None = new session).
    pub resume_session_id: Option<String>,
    /// Extra system-prompt content appended each turn (memory + skills).
    pub append_system_prompt: Option<String>,
    /// Permission mode. Defaults to `acceptEdits` if None.
    pub permission_mode: Option<PermissionMode>,
    /// Tools to pre-approve (Claude Code's `--allowed-tools` is an auto-approve
    /// allow-list, NOT a restriction). Auto-approved tools skip the permission
    /// prompt in `default`/`plan` modes.
    pub allowed_tools: Option<Vec<String>>,
    /// Tools to withhold entirely (Claude Code's `--disallowed-tools`). This is
    /// the real restriction: a disallowed tool cannot run regardless of mode.
    #[serde(default)]
    pub disallowed_tools: Option<Vec<String>>,
    /// Optional workflow directive prepended to the prompt the agent receives.
    /// Kept separate from `prompt` so keyword-skill matching and the visible
    /// transcript see only the user's raw text.
    #[serde(default)]
    pub skill_directive: Option<String>,
    /// Model for this turn — an alias (`opus`/`sonnet`/`haiku`) or a full model
    /// id. `None`/empty = the plan default. Maps to the CLI `--model` flag.
    #[serde(default)]
    pub model: Option<String>,
    /// Working directory the agent runs in (defaults to user home).
    pub cwd: Option<String>,
    /// Raw bytes of the caller's `~/.claude/.credentials.json`.
    ///
    /// When `Some`, [`cli_transport::CliTransport`] writes these into a
    /// per-turn temp HOME directory and points the `claude` child at it
    /// via the `HOME` (Unix) / `USERPROFILE` (Windows) env vars. The temp
    /// dir is deleted as soon as the turn finishes — credentials never
    /// touch disk for longer than the turn's lifetime, and concurrent
    /// turns are fully isolated from each other.
    ///
    /// When `None`, the child inherits the server's own HOME (single-tenant
    /// local mode). The bring-your-own-credentials path is what makes the
    /// `agent-server` model a stateless, multi-tenant runner.
    pub credentials_json: Option<String>,
}

/// Maps onto Claude Code's `--permission-mode` flag.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionMode {
    Default,
    AcceptEdits,
    Plan,
    BypassPermissions,
}

impl PermissionMode {
    pub fn as_cli(&self) -> &'static str {
        match self {
            PermissionMode::Default => "default",
            PermissionMode::AcceptEdits => "acceptEdits",
            PermissionMode::Plan => "plan",
            PermissionMode::BypassPermissions => "bypassPermissions",
        }
    }
}

/// Handle returned by a transport — lets the caller cancel the in-flight turn.
pub struct TurnHandle {
    pub cancel: tokio::sync::oneshot::Sender<()>,
    pub events: mpsc::UnboundedReceiver<AgentEvent>,
    pub join: tokio::task::JoinHandle<Result<TurnOutcome>>,
}

/// Aggregate outcome reported once the `result` event arrives.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnOutcome {
    pub session_id: String,
    pub is_error: bool,
    pub terminal_reason: Option<String>,
    pub total_cost_usd: Option<f64>,
    pub final_text: Option<String>,
    pub num_turns: Option<u32>,
}

#[async_trait::async_trait]
pub trait AgentTransport: Send + Sync + 'static {
    /// Begin a turn. Returns a handle the caller can use to cancel and drain events.
    async fn start_turn(&self, req: TurnRequest) -> Result<TurnHandle>;
}

// We use the `async-trait` crate for object-safe async methods. Rust's native
// `async fn in trait` (stable since 1.75) isn't object-safe yet, and we want
// the option to swap `CliTransport` for an `SdkTransport` via `dyn`.

//! Tauri command surface exposed to the React frontend.
//!
//! Streaming model: `start_turn` takes a Tauri `Channel<AgentEventEnvelope>`.
//! Each parsed `AgentEvent` is wrapped with the turn_id and forwarded to the
//! frontend immediately. The handler returns when the turn finishes (or is
//! cancelled), giving the caller the final [`agent_core::agent::TurnOutcome`].
//!
//! Cancellation: a registry of `turn_id -> oneshot::Sender<()>` lets the UI
//! call `cancel_turn(turn_id)` from anywhere to kill the underlying child.

use agent_core::agent::cli_transport::CliTransport;
use agent_core::agent::remote_transport::{RemoteConfig, RemoteTransport};
use agent_core::agent::{
    AgentEvent, AgentTransport, PermissionMode, TurnOutcome, TurnRequest,
};
use agent_core::auth::{self, AuthStatus};
use agent_core::config::{self, ClientConfig, TransportMode};
use agent_core::db::{self, MessageRow, SessionRow};
use agent_core::memory::{self, Skill};
use agent_core::paths;
use agent_core::rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::{Mutex, RwLock};

pub struct AppState {
    /// The active transport. Held behind an RwLock so we can swap it
    /// at runtime when the user toggles Local ↔ Remote in Settings.
    pub transport: RwLock<Arc<dyn AgentTransport>>,
    pub current_mode: RwLock<TransportMode>,
    /// SQLite connection — single, behind an async mutex. Concurrent turns
    /// serialise on this; that's fine because writes happen at most once
    /// per turn and reads are millisecond-scale.
    pub db: Mutex<Connection>,
    /// Active turns we can cancel. Removed once the turn finishes.
    pub running: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
}

impl AppState {
    pub fn new() -> anyhow::Result<Self> {
        let db_path = paths::db_path()?;
        let conn = db::open(&db_path)?;
        let cfg = config::load();
        let transport = build_transport(&cfg.transport)?;
        Ok(Self {
            transport: RwLock::new(transport),
            current_mode: RwLock::new(cfg.transport),
            db: Mutex::new(conn),
            running: Mutex::new(HashMap::new()),
        })
    }
}

/// Build an `AgentTransport` for the given mode.
///
/// `Local` always succeeds if the CLI is installed. `Remote` instantiates a
/// `RemoteTransport` against the configured server; we don't probe the
/// connection here — that's `test_remote_connection`'s job — because we
/// don't want the app to fail to boot if the LXC is down.
fn build_transport(mode: &TransportMode) -> anyhow::Result<Arc<dyn AgentTransport>> {
    match mode {
        TransportMode::Local => match CliTransport::discover() {
            Ok(t) => Ok(Arc::new(t)),
            Err(e) => {
                // Don't fail boot just because the CLI isn't installed yet — the
                // app should still come up so the user sees sign-in/install help.
                // The next turn will surface a clear error if it's truly missing.
                tracing::warn!(error = ?e, "claude CLI not found at boot; deferring to turn time");
                Ok(Arc::new(CliTransport::unresolved()))
            }
        },
        TransportMode::Remote { base_url, token } => {
            let t = RemoteTransport::new(RemoteConfig {
                base_url: base_url.clone(),
                bearer_token: token.clone(),
                credentials_path: None,
            })?;
            Ok(Arc::new(t))
        }
    }
}

/// What the UI sends in. Mirrors `TurnRequest` but lets the frontend keep its
/// own optional turn_id (for correlating Channel events back to a chat row).
#[derive(Debug, Clone, Deserialize)]
pub struct StartTurnArgs {
    pub turn_id: String,
    pub prompt: String,
    pub resume_session_id: Option<String>,
    pub permission_mode: Option<PermissionMode>,
    pub allowed_tools: Option<Vec<String>>,
    #[serde(default)]
    pub disallowed_tools: Option<Vec<String>>,
    #[serde(default)]
    pub skill_directive: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    pub cwd: Option<String>,
}

/// Envelope wrapping each upstream event with the turn id it belongs to.
/// Two synthetic kinds are added on top of the underlying `AgentEvent`:
///   - `error`: transport-level failure (spawn, IO, etc.)
///   - `outcome`: terminal aggregate handed to the UI as the closing event
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentEventEnvelope {
    Event { turn_id: String, event: AgentEvent },
    Error { turn_id: String, message: String },
    Outcome { turn_id: String, outcome: TurnOutcome },
}

#[tauri::command]
pub fn auth_status() -> AuthStatus {
    auth::status()
}

#[tauri::command]
pub fn launch_login() -> Result<(), String> {
    // Always operate on the local CLI for sign-in. In Remote mode the user
    // still signs in on *their* machine — the resulting credentials are
    // what the desktop client uploads to the server with each turn.
    let local = CliTransport::discover().map_err(|e| e.to_string())?;
    let bin = local.binary().map_err(|e| e.to_string())?;
    auth::launch_login(&bin).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_memory() -> Result<String, String> {
    memory::read_memory().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_memory(body: String) -> Result<(), String> {
    let path = paths::memory_path().map_err(|e| e.to_string())?;
    std::fs::write(path, body).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_skills() -> Result<Vec<Skill>, String> {
    memory::list_skills().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_skill(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_skill(path: String, body: String) -> Result<(), String> {
    std::fs::write(path, body).map_err(|e| e.to_string())
}

/// Begin a turn. The Channel streams envelopes until an `outcome` envelope
/// is sent, then returns the same outcome to the awaiting caller.
#[tauri::command]
pub async fn start_turn(
    state: State<'_, AppState>,
    args: StartTurnArgs,
    on_event: Channel<AgentEventEnvelope>,
) -> Result<TurnOutcome, String> {
    // Keyword-skill matching runs against the user's raw text only — the
    // workflow directive (if any) is applied separately by the transport.
    let append = memory::build_system_append(&args.prompt).map_err(|e| e.to_string())?;
    let req = TurnRequest {
        prompt: args.prompt.clone(),
        resume_session_id: args.resume_session_id.clone(),
        append_system_prompt: append,
        permission_mode: args.permission_mode,
        allowed_tools: args.allowed_tools.clone(),
        disallowed_tools: args.disallowed_tools.clone(),
        skill_directive: args.skill_directive.clone(),
        model: args.model.clone(),
        cwd: args.cwd.clone(),
        // Local-mode: child inherits the user's HOME. The bring-your-own-creds
        // path is reserved for the agent-server runner.
        credentials_json: None,
    };

    // Lock the transport read-only — turns can run concurrently.
    let transport = state.transport.read().await.clone();
    let mut handle = transport
        .start_turn(req)
        .await
        .map_err(|e| e.to_string())?;

    {
        let mut g = state.running.lock().await;
        g.insert(args.turn_id.clone(), handle.cancel);
    }

    // Pump events to the frontend channel.
    let turn_id_pump = args.turn_id.clone();
    let channel_pump = on_event.clone();
    let pump = tokio::spawn(async move {
        while let Some(ev) = handle.events.recv().await {
            let _ = channel_pump.send(AgentEventEnvelope::Event {
                turn_id: turn_id_pump.clone(),
                event: ev,
            });
        }
    });

    // Await the transport task. join.await => Result<Result<TurnOutcome>>
    let outcome = match handle.join.await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => {
            let _ = on_event.send(AgentEventEnvelope::Error {
                turn_id: args.turn_id.clone(),
                message: e.to_string(),
            });
            let _ = pump.await;
            state.running.lock().await.remove(&args.turn_id);
            return Err(e.to_string());
        }
        Err(e) => {
            let _ = on_event.send(AgentEventEnvelope::Error {
                turn_id: args.turn_id.clone(),
                message: format!("agent task crashed: {e}"),
            });
            let _ = pump.await;
            state.running.lock().await.remove(&args.turn_id);
            return Err(e.to_string());
        }
    };

    let _ = pump.await;
    state.running.lock().await.remove(&args.turn_id);

    let _ = on_event.send(AgentEventEnvelope::Outcome {
        turn_id: args.turn_id.clone(),
        outcome: outcome.clone(),
    });

    Ok(outcome)
}

#[tauri::command]
pub async fn cancel_turn(
    state: State<'_, AppState>,
    turn_id: String,
) -> Result<bool, String> {
    let mut g = state.running.lock().await;
    if let Some(sender) = g.remove(&turn_id) {
        let _ = sender.send(());
        Ok(true)
    } else {
        Ok(false)
    }
}

// -------------------- Persistence commands (M3) --------------------

/// Snapshot of one chat row the frontend ships up after every turn.
/// `content_json` is the same payload `MessageItem` re-hydrates from on load.
#[derive(Debug, Deserialize)]
pub struct PersistMessage {
    pub idx: i64,
    pub role: String,
    pub content_json: String,
}

#[derive(Debug, Deserialize)]
pub struct PersistSessionArgs {
    pub session_id: String,
    pub title: String,
    pub claude_session_id: Option<String>,
    pub total_cost_delta: f64,
    pub messages: Vec<PersistMessage>,
}

#[tauri::command]
pub async fn persist_session(
    state: State<'_, AppState>,
    args: PersistSessionArgs,
) -> Result<(), String> {
    let mut g = state.db.lock().await;
    db::upsert_session(
        &g,
        &args.session_id,
        &args.title,
        args.claude_session_id.as_deref(),
        args.total_cost_delta,
    )
    .map_err(|e| e.to_string())?;
    let rows: Vec<(i64, String, String)> = args
        .messages
        .into_iter()
        .map(|m| (m.idx, m.role, m.content_json))
        .collect();
    db::replace_messages(&mut g, &args.session_id, &rows).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn list_sessions(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Vec<SessionRow>, String> {
    let g = state.db.lock().await;
    db::list_sessions(&g, limit.unwrap_or(200)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_messages(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<MessageRow>, String> {
    let g = state.db.lock().await;
    db::load_messages(&g, &session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let g = state.db.lock().await;
    db::delete_session(&g, &session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_session(
    state: State<'_, AppState>,
    session_id: String,
    title: String,
) -> Result<(), String> {
    let g = state.db.lock().await;
    db::rename_session(&g, &session_id, &title).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_messages(
    state: State<'_, AppState>,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<MessageRow>, String> {
    let g = state.db.lock().await;
    db::search(&g, &query, limit.unwrap_or(50)).map_err(|e| e.to_string())
}

// -------------------- Settings / transport mode (P4) --------------------

#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<ClientConfig, String> {
    let mode = state.current_mode.read().await.clone();
    Ok(ClientConfig { transport: mode })
}

#[derive(Debug, Deserialize)]
pub struct SetConfigArgs {
    pub config: ClientConfig,
}

/// Persist a new config and swap the live transport. If the new transport
/// fails to construct (e.g. CLI missing for Local, malformed URL for Remote)
/// the previous transport stays active and the error is returned.
#[tauri::command]
pub async fn set_config(
    state: State<'_, AppState>,
    args: SetConfigArgs,
) -> Result<(), String> {
    let new_transport = build_transport_local(&args.config.transport).map_err(|e| e.to_string())?;
    config::save(&args.config).map_err(|e| e.to_string())?;
    {
        let mut g = state.transport.write().await;
        *g = new_transport;
    }
    {
        let mut g = state.current_mode.write().await;
        *g = args.config.transport;
    }
    Ok(())
}

/// Shadow helper because `build_transport` is private to this file and not
/// in scope from within an async fn (#[tauri::command] is desugared by macro).
fn build_transport_local(
    mode: &TransportMode,
) -> anyhow::Result<Arc<dyn AgentTransport>> {
    build_transport(mode)
}

#[derive(Debug, Serialize)]
pub struct RemoteHealth {
    pub ok: bool,
    pub error: Option<String>,
}

/// Probes `<base>/api/health` with the supplied bearer. Used by the
/// Settings modal's "Test connection" button.
#[tauri::command]
pub async fn test_remote_connection(
    base_url: String,
    token: String,
) -> RemoteHealth {
    match RemoteTransport::new(RemoteConfig {
        base_url,
        bearer_token: token,
        credentials_path: None,
    }) {
        Ok(t) => match t.health().await {
            Ok(()) => RemoteHealth {
                ok: true,
                error: None,
            },
            Err(e) => RemoteHealth {
                ok: false,
                error: Some(e.to_string()),
            },
        },
        Err(e) => RemoteHealth {
            ok: false,
            error: Some(e.to_string()),
        },
    }
}

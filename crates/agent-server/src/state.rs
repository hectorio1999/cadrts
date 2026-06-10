//! Shared server state.
//!
//! - `transport`: the `CliTransport` reused across all requests; cheap to share.
//! - `db`: single async-mutex'd connection (writes are infrequent; reads are µs).
//! - `running`: per-turn cancellation handles, plus a broadcast sender so WS
//!   subscribers can attach AFTER a turn has started.

use agent_core::agent::cli_transport::CliTransport;
use agent_core::agent::AgentEvent;
use agent_core::db;
use agent_core::paths;
use agent_core::rusqlite::Connection;
use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, oneshot, Mutex};

/// One in-flight turn the server is driving.
pub struct ActiveTurn {
    /// Cancellation channel — `cancel_turn` removes and fires this.
    pub cancel: oneshot::Sender<()>,
    /// Broadcast of every event emitted by this turn so the WS endpoint
    /// (and, later, additional subscribers) can stream them.
    pub events: broadcast::Sender<TurnPump>,
}

/// What flows down a turn's broadcast channel.
#[derive(Debug, Clone)]
pub enum TurnPump {
    Event(AgentEvent),
    /// Sent exactly once when the turn completes. Carries the final outcome
    /// as serialised JSON to avoid a second clone of the structured type.
    Outcome(String),
    /// Transport-level error before / during the turn.
    Error(String),
}

/// A turn that finished recently. Retained briefly so a client whose WS dropped
/// during the turn can reconnect and still receive the final outcome/error
/// instead of seeing "turn not found".
pub struct CompletedTurn {
    /// The terminal frame — `TurnPump::Outcome(..)` or `TurnPump::Error(..)`.
    pub terminal: TurnPump,
    pub at: std::time::Instant,
}

pub struct ServerState {
    pub bearer_token: String,
    pub transport: Arc<CliTransport>,
    pub db: Mutex<Connection>,
    pub running: Mutex<HashMap<String, ActiveTurn>>,
    /// turn_id → its terminal frame, kept ~2 min for reconnecting clients.
    pub completed: Mutex<HashMap<String, CompletedTurn>>,
}

impl ServerState {
    pub async fn boot(bearer_token: String) -> Result<Self> {
        // Honor a server-specific data dir before falling back to the per-user one.
        if let Ok(custom) = std::env::var("CAD_HOME") {
            std::env::set_var("CLAUDE_AGENT_DESKTOP_HOME", custom);
        }
        paths::ensure_layout()?;
        let conn = db::open(&paths::db_path()?)?;
        let transport = Arc::new(CliTransport::discover()?);
        tracing::info!(
            home = %paths::app_home()?.display(),
            "server state ready"
        );
        Ok(Self {
            bearer_token,
            transport,
            db: Mutex::new(conn),
            running: Mutex::new(HashMap::new()),
            completed: Mutex::new(HashMap::new()),
        })
    }
}

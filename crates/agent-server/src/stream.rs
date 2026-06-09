//! WebSocket streaming.
//!
//! Wire format: each frame is one JSON envelope identical to the desktop
//! IPC `AgentEventEnvelope` (event / error / outcome). When the turn ends
//! the broadcast channel closes and we send a `close` and exit.

use crate::auth::Authed;
use crate::state::{ServerState, TurnPump};
use agent_core::agent::AgentEvent;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use serde::Serialize;
use serde_json::json;
use std::sync::Arc;
use tracing::{debug, warn};

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WireEnvelope {
    Event { turn_id: String, event: AgentEvent },
    Error { turn_id: String, message: String },
    Outcome { turn_id: String, outcome: serde_json::Value },
}

pub async fn ws_stream(
    auth: Authed,
    State(state): State<Arc<ServerState>>,
    Path(turn_id): Path<String>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let _ = auth;
    // Browser clients negotiate the bearer via Sec-WebSocket-Protocol;
    // the spec requires us to echo back exactly one of the offered
    // protocols (or none, which kills the connection). Echo "bearer"
    // when we see it — that's our agreed marker.
    let echo_bearer = headers
        .get("sec-websocket-protocol")
        .and_then(|v| v.to_str().ok())
        .map(|v| {
            v.split(',')
                .map(str::trim)
                .any(|x| x.eq_ignore_ascii_case("bearer"))
        })
        .unwrap_or(false);

    let upgrade = if echo_bearer {
        ws.protocols(["bearer"])
    } else {
        ws
    };
    upgrade.on_upgrade(move |socket| run(socket, state, turn_id))
}

async fn run(mut socket: WebSocket, state: Arc<ServerState>, turn_id: String) {
    // Subscribe to the turn's broadcast. If the turn is unknown (already
    // finished or never existed), send an error frame and close.
    let rx = {
        let g = state.running.lock().await;
        match g.get(&turn_id) {
            Some(active) => Some(active.events.subscribe()),
            None => None,
        }
    };

    let Some(mut rx) = rx else {
        let env = WireEnvelope::Error {
            turn_id: turn_id.clone(),
            message: "turn not found (already finished or never started)".into(),
        };
        if let Ok(j) = serde_json::to_string(&env) {
            let _ = socket.send(Message::Text(j)).await;
        }
        let _ = socket.send(Message::Close(None)).await;
        return;
    };

    debug!(%turn_id, "ws client attached to turn");

    // Idle keepalive — nginx and Cloudflare reap silent WS at 60s. Ping every 25s
    // (same pattern that fixed notd's reconnect loop).
    let mut ka = tokio::time::interval(std::time::Duration::from_secs(25));
    ka.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    ka.tick().await; // skip the immediate first tick

    loop {
        tokio::select! {
            biased;
            recv = rx.recv() => match recv {
                Ok(pump) => {
                    let env = match pump {
                        TurnPump::Event(ev) => WireEnvelope::Event { turn_id: turn_id.clone(), event: ev },
                        TurnPump::Outcome(json_str) => {
                            let outcome: serde_json::Value =
                                serde_json::from_str(&json_str).unwrap_or_else(|_| json!({}));
                            WireEnvelope::Outcome { turn_id: turn_id.clone(), outcome }
                        }
                        TurnPump::Error(msg) => {
                            WireEnvelope::Error { turn_id: turn_id.clone(), message: msg }
                        }
                    };
                    match serde_json::to_string(&env) {
                        Ok(s) => {
                            if socket.send(Message::Text(s)).await.is_err() {
                                break;
                            }
                        }
                        Err(e) => warn!(error = %e, "serialize envelope"),
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!(skipped = n, "WS subscriber lagged");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            },
            _ = ka.tick() => {
                if socket.send(Message::Ping(vec![])).await.is_err() {
                    break;
                }
            }
            // Allow the client to send pings or closes; we just drain.
            client = socket.recv() => match client {
                Some(Ok(Message::Close(_))) | None => break,
                Some(Err(_)) => break,
                _ => {}
            }
        }
    }
    debug!(%turn_id, "ws client disconnected");
}

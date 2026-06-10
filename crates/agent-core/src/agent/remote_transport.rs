//! `RemoteTransport` — talks to an `agent-server` over HTTP+WS.
//!
//! Lifecycle of one turn:
//!   1. Read the user's `~/.claude/.credentials.json` from disk
//!   2. POST it (with the prompt) to `<base>/api/turns` with Bearer auth
//!   3. Open a WS to `<base>/ws/stream/<turn_id>` to receive events
//!   4. Decode each frame as an `AgentEventEnvelope`-style JSON object
//!      and forward into the same mpsc channel `CliTransport` uses
//!   5. When the `outcome` frame arrives, emit a `TurnOutcome` and exit
//!
//! Cancellation: a oneshot stops the WS read loop and fires
//! `DELETE <base>/api/turns/<turn_id>` so the server kills its child.
//!
//! Auth: the credential file is uploaded with every turn; the server never
//! persists it. Bearer auth on the wire is the server's gate, not the
//! Claude account auth (which lives in `claudeAiOauth`).

use super::events::AgentEvent;
use super::{AgentTransport, TurnHandle, TurnOutcome, TurnRequest};
use anyhow::{anyhow, bail, Context, Result};
use futures_util::{SinkExt, StreamExt};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, info, warn};

#[derive(Debug, Clone)]
pub struct RemoteConfig {
    /// e.g. `https://agent.rosariotechsolutions.com`
    pub base_url: String,
    /// Server-side bearer (matches `CAD_SERVER_TOKEN` on the server).
    pub bearer_token: String,
    /// Reserved. v0.1 used this to override the per-turn upload path; v0.2+
    /// no longer reads or uploads credentials from the client, so this field
    /// is kept only for API stability and may be dropped in v0.3.
    #[allow(dead_code)]
    pub credentials_path: Option<PathBuf>,
}

pub struct RemoteTransport {
    cfg: RemoteConfig,
    http: reqwest::Client,
}

impl RemoteTransport {
    pub fn new(cfg: RemoteConfig) -> Result<Self> {
        let mut headers = HeaderMap::new();
        let mut bearer = HeaderValue::from_str(&format!("Bearer {}", cfg.bearer_token))
            .context("invalid bearer token (non-ASCII?)")?;
        bearer.set_sensitive(true);
        headers.insert(AUTHORIZATION, bearer);
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

        let http = reqwest::Client::builder()
            .default_headers(headers)
            .connect_timeout(Duration::from_secs(10))
            .build()
            .context("build reqwest client")?;
        Ok(Self { cfg, http })
    }

    /// GET /api/health on the configured base. Returns `Ok(())` on 200.
    pub async fn health(&self) -> Result<()> {
        let url = self.url("/api/health");
        let r = self.http.get(&url).send().await?;
        if !r.status().is_success() {
            bail!("/api/health returned {}", r.status());
        }
        Ok(())
    }

    fn url(&self, path: &str) -> String {
        let base = self.cfg.base_url.trim_end_matches('/');
        format!("{base}{path}")
    }

    fn ws_url(&self, path: &str) -> Result<String> {
        let base = self.cfg.base_url.trim_end_matches('/');
        let ws = base
            .replacen("https://", "wss://", 1)
            .replacen("http://", "ws://", 1);
        if ws == base {
            // No scheme rewrite happened — likely missing scheme.
            bail!("base_url must start with http:// or https:// — got {base}");
        }
        Ok(format!("{ws}{path}"))
    }

}

#[derive(Debug, Serialize)]
struct StartTurnBody<'a> {
    turn_id: &'a str,
    prompt: &'a str,
    resume_session_id: Option<&'a str>,
    permission_mode: Option<&'a str>,
    allowed_tools: Option<&'a [String]>,
    disallowed_tools: Option<&'a [String]>,
    skill_directive: Option<&'a str>,
    model: Option<&'a str>,
    cwd: Option<&'a str>,
    /// Omitted entirely. The server uses its own credentials file (see
    /// the multi-tenant story documented in `agent-server/src/api.rs`).
    /// This `Option<&'static str>` is always `None` so the field
    /// serialises as `null` (or is skipped if `serde(skip_serializing_if)`
    /// is added later) — keeps the wire schema explicit while making it
    /// clear we never carry a credential.
    credentials_json: Option<&'a str>,
}

#[derive(Debug, Deserialize)]
struct StartTurnResp {
    turn_id: String,
    ws_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum WireEnvelope {
    Event {
        #[allow(dead_code)]
        turn_id: String,
        event: AgentEvent,
    },
    Error {
        #[allow(dead_code)]
        turn_id: String,
        message: String,
    },
    Outcome {
        #[allow(dead_code)]
        turn_id: String,
        outcome: TurnOutcome,
    },
}

#[async_trait::async_trait]
impl AgentTransport for RemoteTransport {
    async fn start_turn(&self, req: TurnRequest) -> Result<TurnHandle> {
        // No credential read on the client side. The server holds the
        // Claude OAuth session; clients only need the bearer token that
        // gates server access. Removed for v0.2 — fixes the macOS Keychain
        // paper-cut and the multi-machine token-rotation issue (refresh
        // tokens get burned when multiple machines upload snapshots).

        // Mint a turn_id here — RemoteTransport's caller may not know about
        // them. CliTransport doesn't surface this because each child IS the turn.
        let turn_id = uuid::Uuid::new_v4().to_string();
        let perm = req.permission_mode.map(|p| p.as_cli());

        let body = StartTurnBody {
            turn_id: &turn_id,
            prompt: &req.prompt,
            resume_session_id: req.resume_session_id.as_deref(),
            permission_mode: perm,
            allowed_tools: req.allowed_tools.as_deref(),
            disallowed_tools: req.disallowed_tools.as_deref(),
            skill_directive: req.skill_directive.as_deref(),
            model: req.model.as_deref(),
            cwd: req.cwd.as_deref(),
            credentials_json: None,
        };

        let resp: StartTurnResp = self
            .http
            .post(self.url("/api/turns"))
            .json(&body)
            .send()
            .await
            .context("POST /api/turns")?
            .error_for_status()
            .context("server rejected POST /api/turns")?
            .json()
            .await
            .context("decode /api/turns response")?;
        debug!(turn_id = %resp.turn_id, ws_path = %resp.ws_path, "remote turn accepted");

        let ws_url = self.ws_url(&resp.ws_path)?;
        let bearer = format!("Bearer {}", self.cfg.bearer_token);

        // Build a tungstenite request with the Bearer header. axum reads
        // the same header on the upgrade as on the GET.
        let mut req_builder = tokio_tungstenite::tungstenite::client::IntoClientRequest::into_client_request(ws_url.as_str())
            .context("build WS request")?;
        req_builder
            .headers_mut()
            .insert("Authorization", bearer.parse().context("bearer header")?);

        let (ws_stream, _resp) = tokio_tungstenite::connect_async(req_builder)
            .await
            .context("WS connect")?;
        let (mut ws_tx, mut ws_rx) = ws_stream.split();

        let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
        let (event_tx, event_rx) = mpsc::unbounded_channel::<AgentEvent>();
        let event_tx_drive = event_tx.clone();
        let cfg = self.cfg.clone();
        let http = self.http.clone();
        let turn_id_drive = resp.turn_id.clone();
        // Kept for reconnects: the server retains a finished turn's outcome for
        // ~2 min, and keeps a running turn subscribable, so re-opening the WS to
        // the same turn recovers from a transient drop instead of going silent.
        let ws_url_re = ws_url.clone();
        let bearer_re = bearer.clone();

        let join = tokio::spawn(async move {
            let mut final_outcome: Option<TurnOutcome> = None;
            let mut last_text: Option<String> = None;
            let mut reconnects: u32 = 0;
            const MAX_RECONNECTS: u32 = 12;

            'session: loop {
                let mut got_outcome_this_conn = false;
                loop {
                    tokio::select! {
                        biased;
                        _ = &mut cancel_rx => {
                            info!(turn_id = %turn_id_drive, "remote cancel requested — DELETE /api/turns/:id");
                            let base = cfg.base_url.trim_end_matches('/');
                            let _ = http
                                .delete(format!("{base}/api/turns/{turn_id_drive}"))
                                .send()
                                .await;
                            let _ = ws_tx.send(Message::Close(None)).await;
                            return Ok(TurnOutcome {
                                session_id: final_outcome.as_ref().map(|o| o.session_id.clone()).unwrap_or_default(),
                                is_error: true,
                                terminal_reason: Some("cancelled".into()),
                                total_cost_usd: None,
                                final_text: last_text,
                                num_turns: None,
                            });
                        }
                        msg = ws_rx.next() => match msg {
                            Some(Ok(Message::Text(t))) => {
                                match serde_json::from_str::<WireEnvelope>(&t) {
                                    Ok(WireEnvelope::Event { event, .. }) => {
                                        if let AgentEvent::Assistant(a) = &event {
                                            if let Some(m) = &a.message {
                                                if let Some(content) = &m.content {
                                                    for b in content {
                                                        if let super::events::ContentBlock::Text { text } = b {
                                                            last_text = Some(text.clone());
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                        let _ = event_tx_drive.send(event);
                                    }
                                    Ok(WireEnvelope::Error { message, .. }) => {
                                        warn!(message, "server-side turn error");
                                        return Err(anyhow!("server: {message}"));
                                    }
                                    Ok(WireEnvelope::Outcome { outcome, .. }) => {
                                        final_outcome = Some(outcome);
                                        got_outcome_this_conn = true;
                                    }
                                    Err(e) => warn!(error = %e, "could not decode WS frame"),
                                }
                            }
                            Some(Ok(Message::Ping(p))) => {
                                let _ = ws_tx.send(Message::Pong(p)).await;
                            }
                            Some(Ok(Message::Close(_))) | None => break,
                            Some(Ok(_)) => {}
                            Some(Err(e)) => {
                                warn!(error = %e, "WS read error");
                                break;
                            }
                        }
                    }
                }

                // Connection ended. If we already have the outcome, we're done.
                if final_outcome.is_some() || got_outcome_this_conn {
                    break 'session;
                }
                // Unexpected drop before the outcome — reconnect to the same turn.
                if reconnects >= MAX_RECONNECTS {
                    warn!(turn_id = %turn_id_drive, "gave up reconnecting to turn");
                    break 'session;
                }
                reconnects += 1;
                tokio::time::sleep(Duration::from_millis(1500)).await;
                let reconnect = async {
                    let mut rb = tokio_tungstenite::tungstenite::client::IntoClientRequest::into_client_request(
                        ws_url_re.as_str(),
                    )?;
                    rb.headers_mut().insert("Authorization", bearer_re.parse()?);
                    let (ws, _r) = tokio_tungstenite::connect_async(rb).await?;
                    anyhow::Ok(ws.split())
                }
                .await;
                match reconnect {
                    Ok((tx, rx)) => {
                        ws_tx = tx;
                        ws_rx = rx;
                        info!(turn_id = %turn_id_drive, reconnects, "WS reconnected to in-flight turn");
                    }
                    Err(e) => {
                        // Couldn't reconnect this round; the next loop iteration
                        // will hit the dead socket, break, and retry (bounded).
                        warn!(error = %e, "WS reconnect attempt failed");
                    }
                }
            }

            match final_outcome {
                Some(o) => Ok(o),
                None => Ok(TurnOutcome {
                    session_id: String::new(),
                    is_error: true,
                    terminal_reason: Some("stream closed before outcome".into()),
                    total_cost_usd: None,
                    final_text: last_text,
                    num_turns: None,
                }),
            }
        });

        Ok(TurnHandle {
            cancel: cancel_tx,
            events: event_rx,
            join,
        })
    }
}

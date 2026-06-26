//! Warm / persistent `claude` transport — RTS-113 Part B (PROTOTYPE).
//!
//! Holds one long-lived `claude -p --input-format stream-json` process per
//! conversation. Only the first turn of a conversation pays the ~0.7s
//! spawn/init cost (measured in `scripts/atlas-warm/poc.py`); each later turn
//! writes a user message to the live process's stdin and reads its events,
//! skipping process spawn, Node/CLI init and context reload.
//!
//! This is a drop-in [`AgentTransport`] — to enable it, change
//! `ServerState.transport` to `Arc<dyn AgentTransport>` and construct
//! `WarmCliTransport::discover()?` behind an env gate (e.g. `CAD_WARM_POOL=1`).
//! It is NOT wired in by default; `main`/`state.rs` still use `CliTransport`.
//!
//! KNOWN LIMITATIONS (resolve before a real deploy):
//!   - **BYO-credentials** turns (`credentials_json: Some`) fall back to the
//!     cold [`CliTransport`] — a persistent process can't switch HOME per turn.
//!     Atlas's own turns omit creds, so they take the warm path.
//!   - **`--append-system-prompt`** (Atlas memory + keyword-matched skills) is
//!     fixed at spawn for the life of the process, so per-turn keyword-skill
//!     re-matching is lost on the warm path. The always-injected memory is
//!     stable; the per-message `skill_directive` still applies (it's prepended
//!     to the message text). A clean fix is to inject per-turn skill text into
//!     the user message instead of the system prompt.
//!   - **Cancel** kills the process and evicts it; the next turn respawns with
//!     `--resume` to restore context. (No mid-turn interrupt yet.)
//!   - **Idle reaping** is a TODO — processes live until cancel/crash. A real
//!     deploy needs an idle timer to bound RAM (each warm process ≈ a Node +
//!     claude footprint).

use super::cli_transport::CliTransport;
use super::events::{AgentEvent, ContentBlock, ResultEvent, SystemEvent};
use super::{AgentTransport, PermissionMode, TurnHandle, TurnOutcome, TurnRequest};
use anyhow::{anyhow, Context, Result};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{mpsc, oneshot, Mutex};
use tracing::{info, warn};

type Pool = Arc<Mutex<HashMap<String, Arc<WarmProc>>>>;

/// One warm conversation process. Turns on the same process are serialised by
/// holding the `stdout` lock for the duration of a turn (the process is silent
/// between turns, so nothing else needs to read it).
struct WarmProc {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    stdout: Mutex<Lines<BufReader<ChildStdout>>>,
    session_id: Mutex<Option<String>>,
}

/// Pools persistent `claude` processes keyed by conversation (claude session id).
pub struct WarmCliTransport {
    binary: PathBuf,
    cold: CliTransport,
    pool: Pool,
}

impl WarmCliTransport {
    pub fn discover() -> Result<Self> {
        let cold = CliTransport::discover()?;
        let binary = cold.binary()?;
        Ok(Self {
            binary,
            cold,
            pool: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    /// Spawn a fresh persistent process for a conversation. `--resume` is passed
    /// only when restoring a session we don't already hold warm.
    async fn spawn_proc(&self, req: &TurnRequest) -> Result<Arc<WarmProc>> {
        let mode = req.permission_mode.unwrap_or(PermissionMode::AcceptEdits);
        let cwd = req
            .cwd
            .clone()
            .or_else(|| dirs::home_dir().map(|h| h.to_string_lossy().to_string()))
            .unwrap_or_else(|| ".".to_string());

        let mut cmd = Command::new(&self.binary);
        cmd.arg("-p")
            .arg("--input-format")
            .arg("stream-json")
            .arg("--output-format")
            .arg("stream-json")
            .arg("--verbose")
            .arg("--include-partial-messages")
            .arg("--permission-mode")
            .arg(mode.as_cli())
            .current_dir(&cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Restore prior context only when resuming a session we don't hold warm.
        if let Some(sid) = &req.resume_session_id {
            cmd.arg("--resume").arg(sid);
        }
        // NOTE: fixed for the life of the process (see module limitations).
        if let Some(extra) = &req.append_system_prompt {
            if !extra.is_empty() {
                cmd.arg("--append-system-prompt").arg(extra);
            }
        }
        if let Some(tools) = &req.allowed_tools {
            if !tools.is_empty() {
                cmd.arg("--allowed-tools").arg(tools.join(","));
            }
        }
        if let Some(denied) = &req.disallowed_tools {
            if !denied.is_empty() {
                cmd.arg("--disallowed-tools").arg(denied.join(","));
            }
        }
        if let Some(model) = &req.model {
            if !model.trim().is_empty() {
                cmd.arg("--model").arg(model.trim());
            }
        }
        // Subscription-only guarantee (same as the cold transport).
        cmd.env_remove("ANTHROPIC_API_KEY");
        cmd.env_remove("CLAUDE_API_KEY");

        let mut child = cmd
            .spawn()
            .with_context(|| format!("spawn {}", self.binary.display()))?;
        let stdin = child.stdin.take().ok_or_else(|| anyhow!("child has no stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("child has no stdout"))?;
        let stderr = child.stderr.take().ok_or_else(|| anyhow!("child has no stderr"))?;

        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                if !l.trim().is_empty() {
                    warn!(stderr = %l, "warm claude CLI");
                }
            }
        });

        info!("spawned warm claude process");
        Ok(Arc::new(WarmProc {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            stdout: Mutex::new(BufReader::new(stdout).lines()),
            session_id: Mutex::new(None),
        }))
    }
}

#[async_trait::async_trait]
impl AgentTransport for WarmCliTransport {
    async fn start_turn(&self, req: TurnRequest) -> Result<TurnHandle> {
        // BYO-credentials turns need a per-turn HOME — not compatible with a
        // long-lived process. Take the cold path.
        if req.credentials_json.is_some() {
            return self.cold.start_turn(req).await;
        }

        let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
        let (event_tx, event_rx) = mpsc::unbounded_channel::<AgentEvent>();

        // Reuse the warm process for this conversation, or spawn one.
        let key = req.resume_session_id.clone();
        let proc = {
            let mut pool = self.pool.lock().await;
            match key.as_ref().and_then(|k| pool.get(k).cloned()) {
                Some(p) => p,
                None => {
                    let p = self.spawn_proc(&req).await?;
                    if let Some(k) = &key {
                        pool.insert(k.clone(), p.clone());
                    }
                    p
                }
            }
        };

        // skill_directive is per-message (prepended to the prompt) and still
        // works on the warm path.
        let prompt = match &req.skill_directive {
            Some(d) if !d.is_empty() => format!("{d}{}", req.prompt),
            _ => req.prompt.clone(),
        };

        let pool = self.pool.clone();
        let join = tokio::spawn(async move { run_turn(proc, pool, prompt, event_tx, cancel_rx).await });

        Ok(TurnHandle {
            cancel: cancel_tx,
            events: event_rx,
            join,
        })
    }
}

/// Drive a single turn against an already-warm process: write the user message,
/// stream events until the `result`, leave the process alive for the next turn.
async fn run_turn(
    proc: Arc<WarmProc>,
    pool: Pool,
    prompt: String,
    events: mpsc::UnboundedSender<AgentEvent>,
    mut cancel: oneshot::Receiver<()>,
) -> Result<TurnOutcome> {
    // Hold the stdout lock for the whole turn — this serialises turns on the
    // same conversation (the UI never runs two at once per session anyway).
    let mut out = proc.stdout.lock().await;

    // Send the user message as one stream-json line.
    {
        let msg = serde_json::json!({
            "type": "user",
            "message": { "role": "user", "content": prompt }
        });
        let line = format!("{msg}\n");
        let mut stdin = proc.stdin.lock().await;
        if let Err(e) = stdin.write_all(line.as_bytes()).await {
            evict(&pool, &proc).await;
            return Ok(error_outcome(format!("warm stdin write failed: {e}")));
        }
        let _ = stdin.flush().await;
    }

    let mut session_id: Option<String> = proc.session_id.lock().await.clone();
    let mut last_text: Option<String> = None;
    let mut final_event: Option<ResultEvent> = None;

    loop {
        tokio::select! {
            biased;
            _ = &mut cancel => {
                info!("warm turn cancelled — killing + evicting process");
                let _ = proc.child.lock().await.start_kill();
                evict(&pool, &proc).await;
                return Ok(TurnOutcome {
                    session_id: session_id.unwrap_or_default(),
                    is_error: true,
                    terminal_reason: Some("cancelled".into()),
                    total_cost_usd: None,
                    final_text: last_text,
                    num_turns: None,
                });
            }
            line = out.next_line() => {
                match line {
                    Ok(Some(raw)) => {
                        if raw.trim().is_empty() { continue; }
                        let (parsed, _raw_json) = AgentEvent::from_line(&raw);
                        let Some(ev) = parsed else {
                            let _ = events.send(AgentEvent::Other);
                            continue;
                        };
                        if let AgentEvent::System(SystemEvent { session_id: Some(s), .. }) = &ev {
                            session_id = Some(s.clone());
                        }
                        if let AgentEvent::Assistant(a) = &ev {
                            if let Some(m) = &a.message {
                                if let Some(content) = &m.content {
                                    for blk in content {
                                        if let ContentBlock::Text { text } = blk {
                                            last_text = Some(text.clone());
                                        }
                                    }
                                }
                            }
                        }
                        // The `result` event terminates THIS turn but NOT the
                        // process — forward it, then stop reading and return.
                        if let AgentEvent::Result(r) = &ev {
                            final_event = Some(r.clone());
                            let _ = events.send(ev);
                            break;
                        }
                        let _ = events.send(ev);
                    }
                    Ok(None) => {
                        // Process exited unexpectedly (crash / OAuth death).
                        warn!("warm process ended before result — evicting");
                        evict(&pool, &proc).await;
                        break;
                    }
                    Err(e) => {
                        warn!(error = %e, "warm stdout read error — evicting");
                        evict(&pool, &proc).await;
                        break;
                    }
                }
            }
        }
    }

    // Release the stdout lock before touching the pool (keeps lock order simple).
    drop(out);

    // Remember the learned session id and (re)register the process under it so
    // the next turn — which arrives with resume_session_id == this id — reuses it.
    if let Some(sid) = &session_id {
        *proc.session_id.lock().await = Some(sid.clone());
        let mut p = pool.lock().await;
        p.entry(sid.clone()).or_insert_with(|| proc.clone());
    }

    let fe = final_event.unwrap_or(ResultEvent {
        subtype: None,
        is_error: Some(true),
        session_id: session_id.clone(),
        result: last_text.clone(),
        total_cost_usd: None,
        duration_ms: None,
        num_turns: None,
        terminal_reason: Some("stream ended before result".into()),
        usage: None,
        stop_reason: None,
    });

    Ok(TurnOutcome {
        session_id: fe.session_id.clone().or(session_id).unwrap_or_default(),
        is_error: fe.is_error.unwrap_or(false),
        terminal_reason: fe.terminal_reason.clone(),
        total_cost_usd: fe.total_cost_usd,
        final_text: fe.result.clone().or(last_text),
        num_turns: fe.num_turns,
    })
}

/// Remove a (dead/cancelled) process from the pool by identity.
async fn evict(pool: &Pool, proc: &Arc<WarmProc>) {
    let mut p = pool.lock().await;
    p.retain(|_, v| !Arc::ptr_eq(v, proc));
}

fn error_outcome(msg: String) -> TurnOutcome {
    TurnOutcome {
        session_id: String::new(),
        is_error: true,
        terminal_reason: Some(msg),
        total_cost_usd: None,
        final_text: None,
        num_turns: None,
    }
}

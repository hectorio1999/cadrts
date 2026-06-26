//! Spawns the bundled `claude.exe` from `@anthropic-ai/claude-code`, talks to
//! it in headless stream-json mode, and surfaces every JSON line as a typed
//! [`AgentEvent`].
//!
//! Design notes:
//!
//! - We use **per-turn spawn** with `--resume <session_id>` instead of a
//!   long-lived process. Simpler, more robust against partial crashes, and
//!   matches what `-p` is optimised for. The CLI handles OAuth refresh
//!   transparently against `~/.claude/.credentials.json`, so we never see
//!   tokens here.
//! - **No API key**: we explicitly scrub `ANTHROPIC_API_KEY` from the child
//!   env so a stray export in the user's shell cannot accidentally route
//!   billing to a pay-per-token key. Subscription-only by construction.
//! - **Cancellation**: a oneshot channel kills the child and aborts the
//!   reader task. The UI's Stop button is wired to this.
//! - **Working directory**: defaults to the user's home, *not* the app's
//!   install dir. That keeps the agent away from our own binaries and the
//!   stream-json files we keep in `~/.claude-agent-desktop/`.

use super::events::{AgentEvent, ResultEvent, SystemEvent};
use super::{AgentTransport, PermissionMode, TurnHandle, TurnOutcome, TurnRequest};
use anyhow::{anyhow, bail, Context, Result};
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

/// Builds + spawns the `claude` CLI for each turn.
pub struct CliTransport {
    /// Resolved path to `claude.exe` (or `claude` on macOS/Linux).
    /// `None` = not yet located (graceful-boot fallback); resolved lazily at
    /// turn time so a mid-session install is picked up without an app restart.
    binary: Option<PathBuf>,
}

impl CliTransport {
    /// Locate the `claude` binary. Priority order:
    ///   1. `CLAUDE_BIN` env var (developer override)
    ///   2. npm global on Windows: `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`
    ///   3. `claude` on PATH (cross-platform fallback)
    ///
    /// The npm shim (`%APPDATA%\npm\claude.cmd`) works too but adds a cmd.exe
    /// hop. We prefer the underlying `.exe` so cancellation and signal
    /// handling are clean.
    pub fn discover() -> Result<Self> {
        if let Ok(v) = std::env::var("CLAUDE_BIN") {
            let p = PathBuf::from(v);
            if p.exists() {
                info!(binary = %p.display(), "using CLAUDE_BIN override");
                return Ok(Self { binary: Some(p) });
            }
        }

        #[cfg(windows)]
        {
            if let Some(appdata) = std::env::var_os("APPDATA") {
                let p = PathBuf::from(appdata)
                    .join("npm")
                    .join("node_modules")
                    .join("@anthropic-ai")
                    .join("claude-code")
                    .join("bin")
                    .join("claude.exe");
                if p.exists() {
                    info!(binary = %p.display(), "found bundled claude.exe");
                    return Ok(Self { binary: Some(p) });
                }
            }
        }

        // PATH fallback (macOS/Linux, or Windows if user installed elsewhere).
        let exe = if cfg!(windows) { "claude.exe" } else { "claude" };
        if let Ok(found) = which(exe) {
            info!(binary = %found.display(), "found claude on PATH");
            return Ok(Self { binary: Some(found) });
        }

        bail!(
            "could not locate the `claude` CLI binary. Install Claude Code with \
             `npm install -g @anthropic-ai/claude-code`, then sign in with `claude login`, \
             or set CLAUDE_BIN to the absolute path."
        )
    }

    /// Construct without locating the CLI. Lets the app boot and show
    /// sign-in/install guidance instead of crashing when the CLI isn't
    /// installed yet. The binary is resolved lazily on the next turn, so a
    /// mid-session `npm install -g @anthropic-ai/claude-code` is picked up
    /// without an app restart — and if it's still missing, the turn surfaces
    /// `discover()`'s full install instructions.
    pub fn unresolved() -> Self {
        Self { binary: None }
    }

    /// Resolve the binary path now, re-running discovery if we booted
    /// unresolved. Propagates `discover()`'s rich error when still missing.
    pub fn binary(&self) -> Result<PathBuf> {
        match &self.binary {
            Some(p) => Ok(p.clone()),
            None => Self::discover().map(|t| {
                t.binary.expect("discover() always resolves to Some")
            }),
        }
    }
}

/// Minimal `which`-style search across PATH. Avoids adding the `which` crate.
fn which(exe: &str) -> Result<PathBuf> {
    let path = std::env::var_os("PATH").ok_or_else(|| anyhow!("PATH unset"))?;
    for dir in std::env::split_paths(&path) {
        let cand = dir.join(exe);
        if cand.is_file() {
            return Ok(cand);
        }
    }
    bail!("{exe} not found on PATH")
}

/// Write the caller's credentials.json into a freshly-minted temp HOME
/// directory and return that path. Caller is responsible for cleanup.
///
/// Layout:
///   <tmp>/cad-<uuid>/.claude/.credentials.json   (mode 0600 on Unix)
///
/// We do a minimal JSON shape check first so a malformed upload fails fast
/// with a clean error rather than blowing up inside the child.
fn stage_credentials(json: &str) -> Result<PathBuf> {
    let v: serde_json::Value =
        serde_json::from_str(json).context("credentials_json is not valid JSON")?;
    if v.get("claudeAiOauth").is_none() {
        bail!("credentials_json is missing `claudeAiOauth` block — not a Claude Code credential file");
    }

    let base = std::env::temp_dir().join(format!("cad-{}", uuid::Uuid::new_v4()));
    let claude_dir = base.join(".claude");
    std::fs::create_dir_all(&claude_dir)
        .with_context(|| format!("mkdir {}", claude_dir.display()))?;
    let cred_path = claude_dir.join(".credentials.json");
    std::fs::write(&cred_path, json)
        .with_context(|| format!("write {}", cred_path.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&cred_path, std::fs::Permissions::from_mode(0o600));
        let _ = std::fs::set_permissions(&claude_dir, std::fs::Permissions::from_mode(0o700));
        let _ = std::fs::set_permissions(&base, std::fs::Permissions::from_mode(0o700));
    }

    Ok(base)
}

#[async_trait::async_trait]
impl AgentTransport for CliTransport {
    async fn start_turn(&self, req: TurnRequest) -> Result<TurnHandle> {
        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
        let (event_tx, event_rx) = mpsc::unbounded_channel::<AgentEvent>();

        let mode = req.permission_mode.unwrap_or(PermissionMode::AcceptEdits);
        let cwd = req
            .cwd
            .clone()
            .or_else(|| {
                dirs::home_dir().map(|h| h.to_string_lossy().to_string())
            })
            .unwrap_or_else(|| ".".to_string());

        // Bring-your-own-credentials: if the caller supplied credential bytes,
        // stage them inside a per-turn temp dir and point the child's HOME
        // there. This is what makes the server multi-tenant — every concurrent
        // turn sees its own credentials and nothing else.
        let creds_home = if let Some(json) = &req.credentials_json {
            Some(stage_credentials(json).context("stage per-turn credentials")?)
        } else {
            None
        };

        // Resolve the CLI now (re-runs discovery if we booted unresolved, so a
        // mid-session install works and the rich "install Claude Code" error
        // surfaces in chat rather than a bare "program not found").
        let binary = self.binary()?;

        // A workflow skill (if attached) rides in `skill_directive`, kept out of
        // `prompt` so keyword-skill matching and the transcript see only the
        // user's text. Prepend it to what the agent actually receives.
        let prompt = match &req.skill_directive {
            Some(d) if !d.is_empty() => format!("{d}{}", req.prompt),
            _ => req.prompt.clone(),
        };

        let mut cmd = Command::new(&binary);
        cmd.arg("-p")
            .arg(&prompt)
            .arg("--output-format")
            .arg("stream-json")
            .arg("--verbose")
            .arg("--permission-mode")
            .arg(mode.as_cli())
            .current_dir(&cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(sid) = &req.resume_session_id {
            cmd.arg("--resume").arg(sid);
        }
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
        // The real restriction: disallowed tools cannot run regardless of mode.
        // This is what the UI's "allowed tools" checkboxes withhold (unchecked).
        if let Some(denied) = &req.disallowed_tools {
            if !denied.is_empty() {
                cmd.arg("--disallowed-tools").arg(denied.join(","));
            }
        }
        // Model override (alias like `opus`/`sonnet`/`haiku`, or a full id).
        if let Some(model) = &req.model {
            if !model.trim().is_empty() {
                cmd.arg("--model").arg(model.trim());
            }
        }
        // Word-level streaming (RTS-113): emit `stream_event` token deltas so
        // clients can render assistant text as it's generated instead of in
        // per-block chunks. Parsed as `AgentEvent::StreamEvent` and forwarded
        // verbatim; the web/Tauri client renders `text_delta`s and suppresses
        // the duplicate final assistant block. Env kill-switch (no rebuild):
        // `ATLAS_STREAM_PARTIALS=0`.
        if std::env::var("ATLAS_STREAM_PARTIALS").map(|v| v != "0").unwrap_or(true) {
            cmd.arg("--include-partial-messages");
        }

        if let Some(home) = &creds_home {
            // Both names — the CLI's underlying Node `os.homedir()` reads
            // USERPROFILE on Windows and HOME everywhere else. Setting both
            // is harmless and survives a cross-platform server build.
            cmd.env("HOME", home);
            cmd.env("USERPROFILE", home);
            debug!(home = %home.display(), "isolated credential HOME for this turn");
        }

        // Subscription-only guarantee: scrub any env var that would silently
        // route through pay-per-token billing.
        cmd.env_remove("ANTHROPIC_API_KEY");
        cmd.env_remove("CLAUDE_API_KEY");

        debug!(?cmd, "spawning claude CLI");
        let mut child = cmd
            .spawn()
            .with_context(|| format!("spawn {}", binary.display()))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("child has no stdout"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| anyhow!("child has no stderr"))?;

        // Stderr -> tracing. Useful when the CLI complains about auth.
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                if !l.trim().is_empty() {
                    warn!(stderr = %l, "claude CLI");
                }
            }
        });

        let event_tx_clone = event_tx.clone();
        let creds_home_drop = creds_home.clone();
        let join = tokio::spawn(async move {
            let outcome = drive(child, stdout, event_tx_clone, cancel_rx).await;
            // Best-effort cleanup of the per-turn HOME, regardless of outcome.
            if let Some(h) = creds_home_drop {
                if let Err(e) = std::fs::remove_dir_all(&h) {
                    warn!(error = %e, path = %h.display(), "could not clean up per-turn creds dir");
                }
            }
            outcome
        });

        Ok(TurnHandle {
            cancel: cancel_tx,
            events: event_rx,
            join,
        })
    }
}

/// Reads stream-json off the child's stdout, emits typed events, and waits
/// for the process to exit or a cancellation signal. Returns the final
/// [`TurnOutcome`] derived from the `result` event.
async fn drive(
    mut child: Child,
    stdout: tokio::process::ChildStdout,
    events: mpsc::UnboundedSender<AgentEvent>,
    mut cancel: tokio::sync::oneshot::Receiver<()>,
) -> Result<TurnOutcome> {
    let mut lines = BufReader::new(stdout).lines();
    let mut session_id: Option<String> = None;
    let mut last_text: Option<String> = None;
    let mut final_event: Option<ResultEvent> = None;

    // Per-turn budget guard (env-tunable; 0 = disabled). Stops a runaway or
    // looping turn so a confused Opus turn cannot burn unbounded time/cost. On
    // trip we kill the child and end the turn cleanly — the next user message
    // resumes the session normally (no mid-turn nag injected).
    let max_secs: u64 = std::env::var("ATLAS_TURN_MAX_SECS")
        .ok().and_then(|v| v.parse().ok()).unwrap_or(0);
    let max_tools: u64 = std::env::var("ATLAS_TURN_MAX_TOOLS")
        .ok().and_then(|v| v.parse().ok()).unwrap_or(0);
    let mut tool_count: u64 = 0;
    let deadline = tokio::time::Instant::now()
        + if max_secs > 0 { Duration::from_secs(max_secs) }
          else { Duration::from_secs(60 * 60 * 24 * 365) };
    let sleep = tokio::time::sleep_until(deadline);
    tokio::pin!(sleep);

    loop {
        tokio::select! {
            biased;
            _ = &mut cancel => {
                info!("cancellation requested — killing claude child");
                let _ = child.start_kill();
                let _ = child.wait().await;
                return Ok(TurnOutcome {
                    session_id: session_id.unwrap_or_default(),
                    is_error: true,
                    terminal_reason: Some("cancelled".into()),
                    total_cost_usd: None,
                    final_text: last_text,
                    num_turns: None,
                });
            }
            _ = &mut sleep, if max_secs > 0 => {
                warn!(max_secs, "turn hit wall-clock budget cap — killing claude child");
                let _ = child.start_kill();
                let _ = child.wait().await;
                return Ok(TurnOutcome {
                    session_id: session_id.unwrap_or_default(),
                    is_error: true,
                    terminal_reason: Some(format!("budget: hit {max_secs}s wall-clock cap")),
                    total_cost_usd: None,
                    final_text: last_text,
                    num_turns: None,
                });
            }
            line = lines.next_line() => {
                match line {
                    Ok(Some(raw)) => {
                        if raw.trim().is_empty() { continue; }
                        let (parsed, _raw_json) = AgentEvent::from_line(&raw);
                        let Some(ev) = parsed else {
                            // Still forward the raw line so the inspector shows it.
                            let _ = events.send(AgentEvent::Other);
                            continue;
                        };

                        // Snapshot session_id off the first system/init we see.
                        if let AgentEvent::System(SystemEvent { session_id: Some(s), .. }) = &ev {
                            session_id = Some(s.clone());
                        }
                        // Track the last assistant text (for cancel/return) and
                        // count tool_use blocks toward the per-turn budget cap.
                        if let AgentEvent::Assistant(a) = &ev {
                            if let Some(m) = &a.message {
                                if let Some(content) = &m.content {
                                    for blk in content {
                                        match blk {
                                            super::events::ContentBlock::Text { text } => {
                                                last_text = Some(text.clone());
                                            }
                                            super::events::ContentBlock::ToolUse { .. } => {
                                                tool_count += 1;
                                            }
                                            _ => {}
                                        }
                                    }
                                }
                            }
                        }
                        if let AgentEvent::Result(r) = &ev {
                            final_event = Some(r.clone());
                        }
                        let _ = events.send(ev);

                        if max_tools > 0 && tool_count > max_tools {
                            warn!(tool_count, max_tools, "turn hit tool-call budget cap — killing claude child");
                            let _ = child.start_kill();
                            let _ = child.wait().await;
                            return Ok(TurnOutcome {
                                session_id: session_id.clone().unwrap_or_default(),
                                is_error: true,
                                terminal_reason: Some(format!("budget: hit {max_tools}-tool cap")),
                                total_cost_usd: None,
                                final_text: last_text.clone(),
                                num_turns: None,
                            });
                        }
                    }
                    Ok(None) => break,
                    Err(e) => {
                        warn!(error = %e, "stdout read error");
                        break;
                    }
                }
            }
        }
    }

    let status = child.wait().await?;
    let final_event = final_event.unwrap_or(ResultEvent {
        subtype: None,
        is_error: Some(!status.success()),
        session_id: session_id.clone(),
        result: last_text.clone(),
        total_cost_usd: None,
        duration_ms: None,
        num_turns: None,
        terminal_reason: status.code().map(|c| format!("exit:{c}")),
        usage: None,
        stop_reason: None,
    });

    Ok(TurnOutcome {
        session_id: final_event
            .session_id
            .clone()
            .or(session_id)
            .unwrap_or_default(),
        is_error: final_event.is_error.unwrap_or(false),
        terminal_reason: final_event.terminal_reason.clone(),
        total_cost_usd: final_event.total_cost_usd,
        final_text: final_event.result.clone().or(last_text),
        num_turns: final_event.num_turns,
    })
}

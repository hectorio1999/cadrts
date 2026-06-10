//! End-to-end proof for `RemoteTransport`.
//!
//! Usage:
//!   $env:CAD_REMOTE_URL   = "http://127.0.0.1:9120"
//!   $env:CAD_REMOTE_TOKEN = "dev-token-this-is-at-least-24-chars-long"
//!   cargo run -p agent-core --bin remote-repl -- "your prompt"
//!
//! Reads your own `~/.claude/.credentials.json` and ships it up with the
//! turn. The server isolates the credentials in a per-turn HOME directory
//! and deletes them as soon as the turn ends.

use agent_core::agent::remote_transport::{RemoteConfig, RemoteTransport};
use agent_core::agent::{
    AgentEvent, AgentTransport, ContentBlock, PermissionMode, TurnRequest,
};
use std::env;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .init();

    let base = env::var("CAD_REMOTE_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:9120".into());
    let token = env::var("CAD_REMOTE_TOKEN")
        .map_err(|_| anyhow::anyhow!("CAD_REMOTE_TOKEN must be set"))?;

    let prompt = env::args()
        .skip(1)
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    let prompt = if prompt.is_empty() {
        "Use the Bash tool to: echo REMOTE_REPL_OK_$RANDOM. Reply with only the stdout.".to_string()
    } else {
        prompt
    };

    println!("== remote-repl ==");
    println!("base: {base}");
    println!("prompt: {prompt}");

    let transport = RemoteTransport::new(RemoteConfig {
        base_url: base.clone(),
        bearer_token: token,
        credentials_path: None,
    })?;
    transport.health().await?;
    println!("server: healthy");

    let req = TurnRequest {
        prompt: prompt.clone(),
        resume_session_id: None,
        append_system_prompt: None,
        permission_mode: Some(PermissionMode::AcceptEdits),
        allowed_tools: Some(vec!["Bash".into(), "Read".into(), "Glob".into(), "Grep".into()]),
        disallowed_tools: None,
        skill_directive: None,
        model: None,
        cwd: None,
        // Unused by RemoteTransport (it reads creds from disk and uploads
        // them itself), but kept here to make the request shape obvious.
        credentials_json: None,
    };

    let mut handle = transport.start_turn(req).await?;
    println!("---- stream ----");

    while let Some(ev) = handle.events.recv().await {
        match &ev {
            AgentEvent::System(s) => println!(
                "[system] subtype={:?} session={:?} api_key_source={:?}",
                s.subtype, s.session_id, s.api_key_source
            ),
            AgentEvent::Assistant(a) => {
                if let Some(m) = &a.message {
                    if let Some(content) = &m.content {
                        for b in content {
                            match b {
                                ContentBlock::Text { text } => {
                                    println!("[assistant.text] {}", text.trim());
                                }
                                ContentBlock::ToolUse { name, input, id, .. } => {
                                    println!("[tool_use] id={id} name={name} input={input}");
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
            AgentEvent::User(u) => {
                if let Some(m) = &u.message {
                    if let Some(content) = &m.content {
                        for b in content {
                            if let ContentBlock::ToolResult { tool_use_id, content, is_error } = b {
                                println!(
                                    "[tool_result] id={tool_use_id} is_error={:?} content={}",
                                    is_error, content
                                );
                            }
                        }
                    }
                }
            }
            AgentEvent::Result(r) => println!(
                "[result] subtype={:?} cost={:?} turns={:?} reason={:?}",
                r.subtype, r.total_cost_usd, r.num_turns, r.terminal_reason
            ),
            _ => {}
        }
    }

    let outcome = handle.join.await??;
    println!("---- outcome ----");
    println!("{}", serde_json::to_string_pretty(&outcome)?);
    Ok(())
}

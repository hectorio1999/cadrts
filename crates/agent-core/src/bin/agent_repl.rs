//! Standalone proof that the agent core works without any UI.
//!
//! Usage:
//!   cargo run --bin agent-repl -- "list the files in this directory"
//!
//! It streams every parsed [`AgentEvent`] to stdout, then prints a JSON
//! summary of the [`TurnOutcome`]. If this works, the desktop shell is just
//! a presentation layer over the same code path.

use agent_core::agent::cli_transport::CliTransport;
use agent_core::agent::{AgentEvent, AgentTransport, ContentBlock, PermissionMode, TurnRequest};
use agent_core::{auth, memory, paths};
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

    paths::ensure_layout()?;

    println!("== Claude Agent Desktop · agent-repl ==");

    let st = auth::status();
    println!(
        "auth: authenticated={}  plan={:?}  expires_at={:?}",
        st.authenticated, st.subscription_type, st.expires_at
    );
    if !st.authenticated {
        eprintln!("not authenticated — run `claude login` first");
        std::process::exit(2);
    }

    let prompt = env::args()
        .skip(1)
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    let prompt = if prompt.is_empty() {
        "Run the Bash tool with: echo HELLO_FROM_AGENT_REPL_$RANDOM. Then reply with only the command's stdout.".to_string()
    } else {
        prompt
    };
    println!("prompt: {prompt}");

    let transport = CliTransport::discover()?;
    println!("claude binary: {}", transport.binary()?.display());

    let append = memory::build_system_append(&prompt)?;
    println!(
        "append_system_prompt: {} bytes",
        append.as_deref().map(str::len).unwrap_or(0)
    );

    let req = TurnRequest {
        prompt: prompt.clone(),
        resume_session_id: None,
        append_system_prompt: append,
        permission_mode: Some(PermissionMode::AcceptEdits),
        allowed_tools: Some(vec!["Bash".into(), "Read".into(), "Glob".into(), "Grep".into()]),
        disallowed_tools: None,
        skill_directive: None,
        model: None,
        cwd: None,
        credentials_json: None,
    };

    let mut handle = transport.start_turn(req).await?;
    println!("---- stream ----");

    while let Some(ev) = handle.events.recv().await {
        match &ev {
            AgentEvent::System(s) => {
                println!(
                    "[system] subtype={:?} session={:?} model={:?} api_key_source={:?}",
                    s.subtype, s.session_id, s.model, s.api_key_source
                );
            }
            AgentEvent::Assistant(a) => {
                if let Some(m) = &a.message {
                    if let Some(content) = &m.content {
                        for b in content {
                            match b {
                                ContentBlock::Text { text } => println!("[assistant.text] {}", text.trim()),
                                ContentBlock::Thinking { .. } => println!("[assistant.thinking …]"),
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
            AgentEvent::RateLimitEvent(_) => println!("[rate_limit]"),
            AgentEvent::Result(r) => {
                println!(
                    "[result] subtype={:?} is_error={:?} cost={:?} turns={:?} reason={:?}",
                    r.subtype, r.is_error, r.total_cost_usd, r.num_turns, r.terminal_reason
                );
            }
            AgentEvent::StreamEvent(_) | AgentEvent::Other => {}
        }
    }

    let outcome = handle.join.await??;
    println!("---- outcome ----");
    println!("{}", serde_json::to_string_pretty(&outcome)?);
    Ok(())
}

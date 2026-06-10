//! Server-side job scheduler.
//!
//! A single background task wakes ~once a minute, loads the job definitions from
//! `~/.cad/jobs/`, and runs any that are due. Each run is a headless Atlas turn
//! whose prompt is the job's `prompt`, executed with the server's own Claude
//! credentials (no per-turn upload) and the standard memory + skills system
//! prompt — so a scheduled job behaves exactly like the user asking Atlas to do
//! the task, just unattended. The result is appended to the job's run history.

use agent_core::agent::{AgentTransport, PermissionMode, TurnRequest};
use agent_core::cron::{self, Job, RunRecord};
use agent_core::memory;
use chrono::Utc;
use std::collections::HashSet;
use std::sync::Arc;
use std::sync::OnceLock;
use tokio::sync::Mutex;

use crate::state::ServerState;

/// Job ids currently executing, so a long run never overlaps its next tick.
fn inflight() -> &'static Mutex<HashSet<String>> {
    static INFLIGHT: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    INFLIGHT.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Sensible defaults for an unattended run so read-only monitors actually work
/// without a human to approve tool prompts.
const DEFAULT_JOB_TOOLS: &[&str] = &["Bash", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Write"];

fn parse_mode(s: &Option<String>) -> PermissionMode {
    match s.as_deref() {
        Some("plan") => PermissionMode::Plan,
        Some("default") => PermissionMode::Default,
        Some("bypassPermissions") => PermissionMode::BypassPermissions,
        // Unattended runs default to acceptEdits: edits auto-apply and the
        // job's allowed_tools auto-approve the read/check tools it needs.
        _ => PermissionMode::AcceptEdits,
    }
}

/// Spawn the scheduler loop. Cheap; returns immediately.
pub fn spawn(state: Arc<ServerState>) {
    tokio::spawn(async move {
        tracing::info!("job scheduler started");
        loop {
            // Wake near the top of each minute so cron-minute resolution lines up.
            let now = Utc::now();
            let secs_into_min = now.timestamp() % 60;
            let sleep_secs = (60 - secs_into_min).clamp(1, 60) as u64;
            tokio::time::sleep(std::time::Duration::from_secs(sleep_secs)).await;
            if let Err(e) = tick(&state).await {
                tracing::warn!(error = ?e, "scheduler tick failed");
            }
        }
    });
}

async fn tick(state: &Arc<ServerState>) -> anyhow::Result<()> {
    let jobs = cron::load_jobs().unwrap_or_default();
    let now_ms = Utc::now().timestamp_millis();
    for job in jobs {
        if !job.enabled {
            continue;
        }
        let baseline = cron::baseline_for(&job);
        if !cron::is_due(&job, baseline, now_ms) {
            continue;
        }
        // Skip if a previous run of this job is still going.
        {
            let mut g = inflight().lock().await;
            if g.contains(&job.id) {
                continue;
            }
            g.insert(job.id.clone());
        }
        let state2 = state.clone();
        tokio::spawn(async move {
            let id = job.id.clone();
            if let Err(e) = run_job(&state2, &job, "schedule").await {
                tracing::warn!(job = %id, error = ?e, "scheduled job run failed");
            }
            inflight().lock().await.remove(&id);
        });
    }
    Ok(())
}

/// Run a job once and append the result to its history. Shared by the scheduler
/// and the "run now" API endpoint (which passes trigger = "manual").
pub async fn run_job(state: &Arc<ServerState>, job: &Job, trigger: &str) -> anyhow::Result<RunRecord> {
    let started_at = Utc::now().timestamp_millis();
    tracing::info!(job = %job.id, %trigger, "running scheduled job");

    let append = memory::build_system_append(&job.prompt).unwrap_or(None);
    let allowed = job
        .allowed_tools
        .clone()
        .unwrap_or_else(|| DEFAULT_JOB_TOOLS.iter().map(|s| s.to_string()).collect());

    let req = TurnRequest {
        prompt: job.prompt.clone(),
        resume_session_id: None,
        append_system_prompt: append,
        permission_mode: Some(parse_mode(&job.permission_mode)),
        allowed_tools: Some(allowed),
        disallowed_tools: None,
        skill_directive: None,
        model: job.model.clone(),
        cwd: job.cwd.clone(),
        // Use the server's own Claude credentials (the cad user's login).
        credentials_json: None,
    };

    let prev_hash = cron::last_run(&job.id)
        .ok()
        .flatten()
        .and_then(|r| r.output_hash);

    let rec = match state.transport.start_turn(req).await {
        Ok(mut handle) => {
            // Drain (and discard) the event stream, then take the outcome.
            while handle.events.recv().await.is_some() {}
            match handle.join.await {
                Ok(Ok(outcome)) => {
                    let is_error = outcome.is_error;
                    cron::build_run(
                        job,
                        started_at,
                        !is_error,
                        outcome.final_text,
                        outcome.total_cost_usd,
                        if is_error { outcome.terminal_reason } else { None },
                        trigger,
                        prev_hash.as_deref(),
                    )
                }
                Ok(Err(e)) => cron::build_run(job, started_at, false, None, None, Some(e.to_string()), trigger, prev_hash.as_deref()),
                Err(e) => cron::build_run(job, started_at, false, None, None, Some(format!("task crashed: {e}")), trigger, prev_hash.as_deref()),
            }
        }
        Err(e) => cron::build_run(job, started_at, false, None, None, Some(e.to_string()), trigger, prev_hash.as_deref()),
    };

    cron::append_run(&job.id, &rec)?;
    tracing::info!(job = %job.id, ok = rec.ok, changed = rec.changed, "job run complete");
    Ok(rec)
}

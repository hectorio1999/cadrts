//! Filesystem locations for user data.
//!
//! All app state lives in `~/.claude-agent-desktop/`:
//!   - `state.sqlite`   — conversations, messages, settings (FTS5 indexed)
//!   - `memory.md`      — durable user-editable memory (injected each turn)
//!   - `skills/*.md`    — playbooks with YAML frontmatter
//!   - `logs/`          — rotating run logs
//!
//! On first launch we create the directory and seed empty defaults.

use anyhow::{Context, Result};
use include_dir::{include_dir, Dir};
use std::path::PathBuf;

/// Base skill library, embedded at compile time from `seed-skills/` (generated
/// from the TypeScript library by `scripts/gen-skill-seed.mjs`). Seeded into
/// every agent's `skills/base/` on boot so the full library is available by
/// default — no install or activation needed.
static BASE_SKILLS: Dir = include_dir!("$CARGO_MANIFEST_DIR/../../seed-skills");

/// Root user-data dir. Honored override: `CLAUDE_AGENT_DESKTOP_HOME`.
pub fn app_home() -> Result<PathBuf> {
    if let Ok(v) = std::env::var("CLAUDE_AGENT_DESKTOP_HOME") {
        return Ok(PathBuf::from(v));
    }
    let home = dirs::home_dir().context("could not resolve user home directory")?;
    Ok(home.join(".claude-agent-desktop"))
}

pub fn db_path() -> Result<PathBuf> {
    Ok(app_home()?.join("state.sqlite"))
}

pub fn memory_path() -> Result<PathBuf> {
    Ok(app_home()?.join("memory.md"))
}

pub fn skills_dir() -> Result<PathBuf> {
    Ok(app_home()?.join("skills"))
}

/// Where the app-owned base skill library is seeded. Kept separate from the
/// user's own skills (which live directly under `skills/`) so we can refresh
/// the base library on every boot without ever clobbering user-created skills.
pub fn base_skills_dir() -> Result<PathBuf> {
    Ok(skills_dir()?.join("base"))
}

pub fn logs_dir() -> Result<PathBuf> {
    Ok(app_home()?.join("logs"))
}

/// Where chat-composer image attachments are staged. The server writes here
/// (it's inside the unit's `ReadWritePaths`) and the per-turn `claude` child
/// reads the files by absolute path with its Read tool. Pruned on a TTL by the
/// upload handler.
pub fn uploads_dir() -> Result<PathBuf> {
    Ok(app_home()?.join("uploads"))
}

/// Scheduled-automation ("cron job") definitions live here as `<id>.json`
/// files — created by the agent with its file tools and by the jobs API, read
/// by the server-side scheduler. Run history lives in the `.runs/` subdir.
pub fn jobs_dir() -> Result<PathBuf> {
    Ok(app_home()?.join("jobs"))
}

/// Per-job run history, one append-only `<id>.jsonl` per job. Kept in a
/// dot-subdir of `jobs/` so it's never mistaken for a job definition.
pub fn job_runs_dir() -> Result<PathBuf> {
    Ok(jobs_dir()?.join(".runs"))
}

/// Idempotently create the app dirs and seed empty defaults.
/// Safe to call on every boot.
pub fn ensure_layout() -> Result<()> {
    let home = app_home()?;
    std::fs::create_dir_all(&home).with_context(|| format!("mkdir {}", home.display()))?;
    std::fs::create_dir_all(skills_dir()?)?;
    std::fs::create_dir_all(logs_dir()?)?;
    std::fs::create_dir_all(jobs_dir()?)?;
    std::fs::create_dir_all(job_runs_dir()?)?;
    std::fs::create_dir_all(uploads_dir()?)?;

    // Refresh the base skill library every boot — these are app-owned and
    // versioned with the binary. User-created skills live under skills/ (not
    // skills/base/) and are never touched here.
    let base = base_skills_dir()?;
    std::fs::create_dir_all(&base)?;
    for f in BASE_SKILLS.files() {
        if let Some(name) = f.path().file_name() {
            let dest = base.join(name);
            if let Err(e) = std::fs::write(&dest, f.contents()) {
                tracing::warn!(error = ?e, file = ?name, "failed to seed base skill");
            }
        }
    }

    let mem = memory_path()?;
    if !mem.exists() {
        std::fs::write(
            &mem,
            "# Agent memory\n\n\
             This file is injected into the agent's system prompt every turn.\n\
             Put durable facts here: your name, OS, common project paths, preferences.\n\
             Keep it tight — every line costs context.\n",
        )?;
    }

    // Seed one example skill so the user sees the format.
    let example = skills_dir()?.join("example.md");
    if !example.exists() {
        std::fs::write(
            &example,
            "---\n\
             name: example\n\
             description: Stub skill — delete or edit me.\n\
             trigger: never\n\
             ---\n\n\
             # Example skill\n\n\
             Replace this file (or add new ones in this directory) with markdown playbooks.\n\
             `trigger: always` — always loaded into the system prompt.\n\
             `trigger: keyword: foo,bar` — loaded only when the user message contains a keyword.\n\
             `trigger: manual` — only when the user explicitly invokes it.\n\
             `trigger: never` — disabled.\n",
        )?;
    }
    Ok(())
}

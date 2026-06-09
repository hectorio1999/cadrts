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
use std::path::PathBuf;

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

pub fn logs_dir() -> Result<PathBuf> {
    Ok(app_home()?.join("logs"))
}

/// Idempotently create the app dirs and seed empty defaults.
/// Safe to call on every boot.
pub fn ensure_layout() -> Result<()> {
    let home = app_home()?;
    std::fs::create_dir_all(&home).with_context(|| format!("mkdir {}", home.display()))?;
    std::fs::create_dir_all(skills_dir()?)?;
    std::fs::create_dir_all(logs_dir()?)?;

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

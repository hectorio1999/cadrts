//! Persistent client config — `~/.claude-agent-desktop/config.json`.
//!
//! Selects the active transport (local CLI vs remote agent-server) and
//! remembers the remote URL + bearer token between launches. Read on every
//! boot, written whenever the Settings modal hits Save.
//!
//! Bearer token is stored in plain JSON because (a) it's per-user, in the
//! user's own home dir, (b) it only grants access to *the user's own*
//! agent-server, (c) the file already sits next to memory.md and SQLite.
//! Anyone with read access to the home dir already has full agent access.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum TransportMode {
    Local,
    Remote {
        base_url: String,
        /// Bearer token for `agent-server`'s access gate (NOT a Claude API key).
        token: String,
    },
}

impl Default for TransportMode {
    fn default() -> Self {
        TransportMode::Local
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ClientConfig {
    #[serde(default)]
    pub transport: TransportMode,
}

pub fn config_path() -> Result<PathBuf> {
    Ok(crate::paths::app_home()?.join("config.json"))
}

pub fn load() -> ClientConfig {
    let path = match config_path() {
        Ok(p) => p,
        Err(_) => return ClientConfig::default(),
    };
    let Ok(s) = std::fs::read_to_string(&path) else {
        return ClientConfig::default();
    };
    serde_json::from_str(&s).unwrap_or_default()
}

pub fn save(cfg: &ClientConfig) -> Result<()> {
    let path = config_path()?;
    let body = serde_json::to_string_pretty(cfg)?;
    std::fs::write(path, body)?;
    Ok(())
}

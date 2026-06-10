//! Agent core for Claude Agent Desktop.
//!
//! Modules:
//! - [`agent`]  — transport-agnostic event loop (CLI subprocess today, SDK later)
//! - [`auth`]   — OAuth credential discovery + `claude login` launching
//! - [`db`]     — SQLite persistence (sessions, messages, tool runs, settings)
//! - [`memory`] — memory.md + skills/*.md loader; builds the append-system-prompt
//! - [`paths`]  — filesystem layout for user data
//!
//! This crate is deliberately UI-agnostic. The Tauri shell (in `src-tauri/`)
//! depends on it and exposes its surface to React via #[tauri::command]
//! handlers; the standalone `agent-repl` binary exercises the same surface
//! with no GUI at all.

pub mod agent;
pub mod auth;
pub mod config;
pub mod cron;
pub mod db;
pub mod memory;
pub mod paths;

// Re-export the rusqlite type the Tauri shell needs to hold a connection
// in its AppState — saves the shell from adding `rusqlite` as a direct dep.
pub use rusqlite;

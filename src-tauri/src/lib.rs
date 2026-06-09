//! Thin Tauri shell library. The real domain code lives in the `agent-core`
//! crate; here we only expose Tauri command handlers + boot the runtime.

pub mod commands;

// Re-export the agent core so command implementations can stay short.
pub use agent_core;

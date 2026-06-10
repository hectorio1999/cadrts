// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use claude_agent_desktop_lib::commands::{self, AppState};

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    if let Err(e) = agent_core::paths::ensure_layout() {
        tracing::warn!(error = ?e, "failed to seed app data dir");
    }

    // A missing `claude` CLI no longer fails boot — build_transport falls back
    // to an unresolved transport so the AuthGate can render. This only errors on
    // genuinely fatal init (e.g. the SQLite state file can't be opened).
    let state = match AppState::new() {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = ?e, "fatal: could not initialize app state");
            panic!("could not initialize app state (state DB unavailable): {e}");
        }
    };

    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::auth_status,
            commands::launch_login,
            commands::start_turn,
            commands::cancel_turn,
            commands::read_memory,
            commands::write_memory,
            commands::list_skills,
            commands::read_skill,
            commands::write_skill,
            commands::persist_session,
            commands::list_sessions,
            commands::load_messages,
            commands::delete_session,
            commands::rename_session,
            commands::search_messages,
            commands::get_config,
            commands::set_config,
            commands::test_remote_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

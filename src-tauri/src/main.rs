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

    let state = match AppState::new() {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = ?e, "failed to initialize app state");
            // Boot the UI anyway so the AuthGate can render its sign-in prompt.
            // We still need *some* state object; return early with a panic.
            // (In practice, AppState::new only fails if claude.exe is missing.)
            panic!("could not initialize app state: {e}");
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

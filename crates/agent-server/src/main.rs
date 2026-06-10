//! agent-server — headless runner for Claude Agent Desktop.
//!
//! Boots an HTTP+WS service on `0.0.0.0:9120` (configurable) that lets
//! Tauri desktop clients (and, later, a browser UI) drive the Claude
//! Agent SDK against the *client's own* Claude account. The server
//! never stores OAuth credentials — clients upload their
//! `~/.claude/.credentials.json` bytes with every turn and the
//! per-turn HOME isolation in `CliTransport` ensures the file is
//! deleted as soon as the turn ends.
//!
//! Auth model:
//!   - Bearer token gate on all `/api/*` and `/ws/*` routes
//!   - Token comes from env var `CAD_SERVER_TOKEN` (panics if unset)
//!   - GET `/api/health` is the one unauthenticated endpoint
//!
//! State:
//!   - SQLite at `$CAD_HOME/state.sqlite` (defaults to `~/.cad/`)
//!   - memory.md + skills/*.md under the same dir, shared across clients
//!
//! Concurrency:
//!   - Each client turn spawns its own `claude` child in an isolated
//!     temp HOME. N turns can run concurrently with N different Max sessions.

mod api;
mod auth;
mod state;
mod stream;
mod version;

use anyhow::{Context, Result};
use axum::routing::{delete, get, patch, post};
use axum::Router;
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::info;

use crate::state::ServerState;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,agent_server=debug")),
        )
        .init();

    let bind: SocketAddr = std::env::var("CAD_SERVER_BIND")
        .unwrap_or_else(|_| "0.0.0.0:9120".into())
        .parse()
        .context("CAD_SERVER_BIND parse")?;

    let token = std::env::var("CAD_SERVER_TOKEN").context(
        "CAD_SERVER_TOKEN is required — set a long random secret. Clients pass it as `Authorization: Bearer …`."
    )?;
    if token.len() < 24 {
        anyhow::bail!("CAD_SERVER_TOKEN must be at least 24 characters");
    }

    let state = Arc::new(ServerState::boot(token).await?);

    let api = Router::new()
        .route("/health", get(api::health))
        .route("/version", get(api::version))
        .route("/changelog", get(api::changelog))
        .route("/auth/probe", post(api::auth_probe))
        .route("/turns", post(api::start_turn))
        .route("/turns/:turn_id", delete(api::cancel_turn))
        .route("/sessions", get(api::list_sessions))
        .route("/sessions/:id", patch(api::rename_session).delete(api::delete_session))
        .route("/sessions/:id/messages", get(api::load_messages))
        .route("/sessions/:id/persist", post(api::persist_session))
        .route("/search", get(api::search_messages))
        .route("/memory", get(api::read_memory).put(api::write_memory))
        .route("/skills", get(api::list_skills))
        .route("/skills/:name", get(api::read_skill).put(api::write_skill));

    let ws = Router::new().route("/stream/:turn_id", get(stream::ws_stream));

    let mut app = Router::new()
        .nest("/api", api)
        .nest("/ws", ws)
        .with_state(state.clone());

    // Browser web UI — when CAD_STATIC_DIR points at a Vite build dir, mount
    // it as the fallback so `/`, `/assets/*`, and SPA paths all resolve.
    // `/api/*` and `/ws/*` keep precedence because `fallback_service` only
    // fires when nothing else matched.
    if let Ok(static_dir) = std::env::var("CAD_STATIC_DIR") {
        let dir = std::path::PathBuf::from(&static_dir);
        if dir.is_dir() {
            info!(path = %static_dir, "serving Vite build as fallback");
            // serve_dir + try_index_html on 404 = SPA-friendly: deep links
            // like /chat/abc fall through to index.html where the React
            // router takes over.
            let serve = tower_http::services::ServeDir::new(&dir)
                .append_index_html_on_directories(true)
                .not_found_service(tower_http::services::ServeFile::new(dir.join("index.html")));
            app = app.fallback_service(serve);
        } else {
            tracing::warn!(path = %static_dir, "CAD_STATIC_DIR set but not a directory; skipping");
        }
    }

    let app = app
        .layer(TraceLayer::new_for_http())
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        );

    info!(%bind, "agent-server listening");
    let listener = tokio::net::TcpListener::bind(bind).await?;
    axum::serve(listener, app.into_make_service())
        .await
        .context("axum::serve")?;
    Ok(())
}

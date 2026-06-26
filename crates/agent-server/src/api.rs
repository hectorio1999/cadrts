//! HTTP API handlers.
//!
//! All handlers are thin — they shape the wire JSON, do auth, and call into
//! `agent-core`. Streaming (`/ws/stream/:turn_id`) lives in `stream.rs`.

use agent_core::agent::{AgentTransport, PermissionMode, TurnOutcome, TurnRequest};
use agent_core::auth::AuthStatus;
use agent_core::cron::{self, Job, RunRecord};
use agent_core::db::{self, MessageRow, SessionRow};
use agent_core::memory::{self, Skill};
use agent_core::paths;
use axum::body::{Body, Bytes};
use axum::extract::{Path, Query, Request, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use tower::ServiceExt;
use tower_http::services::ServeFile;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::{broadcast, oneshot};

use crate::auth::Authed;
use crate::state::{ActiveTurn, ServerState, TurnPump};

// -------------------- unauth --------------------

#[derive(Serialize)]
pub struct Health {
    pub ok: bool,
    pub version: &'static str,
}

pub async fn health() -> impl IntoResponse {
    Json(Health {
        ok: true,
        version: env!("CARGO_PKG_VERSION"),
    })
}

// -------------------- unauth (so UpdateBadge can poll early) --------------------

/// Build commit, HEAD commit, and how many commits ahead the source tree
/// is. The UpdateBadge polls this every 60s.
///
/// Deliberately not bearer-gated: the response carries no secrets, and
/// the badge has to work before the user signs in (so they know whether
/// they're on the latest). If you ever start returning anything sensitive
/// from here, move it behind `Authed`.
pub async fn version() -> impl IntoResponse {
    Json(crate::version::version_info())
}

/// Last N commits from the server's source tree. Same auth posture as
/// `/version` — public, no secrets in the payload.
pub async fn changelog() -> Result<Json<crate::version::ChangelogResponse>, (StatusCode, String)> {
    crate::version::changelog(10)
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

// -------------------- auth --------------------

#[derive(Deserialize)]
pub struct AuthProbeBody {
    pub credentials_json: String,
}

#[derive(Serialize)]
pub struct AuthProbeResp {
    pub ok: bool,
    pub subscription_type: Option<String>,
    pub expires_at: Option<i64>,
    pub reason: Option<String>,
}

/// Validate a credential blob (shape + recency) WITHOUT spawning the CLI.
/// Lets the Settings UI tell the user "your token looks fine" before they
/// fire a real turn.
pub async fn auth_probe(
    _auth: Authed,
    State(_state): State<Arc<ServerState>>,
    Json(body): Json<AuthProbeBody>,
) -> impl IntoResponse {
    let v: serde_json::Value = match serde_json::from_str(&body.credentials_json) {
        Ok(v) => v,
        Err(e) => {
            return Json(AuthProbeResp {
                ok: false,
                subscription_type: None,
                expires_at: None,
                reason: Some(format!("invalid JSON: {e}")),
            })
        }
    };
    let oauth = v.get("claudeAiOauth");
    if oauth.is_none() {
        return Json(AuthProbeResp {
            ok: false,
            subscription_type: None,
            expires_at: None,
            reason: Some("missing claudeAiOauth block".into()),
        });
    }
    let oauth = oauth.unwrap();
    Json(AuthProbeResp {
        ok: true,
        subscription_type: oauth
            .get("subscriptionType")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        expires_at: oauth.get("expiresAt").and_then(|v| v.as_i64()),
        reason: None,
    })
}

// -------------------- turns --------------------

#[derive(Deserialize)]
pub struct StartTurnBody {
    pub turn_id: String,
    pub prompt: String,
    pub resume_session_id: Option<String>,
    pub permission_mode: Option<PermissionMode>,
    pub allowed_tools: Option<Vec<String>>,
    #[serde(default)]
    pub disallowed_tools: Option<Vec<String>>,
    #[serde(default)]
    pub skill_directive: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    pub cwd: Option<String>,
    /// The caller's `~/.claude/.credentials.json` bytes.
    ///
    /// - **Tauri/desktop clients** ship their local credentials with every
    ///   turn (multi-tenant story). The server stages them in a per-turn
    ///   HOME and deletes after.
    /// - **Browser clients** can't read the user's filesystem, so they
    ///   omit this. In that case the child inherits the server's own HOME
    ///   and reads `~/.claude/.credentials.json` from there — i.e. the
    ///   credentials file that lives on the LXC, populated by running
    ///   `claude login` as the `cad` user once during bootstrap.
    pub credentials_json: Option<String>,
}

#[derive(Serialize)]
pub struct StartTurnResp {
    pub turn_id: String,
    pub ws_path: String,
}

/// Begin a turn. Returns immediately with the WS path the caller should
/// connect to in order to receive events. The turn runs in the background.
pub async fn start_turn(
    _auth: Authed,
    State(state): State<Arc<ServerState>>,
    Json(body): Json<StartTurnBody>,
) -> Result<Json<StartTurnResp>, (StatusCode, String)> {
    let append = memory::build_system_append(&body.prompt)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let req = TurnRequest {
        prompt: body.prompt,
        resume_session_id: body.resume_session_id,
        append_system_prompt: append,
        permission_mode: body.permission_mode,
        allowed_tools: body.allowed_tools,
        disallowed_tools: body.disallowed_tools,
        skill_directive: body.skill_directive,
        model: body.model,
        cwd: body.cwd,
        credentials_json: body.credentials_json,
    };

    let mut handle = state
        .transport
        .start_turn(req)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    // Broadcast channel — bounded but generous. Late subscribers see only
    // events from the point they subscribe; that's fine because the WS path
    // is meant to be opened immediately after start_turn returns.
    let (tx, _rx0) = broadcast::channel::<TurnPump>(256);

    // Move the cancel oneshot out of the TurnHandle, leaving the rest to the
    // pumping task.
    let cancel = handle.cancel;

    {
        let mut g = state.running.lock().await;
        g.insert(
            body.turn_id.clone(),
            ActiveTurn {
                cancel,
                events: tx.clone(),
            },
        );
    }

    let turn_id_pump = body.turn_id.clone();
    let state_pump = state.clone();
    tokio::spawn(async move {
        while let Some(ev) = handle.events.recv().await {
            let _ = tx.send(TurnPump::Event(ev));
        }
        // Transport's join handle delivers the outcome OR an error.
        let terminal = match handle.join.await {
            Ok(Ok(outcome)) => {
                let json = serde_json::to_string(&outcome).unwrap_or_else(|_| "{}".into());
                TurnPump::Outcome(json)
            }
            Ok(Err(e)) => TurnPump::Error(e.to_string()),
            Err(e) => TurnPump::Error(format!("task crashed: {e}")),
        };
        let _ = tx.send(terminal.clone());
        // Retain the terminal frame briefly so a client whose WS dropped during
        // the turn can reconnect and still get the result. Prune entries >2 min.
        {
            let now = std::time::Instant::now();
            let mut c = state_pump.completed.lock().await;
            c.retain(|_, v| now.duration_since(v.at) < std::time::Duration::from_secs(120));
            c.insert(
                turn_id_pump.clone(),
                crate::state::CompletedTurn { terminal, at: now },
            );
        }
        // Remove the registration; broadcast tx dropping closes subscribers.
        state_pump.running.lock().await.remove(&turn_id_pump);
    });

    Ok(Json(StartTurnResp {
        turn_id: body.turn_id.clone(),
        ws_path: format!("/ws/stream/{}", body.turn_id),
    }))
}

#[derive(Serialize)]
pub struct CancelResp {
    pub cancelled: bool,
}

pub async fn cancel_turn(
    _auth: Authed,
    State(state): State<Arc<ServerState>>,
    Path(turn_id): Path<String>,
) -> impl IntoResponse {
    let mut g = state.running.lock().await;
    let cancelled = if let Some(turn) = g.remove(&turn_id) {
        let _ = turn.cancel.send(());
        true
    } else {
        false
    };
    Json(CancelResp { cancelled })
}

// -------------------- uploads (chat image attachments) --------------------

/// Hard ceiling enforced in the handler. The route also carries a
/// `DefaultBodyLimit` (axum's default is 2 MB) set a little above this so an
/// oversize image yields a clean 413 here rather than a generic body-limit 413.
const MAX_UPLOAD_BYTES: usize = 12 * 1024 * 1024;
/// Staged attachments older than this are swept on the next upload.
const UPLOAD_TTL_DAYS: u64 = 14;

#[derive(Deserialize)]
pub struct UploadQuery {
    /// Original client filename — echoed back for display only; never used to
    /// build the on-disk path (the server names files itself).
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Serialize)]
pub struct UploadResp {
    /// Absolute path on the server. The caller references this in the prompt so
    /// the per-turn `claude` reads it with its Read tool.
    pub path: String,
    pub filename: String,
    pub bytes: usize,
}

/// Stage a composer image attachment on the server's filesystem.
///
/// Raw image bytes in the body, optional `?name=` for display. The file lands
/// in `uploads_dir()` (inside the unit's `ReadWritePaths`) where the per-turn
/// `claude` child can read it — ProtectHome=read-only still permits reads. The
/// server names the file itself (`up-<uuid>.<ext>`), so a hostile client
/// filename can't traverse out of the directory.
pub async fn upload_image(
    _auth: Authed,
    State(_state): State<Arc<ServerState>>,
    Query(q): Query<UploadQuery>,
    body: Bytes,
) -> Result<Json<UploadResp>, (StatusCode, String)> {
    if body.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "empty upload".into()));
    }
    if body.len() > MAX_UPLOAD_BYTES {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            format!(
                "image too large ({} bytes; max {} MB)",
                body.len(),
                MAX_UPLOAD_BYTES / (1024 * 1024)
            ),
        ));
    }
    let ext = sniff_image_ext(&body).ok_or((
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
        "unsupported file type — only PNG, JPEG, GIF, and WEBP images are accepted".to_string(),
    ))?;

    let dir = paths::uploads_dir().map_err(internal)?;
    std::fs::create_dir_all(&dir).map_err(|e| internal(anyhow::anyhow!(e)))?;
    prune_old_uploads(&dir, UPLOAD_TTL_DAYS);

    let filename = format!("up-{}.{ext}", uuid::Uuid::new_v4());
    let path = dir.join(&filename);
    std::fs::write(&path, &body).map_err(|e| internal(anyhow::anyhow!(e)))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }

    Ok(Json(UploadResp {
        path: path.to_string_lossy().into_owned(),
        filename: q.name.unwrap_or(filename),
        bytes: body.len(),
    }))
}

/// Magic-byte sniff → canonical extension for the image types we accept.
/// Trusting the bytes (not the client-declared content-type) keeps a
/// mislabelled or hostile upload from landing with the wrong extension.
fn sniff_image_ext(b: &[u8]) -> Option<&'static str> {
    if b.len() >= 8 && b[..8] == [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A] {
        return Some("png");
    }
    if b.len() >= 3 && b[..3] == [0xFF, 0xD8, 0xFF] {
        return Some("jpg");
    }
    if b.len() >= 6 && (&b[..6] == b"GIF87a" || &b[..6] == b"GIF89a") {
        return Some("gif");
    }
    if b.len() >= 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        return Some("webp");
    }
    None
}

/// Best-effort sweep of attachments older than `ttl_days`. Cheap (the dir only
/// holds chat images) and never fails the request.
fn prune_old_uploads(dir: &std::path::Path, ttl_days: u64) {
    let ttl = std::time::Duration::from_secs(ttl_days * 24 * 60 * 60);
    let now = std::time::SystemTime::now();
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        if let Ok(modified) = meta.modified() {
            if now.duration_since(modified).map(|age| age > ttl).unwrap_or(false) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

// -------------------- downloads (outbound files Atlas shares) --------------------

/// Serve a file Atlas staged for the user via the `share` CLI (RTS-110).
///
/// The file lives at `outbox/<id>/<filename>`. We delegate to tower-http's
/// `ServeFile`, which sets the content-type from the extension and — crucially
/// for video — honours HTTP `Range` requests so the player can seek and stream
/// instead of buffering the whole file. `?download=1` flips the disposition to
/// an attachment so the browser saves rather than renders.
///
/// Auth: `Authed` accepts the bearer via header OR `?token=`, so an `<img>` /
/// `<video>` `src` (which can't set an Authorization header) still authenticates.
pub async fn download_file(
    _auth: Authed,
    State(_state): State<Arc<ServerState>>,
    Path(id): Path<String>,
    req: Request<Body>,
) -> Result<Response, (StatusCode, String)> {
    // `id` comes from the URL — allow only uuid characters so it can't escape
    // the outbox directory.
    if id.is_empty() || id.len() > 64 || !id.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-') {
        return Err((StatusCode::BAD_REQUEST, "invalid file id".into()));
    }
    let dir = paths::outbox_dir().map_err(internal)?.join(&id);
    let file = std::fs::read_dir(&dir)
        .ok()
        .and_then(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .find(|p| p.is_file())
        })
        .ok_or((StatusCode::NOT_FOUND, "no such file".into()))?;

    let download = req
        .uri()
        .query()
        .map(|q| q.split('&').any(|kv| kv == "download=1"))
        .unwrap_or(false);
    let fname = file
        .file_name()
        .map(|n| n.to_string_lossy().replace(['"', '\\', '\r', '\n'], "_"))
        .unwrap_or_else(|| "download".into());

    let mut resp = ServeFile::new(&file)
        .oneshot(req)
        .await
        .map_err(internal)?
        .into_response();
    if download {
        if let Ok(v) = format!("attachment; filename=\"{fname}\"").parse() {
            resp.headers_mut()
                .insert(axum::http::header::CONTENT_DISPOSITION, v);
        }
    }
    Ok(resp)
}

// -------------------- sessions / persistence --------------------

#[derive(Deserialize)]
pub struct PersistMessage {
    pub idx: i64,
    pub role: String,
    pub content_json: String,
}

#[derive(Deserialize)]
pub struct PersistSessionBody {
    pub session_id: String,
    pub title: String,
    pub claude_session_id: Option<String>,
    pub total_cost_delta: f64,
    pub messages: Vec<PersistMessage>,
}

pub async fn persist_session(
    _auth: Authed,
    State(state): State<Arc<ServerState>>,
    Path(_id): Path<String>,
    Json(body): Json<PersistSessionBody>,
) -> Result<Json<()>, (StatusCode, String)> {
    let mut g = state.db.lock().await;
    db::upsert_session(
        &g,
        &body.session_id,
        &body.title,
        body.claude_session_id.as_deref(),
        body.total_cost_delta,
    )
    .map_err(internal)?;
    let rows: Vec<(i64, String, String)> = body
        .messages
        .into_iter()
        .map(|m| (m.idx, m.role, m.content_json))
        .collect();
    db::replace_messages(&mut g, &body.session_id, &rows).map_err(internal)?;
    Ok(Json(()))
}

#[derive(Deserialize)]
pub struct ListSessionsQuery {
    pub limit: Option<i64>,
}

pub async fn list_sessions(
    _auth: Authed,
    State(state): State<Arc<ServerState>>,
    Query(q): Query<ListSessionsQuery>,
) -> Result<Json<Vec<SessionRow>>, (StatusCode, String)> {
    let g = state.db.lock().await;
    db::list_sessions(&g, q.limit.unwrap_or(200))
        .map(Json)
        .map_err(internal)
}

pub async fn load_messages(
    _auth: Authed,
    State(state): State<Arc<ServerState>>,
    Path(id): Path<String>,
) -> Result<Json<Vec<MessageRow>>, (StatusCode, String)> {
    let g = state.db.lock().await;
    db::load_messages(&g, &id).map(Json).map_err(internal)
}

#[derive(Deserialize)]
pub struct RenameBody {
    pub title: String,
}

pub async fn rename_session(
    _auth: Authed,
    State(state): State<Arc<ServerState>>,
    Path(id): Path<String>,
    Json(body): Json<RenameBody>,
) -> Result<Json<()>, (StatusCode, String)> {
    let g = state.db.lock().await;
    db::rename_session(&g, &id, &body.title).map_err(internal)?;
    Ok(Json(()))
}

pub async fn delete_session(
    _auth: Authed,
    State(state): State<Arc<ServerState>>,
    Path(id): Path<String>,
) -> Result<Json<()>, (StatusCode, String)> {
    let g = state.db.lock().await;
    db::delete_session(&g, &id).map_err(internal)?;
    Ok(Json(()))
}

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: String,
    pub limit: Option<i64>,
}

pub async fn search_messages(
    _auth: Authed,
    State(state): State<Arc<ServerState>>,
    Query(p): Query<SearchQuery>,
) -> Result<Json<Vec<MessageRow>>, (StatusCode, String)> {
    let g = state.db.lock().await;
    db::search(&g, &p.q, p.limit.unwrap_or(50))
        .map(Json)
        .map_err(internal)
}

// -------------------- memory --------------------

pub async fn read_memory(
    _auth: Authed,
    State(_state): State<Arc<ServerState>>,
) -> Result<String, (StatusCode, String)> {
    memory::read_memory().map_err(internal)
}

pub async fn write_memory(
    _auth: Authed,
    State(_state): State<Arc<ServerState>>,
    body: String,
) -> Result<Json<()>, (StatusCode, String)> {
    let p = paths::memory_path().map_err(internal)?;
    std::fs::write(p, body).map_err(|e| internal(anyhow::anyhow!(e)))?;
    Ok(Json(()))
}

// -------------------- skills --------------------

pub async fn list_skills(
    _auth: Authed,
    State(_state): State<Arc<ServerState>>,
) -> Result<Json<Vec<Skill>>, (StatusCode, String)> {
    memory::list_skills().map(Json).map_err(internal)
}

pub async fn read_skill(
    _auth: Authed,
    State(_state): State<Arc<ServerState>>,
    Path(name): Path<String>,
) -> Result<String, (StatusCode, String)> {
    // Same path-traversal guard as the write path — the name comes from the URL.
    validate_skill_name(&name)?;
    let path = paths::skills_dir().map_err(internal)?.join(format!("{name}.md"));
    std::fs::read_to_string(&path).map_err(|e| internal(anyhow::anyhow!(e)))
}

pub async fn write_skill(
    _auth: Authed,
    State(_state): State<Arc<ServerState>>,
    Path(name): Path<String>,
    body: String,
) -> Result<Json<()>, (StatusCode, String)> {
    validate_skill_name(&name)?;
    let path = paths::skills_dir().map_err(internal)?.join(format!("{name}.md"));
    std::fs::write(&path, body).map_err(|e| internal(anyhow::anyhow!(e)))?;
    Ok(Json(()))
}

// -------------------- helpers --------------------

/// Reject skill names that could escape the skills directory or hit dotfiles.
/// Applied on both read and write since the name is caller-supplied. `:` is
/// rejected too (NTFS alternate-data-stream writes) so the guard holds if the
/// server is ever run on Windows.
fn validate_skill_name(name: &str) -> Result<(), (StatusCode, String)> {
    if name.is_empty() || name.contains(['/', '\\', '.', ':', '\0']) {
        return Err((StatusCode::BAD_REQUEST, "invalid skill name".into()));
    }
    Ok(())
}

fn internal<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

// -------------------- scheduled jobs --------------------

/// A job plus everything the manager UI needs to render it.
#[derive(Serialize)]
pub struct JobView {
    #[serde(flatten)]
    pub job: Job,
    /// Next fire time (epoch millis), if the schedule is valid.
    pub next_run: Option<i64>,
    /// Plain-English schedule for display.
    pub schedule_human: String,
    /// Most recent run, if any.
    pub last_run: Option<RunRecord>,
}

pub async fn list_jobs(
    _auth: Authed,
    State(_state): State<Arc<ServerState>>,
) -> Result<Json<Vec<JobView>>, (StatusCode, String)> {
    let jobs = cron::load_jobs().map_err(internal)?;
    let views = jobs
        .into_iter()
        .map(|j| JobView {
            next_run: cron::next_run(&j),
            schedule_human: cron::human_schedule(&j),
            last_run: cron::last_run(&j.id).ok().flatten(),
            job: j,
        })
        .collect();
    Ok(Json(views))
}

/// Create or replace a job (the UI's "new/edit" form posts a full Job).
pub async fn create_job(
    _auth: Authed,
    State(_state): State<Arc<ServerState>>,
    Json(mut job): Json<Job>,
) -> Result<Json<Job>, (StatusCode, String)> {
    if job.id.trim().is_empty() {
        job.id = cron::sanitize_id(&job.name.to_lowercase().replace(' ', "-"));
    } else {
        job.id = cron::sanitize_id(&job.id);
    }
    if job.id.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "job needs a name or id".into()));
    }
    cron::save_job(&mut job).map_err(internal)?;
    Ok(Json(job))
}

/// Partial update — merges the posted fields onto the existing job. Used for
/// pause/resume (`{"enabled":false}`), reschedule, rename, etc.
pub async fn update_job(
    _auth: Authed,
    State(_state): State<Arc<ServerState>>,
    Path(id): Path<String>,
    Json(patch): Json<serde_json::Value>,
) -> Result<Json<Job>, (StatusCode, String)> {
    let job = cron::load_job(&id)
        .map_err(internal)?
        .ok_or((StatusCode::NOT_FOUND, "no such job".into()))?;
    let mut v = serde_json::to_value(&job).map_err(internal)?;
    if let (Some(obj), Some(p)) = (v.as_object_mut(), patch.as_object()) {
        for (k, val) in p {
            if k != "id" {
                obj.insert(k.clone(), val.clone());
            }
        }
    }
    let mut merged: Job = serde_json::from_value(v).map_err(internal)?;
    cron::save_job(&mut merged).map_err(internal)?;
    Ok(Json(merged))
}

pub async fn delete_job(
    _auth: Authed,
    State(_state): State<Arc<ServerState>>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    cron::delete_job(&id).map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

/// Run a job immediately (out of schedule). Fire-and-forget — the run is
/// appended to history when it finishes; the UI refreshes the run list.
pub async fn run_job_now(
    _auth: Authed,
    State(state): State<Arc<ServerState>>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let job = cron::load_job(&id)
        .map_err(internal)?
        .ok_or((StatusCode::NOT_FOUND, "no such job".into()))?;
    tokio::spawn(async move {
        if let Err(e) = crate::scheduler::run_job(&state, &job, "manual").await {
            tracing::warn!(error = ?e, "manual job run failed");
        }
    });
    Ok(StatusCode::ACCEPTED)
}

#[derive(Deserialize)]
pub struct RunsQuery {
    #[serde(default)]
    pub limit: Option<usize>,
}

pub async fn job_runs(
    _auth: Authed,
    State(_state): State<Arc<ServerState>>,
    Path(id): Path<String>,
    Query(q): Query<RunsQuery>,
) -> Result<Json<Vec<RunRecord>>, (StatusCode, String)> {
    let runs = cron::load_runs(&id, q.limit.unwrap_or(50)).map_err(internal)?;
    Ok(Json(runs))
}

// Silence the unused warning while we don't expose auth_status remotely yet.
#[allow(dead_code)]
fn _hint(_: AuthStatus) {}
#[allow(dead_code)]
fn _hint2(_: TurnOutcome) {}
#[allow(dead_code)]
fn _hint3(_: oneshot::Sender<()>) {}

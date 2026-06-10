//! Scheduled automations ("cron jobs").
//!
//! A job is a small JSON file in `~/.cad/jobs/<id>.json`. The agent creates and
//! edits these with its ordinary file tools (same pattern as self-improving
//! skills); the server-side scheduler in `agent-server` loads them every tick,
//! decides which are due, and runs each one as a normal headless Atlas turn
//! whose prompt is the job's `prompt`. Run history is appended as JSONL under
//! `jobs/.runs/<id>.jsonl`.
//!
//! Schedules are stored as ordinary 5-field cron (`min hour dom mon dow`) — what
//! users and the agent know — and normalized to the 6-field form the `cron`
//! crate wants (it expects a leading seconds field) at evaluation time. Times
//! are evaluated in each job's IANA `timezone`.

use anyhow::{Context, Result};
use chrono::{TimeZone, Utc};
use serde::{Deserialize, Serialize};
use std::str::FromStr;

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn default_true() -> bool {
    true
}
fn default_tz() -> String {
    "America/New_York".to_string()
}
fn default_notify() -> String {
    "on_change".to_string()
}

/// A scheduled automation definition (the on-disk `<id>.json`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    /// kebab-case id; also the filename stem.
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// 5-field cron (`min hour dom mon dow`). 6/7-field is accepted too.
    pub schedule: String,
    /// IANA timezone, e.g. `America/New_York`.
    #[serde(default = "default_tz")]
    pub timezone: String,
    /// The natural-language task Atlas runs each time this fires. This IS the
    /// job — it can include its own notification instructions ("email me if …").
    pub prompt: String,
    /// plan | default | acceptEdits | bypassPermissions. Defaults to `default`
    /// (asks before edits/commands) — scheduled jobs run unattended, so we lean
    /// safe unless the user opted into more.
    #[serde(default)]
    pub permission_mode: Option<String>,
    /// Tools to auto-approve. None = the agent's defaults.
    #[serde(default)]
    pub allowed_tools: Option<Vec<String>>,
    /// Model alias/id. None = plan default.
    #[serde(default)]
    pub model: Option<String>,
    /// Working directory. None = agent HOME.
    #[serde(default)]
    pub cwd: Option<String>,
    /// Notification intent (metadata/hint; the prompt does the actual sending):
    /// `always` | `on_change` | `on_failure`.
    #[serde(default = "default_notify")]
    pub notify: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

/// One execution of a job (appended to `jobs/.runs/<id>.jsonl`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunRecord {
    pub started_at: i64,
    pub finished_at: i64,
    pub ok: bool,
    /// Trimmed final text from the turn (what Atlas produced).
    pub summary: String,
    #[serde(default)]
    pub cost: Option<f64>,
    #[serde(default)]
    pub error: Option<String>,
    /// Hash of the output, for `on_change` notification decisions.
    #[serde(default)]
    pub output_hash: Option<String>,
    /// Whether this run was considered notable (changed / failed) per `notify`.
    #[serde(default)]
    pub changed: bool,
    /// How the run was triggered: "schedule" | "manual".
    #[serde(default)]
    pub trigger: String,
}

fn cheap_hash(s: &str) -> String {
    // FNV-1a 64; we only need change-detection, not crypto.
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

// ----------------------- job persistence -----------------------

pub fn load_jobs() -> Result<Vec<Job>> {
    let dir = crate::paths::jobs_dir()?;
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for entry in std::fs::read_dir(&dir)?.flatten() {
        let p = entry.path();
        if !p.is_file() || p.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        match std::fs::read_to_string(&p).ok().and_then(|s| serde_json::from_str::<Job>(&s).ok()) {
            Some(mut job) => {
                // Trust the filename stem as the id if the field is blank.
                if job.id.is_empty() {
                    if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                        job.id = stem.to_string();
                    }
                }
                out.push(job);
            }
            None => tracing::warn!(path = %p.display(), "skipping unparseable job file"),
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

pub fn load_job(id: &str) -> Result<Option<Job>> {
    let path = crate::paths::jobs_dir()?.join(format!("{}.json", sanitize_id(id)));
    if !path.exists() {
        return Ok(None);
    }
    Ok(serde_json::from_str(&std::fs::read_to_string(&path)?).ok())
}

pub fn save_job(job: &mut Job) -> Result<()> {
    if job.created_at == 0 {
        job.created_at = now_ms();
    }
    job.updated_at = now_ms();
    let dir = crate::paths::jobs_dir()?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}.json", sanitize_id(&job.id)));
    std::fs::write(&path, serde_json::to_string_pretty(job)?)
        .with_context(|| format!("write job {}", path.display()))?;
    Ok(())
}

pub fn delete_job(id: &str) -> Result<bool> {
    let path = crate::paths::jobs_dir()?.join(format!("{}.json", sanitize_id(id)));
    if path.exists() {
        std::fs::remove_file(&path)?;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Strip anything that could escape the jobs dir or break the filename.
pub fn sanitize_id(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

// ----------------------- run history -----------------------

pub fn append_run(job_id: &str, rec: &RunRecord) -> Result<()> {
    let dir = crate::paths::job_runs_dir()?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}.jsonl", sanitize_id(job_id)));
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&path)?;
    writeln!(f, "{}", serde_json::to_string(rec)?)?;
    Ok(())
}

/// Load up to `limit` most-recent runs (newest first).
pub fn load_runs(job_id: &str, limit: usize) -> Result<Vec<RunRecord>> {
    let path = crate::paths::job_runs_dir()?.join(format!("{}.jsonl", sanitize_id(job_id)));
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = std::fs::read_to_string(&path)?;
    let mut runs: Vec<RunRecord> = content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<RunRecord>(l).ok())
        .collect();
    runs.reverse();
    runs.truncate(limit);
    Ok(runs)
}

pub fn last_run(job_id: &str) -> Result<Option<RunRecord>> {
    Ok(load_runs(job_id, 1)?.into_iter().next())
}

/// Build a RunRecord from a turn's output, deciding `changed` vs the prior run.
pub fn build_run(
    job: &Job,
    started_at: i64,
    ok: bool,
    final_text: Option<String>,
    cost: Option<f64>,
    error: Option<String>,
    trigger: &str,
    prev_hash: Option<&str>,
) -> RunRecord {
    let summary = final_text.unwrap_or_default();
    let trimmed: String = summary.chars().take(4000).collect();
    let hash = cheap_hash(&trimmed);
    let output_differs = prev_hash.map(|h| h != hash).unwrap_or(true);
    // "changed" = is this run notable enough to surface, per the job's policy.
    let changed = match job.notify.as_str() {
        "always" => true,
        "on_failure" => !ok,
        // on_change (default): a failure or a different result than last time.
        _ => !ok || output_differs,
    };
    RunRecord {
        started_at,
        finished_at: now_ms(),
        ok,
        summary: trimmed,
        cost,
        error,
        output_hash: Some(hash),
        changed,
        trigger: trigger.to_string(),
    }
}

// ----------------------- scheduling -----------------------

/// Normalize a 5-field cron to the 6-field form the `cron` crate expects (it
/// uses a leading seconds field). 6/7-field expressions pass through.
fn normalize_cron(expr: &str) -> String {
    let fields: Vec<&str> = expr.split_whitespace().collect();
    match fields.len() {
        5 => format!("0 {}", fields.join(" ")),
        _ => expr.to_string(),
    }
}

/// The next fire time strictly after `after_ms`, in epoch millis (UTC), or None
/// if the schedule is invalid / has no upcoming time.
pub fn next_run_after(job: &Job, after_ms: i64) -> Option<i64> {
    let tz: chrono_tz::Tz = job.timezone.parse().unwrap_or(chrono_tz::UTC);
    let schedule = cron::Schedule::from_str(&normalize_cron(&job.schedule)).ok()?;
    let after_utc = Utc.timestamp_millis_opt(after_ms).single()?;
    let after_tz = after_utc.with_timezone(&tz);
    schedule.after(&after_tz).next().map(|dt| dt.timestamp_millis())
}

/// Is this job due to run now? Uses the last run's start (or `created_at`) as
/// the baseline, so a server that was down briefly fires a missed slot exactly
/// once rather than backfilling every missed tick.
pub fn is_due(job: &Job, baseline_ms: i64, now_ms_: i64) -> bool {
    match next_run_after(job, baseline_ms) {
        Some(next) => next <= now_ms_,
        None => false,
    }
}

/// Millis since epoch of the job file's last modification (≈ when the agent
/// wrote it), used as the schedule baseline for a job that has never run and
/// carries no `created_at`. This makes a fresh job first fire at its next real
/// slot rather than immediately.
pub fn job_file_mtime(id: &str) -> Option<i64> {
    let path = crate::paths::jobs_dir().ok()?.join(format!("{}.json", sanitize_id(id)));
    let meta = std::fs::metadata(path).ok()?;
    let dur = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(dur.as_millis() as i64)
}

/// The baseline the scheduler should measure the next fire from: the last run's
/// start if it has run, else its declared `created_at`, else the file mtime,
/// else now.
pub fn baseline_for(job: &Job) -> i64 {
    if let Ok(Some(r)) = last_run(&job.id) {
        return r.started_at;
    }
    if job.created_at > 0 {
        return job.created_at;
    }
    job_file_mtime(&job.id).unwrap_or_else(now_ms)
}

/// Compute the next fire time after *now* for display, in epoch millis.
pub fn next_run(job: &Job) -> Option<i64> {
    next_run_after(job, now_ms())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(schedule: &str, tz: &str) -> Job {
        Job {
            id: "t".into(), name: "Test".into(), description: String::new(),
            schedule: schedule.into(), timezone: tz.into(), prompt: String::new(),
            permission_mode: None, allowed_tools: None, model: None, cwd: None,
            notify: "on_change".into(), enabled: true, created_at: 0, updated_at: 0,
        }
    }

    #[test]
    fn next_run_is_future_and_within_a_day() {
        let j = job("0 8 * * *", "America/New_York");
        let base = Utc::now().timestamp_millis();
        let n = next_run_after(&j, base).expect("daily schedule should resolve");
        assert!(n > base, "next run must be in the future");
        assert!(n - base <= 24 * 3600 * 1000 + 60_000, "daily should be <= ~24h away");
    }

    #[test]
    fn due_detection() {
        let j = job("*/5 * * * *", "UTC");
        let now = Utc::now().timestamp_millis();
        assert!(is_due(&j, now - 10 * 60 * 1000, now), "a 5-min slot passed → due");
        assert!(!is_due(&j, now, now), "no slot since baseline=now → not due");
    }

    #[test]
    fn human_labels() {
        assert_eq!(human_schedule(&job("0 8 * * *", "America/New_York")), "daily at 8:00 AM America/New_York");
        assert_eq!(human_schedule(&job("*/15 * * * *", "UTC")), "every 15 minutes");
        assert!(human_schedule(&job("0 17 * * FRI", "America/New_York")).contains("Friday"));
        assert!(human_schedule(&job("30 9 * * 1-5", "America/New_York")).contains("weekday"));
    }
}

/// Best-effort plain-English schedule for display (covers the common shapes;
/// falls back to the raw cron expression).
pub fn human_schedule(job: &Job) -> String {
    let f: Vec<&str> = job.schedule.split_whitespace().collect();
    let tz = &job.timezone;
    if f.len() == 5 {
        let (min, hour, dom, mon, dow) = (f[0], f[1], f[2], f[3], f[4]);
        let at = |h: &str, m: &str| -> Option<String> {
            let h: u32 = h.parse().ok()?;
            let m: u32 = m.parse().ok()?;
            let (h12, ap) = if h == 0 { (12, "AM") } else if h < 12 { (h, "AM") } else if h == 12 { (12, "PM") } else { (h - 12, "PM") };
            Some(format!("{}:{:02} {}", h12, m, ap))
        };
        if let Some(rest) = min.strip_prefix("*/") {
            return format!("every {} minutes", rest);
        }
        if min == "*" && hour == "*" {
            return "every minute".to_string();
        }
        if hour == "*" && dom == "*" && mon == "*" && dow == "*" {
            return format!("hourly at :{:0>2}", min);
        }
        if let Some(t) = at(hour, min) {
            if dom == "*" && mon == "*" && dow == "*" {
                return format!("daily at {} {}", t, tz);
            }
            if dow != "*" && dom == "*" {
                let days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
                let label = match dow.to_uppercase().as_str() {
                    "0" | "7" | "SUN" => "Sunday", "1" | "MON" => "Monday", "2" | "TUE" => "Tuesday",
                    "3" | "WED" => "Wednesday", "4" | "THU" => "Thursday", "5" | "FRI" => "Friday",
                    "6" | "SAT" => "Saturday", "1-5" | "MON-FRI" => "weekdays",
                    other => days.get(other.parse::<usize>().unwrap_or(9)).copied().unwrap_or("the scheduled day"),
                };
                return if label == "weekdays" {
                    format!("every weekday at {} {}", t, tz)
                } else {
                    format!("every {} at {} {}", label, t, tz)
                };
            }
            if dom != "*" {
                return format!("monthly on day {} at {} {}", dom, t, tz);
            }
        }
    }
    format!("cron `{}` ({})", job.schedule, tz)
}

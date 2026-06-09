//! Build-info + git-log surface for the UpdateBadge UI.
//!
//! What the client reads:
//!   GET /api/version    → what the server itself was built from
//!   GET /api/changelog  → the last N git commits in the source tree + how
//!                          many of them are ahead of the build
//!
//! The server "knows" its build commit because the deploy script bakes it
//! into the `CAD_BUILD_COMMIT` env var on the systemd unit. The "current"
//! commit comes from running `git rev-parse HEAD` against the source tree
//! at request time. When they diverge, the client shows the badge.
//!
//! Why env-var + runtime-git rather than `vergen` baked into the binary:
//! the deploy flow is `git pull && cargo build && restart`. If the binary
//! self-reported `vergen`'s commit, "Update Available" would only flip
//! after `cargo build` completes — too coarse. With this split, the badge
//! lights up the instant new commits land in the source tree, even before
//! the rebuild — which is the signal users actually want.

use anyhow::{Context, Result};
use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct VersionInfo {
    /// Commit SHA the running binary was built from. None if not baked in.
    pub build_commit: Option<String>,
    /// Short version of build_commit (first 7 chars).
    pub build_commit_short: Option<String>,
    /// `Cargo.toml` package version of the running binary.
    pub server_version: &'static str,
    /// HEAD of the source tree on disk right now.
    pub head_commit: Option<String>,
    pub head_commit_short: Option<String>,
    /// True if HEAD != build_commit (an update is available).
    pub update_available: bool,
    /// How many commits HEAD is ahead of the build.
    pub commits_ahead: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChangelogEntry {
    pub sha: String,
    pub short: String,
    pub subject: String,
    pub author: String,
    pub iso_date: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChangelogResponse {
    /// Commits in reverse-chronological order (newest first), capped.
    pub commits: Vec<ChangelogEntry>,
    /// How many commits sit between the current HEAD and the build commit.
    /// `0` means the running binary is current.
    pub commits_ahead_of_build: u32,
    /// Total commits the requested window would have contained if uncapped.
    /// Lets the UI render "+N more" when more exist beyond what we returned.
    pub total_commits_in_range: u32,
}

/// Where the server's own source tree lives. Defaults to `/opt/cad` (the
/// path the LXC bootstrap installs to) but honours `CAD_SOURCE_DIR` for
/// dev runs from the laptop.
fn source_dir() -> PathBuf {
    if let Ok(v) = std::env::var("CAD_SOURCE_DIR") {
        return PathBuf::from(v);
    }
    PathBuf::from("/opt/cad")
}

fn build_commit() -> Option<String> {
    std::env::var("CAD_BUILD_COMMIT")
        .ok()
        .filter(|s| !s.is_empty())
        .map(|s| s.trim().to_string())
}

fn run_git(args: &[&str]) -> Result<String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(source_dir())
        .output()
        .with_context(|| format!("spawn git {args:?}"))?;
    if !out.status.success() {
        anyhow::bail!(
            "git {:?} exited {}: {}",
            args,
            out.status,
            String::from_utf8_lossy(&out.stderr)
        );
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn short(sha: &str) -> String {
    sha.chars().take(7).collect()
}

pub fn version_info() -> VersionInfo {
    let build = build_commit();
    let head = run_git(&["rev-parse", "HEAD"]).ok();

    let commits_ahead = match (&build, &head) {
        (Some(b), Some(h)) if b != h => count_commits_between(b, h).unwrap_or(0),
        _ => 0,
    };
    let update_available = match (&build, &head) {
        (Some(b), Some(h)) => b != h,
        _ => false,
    };

    VersionInfo {
        build_commit: build.clone(),
        build_commit_short: build.as_deref().map(short),
        server_version: env!("CARGO_PKG_VERSION"),
        head_commit: head.clone(),
        head_commit_short: head.as_deref().map(short),
        update_available,
        commits_ahead,
    }
}

fn count_commits_between(from: &str, to: &str) -> Result<u32> {
    let n = run_git(&["rev-list", "--count", &format!("{from}..{to}")])?;
    Ok(n.parse().unwrap_or(0))
}

/// Read the last `limit` commits from the source tree.
pub fn changelog(limit: usize) -> Result<ChangelogResponse> {
    // Format: SHA \t subject \t author \t ISO-date
    let raw = run_git(&[
        "log",
        &format!("-n{limit}"),
        "--pretty=format:%H%x09%s%x09%an%x09%cI",
    ])?;
    let commits: Vec<ChangelogEntry> = raw
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(4, '\t');
            let sha = parts.next()?.to_string();
            let subject = parts.next()?.to_string();
            let author = parts.next()?.to_string();
            let iso_date = parts.next()?.to_string();
            Some(ChangelogEntry {
                short: short(&sha),
                sha,
                subject,
                author,
                iso_date,
            })
        })
        .collect();

    let commits_ahead_of_build = if let Some(b) = build_commit() {
        run_git(&["rev-list", "--count", &format!("{b}..HEAD")])
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0)
    } else {
        0
    };

    // Total commits in the source tree (capped to a reasonable scan window
    // — `--all` would scan every branch and dwarf the useful number).
    let total_commits_in_range = run_git(&["rev-list", "--count", "HEAD"])
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(commits.len() as u32);

    Ok(ChangelogResponse {
        commits,
        commits_ahead_of_build,
        total_commits_in_range,
    })
}

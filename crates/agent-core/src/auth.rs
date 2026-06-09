//! OAuth credential discovery for the Claude Code CLI.
//!
//! We never read or hand out the token itself — the CLI owns auth. We only
//! tell the UI whether the user is signed in, which plan, and when the token
//! expires (so we can show a sign-in prompt before a turn fails). To sign in,
//! the UI fires [`launch_login`] which shells out to `claude login`; that
//! command opens a browser and walks the user through OAuth. When it
//! returns, the CLI has rewritten the credential file.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthStatus {
    pub authenticated: bool,
    /// e.g. "max", "pro", "enterprise" — exact string echoed from the credential file.
    pub subscription_type: Option<String>,
    /// Unix millis. None if file unreadable.
    pub expires_at: Option<i64>,
    pub scopes: Option<Vec<String>>,
    pub credential_path: Option<String>,
    /// Friendly hint shown in the UI when `authenticated == false`.
    pub reason: Option<String>,
}

fn credentials_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join(".credentials.json"))
}

#[derive(Debug, Deserialize)]
struct CredFile {
    #[serde(rename = "claudeAiOauth")]
    oauth: Option<OauthBlock>,
}

#[derive(Debug, Deserialize)]
struct OauthBlock {
    #[serde(rename = "expiresAt")]
    expires_at: Option<i64>,
    scopes: Option<Vec<String>>,
    #[serde(rename = "subscriptionType")]
    subscription_type: Option<String>,
}

/// Inspect the credential file without ever surfacing the token itself.
pub fn status() -> AuthStatus {
    let Some(path) = credentials_path() else {
        return AuthStatus {
            authenticated: false,
            subscription_type: None,
            expires_at: None,
            scopes: None,
            credential_path: None,
            reason: Some("could not resolve user home directory".into()),
        };
    };

    if !path.exists() {
        return AuthStatus {
            authenticated: false,
            subscription_type: None,
            expires_at: None,
            scopes: None,
            credential_path: Some(path.to_string_lossy().to_string()),
            reason: Some(
                "no Claude Code session found — run `claude login` to authorise this device against your Max subscription"
                    .into(),
            ),
        };
    }

    match std::fs::read_to_string(&path)
        .context("read credentials")
        .and_then(|s| serde_json::from_str::<CredFile>(&s).context("parse credentials"))
    {
        Ok(cf) => {
            let oauth = cf.oauth;
            AuthStatus {
                authenticated: oauth.is_some(),
                subscription_type: oauth.as_ref().and_then(|o| o.subscription_type.clone()),
                expires_at: oauth.as_ref().and_then(|o| o.expires_at),
                scopes: oauth.as_ref().and_then(|o| o.scopes.clone()),
                credential_path: Some(path.to_string_lossy().to_string()),
                reason: None,
            }
        }
        Err(e) => AuthStatus {
            authenticated: false,
            subscription_type: None,
            expires_at: None,
            scopes: None,
            credential_path: Some(path.to_string_lossy().to_string()),
            reason: Some(format!("credentials unreadable: {e}")),
        },
    }
}

/// Fire `claude login` in a detached terminal so the user can complete OAuth.
/// We do *not* try to capture its output — it opens a browser and prints a
/// device code; the user finishes the flow there, and we re-poll
/// [`status()`] until the credential file updates.
pub fn launch_login(binary: &PathBuf) -> Result<()> {
    #[cfg(windows)]
    {
        // Open a new console so the device code is visible.
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &binary.to_string_lossy(), "login"])
            .creation_flags(CREATE_NEW_CONSOLE)
            .spawn()
            .context("spawn claude login")?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new(binary)
            .arg("login")
            .spawn()
            .context("spawn claude login")?;
        Ok(())
    }
}

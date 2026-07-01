//! Bearer auth middleware.
//!
//! Constant-time-compares a presented token against the server's configured
//! `CAD_SERVER_TOKEN`. Accepts the token from three places, in order:
//!
//!   1. `Authorization: Bearer <token>` header — preferred, used by HTTP
//!      API calls (curl, `RemoteTransport`, the browser fetch() path).
//!   2. `Sec-WebSocket-Protocol: bearer, <token>` — browsers can't set the
//!      `Authorization` header on WebSocket upgrades, so we accept the
//!      token as a subprotocol offer instead. This is the standard
//!      workaround for in-browser WS auth.
//!   3. `?token=<token>` query string — fallback for tools that can do
//!      neither of the above (and for direct dev probing with `curl`).
//!
//! Query-string tokens log into proxies; we accept them only because the
//! token is server-scoped (not an external-API key) and rotation is one
//! `systemctl restart`. If that ever changes, drop step 3.

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use std::sync::Arc;

use crate::state::ServerState;

/// Marker extracted on every authenticated route. Mere existence is the proof.
pub struct Authed;

/// Constant-time-ish byte compare. We don't reach for the `subtle` crate; this
/// is a single comparison on the hot path and the token is server-side.
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[async_trait::async_trait]
impl FromRequestParts<Arc<ServerState>> for Authed {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<ServerState>,
    ) -> Result<Self, Self::Rejection> {
        let presented = extract_token(parts);
        let Some(token) = presented else {
            return Err((StatusCode::UNAUTHORIZED, "missing Bearer token").into_response());
        };
        if !ct_eq(token.as_bytes(), state.bearer_token.as_bytes()) {
            return Err((StatusCode::UNAUTHORIZED, "invalid Bearer token").into_response());
        }
        Ok(Authed)
    }
}

/// Returns the first token found across the three accepted locations.
/// See module doc for the precedence rationale.
fn extract_token(parts: &Parts) -> Option<String> {
    // 1. Authorization: Bearer <token>
    if let Some(hdr) = parts.headers.get("authorization").and_then(|v| v.to_str().ok()) {
        if let Some(t) = hdr.strip_prefix("Bearer ").map(str::trim) {
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }

    // 2. Sec-WebSocket-Protocol: bearer, <token>
    //    Browser usage: new WebSocket(url, ["bearer", token]).
    //    The header arrives as a comma-separated list. We look for the
    //    `bearer` marker and pluck the token offered alongside it.
    if let Some(hdr) = parts
        .headers
        .get("sec-websocket-protocol")
        .and_then(|v| v.to_str().ok())
    {
        let mut offers = hdr.split(',').map(str::trim);
        let mut saw_marker = false;
        let mut maybe_token: Option<&str> = None;
        for offer in &mut offers {
            if offer.eq_ignore_ascii_case("bearer") {
                saw_marker = true;
            } else if !offer.is_empty() && maybe_token.is_none() {
                maybe_token = Some(offer);
            }
        }
        if saw_marker {
            if let Some(t) = maybe_token {
                return Some(t.to_string());
            }
        }
    }

    // 3. ?token=<token>
    if let Some(q) = parts.uri.query() {
        for pair in q.split('&') {
            if let Some((k, v)) = pair.split_once('=') {
                if k == "token" && !v.is_empty() {
                    // We don't bother with percent-decoding because the
                    // tokens we issue (`/dev/urandom | base64 | A-Za-z0-9`)
                    // contain only URL-safe ASCII.
                    return Some(v.to_string());
                }
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;

    /// Build request `Parts` from a list of headers + an optional query string.
    fn parts(headers: &[(&str, &str)], query: Option<&str>) -> Parts {
        let uri = match query {
            Some(q) => format!("/ws/stream/abc?{q}"),
            None => "/ws/stream/abc".to_string(),
        };
        let mut b = Request::builder().uri(uri);
        for (k, v) in headers {
            b = b.header(*k, *v);
        }
        b.body(()).unwrap().into_parts().0
    }

    #[test]
    fn ct_eq_matches_only_identical_bytes() {
        assert!(ct_eq(b"hunter2", b"hunter2"));
        assert!(!ct_eq(b"hunter2", b"hunter3"));
        assert!(!ct_eq(b"short", b"longer-token"));
        assert!(!ct_eq(b"", b"x"));
        assert!(ct_eq(b"", b""));
    }

    #[test]
    fn extract_prefers_authorization_header() {
        let p = parts(&[("authorization", "Bearer tok-abc")], None);
        assert_eq!(extract_token(&p).as_deref(), Some("tok-abc"));
    }

    #[test]
    fn extract_trims_and_rejects_empty_bearer() {
        let p = parts(&[("authorization", "Bearer   ")], None);
        // Whitespace-only after the prefix is not a token; fall through to None.
        assert_eq!(extract_token(&p), None);
    }

    #[test]
    fn extract_reads_websocket_subprotocol() {
        let p = parts(&[("sec-websocket-protocol", "bearer, tok-ws")], None);
        assert_eq!(extract_token(&p).as_deref(), Some("tok-ws"));
    }

    #[test]
    fn extract_websocket_marker_order_insensitive() {
        let p = parts(&[("sec-websocket-protocol", "tok-ws, bearer")], None);
        assert_eq!(extract_token(&p).as_deref(), Some("tok-ws"));
    }

    #[test]
    fn extract_falls_back_to_query_token() {
        let p = parts(&[], Some("download=1&token=tok-q"));
        assert_eq!(extract_token(&p).as_deref(), Some("tok-q"));
    }

    #[test]
    fn extract_header_beats_query() {
        let p = parts(&[("authorization", "Bearer tok-hdr")], Some("token=tok-q"));
        assert_eq!(extract_token(&p).as_deref(), Some("tok-hdr"));
    }

    #[test]
    fn extract_none_when_absent() {
        assert_eq!(extract_token(&parts(&[], None)), None);
    }
}

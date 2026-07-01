//! SQLite persistence.
//!
//! Schema (idempotent — every connection runs the migrations):
//!   sessions(id PK, title, created_at, last_at,
//!            claude_session_id, model, total_cost)
//!   messages(id PK, session_id FK, idx, ts, role, content_json)
//!   settings(key PK, value_json)
//!   messages_fts (FTS5, content='messages')
//!
//! `content_json` is the **full chat-row payload** the frontend renders: an
//! object shaped like `{ text, tools: [...] }` for assistants, or `{ text }`
//! for user messages. That keeps load_session a single roundtrip per row.

use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", &"WAL")?;
    conn.pragma_update(None, "foreign_keys", &"ON")?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT 'New session',
            created_at INTEGER NOT NULL,
            last_at INTEGER NOT NULL,
            claude_session_id TEXT,
            model TEXT,
            total_cost REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS sessions_last_at ON sessions(last_at DESC);

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            idx INTEGER NOT NULL,
            ts INTEGER NOT NULL,
            role TEXT NOT NULL,
            content_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id, idx);

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value_json TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
            content_json,
            session_id UNINDEXED,
            content='messages',
            content_rowid='id'
        );
        CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
            INSERT INTO messages_fts(rowid, content_json, session_id)
            VALUES (new.id, new.content_json, new.session_id);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, content_json, session_id)
            VALUES('delete', old.id, old.content_json, old.session_id);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, content_json, session_id)
            VALUES('delete', old.id, old.content_json, old.session_id);
            INSERT INTO messages_fts(rowid, content_json, session_id)
            VALUES (new.id, new.content_json, new.session_id);
        END;
        "#,
    )?;

    // Additive migration: `source` tags where a session came from ("desktop",
    // "telegram", ...) so the sidebar can group platform conversations
    // Hermes-style. Guarded because ALTER TABLE ADD COLUMN has no IF NOT
    // EXISTS in SQLite.
    let has_source = conn
        .prepare("SELECT 1 FROM pragma_table_info('sessions') WHERE name = 'source'")?
        .exists([])?;
    if !has_source {
        conn.execute_batch(
            "ALTER TABLE sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'desktop';",
        )?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRow {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub last_at: i64,
    pub claude_session_id: Option<String>,
    pub total_cost: f64,
    pub message_count: i64,
    /// Where the session originated: "desktop" (default) or a platform
    /// relay tag like "telegram".
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageRow {
    pub id: i64,
    pub idx: i64,
    pub ts: i64,
    pub role: String,
    /// Frontend-shaped JSON: `{ text: string, tools?: ToolRun[] }`.
    pub content_json: String,
}

/// Insert-or-update session header. Called once per turn; clobbers
/// `claude_session_id` / `total_cost` / `last_at` whenever a turn finishes.
pub fn upsert_session(
    conn: &Connection,
    id: &str,
    title: &str,
    claude_session_id: Option<&str>,
    total_cost_delta: f64,
    source: Option<&str>,
) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();
    let existing: Option<(String, f64)> = conn
        .query_row(
            "SELECT title, total_cost FROM sessions WHERE id = ?",
            [id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)),
        )
        .optional()?;

    if let Some((existing_title, existing_cost)) = existing {
        // Keep the user-edited title; only auto-fill if it's still default.
        let next_title = if existing_title == "New session" || existing_title.is_empty() {
            title
        } else {
            existing_title.as_str()
        };
        // `source` is sticky: only overwrite when the caller sends one.
        conn.execute(
            "UPDATE sessions SET title=?, last_at=?, claude_session_id=COALESCE(?, claude_session_id), total_cost=?, source=COALESCE(?, source) WHERE id=?",
            params![next_title, now, claude_session_id, existing_cost + total_cost_delta, source, id],
        )?;
    } else {
        conn.execute(
            "INSERT INTO sessions (id, title, created_at, last_at, claude_session_id, total_cost, source) VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![id, title, now, now, claude_session_id, total_cost_delta, source.unwrap_or("desktop")],
        )?;
    }
    Ok(())
}

/// Replace all messages for a session in one transaction. Using replace-all
/// rather than incremental insert keeps the wire format simple (the frontend
/// sends the whole transcript snapshot) at the cost of a per-turn rewrite.
/// Acceptable because messages-per-session is typically < 200.
pub fn replace_messages(
    conn: &mut Connection,
    session_id: &str,
    messages: &[(i64, String, String)], // (idx, role, content_json)
) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM messages WHERE session_id = ?", [session_id])?;
    {
        let now = chrono::Utc::now().timestamp_millis();
        let mut stmt = tx.prepare(
            "INSERT INTO messages (session_id, idx, ts, role, content_json) VALUES (?, ?, ?, ?, ?)",
        )?;
        for (idx, role, content) in messages {
            stmt.execute(params![session_id, idx, now, role, content])?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn list_sessions(conn: &Connection, limit: i64) -> Result<Vec<SessionRow>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.title, s.created_at, s.last_at, s.claude_session_id, s.total_cost,
                (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id),
                s.source
         FROM sessions s
         ORDER BY s.last_at DESC
         LIMIT ?",
    )?;
    let rows = stmt.query_map([limit], |r| {
        Ok(SessionRow {
            id: r.get(0)?,
            title: r.get(1)?,
            created_at: r.get(2)?,
            last_at: r.get(3)?,
            claude_session_id: r.get(4)?,
            total_cost: r.get(5)?,
            message_count: r.get(6)?,
            source: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn load_messages(conn: &Connection, session_id: &str) -> Result<Vec<MessageRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, idx, ts, role, content_json FROM messages WHERE session_id = ? ORDER BY idx ASC",
    )?;
    let rows = stmt.query_map([session_id], |r| {
        Ok(MessageRow {
            id: r.get(0)?,
            idx: r.get(1)?,
            ts: r.get(2)?,
            role: r.get(3)?,
            content_json: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn delete_session(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM sessions WHERE id = ?", [id])?;
    Ok(())
}

pub fn rename_session(conn: &Connection, id: &str, title: &str) -> Result<()> {
    conn.execute("UPDATE sessions SET title=? WHERE id=?", params![title, id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn session_source_defaults_to_desktop() {
        let conn = mem_db();
        upsert_session(&conn, "s1", "Hello", None, 0.0, None).unwrap();
        let rows = list_sessions(&conn, 10).unwrap();
        assert_eq!(rows[0].source, "desktop");
    }

    #[test]
    fn session_source_telegram_roundtrip_and_sticky() {
        let conn = mem_db();
        upsert_session(&conn, "tg1", "TG chat", Some("csid"), 0.0, Some("telegram")).unwrap();
        let rows = list_sessions(&conn, 10).unwrap();
        assert_eq!(rows[0].source, "telegram");

        // A later upsert WITHOUT a source (e.g. desktop client re-persisting
        // after the user continues the chat there) must not clobber the tag.
        upsert_session(&conn, "tg1", "TG chat", None, 0.01, None).unwrap();
        let rows = list_sessions(&conn, 10).unwrap();
        assert_eq!(rows[0].source, "telegram");
        assert_eq!(rows[0].claude_session_id.as_deref(), Some("csid"));
    }

    #[test]
    fn migration_adds_source_to_preexisting_table() {
        // Simulate a state.sqlite created before the `source` column existed.
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT 'New session',
                created_at INTEGER NOT NULL,
                last_at INTEGER NOT NULL,
                claude_session_id TEXT,
                model TEXT,
                total_cost REAL NOT NULL DEFAULT 0
            );
            INSERT INTO sessions (id, title, created_at, last_at) VALUES ('old', 'Old', 1, 1);",
        )
        .unwrap();
        init_schema(&conn).unwrap(); // must ALTER, not fail
        init_schema(&conn).unwrap(); // and stay idempotent
        let rows = list_sessions(&conn, 10).unwrap();
        assert_eq!(rows[0].id, "old");
        assert_eq!(rows[0].source, "desktop");
    }
}

pub fn search(conn: &Connection, query: &str, limit: i64) -> Result<Vec<MessageRow>> {
    let mut stmt = conn.prepare(
        "SELECT m.id, m.idx, m.ts, m.role, m.content_json
         FROM messages_fts f
         JOIN messages m ON m.id = f.rowid
         WHERE messages_fts MATCH ?
         ORDER BY m.ts DESC
         LIMIT ?",
    )?;
    let rows = stmt.query_map(params![query, limit], |r| {
        Ok(MessageRow {
            id: r.get(0)?,
            idx: r.get(1)?,
            ts: r.get(2)?,
            role: r.get(3)?,
            content_json: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

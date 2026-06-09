//! Typed view of Claude Code's `--output-format stream-json` event stream.
//!
//! These are deliberately conservative: every field is `Option<…>` where the
//! upstream schema is unstable, and unknown variants flow through verbatim as
//! [`AgentEvent::Other`]. The frontend never crashes on a new CLI version; it
//! just displays the raw JSON in the inspector pane.
//!
//! Vocabulary (observed in `2.1.169` of `@anthropic-ai/claude-code`):
//!   - `system/init`              — first event, carries session_id + capabilities
//!   - `assistant`                — partial assistant message (thinking / tool_use / text)
//!   - `user`                     — tool_result echo from the harness
//!   - `rate_limit_event`         — quota status
//!   - `result`                   — terminal aggregate (cost, tokens, num_turns)
//!   - `stream_event`             — fine-grained token deltas (when enabled)
//!
//! Anything else falls into [`AgentEvent::Other`].

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    System(SystemEvent),
    Assistant(AssistantEvent),
    User(UserEvent),
    RateLimitEvent(RateLimitEvent),
    Result(ResultEvent),
    StreamEvent(Value), // pass-through; we don't need it for v1
    #[serde(other)]
    Other,
}

impl AgentEvent {
    /// Stash the original JSON next to the parsed view — handy for the
    /// inspector pane and for forensic debugging when the schema drifts.
    pub fn from_line(raw: &str) -> (Option<AgentEvent>, Value) {
        let json: Value = serde_json::from_str(raw).unwrap_or(Value::String(raw.to_string()));
        let parsed: Option<AgentEvent> = serde_json::from_value(json.clone()).ok();
        (parsed, json)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemEvent {
    pub subtype: Option<String>,
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub permission_mode: Option<String>,
    pub api_key_source: Option<String>,
    pub claude_code_version: Option<String>,
    pub tools: Option<Vec<String>>,
    /// Whatever else the CLI ships.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantEvent {
    pub session_id: Option<String>,
    pub uuid: Option<String>,
    pub request_id: Option<String>,
    pub message: Option<AssistantMessage>,
    pub parent_tool_use_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantMessage {
    pub id: Option<String>,
    pub model: Option<String>,
    pub role: Option<String>,
    pub stop_reason: Option<String>,
    pub stop_sequence: Option<String>,
    pub content: Option<Vec<ContentBlock>>,
    pub usage: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text {
        text: String,
    },
    Thinking {
        #[serde(default)]
        thinking: String,
        #[serde(default)]
        signature: Option<String>,
    },
    ToolUse {
        id: String,
        name: String,
        input: Value,
        #[serde(default)]
        caller: Option<Value>,
    },
    ToolResult {
        tool_use_id: String,
        #[serde(default)]
        content: Value,
        #[serde(default)]
        is_error: Option<bool>,
    },
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserEvent {
    pub session_id: Option<String>,
    pub uuid: Option<String>,
    pub timestamp: Option<String>,
    pub message: Option<UserMessage>,
    pub tool_use_result: Option<Value>,
    pub parent_tool_use_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserMessage {
    pub role: Option<String>,
    pub content: Option<Vec<ContentBlock>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitEvent {
    pub uuid: Option<String>,
    pub session_id: Option<String>,
    pub rate_limit_info: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResultEvent {
    pub subtype: Option<String>,
    pub is_error: Option<bool>,
    pub session_id: Option<String>,
    pub result: Option<String>,
    pub total_cost_usd: Option<f64>,
    pub duration_ms: Option<u64>,
    pub num_turns: Option<u32>,
    pub terminal_reason: Option<String>,
    pub usage: Option<Value>,
    pub stop_reason: Option<String>,
}

# Architecture

This file is a deeper dive than the README. Read after you've gotten
the app running.

## Process model

```
┌────────────────────────────────────┐         ┌──────────────────────────┐
│            React UI                │         │     claude.exe child     │
│  (Vite bundle in Tauri WebView2)   │         │  (@anthropic-ai/         │
│                                    │         │   claude-code v2.1.x)    │
│  components/ChatPane → startTurn() │         │                          │
└────────────┬───────────────────────┘         └────────┬─────────────────┘
             │ Tauri IPC (invoke + Channel<T>)          │ stream-json on stdout
             ▼                                          │
┌────────────────────────────────────┐                  │
│       Rust Tauri runtime           │                  │
│       src-tauri/src/commands.rs    │                  │
│                                    │                  │
│   AppState { transport, db, … }    │                  │
└────────────┬───────────────────────┘                  │
             │ AgentTransport::start_turn               │
             ▼                                          │
┌────────────────────────────────────┐ tokio::spawn ───▶┘
│   crates/agent-core/CliTransport   │
│                                    │
│   spawn `claude.exe -p …           │◀─── per-turn process, --resume <id>
│                                    │
│   parse stdout lines → AgentEvent  │
│   forward → mpsc → Channel<…>      │
└────────────────────────────────────┘
                       │
                       └─▶  rusqlite (sessions/messages/FTS5)
                              ~/.claude-agent-desktop/state.sqlite
```

## The turn lifecycle

1. **Compose**: user types a prompt and hits Enter.
2. **Stage**: the React `ChatPane` mints a `turn_id` (uuid v4), appends the
   user message to the in-memory store, and calls `startTurn(args, onEvent)`.
3. **Plan**: the Rust handler asks `memory::build_system_append(prompt)` to
   produce the `--append-system-prompt` payload from
   `~/.claude-agent-desktop/memory.md` plus matched skills.
4. **Spawn**: `CliTransport::start_turn` invokes `claude.exe` with
   ```
   -p <prompt>
   --output-format stream-json
   --verbose
   --permission-mode acceptEdits
   --allowed-tools Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch
   [--resume <claude_session_id>]
   [--append-system-prompt <built payload>]
   ```
   `ANTHROPIC_API_KEY` and `CLAUDE_API_KEY` are scrubbed from the child env.
5. **Stream**: stdout lines are parsed into `AgentEvent`s and pushed onto a
   `tokio::mpsc::UnboundedSender`. The Tauri command pumps them into the
   frontend `Channel<AgentEventEnvelope>`.
6. **Render**: the zustand store's `handleEnvelope` mutates the message
   list. Text deltas accumulate into the active assistant message; tool_use
   blocks become `ToolRun` cards; tool_result blocks complete the matching
   card.
7. **Finalise**: when the `result` event arrives, the transport's task
   completes and the Tauri handler emits an `Outcome` envelope and returns
   it as the command's `Result`. The store then:
   - Stores the upstream `claude_session_id` so subsequent turns pass
     `--resume` and stay in the same conversation.
   - Calls `persistSession()` so SQLite gets the new transcript snapshot.
   - Refreshes the sidebar's `sessionList`.

## Cancellation

`cancel_turn(turn_id)` looks up the registered `oneshot::Sender<()>`, fires
it, removes the entry, and returns. The transport's `drive` future is
`tokio::select!`ing on the receiver — when it fires, it calls
`child.start_kill()` + `child.wait()` and returns a `cancelled` outcome.
The pump task sees the channel close and exits. No leaked processes.

## Why per-turn spawn vs persistent child

The CLI also supports `--input-format stream-json` for a persistent
multi-turn child you feed prompts to over stdin. We use per-turn spawn
because:

- The CLI handles `--resume` cleanly via its own session store, so we
  don't lose conversation context.
- Each turn gets a fresh process — bugs in one turn can't poison the next.
- Cancellation = `kill`. Simpler than a graceful protocol.

If startup latency ever becomes a problem (it's a few hundred ms on
Windows) we can swap to persistent mode behind the same `AgentTransport`
trait without touching the UI.

## State boundaries

| Layer        | Owns                                                   | Doesn't touch                                  |
|--------------|--------------------------------------------------------|------------------------------------------------|
| `agent-core` | Transport, events, auth status, DB schema, memory      | Tauri, React, IPC                              |
| `src-tauri`  | Command surface, AppState, channel plumbing            | DB schema (uses `db::*`), React                |
| `src/`       | UI state, presentation, optimistic updates             | Process spawning, file I/O, OAuth              |

The frontend never touches `~/.claude-agent-desktop/` directly — it always
goes through a `#[tauri::command]`. That keeps the boundary auditable.

## Type sync across the boundary

`src/lib/types.ts` is a hand-maintained mirror of the Rust types that cross
the IPC wire. Keep them in sync when you change a struct. The Rust types
all derive `Serialize` / `Deserialize` with `serde_json`'s defaults; the
serialisation is plain JSON, snake_case field names.

There is no codegen step. If you want one later, `tsify` or `specta` plug
in cleanly because the Rust types are already plain `#[derive(Serialize, Deserialize)]`.

## Failure modes

| Failure                                  | What the user sees                                                 |
|------------------------------------------|--------------------------------------------------------------------|
| `~/.claude/.credentials.json` missing    | AuthGate with "Sign in with Claude" button.                        |
| `claude.exe` missing                     | `AppState::new` returns Err; app panics on boot. Set `CLAUDE_BIN`. |
| Auth expires mid-turn                    | Result envelope with `is_error: true`. Re-login from AuthGate.     |
| Child process crashes                    | `Outcome { is_error: true, terminal_reason: Some("exit:1"), … }`.  |
| DB write fails                           | Chat continues; sidebar simply won't refresh that one entry.       |
| Unknown event type from CLI              | Logged + ignored. UI doesn't crash; raw line visible in inspector. |

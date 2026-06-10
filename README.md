# Claude Agent Desktop

A local-first **and** Hermes-style remote-first desktop app that turns
Claude into a persistent, tool-using agent with its own workspace. Built
on top of Claude Code's authenticated runtime so every turn runs on your
**existing Claude plan** — sign in with your Claude account, no API key and
no per-token charges.

- Streaming agent loop with the SDK's built-in tools (Bash, Read/Write/Edit, Glob, Grep, WebFetch/WebSearch).
- Tool calls render inline as collapsible cards. Real Stop button.
- Durable memory (`~/.claude-agent-desktop/memory.md`) injected into every turn.
- Markdown skills with YAML frontmatter, triggered by keyword / always / manual.
- SQLite-backed history with FTS5 search. Resume any past session with full context.
- Tauri shell — ~20 MB debug binary. No Electron, no bundled Node runtime.
- **Two transports behind one trait**:
  - **Local** — spawns `claude.exe` on this machine
  - **Remote** — talks to an [`agent-server`](docs/DEPLOYMENT.md) running
    in an LXC. Multiple desktop clients (laptop, Mac, work box) share one
    central server. Each client uploads its own Claude credentials per turn;
    the server isolates them in a per-turn temp HOME and never persists them.
  Toggle in Settings (sidebar gear or `Cmd+K`).

---

## Quick start

```bash
git clone <this repo> claude-agent-desktop
cd claude-agent-desktop

# 1. Make sure Claude Code is installed (we drive its CLI under the hood).
npm install -g @anthropic-ai/claude-code

# 2. Sign in with your Claude account. One-time, OAuth.
claude login

# 3. Build the app.
npm install
npm run dev          # hot-reloading dev mode (recommended for hacking)
# or:
npm run build        # produces a release binary under src-tauri/target/release/
```

On first run, the app:
1. Looks for `~/.claude/.credentials.json`. If it's missing, the AuthGate
   shows a **Sign in with Claude** button that runs `claude login` in a new
   console window and polls for the credential file.
2. Seeds `~/.claude-agent-desktop/` with a `memory.md` template and one
   example skill so you have the shape to riff on.

---

## Why your Claude account, not an API key

The idea is simple: sign in with the Claude account you already have. If we
used the Anthropic Messages API with an `ANTHROPIC_API_KEY` instead, every
Bash call and every file edit would burn pay-per-token billing on top of the
plan you're already paying for.

Running on top of Claude Code's authenticated runtime bills each turn against
your existing Claude plan (whatever tier includes Claude Code). That means one of:

- The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), which calls the
  same auth path internally.
- The `claude` CLI in headless `-p --output-format stream-json` mode.

We use the **CLI subprocess** today and abstract it behind an
`AgentTransport` trait so an SDK transport drops in later without touching
the UI. The CLI handles OAuth refresh transparently against
`~/.claude/.credentials.json`; we never see or store tokens.

As a belt-and-braces guarantee we **scrub `ANTHROPIC_API_KEY` and
`CLAUDE_API_KEY` from the child env** in `CliTransport`, so a stray export
in your shell can't accidentally route a turn through pay-per-token billing.
You can verify this at any time:

```bash
cargo run -p agent-core --bin agent-repl -- "Use Bash to echo HELLO. Reply with stdout."
```

The first event the binary prints is the `system/init` line which includes
`apiKeySource` — on a Max-authenticated machine it reads `"none"`, meaning
the call rode the subscription.

---

## Architecture

```
claude-agent-desktop/
├── crates/agent-core/             UI-agnostic Rust crate. The brain.
│   ├── src/agent/
│   │   ├── mod.rs                 AgentTransport trait, TurnRequest, TurnHandle
│   │   ├── events.rs              Typed view of the CLI's stream-json output
│   │   ├── cli_transport.rs       Local: spawns claude.exe (+ per-turn HOME isolation)
│   │   └── remote_transport.rs    Remote: HTTP+WS client of agent-server
│   ├── src/auth.rs                Credential discovery (status, launch_login)
│   ├── src/config.rs              Persistent config.json (Local/Remote)
│   ├── src/db.rs                  SQLite migrations + sessions/messages/FTS5
│   ├── src/memory.rs              memory.md + skills/*.md compiler
│   ├── src/paths.rs               Filesystem layout for user data
│   ├── src/bin/agent_repl.rs      Standalone Local proof
│   └── src/bin/remote_repl.rs     Standalone Remote proof
│
├── crates/agent-server/           Headless HTTP+WS server (runs in LXC).
│   ├── src/main.rs                Axum boot, route registration
│   ├── src/state.rs               Shared state, broadcast channels
│   ├── src/auth.rs                Bearer middleware
│   ├── src/api.rs                 /api/health, /api/turns, /api/sessions, …
│   └── src/stream.rs              /ws/stream/:turn_id (broadcast subscriber)
│
├── src-tauri/                     Thin Tauri shell that depends on agent-core.
│   ├── src/main.rs                Boot, register commands.
│   └── src/commands.rs            #[tauri::command] handlers (Channel-streamed)
│
├── src/                           React TS frontend.
│   ├── App.tsx                    Three-pane layout, auth gate routing
│   ├── components/                Chat, sidebar, inspector, Settings, modals
│   └── lib/
│       ├── ipc.ts                 Typed Tauri command wrappers
│       ├── types.ts               TS mirrors of the Rust types
│       └── store.ts               zustand: session/messages/streaming state
│
├── scripts/lxc-bootstrap.sh       One-shot LXC provisioner
└── docs/
    ├── ARCHITECTURE.md            Process model, turn lifecycle, failure modes
    └── DEPLOYMENT.md              Deploy agent-server to an LXC
```

### Provider abstraction

Anything that, given a `TurnRequest`, streams `AgentEvent`s back is a
transport:

```rust
#[async_trait]
pub trait AgentTransport: Send + Sync + 'static {
    async fn start_turn(&self, req: TurnRequest) -> Result<TurnHandle>;
}
```

Two implementations ship today, picked at runtime from `~/.claude-agent-desktop/config.json`:

- **`CliTransport`** — spawns `claude.exe` directly. Supports a per-turn
  credential override via `TurnRequest.credentials_json` — when set, the
  child runs with `HOME` pointing at a fresh temp directory containing
  only that turn's `.claude/.credentials.json`. The dir is deleted as
  soon as the turn finishes. This is the bedrock of the multi-tenant
  server.
- **`RemoteTransport`** — speaks HTTP+WS to an [`agent-server`](docs/DEPLOYMENT.md).
  Reads the user's local `~/.claude/.credentials.json`, POSTs it with each
  `start_turn`, opens a WebSocket to receive events, and forwards them
  through the same `TurnHandle` shape so the UI doesn't know which
  transport it's talking to.

### Stream-json event vocabulary

Each line on `claude.exe`'s stdout is one event:

| Type                 | What it carries                                                         |
|----------------------|--------------------------------------------------------------------------|
| `system/init`        | First line. `session_id`, `model`, `apiKeySource`, available tools       |
| `assistant`          | Partial assistant message: `thinking`, `tool_use`, `text` content blocks |
| `user`               | Tool result echo from the harness                                       |
| `rate_limit_event`   | Quota status                                                            |
| `result`             | Terminal aggregate: `total_cost_usd`, `num_turns`, `terminal_reason`     |

`events.rs` decodes these into typed Rust enums. Unknown variants degrade
gracefully to `AgentEvent::Other` so the UI never crashes when the CLI's
schema drifts.

### Tauri IPC

`start_turn` takes a Tauri `Channel<AgentEventEnvelope>`. The backend
wraps every parsed event with the `turn_id` the frontend supplied and
sends it down the channel. After the underlying child exits, the backend
sends an `Outcome` envelope and the `Promise` resolves with the same
data. Cancellation is a separate command (`cancel_turn`) keyed by
`turn_id` — the backend looks up the oneshot sender, fires it, the
transport's reader task picks it up, kills the child, and the frontend
receives a final `Outcome` with `is_error: true`, `terminal_reason: "cancelled"`.

### Persistence

SQLite lives at `~/.claude-agent-desktop/state.sqlite`. Schema is created
idempotently on every connection (`db::init_schema`).

| Table         | Purpose                                                              |
|---------------|----------------------------------------------------------------------|
| `sessions`    | id, title, created_at, last_at, claude_session_id, total_cost        |
| `messages`    | session_id, idx, role, content_json (frontend-shaped chat row)       |
| `messages_fts`| FTS5 mirror of `content_json` for `search_messages`                  |
| `settings`    | k/v scratch for future config                                        |

After each turn finishes, the frontend serialises the in-memory chat into
`PersistMessage` rows and calls `persist_session`, which upserts the
session header and replaces all messages in one transaction. On launch the
sidebar pulls `list_sessions` and renders them; clicking one calls
`load_messages` and rehydrates the chat.

The `claude_session_id` (assigned by the CLI on each first turn) is stored
on the session header. When the user sends the next message, the frontend
passes it as `resume_session_id` so the underlying agent SDK picks up the
exact same conversation context.

---

## How to add a skill

A skill is a markdown file in `~/.claude-agent-desktop/skills/` with YAML
frontmatter. The agent compiler reads these on every turn and grafts the
matching ones onto the system prompt via `--append-system-prompt`.

```markdown
---
name: debug-rust
description: When the user asks about a Rust panic or compile error.
trigger: keyword: panic, error[E0, rust
---

# Debugging Rust

Always read the full error first; rustc errors are precise.
Prefer `cargo check` over `cargo build` for compile-only iteration.
If a backtrace is involved, ask for `RUST_BACKTRACE=full`.
```

Triggers:

| Frontmatter                            | Behaviour                                                       |
|----------------------------------------|------------------------------------------------------------------|
| `trigger: always`                      | Always loaded into the system prompt.                            |
| `trigger: keyword: foo, bar`           | Loaded if the user message (lowercased) contains any keyword.    |
| `trigger: manual`                      | Available to invoke explicitly; not auto-injected. (UI: M5+)     |
| `trigger: never`                       | Disabled. Useful for drafts.                                     |

You can edit these from the in-app **Skills** manager (left rail → manage
skills) or directly on disk. Changes are picked up on the next turn — there
is no caching to clear.

### Memory

`~/.claude-agent-desktop/memory.md` is appended verbatim above any matched
skills. Put durable facts there: your OS, common project paths, the
people/tenants the agent should know about, preferences about how to talk
to you. Keep it tight — every line costs context tokens.

---

## Verifying the round trip without the UI

The `agent-repl` binary in `crates/agent-core` exercises the same code path
the desktop shell uses. Useful as a smoke test after dependency bumps:

```bash
cargo run -p agent-core --bin agent-repl -- "list the contents of my home dir"
```

You'll see the typed events stream past in real time:

```
auth: authenticated=true  plan=Some("max")  expires_at=Some(...)
[system] subtype=Some("init") session=Some("...") model=Some("claude-opus-4-8[1m]") api_key_source=None
[assistant.text] I'll list your home directory.
[tool_use] id=toolu_... name=Bash input={"command":"ls ~"}
[tool_result] id=toolu_... is_error=Some(false) content="..."
[assistant.text] Here's what's in your home directory: ...
[result] subtype=Some("success") is_error=Some(false) cost=Some(0.012) turns=Some(2) reason=Some("completed")
```

If `auth: authenticated=false`, run `claude login` first.

---

## Remote / multi-device mode

For the Hermes-style "agent in an LXC, every device connects to it" setup
see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Quick version:

1. Create a Debian 12 LXC on Proxmox (2 GB RAM, 8 GB disk).
2. On the LXC, `git clone https://github.com/hectorio1999/cadrts /opt/cad`.
3. SSH in as root, run `bash /opt/cad/scripts/lxc-bootstrap.sh`. It prints
   the URL + bearer token.
4. In the desktop app: **⚙ settings (transport)** → Remote → paste the URL
   + token, hit *test connection*, save.
5. Add a Cloudflare tunnel ingress so you can use it from anywhere:
   `agent.rosariotechsolutions.com → http://<lxc-ip>:9120` with
   `httpHostHeader: localhost` (matches Hermes's working setup).

To deploy a new version after pushing to `main`:

```bash
ssh root@<lxc-ip> bash /opt/cad/scripts/deploy-lxc.sh
```

That pulls origin/main, rebuilds the web bundle + server binary, updates
`CAD_BUILD_COMMIT` in the env file, and restarts the systemd unit. The
UpdateBadge in the running clients goes dark within ~60 s.

## Three ways to run the client

- **Browser** — open the server's URL (`https://agent.rosariotechsolutions.com`
  in Hector's deploy), paste the bearer token, you're in. No install. Works
  on Mac, phones, anywhere.
- **Tauri desktop binary** — built per-platform via
  [`.github/workflows/desktop-release.yml`](.github/workflows/desktop-release.yml).
  Push a `v*` tag → GH Actions builds signed `.dmg` / `.msi` / `.AppImage`
  artefacts and publishes a GitHub Release. The bundled
  `tauri-plugin-updater` auto-checks that release feed.
- **Local build on a Mac** — `npm install && npm run build` on macOS
  produces `src-tauri/target/release/bundle/dmg/Claude Agent Desktop_*.dmg`.
  See [`docs/MAC-BUILD.md`](docs/MAC-BUILD.md).

## Auto-update

The UpdateBadge at the bottom-right is wired to two feeds:

- **`/api/version`** (server-side): compares the server's baked
  `CAD_BUILD_COMMIT` against `origin/main` HEAD in `/opt/cad`. When they
  differ, the badge lights up. Click for the changelog. "Update now" reloads
  the browser shell (which immediately picks up the latest web bundle the
  server has on disk).
- **Tauri updater plugin** (desktop only): on "Update now" in the desktop
  app, the plugin checks
  `https://github.com/hectorio1999/cadrts/releases/latest/download/latest.json`,
  downloads the matching signed bundle for the current OS/arch, and
  relaunches. The signing keypair is at `~/.tauri/cad-updater.key` on
  Hector's laptop — its public half is committed in `tauri.conf.json`.

## What's intentionally not here yet

The current build is the calm-personal-Jarvis core. Deliberate follow-ups:

- **Browser web UI mode** — server serves the Vite build at `/` with the
  bearer token injected into the HTML, no Tauri required.
- **Permission gating UI** that intercepts destructive tools (delete, rm,
  network egress) at the SDK's permission boundary and shows a one-click
  confirm modal. Today we run with `acceptEdits` mode by default.
- **Persona file layering** (`SOUL.md` / `USER.md` / `memory.md`) so the
  agent's identity is structured the way Hermes's is.
- **Cron / scheduled jobs** — server runs a turn on a schedule.
- **`@anthropic-ai/claude-agent-sdk` transport** as a third implementation
  of `AgentTransport`. The trait is already in place.
- **MCP server registration** UX so the agent can pick up additional
  toolservers without editing CLI flags.

---

## Layout summary

| Path                                                 | Purpose                                             |
|------------------------------------------------------|------------------------------------------------------|
| `~/.claude/.credentials.json`                        | OAuth tokens. Owned by the `claude` CLI.            |
| `~/.claude-agent-desktop/state.sqlite`               | Conversations + messages + FTS index.               |
| `~/.claude-agent-desktop/memory.md`                  | Durable memory, injected each turn.                 |
| `~/.claude-agent-desktop/skills/*.md`                | Markdown playbooks with frontmatter.                |
| `~/.claude-agent-desktop/logs/`                      | Reserved for rotating run logs.                     |

Everything in `~/.claude-agent-desktop/` is yours to edit, version control,
or wipe. Nothing here is secret — the OAuth tokens live in the `claude`
CLI's own store.

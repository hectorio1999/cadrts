# Changelog

All notable changes to Claude Agent Desktop.

## [0.9.10] — 2026-06-29 — "Calm tool calls"

### Changed
- **Tool calls render as a compact activity list instead of a stack of cards.**
  Each call is a quiet one-line row (status · tool · args) under a subtle
  gutter; click to expand its input/output. A large batch — like a health check
  firing 25 probes — collapses behind a one-line summary ("N tool calls · M
  failed") so the transcript stays scannable. Matches the Claude Code feel.
  (RTS-116)

## [0.9.9] — 2026-06-29 — "Fluid streaming"

### Changed
- **Streamed replies now flow smoothly instead of arriving in bursts.** Token
  deltas come off the network in clumps; the client now meters them onto the
  screen at an even, typewriter cadence — the way ChatGPT and the Claude apps
  read — decoupled from bursty network arrival. Pure presentation: the message
  text is unchanged, and it snaps to full instantly when the turn ends or when
  the OS prefers reduced motion. (RTS-115)

## [0.9.8] — 2026-06-26 — "Live streaming"

### Added
- **Assistant replies stream token-by-token.** Atlas's text now appears as it's
  generated rather than in per-block chunks, via Claude Code's
  `--include-partial-messages`. The client renders live token deltas into the
  active message and de-duplicates the final assistant block. Server kill-switch:
  `ATLAS_STREAM_PARTIALS=0`. (RTS-113 Part A)

## [0.9.7] — 2026-06-25 — "Files in chat"

### Added
- **Atlas can hand you files, photos, and videos in chat.** When Atlas produces a file it
  delivers it inline — images render, videos play in a built-in player, and other files show a
  download button. Served by the agent-server (`GET /api/files/:id`, range-enabled for video),
  staged with the new `share` command. Up to 200 MB/file; shared files expire after ~14 days.
  Outbound complement to v0.9.6's image attachments.

## [0.9.6] — 2026-06-25 — "Image attachments"

### Added
- **Attach images in the composer.** A new paperclip button — plus clipboard
  paste and drag-and-drop — lets you send images to Atlas. Files upload to the
  agent-server (`POST /api/uploads`) and Atlas views them with its Read tool.
  Thumbnails show in the composer and on the sent message. Up to 6 images per
  message, 12 MB each (PNG/JPEG/GIF/WEBP). Remote/browser mode only — the file
  has to live on the server so the agent can read it.

## [0.9.5] — 2026-06-25 — "Navy polish"

### Changed
- The Inspector pane now starts collapsed; open it from the status bar when needed.
- The project picker moved from a full-width top bar into the composer strip,
  next to Mode and Model.

### Fixed
- Release builds now emit signed updater artifacts (`bundle.createUpdaterArtifacts`),
  so each release ships `latest.json` + `.sig` and the in-app auto-updater works.

## [0.9.4] — 2026-06-25 — "Navy"

### Changed
- **New default look — a deep-navy theme inspired by Hermes Desktop.** Royal-navy
  surfaces with a warm cream/gold accent. The other five themes (Dark, Light,
  Nord, Synthwave, Matrix) are still available in Settings; existing installs keep
  their saved theme — switch to **Navy** in Settings to opt in.
- **The empty state is now a large cream serif ATLAS wordmark** with a subtitle,
  using a system serif (no external font fetch).
- **Sidebar restructured** into labelled sections: nav items (New session, Skills
  & Tools, Memory, Settings), a session search box, a **Sessions** section with a
  live count, and a **Cron Jobs** section wired to `/api/jobs` with per-job
  next-run countdowns.
- **The composer is now a rounded pill** — a `+` button opens the skill library,
  with a circular send / stop control.
- The status bar switches from monospace to sans to match.

## [0.9.3] — 2026-06-11 — "Mobile"

### Changed
- **The web UI is now phone-friendly.** Below the `md` breakpoint:
  - The session sidebar becomes an off-canvas drawer with a backdrop, opened
    from a new ☰ top bar in the chat pane; it auto-closes when you pick a
    session, start a new one, or open any panel. Session delete (✕) is always
    visible on touch (no hover on phones).
  - The inspector opens full-screen with its own ✕ close button.
  - The status bar hides the turn/cost readout and truncates instead of
    wrapping; the composer meta strip (Mode/Model/skill) wraps cleanly.
  - Login cards, toasts, and the composer fit the viewport (safe-area aware).
- **iOS fixes:** fields are floored at 16px on phones so Safari no longer
  zooms the page when you tap the composer; the app uses `100dvh` so the
  input is never hidden behind Safari's collapsing toolbar; tap highlight
  and pull-to-refresh are disabled inside the app.
- Desktop layout is unchanged (all of the above is gated to small screens).

## [0.9.2] — 2026-06-10

### Changed
- **Update button moved into the status bar**, just left of the inspector
  toggle (was a floating pill in the bottom-right corner). Compact `+{N} Update`
  chip; still opens the "What's new" modal.

## [0.9.1] — 2026-06-10 — "Unified history"

### Fixed
- **Chat history now lives on the server in Remote mode**, so it's the same in
  the desktop app and the web UI (and on any device you sign into). Previously
  the desktop app saved transcripts to a local DB on your machine while the web
  UI read the server's DB — so the two never matched. Session list/load/save/
  delete/rename/search now route to the configured server when in Remote mode.
- **One-time migration:** on first launch after updating (Remote mode), the
  desktop app pushes your existing local history up to the server so nothing is
  lost and it all appears in the web UI. Idempotent; skips anything already
  there. (Local mode is unchanged — history stays local.)

## [0.9.0] — 2026-06-10 — "Themes"

### Added
- **5 color themes** (Settings → Theme, applies instantly, persisted):
  **Dark** (default), **Light**, **Nord** (arctic blue-gray + frost), **Synthwave**
  (deep indigo, neon magenta/cyan with a glow), and **Matrix** (phosphor-green
  terminal with scanlines). The two "designed" themes add subtle pointer-through
  overlays (neon glow / scanlines). Built on CSS variables so every component
  re-themes automatically; no flash on load.

### Changed
- **Chat messages:** your messages are now the only ones with a border — a clean
  accent-tinted outline (no fill) — while the assistant renders as plain text.

## [0.8.2] — 2026-06-10

### Fixed
- **Turns going silent mid-stream (esp. long Opus + research turns).** If the
  WebSocket between the desktop client and the server dropped for a moment
  (WiFi blip, brief sleep, transient hiccup) during a long turn, the client gave
  up — ending the turn as "stream closed before outcome" — even though the turn
  was still running fine on the server. That left you staring at a stalled
  response and re-prompting to "bring it back" (which sometimes also failed with
  "No conversation found"). Now: the client **reconnects** to the same in-flight
  turn (up to ~20s of retries) instead of giving up, and the server **retains a
  finished turn's outcome for ~2 minutes** so a client that reconnects right
  after completion still receives the final result. Long research turns survive
  transient drops and complete on their own.

## [0.8.1] — 2026-06-10

### Fixed
- **Scheduled Jobs panel black-screened in the desktop app.** The jobs calls used
  the browser-only API helper, which resolves to the webview's own origin in
  Tauri (`tauri://localhost`) — so `/api/jobs` returned the app's HTML and a
  non-array crashed the panel on render. Jobs now fetch the configured remote
  `base_url` directly (CORS is open, CSP null), and the list calls hard-guard
  against non-array responses so the panel shows a friendly note instead of
  blanking.

## [0.8.0] — 2026-06-10 — "Scheduled Automations"

Atlas can now create and run real recurring automations — and proactively
suggests them when a task is worth repeating, monitoring, or summarizing.

### Added
- **Scheduled jobs engine (server-side).** A scheduler in `agent-server` runs due
  jobs every minute as headless Atlas turns (with the server's own credentials),
  so automations fire even when no client is connected. Jobs are JSON files in
  `~/.cad/jobs/` — Atlas creates/edits them with its file tools, the same pattern
  as self-improving skills. Run history (status, output, cost, failures) is kept
  per job. New `cron`/`chrono-tz`-backed schedule evaluation in `agent-core::cron`
  (5-field cron + IANA timezones, plain-English labels), unit-tested.
- **Proactive suggestion intelligence.** Atlas's system prompt now teaches it to
  recognize when a result would be more valuable on a schedule (reports, scans,
  digests, monitors, price/uptime checks, opportunity scans, health checks…),
  score it, and *offer* to automate it — while explicitly NOT pitching a job
  after every message. Always confirms before creating, states the schedule in
  plain English + timezone, respects permission boundaries (sending email /
  changing servers / deleting needs approval), and defaults monitors to
  notify-on-change/failure to stay quiet unless something's wrong.
- **Jobs API** — `GET/POST /api/jobs`, `PATCH/DELETE /api/jobs/:id`,
  `POST /api/jobs/:id/run` (run now), `GET /api/jobs/:id/runs` (history).
- **Scheduled Jobs manager UI** (sidebar → "⏰ scheduled jobs"): each job's
  plain-English schedule, next/last run, status, and run logs, with
  pause/resume, run-now, and delete. (Remote mode — that's where the scheduler
  lives.)

## [0.7.1] — 2026-06-10 — "Fable 5 in the picker"

### Added
- **Fable 5** as an explicit model choice (Default · Fable 5 · Opus · Sonnet ·
  Haiku), wired to `--model claude-fable-5`.

## [0.7.0] — 2026-06-10 — "Live Activity"

### Added
- **Live activity indicator.** While a turn streams, a status row shows what the
  agent is doing *right now* — "🔍 Searching the web: …", "📖 Reading …",
  "⚙️ Running …", or "Thinking" between steps — with animated dots and a ticking
  elapsed timer. Long turns (e.g. Opus + research) now clearly look alive even
  before any text arrives. Replaces the minimal "▍ thinking" line.

### Fixed
- **Settings modal scrolls.** With the added model/permission/tools controls the
  panel could overflow with no scroll; it's now height-capped with a scrollable
  body (header and action buttons stay pinned).

## [0.6.0] — 2026-06-10 — "Model Picker & Update UX"

### Added
- **Model selection.** Pick the model per turn from the composer (next to Mode)
  and in Settings: Default · Opus · Sonnet · Haiku, plus a custom field for a
  full model id. Wired end-to-end to the `claude --model` flag. Switch mid-chat
  (Opus for hard reasoning, Haiku for quick tasks). Persisted.

### Changed
- **Update button** reshaped: bottom-right pill now shows `+{N} Update` with the
  change count. Clicking opens a "What's new" modal (recent changes) with
  **Update** (downloads/installs in the desktop app, reloads in browser) and
  **Close**.

## [0.5.0] — 2026-06-10 — "Automatic & Self-Improving Skills"

The skill system is now invisible and automatic — and grows with you.

### Added
- **Base skills available by default.** The full library is generated to markdown
  (`seed-skills/`), embedded in the binary, and seeded into every agent's
  `skills/base/` on boot. No install, activation, or manual invocation.
- **Automatic skill selection.** Every turn's system prompt now includes a
  compact catalog of all skills (name + when-to-use). The agent silently applies
  the best-fitting skill when a request matches — the user never names a skill.
  Replaces the old crude keyword substring-matching with model-driven selection.
- **Self-improvement.** When a request would benefit from a reusable workflow the
  agent lacks, it writes a new skill file to the user's `skills/` directory after
  finishing. The next turn's catalog picks it up automatically — the agent
  becomes more capable and personalized the more it's used.
- `scripts/gen-skill-seed.mjs` + `npm run gen:skills` to regenerate the base
  markdown from the TypeScript library (single source of truth).

### Changed
- `memory.rs` system-prompt builder: memory + always-on guidance + skill catalog
  + self-improvement instructions. The `⚡ skill` library UI is now an optional
  way to *force* a skill; automatic selection is the default.

## [0.4.0] — 2026-06-10 — "General-Purpose Skill Library"

Turns the skill system from a handful of dev workflows into a broad
general-purpose library — the app now feels like it has many expert assistants
built in, not just an IT toolkit.

### Added
- **57 expert skills across 11 categories**: Coding, Writing, Research,
  Business, Productivity, Data, Documents, Design, Learning, Creative, and
  IT/Homelab. IT is now one category among many, not the whole library.
- **Rich skill schema** (16 fields): id, name, category, description, purpose,
  whenToUse, inputs, outputs, steps, behaviorGuidelines, toolsAllowed/Disallowed,
  safetyLevel, confirmationRequired, examplePrompts, successCriteria,
  failureModes, followUpBehavior. The structured fields are composed into the
  agent's directive — they drive behavior, not just metadata.
- **Skill Library UI** — browse by category, search, open any skill for full
  detail + example prompts, and "Use this skill" (or click an example prompt to
  prefill and attach it). Replaces the small inline picker.
- **Per-category files** (`src/lib/skills/*.ts`) so the library is easy to extend.
- **Validation + graceful failure** — malformed/duplicate skills are dropped at
  load, recorded, and surfaced as a banner; they never crash or vanish silently.
- Docs: `docs/SKILLS.md` and `docs/SKILL_AUTHORING.md` (schema, quality bar,
  strong-vs-weak examples, how to add skills).

### Changed
- Skill safety: read-only skills now instruct the agent not to edit/run; each
  skill declares its tools and safety level.

## [0.3.1] — 2026-06-10

### Changed
- **Inclusive sign-in messaging.** Dropped the "Max subscription" framing
  everywhere (sign-in screen, README, error text). The app works with any
  Claude account that has Claude Code access — just sign in with your Claude
  account; no API key, no per-token charges. Same OAuth flow, friendlier copy.

## [0.3.0] — 2026-06-10 — "Project Awareness & Premium UX"

A major polish pass turning the chat client into a project-aware desktop AI
workspace. No breaking changes; existing sessions, memory, and skills are
preserved.

### Added
- **Workspace / project awareness.** Pick a project folder and the agent
  operates inside it (sent as `cwd` to every turn — previously always `null`,
  so the agent ran in a bare HOME). A `WorkspaceBar` above the chat shows the
  active project with a native folder picker (desktop) or path entry (remote),
  plus a recents list. Persists across restarts.
- **Markdown + code rendering** for assistant messages (headings, lists,
  tables, links, fenced code) via `markdown-to-jsx` — safe React rendering, no
  HTML injection. Replaces plaintext.
- **Code blocks** with a language label and a copy button.
- **Diff previews** for `Edit`/`MultiEdit` tool calls and content previews for
  `Write`, instead of raw JSON.
- **Copy buttons** on messages, tool input, and tool output.
- **Workflow skills** — 11 reusable, workspace-agnostic workflows (Codebase
  Audit, Build Feature, Debug Error, Refactor Module, Create Component, Create
  API Route, Generate Tests, Write Documentation, Security Review, Project
  Onboarding, Release Prep). Attach one to your next message from the composer
  (`⚡ skill`) — manual invocation that was previously unimplemented.
- **Permission-mode control** in the composer + Settings (Plan / Ask first /
  Auto-edit / Full access). Plan is read-only; the primary safety lever.
- **Tool control** in Settings — unchecked tools are *withheld* from the agent
  via `--disallowed-tools` (the real restriction), checked tools are
  auto-approved via `--allowed-tools`. (These were hardcoded before.)
- **Toast notifications** for transient errors (replaces silent `console.warn`
  and red-text dumps). A failed session-save now actually tells you, and error
  toasts stay until dismissed.
- **Scroll lock** — streaming no longer yanks you to the bottom while you read
  scroll-up; a "↓ latest" button appears instead. Sending always follows.

### Fixed
- App no longer crashes on boot when the `claude` CLI is missing — it boots to
  the sign-in screen and resolves the CLI lazily at turn time, so a mid-session
  install works without restart and the rich install error still surfaces.
- **Tool restriction actually restricts.** `--allowed-tools` is an auto-approve
  allow-list, not a deny-list; unchecked tools are now sent as
  `--disallowed-tools` so the UI's promise holds.
- Workflow directives no longer pollute keyword-skill matching or the visible
  transcript — they ride a separate `skill_directive` field.
- Transport errors finish any half-streamed message (no orphaned caret; the
  next turn won't append into the errored bubble).
- Markdown: single-line fenced blocks with no language render as blocks; links
  open in the system browser (not the app window).
- Tool output unwraps `{type:text}` content blocks instead of dumping JSON.
- Workspace/skill popovers close properly when their toggle is clicked.
- `read_skill` path-traversal guard (parity with `write_skill`, incl. `:`).
- `AuthGate` sign-in poll is cleared on unmount (interval leak).

### Notes / still tracked (see `TODO.md`)
- Token-streaming deltas, per-workspace memory/skills, broadcast-race fix,
  server-side tool allow-list, CORS lockdown, light theme.

# Changelog

All notable changes to Claude Agent Desktop.

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

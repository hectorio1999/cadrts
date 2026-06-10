# Roadmap — Claude Agent Desktop

> Status legend: ✅ done · 🟡 in progress · ⬜ planned · 🔬 needs design

This roadmap is grounded in the 2026-06-10 full-codebase audit. It turns
"a clean chat client for the `claude` CLI" into "a project-aware desktop AI
workspace." The app spawns the real `claude` Code CLI per turn, so it already
inherits Claude Code's tool suite (Read/Write/Edit/Bash/Glob/Grep/Web*). We do
**not** reimplement those tools — we build the *workspace layer* around them.

---

## Now — v0.3 "Project Awareness"

The headline gap: the agent runs in a bare HOME with no project. `cwd` is
plumbed through the whole stack but every call site sends `null`.

- ✅ **Workspace model** — current workspace + recents in the store, persisted.
- ✅ **Directory picker** — wire the already-installed `@tauri-apps/plugin-dialog`
  (Tauri) + manual-path entry (browser/remote).
- ✅ **`cwd` wiring** — pass the active workspace into every turn instead of `null`.
- ✅ **Workspace bar UI** — show/switch the active project in the sidebar header.
- ⬜ **Workspace context injection** — prepend a short "current project root + how
  to explore it" note so the agent orients itself before acting.
- ⬜ **Workspace summary** — one-click scan (framework, scripts, entry points,
  risks) cached locally per workspace.

## Next — v0.4 "Premium UX"

- ⬜ **Markdown + code rendering** in assistant messages (fenced code, tables,
  links) with syntax highlighting — the #1 visible polish gap.
- ⬜ **Copy buttons** on code blocks and tool output.
- ⬜ **Diff previews** for `Edit`/`Write` tool calls (old/new) instead of raw JSON.
- ⬜ **Scroll-lock** — stop force-scrolling when the user scrolls up mid-stream.
- ⬜ **Toasts + retry** — replace `String(e)`-into-red-text error handling.
- ⬜ **Token-streaming deltas** — consume `stream_event` deltas (currently dropped).

## Next — v0.5 "Real Skills"

- ⬜ **Workflow skills** — ship generic reusable skills: Codebase Audit, Build
  Feature, Debug Error, Refactor Module, Create Component, Create API Route,
  Generate Tests, Write Docs, Security Review, Project Onboarding, Release Prep.
- ⬜ **Manual skill invocation** — `/skill <name>` (or composer dropdown) → inject
  that skill on demand. The `manual` trigger is parsed today but never used.
- ⬜ **Per-workspace skills/memory** — currently a single global file shared by all
  clients/projects. Add project-scoped overrides (`.cad/` in the workspace).
- ⬜ **Better skill matching** — word-boundary/token matching + a token budget cap
  (today it's naive substring `contains`, so `ip`→"script", `lan`→"plan").

## Next — v0.6 "Settings & Safety"

- ⬜ **Settings expansion** — model picker, permission-mode toggle, allowed-tools
  editor, theme. Today these are hardcoded in `ChatPane.tsx`.
- ⬜ **Safety classification** — label tools read-only / write / destructive /
  shell / network and require confirmation for destructive + shell-mutating ops.
- ⬜ **Server-side tool allow-list** — enforce on the server, not just the client
  (a remote caller can currently request `bypassPermissions`).

## Hardening (rolling)

- ⬜ Fix broadcast race (buffer/replay early turn events before WS attaches).
- ⬜ `main.rs` graceful boot (show AuthGate instead of `panic!` when CLI missing).
- ⬜ `AuthGate` interval cleanup; `SkillsManager` path/precedence bug.
- ⬜ Seed deployment: copy `seed/*` into `$CAD_HOME` on bootstrap.
- ⬜ `CAD_BUILD_COMMIT` seeding so the update badge works on fresh boxes.
- ⬜ Lock down CORS; drop `?token=` query auth; real constant-time compare.
- ⬜ `read_skill` path-traversal guard (parity with `write_skill`).
- ⬜ Server build + `cargo clippy`/`test` in CI (today CI only builds the desktop app).

## Developer experience (rolling)

- ⬜ `.env.example`, `CHANGELOG.md`, `CONTRIBUTING.md`.
- ⬜ Reconcile repo URLs (`hectorio1999/cadrts` vs placeholders).
- ⬜ De-dupe the `<pre>`/JSON render helpers (ToolCallCard ↔ InspectorPane).

---

See `TODO.md` for the granular, prioritized task list and `docs/ARCHITECTURE.md`
for the current (audited) system design.

# TODO — Claude Agent Desktop

Prioritized, grounded in the 2026-06-10 audit. `[file:line]` references point at
the code to change. Check items off as they land.

## P0 — Project awareness (v0.3) — IN PROGRESS

- [x] Add `Workspace` types and store state (current + recents) `[src/lib/types.ts, store.ts]`
- [x] Directory picker via `@tauri-apps/plugin-dialog` (Tauri) + manual entry (browser) `[src/lib/ipc.ts]`
- [x] Persist active workspace + recents across restarts `[src/lib/ipc.ts]`
- [x] Send the active workspace as `cwd` on every turn (was hardcoded `null`) `[src/components/ChatPane.tsx:57]`
- [x] Workspace bar UI: show active project, switch, open-recent `[src/components/WorkspaceBar.tsx]`
- [ ] Inject a short "current project root" note into context so the agent orients `[crates/agent-core/src/memory.rs]`
- [ ] One-click workspace summary (framework/scripts/entry points), cached per workspace `[new]`

## P1 — Premium UX (v0.4) — DONE in 0.3.0

- [x] Markdown + fenced-code rendering in assistant messages (markdown-to-jsx) `[MessageItem.tsx, Markdown.tsx]`
- [x] Copy buttons on code blocks + tool output `[CodeBlock.tsx, ToolCallCard.tsx, MessageItem.tsx]`
- [x] Diff preview for `Edit`/`Write` tool calls `[ToolCallCard.tsx]`
- [x] Scroll-lock when user scrolls up mid-stream + "↓ latest" `[ChatPane.tsx]`
- [x] Toast system; stop dumping `String(e)` silently `[store.ts, ToastHost.tsx]`
- [ ] Syntax highlighting inside code blocks (currently styled monospace)
- [ ] Consume `stream_event` token deltas for live typing `[events.rs:29, store.ts]`
- [ ] Retry buttons on failed turns

## P1 — Real skills (v0.5) — core DONE in 0.3.0

- [x] Author 11 generic workflow skills `[src/lib/skillLibrary.ts]`
- [x] Manual skill invocation via composer `⚡ skill` picker (prepends workflow) `[SkillPicker.tsx, ChatPane.tsx]`
- [ ] "Install workflow → my skills" button in SkillsManager (writeSkill)
- [ ] Per-workspace skills/memory overrides (`.cad/` in the project) `[memory.rs, paths.rs]`
- [ ] Word-boundary skill matching + token budget cap `[memory.rs:152]`
- [ ] Wire the backend `manual` trigger for keyword-free server-side skills `[memory.rs:148-157]`

## P2 — Settings & safety (v0.6) — partial in 0.3.0

- [x] Permission-mode control (composer + Settings) — the safety lever `[ChatPane.tsx, SettingsModal.tsx, prefs.ts]`
- [x] Allowed-tools editor `[SettingsModal.tsx]`
- [ ] Model picker (needs `--model` plumbing in cli_transport) `[SettingsModal.tsx, cli_transport.rs]`
- [ ] Server-side tool allow-list enforcement `[api.rs:156-157]`
- [ ] Light theme (deliberately deferred — dark-only is a cohesive choice)

## P2 — Bug fixes (rolling)

- [x] Graceful boot instead of `panic!` when CLI missing `[main.rs, commands.rs, cli_transport.rs]`
- [x] `AuthGate` clear `setInterval` on unmount `[AuthGate.tsx]`
- [x] `read_skill` path-traversal guard parity with `write_skill` `[api.rs]`
- [ ] Broadcast race: buffer/replay early turn events before WS attaches `[api.rs:168-209, stream.rs]`
- [ ] `SkillsManager.tsx:87-91` operator-precedence + literal `%USERPROFILE%` path
- [ ] Deploy `seed/*` into `$CAD_HOME` on bootstrap `[scripts/lxc-bootstrap.sh]`
- [ ] Seed `CAD_BUILD_COMMIT=` line so update badge works `[lxc-bootstrap.sh, deploy-lxc.sh:63]`

## P3 — Security hardening

- [ ] Restrict CORS to known origins `[main.rs:109-114]`
- [ ] Remove `?token=` query-string auth `[auth.rs:100-111]`
- [ ] Use `subtle`/real constant-time compare `[auth.rs:32-41]`
- [ ] Re-enable a CSP (currently `null`) `[tauri.conf.json:26]`

## P3 — DX / docs

- [x] `.env.example` (CAD_SERVER_TOKEN, CAD_SERVER_BIND, CAD_HOME, CAD_STATIC_DIR, CAD_SOURCE_DIR, CAD_BUILD_COMMIT)
- [x] `CHANGELOG.md`
- [x] Version bump 0.2.0 → 0.3.0 (package.json, Cargo workspace, tauri.conf.json)
- [ ] `CONTRIBUTING.md`
- [ ] Reconcile repo URLs across docs
- [ ] De-dupe `<pre>`/JSON render helpers `[ToolCallCard.tsx, InspectorPane.tsx]`
- [ ] Add server build + clippy/test to CI `[.github/workflows/desktop-release.yml]`

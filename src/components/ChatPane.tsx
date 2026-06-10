import { useEffect, useRef, useState } from "react";
import { cancelTurn, startTurn } from "../lib/ipc";
import { useStore } from "../lib/store";
import { v4 as uuid } from "../lib/uuid";
import { PERMISSION_MODES, ALL_TOOLS } from "../lib/prefs";
import { asDirective, type WorkflowSkill } from "../lib/skillLibrary";
import type { PermissionMode } from "../lib/types";
import MessageItem from "./MessageItem";
import WorkspaceBar from "./WorkspaceBar";
import SkillLibrary from "./SkillLibrary";

export default function ChatPane() {
  const messages = useStore((s) => s.messages);
  const streaming = useStore((s) => s.streaming);
  const setStreaming = useStore((s) => s.setStreaming);
  const currentTurnId = useStore((s) => s.currentTurnId);
  const setCurrentTurn = useStore((s) => s.setCurrentTurn);
  const session = useStore((s) => s.session);
  const handleEnvelope = useStore((s) => s.handleEnvelope);
  const appendUserMessage = useStore((s) => s.appendUserMessage);
  const clearClaudeSessionId = useStore((s) => s.clearClaudeSessionId);
  const workspace = useStore((s) => s.workspace);
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);

  const [input, setInput] = useState("");
  const [atBottom, setAtBottom] = useState(true);
  const [pendingSkill, setPendingSkill] = useState<WorkflowSkill | null>(null);
  const [skillLibraryOpen, setSkillLibraryOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-grow textarea
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [input]);

  // Auto-scroll on new content — but only when the user is already near the
  // bottom, so we don't yank them back down while they're reading scroll-up.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !atBottom) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming, atBottom]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAtBottom(nearBottom);
  }

  function jumpToBottom() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setAtBottom(true);
  }

  async function onSubmit() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    jumpToBottom(); // sending is an explicit signal — follow the new turn
    // The transcript shows what the user typed; a selected workflow skill rides
    // in `skill_directive` so it never pollutes the visible history OR the
    // keyword-skill matching the server runs against the raw prompt.
    appendUserMessage(text);
    const directive = pendingSkill ? asDirective(pendingSkill) : null;
    setPendingSkill(null);

    // "Allowed tools" checkboxes are a withhold control: unchecked tools are
    // disallowed (the real restriction), checked ones are auto-approved.
    const disallowed = ALL_TOOLS.filter((t) => !prefs.allowedTools.includes(t));

    const turnId = uuid();
    setCurrentTurn(turnId);
    setStreaming(true);

    try {
      await startTurn(
        {
          turn_id: turnId,
          prompt: text,
          skill_directive: directive,
          resume_session_id: session.claude_session_id ?? null,
          permission_mode: prefs.permissionMode,
          allowed_tools: prefs.allowedTools,
          disallowed_tools: disallowed,
          // The active project root. null → agent runs in its default HOME.
          cwd: workspace,
        },
        (env) => handleEnvelope(env),
      );
    } catch (e) {
      handleEnvelope({ kind: "error", turn_id: turnId, message: String(e) });
    } finally {
      setCurrentTurn(null);
      setStreaming(false);
    }
  }

  async function onStop() {
    if (!currentTurnId) return;
    await cancelTurn(currentTurnId);
  }

  return (
    <main className="relative flex-1 min-w-0 flex flex-col bg-ink-900">
      <WorkspaceBar />
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-6 py-4 space-y-3"
      >
        {messages.length === 0 ? (
          <Empty />
        ) : (
          messages.map((m) => <MessageItem key={m.id} message={m} />)
        )}
        {streaming && (
          <div className="text-xs text-zinc-500 font-mono pulse-dot pl-1">
            ▍ thinking
          </div>
        )}
      </div>

      {!atBottom && messages.length > 0 && (
        <button
          onClick={jumpToBottom}
          className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full border border-ink-500 bg-ink-800/90 px-3 py-1 text-[11px] font-mono text-zinc-300 shadow-lg shadow-black/40 hover:bg-ink-700"
          title="Jump to latest"
        >
          ↓ latest
        </button>
      )}

      <div className="border-t border-ink-600 bg-ink-800/40 px-4 py-3">
        {/* Thin meta strip — only shown when we have an upstream session.
            Lets the user reset the conversation thread server-side without
            wiping the visible history. handleEnvelope also auto-fires this
            on auth/resume errors, so this is just the manual escape hatch. */}
        {session.claude_session_id && !streaming && (
          <div className="mb-2 flex items-center justify-between text-[10px] font-mono text-zinc-500">
            <span>
              upstream: <span className="text-zinc-400">{session.claude_session_id.slice(0, 8)}…</span>
            </span>
            <button
              onClick={() => clearClaudeSessionId()}
              className="hover:text-zinc-300"
              title="Start a fresh upstream conversation (keep visible history)"
            >
              ↻ reset thread
            </button>
          </div>
        )}
        <div className="relative mb-2 flex items-center gap-2 text-[10px] font-mono text-zinc-500">
          <span className="uppercase tracking-wide">Mode</span>
          <PermissionModeSelect
            value={prefs.permissionMode}
            onChange={(m) => setPrefs({ permissionMode: m })}
          />
          <button
            onClick={() => setSkillLibraryOpen(true)}
            className="rounded border border-ink-500 px-1.5 py-0.5 text-zinc-300 hover:bg-ink-600/40"
            title="Browse the skill library"
          >
            ⚡ skill
          </button>
          {pendingSkill && (
            <span className="inline-flex items-center gap-1 rounded border border-accent/50 bg-accent/10 px-1.5 py-0.5 text-accent">
              {pendingSkill.name}
              <button
                onClick={() => setPendingSkill(null)}
                className="hover:text-zinc-200"
                title="Remove"
              >
                ✕
              </button>
            </span>
          )}
          {prefs.permissionMode === "plan" && (
            <span className="text-sky-400/80">read-only — agent won't edit or run commands</span>
          )}
          {prefs.permissionMode === "bypassPermissions" && (
            <span className="text-amber-400/80">⚠ no confirmation gating</span>
          )}
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder={
              streaming ? "agent is working — Stop or wait…" : "Tell the agent what to do.   Enter to send, Shift+Enter for newline."
            }
            disabled={streaming}
            className="flex-1 resize-none bg-ink-700/40 border border-ink-500 rounded px-3 py-2 text-sm text-zinc-100 font-mono leading-relaxed placeholder:text-zinc-600 focus:border-accent/60"
            rows={1}
          />
          {streaming ? (
            <button
              onClick={onStop}
              className="px-4 py-2 rounded border border-red-500/60 text-red-300 hover:bg-red-500/10 text-sm font-mono"
            >
              ⛔ stop
            </button>
          ) : (
            <button
              onClick={onSubmit}
              disabled={!input.trim()}
              className="px-4 py-2 rounded bg-accent text-ink-900 font-semibold disabled:opacity-40 text-sm"
            >
              send
            </button>
          )}
        </div>
      </div>

      {skillLibraryOpen && (
        <SkillLibrary
          onUse={(skill, prompt) => {
            setPendingSkill(skill);
            if (prompt) setInput(prompt);
            setSkillLibraryOpen(false);
            taRef.current?.focus();
          }}
          onClose={() => setSkillLibraryOpen(false)}
        />
      )}
    </main>
  );
}

function PermissionModeSelect({
  value,
  onChange,
}: {
  value: PermissionMode;
  onChange: (m: PermissionMode) => void;
}) {
  const active = PERMISSION_MODES.find((m) => m.value === value);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as PermissionMode)}
      title={active?.hint}
      className="rounded border border-ink-500 bg-ink-700/40 px-1.5 py-0.5 text-[10px] font-mono text-zinc-200 focus:border-accent/60"
    >
      {PERMISSION_MODES.map((m) => (
        <option key={m.value} value={m.value} className="bg-ink-800">
          {m.label}
        </option>
      ))}
    </select>
  );
}

function Empty() {
  const workspace = useStore((s) => s.workspace);
  return (
    <div className="h-full grid place-items-center text-zinc-500 text-sm font-mono">
      <div className="max-w-md text-center">
        <div className="mb-2 font-semibold text-zinc-300">Ready.</div>
        {workspace ? (
          <div className="text-xs leading-relaxed">
            Working in <span className="text-accent">{workspace}</span>.<br />
            Try <span className="text-accent">"summarize this project"</span>, or attach the{" "}
            <span className="text-accent">Project Onboarding</span> workflow with <span className="text-zinc-400">⚡ skill</span>.
          </div>
        ) : (
          <div className="text-xs leading-relaxed">
            Pick a <span className="text-accent">Project</span> above to work in a codebase — or just ask.
            <br />
            Try <span className="text-accent">"list the files here"</span> or attach a{" "}
            <span className="text-zinc-400">⚡ skill</span> workflow.
          </div>
        )}
        <div className="mt-3 text-[10px] text-zinc-600">
          ⌘K command palette · ⚡ workflow skills · Mode controls what the agent may do
        </div>
      </div>
    </div>
  );
}

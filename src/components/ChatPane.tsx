import { useEffect, useRef, useState } from "react";
import { cancelTurn, startTurn, uploadImage } from "../lib/ipc";
import { useStore } from "../lib/store";
import { v4 as uuid } from "../lib/uuid";
import { PERMISSION_MODES, ALL_TOOLS, MODELS } from "../lib/prefs";
import { asDirective, type WorkflowSkill } from "../lib/skillLibrary";
import type { PermissionMode } from "../lib/types";
import MessageItem from "./MessageItem";
import WorkspaceBar from "./WorkspaceBar";
import SkillLibrary from "./SkillLibrary";
import LiveActivity from "./LiveActivity";

// A pending composer image attachment. `url` is an object URL for the
// thumbnail; `bytes` is what we POST to the server on send.
type Attachment = { id: string; name: string; mime: string; url: string; bytes: Uint8Array };
const MAX_ATTACHMENTS = 6;
const MAX_ATTACH_BYTES = 12 * 1024 * 1024; // mirrors the server's per-file cap
const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp)$/i;

export default function ChatPane({ onOpenSidebar }: { onOpenSidebar: () => void }) {
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
  const pushToast = useStore((s) => s.pushToast);

  const [input, setInput] = useState("");
  const [atBottom, setAtBottom] = useState(true);
  const [pendingSkill, setPendingSkill] = useState<WorkflowSkill | null>(null);
  const [skillLibraryOpen, setSkillLibraryOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

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

  // ---- image attachments ----

  async function addFiles(files: FileList | File[]) {
    const incoming = Array.from(files).filter((f) => IMAGE_MIME.test(f.type));
    if (!incoming.length) return;
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      pushToast("info", `Up to ${MAX_ATTACHMENTS} images per message.`);
      return;
    }
    const next: Attachment[] = [];
    for (const f of incoming.slice(0, room)) {
      if (f.size > MAX_ATTACH_BYTES) {
        pushToast("error", `${f.name || "image"} is too large (max 12 MB).`);
        continue;
      }
      const bytes = new Uint8Array(await f.arrayBuffer());
      next.push({
        id: uuid(),
        name: f.name || "image",
        mime: f.type,
        url: URL.createObjectURL(f),
        bytes,
      });
    }
    if (next.length) setAttachments((a) => [...a, ...next]);
  }

  function removeAttachment(id: string) {
    setAttachments((a) => {
      const hit = a.find((x) => x.id === id);
      if (hit) URL.revokeObjectURL(hit.url);
      return a.filter((x) => x.id !== id);
    });
  }

  function onPaste(e: React.ClipboardEvent) {
    const imgs = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === "file" && IMAGE_MIME.test(it.type))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (imgs.length) {
      e.preventDefault();
      void addFiles(imgs);
    }
  }

  function onDrop(e: React.DragEvent) {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    void addFiles(e.dataTransfer.files);
  }

  function onDragOver(e: React.DragEvent) {
    if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) e.preventDefault();
  }

  async function onSubmit() {
    const text = input.trim();
    const atts = attachments;
    if ((!text && atts.length === 0) || streaming || uploading) return;

    // Stage attachments on the server first. The file has to land before the
    // turn so the agent can Read it. If any upload fails, keep the composer
    // intact (caption + thumbnails) so the user can retry.
    let uploadedPaths: string[] = [];
    if (atts.length) {
      setUploading(true);
      try {
        const results = await Promise.all(
          atts.map((a) => uploadImage(a.bytes, a.name, a.mime)),
        );
        uploadedPaths = results.map((r) => r.path);
      } catch (e) {
        setUploading(false);
        pushToast("error", `Image upload failed: ${String(e).slice(0, 200)}`);
        return;
      }
      setUploading(false);
    }

    setInput("");
    setAttachments([]); // object URLs now belong to the rendered message
    jumpToBottom(); // sending is an explicit signal — follow the new turn

    // The transcript shows what the user typed (+ thumbnails); a selected
    // workflow skill rides in `skill_directive` so it never pollutes the
    // visible history OR the keyword-skill matching the server runs.
    appendUserMessage(text, atts.length ? atts.map((a) => a.url) : undefined);
    const directive = pendingSkill ? asDirective(pendingSkill) : null;
    setPendingSkill(null);

    // Prompt the agent receives: caption + a Read directive for each staged
    // image (same pattern the Telegram relay uses).
    let prompt = text;
    if (uploadedPaths.length) {
      const list = uploadedPaths.map((p) => p).join("\n");
      const plural = uploadedPaths.length > 1;
      const note =
        `[The user attached ${uploadedPaths.length} image${plural ? "s" : ""}, ` +
        `saved on the server. View ${plural ? "each" : "it"} with your Read tool:\n${list}]`;
      prompt = text ? `${text}\n\n${note}` : note;
    }

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
          prompt,
          skill_directive: directive,
          resume_session_id: session.claude_session_id ?? null,
          permission_mode: prefs.permissionMode,
          allowed_tools: prefs.allowedTools,
          disallowed_tools: disallowed,
          model: prefs.model || null,
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
      {/* Mobile-only top bar: the sidebar is a drawer below md, so this is the
          way in. Hidden on desktop where the rail is always visible. */}
      <div className="flex items-center gap-2 border-b border-ink-600 bg-ink-800/40 px-3 py-2 md:hidden">
        <button
          onClick={onOpenSidebar}
          title="Open sessions"
          className="rounded border border-ink-500 px-2.5 py-1 text-sm text-zinc-300 hover:bg-ink-600/40"
        >
          ☰
        </button>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-accent" />
          <span className="wordmark text-sm text-accent">ATLAS</span>
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-3 py-3 md:px-6 md:py-4 space-y-3"
      >
        {messages.length === 0 ? (
          <Empty />
        ) : (
          messages.map((m) => <MessageItem key={m.id} message={m} />)
        )}
        {streaming && <LiveActivity messages={messages} />}
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

      <div className="border-t border-ink-600 bg-ink-800/40 px-3 py-2 md:px-4 md:py-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:pb-3">
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
        <div className="relative mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-mono text-zinc-500">
          <span className="uppercase tracking-wide">Mode</span>
          <PermissionModeSelect
            value={prefs.permissionMode}
            onChange={(m) => setPrefs({ permissionMode: m })}
          />
          <span className="uppercase tracking-wide">Model</span>
          <ModelSelect value={prefs.model} onChange={(m) => setPrefs({ model: m })} />
          <span className="uppercase tracking-wide">Project</span>
          <WorkspaceBar />
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
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <div key={a.id} className="relative">
                <img
                  src={a.url}
                  alt={a.name}
                  className="h-16 w-16 rounded border border-ink-500 object-cover"
                />
                <button
                  onClick={() => removeAttachment(a.id)}
                  title="Remove"
                  className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-ink-500 bg-ink-800 text-[11px] text-zinc-300 hover:bg-ink-700 hover:text-zinc-100"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          className="flex items-end gap-1.5 rounded-2xl border border-ink-600 bg-ink-700/30 pl-1.5 pr-1.5 py-1.5 transition-colors focus-within:border-accent/50"
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void addFiles(e.target.files);
              e.target.value = ""; // allow re-selecting the same file
            }}
          />
          <button
            onClick={() => setSkillLibraryOpen(true)}
            disabled={streaming || uploading}
            title="Browse the skill library"
            className="flex-none w-9 h-9 grid place-items-center rounded-full text-lg text-zinc-400 hover:bg-ink-600/50 hover:text-zinc-200 disabled:opacity-40"
          >
            +
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={streaming || uploading || attachments.length >= MAX_ATTACHMENTS}
            title="Attach image"
            className="flex-none w-9 h-9 grid place-items-center rounded-full text-zinc-400 hover:bg-ink-600/50 hover:text-zinc-200 disabled:opacity-40"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-[18px] w-[18px]"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder={
              uploading
                ? "Uploading image…"
                : streaming
                  ? "Atlas is working — Stop or wait…"
                  : "Give Atlas a task… (paste or drop an image)"
            }
            disabled={streaming || uploading}
            className="flex-1 resize-none bg-transparent px-1.5 py-1.5 text-base md:text-sm text-zinc-100 leading-relaxed placeholder:text-zinc-500"
            rows={1}
          />
          {streaming ? (
            <button
              onClick={onStop}
              title="Stop the current turn"
              className="flex-none w-9 h-9 grid place-items-center rounded-full border border-red-500/60 text-red-300 hover:bg-red-500/10"
            >
              ■
            </button>
          ) : (
            <button
              onClick={onSubmit}
              disabled={uploading || (!input.trim() && attachments.length === 0)}
              title="Send (Enter)"
              className="flex-none w-9 h-9 grid place-items-center rounded-full bg-accent text-ink-900 font-semibold disabled:opacity-30 transition-opacity"
            >
              {uploading ? <span className="text-xs">…</span> : "↑"}
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

function ModelSelect({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  // A known alias shows in the dropdown; anything else is a custom model id.
  const isKnown = MODELS.some((m) => m.value === value);
  const active = MODELS.find((m) => m.value === value);
  return (
    <select
      value={isKnown ? value : "__custom"}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "__custom") {
          const id = window.prompt("Full model id:", value && !isKnown ? value : "");
          onChange((id ?? "").trim());
        } else {
          onChange(v);
        }
      }}
      title={active?.hint ?? (value ? `custom: ${value}` : "")}
      className="rounded border border-ink-500 bg-ink-700/40 px-1.5 py-0.5 text-[10px] font-mono text-zinc-200 focus:border-accent/60"
    >
      {MODELS.map((m) => (
        <option key={m.value || "default"} value={m.value} className="bg-ink-800">
          {m.label}
        </option>
      ))}
      <option value="__custom" className="bg-ink-800">
        {isKnown ? "Custom…" : `Custom: ${value}`}
      </option>
    </select>
  );
}

function Empty() {
  const workspace = useStore((s) => s.workspace);
  return (
    <div className="h-full grid place-items-center px-4 text-center">
      <div className="max-w-xl">
        <div className="wordmark select-none text-accent text-5xl md:text-7xl leading-none">
          ATLAS
        </div>
        <div className="mt-4 text-sm md:text-base text-zinc-400">
          Send the problem, file, or idea. I'll follow the personality you've configured.
        </div>
        <div className="mt-5 text-xs leading-relaxed text-zinc-500">
          {workspace ? (
            <>
              Working in <span className="text-accent">{workspace}</span> — try{" "}
              <span className="text-zinc-300">"summarize this project"</span>.
            </>
          ) : (
            <>
              Pick a <span className="text-accent">Project</span> above to work in a codebase — or just ask.
            </>
          )}
        </div>
        <div className="mt-2 text-[10px] text-zinc-600">
          ⌘K command palette · + workflow skills · Mode controls what the agent may do
        </div>
      </div>
    </div>
  );
}

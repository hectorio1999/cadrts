import { useEffect, useRef, useState } from "react";
import { cancelTurn, startTurn } from "../lib/ipc";
import { useStore } from "../lib/store";
import { v4 as uuid } from "../lib/uuid";
import MessageItem from "./MessageItem";

const DEFAULT_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch"];

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

  const [input, setInput] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-grow textarea
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [input]);

  // Auto-scroll on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  async function onSubmit() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    appendUserMessage(text);

    const turnId = uuid();
    setCurrentTurn(turnId);
    setStreaming(true);

    try {
      await startTurn(
        {
          turn_id: turnId,
          prompt: text,
          resume_session_id: session.claude_session_id ?? null,
          permission_mode: "acceptEdits",
          allowed_tools: DEFAULT_TOOLS,
          cwd: null,
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
    <main className="flex-1 min-w-0 flex flex-col bg-ink-900">
      <div
        ref={scrollRef}
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
    </main>
  );
}

function Empty() {
  return (
    <div className="h-full grid place-items-center text-zinc-500 text-sm font-mono">
      <div className="text-center max-w-md">
        <div className="text-zinc-300 font-semibold mb-2">Ready.</div>
        <div className="text-xs leading-relaxed">
          Try: <span className="text-accent">"list the files in my home directory"</span>,{" "}
          or <span className="text-accent">"summarize the contents of <code>README.md</code> in this folder"</span>.
        </div>
        <div className="text-[10px] mt-3 text-zinc-600">
          Tools: Bash · Read · Write · Edit · Glob · Grep · WebFetch · WebSearch
        </div>
      </div>
    </div>
  );
}

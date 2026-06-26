// Single zustand store. Domain split into slices, exposed as one hook so
// components can pick what they need without prop drilling.

import { create } from "zustand";
import { v4 as uuid } from "./uuid";
import {
  listSessions as ipcListSessions,
  loadMessages as ipcLoadMessages,
  persistSession as ipcPersistSession,
} from "./ipc";
import { loadWorkspace, loadRecents, saveWorkspace, pushRecent } from "./workspace";
import { loadPrefs, savePrefs, type AgentPrefs } from "./prefs";
import type {
  AgentEvent,
  AgentEventEnvelope,
  AuthStatus,
  ChatMessage,
  ContentBlock,
  PersistedContent,
  Session,
  SessionRow,
  Toast,
  ToastKind,
  ToolRun,
  TurnOutcome,
} from "./types";

type State = {
  auth: AuthStatus | null;
  setAuth: (a: AuthStatus | null) => void;

  // Past sessions surfaced in the sidebar (loaded from SQLite on boot).
  sessionList: SessionRow[];
  refreshSessions: () => Promise<void>;
  openSession: (sessionId: string) => Promise<void>;

  // The session currently loaded into the chat pane.
  session: Session;
  messages: ChatMessage[];

  // Active project root the agent operates in (sent as `cwd` on every turn).
  // null = run in the agent's default HOME (no project).
  workspace: string | null;
  workspaceRecents: string[];
  setWorkspace: (path: string | null) => void;

  // Agent preferences (permission mode + allowed tools), persisted.
  prefs: AgentPrefs;
  setPrefs: (patch: Partial<AgentPrefs>) => void;

  // Current in-flight turn metadata.
  currentTurnId: string | null;
  streaming: boolean;
  lastOutcome: TurnOutcome | null;

  // Side panel
  inspectorOpen: boolean;
  toggleInspector: () => void;
  selectedToolRunId: string | null;
  selectToolRun: (id: string | null) => void;

  // Transient notifications.
  toasts: Toast[];
  pushToast: (kind: ToastKind, message: string) => void;
  dismissToast: (id: string) => void;

  // Mutations called from ChatPane/Composer.
  appendUserMessage: (text: string, images?: string[]) => string; // returns the new user message id
  beginAssistantMessage: () => string;          // returns the new assistant message id
  appendAssistantText: (msgId: string, delta: string) => void;
  streamAssistantDelta: (msgId: string, delta: string) => void; // token delta; also marks `streamed`
  upsertToolRun: (msgId: string, run: ToolRun) => void;
  completeToolRun: (toolUseId: string, content: unknown, isError: boolean) => void;
  finishAssistantMessage: (msgId: string) => void;

  setCurrentTurn: (turnId: string | null) => void;
  setStreaming: (b: boolean) => void;
  setLastOutcome: (o: TurnOutcome | null) => void;

  handleEnvelope: (env: AgentEventEnvelope) => void;
  resetSession: () => void;
  /** Drop the upstream `claude_session_id` only — keep the visible chat
   *  history intact. Used when a turn comes back with an auth/resume
   *  error so the *next* message starts a fresh upstream conversation
   *  without nuking what the user is reading on screen. */
  clearClaudeSessionId: () => void;
};

function makeSession(): Session {
  return {
    id: uuid(),
    title: "New session",
    claude_session_id: null,
    created_at: Date.now(),
    last_at: Date.now(),
  };
}

export const useStore = create<State>((set, get) => ({
  auth: null,
  setAuth: (a) => set({ auth: a }),

  sessionList: [],
  refreshSessions: async () => {
    try {
      const rows = await ipcListSessions(200);
      set({ sessionList: rows });
    } catch {
      // Ignore — sidebar will simply not refresh.
    }
  },
  openSession: async (sessionId) => {
    const rows = await ipcLoadMessages(sessionId);
    const header = get().sessionList.find((s) => s.id === sessionId);
    const messages: ChatMessage[] = rows.map((r) => {
      let parsed: PersistedContent = { text: "" };
      try {
        parsed = JSON.parse(r.content_json) as PersistedContent;
      } catch {
        parsed = { text: r.content_json };
      }
      return {
        id: `${sessionId}-${r.id}`,
        role: r.role === "user" ? "user" : "assistant",
        text: parsed.text ?? "",
        tools: parsed.tools ?? [],
        done: true,
        ts: r.ts,
      };
    });
    set({
      session: {
        id: sessionId,
        title: header?.title ?? "Session",
        claude_session_id: header?.claude_session_id ?? null,
        created_at: header?.created_at ?? Date.now(),
        last_at: header?.last_at ?? Date.now(),
      },
      messages,
      currentTurnId: null,
      streaming: false,
      lastOutcome: null,
      selectedToolRunId: null,
    });
  },

  session: makeSession(),
  messages: [],

  workspace: loadWorkspace(),
  workspaceRecents: loadRecents(),
  setWorkspace: (path) => {
    saveWorkspace(path);
    set({
      workspace: path,
      workspaceRecents: path ? pushRecent(path) : get().workspaceRecents,
    });
  },

  prefs: loadPrefs(),
  setPrefs: (patch) => {
    const next = { ...get().prefs, ...patch };
    savePrefs(next);
    set({ prefs: next });
  },

  currentTurnId: null,
  streaming: false,
  lastOutcome: null,

  inspectorOpen: false,
  toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
  selectedToolRunId: null,
  selectToolRun: (id) => set({ selectedToolRunId: id }),

  toasts: [],
  pushToast: (kind, message) => {
    const id = uuid();
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    // Errors stay until dismissed (they often matter — e.g. a failed save);
    // info/success auto-expire.
    if (kind !== "error") {
      window.setTimeout(() => get().dismissToast(id), 4000);
    }
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  appendUserMessage: (text, images) => {
    const id = uuid();
    set((s) => ({
      messages: [
        ...s.messages,
        { id, role: "user", text, tools: [], images, done: true, ts: Date.now() },
      ],
    }));
    return id;
  },

  beginAssistantMessage: () => {
    const id = uuid();
    set((s) => ({
      messages: [
        ...s.messages,
        { id, role: "assistant", text: "", tools: [], done: false, ts: Date.now() },
      ],
    }));
    return id;
  },

  appendAssistantText: (msgId, delta) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === msgId ? { ...m, text: m.text + delta } : m,
      ),
    })),

  streamAssistantDelta: (msgId, delta) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === msgId ? { ...m, text: m.text + delta, streamed: true } : m,
      ),
    })),

  upsertToolRun: (msgId, run) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== msgId) return m;
        const idx = m.tools.findIndex((t) => t.tool_use_id === run.tool_use_id);
        if (idx === -1) return { ...m, tools: [...m.tools, run] };
        const copy = m.tools.slice();
        copy[idx] = { ...copy[idx], ...run };
        return { ...m, tools: copy };
      }),
    })),

  completeToolRun: (toolUseId, content, isError) =>
    set((s) => ({
      messages: s.messages.map((m) => ({
        ...m,
        tools: m.tools.map((t) =>
          t.tool_use_id === toolUseId
            ? { ...t, output: content, is_error: isError, ended_at: Date.now() }
            : t,
        ),
      })),
    })),

  finishAssistantMessage: (msgId) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === msgId ? { ...m, done: true } : m,
      ),
    })),

  setCurrentTurn: (turnId) => set({ currentTurnId: turnId }),
  setStreaming: (b) => set({ streaming: b }),
  setLastOutcome: (o) => set({ lastOutcome: o }),

  resetSession: () =>
    set({
      session: makeSession(),
      messages: [],
      currentTurnId: null,
      streaming: false,
      lastOutcome: null,
      selectedToolRunId: null,
    }),

  clearClaudeSessionId: () =>
    set((s) => ({ session: { ...s.session, claude_session_id: null } })),

  // Single sink for backend envelopes. ChatPane wires this to startTurn().
  handleEnvelope: (env) => {
    const s = get();
    if (env.kind === "outcome") {
      // Auto-recover from broken upstream sessions. The most common shapes:
      //   - "Failed to authenticate. API Error: 401 ..."  (Anthropic rejected the token)
      //   - "session not found" / claude couldn't --resume an id we cached
      //   - empty/degenerate final text from --resume against a gone HOME
      // In all these cases the cached `claude_session_id` is poisoned;
      // dropping it makes the *next* message start a fresh upstream
      // conversation without the user having to hit "+ new" manually.
      // We keep the visible message history so they can read the error
      // and just retype.
      const ft = env.outcome.final_text ?? "";
      const looksAuthBroken =
        env.outcome.is_error &&
        (/(?:401|Invalid (?:bearer|authentication)|authentication credentials|session not found)/i.test(ft));
      if (looksAuthBroken) {
        // Don't capture the outcome's session_id here — it'd just re-poison the cache.
        set({
          session: { ...s.session, claude_session_id: null, last_at: Date.now() },
          lastOutcome: env.outcome,
          streaming: false,
        });
        const last = s.messages.findLast?.((m) => m.role === "assistant" && !m.done);
        if (last) s.finishAssistantMessage(last.id);
        return;
      }

      // Capture the upstream claude session_id so subsequent turns resume the conversation.
      const sid = env.outcome.session_id;
      const nextSession = sid
        ? { ...s.session, claude_session_id: sid, last_at: Date.now() }
        : { ...s.session, last_at: Date.now() };
      set({ session: nextSession, lastOutcome: env.outcome, streaming: false });
      // Mark any unfinished assistant message as done.
      const last = s.messages.findLast?.((m) => m.role === "assistant" && !m.done);
      if (last) s.finishAssistantMessage(last.id);

      // Persist asynchronously — failure here shouldn't disrupt the chat UX.
      const cur = get();
      const title = autoTitle(cur.messages, cur.session.title);
      ipcPersistSession({
        session_id: cur.session.id,
        title,
        claude_session_id: cur.session.claude_session_id,
        total_cost_delta: env.outcome.total_cost_usd ?? 0,
        messages: cur.messages.map((m, i) => ({
          idx: i,
          role: m.role,
          content_json: JSON.stringify({ text: m.text, tools: m.tools }),
        })),
      })
        .then(() => get().refreshSessions())
        .catch(() => {
          // Don't fail silently — a lost persist means lost history.
          get().pushToast(
            "error",
            "Couldn't save this session. Your latest messages may not persist.",
          );
        });
      if (title !== cur.session.title) {
        set({ session: { ...cur.session, title } });
      }
      return;
    }
    if (env.kind === "error") {
      set({ streaming: false });
      // Close out any half-streamed assistant bubble first, otherwise its
      // caret never stops AND the next turn's text would append into it
      // (routeEvent targets the last unfinished assistant message).
      const stale = s.messages.findLast?.((m) => m.role === "assistant" && !m.done);
      if (stale) s.finishAssistantMessage(stale.id);
      // Surface the failure as its own assistant message.
      const id = s.beginAssistantMessage();
      s.appendAssistantText(id, `⚠ transport error: ${env.message}`);
      s.finishAssistantMessage(id);
      return;
    }
    // env.kind === "event"
    routeEvent(s, env.event);
  },
}));

/**
 * Derive a tight session title from the first user message. We do this in
 * the client (rather than asking the model) so it's deterministic and free.
 */
function autoTitle(messages: ChatMessage[], current: string): string {
  if (current && current !== "New session") return current;
  const first = messages.find((m) => m.role === "user")?.text ?? "";
  const cleaned = first.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New session";
  return cleaned.length > 48 ? cleaned.slice(0, 47) + "…" : cleaned;
}

function routeEvent(s: ReturnType<typeof useStore.getState>, ev: AgentEvent) {
  switch (ev.type) {
    case "system": {
      // First system/init carries the upstream session_id.
      if (ev.session_id && !s.session.claude_session_id) {
        useStore.setState({
          session: { ...s.session, claude_session_id: ev.session_id },
        });
      }
      return;
    }
    case "assistant": {
      const msg = ev.message;
      if (!msg?.content) return;
      // Find or create the active assistant message.
      let activeId =
        s.messages.findLast?.((m) => m.role === "assistant" && !m.done)?.id ?? null;
      if (!activeId) activeId = s.beginAssistantMessage();
      // If token deltas already streamed this message's text (RTS-113), the
      // final assistant text block duplicates it — skip text, keep tool_use.
      const active = s.messages.find((m) => m.id === activeId);

      for (const block of msg.content as ContentBlock[]) {
        if (block.type === "text") {
          if (!active?.streamed) s.appendAssistantText(activeId, block.text);
        } else if (block.type === "tool_use") {
          s.upsertToolRun(activeId, {
            tool_use_id: block.id,
            name: block.name,
            input: block.input,
            started_at: Date.now(),
          });
        }
        // thinking blocks: intentionally not surfaced in chat — they're in the inspector
      }
      return;
    }
    case "user": {
      // Tool_result echo from the harness.
      const content = ev.message?.content;
      if (!content) return;
      for (const block of content as ContentBlock[]) {
        if (block.type === "tool_result") {
          s.completeToolRun(
            block.tool_use_id,
            block.content,
            Boolean(block.is_error),
          );
        }
      }
      return;
    }
    case "stream_event": {
      // Token-level streaming (--include-partial-messages, RTS-113). Render
      // text_delta tokens live into the active assistant bubble; ignore
      // thinking/signature/input_json deltas and message/block framing.
      const inner = ev.event;
      if (
        inner?.type === "content_block_delta" &&
        inner.delta?.type === "text_delta" &&
        inner.delta.text
      ) {
        let activeId =
          s.messages.findLast?.((m) => m.role === "assistant" && !m.done)?.id ?? null;
        if (!activeId) activeId = s.beginAssistantMessage();
        s.streamAssistantDelta(activeId, inner.delta.text);
      }
      return;
    }
    case "result":
      // Outcome will be delivered separately. Nothing to do here.
      return;
    default:
      return;
  }
}

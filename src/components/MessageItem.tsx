import type { ChatMessage } from "../lib/types";
import ToolCallCard from "./ToolCallCard";
import MarkdownView from "./Markdown";
import CopyButton from "./CopyButton";

export default function MessageItem({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="group flex justify-end">
        <div className="relative max-w-[80%] rounded-lg border border-accent/40 px-3 py-2 text-sm font-mono whitespace-pre-wrap text-zinc-100">
          {message.text}
          <div className="pointer-events-none absolute -bottom-4 right-0 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
            <CopyButton text={message.text} />
          </div>
        </div>
      </div>
    );
  }

  // Assistant. Text renders as markdown; tool runs follow underneath. Text and
  // tool_use blocks alternate upstream, but rendering text-then-tools keeps the
  // UI calm and readable.
  return (
    <div className="group flex">
      <div className="min-w-0 flex-1 max-w-[92%]">
        <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
          <span>claude</span>
          {!message.done && <span className="text-accent blink-caret">▍</span>}
          {message.done && message.text.length > 0 && (
            <span className="opacity-0 transition-opacity group-hover:opacity-100">
              <CopyButton text={message.text} />
            </span>
          )}
        </div>
        {message.text && <MarkdownView>{message.text}</MarkdownView>}
        {message.tools.length > 0 && (
          <div className="mt-2 space-y-2">
            {message.tools.map((t) => (
              <ToolCallCard key={t.tool_use_id} run={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

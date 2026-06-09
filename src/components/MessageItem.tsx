import type { ChatMessage } from "../lib/types";
import ToolCallCard from "./ToolCallCard";

export default function MessageItem({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded border border-ink-500 bg-ink-700/40 px-3 py-2 text-sm font-mono whitespace-pre-wrap text-zinc-100">
          {message.text}
        </div>
      </div>
    );
  }

  // Assistant — interleave text and tool runs in chronological-ish order.
  // We always render tools first (under the text) for simplicity; in practice
  // text and tool_use blocks alternate, and the model usually narrates around
  // each tool call. This keeps the UI calm.
  return (
    <div className="flex">
      <div className="flex-1 max-w-[92%]">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
          claude
          {!message.done && (
            <span className="ml-2 text-accent blink-caret">▍</span>
          )}
        </div>
        {message.text && (
          <div className="text-sm leading-relaxed whitespace-pre-wrap text-zinc-200">
            {message.text}
          </div>
        )}
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

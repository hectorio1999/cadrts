import type { ChatMessage } from "../lib/types";
import ToolGroup from "./ToolCallCard";
import MarkdownView from "./Markdown";
import CopyButton from "./CopyButton";
import { useSmoothText } from "../lib/useSmoothText";

export default function MessageItem({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="group flex justify-end">
        <div className="relative max-w-[80%] rounded-lg border border-accent/40 px-3 py-2 text-sm font-mono whitespace-pre-wrap text-zinc-100">
          {message.images && message.images.length > 0 && (
            <div className="mb-2 flex flex-wrap justify-end gap-2">
              {message.images.map((src, i) => (
                <a key={i} href={src} target="_blank" rel="noreferrer">
                  <img
                    src={src}
                    alt={`attachment ${i + 1}`}
                    className="max-h-40 max-w-[12rem] rounded border border-ink-500 object-cover"
                  />
                </a>
              ))}
            </div>
          )}
          {message.text}
          <div className="pointer-events-none absolute -bottom-4 right-0 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
            <CopyButton text={message.text} />
          </div>
        </div>
      </div>
    );
  }

  return <AssistantMessage message={message} />;
}

// Assistant. Text renders as markdown; tool runs follow underneath. Text and
// tool_use blocks alternate upstream, but rendering text-then-tools keeps the
// UI calm and readable. While the turn is live, `useSmoothText` meters the
// reveal so streamed text flows at an even cadence instead of bursting in.
function AssistantMessage({ message }: { message: ChatMessage }) {
  const shownText = useSmoothText(message.text, !message.done);
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
        {shownText && <MarkdownView>{shownText}</MarkdownView>}
        {message.tools.length > 0 && (
          <div className="mt-2">
            <ToolGroup runs={message.tools} />
          </div>
        )}
      </div>
    </div>
  );
}

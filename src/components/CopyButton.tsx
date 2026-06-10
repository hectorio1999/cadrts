import { useState } from "react";
import { copyText } from "../lib/clipboard";

/** Small inline "copy" affordance with a transient confirmation. */
export default function CopyButton({
  text,
  label = "copy",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        const ok = await copyText(text);
        if (ok) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }
      }}
      title="Copy to clipboard"
      className={
        className ??
        "rounded px-1.5 py-0.5 text-[10px] font-mono text-zinc-500 hover:bg-ink-600/40 hover:text-zinc-200"
      }
    >
      {copied ? "✓ copied" : label}
    </button>
  );
}

import CopyButton from "./CopyButton";

/** A fenced code block with a language label and a copy button. */
export default function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-ink-500 bg-ink-900/70">
      <div className="flex items-center justify-between border-b border-ink-600 bg-ink-800/60 px-3 py-1">
        <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">
          {lang || "code"}
        </span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto px-3 py-2 text-xs leading-relaxed">
        <code className="font-mono text-zinc-200">{code}</code>
      </pre>
    </div>
  );
}

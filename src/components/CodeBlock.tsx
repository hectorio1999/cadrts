import { useEffect, useState } from "react";
import CopyButton from "./CopyButton";

// Syntax highlighting (RTS-119): highlight.js is lazy-loaded on the first
// code block so the main bundle stays lean. `lib/common` bundles ~35 popular
// languages; PowerShell and Dockerfile matter in this house, so they're
// registered on top. Token colors live in styles.css under `.hljs-*`.
type Hljs = typeof import("highlight.js/lib/core").default;
let hljsPromise: Promise<Hljs> | null = null;

function loadHljs(): Promise<Hljs> {
  if (!hljsPromise) {
    hljsPromise = (async () => {
      const [{ default: hljs }, { default: powershell }, { default: dockerfile }] =
        await Promise.all([
          import("highlight.js/lib/common"),
          import("highlight.js/lib/languages/powershell"),
          import("highlight.js/lib/languages/dockerfile"),
        ]);
      hljs.registerLanguage("powershell", powershell);
      hljs.registerLanguage("dockerfile", dockerfile);
      return hljs;
    })();
  }
  return hljsPromise;
}

/** A fenced code block with a language label, copy button, and (when the
 *  language is known) highlight.js token coloring. Highlighting re-runs as
 *  streamed code grows; hljs escapes its output so the injected HTML is safe.
 *  Unknown/absent languages render as plain text — no auto-detect (jumpy and
 *  costly on partial, still-streaming code). */
export default function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const name = (lang || "").toLowerCase();
    if (!name) {
      setHtml(null);
      return;
    }
    loadHljs()
      .then((hljs) => {
        if (!alive) return;
        if (!hljs.getLanguage(name)) {
          setHtml(null);
          return;
        }
        const res = hljs.highlight(code, { language: name, ignoreIllegals: true });
        if (alive) setHtml(res.value);
      })
      .catch(() => {
        if (alive) setHtml(null); // highlighting is decoration — never break render
      });
    return () => {
      alive = false;
    };
  }, [code, lang]);

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-ink-500 bg-ink-900/70">
      <div className="flex items-center justify-between border-b border-ink-600 bg-ink-800/60 px-3 py-1">
        <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">
          {lang || "code"}
        </span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto px-3 py-2 text-xs leading-relaxed">
        {html != null ? (
          <code className="hljs font-mono text-zinc-200" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code className="font-mono text-zinc-200">{code}</code>
        )}
      </pre>
    </div>
  );
}

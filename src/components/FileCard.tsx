// Renders a file Atlas hands back in chat (RTS-110). Atlas emits a fenced
// ```cad-file {json}``` block (via the `share` CLI); Markdown.tsx routes it
// here. Images render inline, videos get a player, everything else is a
// download chip. The file is served by the agent-server at GET /api/files/:id.

import { useEffect, useRef, useState } from "react";
import { fetchFileObjectUrl, fileUrl } from "../lib/ipc";
import { useStore } from "../lib/store";

type FileKind = "image" | "video" | "file";
type FileDescriptor = {
  id: string;
  name: string;
  mime?: string;
  bytes?: number;
  kind?: FileKind;
};

function parse(raw: string): FileDescriptor | null {
  try {
    const d = JSON.parse(raw.trim()) as FileDescriptor;
    return d && typeof d.id === "string" && d.id ? d : null;
  } catch {
    return null;
  }
}

function fmtBytes(n?: number): string {
  if (!n || n < 0) return "";
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

function effectiveKind(d: FileDescriptor): FileKind {
  if (d.kind) return d.kind;
  const m = d.mime ?? "";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  return "file";
}

export default function FileCard({ raw }: { raw: string }) {
  const d = parse(raw);
  const kind = d ? effectiveKind(d) : "file";
  const pushToast = useStore((s) => s.pushToast);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const revokeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!d) return;
    let alive = true;
    if (kind === "image") {
      fetchFileObjectUrl(d.id)
        .then((u) => {
          if (!alive) {
            URL.revokeObjectURL(u);
            return;
          }
          revokeRef.current = u;
          setImgUrl(u);
        })
        .catch(() => {});
    } else if (kind === "video") {
      fileUrl(d.id).then((u) => alive && setVideoUrl(u)).catch(() => {});
    }
    return () => {
      alive = false;
      if (revokeRef.current) {
        URL.revokeObjectURL(revokeRef.current);
        revokeRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.id, kind]);

  if (!d) {
    return (
      <div className="my-2 rounded-lg border border-ink-600 bg-ink-800/40 px-3 py-2 text-xs text-zinc-400">
        (unreadable file reference)
      </div>
    );
  }

  async function onDownload() {
    if (!d) return;
    setDownloading(true);
    try {
      const u = await fetchFileObjectUrl(d.id);
      const a = document.createElement("a");
      a.href = u;
      a.download = d.name || "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 5000);
    } catch (e) {
      pushToast("error", `Couldn't download ${d.name}: ${String(e).slice(0, 160)}`);
    } finally {
      setDownloading(false);
    }
  }

  const meta = [d.mime, fmtBytes(d.bytes)].filter(Boolean).join(" · ");

  if (kind === "image") {
    return (
      <div className="my-2 max-w-md">
        {imgUrl ? (
          <a href={imgUrl} target="_blank" rel="noreferrer">
            <img
              src={imgUrl}
              alt={d.name}
              className="max-h-96 w-auto rounded-lg border border-ink-600"
            />
          </a>
        ) : (
          <div className="grid h-40 place-items-center rounded-lg border border-ink-600 bg-ink-800/40 text-xs text-zinc-500">
            loading image…
          </div>
        )}
        <DownloadRow name={d.name} meta={meta} onDownload={onDownload} busy={downloading} />
      </div>
    );
  }

  if (kind === "video") {
    return (
      <div className="my-2 max-w-lg">
        {videoUrl ? (
          <video
            src={videoUrl}
            controls
            className="max-h-96 w-full rounded-lg border border-ink-600 bg-black"
          />
        ) : (
          <div className="grid h-40 place-items-center rounded-lg border border-ink-600 bg-ink-800/40 text-xs text-zinc-500">
            loading video…
          </div>
        )}
        <DownloadRow name={d.name} meta={meta} onDownload={onDownload} busy={downloading} />
      </div>
    );
  }

  // Generic file → download chip.
  return (
    <div className="my-2 flex max-w-md items-center gap-3 rounded-lg border border-ink-600 bg-ink-800/40 px-3 py-2">
      <div className="grid h-9 w-9 flex-none place-items-center rounded bg-ink-700/60 text-accent">
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-zinc-100" title={d.name}>
          {d.name}
        </div>
        {meta && <div className="text-[11px] text-zinc-500">{meta}</div>}
      </div>
      <button
        onClick={onDownload}
        disabled={downloading}
        className="flex-none rounded-md border border-ink-500 px-2.5 py-1 text-xs text-zinc-200 hover:bg-ink-600/40 disabled:opacity-50"
      >
        {downloading ? "…" : "Download"}
      </button>
    </div>
  );
}

function DownloadRow({
  name,
  meta,
  onDownload,
  busy,
}: {
  name: string;
  meta: string;
  onDownload: () => void;
  busy: boolean;
}) {
  return (
    <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
      <span className="truncate" title={name}>
        {name}
      </span>
      {meta && <span className="text-zinc-600">· {meta}</span>}
      <button
        onClick={onDownload}
        disabled={busy}
        className="ml-auto flex-none rounded border border-ink-600 px-2 py-0.5 text-zinc-300 hover:bg-ink-600/40 disabled:opacity-50"
      >
        {busy ? "…" : "Download"}
      </button>
    </div>
  );
}

// Tiny UUID v4. We don't pull in the `uuid` package just for one helper —
// the agent core already mints UUIDs server-side for everything that has to
// survive a process restart; client-side ids are ephemeral row keys.

export function v4(): string {
  // crypto.randomUUID is available in modern Tauri webviews (Edge WebView2,
  // wkwebview, webkitgtk). Fallback for older environments included below.
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();

  const b = new Uint8Array(16);
  if (c && c.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

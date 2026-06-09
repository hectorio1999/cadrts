// Runtime environment detection + browser-side bearer storage.
//
// The same React bundle ships as:
//   - Tauri webview embedded in a desktop binary (Local or Remote transport
//     selected via the Settings modal — Tauri side handles both).
//   - Plain browser opened against `https://agent.rosariotechsolutions.com`
//     (no Tauri host; the React app talks directly to /api/* + /ws/* with
//     a bearer token the user pasted at sign-in).
//
// Most code shouldn't care which it is — the typed IPC surface in `ipc.ts`
// hides it. The few places that do care (AuthGate routing, UpdateBadge
// "restart your desktop app" vs "reload" copy) use `isTauri()` here.

/**
 * True when running inside a Tauri 2 webview. Tauri injects
 * `__TAURI_INTERNALS__` on the global before the bundle loads.
 */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    // @ts-expect-error Tauri-injected
    typeof window.__TAURI_INTERNALS__ === "object"
  );
}

const TOKEN_KEY = "cad-bearer";

/** Bearer token used for `/api/*` + `/ws/*` calls from the browser. */
export function getBearerToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setBearerToken(t: string): void {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* localStorage disabled (private mode, etc.) — sign-in just won't stick */
  }
}

/**
 * Origin the browser bundle talks to. In production the bundle is served
 * by the same agent-server it talks to, so we hit relative URLs. In dev
 * (Vite at :1420) we point at the local server :9120.
 */
export function apiOrigin(): string {
  if (typeof window === "undefined") return "";
  const { protocol, host } = window.location;
  // Vite dev shell — talk to the localhost agent-server.
  if (host.startsWith("localhost:1420") || host.startsWith("127.0.0.1:1420")) {
    return "http://localhost:9120";
  }
  return `${protocol}//${host}`;
}

/**
 * WebSocket origin derived from the API origin. `wss://` for HTTPS,
 * `ws://` for HTTP.
 */
export function wsOrigin(): string {
  const o = apiOrigin();
  return o.replace(/^http/, "ws");
}

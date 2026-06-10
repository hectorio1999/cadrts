import { isTauri } from "./runtime";

/** Open a URL in the system browser. In the Tauri webview, navigating an
 *  <a target="_blank"> would otherwise try to load inside the app window, so
 *  we route through the opener plugin. In the browser bundle, window.open is
 *  the right behavior. */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    try {
      const opener = await import("@tauri-apps/plugin-opener");
      await opener.openUrl(url);
      return;
    } catch (e) {
      console.warn("[openExternal] opener failed, falling back:", e);
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

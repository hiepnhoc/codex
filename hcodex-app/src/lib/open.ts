import { inTauri } from "./transport";

/** Open a web address in the system browser. */
export function openExternal(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  if (inTauri) import("@tauri-apps/plugin-opener").then((m) => m.openUrl(url)).catch((e) => console.warn("open link:", e));
  else window.open(url, "_blank", "noopener,noreferrer");
}

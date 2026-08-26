import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { invoke } from "@tauri-apps/api/core";

// Forward errors + console.error/warn to the Rust side (visible in `pnpm tauri dev` output).
const fwd = (level: string, ...args: unknown[]) =>
  invoke("frontend_log", { level, message: args.map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" ") }).catch(() => {});
window.addEventListener("error", (e) => fwd("error", e.message, e.error));
window.addEventListener("unhandledrejection", (e) => fwd("unhandledrejection", e.reason));
for (const level of ["error", "warn"] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    orig(...args);
    fwd(level, ...args);
  };
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

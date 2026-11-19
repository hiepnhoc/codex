import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Browser-only UI development (`CODEX_IDE_WS=ws://127.0.0.1:4599 pnpm dev`): app-server refuses
// WebSocket handshakes that carry an Origin header, so a page cannot connect to it directly.
// This opt-in proxy forwards `/codex-ws` to it for this dev page only; any other origin is
// dropped, which keeps app-server's guard against arbitrary web pages intact.
// @ts-expect-error process is a nodejs global
const wsTarget: string | undefined = process.env.CODEX_IDE_WS;
const DEV_ORIGINS = ["http://localhost:1420", "http://127.0.0.1:1420"];

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    proxy: wsTarget
      ? {
          "/codex-ws": {
            target: wsTarget,
            ws: true,
            rewrite: () => "/",
            configure: (proxy) => {
              proxy.on("proxyReqWs", (proxyReq, req, socket) => {
                if (!DEV_ORIGINS.includes(req.headers.origin ?? "")) {
                  proxyReq.destroy();
                  socket.destroy();
                  return;
                }
                proxyReq.removeHeader("origin");
              });
            },
          },
        }
      : undefined,
  },
}));

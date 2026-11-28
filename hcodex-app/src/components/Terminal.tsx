import { terminalShell } from "../lib/platform";
import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { rpc } from "../lib/rpc";
import { b64ToBytes } from "../lib/fs";
import { SURFACE, type ColorScheme } from "../lib/theme";
import type { ProcessOutputDeltaNotification } from "../protocol/v2/ProcessOutputDeltaNotification";
import type { ProcessExitedNotification } from "../protocol/v2/ProcessExitedNotification";

type Props = {
  cwd: string;
  scheme: ColorScheme;
  /** Its tab is in front: when that happens, typing goes to the shell. */
  active: boolean;
  /** Take the keyboard as soon as the shell exists (a tab the user just opened, not one restored at launch). */
  focusOnStart: boolean;
};

const xtermTheme = (scheme: ColorScheme) => {
  const { background, foreground, selection } = SURFACE[scheme];
  return { background, foreground, cursor: foreground, selectionBackground: selection };
};

function bytesToB64(bytes: Uint8Array) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Interactive shell running on the app-server host via `process/spawn` (PTY). */
export function Terminal({ cwd, scheme, active, focusOnStart }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const schemeRef = useRef(scheme);
  schemeRef.current = scheme;
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (active) termRef.current?.focus();
  }, [active]);

  // Follow the system theme without restarting the shell.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme(scheme);
  }, [scheme]);

  useEffect(() => {
    if (!ref.current || !cwd) return;
    const term = new XTerm({
      fontSize: 12,
      fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
      theme: xtermTheme(schemeRef.current),
      cursorBlink: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    termRef.current = term;
    fit.fit();
    if (activeRef.current && focusOnStart) term.focus();

    const handle = `ide-term-${Math.random().toString(36).slice(2)}`;
    const enc = new TextEncoder();
    let alive = false;
    let disposed = false;

    const offOut = rpc.onNotification("process/outputDelta", (p) => {
      const n = p as ProcessOutputDeltaNotification;
      if (n.processHandle === handle) term.write(b64ToBytes(n.deltaBase64));
    });
    const offExit = rpc.onNotification("process/exited", (p) => {
      const n = p as ProcessExitedNotification;
      if (n.processHandle === handle) {
        alive = false;
        term.writeln(`\r\n[process exited with code ${n.exitCode}]`);
      }
    });

    rpc
      .request("process/spawn", {
        command: terminalShell,
        processHandle: handle,
        cwd,
        tty: true,
        streamStdin: true,
        streamStdoutStderr: true,
        outputBytesCap: null,
        timeoutMs: null,
        env: { TERM: "xterm-256color" },
        size: { rows: term.rows, cols: term.cols },
      })
      .then(() => {
        // Effect may already be torn down (React StrictMode double-mount): kill immediately.
        if (disposed) rpc.request("process/kill", { processHandle: handle }).catch(() => {});
        else alive = true;
      })
      .catch((e) => term.writeln(`\x1b[31mprocess/spawn failed: ${e}\x1b[0m`));

    const onData = term.onData((data) => {
      if (!alive) return;
      rpc.request("process/writeStdin", { processHandle: handle, deltaBase64: bytesToB64(enc.encode(data)), closeStdin: false }).catch(() => {});
    });

    const ro = new ResizeObserver(() => {
      fit.fit();
      if (alive) rpc.request("process/resizePty", { processHandle: handle, size: { rows: term.rows, cols: term.cols } }).catch(() => {});
    });
    ro.observe(ref.current);

    return () => {
      disposed = true;
      ro.disconnect();
      onData.dispose();
      offOut();
      offExit();
      if (alive) rpc.request("process/kill", { processHandle: handle }).catch(() => {});
      term.dispose();
    };
    // `focusOnStart` is read once, when the shell starts.
  }, [cwd]);

  // The fit add-on measures the mount's parent box, so the padding sits one level further out.
  return (
    <div className="term-view">
      <div className="term-mount" ref={ref} />
    </div>
  );
}

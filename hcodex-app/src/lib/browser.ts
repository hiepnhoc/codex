/** Helpers of the pane's Browser tab. */
import { rpc } from "./rpc";
import type { CommandExecResponse } from "../protocol/v2/CommandExecResponse";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.localhost)$/i;

/**
 * What was typed in the address bar as a full address: a bare port is a local dev server,
 * a local host gets `http://`, anything else that looks like a host gets `https://`.
 */
export function normalizeUrl(input: string): string | null {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;
  if (/^\d{2,5}$/.test(text)) return `http://localhost:${text}/`;
  let candidate = text;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    const host = text.split(/[/?#]/)[0].replace(/:\d+$/, "");
    if (LOCAL_HOST.test(host)) candidate = `http://${text}`;
    else if (host.includes(".")) candidate = `https://${text}`;
    else return null;
  }
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function isLocalUrl(url: string): boolean {
  try {
    return LOCAL_HOST.test(new URL(url).host.replace(/:\d+$/, ""));
  } catch {
    return false;
  }
}

/**
 * Whether the site tells browsers not to show it inside another page (`X-Frame-Options`, or a
 * `frame-ancestors` policy). Such a page stays blank in the pane, and the page itself cannot
 * tell: the response headers are read with `curl` on the app-server host. Unknown counts as no.
 */
export async function embeddingRefused(url: string): Promise<boolean> {
  try {
    const r = await rpc.request<CommandExecResponse>("command/exec", {
      command: ["curl", "-sIL", "-m", "6", "--proto", "=http,https", "--proto-redir", "=http,https", "-o", "/dev/null", "-D", "-", "--", url],
      timeoutMs: 9000,
      outputBytesCap: 200_000,
      // The default sandbox of `command/exec` has no network.
      sandboxPolicy: { type: "dangerFullAccess" },
    });
    // With redirects there is one header block per response; the last one is the page.
    const blocks = r.stdout.replace(/\r/g, "").trim().split(/\n\n+/);
    const headers = blocks[blocks.length - 1].toLowerCase().split("\n");
    return headers.some((line) => {
      if (line.startsWith("x-frame-options:")) return true;
      if (!line.startsWith("content-security-policy:")) return false;
      const ancestors = /frame-ancestors([^;]*)/.exec(line);
      return !!ancestors && !/(^|\s)\*(\s|$)/.test(ancestors[1]);
    });
  } catch {
    return false;
  }
}

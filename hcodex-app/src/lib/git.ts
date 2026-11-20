/** Working-tree diff of a workspace, read through app-server's one-off `command/exec`. */
import { rpc } from "./rpc";
import type { CommandExecResponse } from "../protocol/v2/CommandExecResponse";

export type WorkspaceDiff =
  | { kind: "diff"; text: string; files: number }
  /** Not a git repository (or git failed): the caller falls back to the turn's own patch. */
  | { kind: "unavailable"; reason: string };

// Tracked changes against HEAD, then every untracked file as an "added" diff.
// `git diff --no-index` exits 1 when files differ, so the script always ends with `true`.
const SCRIPT = [
  "git rev-parse --is-inside-work-tree >/dev/null || exit 3",
  "git diff HEAD --no-color 2>/dev/null || git diff --no-color",
  "git ls-files -z --others --exclude-standard | head -c 200000 | xargs -0 -n1 git diff --no-color --no-index /dev/null 2>/dev/null",
  "true",
].join("; ");

export async function workspaceDiff(cwd: string): Promise<WorkspaceDiff> {
  try {
    const r = await rpc.request<CommandExecResponse>("command/exec", {
      command: ["/bin/sh", "-c", SCRIPT],
      cwd,
      timeoutMs: 15000,
      outputBytesCap: 2_000_000,
      // Reading the diff must not take the index lock away from the agent's own git commands.
      env: { GIT_OPTIONAL_LOCKS: "0" },
    });
    if (r.exitCode !== 0) return { kind: "unavailable", reason: r.stderr.trim() || "not a git repository" };
    const files = (r.stdout.match(/^diff --git /gm) ?? []).length;
    return { kind: "diff", text: r.stdout, files };
  } catch (e) {
    return { kind: "unavailable", reason: String(e) };
  }
}

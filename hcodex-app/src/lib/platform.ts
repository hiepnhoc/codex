/** Where the app-server host runs: the app spawns `hcodex app-server` on this machine. */
export const isWindows: boolean =
  typeof navigator !== "undefined" && (/^Win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent));

/**
 * Git for Windows' bash: `sh`/`bash` on PATH may resolve to WSL's launcher instead.
 * Forward slashes on purpose: app-server's `command/exec` does not find a program given
 * with backslashes.
 */
const GIT_BASH = "C:/Program Files/Git/bin/bash.exe";

/** Command line that runs a POSIX shell script (plus positional args) on the host. */
export function shCommand(script: string, ...args: string[]): string[] {
  return isWindows ? [GIT_BASH, "-c", script, ...args] : ["/bin/sh", "-c", script, ...args];
}

/** Interactive shell for the Terminal pane. */
export const terminalShell: string[] = isWindows ? ["powershell.exe", "-NoLogo"] : ["/bin/zsh", "-l"];

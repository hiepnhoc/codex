// Generate src/protocol (TypeScript types of the app-server protocol) from the installed
// hcodex binary. The types are not committed: they always match the binary the app talks to.
// Skipped when the binary has not changed since the last run.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "src", "protocol");
const stampFile = path.join(out, ".hcodex-stamp");
const exe = process.platform === "win32" ? "hcodex.exe" : "hcodex";

function findBinary() {
  const candidates = [
    process.env.CODEX_BIN,
    path.join(os.homedir(), ".hcodex", "bin", exe),
    path.join(os.homedir(), ".cargo", "bin", exe),
    path.join(root, "..", "codex-rs", "target", "release", exe),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) ?? "hcodex";
}

const bin = findBinary();
let stamp = bin;
try {
  const real = fs.realpathSync(bin);
  const st = fs.statSync(real);
  stamp = `${real}|${st.size}|${st.mtimeMs}`;
} catch {
  // Not a path we can stat (resolved through PATH): regenerate every time.
  stamp = "";
}

const force = process.argv.includes("--force");
if (!force && stamp && fs.existsSync(stampFile) && fs.readFileSync(stampFile, "utf8") === stamp) {
  process.exit(0);
}

fs.rmSync(out, { recursive: true, force: true });
try {
  execFileSync(bin, ["app-server", "generate-ts", "--out", out], { stdio: ["ignore", "inherit", "inherit"] });
} catch (e) {
  console.error(`\ngen-protocol: could not run \`${bin} app-server generate-ts\`.`);
  console.error("Install hcodex (see HCODEX.md) or set CODEX_BIN to the binary.\n");
  process.exit(1);
}
if (stamp) fs.writeFileSync(stampFile, stamp);
console.log(`gen-protocol: ${fs.readdirSync(path.join(out, "v2")).length} v2 types from ${bin}`);

// Smoke test for the experimental fs/* and process/* APIs the IDE uses.
// Usage: node scripts/smoke-fs-process.mjs [dir]
import { spawn } from "node:child_process";
import readline from "node:readline";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const bin = process.env.CODEX_BIN ?? path.join(os.homedir(), ".cargo/bin/hcodex");
const home = process.env.CODEX_HOME ?? path.join(os.homedir(), ".hcodex");
const dir = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "hcodex-app-smoke-"));

const child = spawn(bin, ["app-server"], { env: { ...process.env, CODEX_HOME: home }, stdio: ["pipe", "pipe", "ignore"] });
const rl = readline.createInterface({ input: child.stdout });
let nextId = 1;
const pending = new Map();
const notif = [];
const waiters = [];
const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
const request = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, { res, rej, method });
    send({ id, method, params });
  });
const waitFor = (method, pred = () => true, ms = 10000) =>
  new Promise((res, rej) => {
    const hit = notif.find((n) => n.method === method && pred(n.params));
    if (hit) return res(hit.params);
    const t = setTimeout(() => rej(new Error(`timeout waiting ${method}`)), ms);
    waiters.push({ method, pred, res: (p) => (clearTimeout(t), res(p)) });
  });
rl.on("line", (line) => {
  const m = JSON.parse(line);
  if (m.id != null && !m.method) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.rej(new Error(`${p.method}: ${m.error.message}`)) : p.res(m.result);
    return;
  }
  if (m.method && m.id == null) {
    notif.push(m);
    for (const w of waiters.splice(0)) (w.method === m.method && w.pred(m.params) ? w.res(m.params) : waiters.push(w));
  }
});
const b64 = (s) => Buffer.from(s).toString("base64");
const unb64 = (s) => Buffer.from(s, "base64").toString();
const ok = (label, cond) => console.log(cond ? "  ✓" : "  ✗", label) || (cond ? 0 : process.exitCode = 1);

await request("initialize", { clientInfo: { name: "smoke", title: null, version: "0" }, capabilities: { experimentalApi: true, requestAttestation: false } });
send({ method: "initialized" });

console.log("fs/* in", dir);
await request("fs/watch", { watchId: "w1", path: dir });
await request("fs/writeFile", { path: path.join(dir, "hello.txt"), dataBase64: b64("hi from ide\n") });
const changed = await waitFor("fs/changed", (p) => p.watchId === "w1");
ok("fs/changed fired: " + changed.changedPaths.join(","), changed.changedPaths.some((p) => p.endsWith("hello.txt")));
const list = await request("fs/readDirectory", { path: dir });
ok("fs/readDirectory lists hello.txt", list.entries.some((e) => e.fileName === "hello.txt" && e.isFile));
const read = await request("fs/readFile", { path: path.join(dir, "hello.txt") });
ok("fs/readFile roundtrip", unb64(read.dataBase64) === "hi from ide\n");
await request("fs/unwatch", { watchId: "w1" });

console.log("process/spawn (pty zsh)");
const h = "smoke-term";
await request("process/spawn", {
  command: ["/bin/zsh", "-f"], processHandle: h, cwd: dir, tty: true, streamStdin: true, streamStdoutStderr: true,
  outputBytesCap: null, timeoutMs: null, env: { TERM: "xterm-256color" }, size: { rows: 24, cols: 80 },
});
await request("process/writeStdin", { processHandle: h, deltaBase64: b64("echo TERM_$((1+1))_OK\n"), closeStdin: false });
const out = await waitFor("process/outputDelta", (p) => p.processHandle === h && unb64(p.deltaBase64).includes("TERM_2_OK"), 8000).catch(() => null);
ok("pty echo roundtrip", !!out);
await request("process/resizePty", { processHandle: h, size: { rows: 30, cols: 100 } });
ok("process/resizePty", true);
await request("process/kill", { processHandle: h });
const exited = await waitFor("process/exited", (p) => p.processHandle === h, 5000).catch(() => null);
ok("process/exited after kill", !!exited);

child.kill();
process.exit(process.exitCode ?? 0);

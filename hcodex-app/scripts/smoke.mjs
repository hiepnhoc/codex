// Smoke test: drive `codex app-server` with the same call sequence App.tsx uses.
// Usage: LOCAL_PROXY_API_KEY=... node scripts/smoke.mjs [cwd] [prompt]
import { spawn } from "node:child_process";
import readline from "node:readline";
import os from "node:os";
import path from "node:path";

const bin = process.env.CODEX_BIN ?? path.join(os.homedir(), "github/codex/codex-rs/target/debug/codex");
const home = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex-dev");
const cwd = process.argv[2] ?? os.tmpdir();
const prompt = process.argv[3] ?? "Reply with exactly: pong";

const child = spawn(bin, ["app-server"], { env: { ...process.env, CODEX_HOME: home }, stdio: ["pipe", "pipe", "ignore"] });
const rl = readline.createInterface({ input: child.stdout });
let nextId = 1;
const pending = new Map();
const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
const request = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, method });
    send({ id, method, params });
  });

let streamed = "";
const done = new Promise((resolve) => {
  rl.on("line", (line) => {
    const msg = JSON.parse(line);
    if (msg.id != null && msg.method) {
      // server -> client request (approval etc.): auto-accept for smoke test
      console.log("  <- server request", msg.method);
      send({ id: msg.id, result: { decision: "accept" } });
      return;
    }
    if (msg.id != null) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(`${p.method}: ${msg.error.message}`)) : p.resolve(msg.result);
      return;
    }
    switch (msg.method) {
      case "item/agentMessage/delta": streamed += msg.params.delta; break;
      case "item/started": console.log("  <- item/started", msg.params.item.type); break;
      case "item/completed": console.log("  <- item/completed", msg.params.item.type); break;
      case "turn/completed": resolve(msg.params.turn); break;
    }
  });
});

const t0 = Date.now();
const init = await request("initialize", { clientInfo: { name: "codex-ide-smoke", title: null, version: "0.1.0" }, capabilities: null });
send({ method: "initialized" });
console.log("initialize ->", init.userAgent);

const models = await request("model/list", { includeHidden: true });
console.log("model/list ->", models.data.map((m) => m.model).join(", "));

const thread = await request("thread/start", { cwd, approvalPolicy: "on-request", sandbox: "workspace-write" });
console.log("thread/start ->", thread.thread.id, "provider:", thread.modelProvider, "model:", thread.model);

await request("turn/start", { threadId: thread.thread.id, input: [{ type: "text", text: prompt, text_elements: [] }] });
const turn = await done;
console.log("turn/completed ->", turn.status, `${Date.now() - t0}ms`);
console.log("agent said:", JSON.stringify(streamed));
child.kill();
process.exit(turn.status === "completed" && streamed.length > 0 ? 0 : 1);

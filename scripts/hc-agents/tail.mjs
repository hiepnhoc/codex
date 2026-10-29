#!/usr/bin/env node
// hcodex: build the agents-view state file from hcodex rollouts (read-only).
//
// Reads the main thread's rollout and every sub-agent rollout that points at it
// (`parent_thread_id`), turns them into the task list the vendored viewer
// (vendor/viewer.mjs, from omo-herdr-dag) renders, and rewrites `--state` whenever
// something changed. No hcodex process is touched: this only tails files that the
// core already writes.
//
//   node tail.mjs --state ~/.hcodex/agents-view/state.json [--session <id> | --cwd <dir> | --latest]
//                 [--sessions ~/.hcodex/sessions] [--interval 700] [--once]
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { writeJson } from './vendor/storage.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback; };
const has = name => args.includes(name);
const HOME = process.env.HCODEX_HOME ?? process.env.CODEX_HOME ?? join(homedir(), '.hcodex');
const SESSIONS = opt('--sessions', join(HOME, 'sessions'));
const STATE = opt('--state', join(HOME, 'agents-view', 'state.json'));
const INTERVAL = Number(opt('--interval', '700'));
const WANT_SESSION = opt('--session');
const WANT_CWD = opt('--cwd');
const RECENT_DAYS = Number(opt('--days', '3'));

const headers = new Map(); // path -> { header, mtimeMs }
const parsed = new Map();  // path -> { size, summary }

async function listRollouts() {
  const out = [];
  const since = Date.now() - RECENT_DAYS * 86400e3;
  async function walk(dir, depth) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (depth < 4) await walk(p, depth + 1); continue; }
      if (!e.name.startsWith('rollout-') || !e.name.endsWith('.jsonl')) continue;
      let s; try { s = await stat(p); } catch { continue; }
      if (s.mtimeMs < since) continue;
      out.push({ path: p, mtimeMs: s.mtimeMs, size: s.size });
    }
  }
  await walk(SESSIONS, 0);
  return out;
}

async function header(file) {
  const cached = headers.get(file.path);
  if (cached) return cached.header;
  let h = null;
  try {
    const fh = await readFile(file.path, { encoding: 'utf8', flag: 'r' });
    const nl = fh.indexOf('\n');
    const line = nl >= 0 ? fh.slice(0, nl) : fh;
    const d = JSON.parse(line);
    if (d.type === 'session_meta') h = d.payload ?? null;
  } catch { h = null; }
  headers.set(file.path, { header: h, mtimeMs: file.mtimeMs });
  return h;
}

const text = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : undefined);

// Summarise one rollout into the viewer's task fields.
async function summarize(file, h) {
  const prev = parsed.get(file.path);
  if (prev && prev.size === file.size) return prev.summary;
  const raw = await readFile(file.path, 'utf8');
  let turnsStarted = 0, turnsDone = 0, toolCalls = 0, openCalls = new Map(), lastTool, lastAssistant, lastUser, brief;
  let model, status = 'running', completedAt, aborted = false, errorText, lastTs, turnStartedAt;
  const spawnCalls = new Map(), spawns = new Map(), followups = new Map(); // parent-side view of its agents
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    const p = d.payload ?? {}; lastTs = d.timestamp ?? lastTs;
    if (d.type === 'turn_context') { if (p.model) model = p.model; continue; }
    if (d.type === 'event_msg') {
      if (p.type === 'task_started') { turnsStarted++; status = 'running'; aborted = false; errorText = undefined; turnStartedAt = d.timestamp; }
      else if (p.type === 'task_complete') { turnsDone++; status = 'completed'; completedAt = d.timestamp; openCalls.clear(); lastTool = undefined; }
      else if (p.type === 'turn_aborted') { aborted = true; status = 'interrupted'; completedAt = d.timestamp; openCalls.clear(); lastTool = undefined; }
      else if (p.type === 'error') { errorText = text(p.message, 200); status = 'error'; completedAt = d.timestamp; }
      continue;
    }
    if (d.type !== 'response_item') continue;
    if (p.type === 'function_call') {
      toolCalls++; const name = String(p.name ?? '').replace(/^collaboration__|^multi_agents__/, '');
      let detail = '';
      try { const a = JSON.parse(p.arguments ?? '{}'); detail = a.cmd ?? a.command ?? a.agent_type ?? a.target ?? ''; if (Array.isArray(detail)) detail = detail.join(' '); } catch {}
      lastTool = detail ? `${name} ${String(detail).slice(0, 60)}` : name;
      openCalls.set(p.call_id, lastTool);
      try {
        const a = JSON.parse(p.arguments ?? '{}');
        if (name === 'spawn_agent') spawnCalls.set(p.call_id, { brief: text(String(a.message ?? '').replace(/^(TASK|Task)\s*:\s*/i, ''), 220), agentType: a.agent_type, ts: d.timestamp });
        if (name === 'followup_task' && a.target) {
          const key = String(a.target).replace(/^\/root\//, '');
          const list = followups.get(key) ?? []; list.push({ message: text(a.message, 160), ts: d.timestamp }); followups.set(key, list);
        }
      } catch {}
    } else if (p.type === 'function_call_output') {
      openCalls.delete(p.call_id);
      const sc = spawnCalls.get(p.call_id);
      if (sc) { try { const o = JSON.parse(p.output ?? '{}'); if (o.task_name) spawns.set(String(o.task_name).replace(/^\/root\//, ''), sc); } catch {} spawnCalls.delete(p.call_id); }
    } else if (p.type === 'message') {
      const parts = Array.isArray(p.content) ? p.content : [];
      const t = parts.map(c => c?.text ?? '').join(' ');
      if (p.role === 'assistant') lastAssistant = text(t, 300);
      else if (p.role === 'user') {
        // The brief is the user chunk that is neither AGENTS.md instructions nor
        // <environment_context>; hcodex wraps those around the spawn message.
        const chunks = parts.filter(c => c?.type === 'input_text').map(c => c.text).filter(Boolean)
          .filter(c => !/^\s*(#\s*AGENTS\.md|<environment_context>|<INSTRUCTIONS>)/.test(c));
        const chunk = chunks.sort((a, b) => b.length - a.length)[0];
        if (!brief && chunk) brief = text(chunk.replace(/^(TASK|Task)\s*:\s*/i, ''), 220);
        if (chunk) lastUser = text(chunk, 160);
      }
    }
  }
  const running = status === 'running' && turnsStarted > turnsDone;
  if (!running && status === 'running') status = turnsStarted ? 'completed' : 'pending';
  const current = running ? [...openCalls.values()].pop() : undefined;
  const summary = { model, status, running, completedAt: running ? undefined : completedAt, turns: turnsStarted, toolCalls,
    lastTool: current, lastAssistant, lastUser, brief, errorText, lastTs, aborted, turnStartedAt, spawns, followups };
  parsed.set(file.path, { size: file.size, summary });
  return summary;
}

function pickMain(rollouts, hs) {
  const mains = rollouts.filter(f => { const h = hs.get(f.path); return h && h.thread_source !== 'subagent' && !h.parent_thread_id; });
  let cands = mains;
  if (WANT_SESSION) cands = mains.filter(f => hs.get(f.path).id === WANT_SESSION || f.path.includes(WANT_SESSION));
  else if (WANT_CWD) cands = mains.filter(f => String(hs.get(f.path).cwd ?? '').startsWith(WANT_CWD));
  cands.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return cands[0];
}

async function build() {
  const rollouts = await listRollouts();
  const hs = new Map();
  for (const f of rollouts) hs.set(f.path, await header(f));
  const main = pickMain(rollouts, hs);
  if (!main) return { sessionId: 'none', language: 'en', connected: false, runs: [], tasks: [] };
  const mainH = hs.get(main.path);
  const mainS = await summarize(main, mainH);
  const tasks = [];
  const mainId = `st_main-${mainH.id}`;
  tasks.push({ id: mainId, description: mainS.lastUser ?? 'main thread', agent: 'main',
    model: [mainS.model, mainH.model_provider].filter(Boolean).join(' @ '), status: mainS.status,
    startedAt: (mainS.running && mainS.turnStartedAt) || mainH.timestamp, ...(mainS.completedAt ? { completedAt: mainS.completedAt } : {}),
    ...(mainS.running ? { progress: [mainS.lastTool ? `[${mainS.lastTool}]` : '', mainS.lastAssistant ?? ''].filter(Boolean).join(' ') } : {}),
    turns: mainS.turns, toolCalls: mainS.toolCalls });
  // children (and grandchildren) by parent_thread_id
  const byParent = new Map();
  for (const f of rollouts) { const h = hs.get(f.path); if (h?.parent_thread_id) { if (!byParent.has(h.parent_thread_id)) byParent.set(h.parent_thread_id, []); byParent.get(h.parent_thread_id).push(f); } }
  async function addChildren(parentThreadId, parentTaskId, depth, parentS) {
    const kids = (byParent.get(parentThreadId) ?? []).sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const f of kids) {
      const h = hs.get(f.path); const s = await summarize(f, h);
      const id = `st_${h.id}`;
      const key = String(h.agent_path ?? '').replace(/^\/root\//, '');
      const spawn = parentS?.spawns?.get(key); const rounds = 1 + (parentS?.followups?.get(key)?.length ?? 0);
      const agent = [h.agent_role, h.agent_nickname ? `(${h.agent_nickname})` : '', key, rounds > 1 ? `· round ${rounds}` : ''].filter(Boolean).join(' ');
      const lastFollowup = parentS?.followups?.get(key)?.slice(-1)[0]?.message;
      const progress = s.running ? [s.lastTool ? `[${s.lastTool}]` : '', s.lastAssistant ?? ''].filter(Boolean).join(' ') : undefined;
      tasks.push({ id, parentTaskId, description: spawn?.brief ?? s.brief ?? lastFollowup ?? agent, agent,
        model: [s.model, h.model_provider].filter(Boolean).join(' @ '), status: s.status,
        startedAt: h.timestamp, ...(s.completedAt ? { completedAt: s.completedAt } : {}),
        ...(progress ? { progress } : {}), ...(s.errorText ? { progress: `error: ${s.errorText}` } : {}),
        turns: s.turns, toolCalls: s.toolCalls });
      if (depth < 4) await addChildren(h.id, id, depth + 1, s);
    }
  }
  await addChildren(mainH.id, mainId, 1, mainS);
  const recent = Date.now() - main.mtimeMs < 15 * 60e3;
  return { sessionId: mainH.id, sessionName: `${mainH.cwd ?? ''}`.split('/').slice(-2).join('/'), language: 'en',
    connected: mainS.running || recent, runs: [], tasks, updatedAt: new Date().toISOString() };
}

let last = '';
async function tick() {
  try {
    const state = await build();
    const sig = JSON.stringify({ ...state, updatedAt: undefined });
    if (sig !== last) { await writeJson(STATE, state); last = sig; }
    if (has('--once')) { process.stdout.write(`${JSON.stringify(state, null, 1)}\n`); return false; }
  } catch (e) { process.stderr.write(`hc-agents tail: ${e.message}\n`); }
  return true;
}
if (await tick()) setInterval(tick, INTERVAL);

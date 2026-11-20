/**
 * Thread store: one place that turns app-server notifications into per-thread state.
 *
 * A session is a tree: the main thread plus the sub-agents it spawned. app-server streams
 * item/turn/status events for every thread of the tree on the same connection, each tagged
 * with its `threadId`, so the store keeps items and status per thread and the UI picks
 * which thread to show.
 *
 * Sub-agents are not announced with `thread/started` (multi_agent_v2). They show up as
 * a `subAgentActivity` item in the parent, and as events carrying an unknown `threadId`;
 * both paths register the thread here and fetch its metadata with `thread/read`.
 */
import { useMemo, useSyncExternalStore } from "react";
import { rpc } from "./rpc";
import type { Thread } from "../protocol/v2/Thread";
import type { ThreadItem } from "../protocol/v2/ThreadItem";
import type { ThreadStatus } from "../protocol/v2/ThreadStatus";
import type { Turn } from "../protocol/v2/Turn";
import type { ThreadStartResponse } from "../protocol/v2/ThreadStartResponse";
import type { ThreadResumeResponse } from "../protocol/v2/ThreadResumeResponse";
import type { ThreadForkResponse } from "../protocol/v2/ThreadForkResponse";
import type { ThreadReadResponse } from "../protocol/v2/ThreadReadResponse";
import type { TurnStartParams } from "../protocol/v2/TurnStartParams";
import type { ItemStartedNotification } from "../protocol/v2/ItemStartedNotification";
import type { ItemCompletedNotification } from "../protocol/v2/ItemCompletedNotification";
import type { AgentMessageDeltaNotification } from "../protocol/v2/AgentMessageDeltaNotification";
import type { CommandExecutionOutputDeltaNotification } from "../protocol/v2/CommandExecutionOutputDeltaNotification";
import type { TurnStartedNotification } from "../protocol/v2/TurnStartedNotification";
import type { TurnCompletedNotification } from "../protocol/v2/TurnCompletedNotification";
import type { TurnDiffUpdatedNotification } from "../protocol/v2/TurnDiffUpdatedNotification";
import type { ThreadStartedNotification } from "../protocol/v2/ThreadStartedNotification";
import type { ThreadStatusChangedNotification } from "../protocol/v2/ThreadStatusChangedNotification";
import type { ThreadClosedNotification } from "../protocol/v2/ThreadClosedNotification";
import type { ThreadTokenUsageUpdatedNotification } from "../protocol/v2/ThreadTokenUsageUpdatedNotification";
import type { CommandExecutionRequestApprovalParams } from "../protocol/v2/CommandExecutionRequestApprovalParams";
import type { FileChangeRequestApprovalParams } from "../protocol/v2/FileChangeRequestApprovalParams";

export type UiItem = { item: ThreadItem; stream: string; done: boolean };

/** What the agent list shows for one thread. */
export type AgentState = "running" | "waiting" | "idle" | "done" | "error" | "closed" | "notLoaded";

export type ThreadMeta = {
  id: string;
  parentId: string | null;
  title: string;
  cwd: string;
  provider: string;
  model: string | null;
  role: string | null;
  nickname: string | null;
  /** Agent path of a sub-agent, e.g. `/root/reviewer`. */
  path: string | null;
  state: AgentState;
  /** Epoch ms when the running turn started; null when no turn is running. */
  turnStartedAt: number | null;
  /** Duration of the last finished turn. */
  lastTurnMs: number | null;
  /** Current command, or the last thing the agent said or did. */
  activity: string;
  /** False until `thread/read` (or start/resume) filled in the real metadata. */
  known: boolean;
  historyLoaded: boolean;
};

export type Approval = {
  key: string;
  threadId: string;
  resolve: (decision: string) => void;
} & (
  | { kind: "command"; params: CommandExecutionRequestApprovalParams }
  | { kind: "file"; params: FileChangeRequestApprovalParams }
);

/** Context in use after the last model request, and the model's window when known. */
export type Usage = { used: number; window: number | null };

type State = {
  threads: Record<string, ThreadMeta>;
  items: Record<string, UiItem[]>;
  diffs: Record<string, string | null>;
  errors: Record<string, string>;
  usage: Record<string, Usage>;
  approvals: Approval[];
};

const EMPTY_ITEMS: UiItem[] = [];

let state: State = { threads: {}, items: {}, diffs: {}, errors: {}, usage: {}, approvals: [] };
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

// ---------------------------------------------------------------- thread metadata

function stateFromStatus(status: ThreadStatus, prev: ThreadMeta | undefined, isSub: boolean): AgentState {
  switch (status.type) {
    case "active":
      return status.activeFlags.length > 0 ? "waiting" : "running";
    case "systemError":
      return "error";
    case "notLoaded":
      // A finished sub-agent is unloaded; keep what we already know about it.
      return prev && prev.state !== "running" && prev.state !== "waiting" ? prev.state : "notLoaded";
    case "idle":
      if (prev?.state === "error" || prev?.state === "closed") return prev.state;
      return isSub && (prev?.state === "running" || prev?.state === "waiting" || prev?.state === "done") ? "done" : "idle";
  }
}

function titleOf(t: Thread): string {
  const text = (t.name ?? t.preview ?? "").trim().split("\n")[0];
  return text || "(untitled)";
}

function placeholder(id: string, parentId: string | null): ThreadMeta {
  return {
    id,
    parentId,
    title: "",
    cwd: "",
    provider: "",
    model: null,
    role: null,
    nickname: null,
    path: null,
    state: "idle",
    turnStartedAt: null,
    lastTurnMs: null,
    activity: "",
    known: false,
    historyLoaded: false,
  };
}

function patchThread(id: string, patch: Partial<ThreadMeta>) {
  const prev = state.threads[id] ?? placeholder(id, null);
  set({ threads: { ...state.threads, [id]: { ...prev, ...patch } } });
}

/** Merge server metadata for a thread, keeping what only the client knows (path, activity). */
function upsertThread(t: Thread, extra?: Partial<ThreadMeta>) {
  const prev = state.threads[t.id];
  const isSub = t.parentThreadId != null || prev?.parentId != null;
  patchThread(t.id, {
    parentId: t.parentThreadId ?? prev?.parentId ?? null,
    title: titleOf(t),
    cwd: t.cwd,
    provider: t.modelProvider,
    model: t.model ?? prev?.model ?? null,
    role: t.agentRole,
    nickname: t.agentNickname,
    state: stateFromStatus(t.status, prev, isSub),
    known: true,
    ...extra,
  });
}

const metaRequests = new Set<string>();

/** Make sure a thread seen in an event is in the store, then fetch its metadata once. */
function ensureThread(id: string, parentId: string | null = null, patch?: Partial<ThreadMeta>) {
  const prev = state.threads[id];
  if (!prev) {
    patchThread(id, { ...placeholder(id, parentId), ...patch });
  } else if (patch || (parentId && !prev.parentId)) {
    patchThread(id, { ...patch, parentId: prev.parentId ?? parentId });
  }
  if (state.threads[id]?.known || metaRequests.has(id)) return;
  metaRequests.add(id);
  rpc
    .request<ThreadReadResponse>("thread/read", { threadId: id })
    .then((r) => upsertThread(r.thread))
    .catch(() => {})
    .finally(() => metaRequests.delete(id));
}

// ---------------------------------------------------------------- items

/** The agent runs commands through `zsh -lc '…'`; show what it actually ran. */
export function displayCommand(command: string): string {
  const m = command.match(/^(?:\S*\/)?(?:zsh|bash|sh)\s+-l?c\s+(['"])([\s\S]*)\1$/);
  return m ? m[2] : command;
}

function activityOf(item: ThreadItem): string | null {
  switch (item.type) {
    case "commandExecution":
      return `$ ${displayCommand(item.command)}`;
    case "agentMessage":
      return item.text ? item.text.trim().split("\n")[0] : null;
    case "fileChange":
      return item.changes.length ? `edit ${item.changes.map((c) => c.path.split("/").pop()).join(", ")}` : null;
    case "mcpToolCall":
      return `tool ${item.server}.${item.tool}`;
    default:
      return null;
  }
}

/** Sub-agents referenced by an item of `parentId`; registers them in the store. */
function registerChildren(parentId: string, item: ThreadItem) {
  if (item.type === "subAgentActivity") {
    const next: Partial<ThreadMeta> = { path: item.agentPath };
    if (item.model) next.model = item.model;
    const prev = state.threads[item.agentThreadId];
    if (item.kind === "started" && !prev?.turnStartedAt) next.state = "running";
    if (item.kind === "completed") next.state = "done";
    if (item.kind === "interrupted") next.state = "idle";
    ensureThread(item.agentThreadId, parentId, next);
  } else if (item.type === "collabAgentToolCall") {
    for (const id of item.receiverThreadIds) ensureThread(id, parentId, item.model ? { model: item.model } : undefined);
  }
}

function upsertItem(threadId: string, item: ThreadItem, done: boolean) {
  const list = state.items[threadId] ?? EMPTY_ITEMS;
  const i = list.findIndex((x) => x.item.id === item.id);
  const next = list.slice();
  if (i < 0) next.push({ item, stream: "", done });
  else next[i] = { ...next[i], item, done: done || next[i].done };
  set({ items: { ...state.items, [threadId]: next } });
  registerChildren(threadId, item);
  const activity = activityOf(item);
  if (activity) patchThread(threadId, { activity });
}

function appendStream(threadId: string, itemId: string, delta: string) {
  const list = state.items[threadId];
  if (!list) return;
  const i = list.findIndex((x) => x.item.id === itemId);
  if (i < 0) return;
  const next = list.slice();
  next[i] = { ...next[i], stream: next[i].stream + delta };
  set({ items: { ...state.items, [threadId]: next } });
}

function itemsFromTurns(turns: Turn[]): UiItem[] {
  return turns.flatMap((t) => t.items.map((item) => ({ item, stream: "", done: true })));
}

/** Replace a thread's items with its persisted history, keeping live items not yet persisted. */
function setHistory(threadId: string, turns: Turn[]) {
  const history = itemsFromTurns(turns);
  const seen = new Set(history.map((x) => x.item.id));
  const live = (state.items[threadId] ?? EMPTY_ITEMS).filter((x) => !seen.has(x.item.id));
  set({ items: { ...state.items, [threadId]: [...history, ...live] } });
  for (const x of history) registerChildren(threadId, x.item);
  patchThread(threadId, { historyLoaded: true });
}

// ---------------------------------------------------------------- notifications

let wired = false;

/** Subscribe the store to app-server events. Idempotent; call once after `initialize`. */
export function wireStore() {
  if (wired) return;
  wired = true;

  rpc.onNotification("thread/started", (p) => {
    upsertThread((p as ThreadStartedNotification).thread);
  });
  rpc.onNotification("thread/status/changed", (p) => {
    const { threadId, status } = p as ThreadStatusChangedNotification;
    ensureThread(threadId);
    const prev = state.threads[threadId];
    patchThread(threadId, { state: stateFromStatus(status, prev, prev?.parentId != null) });
  });
  rpc.onNotification("thread/closed", (p) => {
    const { threadId } = p as ThreadClosedNotification;
    if (state.threads[threadId]) patchThread(threadId, { state: "closed", turnStartedAt: null });
  });
  rpc.onNotification("turn/started", (p) => {
    const { threadId } = p as TurnStartedNotification;
    ensureThread(threadId);
    patchThread(threadId, { state: "running", turnStartedAt: Date.now() });
    const { [threadId]: _dropped, ...errors } = state.errors;
    set({ errors });
  });
  rpc.onNotification("turn/completed", (p) => {
    const { threadId, turn } = p as TurnCompletedNotification;
    const prev = state.threads[threadId];
    const isSub = prev?.parentId != null;
    const failed = turn.status === "failed";
    patchThread(threadId, {
      state: failed ? "error" : isSub ? "done" : "idle",
      lastTurnMs: turn.durationMs ?? (prev?.turnStartedAt ? Date.now() - prev.turnStartedAt : null),
      turnStartedAt: null,
    });
    if (failed) set({ errors: { ...state.errors, [threadId]: turn.error?.message ?? "turn failed" } });
  });
  rpc.onNotification("turn/diff/updated", (p) => {
    const { threadId, diff } = p as TurnDiffUpdatedNotification;
    set({ diffs: { ...state.diffs, [threadId]: diff || null } });
  });
  rpc.onNotification("thread/tokenUsage/updated", (p) => {
    const { threadId, tokenUsage } = p as ThreadTokenUsageUpdatedNotification;
    set({
      usage: {
        ...state.usage,
        [threadId]: { used: tokenUsage.last.totalTokens, window: tokenUsage.modelContextWindow },
      },
    });
  });
  rpc.onNotification("item/started", (p) => {
    const { threadId, item } = p as ItemStartedNotification;
    ensureThread(threadId);
    upsertItem(threadId, item, false);
  });
  rpc.onNotification("item/completed", (p) => {
    const { threadId, item } = p as ItemCompletedNotification;
    ensureThread(threadId);
    upsertItem(threadId, item, true);
  });
  rpc.onNotification("item/agentMessage/delta", (p) => {
    const { threadId, itemId, delta } = p as AgentMessageDeltaNotification;
    appendStream(threadId, itemId, delta);
  });
  rpc.onNotification("item/commandExecution/outputDelta", (p) => {
    const { threadId, itemId, delta } = p as CommandExecutionOutputDeltaNotification;
    appendStream(threadId, itemId, delta);
  });

  const ask = (kind: Approval["kind"]) => (params: unknown, id: number | string) =>
    new Promise((resolve) => {
      const key = String(id);
      const approval = {
        key,
        kind,
        params,
        threadId: (params as { threadId: string }).threadId,
        resolve: (decision: string) => {
          set({ approvals: state.approvals.filter((a) => a.key !== key) });
          resolve({ decision });
        },
      } as Approval;
      set({ approvals: [...state.approvals, approval] });
    });
  rpc.onServerRequest("item/commandExecution/requestApproval", ask("command"));
  rpc.onServerRequest("item/fileChange/requestApproval", ask("file"));
}

// ---------------------------------------------------------------- actions

export type ModelChoice = { provider: string; model: string };

function adopt(r: ThreadStartResponse | ThreadResumeResponse | ThreadForkResponse) {
  upsertThread(r.thread, { provider: r.modelProvider, model: r.model });
  return r.thread.id;
}

/**
 * How much a session may touch. Chat sessions are read-only and never ask for approval:
 * they answer questions without changing files or running anything that needs a grant.
 */
export type SessionKind = "chat" | "code";

const CHAT_INSTRUCTIONS =
  "This is a chat session with no project workspace. Answer directly. " +
  "Do not try to edit files or run project commands; the sandbox is read-only.";

const CHAT_PERMISSIONS = { approvalPolicy: "never", sandbox: "read-only", developerInstructions: CHAT_INSTRUCTIONS };
const CODE_PERMISSIONS = { approvalPolicy: "on-request", sandbox: "workspace-write" };

/**
 * Sent on every start, resume and fork. The app-server does not carry a session's sandbox
 * over: without these, a resumed or forked thread gets the config default for its folder,
 * which is read-only unless the folder is a trusted project.
 */
const permissionsFor = (kind: SessionKind | undefined) => (kind === "chat" ? CHAT_PERMISSIONS : CODE_PERMISSIONS);

/**
 * Per-thread config overrides. `[agents] default_subagent_model` names a model of the default
 * provider; on any other provider that name does not exist and every spawn fails, so sub-agents
 * of such a session default to the session's own model.
 */
function configOverrides(choice: ModelChoice | null, defaultProvider: string) {
  if (!choice?.model || !choice.provider || choice.provider === defaultProvider) return {};
  return { config: { "agents.default_subagent_model": choice.model } };
}

export type StartOptions = { kind?: SessionKind; defaultProvider?: string };

export async function startThread(cwd: string, choice: ModelChoice | null, opts: StartOptions = {}): Promise<string> {
  const r = await rpc.request<ThreadStartResponse>("thread/start", {
    cwd,
    model: choice?.model || null,
    modelProvider: choice?.provider || null,
    ...permissionsFor(opts.kind),
    ...configOverrides(choice, opts.defaultProvider ?? ""),
  });
  return adopt(r);
}

/**
 * Load a saved thread so it can continue; fills its history. A code session is reopened
 * writable inside its workspace, a chat session read-only, whatever they were recorded with.
 */
export async function resumeThread(threadId: string, kind: SessionKind = "code"): Promise<string> {
  const r = await rpc.request<ThreadResumeResponse>("thread/resume", { threadId, ...permissionsFor(kind) });
  const id = adopt(r);
  setHistory(id, r.thread.turns);
  return id;
}

/** Continue a conversation on another provider: fork it, or start fresh if it has no turns yet. */
export async function switchProvider(threadId: string, cwd: string, choice: ModelChoice, opts: StartOptions = {}): Promise<string> {
  try {
    const r = await rpc.request<ThreadForkResponse>("thread/fork", {
      threadId,
      modelProvider: choice.provider,
      model: choice.model,
      ...permissionsFor(opts.kind),
      ...configOverrides(choice, opts.defaultProvider ?? ""),
    });
    const id = adopt(r);
    setHistory(id, r.thread.turns);
    return id;
  } catch (e) {
    // A thread without a turn has no rollout to fork from.
    if (String(e).includes("no rollout found")) return startThread(cwd, choice, opts);
    throw e;
  }
}

/** Fetch a thread's persisted turns (used when opening a sub-agent). */
export async function loadHistory(threadId: string): Promise<void> {
  try {
    const r = await rpc.request<ThreadReadResponse>("thread/read", { threadId, includeTurns: true });
    upsertThread(r.thread);
    setHistory(threadId, r.thread.turns);
  } catch {
    // Ephemeral or not yet persisted: the live items are all there is.
    patchThread(threadId, { historyLoaded: true });
  }
}

export async function sendTurn(threadId: string, text: string, model: string | null): Promise<void> {
  const params: TurnStartParams = {
    threadId,
    input: [{ type: "text", text, text_elements: [] }],
    model: model || null,
  };
  patchThread(threadId, { state: "running", turnStartedAt: Date.now() });
  set({ diffs: { ...state.diffs, [threadId]: null } });
  try {
    await rpc.request("turn/start", params);
  } catch (e) {
    patchThread(threadId, { state: "error", turnStartedAt: null });
    set({ errors: { ...state.errors, [threadId]: String(e) } });
  }
}

export function interrupt(threadId: string) {
  rpc.request("turn/interrupt", { threadId }).catch(() => {});
}

// ---------------------------------------------------------------- selectors

/** Root of the tree a thread belongs to. */
export function rootOf(threads: Record<string, ThreadMeta>, id: string): string {
  let cur = id;
  for (let i = 0; i < 16; i++) {
    const parent = threads[cur]?.parentId;
    if (!parent || !threads[parent]) break;
    cur = parent;
  }
  return cur;
}

export type AgentRow = ThreadMeta & { depth: number };

const ORDER: Record<AgentState, number> = { waiting: 0, running: 1, error: 2, idle: 3, done: 3, notLoaded: 3, closed: 4 };

/** Main thread first, then its sub-agents: waiting, running, finished, closed. */
export function agentRows(threads: Record<string, ThreadMeta>, rootId: string | null): AgentRow[] {
  if (!rootId || !threads[rootId]) return [];
  const children = new Map<string, ThreadMeta[]>();
  for (const t of Object.values(threads)) {
    if (!t.parentId) continue;
    const list = children.get(t.parentId) ?? [];
    list.push(t);
    children.set(t.parentId, list);
  }
  const rows: AgentRow[] = [];
  const walk = (t: ThreadMeta, depth: number) => {
    rows.push({ ...t, depth });
    if (depth > 8) return;
    const kids = (children.get(t.id) ?? []).slice().sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.id.localeCompare(b.id));
    for (const k of kids) walk(k, depth + 1);
  };
  walk(threads[rootId], 0);
  return rows;
}

export function agentLabel(t: ThreadMeta): string {
  if (!t.parentId) return "Main";
  if (t.path) return t.path;
  if (t.nickname && t.role) return `${t.nickname} [${t.role}]`;
  return t.nickname ?? t.role ?? `agent ${t.id.slice(-6)}`;
}

export function useThreads() {
  return useSyncExternalStore(subscribe, () => state.threads);
}

export function useThread(id: string | null): ThreadMeta | null {
  return useSyncExternalStore(subscribe, () => (id ? (state.threads[id] ?? null) : null));
}

export function useItems(id: string | null): UiItem[] {
  return useSyncExternalStore(subscribe, () => (id ? (state.items[id] ?? EMPTY_ITEMS) : EMPTY_ITEMS));
}

export function useDiff(id: string | null): string | null {
  return useSyncExternalStore(subscribe, () => (id ? (state.diffs[id] ?? null) : null));
}

export function useUsage(id: string | null): Usage | null {
  return useSyncExternalStore(subscribe, () => (id ? (state.usage[id] ?? null) : null));
}

export function useError(id: string | null): string {
  return useSyncExternalStore(subscribe, () => (id ? (state.errors[id] ?? "") : ""));
}

export function useAgentRows(rootId: string | null): AgentRow[] {
  const threads = useThreads();
  return useMemo(() => agentRows(threads, rootId), [threads, rootId]);
}

/** Approvals raised by any thread of the tree rooted at `rootId`. */
export function useApprovals(rootId: string | null): Approval[] {
  const approvals = useSyncExternalStore(subscribe, () => state.approvals);
  const threads = useThreads();
  return useMemo(
    () => approvals.filter((a) => rootId != null && rootOf(threads, a.threadId) === rootId),
    [approvals, threads, rootId],
  );
}

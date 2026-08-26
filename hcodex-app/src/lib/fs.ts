/** Thin wrappers over app-server `fs/*` (experimental API). */
import { rpc } from "./rpc";
import type { FsReadDirectoryResponse } from "../protocol/v2/FsReadDirectoryResponse";
import type { FsReadFileResponse } from "../protocol/v2/FsReadFileResponse";
import type { FsReadDirectoryEntry } from "../protocol/v2/FsReadDirectoryEntry";

export type DirEntry = FsReadDirectoryEntry;

export function b64ToText(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function textToB64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function readDir(path: string): Promise<DirEntry[]> {
  const res = await rpc.request<FsReadDirectoryResponse>("fs/readDirectory", { path });
  return res.entries
    .filter((e) => e.fileName !== ".git" && e.fileName !== "node_modules" && e.fileName !== "target")
    .sort((a, b) => (a.isDirectory === b.isDirectory ? a.fileName.localeCompare(b.fileName) : a.isDirectory ? -1 : 1));
}

export async function readFile(path: string): Promise<string> {
  const res = await rpc.request<FsReadFileResponse>("fs/readFile", { path });
  return b64ToText(res.dataBase64);
}

export async function writeFile(path: string, text: string): Promise<void> {
  await rpc.request("fs/writeFile", { path, dataBase64: textToB64(text) });
}

export async function watch(watchId: string, path: string): Promise<void> {
  await rpc.request("fs/watch", { watchId, path });
}

export async function unwatch(watchId: string): Promise<void> {
  await rpc.request("fs/unwatch", { watchId }).catch(() => {});
}

export function join(dir: string, name: string) {
  return dir.endsWith("/") ? dir + name : `${dir}/${name}`;
}

export function basename(p: string) {
  return p.split("/").pop() ?? p;
}

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", md: "markdown", css: "css", scss: "scss", html: "html", rs: "rust", py: "python", go: "go",
  toml: "ini", yaml: "yaml", yml: "yaml", sh: "shell", zsh: "shell", bash: "shell", sql: "sql", java: "java",
  kt: "kotlin", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", rb: "ruby", php: "php", swift: "swift",
  xml: "xml", dockerfile: "dockerfile", lua: "lua", diff: "diff",
};

export function languageFor(path: string): string {
  const name = basename(path).toLowerCase();
  if (name === "dockerfile") return "dockerfile";
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  return EXT_LANG[ext] ?? "plaintext";
}

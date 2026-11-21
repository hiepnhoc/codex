/** Unified diff text as one entry per file. */

export type DiffLine = { kind: "add" | "del" | "ctx" | "hunk"; text: string; oldNo: number | null; newNo: number | null };
export type FileStatus = "added" | "deleted" | "modified";
export type FileDiff = { path: string; status: FileStatus; added: number; removed: number; lines: DiffLine[] };

function parse(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | null = null;
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const match = / b\/(.+)$/.exec(raw);
      file = { path: match ? match[1] : raw.slice(11), status: "modified", added: 0, removed: 0, lines: [] };
      files.push(file);
      inHunk = false;
      continue;
    }
    if (!file) continue;
    if (!inHunk) {
      if (raw.startsWith("new file mode")) file.status = "added";
      else if (raw.startsWith("deleted file mode")) file.status = "deleted";
      else if (raw.startsWith("+++ b/")) file.path = raw.slice(6);
    }
    if (raw.startsWith("@@")) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
      oldNo = match ? Number(match[1]) : 0;
      newNo = match ? Number(match[2]) : 0;
      inHunk = true;
      file.lines.push({ kind: "hunk", text: match?.[3].trim() ?? "", oldNo: null, newNo: null });
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith("+")) {
      file.added++;
      file.lines.push({ kind: "add", text: raw.slice(1), oldNo: null, newNo: newNo++ });
    } else if (raw.startsWith("-")) {
      file.removed++;
      file.lines.push({ kind: "del", text: raw.slice(1), oldNo: oldNo++, newNo: null });
    } else if (raw.startsWith(" ")) {
      file.lines.push({ kind: "ctx", text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return files;
}

// The pane's tab strip, the launcher and the Changes view all read the same diff: parse it once.
let last: { text: string; files: FileDiff[] } | null = null;

export function parseDiff(diff: string): FileDiff[] {
  if (last?.text !== diff) last = { text: diff, files: parse(diff) };
  return last.files;
}

export type DiffStats = { files: number; added: number; removed: number };

export function diffStats(files: FileDiff[]): DiffStats {
  return { files: files.length, added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0) };
}

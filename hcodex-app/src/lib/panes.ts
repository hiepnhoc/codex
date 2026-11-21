/** The tabs of the workspace pane: which ones are open, in what order, and which one is in front. */
import type { IconName } from "../components/Icon";

/** What the "+" menu can open. Changes and Files exist once; every pick of Terminal or Browser is a new tab. */
export type PaneKind = "changes" | "files" | "terminal" | "browser";

export type PaneTab =
  | { id: string; kind: "changes" }
  | { id: string; kind: "files" }
  | { id: string; kind: "terminal"; n: number }
  | { id: string; kind: "browser"; n: number; url: string }
  | { id: string; kind: "file"; path: string };

export type Panes = { tabs: PaneTab[]; active: string | null };

/** `key` is matched against `KeyboardEvent.key` (lower-cased) together with ⌘ (Ctrl elsewhere) and, if set, ⇧. */
export const PANE_KINDS: Array<{ kind: PaneKind; label: string; icon: IconName; key: string; shift: boolean; keys: string }> = [
  { kind: "changes", label: "Changes", icon: "diff", key: "d", shift: true, keys: "⇧⌘D" },
  { kind: "browser", label: "Browser", icon: "globe", key: "b", shift: true, keys: "⇧⌘B" },
  { kind: "files", label: "Files", icon: "folder", key: "f", shift: true, keys: "⇧⌘F" },
  { kind: "terminal", label: "Terminal", icon: "terminal", key: "j", shift: false, keys: "⌘J" },
];

const DEFAULT: Panes = {
  tabs: [
    { id: "changes", kind: "changes" },
    { id: "files", kind: "files" },
    { id: "terminal-1", kind: "terminal", n: 1 },
  ],
  active: "files",
};

const fileId = (path: string) => `file:${path}`;

/**
 * Bring a pane forward, opening it if needed. `fresh` (the "+" menu) always adds another
 * terminal or browser; without it (a shortcut) the last one of that kind is reused.
 */
export function openPane(panes: Panes, kind: PaneKind, fresh = false): Panes {
  if (kind === "changes" || kind === "files") {
    if (panes.tabs.some((t) => t.id === kind)) return { ...panes, active: kind };
    return { tabs: [...panes.tabs, { id: kind, kind }], active: kind };
  }
  const same = panes.tabs.filter((t) => t.kind === kind) as Array<Extract<PaneTab, { n: number }>>;
  if (!fresh && same.length) {
    const current = same.find((t) => t.id === panes.active);
    return { ...panes, active: (current ?? same[same.length - 1]).id };
  }
  const n = Math.max(0, ...same.map((t) => t.n)) + 1;
  const id = `${kind}-${n}`;
  const tab: PaneTab = kind === "terminal" ? { id, kind, n } : { id, kind, n, url: "" };
  return { tabs: [...panes.tabs, tab], active: id };
}

export function openFilePane(panes: Panes, path: string): Panes {
  const id = fileId(path);
  if (panes.tabs.some((t) => t.id === id)) return { ...panes, active: id };
  return { tabs: [...panes.tabs, { id, kind: "file", path }], active: id };
}

/** Closing the tab in front moves to its right neighbour, else the left one. */
export function closePane(panes: Panes, id: string): Panes {
  const index = panes.tabs.findIndex((t) => t.id === id);
  if (index < 0) return panes;
  const tabs = panes.tabs.filter((t) => t.id !== id);
  const active = panes.active === id ? (tabs[index] ?? tabs[index - 1])?.id ?? null : panes.active;
  return { tabs, active };
}

/** A different workspace: its files are gone, everything else stays. */
export function closeFilePanes(panes: Panes): Panes {
  const tabs = panes.tabs.filter((t) => t.kind !== "file");
  const active = tabs.some((t) => t.id === panes.active) ? panes.active : tabs.find((t) => t.kind === "files")?.id ?? tabs[0]?.id ?? null;
  return { tabs, active };
}

export function setBrowserUrl(panes: Panes, id: string, url: string): Panes {
  return { ...panes, tabs: panes.tabs.map((t) => (t.id === id && t.kind === "browser" ? { ...t, url } : t)) };
}

export function paneLabel(tab: PaneTab): string {
  switch (tab.kind) {
    case "changes":
      return "Changes";
    case "files":
      return "Files";
    case "terminal":
      return tab.n === 1 ? "Terminal" : `Terminal ${tab.n}`;
    case "browser":
      try {
        return new URL(tab.url).host || "Browser";
      } catch {
        return "Browser";
      }
    case "file":
      return tab.path.split("/").pop() ?? tab.path;
  }
}

const KEY = "hcodex.panes";

/** The layout is kept between launches; open files are not (they belong to a workspace). */
export function loadPanes(): Panes {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Panes | null;
    if (!saved || !Array.isArray(saved.tabs)) return DEFAULT;
    const tabs: PaneTab[] = [];
    for (const t of saved.tabs) {
      if (t?.kind === "changes" || t?.kind === "files") {
        if (!tabs.some((x) => x.id === t.kind)) tabs.push({ id: t.kind, kind: t.kind });
      } else if (t?.kind === "terminal" && Number.isInteger(t.n)) {
        tabs.push({ id: `terminal-${t.n}`, kind: "terminal", n: t.n });
      } else if (t?.kind === "browser" && Number.isInteger(t.n)) {
        tabs.push({ id: `browser-${t.n}`, kind: "browser", n: t.n, url: typeof t.url === "string" ? t.url : "" });
      }
    }
    if (new Set(tabs.map((t) => t.id)).size !== tabs.length) return DEFAULT;
    return { tabs, active: tabs.some((t) => t.id === saved.active) ? saved.active : tabs[0]?.id ?? null };
  } catch {
    return DEFAULT;
  }
}

export function savePanes(panes: Panes) {
  try {
    localStorage.setItem(KEY, JSON.stringify(closeFilePanes(panes)));
  } catch {
    // Private mode or a full store: the layout just is not remembered.
  }
}

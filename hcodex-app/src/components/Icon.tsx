/** A handful of 16px stroke icons, so the app needs no icon package. */
const PATHS = {
  plus: "M8 3v10M3 8h10",
  chat: "M2.5 4.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7l-3 2.5V11.5a2 2 0 0 1-1.5-2z",
  code: "M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5",
  plug: "M6 2v3M10 2v3M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11v3",
  book: "M3 3.5h4a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 0 7 11.5H3zM13 3.5H9.5A1.5 1.5 0 0 0 8 5v8a1.5 1.5 0 0 1 1.5-1.5H13z",
  tool: "M10.5 2.5a3 3 0 0 0-2.8 4L2.5 11.7l1.8 1.8 5.2-5.2a3 3 0 0 0 4-2.8l-1.8 1.8-1.7-.5-.5-1.7z",
  server: "M3 3h10v4H3zM3 9h10v4H3zM5.5 5h.01M5.5 11h.01",
  folder: "M2 4.5A1.5 1.5 0 0 1 3.5 3h2.8l1.4 1.5h4.8A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z",
  folderOpen: "M2 11.5v-7A1.5 1.5 0 0 1 3.5 3h2.8l1.4 1.5h4.8A1.5 1.5 0 0 1 14 6v.5M2.4 12.2l1.5-4.4a1 1 0 0 1 1-.8h9.4a.7.7 0 0 1 .7 1l-1.4 4.2a1 1 0 0 1-1 .8H3.3a.9.9 0 0 1-.9-.8z",
  file: "M4 2.5h5l3 3v8H4zM9 2.5v3h3",
  panel: "M2.5 3h11v10h-11zM10 3v10",
  search: "M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM11 11l3 3",
  edit: "M3 13h2.5l7-7-2.5-2.5-7 7zM9.5 4l2.5 2.5",
  terminal: "M2.5 3h11v10h-11zM5 6l2 2-2 2M8.5 10h3",
  agent: "M5 6.5h6v5H5zM8 4v2.5M6.8 8.8h.01M9.2 8.8h.01M3 9v1.5M13 9v1.5",
  up: "M8 13V3M4 7l4-4 4 4",
  stop: "M4.5 4.5h7v7h-7z",
  back: "M9.5 3.5 5 8l4.5 4.5",
  refresh: "M13 8a5 5 0 1 1-1.5-3.5M13 3v2.5h-2.5",
  chevronRight: "M6 3.5 10.5 8 6 12.5",
  chevronDown: "M3.5 6 8 10.5 12.5 6",
  check: "M3.5 8.5l3 3 6-7",
  x: "M4 4l8 8M12 4l-8 8",
  copy: "M5.5 5.5h7v8h-7zM3.5 10.5v-8h7",
  spark: "M8 2.5l1.3 3.2 3.2 1.3-3.2 1.3L8 11.5 6.7 8.3 3.5 7l3.2-1.3zM12.5 11v2.5M11.25 12.25h2.5",
  diff: "M5 2.5v6M2 5.5h6M9.5 12h4.5M3 13.5 13 2.5",
  list: "M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The app's mark: a prompt chevron in a rounded tile. */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <rect width="20" height="20" rx="6" fill="var(--accent)" />
      <path d="M6 6.5 9.5 10 6 13.5M10.5 13.5H14" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const EXT_TONE: Record<string, string> = {
  ts: "blue", tsx: "blue", js: "yellow", jsx: "yellow", mjs: "yellow", json: "yellow", py: "blue", rs: "orange",
  go: "blue", java: "orange", kt: "purple", swift: "orange", c: "blue", h: "blue", cpp: "blue", css: "purple",
  scss: "purple", html: "orange", md: "muted", txt: "muted", toml: "muted", yaml: "muted", yml: "muted", lock: "muted",
  sh: "green", zsh: "green", bash: "green", sql: "purple", png: "green", jpg: "green", svg: "green",
};

/** File icon tinted by extension, so a list of files is easier to scan. */
export function FileIcon({ name, size = 15 }: { name: string; size?: number }) {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return (
    <span className={`file-icon tone-${EXT_TONE[ext] ?? "muted"}`}>
      <Icon name="file" size={size} />
    </span>
  );
}

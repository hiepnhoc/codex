import { memo, useMemo, useState, type ReactNode } from "react";
import { inTauri } from "../lib/transport";
import { Icon } from "./Icon";

/**
 * A small Markdown renderer for model answers: headings, lists, tables, quotes, fenced code,
 * and inline code / bold / italic / links. It builds React nodes directly (no HTML strings),
 * so nothing the model writes can inject markup. Not a full CommonMark implementation.
 */

type ListItem = { indent: number; ordered: boolean; text: string };

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "rule" }
  | { kind: "quote"; text: string }
  | { kind: "list"; items: ListItem[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "paragraph"; text: string };

const FENCE = /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

function parse(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      // An unclosed fence (the answer is still streaming) runs to the end.
      while (i < lines.length && !(lines[i].trim().startsWith(fence[1]) && FENCE.test(lines[i]))) body.push(lines[i++]);
      i++;
      blocks.push({ kind: "code", lang: fence[2], text: body.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) body.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
      blocks.push({ kind: "quote", text: body.join("\n") });
      continue;
    }
    if (LIST.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length) {
        const item = LIST.exec(lines[i]);
        if (item) {
          items.push({ indent: item[1].replace(/\t/g, "    ").length, ordered: /\d/.test(item[2]), text: item[3] });
        } else if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length) {
          items[items.length - 1].text += "\n" + lines[i].trim();
        } else {
          break;
        }
        i++;
      }
      blocks.push({ kind: "list", items });
      continue;
    }
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !FENCE.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !RULE.test(lines[i]) &&
      !LIST.test(lines[i]) &&
      !/^\s{0,3}>/.test(lines[i]) &&
      !(lines[i].includes("|") && TABLE_SEPARATOR.test(lines[i + 1] ?? ""))
    ) {
      body.push(lines[i++]);
    }
    blocks.push({ kind: "paragraph", text: body.join("\n") });
  }
  return blocks;
}

// code span | [text](url) | **bold** | __bold__ | ~~strike~~ | *italic* | _italic_ | bare URL
const INLINE =
  /(`+)(?!`)([\s\S]*?[^`])\1(?!`)|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\*([^*\s](?:[^*]*?[^*\s])?)\*|(?<![\w])_([^_\s](?:[^_]*?[^_\s])?)_(?![\w])|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/g;

function openLink(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  if (inTauri) import("@tauri-apps/plugin-opener").then((m) => m.openUrl(url)).catch((e) => console.warn("open link:", e));
  else window.open(url, "_blank", "noopener,noreferrer");
}

function Link({ url, children }: { url: string; children: ReactNode }) {
  return (
    <a
      href={url}
      title={url}
      onClick={(e) => {
        e.preventDefault();
        openLink(url);
      }}
    >
      {children}
    </a>
  );
}

function inline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  const plain = (chunk: string) => {
    const parts = chunk.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) out.push(<br key={`${keyPrefix}-br${n++}`} />);
      if (part) out.push(part);
    });
  };
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) plain(text.slice(last, at));
    const key = `${keyPrefix}-${n++}`;
    if (m[2] !== undefined) out.push(<code key={key}>{m[2].trim() || m[2]}</code>);
    else if (m[3] !== undefined) out.push(<Link key={key} url={m[4]}>{inline(m[3], key)}</Link>);
    else if (m[5] !== undefined || m[6] !== undefined) out.push(<strong key={key}>{inline(m[5] ?? m[6], key)}</strong>);
    else if (m[7] !== undefined) out.push(<del key={key}>{inline(m[7], key)}</del>);
    else if (m[8] !== undefined || m[9] !== undefined) out.push(<em key={key}>{inline(m[8] ?? m[9], key)}</em>);
    else if (m[10] !== undefined) out.push(<Link key={key} url={m[10]}>{m[10]}</Link>);
    last = at + m[0].length;
  }
  if (last < text.length) plain(text.slice(last));
  return out;
}

/** Nested list from flat items: an item more indented than its predecessor starts a sub-list. */
function renderList(items: ListItem[], key: string): ReactNode {
  if (!items.length) return null;
  const base = items[0].indent;
  const Tag = items[0].ordered ? "ol" : "ul";
  const children: ReactNode[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    let j = i + 1;
    while (j < items.length && items[j].indent > base) j++;
    children.push(
      <li key={`${key}-${i}`}>
        {inline(item.text, `${key}-${i}`)}
        {j > i + 1 && renderList(items.slice(i + 1, j), `${key}-${i}n`)}
      </li>,
    );
    i = j;
  }
  return <Tag key={key}>{children}</Tag>;
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {},
    );
  };
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{lang || "text"}</span>
        <button className="icon-btn" onClick={copy} title="Copy" aria-label="Copy code">
          <Icon name={copied ? "check" : "copy"} size={13} />
        </button>
      </div>
      <pre>
        <code>{text}</code>
      </pre>
    </div>
  );
}

function renderBlock(block: Block, key: string): ReactNode {
  switch (block.kind) {
    case "heading": {
      const Tag = `h${Math.min(block.level + 1, 6)}` as "h2";
      return <Tag key={key}>{inline(block.text, key)}</Tag>;
    }
    case "code":
      return <CodeBlock key={key} lang={block.lang} text={block.text} />;
    case "rule":
      return <hr key={key} />;
    case "quote":
      return <blockquote key={key}>{parse(block.text).map((b, i) => renderBlock(b, `${key}-${i}`))}</blockquote>;
    case "list":
      return renderList(block.items, key);
    case "table":
      return (
        <div key={key} className="md-table">
          <table>
            <thead>
              <tr>
                {block.head.map((c, i) => (
                  <th key={i}>{inline(c, `${key}-h${i}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((c, i) => (
                    <td key={i}>{inline(c, `${key}-${r}-${i}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "paragraph":
      return <p key={key}>{inline(block.text, key)}</p>;
  }
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parse(text), [text]);
  return <div className="md">{blocks.map((b, i) => renderBlock(b, `b${i}`))}</div>;
});

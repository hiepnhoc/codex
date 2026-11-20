import { useCallback, useEffect, useState } from "react";
import { rpc } from "../lib/rpc";
import { readDir, watch, unwatch, join, type DirEntry } from "../lib/fs";
import type { FsChangedNotification } from "../protocol/v2/FsChangedNotification";
import { FileIcon, Icon } from "./Icon";

type Props = { root: string; selected: string | null; onOpen: (path: string) => void };

const WATCH_ID = "ide-root";

export function FileTree({ root, selected, onOpen }: Props) {
  const [version, setVersion] = useState(0);

  // Watch the root; bump `version` so open directories re-read themselves.
  useEffect(() => {
    if (!root) return;
    watch(WATCH_ID, root).catch((e) => console.warn("fs/watch failed", e));
    const off = rpc.onNotification("fs/changed", (p) => {
      const { watchId } = p as FsChangedNotification;
      if (watchId === WATCH_ID) setVersion((v) => v + 1);
    });
    return () => {
      off();
      unwatch(WATCH_ID);
    };
  }, [root]);

  if (!root) return <div className="muted small">no workspace</div>;
  return (
    <div className="tree">
      <Dir path={root} name={root.split("/").pop() || root} depth={0} open selected={selected} onOpen={onOpen} version={version} />
    </div>
  );
}

type DirProps = {
  path: string;
  name: string;
  depth: number;
  open?: boolean;
  selected: string | null;
  onOpen: (p: string) => void;
  version: number;
};

function Dir({ path, name, depth, open: initialOpen, selected, onOpen, version }: DirProps) {
  const [open, setOpen] = useState(!!initialOpen);
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    readDir(path)
      .then((e) => {
        setEntries(e);
        setErr(null);
      })
      .catch((e) => setErr(String(e)));
  }, [path]);

  useEffect(() => {
    if (open) load();
  }, [open, load, version]);

  return (
    <div>
      <div className="tree-row" style={{ paddingLeft: 4 + depth * 14 }} onClick={() => setOpen((o) => !o)}>
        <span className={`caret ${open ? "open" : ""}`}>
          <Icon name="chevronRight" size={11} />
        </span>
        <span className="folder">
          <Icon name={open ? "folderOpen" : "folder"} size={15} />
        </span>
        <span className="ellipsis">{name}</span>
      </div>
      {open &&
        (err ? (
          <div className="muted tiny" style={{ paddingLeft: 26 + depth * 14 }}>
            {err}
          </div>
        ) : (
          entries?.map((e) =>
            e.isDirectory ? (
              <Dir
                key={e.fileName}
                path={join(path, e.fileName)}
                name={e.fileName}
                depth={depth + 1}
                selected={selected}
                onOpen={onOpen}
                version={version}
              />
            ) : (
              <div
                key={e.fileName}
                className={`tree-row file ${selected === join(path, e.fileName) ? "selected" : ""}`}
                style={{ paddingLeft: 4 + (depth + 1) * 14 }}
                onClick={() => onOpen(join(path, e.fileName))}
              >
                <span className="caret-gap" />
                <FileIcon name={e.fileName} />
                <span className="ellipsis">{e.fileName}</span>
              </div>
            ),
          )
        ))}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { embeddingRefused, isLocalUrl, normalizeUrl } from "../lib/browser";
import { openExternal } from "../lib/open";
import { Icon } from "./Icon";

type Props = { url: string; onUrl: (url: string) => void };

/**
 * A web page inside the pane, meant for the dev server of the workspace and for documentation.
 * The page runs in a sandboxed frame: it cannot navigate the app away or reach its windows.
 * Sites that forbid being framed cannot be shown; those get a button for the system browser.
 */
export function Browser({ url, onUrl }: Props) {
  const [input, setInput] = useState(url);
  const [invalid, setInvalid] = useState(false);
  /** Bumped by Reload: a new key makes the frame load again. */
  const [round, setRound] = useState(0);
  const [loading, setLoading] = useState(!!url);
  const [refused, setRefused] = useState(false);
  const clickFocuses = useRef(false);

  useEffect(() => setInput(url), [url]);

  useEffect(() => {
    setRefused(false);
    if (!url || isLocalUrl(url)) return;
    let live = true;
    embeddingRefused(url).then((no) => live && setRefused(no));
    return () => {
      live = false;
    };
  }, [url, round]);

  const go = () => {
    const next = normalizeUrl(input);
    setInvalid(!next);
    if (!next) return;
    setLoading(true);
    if (next === url) setRound((n) => n + 1);
    else onUrl(next);
  };

  let host = "";
  try {
    host = url ? new URL(url).host : "";
  } catch {
    // An address kept from an older version: shown as typed.
  }

  return (
    <div className="browser">
      <form
        className="browser-bar"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <button type="button" className="icon-btn" disabled={!url} onClick={() => (setLoading(true), setRound((n) => n + 1))} title="Reload" aria-label="Reload the page">
          <Icon name="refresh" size={14} />
        </button>
        <input
          className={`browser-url ${invalid ? "invalid" : ""}`}
          value={input}
          placeholder="Address, or a port like 3000"
          aria-label="Address"
          aria-invalid={invalid}
          spellCheck={false}
          autoCapitalize="off"
          autoFocus={!url}
          onChange={(e) => {
            setInput(e.target.value);
            setInvalid(false);
          }}
          // A click into the bar selects the whole address, so typing replaces it.
          onMouseDown={(e) => (clickFocuses.current = document.activeElement !== e.currentTarget)}
          onMouseUp={(e) => {
            const field = e.currentTarget;
            if (clickFocuses.current && field.selectionStart === field.selectionEnd) field.select();
            clickFocuses.current = false;
          }}
          onFocus={(e) => !clickFocuses.current && e.currentTarget.select()}
        />
        <button type="button" className="icon-btn" disabled={!url} onClick={() => openExternal(url)} title="Open in the system browser" aria-label="Open in the system browser">
          <Icon name="external" size={14} />
        </button>
      </form>
      {loading && !refused && url && <div className="browser-progress" />}
      {invalid && <div className="browser-note">That is not an address. Try a port (3000), localhost:5173, or example.com.</div>}
      {!url ? (
        <div className="empty small">
          <Icon name="globe" size={22} />
          <span>Type an address above. A port number opens that port on this machine.</span>
        </div>
      ) : refused ? (
        <div className="empty small">
          <Icon name="globe" size={22} />
          <span>{host} does not allow being shown inside another app.</span>
          <button onClick={() => openExternal(url)}>Open in the system browser</button>
        </div>
      ) : (
        <iframe
          key={`${url}#${round}`}
          className="browser-frame"
          src={url}
          title={host || "Web page"}
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads"
          referrerPolicy="no-referrer"
          onLoad={() => setLoading(false)}
        />
      )}
    </div>
  );
}

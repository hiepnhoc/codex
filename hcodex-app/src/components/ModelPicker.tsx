import { useEffect, useMemo, useRef, useState } from "react";
import type { Catalog } from "../lib/models";
import type { ModelChoice } from "../lib/store";
import { Icon } from "./Icon";

type Props = {
  catalog: Catalog;
  value: ModelChoice;
  onChange: (c: ModelChoice) => void;
};

type Option = { provider: string; model: string };

const same = (a: Option, b: Option) => a.provider === b.provider && a.model === b.model;

/**
 * Model button with a searchable menu of every provider's models; picking a model also picks
 * its provider. "Custom model" takes an id the provider did not list.
 */
export function ModelPicker({ catalog, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [custom, setCustom] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const all: Option[] = catalog.providers.flatMap((p) => p.models.map((model) => ({ provider: p.id, model })));
    return all.filter((o) => words.every((w) => o.model.toLowerCase().includes(w) || o.provider.toLowerCase().includes(w)));
  }, [catalog, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Start on the current model each time the menu opens or the filter changes.
  useEffect(() => {
    if (!open) return;
    const current = options.findIndex((o) => same(o, value));
    setActive(current >= 0 && !query ? current : 0);
  }, [open, query, options, value]);

  useEffect(() => {
    listRef.current?.querySelector(".model-option.active")?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (o: Option) => {
    onChange(o);
    setOpen(false);
    setQuery("");
  };

  const toggle = () => {
    setOpen((o) => !o);
    setQuery("");
    setCustom(false);
  };

  const unavailable = catalog.providers.filter((p) => !p.models.length);

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        className={`model-button ${open ? "open" : ""}`}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${value.provider} · ${value.model}`}
      >
        <span className="ellipsis">{value.model || "Choose a model"}</span>
        {value.provider && <span className="provider">{value.provider}</span>}
        <Icon name="chevronDown" size={12} />
      </button>
      {open && (
        <div className="model-menu">
          <div className="model-search">
            <Icon name="search" size={14} />
            <input
              autoFocus
              value={query}
              placeholder="Search models or providers"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((i) => Math.min(i + 1, options.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (options[active]) pick(options[active]);
                } else if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
            />
          </div>
          <div className="model-list" role="listbox" ref={listRef}>
            {options.map((o, i) => (
              <div key={`${o.provider}\u0000${o.model}`}>
                {(i === 0 || options[i - 1].provider !== o.provider) && <div className="model-group">{o.provider}</div>}
                <div
                  role="option"
                  aria-selected={same(o, value)}
                  className={`model-option ${i === active ? "active" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(o)}
                >
                  <span className="ellipsis">{o.model}</span>
                  {same(o, value) && <Icon name="check" size={14} />}
                </div>
              </div>
            ))}
            {!options.length && <div className="muted small pad">No model matches "{query}".</div>}
            {!query &&
              unavailable.map((p) => (
                <div key={p.id} className="model-group" title={p.error ?? ""}>
                  {p.id} <span className="warn">{p.error ? "unreachable" : "no models"}</span>
                </div>
              ))}
          </div>
          {custom ? (
            <div className="model-custom">
              <select className="small" value={value.provider} onChange={(e) => onChange({ ...value, provider: e.target.value })} title="provider">
                {catalog.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id}
                  </option>
                ))}
              </select>
              <input
                autoFocus
                className="mono small"
                value={value.model}
                placeholder="model id"
                onChange={(e) => onChange({ ...value, model: e.target.value })}
                onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && setOpen(false)}
              />
            </div>
          ) : (
            <div className="model-custom">
              <button className="ghost small" onClick={() => setCustom(true)}>
                <Icon name="edit" size={13} /> Custom model…
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

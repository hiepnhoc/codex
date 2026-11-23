import { useCallback, useEffect, useState } from "react";
import { FuseboxError, SETTING_GROUPS, loadSettings, saveSettings, type SettingDef, type SettingValue, type Settings } from "../lib/fusebox";
import { openExternal } from "../lib/open";
import type { ProxyDef } from "../lib/proxies";
import { Icon } from "./Icon";

/** A number field keeps what is typed until it is a number in range. */
const parse = (def: SettingDef, text: string): number | null => {
  if (def.kind !== "number" || !/^\d+$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= def.min && n <= def.max ? n : null;
};

/** The proxy's routing, request and logging settings, saved to its own config file. */
export function FuseboxSettings({ def }: { def: ProxyDef }) {
  const [saved, setSaved] = useState<Settings | null>(null);
  /** Edits not saved yet. A number being typed is kept as text. */
  const [draft, setDraft] = useState<Record<string, SettingValue>>({});
  const [error, setError] = useState<FuseboxError | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    try {
      setSaved(await loadSettings(def));
      setDraft({});
      setError(null);
    } catch (e) {
      setError(e instanceof FuseboxError ? e : new FuseboxError(String(e), 0));
    }
  }, [def]);

  useEffect(() => {
    load();
  }, [load]);

  if (error && (error.status === 401 || error.status === 403) && !saved) {
    return (
      <div className="proxy-locked small">
        <span>
          {error.status === 401
            ? `${def.name} asks for its management key. This app does not read or keep keys, so its settings are changed in its own dashboard.`
            : error.message}
        </span>
        <button onClick={() => openExternal(def.url)}>
          <Icon name="external" size={13} /> Open the dashboard
        </button>
      </div>
    );
  }
  if (!saved) return <div className={error ? "error small" : "muted small"}>{error ? error.message : "Loading settings…"}</div>;

  const all = SETTING_GROUPS.flatMap((g) => g.settings);
  const value = (s: SettingDef) => (s.key in draft ? draft[s.key] : saved.values[s.key]);
  /** What a save would send: the edits that differ from the file, numbers as numbers. */
  const changes: Record<string, SettingValue> = {};
  const invalid: string[] = [];
  for (const s of all) {
    if (!(s.key in draft)) continue;
    let next = draft[s.key];
    if (s.kind === "number") {
      const n = parse(s, String(next));
      if (n == null) {
        invalid.push(s.key);
        continue;
      }
      next = n;
    }
    if (next !== saved.values[s.key]) changes[s.key] = next;
  }
  const dirty = Object.keys(changes).length > 0 || invalid.length > 0;
  const edit = (key: string, v: SettingValue) => {
    setDraft((d) => ({ ...d, [key]: v }));
    setDone(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      setSaved(await saveSettings(def, saved.revision, changes));
      setDraft({});
      setError(null);
      setDone(true);
    } catch (e) {
      setError(e instanceof FuseboxError ? e : new FuseboxError(String(e), 0));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings">
      {SETTING_GROUPS.map((group) => (
        <fieldset key={group.title} className="setting-group">
          <legend className="tiny muted">{group.title}</legend>
          {group.settings
            .filter((s) => s.key in saved.values)
            .map((s) => {
              const v = value(s);
              const id = `${def.id}-${s.key}`;
              const changed = s.key in changes || invalid.includes(s.key);
              const isDefault = saved.values[s.key] === saved.defaults[s.key];
              return (
                <div key={s.key} className={`setting ${changed ? "changed" : ""}`}>
                  <label htmlFor={id} className="setting-text">
                    <span>
                      {s.label}
                      {!isDefault && !changed && <span className="tiny muted" title={`Default: ${String(saved.defaults[s.key])}`}> · changed from the default</span>}
                    </span>
                    <span className="tiny muted">{s.help}</span>
                  </label>
                  {s.kind === "bool" && (
                    <button id={id} role="switch" aria-checked={v === true} className={`switch ${v === true ? "on" : ""}`} disabled={saving} onClick={() => edit(s.key, v !== true)}>
                      <span />
                    </button>
                  )}
                  {s.kind === "choice" && (
                    <select id={id} value={String(v)} disabled={saving} onChange={(e) => edit(s.key, e.target.value)}>
                      {s.options.map(([option, label]) => (
                        <option key={option} value={option}>
                          {label}
                        </option>
                      ))}
                    </select>
                  )}
                  {s.kind === "number" && (
                    <span className="setting-number">
                      <input
                        id={id}
                        inputMode="numeric"
                        className={invalid.includes(s.key) ? "invalid" : ""}
                        aria-invalid={invalid.includes(s.key)}
                        title={`${s.min} to ${s.max}`}
                        value={String(v)}
                        disabled={saving}
                        onChange={(e) => edit(s.key, e.target.value)}
                      />
                      {s.unit && <span className="muted tiny">{s.unit}</span>}
                    </span>
                  )}
                </div>
              );
            })}
        </fieldset>
      ))}

      {error && (
        <div className="error small">
          {error.message}
          {error.status === 409 && (
            <button className="link" onClick={load}>
              Reload
            </button>
          )}
        </div>
      )}
      {saved.restartFields.length > 0 && <div className="proxy-latest small">Restart the proxy to apply: {saved.restartFields.join(", ")}.</div>}

      <div className="settings-foot small">
        <span className="settings-path muted ellipsis" title={saved.path}>
          {done && !dirty ? "Saved to " : "Kept in "}
          <span className="mono">{saved.path}</span>
        </span>
        {invalid.length > 0 && <span className="minus">A number is out of range.</span>}
        <span className="grow" />
        <button className="ghost" onClick={() => openExternal(def.url)} title="Keys, clients, TLS and webhooks are set in the proxy's own dashboard">
          <Icon name="external" size={13} /> More in the dashboard
        </button>
        <button disabled={!dirty || saving} onClick={() => (setDraft({}), setError(null))}>
          Discard
        </button>
        <button className="primary" disabled={!Object.keys(changes).length || invalid.length > 0 || saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

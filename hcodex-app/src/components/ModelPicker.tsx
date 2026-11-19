import { useState } from "react";
import { choiceKey, parseChoice, type Catalog } from "../lib/models";
import type { ModelChoice } from "../lib/store";

const CUSTOM = "\u0000custom";

type Props = {
  catalog: Catalog;
  value: ModelChoice;
  onChange: (c: ModelChoice) => void;
};

/** One select listing every provider's models; picking a model also picks its provider. */
export function ModelPicker({ catalog, value, onChange }: Props) {
  const known = catalog.providers.some((p) => p.id === value.provider && p.models.includes(value.model));
  const [custom, setCustom] = useState(false);

  if (custom) {
    return (
      <div className="row grow">
        <select
          className="small"
          value={value.provider}
          onChange={(e) => onChange({ ...value, provider: e.target.value })}
          title="provider"
        >
          {catalog.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id}
            </option>
          ))}
        </select>
        <input
          className="mono small grow"
          value={value.model}
          placeholder="model id"
          onChange={(e) => onChange({ ...value, model: e.target.value })}
        />
        <button className="link small" onClick={() => setCustom(false)} title="back to the list">
          list
        </button>
      </div>
    );
  }

  return (
    <select
      className="mono small grow"
      value={choiceKey(value)}
      title={`${value.provider} · ${value.model}`}
      onChange={(e) => (e.target.value === CUSTOM ? setCustom(true) : onChange(parseChoice(e.target.value)))}
    >
      {!known && value.model && (
        <option value={choiceKey(value)}>
          {value.model} ({value.provider})
        </option>
      )}
      {catalog.providers.map((p) => (
        <optgroup key={p.id} label={p.models.length ? p.id : `${p.id} — ${p.error ?? "no models"}`}>
          {p.models.map((m) => (
            <option key={m} value={choiceKey({ provider: p.id, model: m })}>
              {m}
            </option>
          ))}
        </optgroup>
      ))}
      <option value={CUSTOM}>Custom model…</option>
    </select>
  );
}

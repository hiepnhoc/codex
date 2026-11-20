import { useCallback, useEffect, useState, type ReactNode } from "react";
import { rpc } from "../lib/rpc";
import type { Catalog } from "../lib/models";
import type { ListMcpServerStatusResponse } from "../protocol/v2/ListMcpServerStatusResponse";
import type { McpServerStatus } from "../protocol/v2/McpServerStatus";
import type { ModelProviderListResponse } from "../protocol/v2/ModelProviderListResponse";
import type { PluginListResponse } from "../protocol/v2/PluginListResponse";
import type { PluginSummary } from "../protocol/v2/PluginSummary";
import type { SkillMetadata } from "../protocol/v2/SkillMetadata";
import type { SkillsListResponse } from "../protocol/v2/SkillsListResponse";
import { Icon } from "./Icon";
import type { Page } from "./Sidebar";

const TITLES: Record<Page, string> = {
  plugins: "Plugins",
  skills: "Skills",
  mcp: "MCP servers",
  providers: "Providers",
};

type Props = { page: Page; cwd: string; catalog: Catalog; onClose: () => void };

/** Read-only views of what the harness has installed. They replace the chat while open. */
export function Pages({ page, cwd, catalog, onClose }: Props) {
  const [reload, setReload] = useState(0);
  return (
    <section className="page">
      <header className="chat-header">
        <button className="ghost" onClick={onClose} title="Back to the conversation">
          <Icon name="back" /> Back
        </button>
        <span className="chat-title">{TITLES[page]}</span>
        <span className="grow" />
        <button className="icon-btn" onClick={() => setReload((n) => n + 1)} title="Reload" aria-label="Reload">
          <Icon name="refresh" />
        </button>
      </header>
      <div className="page-body">
        {page === "skills" && <SkillsPage key={reload} cwd={cwd} force={reload > 0} />}
        {page === "plugins" && <PluginsPage key={reload} cwd={cwd} />}
        {page === "mcp" && <McpPage key={reload} />}
        {page === "providers" && <ProvidersPage key={reload} catalog={catalog} />}
      </div>
    </section>
  );
}

/** Runs one request on mount and reports loading, error or data. */
function useLoad<T>(run: () => Promise<T>): { data: T | null; error: string } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  // `run` is rebuilt every render; the page is remounted (by `key`) to reload.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const once = useCallback(run, []);
  useEffect(() => {
    let live = true;
    once().then(
      (d) => live && setData(d),
      (e) => live && setError(String(e)),
    );
    return () => {
      live = false;
    };
  }, [once]);
  return { data, error };
}

function Status({ data, error, empty }: { data: unknown[] | null; error: string; empty: string }) {
  if (error) return <div className="error small">{error}</div>;
  if (!data) return <div className="muted small">Loading…</div>;
  if (!data.length) return <div className="muted small">{empty}</div>;
  return null;
}

function Row({ name, badge, tone, children }: { name: string; badge?: string; tone?: "ok" | "off" | "warn"; children?: ReactNode }) {
  return (
    <div className="list-row">
      <div className="list-head">
        <span className="list-name">{name}</span>
        {badge && <span className={`badge ${tone ?? ""}`}>{badge}</span>}
      </div>
      {children && <div className="list-detail muted small">{children}</div>}
    </div>
  );
}

function SkillsPage({ cwd, force }: { cwd: string; force: boolean }) {
  const { data, error } = useLoad(async () => {
    const r = await rpc.request<SkillsListResponse>("skills/list", { cwds: [cwd], forceReload: force });
    return r.data.flatMap((entry) => entry.skills);
  });
  const groups: Array<[string, SkillMetadata[]]> = ["repo", "user", "system", "admin"].map((scope) => [
    scope,
    (data ?? []).filter((s) => s.scope === scope).sort((a, b) => a.name.localeCompare(b.name)),
  ]);
  return (
    <>
      <Status data={data} error={error} empty="No skills found for this workspace." />
      {groups.map(
        ([scope, skills]) =>
          skills.length > 0 && (
            <div key={scope} className="list-group">
              <div className="list-title">
                {scope} <span className="muted">({skills.length})</span>
              </div>
              {skills.map((s) => (
                <Row key={s.path} name={s.name} badge={s.enabled ? undefined : "disabled"} tone="off">
                  {s.shortDescription ?? s.description}
                </Row>
              ))}
            </div>
          ),
      )}
    </>
  );
}

function PluginsPage({ cwd }: { cwd: string }) {
  const { data, error } = useLoad(async () => {
    const r = await rpc.request<PluginListResponse>("plugin/list", { cwds: [cwd] });
    return r.marketplaces;
  });
  const badge = (p: PluginSummary): [string, "ok" | "off"] => (p.installed ? [p.enabled ? "enabled" : "installed, off", p.enabled ? "ok" : "off"] : ["available", "off"]);
  return (
    <>
      <Status data={data} error={error} empty="No plugin marketplaces configured." />
      {(data ?? []).map((m) => (
        <div key={m.name} className="list-group">
          <div className="list-title">
            {m.interface?.displayName ?? m.name} <span className="muted">({m.plugins.length})</span>
          </div>
          {m.plugins.length === 0 && <div className="muted small">No plugins in this marketplace.</div>}
          {[...m.plugins]
            .sort((a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name))
            .map((p) => {
              const [text, tone] = badge(p);
              return (
                <Row key={p.id} name={p.interface?.displayName ?? p.name} badge={text} tone={tone}>
                  {p.interface?.shortDescription ?? p.id}
                </Row>
              );
            })}
        </div>
      ))}
    </>
  );
}

function McpPage() {
  const { data, error } = useLoad(async () => {
    const all: McpServerStatus[] = [];
    let cursor: string | null = null;
    do {
      const r: ListMcpServerStatusResponse = await rpc.request<ListMcpServerStatusResponse>("mcpServerStatus/list", { cursor, limit: 100 });
      all.push(...r.data);
      cursor = r.nextCursor;
    } while (cursor);
    return all.sort((a, b) => a.name.localeCompare(b.name));
  });
  return (
    <>
      <Status data={data} error={error} empty="No MCP servers configured." />
      {(data ?? []).map((s) => {
        const tools = Object.keys(s.tools).length;
        const status = s.runtimeStatus ?? "unknown";
        const tone = status === "connected" ? "ok" : status === "failed" || status === "authenticationRequired" ? "warn" : "off";
        return (
          <Row key={`${s.environmentId ?? ""}/${s.name}`} name={s.name} badge={status} tone={tone}>
            {s.toolsError ? s.toolsError : `${tools} tool${tools === 1 ? "" : "s"}`}
            {s.pluginId ? ` · from plugin ${s.pluginId}` : ""}
            {s.authStatus === "notLoggedIn" ? " · not logged in" : ""}
          </Row>
        );
      })}
    </>
  );
}

function ProvidersPage({ catalog }: { catalog: Catalog }) {
  const { data, error } = useLoad(async () => {
    const r = await rpc.request<ModelProviderListResponse>("modelProvider/list", {});
    return r.data;
  });
  const url = (id: string) => data?.find((p) => p.id === id)?.baseUrl ?? null;
  return (
    <>
      {error && <div className="error small">{error}</div>}
      <div className="muted small page-note">
        Providers the model picker can use. Add or change them with <span className="mono">/provider</span> in the hcodex terminal app, or in{" "}
        <span className="mono">~/.hcodex/config.toml</span>.
      </div>
      {catalog.providers.map((p, i) => (
        <Row key={p.id} name={p.id} badge={i === 0 ? "default" : undefined} tone="ok">
          {p.error ? <span className="warn">{p.error}</span> : `${p.models.length} model${p.models.length === 1 ? "" : "s"}`}
          {url(p.id) ? ` · ${url(p.id)}` : ""}
        </Row>
      ))}
    </>
  );
}

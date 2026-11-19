/**
 * Model catalog for the picker: the models of the default provider plus those of every
 * other configured provider, so choosing a model also chooses where it runs.
 */
import { rpc } from "./rpc";
import type { ConfigReadResponse } from "../protocol/v2/ConfigReadResponse";
import type { ModelListResponse } from "../protocol/v2/ModelListResponse";
import type { ModelProviderListResponse } from "../protocol/v2/ModelProviderListResponse";
import type { ModelChoice } from "./store";

/** hcodex falls back to this provider when `model_provider` is not set in config. */
const HCODEX_DEFAULT_PROVIDER = "local-proxy";
const LIST_TIMEOUT_MS = 8000;

export type ProviderModels = {
  id: string;
  name: string;
  models: string[];
  /** Why the list is empty, when it is. */
  error: string | null;
};

export type Catalog = {
  defaultChoice: ModelChoice;
  providers: ProviderModels[];
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms))]);
}

async function listModels(provider: string | null): Promise<string[]> {
  const params = provider ? { modelProvider: provider, includeHidden: true } : { includeHidden: true };
  const r = await withTimeout(rpc.request<ModelListResponse>("model/list", params), LIST_TIMEOUT_MS);
  return r.data.map((m) => m.model);
}

export async function loadCatalog(cwd: string): Promise<Catalog> {
  const cfg = await rpc.request<ConfigReadResponse>("config/read", { cwd });
  const defaultProvider = cfg.config.model_provider ?? HCODEX_DEFAULT_PROVIDER;
  const configuredModel = cfg.config.model ?? "";

  // The default provider is asked without a provider id: that is the list a new thread uses.
  const [defaults, others] = await Promise.all([
    listModels(null).then(
      (models) => ({ models, error: null as string | null }),
      (e) => ({ models: [] as string[], error: String(e) }),
    ),
    rpc.request<ModelProviderListResponse>("modelProvider/list", {}).then(
      (r) => r.data,
      () => [],
    ),
  ]);

  const providers: ProviderModels[] = [
    {
      id: defaultProvider,
      name: defaultProvider,
      models: Array.from(new Set([configuredModel, ...defaults.models].filter(Boolean))),
      error: defaults.error,
    },
  ];

  const rest = others.filter((p) => p.id !== defaultProvider && p.id !== "openai");
  const listed = await Promise.all(
    rest.map((p) =>
      listModels(p.id).then(
        (models): ProviderModels => ({ id: p.id, name: p.name, models, error: models.length ? null : "no models returned" }),
        (e): ProviderModels => ({ id: p.id, name: p.name, models: [], error: String(e) }),
      ),
    ),
  );
  providers.push(...listed);

  const first = providers[0];
  return {
    defaultChoice: { provider: first.id, model: configuredModel || first.models[0] || "" },
    providers,
  };
}

export const choiceKey = (c: ModelChoice) => `${c.provider}\u0000${c.model}`;

export function parseChoice(key: string): ModelChoice {
  const [provider, model] = key.split("\u0000");
  return { provider, model: model ?? "" };
}

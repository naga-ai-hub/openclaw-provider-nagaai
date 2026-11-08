import { MODELS_URL } from "./constants.js";
import { DEFAULT_MODEL_API, mapModelList, type ModelApi, type ModelDefinition } from "./models.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_CHARS = 4 * 1024 * 1024;
const CACHE_TTL_MS = 60_000;

/**
 * Reads the public model catalog. The request carries no API key.
 * Throws on HTTP, network and parse errors.
 */
export async function fetchModels(params: {
  api?: ModelApi;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
}): Promise<ModelDefinition[]> {
  const fetchImpl = params.fetchImpl ?? (globalThis.fetch as FetchLike);
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = params.signal ? AbortSignal.any([params.signal, timeout]) : timeout;
  const response = await fetchImpl(MODELS_URL, {
    method: "GET",
    headers: { Accept: "application/json" },
    redirect: "error",
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`NagaAI model list failed (HTTP ${response.status}).`);
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_CHARS) {
    throw new Error("NagaAI model list is too large.");
  }
  return mapModelList(JSON.parse(text), params.api ?? DEFAULT_MODEL_API);
}

const cache = new Map<ModelApi, { expiresAt: number; models: ModelDefinition[] }>();

/**
 * Returns the live tool-capable chat models, or undefined when the catalog
 * cannot be read or is empty. Caches a non-empty result for 60 seconds.
 */
export async function discoverModels(
  params: { api?: ModelApi; fetchImpl?: FetchLike; signal?: AbortSignal; now?: () => number } = {},
): Promise<ModelDefinition[] | undefined> {
  const now = params.now ?? Date.now;
  const api = params.api ?? DEFAULT_MODEL_API;
  const cached = cache.get(api);
  if (cached && cached.expiresAt > now()) {
    return structuredClone(cached.models);
  }
  try {
    const models = await fetchModels({ ...params, api });
    if (models.length === 0) {
      return undefined;
    }
    cache.set(api, { expiresAt: now() + CACHE_TTL_MS, models });
    return structuredClone(models);
  } catch {
    params.signal?.throwIfAborted();
    return undefined;
  }
}

export function clearDiscoveryCache(): void {
  cache.clear();
}

import type {
  ProviderCatalogContext,
  ProviderCatalogResult,
  ProviderPlugin,
  ProviderRuntimeModel,
  UnifiedModelCatalogEntry,
  UnifiedModelCatalogProviderPlugin,
} from "openclaw/plugin-sdk/plugin-entry";
import { createProviderApiKeyAuthMethod } from "openclaw/plugin-sdk/provider-auth";
import {
  API_KEY_ENV_VAR,
  BASE_URL,
  DEFAULT_MODEL_REF,
  DOCS_URL,
  KEYS_URL,
  PROVIDER_ID,
  PROVIDER_LABEL,
} from "./constants.js";
import { discoverModels, type FetchLike } from "./discovery.js";
import {
  buildFallbackModel,
  buildProviderConfig,
  buildStaticModels,
  DEFAULT_MODEL_API,
  FALLBACK_CONTEXT_WINDOW,
  type ModelApi,
  type ModelDefinition,
} from "./models.js";

export type ProviderOptions = {
  modelApi?: ModelApi;
  fetchImpl?: FetchLike;
};

/** Reads the `api` option from `plugins.entries.nagaai.config`. Responses unless Chat Completions is asked for. */
export function readModelApi(pluginConfig: Record<string, unknown> | undefined): ModelApi {
  return pluginConfig?.api === "openai-completions" ? "openai-completions" : DEFAULT_MODEL_API;
}

/**
 * Runtime catalog. Returns null without a key.
 * With a key, it returns the live catalog, or the offline list if the catalog cannot be read.
 */
export async function runCatalog(
  ctx: ProviderCatalogContext,
  options: ProviderOptions = {},
): Promise<ProviderCatalogResult> {
  if (ctx.providerIds && !ctx.providerIds.includes(PROVIDER_ID)) {
    return null;
  }
  const { apiKey } = ctx.resolveProviderApiKey(PROVIDER_ID);
  if (!apiKey) {
    return null;
  }
  const models = await discoverModels({
    ...(options.modelApi ? { api: options.modelApi } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  });
  return {
    provider: {
      ...buildProviderConfig(models ?? buildStaticModels(), options.modelApi ?? DEFAULT_MODEL_API),
      apiKey,
    },
  };
}

/** Offline catalog. No network, no key. */
export async function runStaticCatalog(options: ProviderOptions = {}): Promise<ProviderCatalogResult> {
  return { provider: buildProviderConfig(buildStaticModels(), options.modelApi ?? DEFAULT_MODEL_API) };
}

function toUnifiedRows(
  result: ProviderCatalogResult,
  source: UnifiedModelCatalogEntry["source"],
): UnifiedModelCatalogEntry[] {
  if (!result || !("provider" in result)) {
    return [];
  }
  return result.provider.models.map((model) => ({
    kind: "text" as const,
    provider: PROVIDER_ID,
    model: model.id,
    ...(model.name ? { label: model.name } : {}),
    source,
  }));
}

function toRuntimeModel(model: ModelDefinition, api: ModelApi): ProviderRuntimeModel {
  return {
    id: model.id,
    name: model.name,
    provider: PROVIDER_ID,
    api,
    baseUrl: BASE_URL,
    reasoning: model.reasoning,
    input: model.input.includes("image") ? ["text", "image"] : ["text"],
    cost: model.cost,
    contextWindow: model.contextWindow ?? FALLBACK_CONTEXT_WINDOW,
    maxTokens: model.maxTokens,
    ...(model.compat ? { compat: model.compat } : {}),
  };
}

export function buildProvider(options: ProviderOptions = {}): ProviderPlugin {
  const api = options.modelApi ?? DEFAULT_MODEL_API;
  return {
    id: PROVIDER_ID,
    label: PROVIDER_LABEL,
    docsPath: DOCS_URL,
    envVars: [API_KEY_ENV_VAR],
    auth: [
      createProviderApiKeyAuthMethod({
        providerId: PROVIDER_ID,
        methodId: "api-key",
        label: `${PROVIDER_LABEL} API key`,
        hint: "Key starts with ng-",
        expectedProviders: [PROVIDER_ID],
        optionKey: "nagaaiApiKey",
        flagName: "--nagaai-api-key",
        envVar: API_KEY_ENV_VAR,
        promptMessage: `Enter your ${PROVIDER_LABEL} API key`,
        noteTitle: PROVIDER_LABEL,
        noteMessage: `Create a key at ${KEYS_URL}`,
        defaultModel: DEFAULT_MODEL_REF,
      }),
    ],
    catalog: {
      order: "simple",
      run: (ctx) => runCatalog(ctx, options),
    },
    staticCatalog: {
      order: "simple",
      run: () => runStaticCatalog(options),
    },
    // A model id missing from the current list, for example one added after the last fetch.
    prepareDynamicModel: async (ctx) => {
      const modelId = ctx.modelId.trim();
      const models = await discoverModels({ api, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
      const model = models?.find((entry) => entry.id === modelId);
      return model ? toRuntimeModel(model, api) : undefined;
    },
    resolveDynamicModel: (ctx) => {
      const modelId = ctx.modelId.trim();
      return modelId ? toRuntimeModel(buildFallbackModel(modelId), api) : undefined;
    },
  };
}

export function buildModelCatalogProvider(options: ProviderOptions = {}): UnifiedModelCatalogProviderPlugin {
  return {
    provider: PROVIDER_ID,
    kinds: ["text"],
    staticCatalog: async () => toUnifiedRows(await runStaticCatalog(options), "static"),
    liveCatalog: async (ctx) => toUnifiedRows(await runCatalog(ctx, options), "live"),
  };
}

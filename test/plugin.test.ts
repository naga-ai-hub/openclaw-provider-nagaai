import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderPlugin, UnifiedModelCatalogProviderPlugin } from "openclaw/plugin-sdk/plugin-entry";
import plugin from "../src/index.js";
import { clearDiscoveryCache } from "../src/discovery.js";
import { buildStaticModels } from "../src/models.js";
import { buildModelCatalogProvider, buildProvider, runCatalog } from "../src/provider.js";
import { jsonResponse, mockFetch, MODELS_RESPONSE } from "./fixtures.js";

const manifest = JSON.parse(readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8")) as {
  id: string;
  version: string;
  providers: string[];
  setup: { providers: Array<{ id: string; authMethods: string[]; envVars: string[] }> };
  providerAuthChoices: Array<{ provider: string; method: string; optionKey: string; cliFlag: string }>;
  modelCatalog: { providers: Record<string, { baseUrl: string; api: string; models: unknown[] }> };
  configSchema: { properties: { api: { enum: string[] } } };
};
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  name: string;
  version: string;
  openclaw: { providers: string[]; install: { clawhubSpec: string } };
};

function registerPlugin(pluginConfig?: Record<string, unknown>) {
  const providers: ProviderPlugin[] = [];
  const catalogs: UnifiedModelCatalogProviderPlugin[] = [];
  const api = {
    pluginConfig,
    registerProvider: vi.fn((provider: ProviderPlugin) => providers.push(provider)),
    registerModelCatalogProvider: vi.fn((catalog: UnifiedModelCatalogProviderPlugin) => catalogs.push(catalog)),
  };
  plugin.register(api as never);
  return { providers, catalogs };
}

function catalogContext(params: { apiKey?: string; providerIds?: string[] }) {
  return {
    config: {},
    env: {},
    ...(params.providerIds ? { providerIds: params.providerIds } : {}),
    resolveProviderApiKey: () => ({ apiKey: params.apiKey }),
    resolveProviderAuth: () => ({ apiKey: params.apiKey, mode: "api_key", source: "env" }),
  } as never;
}

function dynamicContext(modelId: string) {
  return { provider: "nagaai", modelId, modelRegistry: {} } as never;
}

beforeEach(() => {
  clearDiscoveryCache();
});

describe("plugin entry", () => {
  it("uses the manifest id", () => {
    expect(plugin.id).toBe(manifest.id);
    expect(plugin.id).toBe("nagaai");
    expect(plugin.name).toBe("NagaAI");
  });

  it("registers one text provider and one model catalog", () => {
    const { providers, catalogs } = registerPlugin();
    expect(providers).toHaveLength(1);
    expect(catalogs).toHaveLength(1);
    const provider = providers[0]!;
    expect(provider.id).toBe("nagaai");
    expect(provider.label).toBe("NagaAI");
    expect(provider.envVars).toEqual(["NAGA_API_KEY"]);
    expect(provider.auth.map((method) => method.id)).toEqual(["api-key"]);
    expect(catalogs[0]).toMatchObject({ provider: "nagaai", kinds: ["text"] });
  });

  it("uses the Responses API by default", async () => {
    const { providers } = registerPlugin();
    const result = await providers[0]!.staticCatalog!.run(catalogContext({}));
    if (!result || !("provider" in result)) throw new Error("expected provider");
    expect(result.provider.api).toBe("openai-responses");
  });

  it("uses Chat Completions when the plugin config asks for it", async () => {
    const { providers } = registerPlugin({ api: "openai-completions" });
    const result = await providers[0]!.staticCatalog!.run(catalogContext({}));
    if (!result || !("provider" in result)) throw new Error("expected provider");
    expect(result.provider.api).toBe("openai-completions");
  });
});

describe("manifest and package", () => {
  it("match the runtime provider", () => {
    expect(manifest.providers).toEqual(["nagaai"]);
    expect(packageJson.openclaw.providers).toEqual(["nagaai"]);
    expect(packageJson.openclaw.install.clawhubSpec).toBe(`clawhub:${packageJson.name}`);
    expect(manifest.version).toBe(packageJson.version);
    expect(manifest.setup.providers).toEqual([
      { id: "nagaai", authMethods: ["api-key"], envVars: ["NAGA_API_KEY"] },
    ]);
    expect(manifest.providerAuthChoices[0]).toMatchObject({
      provider: "nagaai",
      method: "api-key",
      optionKey: "nagaaiApiKey",
      cliFlag: "--nagaai-api-key",
    });
    expect(manifest.configSchema.properties.api.enum).toEqual(["openai-responses", "openai-completions"]);
  });

  it("list the same offline models as the runtime", () => {
    const catalog = manifest.modelCatalog.providers.nagaai!;
    expect(catalog.baseUrl).toBe("https://api.naga.ac/v1");
    expect(catalog.api).toBe("openai-responses");
    expect(catalog.models).toEqual(buildStaticModels().map(({ cost: _cost, ...rest }) => rest));
  });
});

describe("catalog", () => {
  it("returns null without a key", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(MODELS_RESPONSE));
    await expect(runCatalog(catalogContext({}), { fetchImpl })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null when another provider is requested", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(MODELS_RESPONSE));
    await expect(
      runCatalog(catalogContext({ apiKey: "ng-test", providerIds: ["other"] }), { fetchImpl }),
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns live tool-capable models with a key, and does not send the key to the catalog", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(MODELS_RESPONSE));
    const result = await runCatalog(catalogContext({ apiKey: "ng-test" }), { fetchImpl });
    if (!result || !("provider" in result)) throw new Error("expected provider");
    expect(result.provider).toMatchObject({
      baseUrl: "https://api.naga.ac/v1",
      api: "openai-responses",
      apiKey: "ng-test",
    });
    expect(result.provider.models.map((model) => model.id)).toEqual([
      "anthropic/claude-sonnet-5.5",
      "z-ai/glm-5.3",
      "meta-llama/llama-3.3-70b-instruct:free",
      "mistralai/codestral-2501",
    ]);
    expect(JSON.stringify(fetchImpl.mock.calls[0]![1]?.headers)).not.toContain("ng-test");
  });

  it("falls back to the offline list when the catalog cannot be read", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({}, 500));
    const result = await runCatalog(catalogContext({ apiKey: "ng-test" }), { fetchImpl });
    if (!result || !("provider" in result)) throw new Error("expected provider");
    expect(result.provider.models.map((model) => model.id)).toEqual(buildStaticModels().map((model) => model.id));
  });

  it("static catalog needs no key and no network", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(MODELS_RESPONSE));
    const result = await buildProvider({ fetchImpl }).staticCatalog!.run(catalogContext({}));
    if (!result || !("provider" in result)) throw new Error("expected provider");
    expect(result.provider.models.map((model) => model.id)).toEqual([
      "anthropic/claude-sonnet-5.5",
      "anthropic/claude-opus-5.5",
      "openai/gpt-6.1-sol",
      "google/gemini-3.8-flash",
      "deepseek/deepseek-v4.1-flash",
      "moonshotai/kimi-k3.1-pro",
    ]);
    expect(result.provider.apiKey).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("projects unified catalog rows", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(MODELS_RESPONSE));
    const catalog = buildModelCatalogProvider({ fetchImpl });
    const staticRows = await catalog.staticCatalog!(catalogContext({}));
    expect(staticRows?.[0]).toEqual({
      kind: "text",
      provider: "nagaai",
      model: "anthropic/claude-sonnet-5.5",
      label: "Claude Sonnet 5.5",
      source: "static",
    });
    const liveRows = await catalog.liveCatalog!(catalogContext({ apiKey: "ng-test" }));
    expect(liveRows?.map((row) => [row.model, row.source])).toEqual([
      ["anthropic/claude-sonnet-5.5", "live"],
      ["z-ai/glm-5.3", "live"],
      ["meta-llama/llama-3.3-70b-instruct:free", "live"],
      ["mistralai/codestral-2501", "live"],
    ]);
  });
});

describe("model resolution", () => {
  it("lists a Chat Completions-only model only on the Chat Completions API", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(MODELS_RESPONSE));
    const responses = await runCatalog(catalogContext({ apiKey: "ng-test" }), { fetchImpl });
    const completions = await runCatalog(catalogContext({ apiKey: "ng-test" }), {
      fetchImpl,
      modelApi: "openai-completions",
    });
    if (!responses || !("provider" in responses)) throw new Error("expected provider");
    if (!completions || !("provider" in completions)) throw new Error("expected provider");
    expect(responses.provider.models.map((model) => model.id)).not.toContain("legacy/chat-only");
    expect(completions.provider.models.map((model) => model.id)).toContain("legacy/chat-only");
  });

  it("prepares a listed model from the live catalog", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(MODELS_RESPONSE));
    const model = await buildProvider({ fetchImpl }).prepareDynamicModel!(dynamicContext("z-ai/glm-5.3"));
    expect(model).toMatchObject({
      id: "z-ai/glm-5.3",
      name: "GLM 5.3",
      provider: "nagaai",
      api: "openai-responses",
      baseUrl: "https://api.naga.ac/v1",
      reasoning: true,
      input: ["text"],
      contextWindow: 1048576,
      maxTokens: 8192,
    });
  });

  it("leaves an unlisted model to the sync fallback", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(MODELS_RESPONSE));
    const provider = buildProvider({ fetchImpl, modelApi: "openai-completions" });
    await expect(provider.prepareDynamicModel!(dynamicContext("new-model"))).resolves.toBeUndefined();
    expect(provider.resolveDynamicModel!(dynamicContext("new-model"))).toMatchObject({
      id: "new-model",
      provider: "nagaai",
      api: "openai-completions",
      baseUrl: "https://api.naga.ac/v1",
      reasoning: false,
      input: ["text"],
      contextWindow: 128000,
      maxTokens: 8192,
      compat: { supportsUsageInStreaming: true },
    });
  });
});

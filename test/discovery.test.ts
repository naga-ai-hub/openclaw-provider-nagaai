import { beforeEach, describe, expect, it } from "vitest";
import { clearDiscoveryCache, discoverModels, fetchModels } from "../src/discovery.js";
import { DEFAULT_MAX_TOKENS, mapModelList, mapModelRow, REASONING_EFFORTS } from "../src/models.js";
import { jsonResponse, mockFetch, MODELS_RESPONSE } from "./fixtures.js";

const [claude, glm, freeLlama, codestral, sonar, chatOnly, image] = MODELS_RESPONSE.data;

beforeEach(() => {
  clearDiscoveryCache();
});

describe("mapModelRow", () => {
  it("maps name, modalities, context window and prices", () => {
    expect(mapModelRow(claude)).toEqual({
      id: "anthropic/claude-sonnet-5.5",
      name: "Claude Sonnet 5.5",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 0 },
      contextWindow: 1000000,
      maxTokens: DEFAULT_MAX_TOKENS,
      compat: {
        supportsUsageInStreaming: true,
        supportsReasoningEffort: true,
        supportedReasoningEfforts: REASONING_EFFORTS,
      },
    });
  });

  it("keeps text-only input and rounds per-million prices", () => {
    expect(mapModelRow(glm)).toMatchObject({
      input: ["text"],
      cost: { input: 0.0195, output: 0.55, cacheRead: 0.019, cacheWrite: 0 },
    });
  });

  it("leaves reasoning off when the model does not take reasoning_effort", () => {
    const model = mapModelRow(freeLlama);
    expect(model).toMatchObject({
      reasoning: false,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { supportsUsageInStreaming: true },
    });
    expect(model?.compat).not.toHaveProperty("supportsReasoningEffort");
    expect(model?.compat).not.toHaveProperty("supportedReasoningEfforts");
  });

  it("omits an unknown context window", () => {
    const model = mapModelRow(codestral);
    expect(model).not.toHaveProperty("contextWindow");
    expect(model?.maxTokens).toBe(DEFAULT_MAX_TOKENS);
  });

  it("caps maxTokens at the context window", () => {
    const chat = { ...freeLlama!.operations[0]!, limits: { context_window: 4096 } };
    expect(mapModelRow({ ...freeLlama, operations: [chat] })?.maxTokens).toBe(4096);
  });

  it("uses the base price and leaves out conditional price rows", () => {
    expect(mapModelRow(claude)?.cost.input).toBe(1);
  });

  it("drops models that do not chat", () => {
    expect(mapModelRow(image)).toBeUndefined();
  });

  it("keeps a Chat Completions-only model for Chat Completions only", () => {
    expect(mapModelRow(chatOnly)).toBeUndefined();
    expect(mapModelRow(chatOnly, "openai-completions")?.id).toBe("legacy/chat-only");
  });

  it("drops rows without tool support", () => {
    expect(mapModelRow(sonar)).toBeUndefined();
    expect(mapModelRow({ id: "x" })).toBeUndefined();
    expect(mapModelRow(null)).toBeUndefined();
  });

  it("falls back to the id when display_name is missing", () => {
    expect(mapModelRow({ ...freeLlama, id: "vendor/m", display_name: undefined })?.name).toBe("vendor/m");
  });
});

describe("mapModelList", () => {
  it("keeps tool-capable rows in order and drops duplicates", () => {
    const body = { data: [...MODELS_RESPONSE.data, claude] };
    expect(mapModelList(body).map((model) => model.id)).toEqual([
      "anthropic/claude-sonnet-5.5",
      "z-ai/glm-5.3",
      "meta-llama/llama-3.3-70b-instruct:free",
      "mistralai/codestral-2501",
    ]);
  });

  it("returns an empty list for an unexpected body", () => {
    expect(mapModelList({})).toEqual([]);
    expect(mapModelList("x")).toEqual([]);
  });
});

describe("fetchModels", () => {
  it("asks for chat models without an API key", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(MODELS_RESPONSE));
    await fetchModels({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.naga.ac/v1/models");
    expect(init?.headers).toEqual({ Accept: "application/json" });
    expect(init?.redirect).toBe("error");
  });

  it("throws on an HTTP error", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ error: "unavailable" }, 503));
    await expect(fetchModels({ fetchImpl })).rejects.toThrow("HTTP 503");
  });

  it("throws on a body that is not JSON", async () => {
    const fetchImpl = mockFetch(() => new Response("<html>", { status: 200 }));
    await expect(fetchModels({ fetchImpl })).rejects.toThrow();
  });
});

describe("discoverModels", () => {
  it("caches a non-empty list for 60 seconds", async () => {
    let time = 1_000;
    const now = () => time;
    const fetchImpl = mockFetch(() => jsonResponse(MODELS_RESPONSE));
    await discoverModels({ fetchImpl, now });
    time += 59_999;
    await discoverModels({ fetchImpl, now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    time += 2;
    await discoverModels({ fetchImpl, now });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns copies, so callers cannot change the cache", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(MODELS_RESPONSE));
    const first = await discoverModels({ fetchImpl });
    first![0]!.name = "changed";
    const second = await discoverModels({ fetchImpl });
    expect(second![0]!.name).toBe("Claude Sonnet 5.5");
  });

  it("returns undefined on failure and does not cache it", async () => {
    const failing = mockFetch(() => jsonResponse({}, 500));
    await expect(discoverModels({ fetchImpl: failing })).resolves.toBeUndefined();
    const working = mockFetch(() => jsonResponse(MODELS_RESPONSE));
    await expect(discoverModels({ fetchImpl: working })).resolves.toHaveLength(4);
  });

  it("returns undefined for an empty list", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ object: "list", data: [] }));
    await expect(discoverModels({ fetchImpl })).resolves.toBeUndefined();
  });

  it("rethrows when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = mockFetch(() => jsonResponse(MODELS_RESPONSE));
    await expect(discoverModels({ fetchImpl, signal: controller.signal })).rejects.toThrow();
  });
});

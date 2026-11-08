import type { ProviderCatalogResult } from "openclaw/plugin-sdk/plugin-entry";
import { BASE_URL } from "./constants.js";

export type ProviderConfig = Extract<NonNullable<ProviderCatalogResult>, { provider: unknown }>["provider"];
export type ModelDefinition = ProviderConfig["models"][number];
export type ModelCompat = NonNullable<ModelDefinition["compat"]>;
export type ModelApi = "openai-responses" | "openai-completions";

/** NagaAI's API number one is Responses; Chat Completions stays available through the plugin config. */
export const DEFAULT_MODEL_API: ModelApi = "openai-responses";

/** The NagaAI endpoint each OpenClaw API talks to, as `/v1/models` names it in `operations[].endpoints`. */
const ENDPOINT_BY_API: Record<ModelApi, string> = {
  "openai-responses": "responses",
  "openai-completions": "chat.completions",
};

/**
 * Output limit for every model. `/v1/models` publishes no per-model output limit,
 * and 8192 is the value OpenClaw uses for discovered models.
 */
export const DEFAULT_MAX_TOKENS = 8_192;
/** Context window for a model id that is not in the catalog. */
export const FALLBACK_CONTEXT_WINDOW = 128_000;
/** NagaAI accepts this effort scale for every reasoning model and maps it to the levels the model supports. */
export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"];

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/**
 * OpenClaw treats a custom base URL as a proxy and, by default, requests no
 * streamed usage and sends no reasoning effort. NagaAI supports both.
 */
export function buildCompat(reasoning: boolean): ModelCompat {
  return {
    supportsUsageInStreaming: true,
    ...(reasoning ? { supportsReasoningEffort: true, supportedReasoningEfforts: [...REASONING_EFFORTS] } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

/** The `chat` entry of a row's `operations`, if the model chats. */
function findChatOperation(row: Record<string, unknown>): Record<string, unknown> | undefined {
  const operations = Array.isArray(row.operations) ? row.operations : [];
  return operations.find((operation): operation is Record<string, unknown> => {
    return isRecord(operation) && operation.operation === "chat";
  });
}

/** Converts a USD-per-token price string to USD per million tokens. */
function perMillion(price: unknown): number {
  const value = typeof price === "string" || typeof price === "number" ? Number(price) : Number.NaN;
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.round(value * 1e12) / 1e6;
}

/**
 * Reads the unconditional token prices from the `pricing` rows.
 * Rows with `conditions` (long-context tiers and the like) are left out:
 * OpenClaw keeps one price per meter, and the base price is the common case.
 */
function readCost(pricing: unknown): ModelDefinition["cost"] {
  const prices = new Map<string, number>();
  for (const row of Array.isArray(pricing) ? pricing : []) {
    if (!isRecord(row) || row.unit !== "token" || typeof row.meter !== "string") {
      continue;
    }
    if (isRecord(row.conditions) && Object.keys(row.conditions).length > 0) {
      continue;
    }
    prices.set(row.meter, perMillion(row.price));
  }
  return {
    input: prices.get("input_token") ?? 0,
    output: prices.get("output_token") ?? 0,
    cacheRead: prices.get("cached_input_token") ?? 0,
    cacheWrite: 0,
  };
}

/**
 * Maps one row of GET /v1/models to an OpenClaw model definition.
 * Returns undefined unless the model chats on the endpoint of `api` and takes tools.
 */
export function mapModelRow(row: unknown, api: ModelApi = DEFAULT_MODEL_API): ModelDefinition | undefined {
  if (!isRecord(row)) {
    return undefined;
  }
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const chat = findChatOperation(row);
  if (!id || !chat || !readStrings(chat.endpoints).includes(ENDPOINT_BY_API[api])) {
    return undefined;
  }
  const parameters = isRecord(chat.parameters) ? chat.parameters : {};
  if (!("tools" in parameters)) {
    return undefined;
  }
  const architecture = isRecord(row.architecture) ? row.architecture : {};
  const image = readStrings(architecture.input_modalities).includes("image");
  const reasoning = "reasoning_effort" in parameters;
  const limits = isRecord(chat.limits) ? chat.limits : {};
  const contextWindow = readPositiveInt(limits.context_window);
  const name = typeof row.display_name === "string" && row.display_name.trim() ? row.display_name.trim() : id;
  return {
    id,
    name,
    reasoning,
    input: image ? ["text", "image"] : ["text"],
    cost: readCost(row.pricing),
    ...(contextWindow ? { contextWindow } : {}),
    maxTokens: Math.min(contextWindow ?? DEFAULT_MAX_TOKENS, DEFAULT_MAX_TOKENS),
    compat: buildCompat(reasoning),
  };
}

/** Maps a GET /v1/models body. Keeps tool-capable chat rows for `api` and drops duplicate ids. */
export function mapModelList(body: unknown, api: ModelApi = DEFAULT_MODEL_API): ModelDefinition[] {
  const rows = isRecord(body) && Array.isArray(body.data) ? body.data : [];
  const seen = new Set<string>();
  const models: ModelDefinition[] = [];
  for (const row of rows) {
    const model = mapModelRow(row, api);
    if (model && !seen.has(model.id)) {
      seen.add(model.id);
      models.push(model);
    }
  }
  return models;
}

function staticModel(id: string, name: string, image: boolean, contextWindow: number): ModelDefinition {
  return {
    id,
    name,
    reasoning: true,
    input: image ? ["text", "image"] : ["text"],
    // Prices come from the live catalog only.
    cost: { ...ZERO_COST },
    contextWindow,
    maxTokens: DEFAULT_MAX_TOKENS,
    compat: buildCompat(true),
  };
}

/**
 * Offline list, used before a key is set and when the live catalog is unreachable.
 * Keep it in sync with `modelCatalog` in openclaw.plugin.json (a test checks it).
 */
export function buildStaticModels(): ModelDefinition[] {
  return [
    staticModel("anthropic/claude-sonnet-5.5", "Claude Sonnet 5.5", true, 1_000_000),
    staticModel("anthropic/claude-opus-5.5", "Claude Opus 5.5", true, 1_000_000),
    staticModel("openai/gpt-6.1-sol", "GPT-6.1 Sol", true, 1_050_000),
    staticModel("google/gemini-3.8-flash", "Gemini 3.8 Flash", true, 1_048_576),
    staticModel("deepseek/deepseek-v4.1-flash", "DeepSeek V4.1 Flash", true, 1_048_576),
    staticModel("moonshotai/kimi-k3.1-pro", "Kimi K3.1 Pro", true, 1_048_576),
  ];
}

/** Conservative definition for a model id that is not in the catalog. */
export function buildFallbackModel(id: string): ModelDefinition {
  return {
    id,
    name: id,
    reasoning: false,
    input: ["text"],
    cost: { ...ZERO_COST },
    contextWindow: FALLBACK_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
    compat: buildCompat(false),
  };
}

export function buildProviderConfig(models: ModelDefinition[], api: ModelApi): ProviderConfig {
  return { baseUrl: BASE_URL, api, models };
}

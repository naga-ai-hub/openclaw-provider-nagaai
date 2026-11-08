import { vi } from "vitest";
import type { FetchLike } from "../src/discovery.js";

const ENDPOINTS = ["chat.completions", "messages", "responses"];
const native = { "x-support": "native" };

function tokenPricing(input: string, cached: string | undefined, output: string) {
  return [
    { meter: "input_token", unit: "token", price: input, conditions: {} },
    ...(cached ? [{ meter: "cached_input_token", unit: "token", price: cached, conditions: {} }] : []),
    { meter: "output_token", unit: "token", price: output, conditions: {} },
  ];
}

function chatRow(params: {
  id: string;
  name: string;
  contextWindow?: number;
  parameters: string[];
  pricing: unknown[];
  input?: string[];
  endpoints?: string[];
}) {
  return {
    id: params.id,
    object: "model",
    owned_by: params.id.split("/")[0],
    display_name: params.name,
    kinds: ["chat"],
    primary_operation: "chat",
    operations: [
      {
        operation: "chat",
        kind: "chat",
        endpoints: params.endpoints ?? ENDPOINTS,
        limits: params.contextWindow ? { context_window: params.contextWindow } : {},
        parameters: Object.fromEntries(params.parameters.map((name) => [name, native])),
      },
    ],
    pricing: params.pricing,
    architecture: { input_modalities: params.input ?? ["text"], output_modalities: ["text"] },
    aliases: [params.id.split("/")[1]],
  };
}

/** Rows from GET /v1/models, trimmed to the fields the plugin reads. */
export const MODELS_RESPONSE = {
  object: "list",
  data: [
    chatRow({
      id: "anthropic/claude-sonnet-5.5",
      name: "Claude Sonnet 5.5",
      contextWindow: 1000000,
      parameters: ["max_completion_tokens", "reasoning_effort", "response_format", "tool_choice", "tools"],
      pricing: [
        ...tokenPricing("0.000001", "0.00000005", "0.000005"),
        { meter: "input_token", unit: "token", price: "0.000002", conditions: { min_input_tokens: 200001 } },
      ],
      input: ["text", "image", "file"],
    }),
    chatRow({
      id: "z-ai/glm-5.3",
      name: "GLM 5.3",
      contextWindow: 1048576,
      parameters: ["max_completion_tokens", "reasoning_effort", "tool_choice", "tools"],
      pricing: tokenPricing("0.0000000195", "0.000000019", "0.00000055"),
    }),
    chatRow({
      id: "meta-llama/llama-3.3-70b-instruct:free",
      name: "Llama 3.3 70B Instruct (Free)",
      contextWindow: 128000,
      parameters: ["max_completion_tokens", "tool_choice", "tools"],
      pricing: tokenPricing("0", "0", "0"),
    }),
    chatRow({
      id: "mistralai/codestral-2501",
      name: "Codestral 2501",
      parameters: ["max_completion_tokens", "tool_choice", "tools"],
      pricing: tokenPricing("0.00000015", "0.000000015", "0.00000045"),
    }),
    chatRow({
      id: "perplexity/sonar-pro",
      name: "Sonar Pro",
      contextWindow: 200000,
      parameters: ["max_completion_tokens", "reasoning_effort", "response_format"],
      pricing: tokenPricing("0.0000015", undefined, "0.0000075"),
    }),
    chatRow({
      id: "legacy/chat-only",
      name: "Chat Only",
      contextWindow: 32768,
      parameters: ["tools"],
      pricing: tokenPricing("0.000001", undefined, "0.000002"),
      endpoints: ["chat.completions"],
    }),
    {
      id: "openai/gpt-image-2",
      object: "model",
      owned_by: "openai",
      display_name: "GPT Image 2",
      kinds: ["image"],
      primary_operation: "image_generation",
      operations: [{ operation: "image_generation", kind: "image", endpoints: ["images.generations"], parameters: {} }],
      pricing: [{ meter: "output_image_token", unit: "token", price: "0.00004", conditions: {} }],
      architecture: { input_modalities: ["text"], output_modalities: ["image"] },
      aliases: ["gpt-image-2"],
    },
  ],
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function mockFetch(handler: () => Response | Promise<Response>) {
  return vi.fn<FetchLike>(async (_input, init) => {
    init?.signal?.throwIfAborted();
    return handler();
  });
}

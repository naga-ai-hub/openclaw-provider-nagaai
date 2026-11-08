import { describe, expect, it } from "vitest";
import { fetchModels } from "../src/discovery.js";
import { buildStaticModels } from "../src/models.js";

// Reads the real public catalog: `NAGA_LIVE=1 npm test`. Needs no key.
describe.runIf(process.env.NAGA_LIVE === "1")("live catalog", () => {
  it("serves every offline model with tools on both APIs", async () => {
    for (const api of ["openai-responses", "openai-completions"] as const) {
      const live = new Set((await fetchModels({ api })).map((model) => model.id));
      expect(buildStaticModels().map((model) => model.id).filter((id) => !live.has(id)), api).toEqual([]);
    }
  });
});

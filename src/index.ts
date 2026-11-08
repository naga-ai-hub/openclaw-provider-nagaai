import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { PROVIDER_ID, PROVIDER_LABEL } from "./constants.js";
import { buildModelCatalogProvider, buildProvider, readModelApi } from "./provider.js";

export default definePluginEntry({
  id: PROVIDER_ID,
  name: PROVIDER_LABEL,
  description: "NagaAI model provider (OpenAI-compatible API)",
  register(api) {
    const options = { modelApi: readModelApi(api.pluginConfig) };
    api.registerProvider(buildProvider(options));
    api.registerModelCatalogProvider(buildModelCatalogProvider(options));
  },
});

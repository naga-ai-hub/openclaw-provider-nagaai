# NagaAI provider for OpenClaw

Adds [NagaAI](https://naga.ac) to OpenClaw as the `nagaai` provider: models
from OpenAI, Anthropic, Google, DeepSeek, Moonshot, Z.ai, xAI and others
through one API. The model list, context windows and prices come from NagaAI's
public catalog, so new models show up without a plugin update.

| Property        | Value                            |
| --------------- | -------------------------------- |
| Provider id     | `nagaai`                         |
| Package         | `@nagaai/openclaw-provider`      |
| API key env var | `NAGA_API_KEY`                   |
| Onboarding flag | `--auth-choice nagaai-api-key`   |
| Direct CLI flag | `--nagaai-api-key <key>`         |
| API             | OpenAI Responses (Chat Completions optional) |
| Base URL        | `https://api.naga.ac/v1`         |
| Default model   | `nagaai/anthropic/claude-sonnet-5.5` |

## Requirements

- OpenClaw 2026.11.2 or later.
- A NagaAI API key from the [API Keys](https://naga.ac/dashboard/api-keys) page.

## Install

```bash
openclaw plugins install clawhub:@nagaai/openclaw-provider
```

## Set the API key

Run onboarding and pick **NagaAI**:

```bash
openclaw onboard --auth-choice nagaai-api-key
```

Or sign in for this provider only:

```bash
openclaw models auth login --provider nagaai --set-default
```

Or set the environment variable for the Gateway process:

```bash
export NAGA_API_KEY="ng-..."
```

## Select a model

```bash
openclaw models list --provider nagaai --all --refresh
openclaw models set nagaai/anthropic/claude-sonnet-5.5
```

Write the NagaAI model id after `nagaai/`, for example
`nagaai/openai/gpt-6.1-sol` or `nagaai/deepseek/deepseek-v4.1-flash`. The full
catalog is at <https://naga.ac/models>.

## How the model list works

With a key set, the plugin reads `GET https://api.naga.ac/v1/models` and keeps
the models whose `chat` operation is served on the API the plugin uses and
takes `tools`. The request carries no key. The result is cached for 60 seconds.
If the request fails, OpenClaw gets a built-in list of six models.

Each catalog row maps to an OpenClaw model:

| OpenClaw field  | From `/v1/models`                                                      |
| --------------- | ---------------------------------------------------------------------- |
| `name`          | `display_name`                                                         |
| `contextWindow` | `operations[chat].limits.context_window`                               |
| `input`         | `["text", "image"]` when `architecture.input_modalities` has `image`   |
| `reasoning`     | `true` when `operations[chat].parameters` has `reasoning_effort`        |
| `cost`          | unconditional `pricing` rows, from USD per token to USD per million tokens |

NagaAI accepts the reasoning effort scale `none` to `xhigh` for every
reasoning model and maps each level to the nearest one the model supports.

`/v1/models` publishes no per-model output limit, so every model gets
`maxTokens` 8192, the value OpenClaw uses for discovered models. To allow
longer answers from one model, set `maxTokens` in its params:

```json5
{
  agents: {
    defaults: {
      models: {
        "nagaai/anthropic/claude-sonnet-5.5": { params: { maxTokens: 32000 } },
      },
    },
  },
}
```

## Responses and Chat Completions

The plugin uses the Responses API. NagaAI keeps no conversation state, so
OpenClaw sends the full conversation on every turn, as it does for any custom
Responses endpoint. To switch every NagaAI model to Chat Completions:

```bash
openclaw config set plugins.entries.nagaai.config.api openai-completions
```

## Disclosure

- Your prompts and API key go to `api.naga.ac`. NagaAI is a multi-model API
  that forwards requests to upstream model providers and bills in prepaid
  credits.
- The plugin makes one network call of its own, the catalog fetch to
  `https://api.naga.ac/v1/models`, without your key. It adds no attribution or
  tracking headers, writes no files and runs no shell commands.

## Development

```bash
npm ci
npm run check            # type check, tests, build, ClawHub validation
NAGA_LIVE=1 npm test     # also checks the built-in models against the live catalog
```

Docs: <https://docs.naga.ac/integrations/agents/openclaw> · License: MIT

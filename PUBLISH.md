# Publishing to ClawHub

Sources: <https://docs.openclaw.ai/clawhub/publishing>, the provider scaffold of
`openclaw plugins init --type provider` (OpenClaw 2026.11.2).

ClawHub is OpenClaw's plugin registry; npm is not involved. The package scope
`@nagaai` must match the ClawHub publisher `nagaai`.

## Releases

The package `@nagaai/openclaw-provider` belongs to the ClawHub publisher
`nagaai`. Its trusted publisher is this repository with
`.github/workflows/clawhub-publish.yml`, so releases need no stored token.

1. Bump the version with `npm version <patch|minor|major>` and set the same
   `version` in `openclaw.plugin.json` (a test checks they match). Merge.
2. Actions → ClawHub Publish → Run workflow with `dry_run = true`. Check the
   name, version, family `code-plugin` and the source commit in the output.
3. Run it again with `dry_run = false`. The `Build and pack` job runs the
   checks and packs `dist/`; ClawHub holds the release until its security
   checks pass.

## Check the install

On a machine with OpenClaw 2026.11.2 or later:

```bash
openclaw plugins install clawhub:@nagaai/openclaw-provider
openclaw onboard --auth-choice nagaai-api-key
openclaw models list --provider nagaai --all --refresh
```

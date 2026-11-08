# Publishing to ClawHub

Sources: <https://docs.openclaw.ai/clawhub/publishing>, the provider scaffold of
`openclaw plugins init --type provider` (OpenClaw 2026.11.2).

ClawHub is OpenClaw's plugin registry; npm is not involved. The package scope
`@nagaai` must match the ClawHub publisher `nagaai`.

## One-time setup

1. Public repository `naga-ai-hub/openclaw-provider-nagaai`, default branch `main`.
2. Sign in to <https://clawhub.ai> with GitHub and create the publisher
   `nagaai` (display name "NagaAI"). If the handle is taken, rename the package
   in `name` and `openclaw.install.clawhubSpec` of `package.json` and `owner`
   in `.github/workflows/clawhub-publish.yml`; a test fails if the two names in
   `package.json` differ.
3. Create a ClawHub API token for `nagaai` and store it as the repository
   secret `CLAWHUB_TOKEN`.

## First release

Actions → ClawHub Publish → Run workflow with `dry_run = true`. In the output
check the name `@nagaai/openclaw-provider`, version `0.1.0`, family
`code-plugin` and the source repository. Then run it again with
`dry_run = false`. The `Build and pack` job runs the checks and packs `dist/`; the publish job
returns after ClawHub's security checks
publish the release or reject it.

## Later releases

After the first release, switch to trusted publishing and delete the token:

```bash
clawhub package trusted-publisher set @nagaai/openclaw-provider \
  --repository naga-ai-hub/openclaw-provider-nagaai \
  --workflow-filename clawhub-publish.yml
```

Bump the version with `npm version <patch|minor|major>` (it also has to match
`version` in `openclaw.plugin.json`), merge, and run the workflow again.

## Check the install

On a machine with OpenClaw 2026.11.2 or later:

```bash
openclaw plugins install clawhub:@nagaai/openclaw-provider
openclaw onboard --auth-choice nagaai-api-key
openclaw models list --provider nagaai --all --refresh
```

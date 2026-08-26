# Muninn

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://rasmushjulskov.com/assets/muninn/muninn-logo-dark.png">
    <img src="https://rasmushjulskov.com/assets/muninn/muninn-logo.png" width="560" alt="Muninn — project knowledge that stays current">
  </picture>
</p>

**Muninn makes repository knowledge navigable and verifiably current.**

Muninn is a repository documentation integrity checker. It gives contributors and coding agents a checked route to the sources of truth in a codebase—so current guidance is easy to find, old guidance points to its replacement, and broken routes fail the check.

Documentation drifts as code changes. Current and outdated guidance remain equally discoverable, links break, and contributors cannot tell which document to trust. Muninn does not generate or rewrite that documentation. It checks that human and agent entrypoints lead to the current sources of truth, then validates the links, anchors, lifecycle, scope, and review attestations that keep those routes reliable.

Requires Node.js 20.19 or newer; Bun works too.

## Quick start

Install Muninn as a development dependency:

```sh
npm install --save-dev @rasmushjulskov/muninn
# or: bun add --dev @rasmushjulskov/muninn
```

### New repository

```sh
npx muninn init .
npx muninn check .
```

`init` creates the missing files for a minimal passing contract:

```text
README.md
docs/README.md
docs/knowledge.yaml
```

It preserves existing files and does not change `.gitignore`. After a successful run it reports what was created or kept and links back here.

Use `npx muninn init . --template full` when you explicitly want the complete placeholder structure from [DEFAULT.md](DEFAULT.md): an agent entrypoint plus product, architecture, development, operations, and decisions authorities. To backfill that structure from the repository's real knowledge, run `npx muninn setup-prompt` and paste the one-time [setup prompt](SETUP_PROMPT.md) into a coding agent.

All generated navigation uses standard relative Markdown. If you want to open the repository root as an Obsidian vault, add `--obsidian`; this explicitly creates or updates `.gitignore` with `.obsidian/` while preserving existing rules and their order. No Obsidian-only syntax, plugins, or committed workspace state are required. `muninn init --template <dir>` copies a custom template directory instead.

### Existing repository

Initialize the scaffold, then adapt it before expecting a passing check:

```sh
npx muninn init .
```

Link the existing `README.md` to `docs/README.md`, then review `docs/knowledge.yaml` and map the docs that are current authority. Run `npx muninn check .` when those routes are ready.

For a larger documentation set, run `npx muninn setup-prompt` and paste the one-time [setup prompt](https://unpkg.com/@rasmushjulskov/muninn@0.1.1/SETUP_PROMPT.md) into a coding agent — it inventories entrypoints and authority and backfills the scaffolded placeholders from your real documentation. Muninn reports routes that still need attention; it does not rewrite existing documentation.

## What Muninn checks

By default, `check` runs offline and validates:

- the manifest, required files, repository-relative paths, casing, and symlink containment;
- visible routes from human and agent entrypoints to the documentation index;
- links from the index to every active authority;
- replacement routes for superseded documents;
- Markdown links and exact GitHub-style heading anchors;
- declared `scope` globs (patterns that match no files, same-kind overlaps between active authorities);
- `reviewed` attestations (scoped files changed since the attested commit require re-review).

A passing check exits with `0`. Contract failures exit with `1`; invalid CLI usage exits with `2`. Verification commands declared in the manifest are validated but not executed.

## Run it in CI

Add a package script:

```json
{
  "scripts": {
    "knowledge:check": "muninn check ."
  }
}
```

Then run it with the rest of your checks:

```yaml
- uses: oven-sh/setup-bun@v2
  with:
    bun-version: 1.3.14
- run: bun install --frozen-lockfile
- run: bun run knowledge:check
```

## CLI

| Command                        | Purpose                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `muninn init [root]`           | Create a minimal contract; opt into `--template full\|<dir>` and `--obsidian`. |
| `muninn check [root]`          | Validate a repository offline.                                                 |
| `muninn default --path`        | Print the installed path to the default contract.                              |
| `muninn setup-prompt [--path]` | Print the setup prompt or its installed path.                                  |

Run `npx muninn --help` for external-check and custom-manifest options. The TypeScript API is available through the package’s main export.

## Reference

- [Default contract, manifest, and authority lifecycle](https://unpkg.com/@rasmushjulskov/muninn@0.1.1/DEFAULT.md)
- [One-time setup prompt for existing repositories](https://unpkg.com/@rasmushjulskov/muninn@0.1.1/SETUP_PROMPT.md)

## Contributing and security

Public issues and pull requests are welcome; see [CONTRIBUTING.md](https://github.com/rasmushjulskov/muninn/blob/main/CONTRIBUTING.md) for the private-canonical/public-snapshot contribution flow. Report vulnerabilities through the process in [SECURITY.md](https://github.com/rasmushjulskov/muninn/blob/main/SECURITY.md), not a public issue.

## License

MIT

# Muninn default project knowledge structure

Status: canonical

This file defines Muninn's default project-knowledge shape. It defines where knowledge belongs and how it is routed; it does not supply facts about any particular repository.

A setup agent must combine this structure with the target repository's live knowledge. Existing authoritative documents stay authoritative in place when they already satisfy a role.

## Design principles

1. One obvious route for humans, one for agents, and one machine-readable map.
2. A small required core; additional collections appear only when real material exists.
3. Existing knowledge is linked and classified, not copied into parallel documents.
4. Current guidance is visibly separated from proposals and history.
5. A repository cannot become valid by hiding or archiving all of its knowledge.
6. Documentation stays portable Markdown: Git and GitHub are the durable source of truth, while editors such as Obsidian may navigate the same checked files without owning the format.

## Target structure

`muninn init` creates only the small required core: `README.md`, `docs/README.md`, and `docs/knowledge.yaml`. Use `muninn init --template full` to explicitly scaffold every placeholder role below. Custom template directories remain available for repositories with another established shape.

```text
README.md                 human entrypoint
AGENTS.md                 concise agent router
.gitignore                optional editor exclusion with --obsidian
docs/
  README.md               direct map of current project knowledge
  product.md              users, promise, scope, language, non-goals
  architecture.md         system, ownership, data flow, constraints
  development.md          setup, repository map, checks, workflow
  operations.md           environments, release, observability, recovery
  decisions/
    README.md              accepted and proposed decision index
  knowledge.yaml          machine-readable authority map
```

For an existing repository, these are roles rather than mandatory filenames. A strong existing `CONTEXT.md`, `CONCEPTS.md`, `UBIQUITOUS_LANGUAGE.md`, architecture guide, runbook, or decision index may satisfy a role without being moved or duplicated. `docs/README.md` and `docs/knowledge.yaml` route to those files.

## Portable Markdown and Obsidian

The repository root is the vault boundary when the project is opened in Obsidian. This keeps root authorities such as `README.md`, `AGENTS.md`, and any repository-specific setup or contract files in the same navigation surface as `docs/`.

Canonical navigation uses ordinary relative Markdown links that render on GitHub and resolve in Obsidian. Wikilinks, embeds, block IDs, plugin queries, community plugins, and committed workspace state must not be required to find or validate project knowledge. Purposeful inline links or a concise `Related` section may connect nearby authorities; avoid ceremonial links or duplicated truth.

Obsidian's `.obsidian/` directory is local editor state rather than project knowledge. Initialization leaves `.gitignore` unchanged unless the caller explicitly selects `--obsidian`. With that option, Muninn preserves existing bytes and rule order, appends `.obsidian/` only when absent, and does not duplicate it on later runs.

## Entrypoints

### `README.md`

The human entrypoint contains:

- project name and one-sentence promise;
- shortest working start path;
- canonical validation command;
- a visible link to `docs/README.md`.

It remains concise. Detailed product, architecture, development, and operational knowledge belongs in the indexed authorities.

### `AGENTS.md`

The agent entrypoint contains:

- a visible route to `docs/README.md`;
- a concise repository map;
- repository-owned validation routes;
- project-specific safety and scope constraints.

It routes rather than duplicating long authorities. Existing richer instructions are preserved and tightened, not replaced blindly. Tool-specific adapters may point to this file, but they do not become competing sources of truth.

### `docs/README.md`

The knowledge index directly links every current `canonical`, `accepted`, or `proposed` Markdown document under `docs/`, plus active root authorities. The index does not need to link itself, even when the manifest lists it as an active authority. It groups links by:

1. Start here;
2. Product and domain;
3. Architecture;
4. Development;
5. Operations;
6. Decisions;
7. Working documents;
8. History.

Direct links are intentional: a reader should not need to crawl a chain of indexes to discover current authority.

## Core authority contracts

### Product

The product authority records:

- purpose;
- users and jobs;
- narrow promise;
- current scope and explicit non-goals;
- canonical domain language;
- observable success and known limits.

### Architecture

The architecture authority records:

- components and responsibilities;
- ownership of truth and side effects;
- primary data and control flows;
- runtimes and external dependencies;
- security, privacy, and credential boundaries;
- non-negotiable constraints.

### Development

The development authority records:

- required tools and versions;
- reproducible setup;
- repository map;
- canonical and focused validation commands;
- branch, worktree, review, and handoff expectations;
- generated or protected files.

### Operations

The operations authority records:

- environments;
- supported run and build paths;
- release and deployment gates;
- configuration surfaces without secret values;
- logs, metrics, traces, and health signals;
- incident diagnosis, recovery, and rollback.

A library or static artifact may state that it has no deployed runtime. The file should explain the real operational boundary rather than inventing infrastructure.

### Decisions

The decision index links durable choices that future maintainers need to understand. Each decision should identify context, chosen direction, rejected alternatives, consequences, evidence, approval state, and replacement when superseded.

## Optional collections

Create these only when real content exists:

- `docs/proposals/` — consequential directions awaiting approval;
- `docs/plans/` — bounded implementation plans;
- `docs/guides/` — repeatable task guidance;
- `docs/solutions/` — reusable solutions to observed problems;
- `docs/archive/` — retained history that no longer guides current work.

Do not create empty folders or ceremonial indexes.

## Lifecycle

Every Markdown document under `docs/` has one supported lifecycle line near its title:

- `Status: canonical` — current source of truth;
- `Status: accepted` — approved decision or contract;
- `Status: proposed` — current but unapproved;
- `Status: superseded` — replaced by a named active document;
- `Status: archived` — retained history, not current guidance.

When status is uncertain, use `proposed`, keep the document visible, and report the unresolved classification. Never use `archived` merely to make validation pass.

## Default manifest

```yaml
version: 1
entrypoints:
  human: README.md
  agent: AGENTS.md
  index: docs/README.md
authorities:
  - path: docs/product.md
    status: active
  - path: docs/architecture.md
    status: active
  - path: docs/development.md
    status: active
  - path: docs/operations.md
    status: active
  - path: docs/decisions/README.md
    status: active
verification: []
```

For an existing repository, replace these paths with its actual authorities. Populate `verification` only from commands the repository already owns.

## Optional authority fields

Each authority may additionally declare what it governs, what kind of claim it makes, and when it was last verified:

```yaml
- path: docs/payments.md
  status: active
  kind: constraint
  scope: [src/payments/**]
  reviewed: 9a018a9
```

- `kind` — the claim the document makes: `constraint` (must be obeyed), `decision` (why a direction was chosen), `guide` (how to do a task), `reference` (descriptive facts), or `plan` (bounded future work, not a promise). Two active authorities of the same kind may not cover the same file.
- `scope` — repository-relative glob patterns naming the files the document governs. Every pattern must match at least one existing file. Agents should read every active authority whose scope covers a file before changing it.
- `reviewed` — a full or abbreviated git commit SHA attesting that the document was verified against its scoped files at that commit. Requires `scope`. The check fails when scoped files or the document itself changed after the attested commit; re-verify and update `reviewed`, or supersede the document. Never advance `reviewed` without actually re-reading the document against the current code.

## Adoption invariants

A valid adoption must prove:

- existing files and unrelated work were preserved;
- human and agent entrypoints visibly route to the knowledge index;
- every current document is directly indexed;
- the manifest contains at least one meaningful active authority;
- superseded authorities name active replacements;
- uncertain knowledge remains visible as proposed;
- initialization is idempotent;
- existing ignore rules are untouched unless Obsidian support is explicitly selected, in which case `.obsidian/` is excluded exactly once;
- canonical navigation works with portable relative Markdown links from the repository root;
- changing all documents to archived cannot produce a passing check;
- no commit, push, publication, deployment, or external mutation occurred without separate authority.

A green result obtained by hiding, omitting, or misclassifying current knowledge is a failed adoption.

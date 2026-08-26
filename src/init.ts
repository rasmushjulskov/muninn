import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import { inside, repositoryFiles } from "./paths";

export interface InitResult {
  created: string[];
  skipped: string[];
}

export interface InitOptions {
  template?: string | undefined;
  obsidian?: boolean | undefined;
}

const fullManifest = `version: 1
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
`;

const placeholderNotice =
  "TODO: replace every placeholder with facts from this repository, then promote to canonical.\n";

const obsidianIgnore = ".obsidian/";

const fullFiles: ReadonlyArray<[string, string]> = [
  [
    "README.md",
    `# Project

TODO: one-sentence promise.

## Start

TODO: shortest working start path.

## Validate

TODO: canonical validation command.

## Knowledge

Current project knowledge is indexed in [docs/README.md](docs/README.md).
`,
  ],
  [
    "AGENTS.md",
    `# Agent guide

Read the [project knowledge index](docs/README.md) before changing anything.

## Repository map

TODO: concise repository map.

## Validation

TODO: repository-owned validation commands.

## Constraints

TODO: project-specific safety and scope constraints.
`,
  ],
  [
    "docs/README.md",
    `# Project knowledge

Status: canonical

Direct routes to every current authority.

## Start here

- [Project README](../README.md) — human entrypoint and shortest working start path
- [Agent guide](../AGENTS.md) — repository routes, validation, and constraints

## Current authorities

- [Product](product.md) — users, promise, scope, language, non-goals
- [Architecture](architecture.md) — system, ownership, data flow, constraints
- [Development](development.md) — setup, repository map, checks, workflow
- [Operations](operations.md) — environments, release, observability, recovery
- [Decisions](decisions/README.md) — accepted and proposed decisions
`,
  ],
  [
    "docs/product.md",
    `# Product

Status: proposed

${placeholderNotice}
## Purpose

TODO

## Users and jobs

TODO

## Promise

TODO

## Scope and non-goals

TODO

## Domain language

TODO

## Success and limits

TODO

## Related

- [Project knowledge](README.md)
- [Architecture](architecture.md)
`,
  ],
  [
    "docs/architecture.md",
    `# Architecture

Status: proposed

${placeholderNotice}
## Components and responsibilities

TODO

## Ownership and side effects

TODO

## Data and control flow

TODO

## Runtimes and dependencies

TODO

## Security and privacy boundaries

TODO

## Constraints

TODO

## Related

- [Project knowledge](README.md)
- [Product](product.md)
- [Development](development.md)
`,
  ],
  [
    "docs/development.md",
    `# Development

Status: proposed

${placeholderNotice}
## Tools and versions

TODO

## Setup

TODO

## Repository map

TODO

## Validation

TODO

## Workflow

TODO

## Generated and protected files

TODO

## Related

- [Project knowledge](README.md)
- [Architecture](architecture.md)
- [Operations](operations.md)
`,
  ],
  [
    "docs/operations.md",
    `# Operations

Status: proposed

${placeholderNotice}
## Environments

TODO

## Run and build paths

TODO

## Release gates

TODO

## Configuration

TODO

## Observability

TODO

## Incident response

TODO

## Related

- [Project knowledge](README.md)
- [Development](development.md)
- [Decisions](decisions/README.md)
`,
  ],
  [
    "docs/decisions/README.md",
    `# Decisions

Status: canonical

No decisions are recorded yet. Add one file per durable decision and link it here.

## Related

- [Project knowledge](../README.md)
- [Product](../product.md)
`,
  ],
  ["docs/knowledge.yaml", fullManifest],
];

const minimalManifest = `version: 1
entrypoints:
  human: README.md
  agent: README.md
  index: docs/README.md
authorities:
  - path: docs/README.md
    status: active
verification: []
`;

const minimalFiles: ReadonlyArray<[string, string]> = [
  ["README.md", "# Project\n\n[Project knowledge](docs/README.md)\n"],
  ["docs/README.md", "# Project knowledge\n\nStatus: canonical\n"],
  ["docs/knowledge.yaml", minimalManifest],
];

function templateFiles(template: string): ReadonlyArray<[string, string]> {
  if (template === "full") return fullFiles;
  if (template === "minimal") return minimalFiles;
  const directory = resolve(template);
  const status = statSync(directory, { throwIfNoEntry: false });
  if (!status?.isDirectory()) {
    throw new Error(`${template}: template must be "full", "minimal", or a directory`);
  }
  const names = repositoryFiles(directory);
  if (names.length === 0) throw new Error(`${template}: template directory contains no files`);
  return names.map((name) => [name, readFileSync(resolve(directory, name), "utf8")]);
}

function displayPath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function preflightPath(root: string, name: string): void {
  const parts = name.split("/");
  let path = root;
  for (const part of parts.slice(0, -1)) {
    path = resolve(path, part);
    const status = lstatSync(path, { throwIfNoEntry: false });
    if (!status) continue;
    if (status.isSymbolicLink()) {
      throw new Error(`${displayPath(root, path)}: path component must not be a symlink`);
    }
    if (!status.isDirectory()) {
      throw new Error(`${displayPath(root, path)}: path component must be a directory`);
    }
  }
  const target = resolve(root, name);
  if (lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error(`${name}: existing path must not be a symlink`);
  }
}

function ensureObsidianIgnored(path: string): void {
  const contents = readFileSync(path, "utf8");
  if (contents.split(/\r?\n/).includes(obsidianIgnore)) return;
  const lineEnding = contents.includes("\r\n") ? "\r\n" : "\n";
  const separator = contents.length === 0 || contents.endsWith("\n") ? "" : lineEnding;
  appendFileSync(path, `${separator}${obsidianIgnore}${lineEnding}`);
}

export function initializeKnowledge(root: string, options: InitOptions = {}): InitResult {
  const template = options.template ?? "minimal";
  const selectedFiles = templateFiles(template);
  const files =
    options.obsidian && !selectedFiles.some(([name]) => name === ".gitignore")
      ? [...selectedFiles, [".gitignore", `${obsidianIgnore}\n`] as [string, string]]
      : selectedFiles;
  const repositoryRoot = resolve(root);
  mkdirSync(repositoryRoot, { recursive: true });
  const canonicalRoot = realpathSync(repositoryRoot);
  for (const [name] of files) preflightPath(canonicalRoot, name);
  const result: InitResult = { created: [], skipped: [] };
  for (const [name, contents] of files) {
    const path = resolve(canonicalRoot, name);
    if (existsSync(path)) {
      if (options.obsidian && name === ".gitignore") ensureObsidianIgnored(path);
      result.skipped.push(name);
      continue;
    }
    const parent = dirname(path);
    mkdirSync(parent, { recursive: true });
    if (!inside(canonicalRoot, realpathSync(parent))) {
      throw new Error(`${name}: parent path escapes repository root`);
    }
    writeFileSync(path, contents, { flag: "wx" });
    if (options.obsidian && name === ".gitignore") ensureObsidianIgnored(path);
    result.created.push(name);
  }
  return result;
}

export function knowledgeTemplate(): string {
  return minimalManifest;
}

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { externalFailures } from "./external";
import { loadKnowledgeManifest, manifestFailures } from "./manifest";
import {
  documentHeader,
  linkedPaths,
  linkTargets,
  markdownFailures,
  resolvedTargets,
  visibleProse,
} from "./markdown";
import { casingFailure, inside, markdownFiles, repositoryName } from "./paths";
import { reviewedFailures, scopeFailures } from "./scope";
import type { Authority, ExternalOptions, KnowledgeManifest } from "./types";

export interface CheckOptions {
  external?: boolean;
  externalOptions?: ExternalOptions;
  manifest?: string;
}

function requiredPathFailures(root: string, name: string): string[] {
  const path = resolve(root, name);
  if (!inside(root, path)) return [`${name}: required path escapes repository root`];
  const casing = casingFailure(root, path);
  if (casing) return [`${name}: invalid path (${casing})`];
  if (!existsSync(path)) return [`${name}: required path is missing`];
  if (!inside(realpathSync(root), realpathSync(path))) {
    return [`${name}: required path escapes repository root`];
  }
  return statSync(path).isFile() ? [] : [`${name}: required path must be a file`];
}

function validRequiredPath(root: string, name: string): boolean {
  return requiredPathFailures(root, name).length === 0;
}

function routeFailures(root: string, manifest: KnowledgeManifest): string[] {
  if (!validRequiredPath(root, manifest.entrypoints.index)) return [];
  const index = resolve(root, manifest.entrypoints.index);
  const indexed = linkedPaths(root, manifest.entrypoints.index);
  const failures = manifest.authorities.flatMap((authority) =>
    authority.status === "active" &&
    resolve(root, authority.path) !== index &&
    !indexed.has(resolve(root, authority.path))
      ? [`${authority.path}: active authority is missing from ${manifest.entrypoints.index}`]
      : [],
  );
  if (
    validRequiredPath(root, manifest.entrypoints.human) &&
    !routesTo(root, manifest.entrypoints.human, [manifest.entrypoints.index])
  ) {
    failures.push(`${manifest.entrypoints.human}: does not route to ${manifest.entrypoints.index}`);
  }
  if (
    validRequiredPath(root, manifest.entrypoints.agent) &&
    !routesTo(root, manifest.entrypoints.agent, [
      manifest.entrypoints.human,
      manifest.entrypoints.index,
    ])
  ) {
    failures.push(`${manifest.entrypoints.agent}: does not route to a knowledge entrypoint`);
  }
  return failures;
}

function mentionsPath(prose: string, destination: string): boolean {
  const escaped = destination.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w./-])${escaped}(?![\\w/-])`).test(prose);
}

function routesTo(root: string, source: string, destinations: string[]): boolean {
  const file = resolve(root, source);
  const links = linkedPaths(root, source);
  const prose = visibleProse(readFileSync(file, "utf8"));
  return destinations.some(
    (destination) => links.has(resolve(root, destination)) || mentionsPath(prose, destination),
  );
}

function dependencyFailures(root: string, manifest: KnowledgeManifest): string[] {
  const archived = new Set(
    manifest.authorities
      .filter((item) => item.status === "archived")
      .map((item) => resolve(root, item.path)),
  );
  return manifest.authorities
    .filter((item) => item.status === "active" && validRequiredPath(root, item.path))
    .flatMap((item) =>
      resolvedTargets(root, resolve(root, item.path)).flatMap((target) =>
        target.path && archived.has(target.path)
          ? [
              `${item.path}: active authority depends on archived authority ${repositoryName(root, target.path)}`,
            ]
          : [],
      ),
    );
}

function authorityFailures(root: string, manifest: KnowledgeManifest): string[] {
  const required = [
    manifest.entrypoints.human,
    manifest.entrypoints.agent,
    manifest.entrypoints.index,
    ...manifest.authorities.map((item) => item.path),
  ];
  return [
    ...[...new Set(required)].flatMap((name) => requiredPathFailures(root, name)),
    ...manifest.authorities.flatMap((authority) =>
      validRequiredPath(root, authority.path) ? lifecycleFailures(root, authority) : [],
    ),
  ];
}

function lifecycleFailures(root: string, authority: Authority): string[] {
  const path = resolve(root, authority.path);
  if (!existsSync(path)) return [];
  const header = documentHeader(readFileSync(path, "utf8"));
  const documentStatus = /^Status: ([a-z]+)[ \t]*$/m.exec(header)?.[1];
  const expected =
    authority.status === "active" ? ["canonical", "proposed", "accepted"] : [authority.status];
  return documentStatus && expected.includes(documentStatus)
    ? []
    : [
        `${authority.path}: document status ${documentStatus ?? "missing"} conflicts with manifest status ${authority.status}`,
      ];
}

function documentationFailures(root: string, manifest: KnowledgeManifest): string[] {
  const index = {
    name: manifest.entrypoints.index,
    paths: linkedPaths(root, manifest.entrypoints.index),
  };
  return markdownFiles(root).flatMap((file) => markdownFailures(root, file, index));
}

function externalLocations(root: string): Map<string, Set<string>> {
  const locations = new Map<string, Set<string>>();
  for (const file of markdownFiles(root)) {
    const name = repositoryName(root, file);
    if (name.startsWith("docs/archive/")) continue;
    for (const target of linkTargets(readFileSync(file, "utf8"))) {
      if (!/^(?:https?:)?\/\//i.test(target)) continue;
      const url = target.startsWith("//") ? `https:${target}` : target;
      const sources = locations.get(url) ?? new Set<string>();
      sources.add(name);
      locations.set(url, sources);
    }
  }
  return locations;
}

export async function checkDocumentation(
  root: string,
  options: CheckOptions = {},
): Promise<string[]> {
  const repositoryRoot = resolve(root);
  const loaded = loadKnowledgeManifest(repositoryRoot, options.manifest);
  if (!loaded.manifest) return loaded.failures;
  const manifest = loaded.manifest;
  const failures = [
    ...loaded.failures,
    ...manifestFailures(manifest, options.manifest),
    ...authorityFailures(repositoryRoot, manifest),
    ...routeFailures(repositoryRoot, manifest),
    ...dependencyFailures(repositoryRoot, manifest),
    ...documentationFailures(repositoryRoot, manifest),
    ...scopeFailures(repositoryRoot, manifest),
    ...reviewedFailures(repositoryRoot, manifest),
  ];
  if (options.external) {
    failures.push(
      ...(await externalFailures(externalLocations(repositoryRoot), options.externalOptions)),
    );
  }
  return [...new Set(failures)].sort();
}

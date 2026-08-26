import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { parse as parseYaml } from "yaml";

import {
  authorityKinds,
  authorityStatuses,
  type Authority,
  type AuthorityKind,
  type KnowledgeManifest,
} from "./types";

const defaultManifest = "docs/knowledge.yaml";
type Verification = KnowledgeManifest["verification"][number];

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function unknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): string[] {
  return Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .sort()
    .map((key) => `${path}${path ? "." : ""}${key}: unknown field`);
}

function pathValue(value: unknown, path: string, failures: string[]): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes("\\") ||
    value.split("/").includes("..")
  ) {
    failures.push(`${path}: must be a non-empty repository-relative path`);
    return undefined;
  }
  return value;
}

function globValue(value: unknown, path: string, failures: string[]): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes("\\") ||
    value.split("/").includes("..")
  ) {
    failures.push(`${path}: must be a repository-relative glob pattern`);
    return undefined;
  }
  return value;
}

function scopeValue(value: unknown, path: string, failures: string[]): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    failures.push(`${path}: must be a non-empty array of glob patterns`);
    return undefined;
  }
  const patterns = value.map((item, index) => globValue(item, `${path}[${index}]`, failures));
  return patterns.some((pattern) => !pattern) ? undefined : (patterns as string[]);
}

function reviewedValue(value: unknown, path: string, failures: string[]): string | undefined {
  if (typeof value !== "string" || !/^[0-9a-f]{7,40}$/.test(value)) {
    failures.push(`${path}: must be a full or abbreviated git commit SHA`);
    return undefined;
  }
  return value;
}

function authority(value: unknown, index: number, failures: string[]): Authority | undefined {
  const prefix = `authorities[${index}]`;
  const item = record(value);
  if (!item) {
    failures.push(`${prefix}: must be a mapping`);
    return undefined;
  }
  failures.push(
    ...unknownKeys(item, ["path", "status", "replacement", "kind", "scope", "reviewed"], prefix),
  );
  const path = pathValue(item.path, `${prefix}.path`, failures);
  const status = item.status;
  const validStatus = typeof status === "string" && authorityStatuses.includes(status as never);
  if (!validStatus) {
    failures.push(`${prefix}.status: must be one of ${authorityStatuses.join(", ")}`);
  }
  const validKind =
    item.kind === undefined ||
    (typeof item.kind === "string" && authorityKinds.includes(item.kind as never));
  if (!validKind) {
    failures.push(`${prefix}.kind: must be one of ${authorityKinds.join(", ")}`);
  }
  const replacement =
    item.replacement === undefined
      ? undefined
      : pathValue(item.replacement, `${prefix}.replacement`, failures);
  const scope =
    item.scope === undefined ? undefined : scopeValue(item.scope, `${prefix}.scope`, failures);
  const reviewed =
    item.reviewed === undefined
      ? undefined
      : reviewedValue(item.reviewed, `${prefix}.reviewed`, failures);
  if (!path || !validStatus || !validKind) return undefined;
  if (item.replacement !== undefined && !replacement) return undefined;
  if (item.scope !== undefined && !scope) return undefined;
  if (item.reviewed !== undefined && !reviewed) return undefined;
  return {
    path,
    status: status as Authority["status"],
    ...(replacement ? { replacement } : {}),
    ...(item.kind === undefined ? {} : { kind: item.kind as AuthorityKind }),
    ...(scope ? { scope } : {}),
    ...(reviewed ? { reviewed } : {}),
  };
}

function command(value: unknown, index: number, failures: string[]): Verification | undefined {
  const prefix = `verification[${index}]`;
  const item = record(value);
  if (!item) {
    failures.push(`${prefix}: must be a mapping`);
    return undefined;
  }
  failures.push(...unknownKeys(item, ["name", "command"], prefix));
  const validName =
    typeof item.name === "string" && item.name.length > 0 && item.name.trim() === item.name;
  if (!validName) failures.push(`${prefix}.name: must be a non-empty identifier`);
  if (!Array.isArray(item.command)) {
    failures.push(`${prefix}.command: must be an array of non-empty strings`);
    return undefined;
  }
  const validCommand = item.command.every((part) => typeof part === "string" && part.length > 0);
  if (!validCommand) failures.push(`${prefix}.command: must contain only non-empty strings`);
  return validName && validCommand
    ? { name: item.name as string, command: item.command as string[] }
    : undefined;
}

function parseEntrypoints(
  value: unknown,
  failures: string[],
): KnowledgeManifest["entrypoints"] | undefined {
  const entrypoints = record(value);
  if (!entrypoints) {
    failures.push("entrypoints: must be a mapping");
    return undefined;
  }
  failures.push(...unknownKeys(entrypoints, ["human", "agent", "index"], "entrypoints"));
  const human = pathValue(entrypoints.human, "entrypoints.human", failures);
  const agent = pathValue(entrypoints.agent, "entrypoints.agent", failures);
  const index = pathValue(entrypoints.index, "entrypoints.index", failures);
  return human && agent && index ? { human, agent, index } : undefined;
}

function duplicates(values: string[]): string[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function parseAuthorities(value: unknown, failures: string[]): Authority[] | undefined {
  if (!Array.isArray(value)) {
    failures.push("authorities: must be an array");
    return undefined;
  }
  const parsed = value.map((item, index) => authority(item, index, failures));
  for (const path of duplicates(parsed.flatMap((item) => (item ? [item.path] : [])))) {
    failures.push(`authorities: duplicate path ${path}`);
  }
  return parsed.some((item) => !item) ? undefined : (parsed as Authority[]);
}

function parseCommands(
  value: unknown,
  failures: string[],
): KnowledgeManifest["verification"] | undefined {
  if (!Array.isArray(value)) {
    failures.push("verification: must be an array");
    return undefined;
  }
  const parsed = value.map((item, index) => command(item, index, failures));
  for (const name of duplicates(parsed.flatMap((item) => (item ? [item.name] : [])))) {
    failures.push(`verification: duplicate name ${name}`);
  }
  return parsed.some((item) => !item) ? undefined : (parsed as KnowledgeManifest["verification"]);
}

function parseManifest(raw: unknown): { manifest?: KnowledgeManifest; failures: string[] } {
  const failures: string[] = [];
  const value = record(raw);
  if (!value) return { failures: ["manifest: must be a mapping"] };
  failures.push(
    ...unknownKeys(value, ["version", "entrypoints", "authorities", "verification"], ""),
  );
  if (value.version !== 1) failures.push("version: must be 1");
  const entrypoints = parseEntrypoints(value.entrypoints, failures);
  const authorities = parseAuthorities(value.authorities, failures);
  const verification = parseCommands(value.verification, failures);
  if (value.version !== 1 || !entrypoints || !authorities || !verification || failures.length) {
    return { failures };
  }
  return { manifest: { version: 1, entrypoints, authorities, verification }, failures: [] };
}

function escapesRoot(root: string, path: string): boolean {
  const name = relative(root, path);
  return name === ".." || name.startsWith(`..${sep}`) || isAbsolute(name);
}

export function loadKnowledgeManifest(
  root: string,
  manifestName = defaultManifest,
): { manifest?: KnowledgeManifest; failures: string[] } {
  const repositoryRoot = resolve(root);
  const path = resolve(repositoryRoot, manifestName);
  if (escapesRoot(repositoryRoot, path)) {
    return { failures: [`${manifestName}: manifest path escapes repository root`] };
  }
  if (!existsSync(path)) return { failures: [`${manifestName}: missing knowledge manifest`] };
  try {
    if (escapesRoot(realpathSync(repositoryRoot), realpathSync(path))) {
      return { failures: [`${manifestName}: manifest path escapes repository root`] };
    }
    if (!statSync(path).isFile()) return { failures: [`${manifestName}: manifest must be a file`] };
    const parsed = parseManifest(parseYaml(readFileSync(path, "utf8")));
    return parsed.manifest
      ? parsed
      : { failures: parsed.failures.map((failure) => `${manifestName}: ${failure}`) };
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return { failures: [`${manifestName}: invalid YAML (${detail})`] };
  }
}

export function manifestFailures(
  manifest: KnowledgeManifest,
  manifestName = defaultManifest,
): string[] {
  const failures: string[] = [];
  if (!manifest.authorities.some((item) => item.status === "active")) {
    failures.push(`${manifestName}: at least one active authority is required`);
  }
  const paths = new Set<string>();
  for (const item of manifest.authorities) {
    if (paths.has(item.path)) failures.push(`${manifestName}: duplicate authority ${item.path}`);
    paths.add(item.path);
    if (item.status === "superseded" && !item.replacement) {
      failures.push(`${manifestName}: superseded authority ${item.path} needs a replacement`);
    }
    if (item.status !== "superseded" && item.replacement) {
      failures.push(`${manifestName}: ${item.path} may not declare a replacement`);
    }
    if (item.reviewed && !item.scope) {
      failures.push(`${manifestName}: ${item.path} reviewed attestation requires a scope`);
    }
  }
  for (const item of manifest.authorities.filter((value) => value.replacement)) {
    const replacement = manifest.authorities.find((value) => value.path === item.replacement);
    if (!replacement || replacement.status !== "active") {
      failures.push(`${manifestName}: ${item.path} replacement must be an active authority`);
    }
  }
  return failures;
}

import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import type { ResolvedLink } from "./types";

export function inside(root: string, path: string): boolean {
  const name = relative(root, path);
  return name === "" || (!name.startsWith(`..${sep}`) && name !== ".." && !name.startsWith(sep));
}

export function repositoryName(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function decodedTarget(target: string): { path: string; fragment?: string } | { error: string } {
  const hash = target.indexOf("#");
  const beforeHash = hash === -1 ? target : target.slice(0, hash);
  const query = beforeHash.indexOf("?");
  const encodedPath = query === -1 ? beforeHash : beforeHash.slice(0, query);
  const encodedFragment = hash === -1 ? undefined : target.slice(hash + 1);
  try {
    return {
      path: decodeURIComponent(encodedPath),
      ...(encodedFragment === undefined ? {} : { fragment: decodeURIComponent(encodedFragment) }),
    };
  } catch {
    return { error: `invalid encoded link target ${target}` };
  }
}

function externalLink(target: string): ResolvedLink | undefined {
  if (/^(?:https?:)?\/\//i.test(target)) {
    const external = target.startsWith("//") ? `https:${target}` : target;
    return { external };
  }
  return /^[a-z][a-z\d+.-]*:/i.test(target) ? {} : undefined;
}

function localPath(root: string, file: string, path: string): string {
  if (path.startsWith("/")) return resolve(root, path.slice(1));
  return path ? resolve(dirname(file), path) : file;
}

export function resolveLink(root: string, file: string, target: string): ResolvedLink {
  const external = externalLink(target);
  if (external) return external;
  const decoded = decodedTarget(target);
  if ("error" in decoded) return decoded;
  const path = localPath(root, file, decoded.path);
  if (!inside(root, path)) return { error: `local link escapes repository root ${target}` };
  if (existsSync(path) && !inside(realpathSync(root), realpathSync(path))) {
    return { error: `local link escapes repository root ${target}` };
  }
  return { path, ...(decoded.fragment === undefined ? {} : { fragment: decoded.fragment }) };
}

export function casingFailure(root: string, path: string): string | undefined {
  if (!inside(root, path)) return "outside repository";
  const parts = relative(root, path).split(sep).filter(Boolean);
  let directory = root;
  for (const part of parts) {
    if (!existsSync(directory)) return undefined;
    if (!inside(realpathSync(root), realpathSync(directory))) return "outside repository";
    if (!statSync(directory).isDirectory()) {
      return `path component ${repositoryName(root, directory)} is not a directory`;
    }
    const entries = readdirSync(directory);
    if (!entries.includes(part)) {
      const match = entries.find((entry) => entry.toLowerCase() === part.toLowerCase());
      return match ? `path casing differs at ${part}; Git tree has ${match}` : undefined;
    }
    directory = resolve(directory, part);
  }
  return undefined;
}

export function markdownFiles(root: string): string[] {
  const files: string[] = [];
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
    }
  }
  visit(root);
  return files.sort();
}

export function repositoryFiles(root: string): string[] {
  const files: string[] = [];
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(repositoryName(root, path));
    }
  }
  visit(root);
  return files.sort();
}

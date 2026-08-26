import { spawnSync } from "node:child_process";

import picomatch from "picomatch";

import { repositoryFiles } from "./paths";
import type { KnowledgeManifest } from "./types";

type Matcher = (file: string) => boolean;

function compile(scope: string[] | undefined): Matcher[] {
  return (scope ?? []).map((pattern) => picomatch(pattern, { dot: true }));
}

function coveredFiles(globs: Matcher[], files: string[]): Set<string> {
  return new Set(files.filter((file) => globs.some((glob) => glob(file))));
}

export function scopeFailures(root: string, manifest: KnowledgeManifest): string[] {
  const files = repositoryFiles(root);
  const failures = manifest.authorities.flatMap((authority) =>
    (authority.scope ?? []).flatMap((pattern) => {
      const glob = picomatch(pattern, { dot: true });
      return files.some((file) => glob(file))
        ? []
        : [`${authority.path}: scope pattern ${pattern} matches no files`];
    }),
  );
  const scoped = manifest.authorities
    .filter((authority) => authority.status === "active" && authority.scope)
    .map((authority) => ({ authority, covered: coveredFiles(compile(authority.scope), files) }));
  for (const [index, { authority, covered }] of scoped.entries()) {
    for (const other of scoped.slice(index + 1)) {
      if (authority.kind !== other.authority.kind) continue;
      const shared = [...other.covered].filter((file) => covered.has(file)).sort();
      if (shared.length === 0) continue;
      const kind = authority.kind ? `${authority.kind} ` : "";
      failures.push(
        `${authority.path}: scope overlaps ${other.authority.path} (both active ${kind}authorities cover ${shared[0]})`,
      );
    }
  }
  return failures;
}

function git(root: string, args: string[]): { ok: boolean; stdout: string } {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return { ok: result.status === 0, stdout: result.stdout ?? "" };
}

export function reviewedFailures(root: string, manifest: KnowledgeManifest): string[] {
  const reviewed = manifest.authorities.filter(
    (authority) => authority.status === "active" && authority.reviewed && authority.scope,
  );
  if (reviewed.length === 0) return [];
  if (!git(root, ["rev-parse", "--is-inside-work-tree"]).ok) {
    return reviewed.map(
      (authority) => `${authority.path}: reviewed attestation requires git history`,
    );
  }
  return reviewed.flatMap((authority) => {
    const commit = authority.reviewed as string;
    if (!git(root, ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`]).ok) {
      return [`${authority.path}: reviewed commit ${commit} is not in repository history`];
    }
    if (!git(root, ["merge-base", "--is-ancestor", commit, "HEAD"]).ok) {
      return [`${authority.path}: reviewed commit ${commit} is not an ancestor of HEAD`];
    }
    const diff = git(root, ["diff", "--name-only", "-z", commit, "--"]);
    if (!diff.ok) {
      return [`${authority.path}: reviewed commit ${commit} is not in repository history`];
    }
    const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
    if (!untracked.ok) {
      return [`${authority.path}: reviewed attestation could not inspect repository files`];
    }
    const globs = compile(authority.scope);
    const changed = `${diff.stdout}${untracked.stdout}`
      .split("\0")
      .filter((file) => file && (file === authority.path || globs.some((glob) => glob(file))))
      .sort()
      .filter((file, index, files) => file !== files[index - 1]);
    if (changed.length === 0) return [];
    const listed = changed.slice(0, 3).join(", ") + (changed.length > 3 ? ", …" : "");
    return [`${authority.path}: scope changed since reviewed commit ${commit} (${listed})`];
  });
}

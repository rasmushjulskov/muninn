import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";

import GithubSlugger from "github-slugger";
import { marked, type Token, walkTokens } from "marked";

import { indexedStatusFailures } from "./status";
import { casingFailure, inside, repositoryName, resolveLink } from "./paths";

function targets(contents: string, includeImages: boolean): string[] {
  const targets: string[] = [];
  walkTokens(marked.lexer(contents), (token) => {
    if (token.type === "link" || (includeImages && token.type === "image")) {
      targets.push(token.href);
    }
  });
  return targets;
}

export function linkTargets(contents: string): string[] {
  return targets(contents, true);
}

export function visibleProse(contents: string): string {
  const text: string[] = [];
  walkTokens(marked.lexer(contents), (token) => {
    if (token.type === "text" || token.type === "codespan") text.push(token.text);
  });
  return text.join("\n");
}

function inlineText(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if ("tokens" in token && token.tokens) return inlineText(token.tokens);
      return "text" in token && typeof token.text === "string" ? token.text : "";
    })
    .join("");
}

function visibleMarkdown(contents: string): string {
  return marked
    .lexer(contents)
    .map((token) =>
      token.type === "code" || token.type === "html"
        ? "\n".repeat(token.raw.split("\n").length - 1)
        : token.raw,
    )
    .join("");
}

export function documentHeader(contents: string): string {
  return visibleMarkdown(contents).split("\n").slice(0, 12).join("\n");
}

function headingIds(file: string): Set<string> {
  const slugger = new GithubSlugger();
  const ids = new Set<string>();
  walkTokens(marked.lexer(readFileSync(file, "utf8")), (token) => {
    if (token.type === "heading") ids.add(slugger.slug(inlineText(token.tokens ?? [])));
  });
  return ids;
}

function openingFence(line: string): string | undefined {
  const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  const marker = opening?.[1];
  if (!marker || (marker[0] === "`" && opening?.[2]?.includes("`"))) return undefined;
  return marker;
}

function hasUnclosedFence(contents: string): boolean {
  let marker: string | undefined;
  for (const line of contents.split("\n")) {
    if (!marker) marker = openingFence(line);
    else {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
      if (closing && closing[0] === marker[0] && closing.length >= marker.length)
        marker = undefined;
    }
  }
  return marker !== undefined;
}

function statusFailures(
  name: string,
  file: string,
  contents: string,
  index: { name: string; paths: Set<string> },
): string[] {
  const header = documentHeader(contents);
  if (name === index.name) {
    return /^Status: canonical[ \t]*$/m.test(header)
      ? []
      : [`${name}: index needs a Status: canonical line near its title`];
  }
  if (name.startsWith("docs/") && !name.startsWith("docs/archive/")) {
    return indexedStatusFailures(name, file, header, {
      indexed: index.paths,
      supported: /^Status: (canonical|proposed|accepted|superseded|archived)[ \t]*$/m,
      active: /^Status: (canonical|proposed|accepted)[ \t]*$/m,
      statusMessage: "documentation page needs a supported Status line near its title",
      indexMessage: `missing from ${index.name}`,
    });
  }
  return [];
}

export function resolvedTargets(root: string, file: string): ReturnType<typeof resolveLink>[] {
  if (
    !existsSync(file) ||
    !statSync(file).isFile() ||
    !inside(realpathSync(root), realpathSync(file))
  ) {
    return [];
  }
  return linkTargets(readFileSync(file, "utf8")).map((target) => resolveLink(root, file, target));
}

function linkFailures(root: string, file: string, name: string, target: string): string[] {
  const resolved = resolveLink(root, file, target);
  if (resolved.error) return [`${name}: ${resolved.error}`];
  if (!resolved.path) return [];
  const casing = casingFailure(root, resolved.path);
  if (casing) return [`${name}: invalid local link ${target} (${casing})`];
  if (!existsSync(resolved.path)) return [`${name}: broken local link ${target}`];
  if (!statSync(resolved.path).isFile()) {
    return [`${name}: invalid local link ${target} (target must be a file)`];
  }
  const brokenAnchor =
    resolved.fragment &&
    extname(resolved.path).toLowerCase() === ".md" &&
    !headingIds(resolved.path).has(resolved.fragment);
  return brokenAnchor ? [`${name}: broken local anchor ${target}`] : [];
}

export function markdownFailures(
  root: string,
  file: string,
  index: { name: string; paths: Set<string> },
): string[] {
  const name = repositoryName(root, file);
  const contents = readFileSync(file, "utf8");
  const failures = [
    ...(contents.endsWith("\n") ? [] : [`${name}: missing final newline`]),
    ...(hasUnclosedFence(contents) ? [`${name}: unbalanced code fence`] : []),
    ...statusFailures(name, file, contents, index),
  ];
  if (name.startsWith("docs/archive/")) return failures;
  failures.push(
    ...linkTargets(contents).flatMap((target) => linkFailures(root, file, name, target)),
  );
  return failures;
}

export function linkedPaths(root: string, indexName: string): Set<string> {
  const index = resolve(root, indexName);
  if (
    !existsSync(index) ||
    !statSync(index).isFile() ||
    !inside(realpathSync(root), realpathSync(index))
  ) {
    return new Set();
  }
  return new Set(
    targets(readFileSync(index, "utf8"), false).flatMap((target) => {
      const resolved = resolveLink(root, index, target);
      return resolved.path ? [resolved.path] : [];
    }),
  );
}

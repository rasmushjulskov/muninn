import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { checkDocumentation } from "../src/check";

const roots: string[] = [];

function manifest(authorities = ""): string {
  const entries =
    authorities ||
    "  - path: docs/product.md\n    status: active\n  - path: docs/architecture.md\n    status: active\n  - path: docs/decisions/README.md\n    status: active\n";
  return `version: 1
entrypoints:
  human: README.md
  agent: AGENTS.md
  index: docs/README.md
authorities:
${entries}verification:
  - name: documentation
    command: [bun, run, docs:check]
  - name: merge-gate
    command: [bun, run, check]
`;
}

function fixture(overrides: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "project-knowledge-"));
  roots.push(root);
  const files = {
    "README.md": "# Product\n\n[Documentation](docs/README.md)\n",
    "AGENTS.md": "Read README.md before operating.\n",
    "package.json": JSON.stringify({ scripts: { "docs:check": "true", check: "true" } }),
    "docs/knowledge.yaml": manifest(),
    "docs/README.md":
      "# Documentation\n\nStatus: canonical\n\n[Product](./product.md)\n[Architecture](./architecture.md)\n[Decisions](./decisions/README.md)\n",
    "docs/product.md": "# Product\n\nStatus: canonical\n",
    "docs/architecture.md": "# Architecture\n\nStatus: canonical\n",
    "docs/decisions/README.md": "# Decisions\n\nStatus: canonical\n",
    ...overrides,
  };
  for (const [path, contents] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function expectFailure(root: string, failure: string) {
  expect(await checkDocumentation(root)).toContain(failure);
}

describe("Project Knowledge Contract offline checks", () => {
  test("accepts reference links, images, URI decoding, and GitHub duplicate anchors", async () => {
    const root = fixture({
      "assets/logo.png": "image",
      "docs/README.md":
        "# Documentation\n\nStatus: canonical\n\n[Product][product]\n[Architecture](./architecture.md#details-1)\n![Logo](../assets/logo.png)\n[Decisions](./decisions/README.md)\n\n[product]: ./product%2Emd\n",
      "docs/architecture.md": "# Architecture\n\nStatus: canonical\n\n## Details\n\n## Details\n",
    });
    expect(await checkDocumentation(root)).toEqual([]);
  });

  test("requires a valid manifest and accepts toolchain-agnostic verification commands", async () => {
    const root = fixture({ "docs/knowledge.yaml": "version: 2\n" });
    expect(await checkDocumentation(root)).toContain("docs/knowledge.yaml: version: must be 1");
    writeFileSync(
      join(root, "docs/knowledge.yaml"),
      manifest().replace("[bun, run, check]", "[make, check]"),
    );
    expect(await checkDocumentation(root)).toEqual([]);
    writeFileSync(
      join(root, "docs/knowledge.yaml"),
      manifest().replace("status: active", "status: obsolete"),
    );
    expect((await checkDocumentation(root)).join("\n")).toContain(
      "authorities[0].status: must be one of active, superseded, archived",
    );
  });

  test("rejects zero active authorities, including an all-archived manifest", async () => {
    const root = fixture();
    const noAuthorities = `version: 1
entrypoints:
  human: README.md
  agent: AGENTS.md
  index: docs/README.md
authorities: []
verification: []
`;
    writeFileSync(join(root, "docs/knowledge.yaml"), noAuthorities);
    expect(await checkDocumentation(root)).toContain(
      "docs/knowledge.yaml: at least one active authority is required",
    );

    writeFileSync(
      join(root, "docs/knowledge.yaml"),
      manifest(
        "  - path: docs/product.md\n    status: archived\n  - path: docs/architecture.md\n    status: archived\n  - path: docs/decisions/README.md\n    status: archived\n",
      ),
    );
    for (const name of ["docs/product.md", "docs/architecture.md", "docs/decisions/README.md"]) {
      writeFileSync(join(root, name), "# Archived\n\nStatus: archived\n");
    }
    expect(await checkDocumentation(root)).toContain(
      "docs/knowledge.yaml: at least one active authority is required",
    );
  });

  test("reports lifecycle failures against the selected custom manifest", async () => {
    const root = fixture({
      "config/knowledge.yaml": manifest(
        "  - path: docs/product.md\n    status: active\n  - path: docs/architecture.md\n    status: superseded\n  - path: docs/decisions/README.md\n    status: active\n",
      ),
      "docs/architecture.md": "# Architecture\n\nStatus: superseded\n",
    });

    const failures = await checkDocumentation(root, { manifest: "config/knowledge.yaml" });
    expect(failures).toContain(
      "config/knowledge.yaml: superseded authority docs/architecture.md needs a replacement",
    );
    expect(failures.join("\n")).not.toContain("docs/knowledge.yaml:");
  });

  test("reports zero active authorities against the selected custom manifest", async () => {
    const root = fixture({
      "config/knowledge.yaml": manifest(
        "  - path: docs/product.md\n    status: archived\n  - path: docs/architecture.md\n    status: archived\n  - path: docs/decisions/README.md\n    status: archived\n",
      ),
    });
    for (const name of ["docs/product.md", "docs/architecture.md", "docs/decisions/README.md"]) {
      writeFileSync(join(root, name), "# Archived\n\nStatus: archived\n");
    }

    expect(await checkDocumentation(root, { manifest: "config/knowledge.yaml" })).toContain(
      "config/knowledge.yaml: at least one active authority is required",
    );
  });

  test("rejects unknown and malformed manifest fields with specific paths", async () => {
    const root = fixture({ "docs/knowledge.yaml": `${manifest()}unexpected: true\n` });
    await expectFailure(root, "docs/knowledge.yaml: unexpected: unknown field");

    writeFileSync(
      join(root, "docs/knowledge.yaml"),
      manifest().replace("  human: README.md", "  human: README.md\n  typo: hidden"),
    );
    await expectFailure(root, "docs/knowledge.yaml: entrypoints.typo: unknown field");

    writeFileSync(
      join(root, "docs/knowledge.yaml"),
      manifest().replace("    command: [bun, run, docs:check]", "    command: invalid"),
    );
    await expectFailure(
      root,
      "docs/knowledge.yaml: verification[0].command: must be an array of non-empty strings",
    );

    writeFileSync(
      join(root, "docs/knowledge.yaml"),
      manifest().replace("  - name: merge-gate", "  - name: documentation"),
    );
    await expectFailure(root, "docs/knowledge.yaml: verification: duplicate name documentation");
  });

  test("keeps an explicitly selected manifest inside the repository root", async () => {
    const root = fixture();
    const outside = mkdtempSync(join(tmpdir(), "project-knowledge-outside-"));
    roots.push(outside);
    const outsideManifest = join(outside, "knowledge.yaml");
    writeFileSync(outsideManifest, manifest());
    const traversal = relative(root, outsideManifest);

    expect(await checkDocumentation(root, { manifest: traversal })).toEqual([
      `${traversal}: manifest path escapes repository root`,
    ]);
    expect(await checkDocumentation(root, { manifest: outsideManifest })).toEqual([
      `${outsideManifest}: manifest path escapes repository root`,
    ]);
  });

  test("rejects manifest entrypoint and authority paths that escape the repository", async () => {
    const root = fixture();
    writeFileSync(
      join(root, "docs/knowledge.yaml"),
      manifest().replace("human: README.md", "human: ../README.md"),
    );
    expect((await checkDocumentation(root)).join("\n")).toContain(
      "entrypoints.human: must be a non-empty repository-relative path",
    );

    writeFileSync(
      join(root, "docs/knowledge.yaml"),
      manifest().replace("path: docs/product.md", "path: docs/../../outside.md"),
    );
    expect((await checkDocumentation(root)).join("\n")).toContain(
      "authorities[0].path: must be a non-empty repository-relative path",
    );
  });

  test("reports escaped authority symlinks without reading their targets", async () => {
    const root = fixture();
    const outside = mkdtempSync(join(tmpdir(), "project-knowledge-outside-directory-"));
    roots.push(outside);
    rmSync(join(root, "docs/product.md"));
    symlinkSync(outside, join(root, "docs/product.md"));

    expect(await checkDocumentation(root)).toContain(
      "docs/product.md: required path escapes repository root",
    );
  });

  test("reports non-directory path components instead of throwing", async () => {
    const root = fixture({
      "docs/knowledge.yaml": manifest().replace("human: README.md", "human: README.md/guide.md"),
      "docs/architecture.md":
        "# Architecture\n\nStatus: canonical\n\n[Invalid](../README.md/guide.md)\n",
    });

    const failures = await checkDocumentation(root);
    expect(failures).toContain(
      "README.md/guide.md: invalid path (path component README.md is not a directory)",
    );
    expect(failures).toContain(
      "docs/architecture.md: invalid local link ../README.md/guide.md (path component README.md is not a directory)",
    );
  });

  test("does not require the index to link itself when listed as an active authority", async () => {
    const root = fixture({
      "docs/knowledge.yaml": manifest(
        "  - path: docs/README.md\n    status: active\n  - path: docs/product.md\n    status: active\n  - path: docs/architecture.md\n    status: active\n  - path: docs/decisions/README.md\n    status: active\n",
      ),
    });
    expect(await checkDocumentation(root)).toEqual([]);
  });

  test("ignores Status lines hidden in code fences for lifecycle checks", async () => {
    const root = fixture({
      "docs/product.md": "# Product\n\n```text\nStatus: canonical\n```\n",
    });
    expect(await checkDocumentation(root)).toContain(
      "docs/product.md: document status missing conflicts with manifest status active",
    );
  });

  test("preserves status, index, shape, and inbound-link checks", async () => {
    const root = fixture({
      "docs/README.md":
        "# Documentation\n\nStatus: canonical\n\n[Product](./product.md)\n[Decisions](./decisions/README.md)\n[Removed](./removed.md)\n",
      "docs/product.md": "# Product\n\nStatus: invalid\n\n```ts\n",
    });
    const failures = await checkDocumentation(root);
    expect(failures).toContain("docs/architecture.md: missing from docs/README.md");
    expect(failures).toContain("docs/README.md: broken local link ./removed.md");
    expect(failures).toContain("docs/product.md: unbalanced code fence");
    expect(failures.join("\n")).toContain("supported Status");
  });

  test("rejects malformed encoding, repository escapes, wrong case, and bad anchors", async () => {
    const root = fixture({
      "docs/architecture.md":
        "# Architecture\n\nStatus: canonical\n\n[Encoding](./bad%ZZ.md)\n[Escape](../../outside.md)\n[Case](./Product.md)\n[Anchor](./product.md#Product)\n",
    });
    const output = (await checkDocumentation(root)).join("\n");
    expect(output).toContain("invalid encoded link target ./bad%ZZ.md");
    expect(output).toContain("local link escapes repository root ../../outside.md");
    expect(output).toContain("path casing differs at Product.md; Git tree has product.md");
    expect(output).toContain("broken local anchor ./product.md#Product");
  });

  test("validates authority statuses, replacement edges, routes, and archived dependencies", async () => {
    const authorities =
      "  - path: docs/product.md\n    status: active\n  - path: docs/architecture.md\n    status: active\n  - path: docs/old.md\n    status: superseded\n    replacement: docs/archive/legacy.md\n  - path: docs/retired.md\n    status: superseded\n  - path: docs/missing.md\n    status: active\n  - path: docs/archive/legacy.md\n    status: archived\n";
    const root = fixture({
      "AGENTS.md": "# No route\n",
      "README.md": "# No route\n",
      "docs/knowledge.yaml": manifest(authorities),
      "docs/product.md": "# Product\n\nStatus: canonical\n\n[Legacy](./archive/legacy.md)\n",
      "docs/architecture.md": "# Architecture\n\nStatus: superseded\n",
      "docs/old.md": "# Old\n\nStatus: superseded\n",
      "docs/retired.md": "# Retired\n\nStatus: superseded\n",
      "docs/archive/legacy.md": "# Legacy\n\nStatus: archived\n",
    });
    const output = (await checkDocumentation(root)).join("\n");
    expect(output).toContain("superseded authority docs/retired.md needs a replacement");
    expect(output).toContain("docs/old.md replacement must be an active authority");
    expect(output).toContain("docs/missing.md: required path is missing");
    expect(output).toContain("docs/architecture.md: document status superseded conflicts");
    expect(output).toContain("active authority depends on archived authority");
    expect(output).toContain("README.md: does not route to docs/README.md");
    expect(output).toContain("AGENTS.md: does not route to a knowledge entrypoint");
  });

  test("accepts visible routes but rejects fenced-code and HTML-only routes", async () => {
    for (const hidden of ["```text\ndocs/README.md\n```\n", "<!-- docs/README.md -->\n"]) {
      const root = fixture({ "README.md": `# Product\n\n${hidden}` });
      await expectFailure(root, "README.md: does not route to docs/README.md");
    }

    for (const visible of [
      "Read docs/README.md for canonical documentation.",
      "Read `docs/README.md` for canonical documentation.",
      "The knowledge index is docs/README.md.",
    ]) {
      const root = fixture({ "README.md": `# Product\n\n${visible}\n` });
      expect(await checkDocumentation(root)).toEqual([]);
    }
  });

  test("rejects prose route lookalikes that only contain the entrypoint as a substring", async () => {
    for (const lookalike of [
      "Read mydocs/README.md for canonical documentation.",
      "Read docs/README.mdx for canonical documentation.",
      "Read docs/README.md/nested.md for canonical documentation.",
    ]) {
      const root = fixture({ "README.md": `# Product\n\n${lookalike}\n` });
      await expectFailure(root, "README.md: does not route to docs/README.md");
    }
  });

  test("does not accept images as entrypoint or authority routes", async () => {
    const root = fixture({
      "README.md": "# Product\n\n![Documentation](docs/README.md)\n",
      "AGENTS.md": "![Documentation](docs/README.md)\n",
      "docs/README.md":
        "# Documentation\n\nStatus: canonical\n\n![Product](./product.md)\n![Architecture](./architecture.md)\n![Decisions](./decisions/README.md)\n",
    });

    const failures = await checkDocumentation(root);
    expect(failures).toContain("README.md: does not route to docs/README.md");
    expect(failures).toContain("AGENTS.md: does not route to a knowledge entrypoint");
    expect(failures).toContain("docs/product.md: active authority is missing from docs/README.md");
  });

  test("targets an arbitrary existing repository root from the public CLI", () => {
    const root = fixture();
    const script = resolve(import.meta.dir, "../src/cli.ts");
    const result = Bun.spawnSync(["bun", script, "check", root], {
      cwd: tmpdir(),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(result.stdout.toString()).toContain("project knowledge checks passed");
  });

  test("accepts a custom manifest and index from the public CLI", () => {
    const root = mkdtempSync(join(tmpdir(), "project-knowledge-custom-"));
    roots.push(root);
    const files = {
      "README.md": "# Product\n\n[Knowledge](docs/index.md)\n",
      "BOT.md": "Read `docs/index.md` for project knowledge.\n",
      "config/knowledge.yaml": `version: 1
entrypoints:
  human: README.md
  agent: BOT.md
  index: docs/index.md
authorities:
  - path: docs/spec.md
    status: active
verification:
  - name: documentation
    command: [muninn, check]
`,
      "docs/index.md": "# Knowledge\n\nStatus: canonical\n\n[Specification](./spec.md)\n",
      "docs/spec.md": "# Specification\n\nStatus: canonical\n",
    };
    for (const [path, contents] of Object.entries(files)) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents);
    }

    const script = resolve(import.meta.dir, "../src/cli.ts");
    const result = Bun.spawnSync(
      ["bun", script, "check", root, "--manifest", "config/knowledge.yaml"],
      { cwd: tmpdir(), stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(result.stdout.toString()).toContain("project knowledge checks passed");
  });

  test("rejects external tuning options without --external from the public CLI", () => {
    const root = fixture();
    const script = resolve(import.meta.dir, "../src/cli.ts");
    const result = Bun.spawnSync(["bun", script, "check", root, "--timeout", "1000"], {
      cwd: tmpdir(),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain(
      "--timeout, --retries, --max-redirects, and --concurrency require --external",
    );
  });

  test("keeps external checks opt-in", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 404 }) });
    const root = fixture({
      "docs/architecture.md": `# Architecture\n\nStatus: canonical\n\n[Remote](${server.url.href}missing)\n`,
    });
    try {
      expect(await checkDocumentation(root)).toEqual([]);
      const failures = await checkDocumentation(root, {
        external: true,
        externalOptions: { retries: 0 },
      });
      expect(failures.join("\n")).toContain("external link");
    } finally {
      server.stop(true);
    }
  });
});

describe("scope, kind, and reviewed attestation checks", () => {
  function run(root: string, args: string[]) {
    const result = Bun.spawnSync(
      [
        "git",
        "-c",
        "user.email=test@example.com",
        "-c",
        "user.name=Test",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: root },
    );
    expect(result.exitCode).toBe(0);
    return result.stdout.toString().trim();
  }

  test("validates kind, scope, and reviewed manifest fields", async () => {
    const entry = (extra: string) =>
      manifest(
        `  - path: docs/product.md\n    status: active\n${extra}  - path: docs/architecture.md\n    status: active\n  - path: docs/decisions/README.md\n    status: active\n`,
      );
    await expectFailure(
      fixture({ "docs/knowledge.yaml": entry("    kind: prose\n") }),
      "docs/knowledge.yaml: authorities[0].kind: must be one of constraint, decision, guide, reference, plan",
    );
    await expectFailure(
      fixture({ "docs/knowledge.yaml": entry("    scope: []\n") }),
      "docs/knowledge.yaml: authorities[0].scope: must be a non-empty array of glob patterns",
    );
    await expectFailure(
      fixture({ "docs/knowledge.yaml": entry("    scope: [/src/**]\n") }),
      "docs/knowledge.yaml: authorities[0].scope[0]: must be a repository-relative glob pattern",
    );
    await expectFailure(
      fixture({ "docs/knowledge.yaml": entry("    reviewed: not-a-sha\n") }),
      "docs/knowledge.yaml: authorities[0].reviewed: must be a full or abbreviated git commit SHA",
    );
    await expectFailure(
      fixture({
        "docs/knowledge.yaml": entry("    reviewed: 0123456789abcdef0123456789abcdef01234567\n"),
      }),
      "docs/knowledge.yaml: docs/product.md reviewed attestation requires a scope",
    );
  });

  test("reports scope patterns that match no files", async () => {
    const root = fixture({
      "docs/knowledge.yaml": manifest(
        "  - path: docs/product.md\n    status: active\n    scope: [src/**]\n  - path: docs/architecture.md\n    status: active\n  - path: docs/decisions/README.md\n    status: active\n",
      ),
    });
    await expectFailure(root, "docs/product.md: scope pattern src/** matches no files");
  });

  test("reports overlapping scopes only for active authorities of the same kind", async () => {
    const root = fixture({
      "docs/knowledge.yaml": manifest(
        "  - path: docs/product.md\n    status: active\n    kind: guide\n    scope: [docs/*.md]\n  - path: docs/architecture.md\n    status: active\n    kind: guide\n    scope: [docs/*.md]\n  - path: docs/decisions/README.md\n    status: active\n    kind: reference\n    scope: [docs/*.md]\n",
      ),
    });
    const failures = await checkDocumentation(root);
    expect(failures).toContain(
      "docs/product.md: scope overlaps docs/architecture.md (both active guide authorities cover docs/README.md)",
    );
    expect(failures.filter((failure) => failure.includes("scope overlaps"))).toHaveLength(1);
  });

  test("verifies reviewed attestations against git history", async () => {
    const scoped = (reviewed: string) =>
      manifest(
        `  - path: docs/product.md\n    status: active\n    scope: [src/**]\n    reviewed: ${reviewed}\n  - path: docs/architecture.md\n    status: active\n  - path: docs/decisions/README.md\n    status: active\n`,
      );
    const root = fixture({
      "src/payments.ts": "export const fee = 1;\n",
      "docs/knowledge.yaml": scoped("0123456789abcdef0123456789abcdef01234567"),
    });
    await expectFailure(root, "docs/product.md: reviewed attestation requires git history");
    run(root, ["init", "-q"]);
    run(root, ["add", "."]);
    run(root, ["commit", "-q", "-m", "initial"]);
    await expectFailure(
      root,
      "docs/product.md: reviewed commit 0123456789abcdef0123456789abcdef01234567 is not in repository history",
    );
    const head = run(root, ["rev-parse", "HEAD"]);
    const unrelated = run(root, ["commit-tree", "HEAD^{tree}", "-m", "unrelated"]);
    writeFileSync(join(root, "docs/knowledge.yaml"), scoped(unrelated));
    await expectFailure(
      root,
      `docs/product.md: reviewed commit ${unrelated} is not an ancestor of HEAD`,
    );
    writeFileSync(join(root, "docs/knowledge.yaml"), scoped(head));
    expect(await checkDocumentation(root)).toEqual([]);
    writeFileSync(join(root, "src/payments.ts"), "export const fee = 2;\n");
    await expectFailure(
      root,
      `docs/product.md: scope changed since reviewed commit ${head} (src/payments.ts)`,
    );
    writeFileSync(join(root, "src/payments.ts"), "export const fee = 1;\n");
    writeFileSync(join(root, "src/untracked.ts"), "export const pending = true;\n");
    await expectFailure(
      root,
      `docs/product.md: scope changed since reviewed commit ${head} (src/untracked.ts)`,
    );
    rmSync(join(root, "src/untracked.ts"));
    writeFileSync(join(root, "src/payments.ts"), "export const fee = 2;\n");
    run(root, ["add", "."]);
    run(root, ["commit", "-q", "-m", "change fee"]);
    await expectFailure(
      root,
      `docs/product.md: scope changed since reviewed commit ${head} (src/payments.ts)`,
    );
  });
});

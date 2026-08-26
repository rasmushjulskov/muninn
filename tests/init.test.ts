import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { checkDocumentation } from "../src/check";
import { initializeKnowledge, knowledgeTemplate } from "../src/init";

const cli = resolve(import.meta.dir, "../src/cli.ts");
const roots: string[] = [];

const minimalScaffold = ["README.md", "docs/README.md", "docs/knowledge.yaml"];

const fullScaffold = [
  "README.md",
  "AGENTS.md",
  "docs/README.md",
  "docs/product.md",
  "docs/architecture.md",
  "docs/development.md",
  "docs/operations.md",
  "docs/decisions/README.md",
  "docs/knowledge.yaml",
];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("knowledge contract initializer", () => {
  test("initializes the minimal contract by default and passes the offline check", async () => {
    const root = join(mkdtempSync(join(tmpdir(), "muninn-init-parent-")), "project");
    roots.push(root.replace(/\/project$/, ""));
    const result = initializeKnowledge(root);
    expect(result.created).toEqual(minimalScaffold);
    expect(result.skipped).toEqual([]);
    expect(readFileSync(join(root, "docs/knowledge.yaml"), "utf8")).toContain(
      "path: docs/README.md\n    status: active",
    );
    expect(existsSync(join(root, ".gitignore"))).toBe(false);
    expect(knowledgeTemplate()).toBe(readFileSync(join(root, "docs/knowledge.yaml"), "utf8"));
    expect(await checkDocumentation(root)).toEqual([]);
  });

  test("initializes the full template on request and passes the offline check", async () => {
    const root = mkdtempSync(join(tmpdir(), "muninn-full-"));
    roots.push(root);
    const result = initializeKnowledge(root, { template: "full" });
    expect(result.created).toEqual(fullScaffold);
    expect(result.skipped).toEqual([]);
    expect(readFileSync(join(root, "docs/knowledge.yaml"), "utf8")).toContain(
      "path: docs/product.md\n    status: active",
    );
    expect(existsSync(join(root, ".gitignore"))).toBe(false);
    const index = readFileSync(join(root, "docs/README.md"), "utf8");
    expect(index).toContain("[Project README](../README.md)");
    expect(index).toContain("[Product](product.md)");
    expect(index).toContain("[Architecture](architecture.md)");
    expect(index).not.toMatch(/!?\[\[/);
    expect(await checkDocumentation(root)).toEqual([]);
  });

  test("initializes from a custom template directory", () => {
    const template = mkdtempSync(join(tmpdir(), "muninn-template-"));
    const root = mkdtempSync(join(tmpdir(), "muninn-custom-"));
    roots.push(template, root);
    mkdirSync(join(template, "docs"));
    writeFileSync(join(template, "README.md"), "# Custom\n");
    writeFileSync(join(template, "docs/notes.md"), "# Notes\n");

    const result = initializeKnowledge(root, { template });

    expect(result.created).toEqual(["README.md", "docs/notes.md"]);
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("# Custom\n");
    expect(readFileSync(join(root, "docs/notes.md"), "utf8")).toBe("# Notes\n");
  });

  test("rejects an unknown template", () => {
    const root = mkdtempSync(join(tmpdir(), "muninn-unknown-template-"));
    roots.push(root);
    expect(() => initializeKnowledge(root, { template: "missing-template" })).toThrow(
      'missing-template: template must be "full", "minimal", or a directory',
    );
    expect(existsSync(join(root, "README.md"))).toBe(false);
  });

  test("never overwrites existing files by default", () => {
    const root = mkdtempSync(join(tmpdir(), "muninn-existing-"));
    roots.push(root);
    const original = "# Existing\n\nKeep this content.\n";
    writeFileSync(join(root, "README.md"), original);

    const first = initializeKnowledge(root);
    const second = initializeKnowledge(root);

    expect(first.skipped).toEqual(["README.md"]);
    expect(second.skipped).toEqual(minimalScaffold);
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe(original);
  });

  test("changes ignore rules only when Obsidian support is explicitly selected", () => {
    const root = mkdtempSync(join(tmpdir(), "muninn-existing-ignore-"));
    roots.push(root);
    const original = "node_modules/\ndist/";
    writeFileSync(join(root, ".gitignore"), original);

    initializeKnowledge(root);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(original);

    const first = initializeKnowledge(root, { obsidian: true });
    const afterFirst = readFileSync(join(root, ".gitignore"), "utf8");
    const second = initializeKnowledge(root, { obsidian: true });

    expect(first.skipped).toEqual([...minimalScaffold, ".gitignore"]);
    expect(second.skipped).toEqual([...minimalScaffold, ".gitignore"]);
    expect(afterFirst).toBe(`${original}\n.obsidian/\n`);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(afterFirst);
    expect(afterFirst.split("\n").filter((line) => line === ".obsidian/")).toHaveLength(1);
  });

  test("refuses to initialize through a symlinked directory", () => {
    const root = mkdtempSync(join(tmpdir(), "muninn-symlink-root-"));
    const outside = mkdtempSync(join(tmpdir(), "muninn-symlink-outside-"));
    roots.push(root, outside);
    symlinkSync(outside, join(root, "docs"));

    expect(() => initializeKnowledge(root)).toThrow("docs: path component must not be a symlink");
    expect(existsSync(join(root, "README.md"))).toBe(false);
    expect(existsSync(join(outside, "README.md"))).toBe(false);
    expect(existsSync(join(outside, "knowledge.yaml"))).toBe(false);
  });

  test("cli init reports the minimal scaffold and points to setup guidance", () => {
    const root = mkdtempSync(join(tmpdir(), "muninn-cli-init-"));
    roots.push(root);
    const result = Bun.spawnSync(["bun", cli, "init", root], { stdout: "pipe", stderr: "pipe" });
    const stdout = result.stdout.toString();
    expect(result.exitCode).toBe(0);
    for (const name of minimalScaffold) expect(stdout).toContain(`created ${name}`);
    expect(stdout).toContain("initialized");
    expect(stdout).toContain("run `muninn setup-prompt`");
    expect(stdout).toContain("https://github.com/rasmushjulskov/muninn#quick-start");
  });

  test("cli exposes the full scaffold and Obsidian support as explicit options", () => {
    const root = mkdtempSync(join(tmpdir(), "muninn-cli-full-init-"));
    roots.push(root);
    const result = Bun.spawnSync(["bun", cli, "init", root, "--template", "full", "--obsidian"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = result.stdout.toString();
    expect(result.exitCode).toBe(0);
    for (const name of [...fullScaffold, ".gitignore"]) {
      expect(stdout).toContain(`created ${name}`);
    }
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(".obsidian/\n");
  });
});

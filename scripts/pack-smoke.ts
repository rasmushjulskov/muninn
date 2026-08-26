import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const workspace = resolve(import.meta.dir, "..");
const temporary = mkdtempSync(join(tmpdir(), "muninn-pack-smoke-"));
const retainedPack = process.env.MUNINN_PACK_OUTPUT
  ? resolve(process.env.MUNINN_PACK_OUTPUT)
  : undefined;

function run(command: string[], cwd: string): string {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} failed (${result.exitCode})\n${result.stdout.toString()}${result.stderr.toString()}`,
    );
  }
  return result.stdout.toString();
}

function runFailure(command: string[], cwd: string, expected: string): void {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const output = `${result.stdout.toString()}${result.stderr.toString()}`;
  if (result.exitCode === 0 || !output.includes(expected)) {
    throw new Error(
      `${command.join(" ")} did not fail with ${JSON.stringify(expected)}\nexit: ${result.exitCode}\n${output}`,
    );
  }
}

try {
  const packed = retainedPack ?? join(temporary, "packed");
  mkdirSync(packed, { recursive: true });
  if (readdirSync(packed).length !== 0) throw new Error(`pack output must be empty: ${packed}`);
  const packResults = JSON.parse(
    run(["npm", "pack", "--json", "--dry-run=false", "--pack-destination", packed], workspace),
  ) as { filename?: string; integrity?: string; shasum?: string; files?: { path: string }[] }[];
  const packResult = packResults[0];
  const tarballName = packResult?.filename;
  if (!packResult || packResults.length !== 1 || !tarballName?.endsWith(".tgz")) {
    throw new Error("npm pack did not report exactly one tarball");
  }
  const tarball = join(packed, tarballName);
  const tarballBytes = readFileSync(tarball);
  const integrity = `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}`;
  const shasum = createHash("sha1").update(tarballBytes).digest("hex");
  if (packResult.integrity !== integrity || packResult.shasum !== shasum) {
    throw new Error("npm pack machine-readable checksums differ from the actual tarball bytes");
  }
  const actualFiles = run(["tar", "-tzf", tarball], workspace).trim().split("\n").sort();
  const expectedFiles = [
    "package/DEFAULT.md",
    "package/LICENSE",
    "package/README.md",
    "package/SETUP_PROMPT.md",
    "package/package.json",
    "package/dist/assets.js",
    "package/dist/check.d.ts",
    "package/dist/check.js",
    "package/dist/cli.d.ts",
    "package/dist/cli.js",
    "package/dist/external.d.ts",
    "package/dist/external.js",
    "package/dist/index.d.ts",
    "package/dist/index.js",
    "package/dist/init.d.ts",
    "package/dist/init.js",
    "package/dist/manifest.d.ts",
    "package/dist/manifest.js",
    "package/dist/markdown.js",
    "package/dist/paths.js",
    "package/dist/scope.js",
    "package/dist/status.js",
    "package/dist/types.d.ts",
    "package/dist/types.js",
  ].sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `packed allowlist mismatch\nexpected: ${expectedFiles}\nactual: ${actualFiles}`,
    );
  }
  const reportedFiles = (packResult.files ?? []).map((file) => `package/${file.path}`).sort();
  if (JSON.stringify(reportedFiles) !== JSON.stringify(actualFiles)) {
    throw new Error("npm pack machine-readable file list differs from the actual tarball");
  }
  if (retainedPack) {
    writeFileSync(join(packed, "pack-result.json"), `${JSON.stringify(packResult, null, 2)}\n`);
  }
  const packedFiles = new Set(actualFiles);
  const packedReadme = run(["tar", "-xOf", tarball, "package/README.md"], workspace);
  const hostedLogo = "https://rasmushjulskov.com/assets/muninn/muninn-logo.png";
  const hostedDarkLogo = "https://rasmushjulskov.com/assets/muninn/muninn-logo-dark.png";
  const imageDestinations = [
    ...packedReadme.matchAll(/<(?:img|source)\b[^>]*\b(?:src|srcset)="([^"]+)"/g),
  ].map((match) => match[1]);
  if (
    JSON.stringify(imageDestinations) !== JSON.stringify([hostedDarkLogo, hostedLogo]) ||
    !packedReadme.includes('<p align="center">') ||
    !packedReadme.includes('<source media="(prefers-color-scheme: dark)"') ||
    !packedReadme.includes('width="560"')
  ) {
    throw new Error(
      `packed README must contain only the centered, theme-aware Muninn logo at width 560; found: ${imageDestinations.join(", ")}`,
    );
  }
  const packageVersion = JSON.parse(
    run(["tar", "-xOf", tarball, "package/package.json"], workspace),
  ).version as string;
  for (const forbidden of [
    "is not published to npm yet",
    `github.com/${["the-magrathean", "custom-builders"].join("-")}/muninn`,
    "docs/assets/muninn-hero.webp",
  ]) {
    if (packedReadme.includes(forbidden)) {
      throw new Error(`README contains release-only or private content: ${forbidden}`);
    }
  }
  for (const match of packedReadme.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const destination = match[1]?.split("#", 1)[0];
    if (!destination) continue;
    const unpkg = destination.match(
      /^https:\/\/unpkg\.com\/@rasmushjulskov\/muninn@([^/]+)\/(.+)$/,
    );
    if (unpkg) {
      if (unpkg[1] !== packageVersion) {
        throw new Error(`README unpkg link version differs from package version: ${destination}`);
      }
      if (!packedFiles.has(`package/${unpkg[2]}`)) {
        throw new Error(`README unpkg link target is absent from package: ${destination}`);
      }
      continue;
    }
    if (/^(?:[a-z]+:|\/)/i.test(destination)) continue;
    const packagedTarget = `package/${destination}`;
    if (!packedFiles.has(packagedTarget)) {
      throw new Error(`README link target is absent from package: ${destination}`);
    }
  }
  const forbiddenPackageContent = [
    /\/Users\//,
    /\/home\//,
    new RegExp(["HERMES", "KANBAN"].join("_")),
    new RegExp(["t", "3da9ec0d"].join("_")),
    /muninn-default-onboarding/,
    /Steward/,
    /gh[opsu]_[A-Za-z0-9]{20,}/,
  ];
  for (const name of actualFiles) {
    const contents = run(["tar", "-xOf", tarball, name], workspace);
    const forbidden = forbiddenPackageContent.find((pattern) => pattern.test(contents));
    if (forbidden)
      throw new Error(`${name}: packed content matched forbidden pattern ${forbidden}`);
  }

  const consumer = join(temporary, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    `${JSON.stringify(
      {
        name: "muninn-packed-consumer",
        private: true,
        dependencies: { "@rasmushjulskov/muninn": `file:${tarball}` },
      },
      null,
      2,
    )}\n`,
  );
  run(["bun", "install"], consumer);
  const cli = join(consumer, "node_modules", ".bin", "muninn");
  const help = run([cli, "--help"], consumer);
  for (const command of ["muninn default --path", "muninn setup-prompt [--path]"]) {
    if (!help.includes(command)) throw new Error(`installed help omitted ${command}`);
  }
  if (run([cli, "--version"], consumer).trim() !== packageVersion) {
    throw new Error("installed --version differs from the packed package version");
  }

  const assetCommands = [
    ["default", "DEFAULT.md"],
    ["setup-prompt", "SETUP_PROMPT.md"],
  ] as const;
  for (const [command, name] of assetCommands) {
    const path = run([cli, command, "--path"], consumer).trim();
    if (!isAbsolute(path)) throw new Error(`${command} --path did not return an absolute path`);
    if (readFileSync(path, "utf8") !== readFileSync(join(workspace, name), "utf8")) {
      throw new Error(`installed ${name} differs from the packed source asset`);
    }
  }
  if (
    run([cli, "setup-prompt"], consumer) !==
    readFileSync(join(workspace, "SETUP_PROMPT.md"), "utf8")
  ) {
    throw new Error("installed setup-prompt output differs from SETUP_PROMPT.md");
  }

  const fresh = join(temporary, "fresh-project");
  const initOutput = run([cli, "init", fresh], consumer);
  if (
    !initOutput.includes("run `muninn setup-prompt`") ||
    !initOutput.includes("https://github.com/rasmushjulskov/muninn#quick-start")
  ) {
    throw new Error("init output did not point to the setup prompt and getting started guide");
  }
  run([cli, "check", fresh], consumer);
  const initializedFiles = ["README.md", "docs/README.md", "docs/knowledge.yaml"];
  const initializedContents = initializedFiles.map((name) =>
    readFileSync(join(fresh, name), "utf8"),
  );
  run([cli, "init", fresh], consumer);
  run([cli, "check", fresh], consumer);
  for (const [index, name] of initializedFiles.entries()) {
    if (readFileSync(join(fresh, name), "utf8") !== initializedContents[index]) {
      throw new Error(`repeated initialization changed ${name}`);
    }
  }

  const full = join(temporary, "full-project");
  run([cli, "init", full, "--template", "full", "--obsidian"], consumer);
  run([cli, "check", full], consumer);
  const fullFiles = [
    "README.md",
    "AGENTS.md",
    "docs/README.md",
    "docs/product.md",
    "docs/architecture.md",
    "docs/development.md",
    "docs/operations.md",
    "docs/decisions/README.md",
    "docs/knowledge.yaml",
    ".gitignore",
  ];
  const fullContents = fullFiles.map((name) => readFileSync(join(full, name), "utf8"));
  run([cli, "init", full, "--template", "full", "--obsidian"], consumer);
  run([cli, "check", full], consumer);
  for (const [index, name] of fullFiles.entries()) {
    if (readFileSync(join(full, name), "utf8") !== fullContents[index]) {
      throw new Error(`repeated full initialization changed ${name}`);
    }
  }

  const existing = join(temporary, "existing-project");
  mkdirSync(existing);
  const original = "# Existing project\n\n[Knowledge](docs/README.md)\n";
  const originalIgnore = "node_modules/\ndist/";
  writeFileSync(join(existing, "README.md"), original);
  writeFileSync(join(existing, ".gitignore"), originalIgnore);
  run([cli, "init", existing], consumer);
  if (readFileSync(join(existing, "README.md"), "utf8") !== original) {
    throw new Error("initializer overwrote an existing README.md");
  }
  if (readFileSync(join(existing, ".gitignore"), "utf8") !== originalIgnore) {
    throw new Error("default initialization changed .gitignore without --obsidian");
  }
  run([cli, "check", existing], consumer);
  run([cli, "init", existing], consumer);
  if (readFileSync(join(existing, "README.md"), "utf8") !== original) {
    throw new Error("repeated initialization overwrote an existing README.md");
  }
  if (readFileSync(join(existing, ".gitignore"), "utf8") !== originalIgnore) {
    throw new Error("repeated default initialization changed .gitignore");
  }
  run([cli, "init", existing, "--obsidian"], consumer);
  const expectedIgnore = `${originalIgnore}\n.obsidian/\n`;
  if (readFileSync(join(existing, ".gitignore"), "utf8") !== expectedIgnore) {
    throw new Error(
      "initializer did not preserve existing ignore rules and append .obsidian/ once",
    );
  }
  run([cli, "init", existing, "--obsidian"], consumer);
  if (readFileSync(join(existing, ".gitignore"), "utf8") !== expectedIgnore) {
    throw new Error("repeated initialization changed .gitignore");
  }

  const archived = join(temporary, "all-archived-project");
  run([cli, "init", archived], consumer);
  writeFileSync(
    join(archived, "docs/knowledge.yaml"),
    readFileSync(join(archived, "docs/knowledge.yaml"), "utf8").replace(
      "status: active",
      "status: archived",
    ),
  );
  writeFileSync(
    join(archived, "docs/README.md"),
    readFileSync(join(archived, "docs/README.md"), "utf8").replace(
      "Status: canonical",
      "Status: archived",
    ),
  );
  runFailure(
    [cli, "check", archived],
    consumer,
    "docs/knowledge.yaml: at least one active authority is required",
  );

  console.log(
    `packed CLI smoke passed: ${tarballName}; exact allowlist, installed assets, fresh/existing idempotence, and all-archived rejection validated`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { posix, relative, resolve, sep } from "node:path";

interface ExportManifest {
  schemaVersion: 1;
  sourceCommit: string;
  mappingVersion: 1;
  treeSha256: string;
  files: { path: string; sha256: string }[];
}

const provenanceName = ".muninn-export.json";
const forbiddenContents = [
  new RegExp(["the-magrathean", "custom-builders"].join("-"), "i"),
  new RegExp(`(?:^|[\\\\/])${["droid", "wiki"].join("-")}(?:[\\\\/]|$)`, "i"),
  /\/Users\//,
  /\/home\/[A-Za-z0-9._-]+\//,
  new RegExp(["HERMES", "KANBAN"].join("_")),
  new RegExp(`(?:^|[\\\\/])\\.${["work", "trees"].join("")}(?:[\\\\/]|$)`),
  /\bt_[0-9a-f]{8,}\b/,
  /\bgh[opsu]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  new RegExp(`-----BEGIN (?:RSA |EC |OPENSSH )?${["PRIVATE", "KEY"].join(" ")}-----`),
];

function sha256(contents: Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

function filesUnder(root: string, directory = root): string[] {
  const output: string[] = [];
  for (const name of readdirSync(directory).sort()) {
    const absolute = resolve(directory, name);
    const relativeName = relative(root, absolute).split(sep).join("/");
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`${relativeName}: exported symlinks are forbidden`);
    if (stat.isDirectory()) output.push(...filesUnder(root, absolute));
    else if (stat.isFile()) output.push(relativeName);
    else throw new Error(`${relativeName}: exported path is not a regular file`);
  }
  return output;
}

function verifyMarkdownLinks(path: string, contents: string, files: Set<string>): void {
  for (const match of contents.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const destination = match[1];
    if (!destination || destination.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(destination)) {
      continue;
    }
    const withoutAnchor = decodeURIComponent(destination.split("#", 1)[0] ?? "");
    if (!withoutAnchor) continue;
    const target = posix.normalize(posix.join(posix.dirname(path), withoutAnchor));
    if (target.startsWith("../") || target.startsWith("/")) {
      throw new Error(`${path}: Markdown link escapes the export: ${destination}`);
    }
    const resolved = target.endsWith("/") ? `${target}README.md` : target;
    if (!files.has(resolved))
      throw new Error(`${path}: broken package-relative link: ${destination}`);
  }
}

export function verifyPublicExport(rootInput: string): ExportManifest {
  const root = resolve(rootInput);
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("public export root must be a real directory");
  }
  const provenancePath = resolve(root, provenanceName);
  const manifest = JSON.parse(readFileSync(provenancePath, "utf8")) as ExportManifest;
  if (
    JSON.stringify(Object.keys(manifest).sort()) !==
      JSON.stringify(["files", "mappingVersion", "schemaVersion", "sourceCommit", "treeSha256"]) ||
    manifest.schemaVersion !== 1 ||
    manifest.mappingVersion !== 1 ||
    !/^[0-9a-f]{40}$/.test(manifest.sourceCommit) ||
    !/^[0-9a-f]{64}$/.test(manifest.treeSha256) ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error("invalid public export provenance");
  }
  const seenPaths = new Set<string>();
  for (const file of manifest.files) {
    if (
      typeof file !== "object" ||
      file === null ||
      JSON.stringify(Object.keys(file).sort()) !== JSON.stringify(["path", "sha256"]) ||
      typeof file.path !== "string" ||
      posix.normalize(file.path) !== file.path ||
      file.path.startsWith("../") ||
      posix.isAbsolute(file.path) ||
      !/^[0-9a-f]{64}$/.test(file.sha256) ||
      seenPaths.has(file.path)
    ) {
      throw new Error("invalid public export file provenance");
    }
    seenPaths.add(file.path);
  }
  const expected = [provenanceName, ...manifest.files.map((file) => file.path)].sort();
  const actual = filesUnder(root).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`exported path allowlist mismatch\nexpected: ${expected}\nactual: ${actual}`);
  }
  const fileSet = new Set(actual);
  const treeInput: string[] = [];
  for (const file of manifest.files) {
    const bytes = readFileSync(resolve(root, file.path));
    const actualHash = sha256(bytes);
    if (actualHash !== file.sha256) throw new Error(`${file.path}: checksum mismatch`);
    treeInput.push(`${file.path}\0${actualHash}\n`);
    if (bytes.includes(0))
      throw new Error(`${file.path}: NUL bytes are forbidden in public exports`);
    const contents = bytes.toString("utf8");
    const forbidden = forbiddenContents.find((pattern) => pattern.test(contents));
    if (forbidden) throw new Error(`${file.path}: matched forbidden pattern ${forbidden}`);
    if (file.path.endsWith(".md")) verifyMarkdownLinks(file.path, contents, fileSet);
  }
  if (sha256(Buffer.from(treeInput.join(""))) !== manifest.treeSha256) {
    throw new Error("export tree checksum mismatch");
  }
  return manifest;
}

if (import.meta.main) {
  try {
    const root = process.argv[2];
    if (!root || process.argv.length !== 3) {
      throw new Error("usage: bun scripts/verify-public-export.ts <export-root>");
    }
    const manifest = verifyPublicExport(root);
    console.log(
      `public export verified: ${manifest.files.length} declared files; source ${manifest.sourceCommit}; tree ${manifest.treeSha256}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

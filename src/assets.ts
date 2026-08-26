import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PackagedAsset = "DEFAULT.md" | "SETUP_PROMPT.md";

const moduleDir = fileURLToPath(new URL(".", import.meta.url));

export function packagedAssetPath(name: PackagedAsset): string {
  return realpathSync(resolve(moduleDir, "..", name));
}

export function readPackagedAsset(name: PackagedAsset): string {
  return readFileSync(packagedAssetPath(name), "utf8");
}
